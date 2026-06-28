"""Insight / Event Bus — ARB #48.

Enables cross-domain intelligence by letting skill producers emit typed signals
that cross-domain reactors can respond to.  ARB §12 vision:

    Signal producers (per skill) → Insight Bus → Insight Store
                                        ↓
                  Reactors (rules + LLM) → proposed actions (via action registry)
                                        ↓
                  Surfaced in nudge feed / workspace — with human gate

Design principles:
  1. ALWAYS propose, NEVER auto-execute cross-domain actions.  Every reaction
     creates a nudge or a pending_action that requires human confirmation.
  2. Signals are typed (DeliveryRiskSignal, SkillGapSignal, …) — not free-form
     dicts — so reactors can be statically validated.
  3. Start narrow: ONE chain implemented (delivery-risk → training rec, ARB #48).
     The bus is the scaffold; add more chains by registering new reactors.
  4. Fail-soft: a reactor that raises is logged and skipped.  The bus never
     breaks the producer.

Usage (producer side)::

    from app.services.insight_bus import InsightBus, DeliveryRiskSignal
    InsightBus.emit(DeliveryRiskSignal(
        project_name="Atlas",
        risk_level="high",
        missing_skills=["React", "TypeScript"],
        team_emails=["alice@co.com"],
    ))

Usage (consumer / nudge side)::

    from app.services.insight_bus import InsightBus
    nudges = InsightBus.flush_pending_nudges(user_email="manager@co.com")
"""
from __future__ import annotations

import datetime
import json
import logging
from dataclasses import asdict, dataclass, field
from typing import Any, Callable, Optional

log = logging.getLogger("aurora-logger")


# ── Signal types ──────────────────────────────────────────────────────────────

@dataclass
class InsightSignal:
    """Base class for all signals.  Sub-class to add domain-specific fields."""
    signal_type: str = field(default="generic", init=False)
    emitted_at: str = field(default_factory=lambda: datetime.datetime.utcnow().isoformat())
    source_domain: str = ""           # which skill/domain produced this
    context: dict = field(default_factory=dict)  # free-form for reactors that need extra data


@dataclass
class DeliveryRiskSignal(InsightSignal):
    """Emitted when Project IQ detects a delivery risk on an active project."""
    project_name: str = ""
    risk_level: str = "medium"        # "low" | "medium" | "high" | "critical"
    risk_reasons: list[str] = field(default_factory=list)   # e.g. ["over budget", "key person risk"]
    missing_skills: list[str] = field(default_factory=list) # skills the team lacks
    team_emails: list[str] = field(default_factory=list)    # affected team members

    def __post_init__(self):
        self.signal_type = "delivery_risk"
        self.source_domain = "project_iq"


@dataclass
class SkillGapSignal(InsightSignal):
    """Emitted when Skill Supply detects a gap between demand and internal capacity."""
    skill: str = ""
    gap_count: int = 0                # #people needed − #people available
    recommended_action: str = "train" # "train" | "hire" | "redeploy"
    candidate_emails: list[str] = field(default_factory=list)

    def __post_init__(self):
        self.signal_type = "skill_gap"
        self.source_domain = "skill_supply"


@dataclass
class AttritionRiskSignal(InsightSignal):
    """Emitted when workforce analytics detects an LWD-set employee on a critical project."""
    employee_email: str = ""
    employee_name: str = ""
    last_working_day: str = ""        # ISO date
    critical_projects: list[str] = field(default_factory=list)

    def __post_init__(self):
        self.signal_type = "attrition_risk"
        self.source_domain = "workforce"


# ── Reactor protocol ──────────────────────────────────────────────────────────

# A reactor is a callable: (signal) → list of NudgeItem dicts (or [])
Reactor = Callable[[InsightSignal], list[dict]]


# ── Built-in reactors ─────────────────────────────────────────────────────────

def _delivery_risk_to_training(signal: InsightSignal) -> list[dict]:
    """Delivery-risk → training recommendation chain (ARB #48, first chain).

    When a project is at risk because of missing skills, propose targeted training
    for the affected team members as a human-gated nudge.  Does NOT auto-enroll.
    """
    if not isinstance(signal, DeliveryRiskSignal):
        return []
    if not signal.missing_skills:
        return []

    nudges = []
    for skill in signal.missing_skills:
        for email in signal.team_emails:
            nudges.append({
                "type": "training_recommendation",
                "target_email": email,
                "priority": "high" if signal.risk_level in ("high", "critical") else "medium",
                "title": f"Upskilling opportunity: {skill}",
                "body": (
                    f"Project **{signal.project_name}** has a delivery risk. "
                    f"Your team is missing **{skill}** expertise. "
                    f"Would you like to find a training course for this skill?"
                ),
                "action_hint": "search_training",
                "action_payload": {"skill": skill, "project": signal.project_name},
                "source_signal": "delivery_risk",
                "human_gate": True,   # always require human confirmation
            })

    return nudges


def _skill_gap_to_training(signal: InsightSignal) -> list[dict]:
    """Skill-gap → training or hiring nudge."""
    if not isinstance(signal, SkillGapSignal):
        return []
    action = signal.recommended_action
    nudges = []
    for email in signal.candidate_emails:
        nudges.append({
            "type": "skill_gap_nudge",
            "target_email": email,
            "priority": "medium",
            "title": f"Skill gap alert: {signal.skill}",
            "body": (
                f"There is a gap of **{signal.gap_count}** person(s) with **{signal.skill}** "
                f"skills. Recommended action: **{action}**."
            ),
            "action_hint": action,
            "action_payload": {"skill": signal.skill},
            "source_signal": "skill_gap",
            "human_gate": True,
        })
    return nudges


def _attrition_risk_nudge(signal: InsightSignal) -> list[dict]:
    """Attrition risk → manager notification nudge."""
    if not isinstance(signal, AttritionRiskSignal):
        return []
    return [{
        "type": "attrition_risk_nudge",
        "target_email": "manager",   # resolved at surface time
        "priority": "high",
        "title": f"Attrition risk: {signal.employee_name}",
        "body": (
            f"**{signal.employee_name}** has Last Working Day set to "
            f"{signal.last_working_day}. They are on critical project(s): "
            f"{', '.join(signal.critical_projects)}. Consider succession planning."
        ),
        "action_hint": "plan_succession",
        "action_payload": {
            "employee_email": signal.employee_email,
            "projects": signal.critical_projects,
        },
        "source_signal": "attrition_risk",
        "human_gate": True,
    }]


# ── Bus ───────────────────────────────────────────────────────────────────────

class _InsightBus:
    """In-process event bus with durable signal persistence.

    Signals are persisted to the DB (InsightSignalLog table) so they survive
    restarts and can be audited.  Reactors run synchronously on emit() — for
    heavy reactors, move to a background task.

    For multi-worker deployments: each worker has its own in-process bus;
    signals emitted in one worker are NOT seen by another.  The DB is the
    shared substrate — future enhancement: poll DB for unseen signals on startup.
    """

    def __init__(self) -> None:
        self._reactors: list[tuple[str, Reactor]] = []
        self._pending_nudges: list[dict] = []   # in-process buffer for test / fast access

    def register_reactor(self, name: str, fn: Reactor) -> Reactor:
        self._reactors.append((name, fn))
        return fn

    def emit(self, signal: InsightSignal) -> list[dict]:
        """Emit a signal, run all reactors, persist the signal + nudges, return nudges."""
        # Persist signal to DB (best-effort)
        self._persist_signal(signal)

        all_nudges: list[dict] = []
        for name, reactor in self._reactors:
            try:
                nudges = reactor(signal)
                all_nudges.extend(nudges or [])
            except Exception:
                log.exception("insight_bus: reactor %r raised; skipping", name)

        # Persist nudges + buffer them for flush
        for nudge in all_nudges:
            self._pending_nudges.append(nudge)
            self._persist_nudge(nudge, signal)

        return all_nudges

    def flush_pending_nudges(self, user_email: Optional[str] = None) -> list[dict]:
        """Return (and clear) pending nudges for this worker.  Optionally filter by email."""
        if user_email:
            result = [n for n in self._pending_nudges
                      if n.get("target_email") in (user_email, "manager", None)]
        else:
            result = list(self._pending_nudges)
        self._pending_nudges.clear()
        return result

    def _persist_signal(self, signal: InsightSignal) -> None:
        try:
            from app.database import SessionLocal
            db = SessionLocal()
            try:
                from sqlalchemy import text as _sql
                db.execute(_sql(
                    "INSERT INTO insight_signal_log (signal_type, source_domain, payload, emitted_at) "
                    "VALUES (:stype, :domain, :payload, :emitted_at) "
                    "ON CONFLICT DO NOTHING"
                ), {
                    "stype": signal.signal_type,
                    "domain": signal.source_domain,
                    "payload": json.dumps(asdict(signal), default=str),
                    "emitted_at": signal.emitted_at,
                })
                db.commit()
            except Exception:
                db.rollback()
                # Table may not exist yet — schema migration pending (Alembic ARB #13)
                log.debug("insight_bus: signal persist failed (table may be missing)")
            finally:
                db.close()
        except Exception:
            pass

    def _persist_nudge(self, nudge: dict, signal: InsightSignal) -> None:
        try:
            from app.database import SessionLocal
            from app.models import Nudge
            db = SessionLocal()
            try:
                target = nudge.get("target_email") or ""
                db.add(Nudge(
                    user_email=target if "@" in target else None,
                    nudge_type=nudge.get("type", "insight"),
                    title=nudge.get("title", ""),
                    body=nudge.get("body", ""),
                    priority=nudge.get("priority", "medium"),
                    action_hint=nudge.get("action_hint"),
                    action_payload=nudge.get("action_payload") or {},
                    source=nudge.get("source_signal", "insight_bus"),
                    requires_confirmation=nudge.get("human_gate", True),
                ))
                db.commit()
            except Exception:
                db.rollback()
                log.debug("insight_bus: nudge persist failed (Nudge model may be missing fields)")
            finally:
                db.close()
        except Exception:
            pass


# ── Singleton + reactor registration ─────────────────────────────────────────

InsightBus = _InsightBus()
InsightBus.register_reactor("delivery_risk_to_training", _delivery_risk_to_training)
InsightBus.register_reactor("skill_gap_to_training",    _skill_gap_to_training)
InsightBus.register_reactor("attrition_risk_nudge",     _attrition_risk_nudge)
