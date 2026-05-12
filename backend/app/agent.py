import os
import re
from typing import TypedDict, Annotated, List
from langgraph.graph import StateGraph, END
from langchain_openai import ChatOpenAI
from langchain_core.messages import BaseMessage, HumanMessage, AIMessage, SystemMessage
from dotenv import load_dotenv
from app.agents.stub_router import route_to_domain, select_model
from app.agents.pmo_agent import pmo_agent

_DOWNLOAD_TAG = re.compile(r'\[DOWNLOAD_PDF:[^\]]+\]')

load_dotenv()

GENERAL_SYSTEM_PROMPT = """You are Centriq, the Workplace AI Assistant for Aligned Automation.
You help employees with:
- HR: Leaves, Payroll, Policies, Benefits
- IT: Tool Access, VPN, Software installs
- Admin: Document requests, Forms, Meeting rooms
- Org: Announcements, Org chart, Holidays

Keep answers concise, professional, and helpful.
If you don't know the answer, suggest escalating to the relevant department.
"""

# Cached LLM instances — one per model name, created on first use.
_llm_cache: dict[str, ChatOpenAI] = {}


def _get_llm(model_name: str) -> ChatOpenAI:
    if model_name not in _llm_cache:
        _llm_cache[model_name] = ChatOpenAI(
            base_url=os.getenv("LLM_BASE_URL", "http://localhost:11434/v1"),
            api_key=os.getenv("LLM_API_KEY", "ollama"),
            model=model_name,
        )
    return _llm_cache[model_name]


class AgentState(TypedDict):
    messages: Annotated[List[BaseMessage], lambda x, y: x + y]


def decide_domain(state: AgentState) -> str:
    """Domain routing — replace route_to_domain() with Shivani's classifier when merging."""
    last_user_msg = next(
        (m.content for m in reversed(state["messages"]) if isinstance(m, HumanMessage)),
        "",
    )
    return route_to_domain(last_user_msg)


async def pmo_handler(state: AgentState):
    result = await pmo_agent.ainvoke({"messages": state["messages"]})
    last_ai = next(
        (m for m in reversed(result["messages"]) if isinstance(m, AIMessage)),
        AIMessage(content="I couldn't process your PMO request. Please try again."),
    )

    # The ToolMessage containing [DOWNLOAD_PDF:...] lives inside the pmo subgraph
    # and never reaches the outer graph. Find it here and ensure it's on the
    # final AIMessage so main.py's scanner can pick it up.
    if not _DOWNLOAD_TAG.search(last_ai.content):
        for msg in result["messages"]:
            content = getattr(msg, "content", "")
            if isinstance(content, str):
                m = _DOWNLOAD_TAG.search(content)
                if m:
                    last_ai = AIMessage(content=last_ai.content + f"\n\n{m.group(0)}")
                    break

    return {"messages": [last_ai]}


def general_assistant(state: AgentState):
    messages = state["messages"]

    last_user_msg = next(
        (m.content for m in reversed(messages) if isinstance(m, HumanMessage)), ""
    )
    model_name = select_model(last_user_msg)
    print(f"[Model Router] '{last_user_msg[:60]}' → {model_name}")

    if not any(isinstance(m, SystemMessage) for m in messages):
        messages = [SystemMessage(content=GENERAL_SYSTEM_PROMPT)] + messages

    try:
        response = _get_llm(model_name).invoke(messages)
        return {"messages": [response]}
    except Exception as e:
        print(f"LLM error ({model_name}): {e}")
        fallback = AIMessage(
            content="I'm having trouble connecting. Please make sure **Ollama** is running or check your connection."
        )
        return {"messages": [fallback]}


def route_node(_state: AgentState):
    return {}


workflow = StateGraph(AgentState)
workflow.add_node("route", route_node)
workflow.add_node("pmo", pmo_handler)
workflow.add_node("general", general_assistant)
workflow.set_entry_point("route")
workflow.add_conditional_edges(
    "route",
    decide_domain,
    {"pmo": "pmo", "general": "general"},
)
workflow.add_edge("pmo", END)
workflow.add_edge("general", END)

app_agent = workflow.compile()
