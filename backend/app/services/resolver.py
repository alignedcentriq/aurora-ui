"""Backward-compatibility re-export shim.

Resolver, Decision, RouteContext now live in app.orchestration.resolver (ARB #23).
Import from there in new code; this shim keeps existing imports working.
"""
from app.orchestration.resolver import Decision, Resolver, RouteContext, Strategy  # noqa: F401

__all__ = ["Decision", "Resolver", "RouteContext", "Strategy"]
