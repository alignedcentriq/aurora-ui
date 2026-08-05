"""Memory Graph — the app's "brain" as a node-link graph.

ONE aggregation endpoint that assembles everything Centriq knows and everything it
has learned from chat into a single node-link structure the frontend renders as a
glowing neuron brain. No new data is produced here — it's a read-only view over the
learning flywheel that already exists (capabilities, policies, curated answers,
router examples, apps/forms, per-user memory, lessons from feedback, insight-bus
signals, feature adoption, and Project IQ's extracted project DNA).

Free by construction: all local Postgres, zero LLM/external calls. PII in free-text
leaves (user facts, feedback) is redacted with the same masker the observability
reveal path uses.
"""

import logging
from collections import Counter
from typing import Optional

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
    InsightSignalLog,
    Policy,
    PolicyChunk,
    ProjectExpertise,
    ProjectLesson,
    ProjectProfile,
    ProjectReusableAsset,
    RouterExample,
    UserMemory,
)
from app.routes.observability_routes import _redact_pii
from app.services import capability_registry
from app.services.adoption_service import feature_adoption

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/memory", tags=["Memory Graph"])

# How many leaf neurons to render per lobe. The brain stays legible and the force
# layout stays smooth; hub labels still carry the true total (e.g. "142").
# ponytail: fixed cap, make it a query param if someone wants to explore deeper.
_LEAF_CAP = 30
# Project IQ facts (lessons/assets/experts) fan out one level deeper than other
# lobes since they're already relational. Cap per-category-per-profile and only
# expand the most-recent profiles so the brain doesn't get a 300-node tumor.
_TWIG_CAP = 3
_TWIG_PROFILE_CAP = 10

_ALLOWED_ROLES = {"super admin"}


def _require_memory_access(user: CurrentUser = Depends(get_current_user)) -> CurrentUser:
    if (user.role or "").strip().lower() not in _ALLOWED_ROLES:
        raise HTTPException(status_code=403, detail="Admin access required.")
    return user


def _snip(text: str | None, n: int = 220) -> str:
    t = (text or "").strip().replace("\n", " ")
    return t[:n] + ("…" if len(t) > n else "")


def _iso(dt) -> Optional[str]:
    return dt.isoformat() if dt else None


def _norm(s: Optional[str]) -> str:
    return (s or "").strip().lower()


@router.get("/graph")
def memory_graph(
    db: Session = Depends(get_db),
    _: CurrentUser = Depends(_require_memory_access),
):
    """Assemble the whole-app brain: root → lobes → neuron leaves, with counts."""
    nodes: list[dict] = []
    links: list[dict] = []
    # Cross-lobe links (Lesson->Answer, capability usage, insight->project) — rendered
    # by the frontend as curved arcs distinct from the parent->child lobe links above.
    cross_links: list[dict] = []

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

    def leaf(lid: str, parent: str, label: str, group: str, detail: str,
             ts: Optional[str] = None, deep_link: Optional[dict] = None):
        nodes.append({
            "id": lid, "label": label, "type": "leaf", "group": group,
            "val": 5, "detail": detail, "ts": ts, "deep_link": deep_link,
        })
        links.append({"source": parent, "target": lid})

    all_caps = capability_registry.all_capabilities()

    # ── 1. Capabilities — what I can do ────────────────────────────────────────
    caps = list(all_caps)
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
             f"{p.title}\n\nCategory: {p.category or '—'}\n\n{_snip(p.content, 400)}",
             ts=_iso(p.updated_at))

    # ── 3. Curated answers — learned FAQs ──────────────────────────────────────
    ans_count = db.query(func.count(CachedAnswer.id)).scalar() or 0
    lobe("lobe:ans", "Curated Answers", "curated", ans_count, "cached / seeded answers")
    for a in db.query(CachedAnswer).order_by(CachedAnswer.hit_count.desc()).limit(_LEAF_CAP).all():
        tag = "seed" if a.is_seed else "learned"
        label = capability_registry.short_label(a.domain, a.sub_intent)
        leaf(f"ans:{a.id}", "lobe:ans", label, "curated",
             f"Q: {a.query_text}\n\nA: {_snip(a.answer_text, 500)}\n\n"
             f"[{tag} · {a.hit_count} hits · domain: {a.domain or '—'}]",
             ts=_iso(a.created_at))
        cap_key = capability_registry.capability_for_usage(a.domain, a.sub_intent)
        if cap_key:
            cross_links.append({"source": f"ans:{a.id}", "target": f"fadopt:{cap_key}", "kind": "capability"})

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
        label = capability_registry.short_label(domain)
        leaf(f"route:{domain}", "lobe:route", f"{label} · {n}", "routing",
             f"{n} learned example phrasings route to the '{domain}' domain.")

    # ── 5. Apps & forms — tools I can point to / open ──────────────────────────
    app_count = db.query(func.count(AppLink.id)).filter(AppLink.is_active == True).scalar() or 0  # noqa: E712
    form_count = db.query(func.count(FormTemplate.id)).filter(FormTemplate.enabled == True).scalar() or 0  # noqa: E712
    lobe("lobe:tools", "Apps & Forms", "tools", app_count + form_count,
         f"{app_count} apps · {form_count} forms")
    for al in db.query(AppLink).filter(AppLink.is_active == True).limit(_LEAF_CAP // 2).all():  # noqa: E712
        leaf(f"app:{al.id}", "lobe:tools", al.name, "tools",
             f"{al.name} (app)\n\n{_snip(al.purpose, 300)}\n\n{al.url}",
             ts=_iso(al.updated_at), deep_link={"kind": "external", "url": al.url})
    for ft in db.query(FormTemplate).filter(FormTemplate.enabled == True).limit(_LEAF_CAP // 2).all():  # noqa: E712
        leaf(f"form:{ft.id}", "lobe:tools", ft.name, "tools",
             f"{ft.name} (form)\n\n{_snip(ft.description, 300)}",
             deep_link={"kind": "tab", "tab": "form-library"})

    # ── 6. User memory — what I remember about people (PII-redacted) ────────────
    mem_count = db.query(func.count(UserMemory.id)).scalar() or 0
    lobe("lobe:mem", "User Memory", "usermem", mem_count, "long-term facts about people")
    for m in db.query(UserMemory).order_by(UserMemory.last_accessed_at.desc()).limit(_LEAF_CAP).all():
        fact = _redact_pii(m.fact) or ""
        label = capability_registry.short_label(m.domain)
        leaf(f"mem:{m.id}", "lobe:mem", label, "usermem",
             f"{fact}\n\n[domain: {m.domain or '—'}]", ts=_iso(m.last_accessed_at))
        cap_key = capability_registry.capability_for_usage(m.domain)
        if cap_key:
            cross_links.append({"source": f"mem:{m.id}", "target": f"fadopt:{cap_key}", "kind": "capability"})

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
        label = capability_registry.short_label(fb.domain, fb.sub_intent)
        leaf(f"lesson:{fb.id}", "lobe:lessons", label, "lessons",
             f"Got wrong: {msg}\n\nFix applied: {fb.triaged_action}\n"
             f"[domain: {fb.domain or '—'}]",
             ts=_iso(fb.triaged_at), deep_link={"kind": "tab", "tab": "observability", "sub": "triage"})
        if fb.resulting_answer_id:
            cross_links.append({"source": f"lesson:{fb.id}", "target": f"ans:{fb.resulting_answer_id}",
                                 "kind": "flywheel"})
        else:
            cap_key = capability_registry.capability_for_usage(fb.domain, fb.sub_intent)
            if cap_key:
                cross_links.append({"source": f"lesson:{fb.id}", "target": f"fadopt:{cap_key}",
                                     "kind": "capability"})

    # ── 8. Insight Bus — cross-feature signals the app has noticed ─────────────
    signal_count = db.query(func.count(InsightSignalLog.id)).scalar() or 0
    lobe("lobe:insight", "Insight Bus", "insight", signal_count, "cross-feature signals")
    signals = (db.query(InsightSignalLog).order_by(InsightSignalLog.emitted_at.desc())
               .limit(_LEAF_CAP).all())
    # Delivery-risk signals carry a project_name — link them to the matching Project
    # IQ DNA leaf below (built after we know which project profiles are shown).
    project_name_links: list[tuple[str, str]] = []
    for s in signals:
        payload = s.payload or {}
        label = capability_registry.short_label(s.source_domain)
        project_name = payload.get("project_name")
        summary = payload.get("risk_reasons") or payload.get("skill") or payload.get("employee_name") or ""
        leaf(f"signal:{s.id}", "lobe:insight", label, "insight",
             f"{s.signal_type}\n\nSource: {s.source_domain or '—'}\n\n{_snip(str(summary), 300)}",
             ts=_iso(s.emitted_at))
        if project_name:
            project_name_links.append((f"signal:{s.id}", _norm(project_name)))

    # ── 9. Feature Adoption — which capabilities people actually use ───────────
    adoption = feature_adoption()
    lobe("lobe:fadopt", "Feature Adoption", "fadopt", adoption["feature_count"],
         f"{adoption['undiscovered_count']} never used · {adoption['active_users']} active users")
    for f in adoption["features"][:_LEAF_CAP]:
        leaf(f"fadopt:{f['key']}", "lobe:fadopt", f["category"], "fadopt",
             f"{f['title']}\n\n{f['users']} users · {f['requests']} requests · "
             f"{f['adoption_pct_staff']}% of staff · last used {f['last_used'] or 'never'}",
             ts=f["last_used"], deep_link={"kind": "tab", "tab": "observability", "sub": "adoption"})

    # ── 10. Project IQ DNA — extracted project intelligence ────────────────────
    profile_count = db.query(func.count(ProjectProfile.id)).scalar() or 0
    lobe("lobe:projectiq", "Project IQ DNA", "projectiq", profile_count, "extracted project profiles")
    profiles = (db.query(ProjectProfile).order_by(ProjectProfile.updated_at.desc())
                .limit(_LEAF_CAP).all())
    profile_name_to_leaf: dict[str, str] = {}
    for p in profiles:
        leaf_id = f"proj:{p.id}"
        profile_name_to_leaf[_norm(p.name)] = leaf_id
        leaf(leaf_id, "lobe:projectiq", p.name, "projectiq",
             f"{p.name}\n\n{_snip(p.solution_summary or p.business_problem, 400)}\n\n"
             f"{len(p.lessons)} lessons · {len(p.reusable_assets)} reusable assets · "
             f"{len(p.expertise)} SMEs · confidence: {p.confidence}",
             ts=_iso(p.updated_at), deep_link={"kind": "tab", "tab": "project-iq"})

    for signal_id, project_name in project_name_links:
        target_leaf = profile_name_to_leaf.get(project_name)
        if target_leaf:
            cross_links.append({"source": signal_id, "target": target_leaf, "kind": "project"})

    # ── 10b. Project IQ facts — lessons / assets / experts, one level deeper ───
    # Each fact carries source_chunk_id (the PolicyChunk it was extracted from);
    # resolve chunk_id -> policy_id in one batch query and cross-link the fact
    # back to its source policy leaf (already built in lobe:kb above), so you can
    # see which SharePoint doc a "lesson learned" actually came from.
    twig_profiles = profiles[:_TWIG_PROFILE_CAP]
    twig_profile_ids = [p.id for p in twig_profiles]

    def _fact_rows(model):
        return (
            db.query(model)
            .filter(model.profile_id.in_(twig_profile_ids))
            .all()
            if twig_profile_ids else []
        )

    lessons = _fact_rows(ProjectLesson)
    assets = _fact_rows(ProjectReusableAsset)
    experts = _fact_rows(ProjectExpertise)

    chunk_ids = {f.source_chunk_id for f in (*lessons, *assets, *experts) if f.source_chunk_id}
    chunk_to_policy: dict[int, int] = {}
    if chunk_ids:
        rows = (
            db.query(PolicyChunk.id, PolicyChunk.policy_id)
            .filter(PolicyChunk.id.in_(chunk_ids))
            .all()
        )
        chunk_to_policy = {cid: pid for cid, pid in rows}

    def _fact_twigs(rows, prefix: str, label_fn, detail_fn):
        seen_per_profile: Counter = Counter()
        for f in rows:
            if seen_per_profile[f.profile_id] >= _TWIG_CAP:
                continue
            seen_per_profile[f.profile_id] += 1
            parent = f"proj:{f.profile_id}"
            twig_id = f"{prefix}:{f.id}"
            leaf(twig_id, parent, label_fn(f), "projectiq", detail_fn(f))
            pol_id = chunk_to_policy.get(f.source_chunk_id)
            if pol_id:
                cross_links.append({"source": twig_id, "target": f"pol:{pol_id}", "kind": "provenance"})

    _fact_twigs(
        lessons, "lesson-iq",
        lambda f: _snip(f.lesson, 40),
        lambda f: f"{f.lesson}\n\nCategory: {f.category or '—'} · Impact: {f.impact_level or '—'}\n"
                  f"Recommendation: {_snip(f.recommendation, 200)}\n[confidence: {f.confidence}]",
    )
    _fact_twigs(
        assets, "asset-iq",
        lambda f: f.asset_name,
        lambda f: f"{f.asset_name} ({f.asset_type or '—'})\n\nOwner: {f.owner or '—'} · "
                  f"Reuse: {f.reuse_readiness or '—'}\n[confidence: {f.confidence}]",
    )
    _fact_twigs(
        experts, "expert-iq",
        lambda f: f.person_name,
        lambda f: f"{f.person_name} — {f.role_on_project or 'contributor'}\n\n"
                  f"Capability: {f.capability or '—'}\n[evidence: {f.evidence_level}]",
    )

    return {
        "nodes": nodes,
        "links": links,
        "cross_links": cross_links,
        "stats": {
            "capabilities": len(caps),
            "policies": pol_count,
            "curated_answers": ans_count,
            "router_examples": rex_count,
            "tools": app_count + form_count,
            "user_memories": mem_count,
            "lessons_learned": fixed,
            "open_misses": open_misses,
            "insight_signals": signal_count,
            "feature_adoption": adoption["feature_count"],
            "project_profiles": profile_count,
        },
    }
