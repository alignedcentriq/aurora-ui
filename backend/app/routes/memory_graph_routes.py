"""Memory Graph — the app's "brain" as a node-link graph.

ONE aggregation endpoint that assembles everything Centriq knows and everything it
has learned from chat into a single node-link structure the frontend renders as a
glowing neuron brain. No new data is produced here — it's a read-only view over the
learning flywheel that already exists (capabilities, policies, curated answers,
router examples, apps/forms, per-user memory, and lessons from feedback).

Free by construction: all local Postgres, zero LLM/external calls. PII in free-text
leaves (user facts, feedback) is redacted with the same masker the observability
reveal path uses.
"""

import logging
from collections import Counter

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.auth import CurrentUser, get_current_user
from app.database import get_db
from app.models import (
    AppLink,
    CachedAnswer,
    ChatFeedback,
    FormTemplate,
    Policy,
    PolicyChunk,
    RouterExample,
    UserMemory,
)
from app.routes.observability_routes import _redact_pii
from app.services import capability_registry

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/memory", tags=["Memory Graph"])

# How many leaf neurons to render per lobe. The brain stays legible and the force
# layout stays smooth; hub labels still carry the true total (e.g. "142").
# ponytail: fixed cap, make it a query param if someone wants to explore deeper.
_LEAF_CAP = 30

_ALLOWED_ROLES = {"super admin"}


def _require_memory_access(user: CurrentUser = Depends(get_current_user)) -> CurrentUser:
    if (user.role or "").strip().lower() not in _ALLOWED_ROLES:
        raise HTTPException(status_code=403, detail="Admin access required.")
    return user


def _snip(text: str | None, n: int = 220) -> str:
    t = (text or "").strip().replace("\n", " ")
    return t[:n] + ("…" if len(t) > n else "")


@router.get("/graph")
def memory_graph(
    db: Session = Depends(get_db),
    _: CurrentUser = Depends(_require_memory_access),
):
    """Assemble the whole-app brain: root → lobes → neuron leaves, with counts."""
    nodes: list[dict] = []
    links: list[dict] = []

    ROOT = "root"
    nodes.append({
        "id": ROOT, "label": "Centriq Mind", "type": "root", "group": "root",
        "val": 26, "detail": "Everything the assistant knows and has learned from chat.",
    })

    def lobe(lid: str, label: str, group: str, count: int, blurb: str):
        nodes.append({
            "id": lid, "label": f"{label}", "type": "lobe", "group": group,
            "val": 14, "count": count, "detail": f"{count} · {blurb}",
        })
        links.append({"source": ROOT, "target": lid})

    def leaf(lid: str, parent: str, label: str, group: str, detail: str):
        nodes.append({
            "id": lid, "label": label, "type": "leaf", "group": group,
            "val": 5, "detail": detail,
        })
        links.append({"source": parent, "target": lid})

    # ── 1. Capabilities — what I can do ────────────────────────────────────────
    caps = capability_registry.all_capabilities()
    lobe("lobe:cap", "Capabilities", "capability", len(caps), "things I can do")
    for c in caps[:_LEAF_CAP]:
        leaf(f"cap:{c.key}", "lobe:cap", c.title, "capability",
             f"{c.description}\n\nCategory: {c.category} · Domain: {c.domain}")

    # ── 2. Knowledge base — policies (RAG) ─────────────────────────────────────
    pol_count = db.query(func.count(Policy.id)).scalar() or 0
    chunk_count = db.query(func.count(PolicyChunk.id)).scalar() or 0
    lobe("lobe:kb", "Knowledge Base", "knowledge", pol_count,
         f"policy docs · {chunk_count} embedded chunks")
    for p in db.query(Policy).order_by(Policy.updated_at.desc()).limit(_LEAF_CAP).all():
        leaf(f"pol:{p.id}", "lobe:kb", _snip(p.title, 60), "knowledge",
             f"{p.title}\n\nCategory: {p.category or '—'}\n\n{_snip(p.content, 400)}")

    # ── 3. Curated answers — learned FAQs ──────────────────────────────────────
    ans_count = db.query(func.count(CachedAnswer.id)).scalar() or 0
    lobe("lobe:ans", "Curated Answers", "curated", ans_count, "cached / seeded answers")
    for a in db.query(CachedAnswer).order_by(CachedAnswer.hit_count.desc()).limit(_LEAF_CAP).all():
        tag = "seed" if a.is_seed else "learned"
        leaf(f"ans:{a.id}", "lobe:ans", _snip(a.query_text, 55), "curated",
             f"Q: {a.query_text}\n\nA: {_snip(a.answer_text, 500)}\n\n"
             f"[{tag} · {a.hit_count} hits · domain: {a.domain or '—'}]")

    # ── 4. Router intelligence — learned routing (by domain) ───────────────────
    rex_count = db.query(func.count(RouterExample.id)).filter(RouterExample.is_active == True).scalar() or 0  # noqa: E712
    lobe("lobe:route", "Router Intelligence", "routing", rex_count, "example phrasings")
    by_domain = (
        db.query(RouterExample.domain, func.count(RouterExample.id))
        .filter(RouterExample.is_active == True)  # noqa: E712
        .group_by(RouterExample.domain)
        .order_by(func.count(RouterExample.id).desc())
        .limit(_LEAF_CAP)
        .all()
    )
    for domain, n in by_domain:
        leaf(f"route:{domain}", "lobe:route", f"{domain or '—'} · {n}", "routing",
             f"{n} learned example phrasings route to the '{domain}' domain.")

    # ── 5. Apps & forms — tools I can point to / open ──────────────────────────
    app_count = db.query(func.count(AppLink.id)).filter(AppLink.is_active == True).scalar() or 0  # noqa: E712
    form_count = db.query(func.count(FormTemplate.id)).filter(FormTemplate.enabled == True).scalar() or 0  # noqa: E712
    lobe("lobe:tools", "Apps & Forms", "tools", app_count + form_count,
         f"{app_count} apps · {form_count} forms")
    for al in db.query(AppLink).filter(AppLink.is_active == True).limit(_LEAF_CAP // 2).all():  # noqa: E712
        leaf(f"app:{al.id}", "lobe:tools", al.name, "tools",
             f"{al.name} (app)\n\n{_snip(al.purpose, 300)}\n\n{al.url}")
    for ft in db.query(FormTemplate).filter(FormTemplate.enabled == True).limit(_LEAF_CAP // 2).all():  # noqa: E712
        leaf(f"form:{ft.id}", "lobe:tools", ft.name, "tools",
             f"{ft.name} (form)\n\n{_snip(ft.description, 300)}")

    # ── 6. User memory — what I remember about people (PII-redacted) ────────────
    mem_count = db.query(func.count(UserMemory.id)).scalar() or 0
    lobe("lobe:mem", "User Memory", "usermem", mem_count, "long-term facts about people")
    for m in db.query(UserMemory).order_by(UserMemory.last_accessed_at.desc()).limit(_LEAF_CAP).all():
        fact = _redact_pii(m.fact) or ""
        leaf(f"mem:{m.id}", "lobe:mem", _snip(fact, 50), "usermem",
             f"{fact}\n\n[domain: {m.domain or '—'}]")

    # ── 7. Lessons from feedback — learned from mistakes ───────────────────────
    # Thumbs-down turns an admin has promoted into a curated answer or routing fix:
    # the flywheel's "we got this wrong, and here's the correction we made" tier.
    lessons_q = (
        db.query(ChatFeedback)
        .filter(ChatFeedback.rating == -1, ChatFeedback.triaged_action.in_(["curated_answer", "routing_fix"]))
        .order_by(ChatFeedback.triaged_at.desc())
    )
    open_misses = db.query(func.count(ChatFeedback.id)).filter(
        ChatFeedback.rating == -1, ChatFeedback.triaged_at.is_(None)
    ).scalar() or 0
    fixed = lessons_q.count()
    lobe("lobe:lessons", "Lessons Learned", "lessons", fixed,
         f"mistakes fixed · {open_misses} open misses")
    for fb in lessons_q.limit(_LEAF_CAP).all():
        msg = _redact_pii(fb.user_message) or ""
        leaf(f"lesson:{fb.id}", "lobe:lessons", _snip(msg, 50), "lessons",
             f"Got wrong: {msg}\n\nFix applied: {fb.triaged_action}\n"
             f"[domain: {fb.domain or '—'}]")

    return {
        "nodes": nodes,
        "links": links,
        "stats": {
            "capabilities": len(caps),
            "policies": pol_count,
            "curated_answers": ans_count,
            "router_examples": rex_count,
            "tools": app_count + form_count,
            "user_memories": mem_count,
            "lessons_learned": fixed,
            "open_misses": open_misses,
        },
    }
