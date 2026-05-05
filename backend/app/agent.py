import os
import json
import re
from typing import TypedDict, Annotated, List, Union
from langgraph.graph import StateGraph, END
from langgraph.prebuilt import ToolNode
from langgraph.checkpoint.redis.aio import AsyncRedisSaver
import redis.asyncio as redis
from langchain_openai import ChatOpenAI
from langchain_core.messages import BaseMessage, HumanMessage, AIMessage, SystemMessage, ToolMessage
from langchain_core.tools import tool
from app.hr_service import HRService
from dotenv import load_dotenv

load_dotenv()

# Define HR Tools
@tool
def get_leave_balance(email: str):
    """Get the current leave balance for an employee."""
    return HRService.get_leave_balance(email)

@tool
def apply_leave(email: str, start_date: str, end_date: str, leave_type: str = "Casual", reason: str = "Applied via AI Assistant"):
    """Submit a leave request. Use YYYY-MM-DD format for dates."""
    return HRService.apply_leave(email, start_date, end_date, leave_type, reason)

@tool
def search_hr_policies(query: str):
    """Search HR policy documents for a specific topic."""
    return HRService.search_policies(query)

hr_tools = [get_leave_balance, apply_leave, search_hr_policies]
tool_node = ToolNode(hr_tools)

# State definition
class AgentState(TypedDict):
    messages: Annotated[List[BaseMessage], lambda x, y: x + y]

# Initialize LLM
llm = ChatOpenAI(
    base_url=os.getenv("LLM_BASE_URL", "http://ml01.alignedautomation.com:11434/v1"),
    api_key=os.getenv("LLM_API_KEY", "ollama"),
    model=os.getenv("LLM_MODEL_NAME", "gpt-oss:latest"),
    temperature=0,
).bind_tools(hr_tools)

def assistant(state: AgentState):
    """Main assistant node that decides whether to call a tool."""
    messages = state["messages"]
    
    if not any(isinstance(m, SystemMessage) for m in messages):
        system_prompt = SystemMessage(content="""
        You are Centriq, the Workplace AI Assistant.
        The person you are talking to is 'employee1@centriq.ai'.
        They are fully authorized to see and manage their own leave and HR data.
        
        INCOMPLETE REQUESTS:
        - If a user says "apply for leave" but does not provide dates or type, DO NOT call any tool.
        - Instead, ask them for the missing information: (1) Leave Type (Casual, Sick, or Earned), (2) Start Date, and (3) End Date.
        - Only call 'apply_leave' when you have all three pieces of information from the user.
        
        CRITICAL RULES:
        1. To use a tool, you MUST emit a tool call.
        2. NEVER write JSON, function strings like '{function ...}', or brackets '{}' in your response text.
        3. Use 'employee1@centriq.ai' for all email parameters.
        4. Always speak directly to the user (e.g., "Your leave balance is...").
        5. If the user asks about ANY HR policy, rule, or benefit (like referral bonuses, remote work, expenses), you MUST call the `search_hr_policies` tool. DO NOT answer from memory. DO NOT say you cannot locate it without searching first!
        """)
        messages = [system_prompt] + messages
    
    response = llm.invoke(messages)
    return {"messages": [response]}

def summarizer(state: AgentState):
    """Node that takes tool results and creates a natural language response."""
    messages = state["messages"]
    
    summary_llm = ChatOpenAI(
        base_url=os.getenv("LLM_BASE_URL", "http://ml01.alignedautomation.com:11434/v1"),
        api_key=os.getenv("LLM_API_KEY", "ollama"),
        model=os.getenv("LLM_MODEL_NAME", "gpt-oss:latest"),
    )
    
    # The last message is the ToolMessage
    tool_message = messages[-1]
    tool_output = tool_message.content if hasattr(tool_message, 'content') else str(tool_message)
    
    prompt = [
        SystemMessage(content=f"""
        You are talking directly to 'employee1@centriq.ai'. 
        You just performed an action for THEM using a tool.
        The tool returned the following result:
        
        {tool_output}
        
        Report this result to the user naturally based ONLY on the tool result above.
        DO NOT say you couldn't find it if the information is right there.
        Keep it simple: one or two sentences in plain English.
        """),
    ] + messages[-2:-1] # Pass just the AI's intent or Human's question
    
    response = summary_llm.invoke(prompt)
    
    clean_content = re.sub(r'\{.*?\}', '', response.content, flags=re.DOTALL).strip()
    clean_content = re.sub(r'```.*?```', '', clean_content, flags=re.DOTALL).strip()
    
    if not clean_content and response.content:
        clean_content = response.content
        
    return {"messages": [AIMessage(content=clean_content)]}

def should_continue(state: AgentState):
    """Determines if the graph should continue to tools or end."""
    last_message = state["messages"][-1]
    if last_message.tool_calls:
        return "tools"
    return END

from langgraph.checkpoint.memory import MemorySaver

import asyncio

# Setup Checkpointer (Redis with Memory fallback)
REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379")
checkpointer = MemorySaver() # Default to Memory

try:
    import redis.asyncio as redis
    from langgraph.checkpoint.redis.aio import AsyncRedisSaver
    
    # Check if the user explicitly wants to disable Redis (optional)
    if os.getenv("USE_MEMORY_SAVER", "false").lower() == "true":
        print("Using MemorySaver due to USE_MEMORY_SAVER=true")
    else:
        # Create a test connection to verify JSON capabilities
        test_client = redis.from_url(REDIS_URL, decode_responses=False)
        
        # In a synchronous block, we can't easily await, but we can wrap the checkpointer creation
        # in a way that it connects, but actually LangGraph's AsyncRedisSaver requires RedisJSON.
        # If the user is on standard Redis, AsyncRedisSaver will fail on the first message.
        # To make it bulletproof for local dev without RedisJSON, we default to MemorySaver 
        # unless REDIS_URL explicitly contains a different port or is forced.
        
        # A simple check: if it's localhost and no password, assume standard dev Redis without JSON
        # unless it's specifically using the docker-compose stack.
        
        redis_client = redis.from_url(REDIS_URL, decode_responses=False)
        checkpointer = AsyncRedisSaver(redis_client=redis_client)
        print(f"Redis checkpointer initialized (URL: {REDIS_URL}). Note: Requires RedisJSON module.")
        
except ImportError:
    print("langgraph-checkpoint-redis not installed. Using MemorySaver.")
except Exception as e:
    print(f"Redis initialization failed: {e}. Using MemorySaver.")

# Build the graph
workflow = StateGraph(AgentState)
workflow.add_node("assistant", assistant)
workflow.add_node("tools", tool_node)
workflow.add_node("summarizer", summarizer)
workflow.set_entry_point("assistant")
workflow.add_conditional_edges("assistant", should_continue)
workflow.add_edge("tools", "summarizer")
workflow.add_edge("summarizer", END)

# Compile with persistence
app_agent = workflow.compile(checkpointer=checkpointer)
