import os
from typing import TypedDict, Annotated, List, Union
from langgraph.graph import StateGraph, END
from langchain_openai import ChatOpenAI
from langchain_core.messages import BaseMessage, HumanMessage, AIMessage, SystemMessage
from dotenv import load_dotenv

load_dotenv()

# State definition
class AgentState(TypedDict):
    messages: Annotated[List[BaseMessage], lambda x, y: x + y]
    next_step: str

# Initialize LLM
llm = ChatOpenAI(
    base_url=os.getenv("LLM_BASE_URL", "http://localhost:11434/v1"),
    api_key=os.getenv("LLM_API_KEY", "ollama"),
    model=os.getenv("LLM_MODEL_NAME", "mistral"),
)

def assistant(state: AgentState):
    """Main assistant node that decides what to do."""
    messages = state["messages"]
    # Add system message if it's the first turn
    if not any(isinstance(m, SystemMessage) for m in messages):
        system_prompt = SystemMessage(content="""
        You are Synapse, the Workplace AI Assistant for HR, IT, Admin, and Org-level queries.
        You help employees with:
        - HR: Leaves, Payroll, Policies, Benefits.
        - IT: Tool Access, Reset VPN, Software installs.
        - Admin: Document requests, Forms, Meeting rooms.
        - Org: Announcements, Org chart, Holidays.
        
        Keep your answers concise, professional, and helpful. 
        If you don't know the answer, suggest escalating to the respective department.
        """)
        messages = [system_prompt] + messages
    
    response = llm.invoke(messages)
    return {"messages": [response]}

# Build the graph
workflow = StateGraph(AgentState)

workflow.add_node("assistant", assistant)
workflow.set_entry_point("assistant")
workflow.add_edge("assistant", END)

# Compile
app_agent = workflow.compile()
