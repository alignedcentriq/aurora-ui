"""Orchestration layer — canonical home for the routing brain.

Structure (strangler migration from agent.py, ARB items #23-#25):
  state.py      — AgentState TypedDict (single source of truth)
  resolver.py   — Resolver, Decision, RouteContext (moved from services/resolver.py)
  strategies.py — registered routing strategies for ROUTER_RESOLVER and MAIN_RESOLVER
  pipeline.py   — shared pre/post-hook agent pipeline (Phase 3 Abstraction C)
"""
from app.orchestration.state import AgentState
from app.orchestration.resolver import Resolver, Decision, RouteContext

__all__ = ["AgentState", "Resolver", "Decision", "RouteContext"]
