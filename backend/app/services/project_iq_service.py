"""Project IQ — Project DNA extraction + reuse/lessons/expert query helpers.

Builds structured, reusable per-project profiles ("Project DNA") from the
SharePoint "Project Showcase" corpus (meeting transcripts + project files already
ingested into Policy/PolicyChunk by sharepoint_project_sync, keyed
``sp:PROJECT/{slug}/...``). Internal-only: powers Find-Similar-Projects (Delivery
Reuse), Lessons Learned, Expertise matching, and Reusable-Asset discovery.

Every extracted fact carries a confidence (``verified`` only when explicitly
stated in the source material, else ``inferred``). The client-facing pillars
(Proposal Copilot, Estimation IQ) are deliberately out of scope for this slice;
when added they must filter to verified + reviewed facts only.
"""

import datetime
import logging
import re

from app.database import SessionLocal
from app.models import (
    Policy, PolicyChunk, ProjectProfile, ProjectCapability, ProjectIntegration,
    ProjectLesson, ProjectReusableAsset, ProjectExpertise,
)
from app.services.policy_service import PROJECT_CATEGORY, PolicyService

logger = logging.getLogger(__name__)

_KEY_PREFIX = "sp:PROJECT/"


# ── Project discovery / corpus gathering ─────────────────────────────────────

def list_project_slugs() -> dict[str, str]:
    """Map ``project_slug -> display name`` from the ingested Project Showcase corpus.

    Project content is keyed ``sp:PROJECT/{slug}/{rel_path}`` and titled
    ``"{ProjectName} — {DocType}: {stem}"`` by sharepoint_project_sync."""
    db = SessionLocal()
    try:
        rows = (
            db.query(Policy.source_key, Policy.title)
            .filter(
                Policy.category == PROJECT_CATEGORY,
                Policy.source_key.like(f"{_KEY_PREFIX}%"),
            )
            .all()
        )
    finally:
        db.close()
    out: dict[str, str] = {}
    for source_key, title in rows:
        parts = (source_key or "").split("/")
        if len(parts) < 2:
            continue
        slug = parts[1].strip()
        if not slug or slug in out:
            continue
        name = None
        if title and " — " in title:
            name = title.split(" — ", 1)[0].strip()
        elif title:
            name = title.strip()
        out[slug] = name or slug
    return out


def _gather_project_text(slug: str, char_budget: int = 24000) -> tuple[str, int]:
    """Concatenate all chunk text for one project (budgeted), grouped by file.

    Returns ``(text, distinct_doc_count)``."""
    db = SessionLocal()
    try:
        rows = (
            db.query(Policy.id, Policy.title, PolicyChunk.text)
            .join(PolicyChunk, PolicyChunk.policy_id == Policy.id)
            .filter(Policy.source_key.like(f"{_KEY_PREFIX}{slug}/%"))
            .order_by(Policy.id, PolicyChunk.chunk_index)
            .all()
        )
    finally:
        db.close()

    parts: list[str] = []
    total = 0
    last_title = None
    doc_ids: set[int] = set()
    for pid, title, txt in rows:
        doc_ids.add(pid)
        snippet = (txt or "").strip()
        if not snippet:
            continue
        if title != last_title:
            header = f"\n\n### {title}\n"
            parts.append(header)
            total += len(header)
            last_title = title
        if total + len(snippet) > char_budget:
            snippet = snippet[: max(0, char_budget - total)]
        if snippet:
            parts.append(snippet)
            total += len(snippet)
        if total >= char_budget:
            break
    return "".join(parts).strip(), len(doc_ids)


# ── DNA extraction (LLM) ─────────────────────────────────────────────────────

_DNA_SCHEMA_PROMPT = """You are a delivery-knowledge analyst. From the project material below
(meeting transcripts, summaries, and project documents), extract a structured "Project DNA" card
that other delivery, pre-sales, and staffing teams can reuse.

CRITICAL RULES:
- Use ONLY information present in the material. NEVER invent client names, people, outcomes,
  technologies, numbers, or repositories.
- For every fact set "confidence" to "verified" ONLY if it is explicitly stated in the material;
  otherwise use "inferred".
- If something is not mentioned, omit it: use null for scalars and an empty list for lists.
  Do not guess to fill the shape.
- Return ONLY a single JSON object, no prose, no code fences.

JSON shape (all keys required; use null / [] where unknown):
{
  "client_industry": "string|null",
  "status": "string|null",
  "business_problem": "string|null",
  "solution_summary": "string|null",
  "business_outcomes": "string|null",
  "technology_stack": ["string", ...],
  "architecture_summary": "string|null",
  "complexity_drivers": ["string", ...],
  "project_size": "string|null",
  "team_size": "string|null",
  "delivery_start_date": "string|null",
  "delivery_end_date": "string|null",
  "overall_confidence": "verified|inferred",
  "capabilities": [{"capability_name": "string", "category": "string|null", "maturity_level": "string|null", "confidence": "verified|inferred", "evidence": "string|null"}],
  "integrations": [{"system_name": "string", "integration_type": "string|null", "complexity_level": "string|null", "lessons_learned": "string|null", "confidence": "verified|inferred"}],
  "lessons": [{"category": "string|null", "lesson": "string", "impact_level": "string|null", "recommendation": "string|null", "confidence": "verified|inferred", "evidence": "string|null"}],
  "reusable_assets": [{"asset_name": "string", "asset_type": "string|null", "repository_url": "string|null", "owner": "string|null", "reuse_readiness": "string|null", "documentation_url": "string|null", "confidence": "verified|inferred"}],
  "expertise": [{"person_name": "string", "role_on_project": "string|null", "capability": "string|null", "evidence_level": "verified|inferred"}]
}
"""


def _norm_conf(val) -> str:
    return "verified" if str(val or "").strip().lower() == "verified" else "inferred"


def _as_list(val) -> list:
    if isinstance(val, list):
        return [v for v in val if v not in (None, "")]
    if isinstance(val, str) and val.strip():
        return [val.strip()]
    return []


def _build_dna_summary(name: str, data: dict) -> str:
    """The text embedded for similarity search — the surface a 'have we done this?'
    query is matched against, so it leads with problem + capabilities + integrations."""
    bits = [name]
    for key in ("client_industry", "business_problem", "solution_summary",
                "architecture_summary", "business_outcomes"):
        v = data.get(key)
        if v:
            bits.append(str(v))
    caps = [c.get("capability_name") for c in (data.get("capabilities") or []) if c.get("capability_name")]
    if caps:
        bits.append("Capabilities: " + ", ".join(caps))
    ints = [i.get("system_name") for i in (data.get("integrations") or []) if i.get("system_name")]
    if ints:
        bits.append("Integrations: " + ", ".join(ints))
    stack = _as_list(data.get("technology_stack"))
    if stack:
        bits.append("Tech stack: " + ", ".join(map(str, stack)))
    drivers = _as_list(data.get("complexity_drivers"))
    if drivers:
        bits.append("Complexity: " + ", ".join(map(str, drivers)))
    return "\n".join(bits)


def _upsert_profile(slug: str, name: str, data: dict, source_doc_count: int) -> int:
    db = SessionLocal()
    try:
        profile = db.query(ProjectProfile).filter(ProjectProfile.project_slug == slug).first()
        if profile is None:
            profile = ProjectProfile(project_slug=slug, name=name)
            db.add(profile)

        profile.name = name
        profile.client_industry = data.get("client_industry")
        profile.status = data.get("status")
        profile.business_problem = data.get("business_problem")
        profile.solution_summary = data.get("solution_summary")
        profile.business_outcomes = data.get("business_outcomes")
        profile.technology_stack = _as_list(data.get("technology_stack"))
        profile.architecture_summary = data.get("architecture_summary")
        profile.complexity_drivers = _as_list(data.get("complexity_drivers"))
        profile.project_size = data.get("project_size")
        profile.team_size = data.get("team_size")
        profile.delivery_start_date = data.get("delivery_start_date")
        profile.delivery_end_date = data.get("delivery_end_date")
        profile.confidence = _norm_conf(data.get("overall_confidence"))
        profile.source_doc_count = source_doc_count
        # A rebuild re-derives the facts, so any prior human review no longer applies.
        profile.review_status = "draft"
        profile.reviewed_by = None
        profile.reviewed_at = None

        dna_summary = _build_dna_summary(name, data)
        profile.dna_summary = dna_summary
        emb = PolicyService._get_embedding(dna_summary)
        if emb is not None:
            profile.embedding = emb

        db.flush()  # assign profile.id

        # Replace children wholesale (extraction is the source of truth).
        for child_cls in (ProjectCapability, ProjectIntegration, ProjectLesson,
                           ProjectReusableAsset, ProjectExpertise):
            db.query(child_cls).filter(child_cls.profile_id == profile.id).delete()

        for c in (data.get("capabilities") or []):
            if not c.get("capability_name"):
                continue
            db.add(ProjectCapability(
                profile_id=profile.id, capability_name=c["capability_name"],
                category=c.get("category"), maturity_level=c.get("maturity_level"),
                confidence=_norm_conf(c.get("confidence")), evidence=c.get("evidence"),
            ))
        for i in (data.get("integrations") or []):
            if not i.get("system_name"):
                continue
            db.add(ProjectIntegration(
                profile_id=profile.id, system_name=i["system_name"],
                integration_type=i.get("integration_type"), complexity_level=i.get("complexity_level"),
                lessons_learned=i.get("lessons_learned"), confidence=_norm_conf(i.get("confidence")),
            ))
        for l in (data.get("lessons") or []):
            if not l.get("lesson"):
                continue
            db.add(ProjectLesson(
                profile_id=profile.id, category=l.get("category"), lesson=l["lesson"],
                impact_level=l.get("impact_level"), recommendation=l.get("recommendation"),
                confidence=_norm_conf(l.get("confidence")), evidence=l.get("evidence"),
            ))
        for a in (data.get("reusable_assets") or []):
            if not a.get("asset_name"):
                continue
            db.add(ProjectReusableAsset(
                profile_id=profile.id, asset_name=a["asset_name"], asset_type=a.get("asset_type"),
                repository_url=a.get("repository_url"), owner=a.get("owner"),
                reuse_readiness=a.get("reuse_readiness"), documentation_url=a.get("documentation_url"),
                confidence=_norm_conf(a.get("confidence")),
            ))
        for e in (data.get("expertise") or []):
            if not e.get("person_name"):
                continue
            db.add(ProjectExpertise(
                profile_id=profile.id, person_name=e["person_name"],
                role_on_project=e.get("role_on_project"), capability=e.get("capability"),
                evidence_level=_norm_conf(e.get("evidence_level")),
                employee_id=_resolve_employee_id(db, e["person_name"]),
            ))

        db.commit()
        return profile.id
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def _resolve_employee_id(db, person_name: str):
    """Best-effort link of an extracted person name to a real employee row."""
    if not person_name:
        return None
    from app.models import Employee
    row = db.query(Employee.id).filter(Employee.name.ilike(person_name.strip())).first()
    return row[0] if row else None


def extract_project_dna(slug: str, name: str | None = None) -> dict:
    """Extract (or re-extract) one project's DNA from its ingested corpus."""
    text, doc_count = _gather_project_text(slug)
    if not text:
        return {"slug": slug, "status": "skipped", "reason": "no ingested content for this project"}
    if not name:
        name = list_project_slugs().get(slug, slug)

    prompt = f"{_DNA_SCHEMA_PROMPT}\n\nProject name: {name}\n\nPROJECT MATERIAL:\n{text}\n\nJSON:"
    try:
        from app.services import llm_controls_service as llm_controls
        from app.services.llm_json import invoke_json
        model = llm_controls.get_llm("service", default_timeout=180)
        data = invoke_json(model, prompt, attempts=2)
    except Exception as exc:
        logger.error("[ProjectIQ] extraction error for %s: %s", slug, exc)
        return {"slug": slug, "status": "error", "reason": str(exc)}
    if not data:
        return {"slug": slug, "status": "error", "reason": "LLM returned unparseable output"}

    profile_id = _upsert_profile(slug, name, data, doc_count)
    return {"slug": slug, "name": name, "status": "ok", "profile_id": profile_id, "docs": doc_count}


def build_all_dna() -> dict:
    """Extract DNA for every project found in the ingested corpus."""
    slugs = list_project_slugs()
    results = []
    for slug, name in slugs.items():
        try:
            results.append(extract_project_dna(slug, name))
        except Exception as exc:
            logger.error("[ProjectIQ] build_all error for %s: %s", slug, exc)
            results.append({"slug": slug, "status": "error", "reason": str(exc)})
    ok = sum(1 for r in results if r.get("status") == "ok")
    return {"projects": len(slugs), "extracted": ok, "results": results}


# ── Serialization ────────────────────────────────────────────────────────────

def _profile_to_dict(p: ProjectProfile, similarity: float | None = None,
                     include_children: bool = True) -> dict:
    d = {
        "id": p.id,
        "slug": p.project_slug,
        "name": p.name,
        "client_industry": p.client_industry,
        "status": p.status,
        "business_problem": p.business_problem,
        "solution_summary": p.solution_summary,
        "business_outcomes": p.business_outcomes,
        "technology_stack": p.technology_stack or [],
        "architecture_summary": p.architecture_summary,
        "complexity_drivers": p.complexity_drivers or [],
        "project_size": p.project_size,
        "team_size": p.team_size,
        "delivery_start_date": p.delivery_start_date,
        "delivery_end_date": p.delivery_end_date,
        "confidence": p.confidence,
        "review_status": p.review_status,
        "reviewed_by": p.reviewed_by,
        "reviewed_at": p.reviewed_at.isoformat() if p.reviewed_at else None,
        "source_doc_count": p.source_doc_count,
        "updated_at": p.updated_at.isoformat() if p.updated_at else None,
    }
    if similarity is not None:
        d["similarity"] = round(similarity, 3)
    if include_children:
        d["capabilities"] = [
            {"capability_name": c.capability_name, "category": c.category,
             "maturity_level": c.maturity_level, "confidence": c.confidence, "evidence": c.evidence}
            for c in p.capabilities
        ]
        d["integrations"] = [
            {"system_name": i.system_name, "integration_type": i.integration_type,
             "complexity_level": i.complexity_level, "lessons_learned": i.lessons_learned,
             "confidence": i.confidence}
            for i in p.integrations
        ]
        d["lessons"] = [
            {"category": l.category, "lesson": l.lesson, "impact_level": l.impact_level,
             "recommendation": l.recommendation, "confidence": l.confidence, "evidence": l.evidence}
            for l in p.lessons
        ]
        d["reusable_assets"] = [
            {"asset_name": a.asset_name, "asset_type": a.asset_type, "repository_url": a.repository_url,
             "owner": a.owner, "reuse_readiness": a.reuse_readiness,
             "documentation_url": a.documentation_url, "confidence": a.confidence}
            for a in p.reusable_assets
        ]
        d["expertise"] = [
            {"person_name": e.person_name, "role_on_project": e.role_on_project,
             "capability": e.capability, "evidence_level": e.evidence_level,
             "employee_id": e.employee_id}
            for e in p.expertise
        ]
    return d


# ── Queries (structured) ─────────────────────────────────────────────────────

def list_profiles(review_status: str | None = None) -> list[dict]:
    db = SessionLocal()
    try:
        q = db.query(ProjectProfile)
        if review_status:
            q = q.filter(ProjectProfile.review_status == review_status)
        rows = q.order_by(ProjectProfile.name).all()
        return [_profile_to_dict(p) for p in rows]
    finally:
        db.close()


def get_profile(slug: str) -> dict | None:
    db = SessionLocal()
    try:
        p = db.query(ProjectProfile).filter(ProjectProfile.project_slug == slug).first()
        return _profile_to_dict(p) if p else None
    finally:
        db.close()


def find_similar_projects(query_text: str, limit: int = 3,
                          reviewed_only: bool = False) -> list[dict]:
    """Rank past projects by semantic similarity to a need/description."""
    emb = PolicyService._get_embedding(query_text or "")
    db = SessionLocal()
    try:
        if emb is not None:
            q = db.query(ProjectProfile, ProjectProfile.embedding.cosine_distance(emb).label("dist")) \
                  .filter(ProjectProfile.embedding.isnot(None))
            if reviewed_only:
                q = q.filter(ProjectProfile.review_status == "reviewed")
            rows = q.order_by("dist").limit(limit).all()
            return [_profile_to_dict(p, similarity=max(0.0, 1.0 - float(dist))) for p, dist in rows]
        # No embedding service — fall back to a keyword scan over name/summary.
        like = f"%{(query_text or '')[:60]}%"
        q = db.query(ProjectProfile).filter(
            (ProjectProfile.name.ilike(like)) | (ProjectProfile.dna_summary.ilike(like))
        )
        if reviewed_only:
            q = q.filter(ProjectProfile.review_status == "reviewed")
        return [_profile_to_dict(p) for p in q.limit(limit).all()]
    finally:
        db.close()


def lessons_for(topic: str, limit_projects: int = 6) -> list[dict]:
    """Aggregate lessons across the projects most similar to a topic."""
    out = []
    for p in find_similar_projects(topic, limit=limit_projects):
        for l in p.get("lessons", []):
            out.append({**l, "project": p["name"]})
    # Highest-impact, verified lessons first.
    impact_rank = {"high": 0, "medium": 1, "low": 2}
    out.sort(key=lambda l: (impact_rank.get(str(l.get("impact_level") or "").lower(), 3),
                            0 if l.get("confidence") == "verified" else 1))
    return out


def find_experts(skills: str, limit: int = 8) -> list[dict]:
    """Evidence-backed people: who delivered the requested skills, on which projects."""
    terms = [t.strip() for t in re.split(r"[,/]|\band\b", skills or "") if t.strip()]
    db = SessionLocal()
    try:
        from sqlalchemy import or_
        q = db.query(ProjectExpertise, ProjectProfile.name) \
              .join(ProjectProfile, ProjectExpertise.profile_id == ProjectProfile.id)
        if terms:
            conds = []
            for t in terms:
                like = f"%{t}%"
                conds.append(ProjectExpertise.capability.ilike(like))
                conds.append(ProjectExpertise.role_on_project.ilike(like))
            q = q.filter(or_(*conds))
        rows = q.all()
    finally:
        db.close()

    agg: dict[str, dict] = {}
    for exp, pname in rows:
        d = agg.setdefault(exp.person_name, {
            "person_name": exp.person_name, "projects": set(),
            "capabilities": set(), "roles": set(), "evidence_level": exp.evidence_level,
        })
        d["projects"].add(pname)
        if exp.capability:
            d["capabilities"].add(exp.capability)
        if exp.role_on_project:
            d["roles"].add(exp.role_on_project)
        if exp.evidence_level == "verified":
            d["evidence_level"] = "verified"

    # Fall back to the people most associated with similar projects when expertise
    # rows didn't tag the skill explicitly.
    if not agg:
        for p in find_similar_projects(skills, limit=4):
            for e in p.get("expertise", []):
                d = agg.setdefault(e["person_name"], {
                    "person_name": e["person_name"], "projects": set(),
                    "capabilities": set(), "roles": set(), "evidence_level": e.get("evidence_level", "inferred"),
                })
                d["projects"].add(p["name"])
                if e.get("capability"):
                    d["capabilities"].add(e["capability"])

    experts = []
    for d in agg.values():
        experts.append({
            "person_name": d["person_name"],
            "projects": sorted(d["projects"]),
            "project_count": len(d["projects"]),
            "capabilities": sorted(d["capabilities"]),
            "roles": sorted(d["roles"]),
            "evidence_level": d["evidence_level"],
        })
    experts.sort(key=lambda e: e["project_count"], reverse=True)
    return experts[:limit]


def find_reusable_assets(need: str, limit: int = 10) -> list[dict]:
    """Find reusable components/accelerators matching a need, with their source project."""
    terms = [t.strip() for t in re.split(r"[,/]|\band\b", need or "") if t.strip()]
    db = SessionLocal()
    try:
        from sqlalchemy import or_
        q = db.query(ProjectReusableAsset, ProjectProfile.name) \
              .join(ProjectProfile, ProjectReusableAsset.profile_id == ProjectProfile.id)
        if terms:
            conds = []
            for t in terms:
                like = f"%{t}%"
                conds.append(ProjectReusableAsset.asset_name.ilike(like))
                conds.append(ProjectReusableAsset.asset_type.ilike(like))
            q = q.filter(or_(*conds))
        rows = q.limit(limit).all()
    finally:
        db.close()

    assets = [{
        "asset_name": a.asset_name, "asset_type": a.asset_type, "repository_url": a.repository_url,
        "owner": a.owner, "reuse_readiness": a.reuse_readiness,
        "documentation_url": a.documentation_url, "confidence": a.confidence, "project": pname,
    } for a, pname in rows]

    if not assets:
        for p in find_similar_projects(need, limit=4):
            for a in p.get("reusable_assets", []):
                assets.append({**a, "project": p["name"]})
    return assets[:limit]


def set_review(slug: str, reviewer: str, review_status: str = "reviewed",
               edits: dict | None = None) -> dict | None:
    """Human-in-the-loop: mark a profile reviewed and optionally edit top-level fields."""
    db = SessionLocal()
    try:
        p = db.query(ProjectProfile).filter(ProjectProfile.project_slug == slug).first()
        if not p:
            return None
        editable = {
            "name", "client_industry", "status", "business_problem", "solution_summary",
            "business_outcomes", "architecture_summary", "project_size", "team_size",
            "delivery_start_date", "delivery_end_date", "confidence",
        }
        for k, v in (edits or {}).items():
            if k in editable:
                setattr(p, k, v)
        if edits and "technology_stack" in edits:
            p.technology_stack = _as_list(edits["technology_stack"])
        if edits and "complexity_drivers" in edits:
            p.complexity_drivers = _as_list(edits["complexity_drivers"])
        p.review_status = "reviewed" if review_status == "reviewed" else "draft"
        p.reviewed_by = reviewer
        p.reviewed_at = datetime.datetime.utcnow()
        db.commit()
        return _profile_to_dict(p)
    finally:
        db.close()


# ── Display-ready renderers (for PMO chat tools — passthrough) ───────────────

def render_similar_projects(query: str, limit: int = 3) -> str:
    hits = find_similar_projects(query, limit=limit)
    if not hits:
        return ("No comparable past projects are in Project IQ yet. Once project transcripts "
                "and files are ingested and DNA is built, I can match against them.")
    lines = [f"Found {len(hits)} relevant past project(s):", ""]
    for h in hits:
        sim = h.get("similarity")
        sim_txt = f" — similarity {int(sim * 100)}%" if sim is not None else ""
        lines.append(f"**{h['name']}**{sim_txt}")
        if h.get("client_industry"):
            lines.append(f"Industry: {h['client_industry']}")
        if h.get("solution_summary"):
            lines.append(h["solution_summary"])
        caps = [c["capability_name"] for c in h.get("capabilities", [])][:6]
        if caps:
            lines.append("Capabilities: " + ", ".join(caps))
        ints = [i["system_name"] for i in h.get("integrations", [])][:6]
        if ints:
            lines.append("Integrations: " + ", ".join(ints))
        lessons = h.get("lessons", [])[:3]
        if lessons:
            lines.append("Lessons:")
            lines += [f"- {l['lesson']}" for l in lessons]
        assets = [a["asset_name"] for a in h.get("reusable_assets", [])][:5]
        if assets:
            lines.append("Reusable assets: " + ", ".join(assets))
        people = [e["person_name"] for e in h.get("expertise", [])][:5]
        if people:
            lines.append("People who delivered it: " + ", ".join(people))
        if h.get("review_status") != "reviewed":
            lines.append("_(draft — auto-extracted, pending PMO review)_")
        lines.append("")
    return "\n".join(lines).strip()


def render_lessons(topic: str) -> str:
    rows = lessons_for(topic)
    if not rows:
        return f"No recorded lessons matched '{topic}' yet in Project IQ."
    lines = [f"Recurring lessons relevant to '{topic}':", ""]
    seen = set()
    n = 0
    for l in rows:
        key = (l.get("lesson") or "").strip().lower()[:80]
        if key in seen:
            continue
        seen.add(key)
        n += 1
        impact = f" [{l['impact_level']}]" if l.get("impact_level") else ""
        lines.append(f"{n}. {l['lesson']}{impact}  _(from {l['project']})_")
        if l.get("recommendation"):
            lines.append(f"   → {l['recommendation']}")
        if n >= 10:
            break
    return "\n".join(lines).strip()


def render_experts(skills: str) -> str:
    experts = find_experts(skills)
    if not experts:
        return (f"No evidence-backed experts for '{skills}' are in Project IQ yet. "
                "I can search the people directory instead if you'd like.")
    lines = [f"People with delivery experience in '{skills}':", ""]
    for e in experts:
        caps = ", ".join(e["capabilities"][:4]) if e["capabilities"] else ""
        proj = ", ".join(e["projects"][:4])
        evid = "verified" if e["evidence_level"] == "verified" else "inferred"
        head = f"**{e['person_name']}** — delivered on {e['project_count']} project(s): {proj}"
        lines.append(head)
        if caps:
            lines.append(f"  Skills shown: {caps} ({evid})")
    return "\n".join(lines).strip()


def render_reusable_assets(need: str) -> str:
    assets = find_reusable_assets(need)
    if not assets:
        return f"No reusable assets matched '{need}' yet in Project IQ."
    lines = [f"Reusable assets matching '{need}':", ""]
    for a in assets:
        bits = [f"**{a['asset_name']}**"]
        if a.get("asset_type"):
            bits.append(a["asset_type"])
        head = " — ".join(bits)
        lines.append(head + f"  _(from {a['project']})_")
        sub = []
        if a.get("reuse_readiness"):
            sub.append(f"readiness: {a['reuse_readiness']}")
        if a.get("owner"):
            sub.append(f"owner: {a['owner']}")
        if a.get("repository_url"):
            sub.append(a["repository_url"])
        if sub:
            lines.append("  " + " · ".join(sub))
    return "\n".join(lines).strip()
