"""Domain tool modules — canonical home for LangChain @tool definitions (ARB #23).

Migration from app.agent (strangler pattern):
  hr.py       — HR tools (leave, policy, attendance, employee search …)
  it.py       — IT tools (ticket, software install, wifi, VPN …)
  admin.py    — Admin tools (travel, parking, facilities …)
  pmo.py      — PMO tools (project IQ, resource matching, Udemy …)
  ms365.py    — MS365 tools (email, calendar, Teams …)
  analytics.py — Analytics builder tools
  common.py   — Cross-domain helpers (search_policies, find_apps …)

Status: package scaffold in place (ARB #23).  Tools live in app.agent today;
each module below will be populated as the strangler migration progresses.
"""
