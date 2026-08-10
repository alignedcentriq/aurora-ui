"""Memory Vault — the app's whole learning flywheel, exported as an Obsidian vault.

Memory Brain (memory_graph_routes.py) renders the same underlying data as a 3D
node graph, but caps every lobe to ~30 leaves and truncates each leaf's text to
what fits a hover panel (a policy is snipped to 400 chars, a lesson to 200). That's
the right tradeoff for a legible force-directed graph; it's the wrong tradeoff for
actually knowing what the assistant has learned.

This module regenerates a parallel, uncapped view of the same data as real
Obsidian notes: one file per policy/lesson/answer/fact, YAML frontmatter for the
fields that used to be crammed into one opaque string, and wikilinks for what the
graph drew as edges. Obsidian's own backlink panel then does the reverse-lookup
work the graph never did (e.g. "which lessons cite this policy") for free.

Read-only mirror, regenerated wholesale every sync — never hand-edit a note here,
it gets overwritten. See memory_vault_sync_loop(), started from database.py.
"""

import datetime
import logging
import os
import re
import shutil
import time
from typing import Optional

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.config import settings
from app.database import SessionLocal
from app.models import (
    AppLink,
    CachedAnswer,
    ChatFeedback,
    FormTemplate,
    InsightSignalLog,
    Policy,
    PolicyChunk,
    ProjectCapability,
    ProjectExpertise,
    ProjectIntegration,
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

_REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))

# Per-lobe ceiling so one runaway table can't make a sync take minutes or produce
# tens of thousands of files. Not the graph's "30" — this is a safety valve, not a
# cosmetic limit, and every note it triggers on says so explicitly.
_SAFETY_CAP = 3000


def _vault_root() -> str:
    d = settings.MEMORY_VAULT_DIR
    return d if os.path.isabs(d) else os.path.join(_REPO_ROOT, d)


_ILLEGAL = re.compile(r'[\\/:*?"<>|\n\r\t]')


def _slug(text: Optional[str], max_len: int = 70) -> str:
    t = _ILLEGAL.sub("-", (text or "").strip())
    t = re.sub(r"\s+", " ", t).strip(" .-")
    return t[:max_len].strip(" .-") or "untitled"


def _note_name(kind: str, title: Optional[str], uid) -> str:
    return f"{kind} - {_slug(title)} ({uid})"


def _wikilink(name: Optional[str]) -> str:
    return f"[[{name}]]" if name else ""


def _iso(dt) -> Optional[str]:
    return dt.isoformat() if dt else None


def _yaml_scalar(v) -> str:
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, (int, float)):
        return str(v)
    s = str(v).replace("\\", "\\\\").replace('"', '\\"').replace("\n", " ").strip()
    return f'"{s}"'


def _frontmatter(fields: dict) -> str:
    lines = ["---"]
    for k, v in fields.items():
        if v is None or v == "" or v == []:
            continue
        if isinstance(v, (list, tuple)):
            lines.append(f"{k}:")
            for item in v:
                lines.append(f"  - {_yaml_scalar(item)}")
        else:
            lines.append(f"{k}: {_yaml_scalar(v)}")
    lines.append("---\n")
    return "\n".join(lines)


def _related_section(names: list[str]) -> str:
    names = [n for n in names if n]
    if not names:
        return ""
    return "\n## Related\n" + "\n".join(f"- {_wikilink(n)}" for n in names) + "\n"


def _json_list_md(value) -> str:
    if not value:
        return "_none recorded_"
    if isinstance(value, list):
        lines = []
        for item in value:
            if isinstance(item, dict):
                parts = ", ".join(f"**{k}**: {v}" for k, v in item.items() if v not in (None, ""))
                lines.append(f"- {parts}")
            else:
                lines.append(f"- {item}")
        return "\n".join(lines) if lines else "_none recorded_"
    return str(value)


class _Vault:
    """Accumulates notes for one sync pass, tracking id->filename maps for wikilinks."""

    def __init__(self, root: str):
        self.root = root
        self.note_count = 0
        self.lobe_names: list[str] = []
        self.cap_name: dict[str, str] = {}          # capability key -> note name
        self.policy_name: dict[int, str] = {}        # Policy.id -> note name
        self.chunk_to_policy: dict[int, int] = {}     # PolicyChunk.id -> Policy.id
        self.answer_name: dict[int, str] = {}
        self.profile_name: dict[int, str] = {}

    def write(self, subfolder: Optional[str], name: str, frontmatter: dict, body: str) -> str:
        dirpath = os.path.join(self.root, subfolder) if subfolder else self.root
        os.makedirs(dirpath, exist_ok=True)
        path = os.path.join(dirpath, f"{name}.md")
        with open(path, "w", encoding="utf-8") as f:
            f.write(_frontmatter(frontmatter) + "\n" + body.strip() + "\n")
        self.note_count += 1
        return name

    def lobe_index(self, name: str, blurb: str, leaf_names: list[str], stats: dict):
        self.lobe_names.append(name)
        fm = {"type": "lobe", **stats}
        body = f"{blurb}\n" + _related_section(leaf_names)
        self.write(None, name, fm, body)


def _reset_vault_dir(root: str):
    if os.path.isdir(root):
        for entry in os.listdir(root):
            if entry == ".obsidian":
                continue
            p = os.path.join(root, entry)
            shutil.rmtree(p) if os.path.isdir(p) else os.remove(p)
    else:
        os.makedirs(root, exist_ok=True)


def _capped(query, cap: int = _SAFETY_CAP):
    """Returns (rows, total, truncated). `query` must already be ordered."""
    total = query.count()
    rows = query.limit(cap).all()
    return rows, total, total > cap


def _cap_note(total: int, shown: int, truncated: bool) -> dict:
    if not truncated:
        return {}
    return {
        "shown": shown, "of_total": total,
        "note": f"safety cap — showing the {shown} most recent of {total}, not a cosmetic limit",
    }


def _build_capabilities(db: Session, v: _Vault):
    caps = capability_registry.all_capabilities()
    names = []
    for c in caps:
        name = _note_name("Capability", c.title, c.key)
        v.cap_name[c.key] = name
        fm = {
            "type": "capability", "category": c.category, "domain": c.domain,
            "roles": sorted(c.roles) if c.roles else ["everyone"],
        }
        body = (
            f"# {c.title}\n\n{c.description}\n\n"
            f"## Example phrasings\n" + "\n".join(f"- {e}" for e in c.examples) + "\n\n"
            f"## Counts as \"used\" when\n" +
            "\n".join(f"- domain `{d}`, sub_intent `{si}`" for d, si in c.usage)
        )
        v.write("Capabilities", name, fm, body)
        names.append(name)
    v.lobe_index("Capabilities", "Things the assistant can do — the discovery/adoption catalog.",
                  names, {"count": len(caps)})


def _build_knowledge_base(db: Session, v: _Vault):
    pol_count = db.query(func.count(Policy.id)).scalar() or 0
    chunk_count = db.query(func.count(PolicyChunk.id)).scalar() or 0
    rows, total, truncated = _capped(db.query(Policy).order_by(Policy.updated_at.desc()))
    names = []
    for p in rows:
        name = _note_name("Policy", p.title, p.id)
        v.policy_name[p.id] = name
        fm = {"type": "policy", "category": p.category, "updated_at": _iso(p.updated_at),
              "source_key": p.source_key, **_cap_note(total, len(rows), truncated)}
        body = f"# {p.title}\n\n{(p.content or '').strip()}\n"
        v.write("Knowledge Base", name, fm, body)
        names.append(name)
    chunk_rows = db.query(PolicyChunk.id, PolicyChunk.policy_id).all()
    v.chunk_to_policy = {cid: pid for cid, pid in chunk_rows}
    v.lobe_index("Knowledge Base", f"{pol_count} policy docs, {chunk_count} embedded RAG chunks.",
                 names, {"policies": pol_count, "chunks": chunk_count,
                         **_cap_note(total, len(rows), truncated)})


def _build_curated_answers(db: Session, v: _Vault):
    ans_count = db.query(func.count(CachedAnswer.id)).scalar() or 0
    rows, total, truncated = _capped(db.query(CachedAnswer).order_by(CachedAnswer.hit_count.desc()))
    names = []
    for a in rows:
        name = _note_name("Answer", capability_registry.short_label(a.domain, a.sub_intent), a.id)
        v.answer_name[a.id] = name
        cap_key = capability_registry.capability_for_usage(a.domain, a.sub_intent)
        fm = {
            "type": "curated_answer", "tag": "seed" if a.is_seed else "learned",
            "domain": a.domain, "sub_intent": a.sub_intent, "hit_count": a.hit_count,
            "created_at": _iso(a.created_at), **_cap_note(total, len(rows), truncated),
        }
        body = (f"## Q\n{a.query_text}\n\n## A\n{(a.answer_text or '').strip()}\n" +
                _related_section([v.cap_name.get(cap_key)]))
        v.write("Curated Answers", name, fm, body)
        names.append(name)
    v.lobe_index("Curated Answers", f"{ans_count} cached / seeded FAQ answers.",
                 names, {"count": ans_count, **_cap_note(total, len(rows), truncated)})


def _build_router_intelligence(db: Session, v: _Vault):
    total_active = db.query(func.count(RouterExample.id)).filter(
        RouterExample.is_active == True  # noqa: E712
    ).scalar() or 0
    domains = (
        db.query(RouterExample.domain, func.count(RouterExample.id))
        .filter(RouterExample.is_active == True)  # noqa: E712
        .group_by(RouterExample.domain)
        .order_by(func.count(RouterExample.id).desc())
        .all()
    )
    names = []
    for domain, n in domains:
        rows, total, truncated = _capped(
            db.query(RouterExample)
            .filter(RouterExample.is_active == True, RouterExample.domain == domain)  # noqa: E712
            .order_by(RouterExample.created_at.desc())
        )
        label = capability_registry.short_label(domain)
        name = _note_name("Route", f"{label} ({domain})", domain or "none")
        fm = {"type": "router_domain", "domain": domain, "example_count": n,
              **_cap_note(total, len(rows), truncated)}
        body = (f"# {label}\n\n{n} learned example phrasings route to the `{domain}` domain.\n\n"
                "## Utterances\n" + "\n".join(f"- {r.utterance}" for r in rows))
        v.write("Router Intelligence", name, fm, body)
        names.append(name)
    v.lobe_index("Router Intelligence", f"{total_active} learned example phrasings across "
                 f"{len(domains)} domains.", names, {"example_count": total_active, "domains": len(domains)})


def _build_tools(db: Session, v: _Vault):
    apps = db.query(AppLink).filter(AppLink.is_active == True).all()  # noqa: E712
    forms = db.query(FormTemplate).filter(FormTemplate.enabled == True).all()  # noqa: E712
    names = []
    for al in apps:
        name = _note_name("App", al.name, al.id)
        fm = {"type": "app", "url": al.url, "updated_at": _iso(al.updated_at)}
        body = f"# {al.name}\n\n{(al.purpose or '').strip()}\n\n{al.url}\n"
        v.write("Apps & Forms", name, fm, body)
        names.append(name)
    for ft in forms:
        name = _note_name("Form", ft.name, ft.id)
        fm = {"type": "form", "category": ft.category}
        body = f"# {ft.name}\n\n{(ft.description or '').strip()}\n"
        v.write("Apps & Forms", name, fm, body)
        names.append(name)
    v.lobe_index("Apps & Forms", f"{len(apps)} apps, {len(forms)} forms.",
                 names, {"apps": len(apps), "forms": len(forms)})


def _build_user_memory(db: Session, v: _Vault):
    mem_count = db.query(func.count(UserMemory.id)).scalar() or 0
    rows, total, truncated = _capped(db.query(UserMemory).order_by(UserMemory.last_accessed_at.desc()))
    names = []
    for m in rows:
        fact = _redact_pii(m.fact) or ""
        label = capability_registry.short_label(m.domain)
        name = _note_name("Memory", label, m.id)
        cap_key = capability_registry.capability_for_usage(m.domain)
        fm = {"type": "user_memory", "domain": m.domain, "last_accessed_at": _iso(m.last_accessed_at),
              **_cap_note(total, len(rows), truncated)}
        body = fact + "\n" + _related_section([v.cap_name.get(cap_key)])
        v.write("User Memory", name, fm, body)
        names.append(name)
    v.lobe_index("User Memory", f"{mem_count} long-term facts remembered about people (PII-redacted).",
                 names, {"count": mem_count, **_cap_note(total, len(rows), truncated)})


def _build_lessons_learned(db: Session, v: _Vault):
    fixed_q = (
        db.query(ChatFeedback)
        .filter(ChatFeedback.rating == -1, ChatFeedback.triaged_action.in_(["curated_answer", "routing_fix"]))
        .order_by(ChatFeedback.triaged_at.desc())
    )
    fixed_rows, fixed_total, fixed_truncated = _capped(fixed_q)
    open_q = (
        db.query(ChatFeedback)
        .filter(ChatFeedback.rating == -1, ChatFeedback.triaged_at.is_(None))
        .order_by(ChatFeedback.created_at.desc())
    )
    open_rows, open_total, open_truncated = _capped(open_q)

    names = []
    for fb in fixed_rows:
        msg = _redact_pii(fb.user_message) or ""
        label = capability_registry.short_label(fb.domain, fb.sub_intent)
        name = _note_name("Lesson", label, fb.id)
        related = [v.answer_name.get(fb.resulting_answer_id)] if fb.resulting_answer_id else \
            [v.cap_name.get(capability_registry.capability_for_usage(fb.domain, fb.sub_intent))]
        fm = {"type": "lesson_fixed", "domain": fb.domain, "sub_intent": fb.sub_intent,
              "triaged_action": fb.triaged_action, "triaged_by": fb.triaged_by,
              "triaged_at": _iso(fb.triaged_at)}
        body = f"**Got wrong:** {msg}\n\n**Fix applied:** {fb.triaged_action}\n" + _related_section(related)
        v.write("Lessons Learned", name, fm, body)
        names.append(name)

    open_names = []
    for fb in open_rows:
        msg = _redact_pii(fb.user_message) or ""
        label = capability_registry.short_label(fb.domain, fb.sub_intent)
        name = _note_name("Open miss", label, fb.id)
        fm = {"type": "lesson_open_miss", "domain": fb.domain, "sub_intent": fb.sub_intent,
              "created_at": _iso(fb.created_at)}
        v.write("Lessons Learned/Open misses", name, fm, f"**Got wrong, not yet triaged:** {msg}\n")
        open_names.append(name)

    v.lobe_index(
        "Lessons Learned",
        f"{fixed_total} mistakes fixed, {open_total} open misses awaiting triage.",
        names + open_names,
        {"fixed": fixed_total, "open_misses": open_total,
         **_cap_note(fixed_total, len(fixed_rows), fixed_truncated),
         **_cap_note(open_total, len(open_rows), open_truncated)},
    )


def _build_insight_bus(db: Session, v: _Vault, project_name_to_leaf: dict[str, str]):
    signal_count = db.query(func.count(InsightSignalLog.id)).scalar() or 0
    rows, total, truncated = _capped(db.query(InsightSignalLog).order_by(InsightSignalLog.emitted_at.desc()))
    names = []
    for s in rows:
        payload = s.payload or {}
        label = capability_registry.short_label(s.source_domain)
        name = _note_name("Signal", f"{label} - {s.signal_type}", s.id)
        project_name = (payload.get("project_name") or "").strip().lower()
        related = [project_name_to_leaf.get(project_name)] if project_name else []
        fm = {"type": "insight_signal", "signal_type": s.signal_type, "source_domain": s.source_domain,
              "emitted_at": _iso(s.emitted_at), **_cap_note(total, len(rows), truncated)}
        body = (f"# {s.signal_type}\n\nSource: {s.source_domain or '—'}\n\n"
                "## Payload\n" + _json_list_md([f"{k}: {v}" for k, v in payload.items()]) +
                "\n" + _related_section(related))
        v.write("Insight Bus", name, fm, body)
        names.append(name)
    v.lobe_index("Insight Bus", f"{signal_count} cross-feature signals noticed.",
                 names, {"count": signal_count, **_cap_note(total, len(rows), truncated)})


def _build_feature_adoption(db: Session, v: _Vault):
    adoption = feature_adoption()
    names = []
    for f in adoption["features"]:
        name = _note_name("Adoption", f["title"], f["key"])
        fm = {
            "type": "feature_adoption", "category": f["category"], "domain": f["domain"],
            "users": f["users"], "requests": f["requests"],
            "adoption_pct_staff": f["adoption_pct_staff"], "adoption_pct_active": f["adoption_pct_active"],
            "never_used_staff": f["never_used_staff"], "last_used": f["last_used"],
        }
        body = (f"# {f['title']}\n\n{f['users']} users · {f['requests']} requests · "
                f"{f['adoption_pct_staff']}% of staff · last used {f['last_used'] or 'never'}\n" +
                _related_section([v.cap_name.get(f["key"])]))
        v.write("Feature Adoption", name, fm, body)
        names.append(name)
    v.lobe_index(
        "Feature Adoption",
        f"{adoption['feature_count']} capabilities tracked · {adoption['undiscovered_count']} never used · "
        f"{adoption['active_users']} active users (last {adoption['window_days']} days).",
        names, {"feature_count": adoption["feature_count"], "undiscovered_count": adoption["undiscovered_count"],
                "active_users": adoption["active_users"]},
    )


def _build_project_iq(db: Session, v: _Vault):
    profile_count = db.query(func.count(ProjectProfile.id)).scalar() or 0
    profiles = db.query(ProjectProfile).order_by(ProjectProfile.updated_at.desc()).all()
    profile_ids = [p.id for p in profiles]
    project_name_to_leaf: dict[str, str] = {}
    names = []

    def _fact_rows(model):
        return db.query(model).filter(model.profile_id.in_(profile_ids)).all() if profile_ids else []

    lessons, assets, experts = _fact_rows(ProjectLesson), _fact_rows(ProjectReusableAsset), _fact_rows(ProjectExpertise)
    caps, integrations = _fact_rows(ProjectCapability), _fact_rows(ProjectIntegration)
    by_profile: dict[int, dict[str, list]] = {p.id: {"lessons": [], "assets": [], "experts": [],
                                                       "caps": [], "integrations": []} for p in profiles}
    for l in lessons:
        by_profile[l.profile_id]["lessons"].append(l)
    for a in assets:
        by_profile[a.profile_id]["assets"].append(a)
    for e in experts:
        by_profile[e.profile_id]["experts"].append(e)
    for c in caps:
        by_profile[c.profile_id]["caps"].append(c)
    for i in integrations:
        by_profile[i.profile_id]["integrations"].append(i)

    def _prov(source_chunk_id) -> list[str]:
        pol_id = v.chunk_to_policy.get(source_chunk_id) if source_chunk_id else None
        return [v.policy_name.get(pol_id)] if pol_id else []

    for p in profiles:
        pname = _note_name("Project", p.name, p.id)
        v.profile_name[p.id] = pname
        project_name_to_leaf[(p.name or "").strip().lower()] = pname
        facts = by_profile[p.id]

        fact_names: list[str] = []
        for l in facts["lessons"]:
            fname = _note_name("Lesson-IQ", l.lesson[:60], l.id)
            fm = {"type": "project_lesson", "category": l.category, "impact_level": l.impact_level,
                  "confidence": l.confidence, "profile": pname}
            body = (f"{l.lesson}\n\n**Recommendation:** {l.recommendation or '—'}\n\n"
                    f"**Evidence:** {l.evidence or '—'}\n" + _related_section([pname] + _prov(l.source_chunk_id)))
            v.write(f"Project IQ DNA/{_slug(p.name)}/Lessons", fname, fm, body)
            fact_names.append(fname)
        for a in facts["assets"]:
            fname = _note_name("Asset-IQ", a.asset_name, a.id)
            fm = {"type": "project_asset", "asset_type": a.asset_type, "owner": a.owner,
                  "reuse_readiness": a.reuse_readiness, "confidence": a.confidence, "profile": pname}
            body = (f"# {a.asset_name}\n\nType: {a.asset_type or '—'} · Owner: {a.owner or '—'}\n\n"
                    f"Repository: {a.repository_url or '—'}\n\nDocs: {a.documentation_url or '—'}\n" +
                    _related_section([pname] + _prov(a.source_chunk_id)))
            v.write(f"Project IQ DNA/{_slug(p.name)}/Reusable Assets", fname, fm, body)
            fact_names.append(fname)
        for e in facts["experts"]:
            fname = _note_name("Expert-IQ", e.person_name, e.id)
            fm = {"type": "project_expertise", "role_on_project": e.role_on_project,
                  "capability": e.capability, "evidence_level": e.evidence_level, "profile": pname}
            body = (f"# {e.person_name}\n\n{e.role_on_project or 'Contributor'}\n\n"
                    f"Capability: {e.capability or '—'}\n" + _related_section([pname] + _prov(e.source_chunk_id)))
            v.write(f"Project IQ DNA/{_slug(p.name)}/Experts", fname, fm, body)
            fact_names.append(fname)
        for c in facts["caps"]:
            fname = _note_name("Capability-IQ", c.capability_name, c.id)
            fm = {"type": "project_capability", "category": c.category, "maturity_level": c.maturity_level,
                  "confidence": c.confidence, "profile": pname}
            body = (f"# {c.capability_name}\n\nCategory: {c.category or '—'} · Maturity: {c.maturity_level or '—'}"
                    f"\n\n{c.evidence or ''}\n" + _related_section([pname] + _prov(c.source_chunk_id)))
            v.write(f"Project IQ DNA/{_slug(p.name)}/Capabilities", fname, fm, body)
            fact_names.append(fname)
        for i in facts["integrations"]:
            fname = _note_name("Integration-IQ", i.system_name, i.id)
            fm = {"type": "project_integration", "integration_type": i.integration_type,
                  "complexity_level": i.complexity_level, "confidence": i.confidence, "profile": pname}
            body = (f"# {i.system_name}\n\nType: {i.integration_type or '—'} · "
                    f"Complexity: {i.complexity_level or '—'}\n\n**Lessons:** {i.lessons_learned or '—'}\n" +
                    _related_section([pname] + _prov(i.source_chunk_id)))
            v.write(f"Project IQ DNA/{_slug(p.name)}/Integrations", fname, fm, body)
            fact_names.append(fname)

        fm = {
            "type": "project_profile", "client_industry": p.client_industry, "status": p.status,
            "confidence": p.confidence, "review_status": p.review_status, "project_size": p.project_size,
            "team_size": p.team_size, "delivery_start_date": p.delivery_start_date,
            "delivery_end_date": p.delivery_end_date, "source_doc_count": p.source_doc_count,
            "query_count": p.query_count, "last_queried_at": _iso(p.last_queried_at),
            "updated_at": _iso(p.updated_at),
        }
        body = (
            f"# {p.name}\n\n"
            f"## Business problem\n{p.business_problem or '_none recorded_'}\n\n"
            f"## Solution\n{p.solution_summary or '_none recorded_'}\n\n"
            f"## Business outcomes\n{p.business_outcomes or '_none recorded_'}\n\n"
            f"## Technology stack\n{_json_list_md(p.technology_stack)}\n\n"
            f"## Architecture\n{p.architecture_summary or '_none recorded_'}\n\n"
            f"## Complexity drivers\n{_json_list_md(p.complexity_drivers)}\n\n"
            f"## DNA summary\n{p.dna_summary or '_none recorded_'}\n\n"
            f"## Lineage\n{p.lineage_summary or '_none recorded_'}\n\n"
            f"## Related projects\n{_json_list_md(p.related_projects)}\n\n"
            f"## Reference docs\n{_json_list_md(p.reference_docs)}\n" +
            _related_section(fact_names)
        )
        v.write("Project IQ DNA", pname, fm, body)
        names.append(pname)

    v.lobe_index("Project IQ DNA", f"{profile_count} extracted project profiles — "
                 f"{len(lessons)} lessons, {len(assets)} reusable assets, {len(experts)} SMEs, "
                 f"{len(caps)} capabilities, {len(integrations)} integrations.",
                 names, {"profiles": profile_count, "lessons": len(lessons), "reusable_assets": len(assets),
                         "expertise": len(experts), "capabilities": len(caps), "integrations": len(integrations)})
    return project_name_to_leaf


def _build_vault(db: Session, root: str) -> dict:
    v = _Vault(root)
    _build_capabilities(db, v)
    _build_knowledge_base(db, v)
    _build_curated_answers(db, v)
    _build_router_intelligence(db, v)
    _build_tools(db, v)
    _build_user_memory(db, v)
    _build_lessons_learned(db, v)
    project_name_to_leaf = _build_project_iq(db, v)
    _build_insight_bus(db, v, project_name_to_leaf)
    _build_feature_adoption(db, v)

    fm = {"type": "root", "generated_at": _iso(datetime.datetime.utcnow())}
    body = (
        "# Centriq Mind\n\n"
        "Everything the assistant knows and has learned from chat — the same flywheel "
        "Memory Brain renders as a 3D graph, unabridged.\n" +
        _related_section(v.lobe_names)
    )
    v.write(None, "Centriq Mind", fm, body)

    return {"note_count": v.note_count, "lobe_count": len(v.lobe_names)}


def sync_vault() -> dict:
    """Regenerate the whole vault from the current DB state. Safe to call repeatedly —
    wipes and rewrites everything except a pre-existing .obsidian/ config folder."""
    if not settings.MEMORY_VAULT_ENABLED:
        return {"skipped": True}
    root = _vault_root()
    _reset_vault_dir(root)
    db = SessionLocal()
    try:
        return _build_vault(db, root)
    finally:
        db.close()


def memory_vault_sync_loop():
    """Daemon thread: regenerates the Memory Vault every MEMORY_VAULT_SYNC_INTERVAL
    seconds. Runs once immediately (unlike the SharePoint loops) so the vault is
    populated on first boot instead of sitting empty for the first interval."""
    interval = settings.MEMORY_VAULT_SYNC_INTERVAL
    while True:
        try:
            stats = sync_vault()
            if stats.get("skipped"):
                return
            logger.info("Memory Vault synced: %s notes across %s lobes",
                        stats["note_count"], stats["lobe_count"])
        except Exception:
            logger.exception("Memory Vault sync failed")
        time.sleep(interval)
