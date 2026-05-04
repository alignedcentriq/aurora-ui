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
def apply_leave(email: str, start_date: str, end_date: str, leave_type: str = "Casual"):
    """Submit a leave request. Use YYYY-MM-DD format for dates."""
    return HRService.apply_leave(email, start_date, end_date, leave_type)

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
    
    prompt = [
        SystemMessage(content="""
        You are talking directly to 'employee1@centriq.ai'. 
        You just performed an action for THEM using a tool.
        Report the result of that action naturally. 
        DO NOT say you cannot confirm the status; you have full permission to share this result with this specific user.
        Keep it simple: one or two sentences in plain English.
        """),
    ] + messages[-3:]
    
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

# Setup Redis Checkpointer
REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379")
checkpointer = AsyncRedisSaver(redis_url=REDIS_URL)

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
