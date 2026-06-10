"""Verify sub-intent tool groups + live latency comparison: 38-tool vs trimmed binding."""
import sys, os, time
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.agent import _hr_tools_for, hr_tools

for s in ["policy_query", "employee_search", "apply_leave", "timesheet", "grievance", "", "totally_unknown"]:
    names = [t.name for t in _hr_tools_for(s)]
    print(f"{s or '(empty)':24s} {len(names)} tools -> {names}")
print("full hr_tools list still:", len(hr_tools))

# Live latency: same realistic prompt, full vs trimmed binding on llama3.1:8b
from langchain_core.messages import HumanMessage, SystemMessage
from app.services import llm_controls_service as llm_controls

sys_prompt = "You are Centriq HR Assistant. " + ("Policy context line about leave entitlements and process. " * 150)
q = "What is the leave policy? Summarize the key points."

for label, tools in [("38 tools", hr_tools), ("trimmed (policy_query)", _hr_tools_for("policy_query"))]:
    llm = llm_controls.get_llm("agent", default_timeout=45).bind_tools(tools)
    t0 = time.time()
    resp = llm.invoke([SystemMessage(content=sys_prompt), HumanMessage(content=q)])
    dt = time.time() - t0
    tc = getattr(resp, "tool_calls", None)
    print(f"{label:24s} {dt:5.1f}s  tools_called={[t['name'] for t in tc] if tc else None}")
