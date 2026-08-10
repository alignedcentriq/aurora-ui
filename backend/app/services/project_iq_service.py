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


def _doc_type_rank(title: str) -> int:
    """Extraction-order priority from a Policy.title ('{name} — {DocType}: {stem}').

    Summaries state team size/dates/outcomes explicitly in a few hundred words;
    transcripts bury the same facts (if present at all) in thousands of words of
    dialogue. When char_budget can't fit everything, summaries must go first or
    a verbose transcript ingested earlier starves the summary out of the budget
    entirely — the leading cause of 'unknown' fields that are actually answered
    in the docs."""
    doc_type = title.split(" — ", 1)[1] if title and " — " in title else (title or "")
    doc_type = doc_type.lower()
    if "summary" in doc_type:
        return 0
    if "transcript" in doc_type:
        return 2
    return 1


def _gather_project_text(slug: str, char_budget: int = 9000) -> tuple[str, int]:
    """Concatenate chunk text for one project (budgeted), grouped by file and
    ordered summary-first/transcript-last so the highest-value facts survive
    truncation regardless of ingestion order.

    char_budget is deliberately conservative, NOT raised from the original 9000:
    the service-tier model runs on shared ml01 at Ollama's runtime context window
    (~4096 tokens, confirmed via /api/ps — nothing in this codebase sets num_ctx
    per-request), and that budget is shared with ~450 tokens of schema prompt plus
    however much the model needs to write the output JSON. A larger input budget
    starves the output instead of the summary, producing MORE truncated/unparseable
    extractions, not fewer. The fix for thin DNA cards is ordering (below), not size.

    Returns ``(text, distinct_doc_count)``."""
    db = SessionLocal()
    try:
        rows = (
            db.query(Policy.id, Policy.title, PolicyChunk.chunk_index, PolicyChunk.text)
            .join(PolicyChunk, PolicyChunk.policy_id == Policy.id)
            .filter(Policy.source_key.like(f"{_KEY_PREFIX}{slug}/%"))
            .order_by(Policy.id, PolicyChunk.chunk_index)
            .all()
        )
    finally:
        db.close()

    docs: dict[int, dict] = {}
    doc_order: list[int] = []
    for pid, title, _chunk_idx, txt in rows:
        if pid not in docs:
            docs[pid] = {"title": title, "chunks": []}
            doc_order.append(pid)
        docs[pid]["chunks"].append(txt or "")
    doc_order.sort(key=lambda pid: (_doc_type_rank(docs[pid]["title"]), pid))

    parts: list[str] = []
    total = 0
    for pid in doc_order:
        if total >= char_budget:
            break
        doc_text = "".join(docs[pid]["chunks"]).strip()
        if not doc_text:
            continue
        header = f"\n\n### {docs[pid]['title']}\n"
        parts.append(header)
        total += len(header)
        remaining = char_budget - total
        if remaining <= 0:
            break
        snippet = doc_text[:remaining]
        parts.append(snippet)
        total += len(snippet)
    return "".join(parts).strip(), len(doc_order)


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
  "lineage_summary": "string|null",
  "related_projects": ["string", ...],
  "reference_docs": ["string", ...],
  "capabilities": [{"capability_name": "string", "category": "string|null", "maturity_level": "string|null", "confidence": "verified|inferred", "evidence": "string|null"}],
  "integrations": [{"system_name": "string", "integration_type": "string|null", "complexity_level": "string|null", "lessons_learned": "string|null", "confidence": "verified|inferred"}],
  "lessons": [{"category": "string|null", "lesson": "string", "impact_level": "string|null", "recommendation": "string|null", "confidence": "verified|inferred", "evidence": "string|null"}],
  "reusable_assets": [{"asset_name": "string", "asset_type": "string|null", "repository_url": "string|null", "owner": "string|null", "reuse_readiness": "string|null", "documentation_url": "string|null", "confidence": "verified|inferred"}],
  "expertise": [{"person_name": "string", "role_on_project": "string|null", "capability": "string|null", "evidence_level": "verified|inferred"}]
}
"""


def _norm_conf(val) -> str:
    return "verified" if str(val or "").strip().lower() == "verified" else "inferred"


# LLM extractors asked to fill a required-keys JSON shape routinely answer an
# unstated field with a placeholder string instead of null. Those pass truthiness
# checks (`if v:`) and inflate health scores / render as if they were real facts,
# so they're normalized to None here — "data not available" (rendered by the UI
# for a null field) rather than a fabricated-looking "Unknown".
_UNKNOWN_SENTINELS = {
    "unknown", "n/a", "na", "not available", "not applicable", "not specified",
    "not mentioned", "not stated", "not provided", "not given", "not disclosed",
    "tbd", "to be determined", "none", "null", "none mentioned", "none specified",
    "-", "--", "n.a.", "n/a.",
    # The schema prompt places "confidence": "verified|inferred" inside nearly every
    # nested object, right next to the real field values — small models sometimes
    # echo one of those two words into a scalar field instead of the actual fact
    # (e.g. team_size ends up literally "inferred"). Neither word is ever itself
    # a legitimate value for any of these fields.
    "verified", "inferred",
}


def _clean(val):
    """Normalize an LLM-extracted scalar: sentinel placeholder strings -> None."""
    if isinstance(val, str):
        s = val.strip()
        if not s or s.lower().strip(".") in _UNKNOWN_SENTINELS:
            return None
        return s
    return val


def _as_list(val) -> list:
    if isinstance(val, list):
        return [c for v in val for c in [_clean(v)] if c not in (None, "")]
    if isinstance(val, str) and val.strip():
        c = _clean(val)
        return [c] if c else []
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
        profile.client_industry = _clean(data.get("client_industry"))
        profile.status = _clean(data.get("status"))
        profile.business_problem = _clean(data.get("business_problem"))
        profile.solution_summary = _clean(data.get("solution_summary"))
        profile.business_outcomes = _clean(data.get("business_outcomes"))
        profile.technology_stack = _as_list(data.get("technology_stack"))
        profile.architecture_summary = _clean(data.get("architecture_summary"))
        profile.complexity_drivers = _as_list(data.get("complexity_drivers"))
        profile.project_size = _clean(data.get("project_size"))
        profile.team_size = _clean(data.get("team_size"))
        profile.delivery_start_date = _clean(data.get("delivery_start_date"))
        profile.delivery_end_date = _clean(data.get("delivery_end_date"))
        profile.confidence = _norm_conf(data.get("overall_confidence"))
        profile.source_doc_count = source_doc_count

        # Lineage metadata
        profile.lineage_summary = _clean(data.get("lineage_summary"))
        profile.related_projects = _as_list(data.get("related_projects"))
        profile.reference_docs = _as_list(data.get("reference_docs"))

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
                category=_clean(c.get("category")), maturity_level=_clean(c.get("maturity_level")),
                confidence=_norm_conf(c.get("confidence")), evidence=_clean(c.get("evidence")),
            ))
        for i in (data.get("integrations") or []):
            if not i.get("system_name"):
                continue
            db.add(ProjectIntegration(
                profile_id=profile.id, system_name=i["system_name"],
                integration_type=_clean(i.get("integration_type")), complexity_level=_clean(i.get("complexity_level")),
                lessons_learned=_clean(i.get("lessons_learned")), confidence=_norm_conf(i.get("confidence")),
            ))
        for l in (data.get("lessons") or []):
            if not l.get("lesson"):
                continue
            db.add(ProjectLesson(
                profile_id=profile.id, category=_clean(l.get("category")), lesson=l["lesson"],
                impact_level=_clean(l.get("impact_level")), recommendation=_clean(l.get("recommendation")),
                confidence=_norm_conf(l.get("confidence")), evidence=_clean(l.get("evidence")),
            ))
        for a in (data.get("reusable_assets") or []):
            if not a.get("asset_name"):
                continue
            db.add(ProjectReusableAsset(
                profile_id=profile.id, asset_name=a["asset_name"], asset_type=_clean(a.get("asset_type")),
                repository_url=_clean(a.get("repository_url")), owner=_clean(a.get("owner")),
                reuse_readiness=_clean(a.get("reuse_readiness")), documentation_url=_clean(a.get("documentation_url")),
                confidence=_norm_conf(a.get("confidence")),
            ))
        for e in (data.get("expertise") or []):
            if not e.get("person_name"):
                continue
            db.add(ProjectExpertise(
                profile_id=profile.id, person_name=e["person_name"],
                role_on_project=_clean(e.get("role_on_project")), capability=_clean(e.get("capability")),
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
        from app.services.llm_json import invoke_json
        data = invoke_json("service", prompt, attempts=2, default_timeout=180)
    except Exception as exc:
        logger.error("[ProjectIQ] extraction error for %s: %s", slug, exc)
        return {"slug": slug, "status": "error", "reason": str(exc)}
    if not data:
        return {"slug": slug, "status": "error", "reason": "LLM returned unparseable output"}

    profile_id = _upsert_profile(slug, name, data, doc_count)
    # Link each extracted fact back to its source chunk for drill-through.
    try:
        link_evidence(slug)
    except Exception as exc:
        logger.warning("[ProjectIQ] evidence link failed for %s: %s", slug, exc)
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
                     include_children: bool = True, with_quotes: bool = False) -> dict:
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
        "query_count": p.query_count or 0,
        "updated_at": p.updated_at.isoformat() if p.updated_at else None,
        "lineage_summary": p.lineage_summary,
        "related_projects": p.related_projects or [],
        "reference_docs": p.reference_docs or [],
    }
    if similarity is not None:
        d["similarity"] = round(similarity, 3)
    if include_children:
        d["capabilities"] = [
            {"capability_name": c.capability_name, "category": c.category,
             "maturity_level": c.maturity_level, "confidence": c.confidence, "evidence": c.evidence,
             "source_chunk_id": c.source_chunk_id}
            for c in p.capabilities
        ]
        d["integrations"] = [
            {"system_name": i.system_name, "integration_type": i.integration_type,
             "complexity_level": i.complexity_level, "lessons_learned": i.lessons_learned,
             "confidence": i.confidence, "source_chunk_id": i.source_chunk_id}
            for i in p.integrations
        ]
        d["lessons"] = [
            {"category": l.category, "lesson": l.lesson, "impact_level": l.impact_level,
             "recommendation": l.recommendation, "confidence": l.confidence, "evidence": l.evidence,
             "source_chunk_id": l.source_chunk_id}
            for l in p.lessons
        ]
        d["reusable_assets"] = [
            {"asset_name": a.asset_name, "asset_type": a.asset_type, "repository_url": a.repository_url,
             "owner": a.owner, "reuse_readiness": a.reuse_readiness,
             "documentation_url": a.documentation_url, "confidence": a.confidence,
             "source_chunk_id": a.source_chunk_id}
            for a in p.reusable_assets
        ]
        d["expertise"] = [
            {"person_name": e.person_name, "role_on_project": e.role_on_project,
             "capability": e.capability, "evidence_level": e.evidence_level,
             "employee_id": e.employee_id, "source_chunk_id": e.source_chunk_id}
            for e in p.expertise
        ]
        if with_quotes:
            _attach_quotes(d)
        d["health"] = compute_health(d)
    return d


# ── Health score ─────────────────────────────────────────────────────────────

# Field → weight. A DNA card is "healthy" when the high-value reuse fields are
# present; thin single-doc extractions score low and get flagged for review.
_HEALTH_FIELDS = {
    "business_problem": 12, "solution_summary": 14, "business_outcomes": 12,
    "architecture_summary": 8, "client_industry": 4, "status": 2,
}
_HEALTH_LISTS = {
    "technology_stack": 8, "capabilities": 14, "integrations": 8,
    "lessons": 10, "reusable_assets": 4, "expertise": 4,
}


def compute_health(d: dict) -> dict:
    """Completeness score (0-100) + human-readable flags for a DNA card dict."""
    score = 0
    for f, w in _HEALTH_FIELDS.items():
        if (d.get(f) or "").strip() if isinstance(d.get(f), str) else d.get(f):
            score += w
    for f, w in _HEALTH_LISTS.items():
        if d.get(f):
            score += w
    score = min(100, score)

    flags: list[str] = []
    if (d.get("source_doc_count") or 0) <= 1:
        flags.append("Single source document")
    if not d.get("business_outcomes"):
        flags.append("No business outcomes captured")
    if not d.get("technology_stack"):
        flags.append("No technology stack")
    if not d.get("expertise"):
        flags.append("No people / expertise linked")
    # Any verified fact at all?
    verified = (d.get("confidence") == "verified") or any(
        x.get("confidence") == "verified" or x.get("evidence_level") == "verified"
        for key in ("capabilities", "integrations", "lessons", "reusable_assets", "expertise")
        for x in (d.get(key) or [])
    )
    if not verified:
        flags.append("No verified facts — all inferred")

    level = "strong" if score >= 70 else "moderate" if score >= 40 else "thin"
    return {"score": score, "level": level, "flags": flags}


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
        if not p:
            return None
        d = _profile_to_dict(p, with_quotes=True)
        d["dna_summary"] = p.dna_summary or ""
        # Include source document titles for the "Sources" drill-down.
        rows = (
            db.query(Policy.title, Policy.source_key)
            .filter(Policy.source_key.like(f"{_KEY_PREFIX}{slug}/%"))
            .order_by(Policy.title)
            .all()
        )
        d["source_docs"] = [{"title": t, "source_key": sk} for t, sk in rows]
        return d
    finally:
        db.close()


# Common glue words to drop so the keyword fallback scores on meaningful terms.
_SEARCH_STOPWORDS = {
    "the", "a", "an", "and", "or", "for", "with", "to", "of", "in", "on", "at",
    "by", "from", "is", "are", "be", "that", "this", "it", "as", "we", "our",
    "using", "use", "used", "via", "into", "over", "new", "need", "build",
    "built", "develop", "developed", "project", "projects", "solution",
    "solutions", "system", "platform", "app", "application", "something",
    "similar", "before", "have", "has",
}


def _search_terms(text: str) -> list[str]:
    """Meaningful lowercased tokens (len > 2, not a stopword) for term-overlap."""
    return [t for t in re.findall(r"[a-z0-9]+", (text or "").lower())
            if len(t) > 2 and t not in _SEARCH_STOPWORDS]


def search_projects(query_text: str, limit: int = 3,
                    reviewed_only: bool = False) -> dict:
    """Rank past projects by similarity to a description.

    Returns ``{"results": [...], "mode": "semantic" | "keyword"}``. Prefers
    vector similarity; when the embedding model is unreachable (ml01 saturated)
    or no profile has been vectorized yet, degrades to a multi-field term-overlap
    scan so search still returns useful matches instead of silently finding
    nothing. ``mode`` lets the UI tell the user which path produced the results.
    """
    emb = PolicyService._get_embedding(query_text or "")
    db = SessionLocal()
    try:
        if emb is not None:
            q = db.query(ProjectProfile, ProjectProfile.embedding.cosine_distance(emb).label("dist")) \
                  .filter(ProjectProfile.embedding.isnot(None))
            if reviewed_only:
                q = q.filter(ProjectProfile.review_status == "reviewed")
            rows = q.order_by("dist").limit(limit).all()
            hits = [_profile_to_dict(p, similarity=max(0.0, 1.0 - float(dist))) for p, dist in rows]
            if hits:
                return {"results": hits, "mode": "semantic"}
            # Query embedded fine, but no profile has a stored vector yet —
            # fall through to keyword rather than return an empty list.

        # Keyword fallback: term overlap across every searchable text field.
        terms = set(_search_terms(query_text))
        q = db.query(ProjectProfile)
        if reviewed_only:
            q = q.filter(ProjectProfile.review_status == "reviewed")
        scored: list[tuple[float, ProjectProfile]] = []
        for p in q.all():
            haystack = " ".join(filter(None, [
                p.name, p.dna_summary, p.business_problem, p.solution_summary,
                p.business_outcomes, p.architecture_summary, p.client_industry,
                " ".join(p.technology_stack or []),
                " ".join(p.complexity_drivers or []),
            ])).lower()
            if not terms:
                scored.append((0.0, p))
            else:
                matched = sum(1 for t in terms if t in haystack)
                if matched:
                    scored.append((matched / len(terms), p))
        scored.sort(key=lambda s: s[0], reverse=True)
        hits = [_profile_to_dict(p, similarity=round(score, 3) if score else None)
                for score, p in scored[:limit]]
        return {"results": hits, "mode": "keyword"}
    finally:
        db.close()


def find_similar_projects(query_text: str, limit: int = 3,
                          reviewed_only: bool = False) -> list[dict]:
    """Back-compat wrapper (lessons/experts/assets callers): just the ranked list."""
    return search_projects(query_text, limit=limit, reviewed_only=reviewed_only)["results"]


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


# ── Evidence drill-through (fact → source chunk, lexical match, no LLM) ────────

_STOP = {
    "the", "and", "for", "with", "that", "this", "from", "into", "was", "were", "are",
    "has", "have", "had", "will", "would", "can", "could", "our", "their", "its", "a",
    "an", "of", "to", "in", "on", "by", "as", "at", "is", "it", "be", "or", "we", "they",
    "project", "client", "team", "using", "used", "use", "via", "which", "also", "data",
}


def _tokens(text: str) -> set[str]:
    return {w for w in re.findall(r"[a-z0-9]+", (text or "").lower())
            if len(w) > 3 and w not in _STOP}


def _split_sentences(text: str) -> list[str]:
    parts = re.split(r"(?<=[.!?])\s+|\n+", text or "")
    return [s.strip() for s in parts if len(s.strip()) > 25]


def _best_quote(chunk_text: str, fact_text: str, cap: int = 320) -> str:
    """Pick the sentence within a chunk that best supports the fact."""
    ft = _tokens(fact_text)
    if not ft:
        return (chunk_text or "")[:cap].strip()
    best, best_score = "", 0.0
    for sent in _split_sentences(chunk_text):
        st = _tokens(sent)
        if not st:
            continue
        score = len(ft & st) / (len(ft) ** 0.5)
        if score > best_score:
            best, best_score = sent, score
    snippet = best or (chunk_text or "")[:cap]
    return snippet[:cap].strip()


def _project_chunks(db, slug: str) -> list[tuple[int, str]]:
    rows = (
        db.query(PolicyChunk.id, PolicyChunk.text)
        .join(Policy, PolicyChunk.policy_id == Policy.id)
        .filter(Policy.source_key.like(f"{_KEY_PREFIX}{slug}/%"))
        .all()
    )
    return [(cid, txt or "") for cid, txt in rows]


def link_evidence(slug: str) -> dict:
    """Match every extracted fact of a project to the source chunk that best
    supports it (lexical overlap) and store its id for drill-through. No LLM."""
    db = SessionLocal()
    try:
        p = db.query(ProjectProfile).filter(ProjectProfile.project_slug == slug).first()
        if not p:
            return {"slug": slug, "status": "no_profile"}
        chunks = _project_chunks(db, slug)
        if not chunks:
            return {"slug": slug, "status": "no_chunks"}
        chunk_tokens = [(cid, _tokens(txt)) for cid, txt in chunks]

        def _match(fact_text: str):
            ft = _tokens(fact_text)
            if not ft:
                return None
            best_id, best = None, 0
            for cid, ctoks in chunk_tokens:
                overlap = len(ft & ctoks)
                if overlap > best:
                    best_id, best = cid, overlap
            return best_id if best >= 2 else None

        linked = 0
        for c in p.capabilities:
            c.source_chunk_id = _match(f"{c.capability_name} {c.category or ''} {c.evidence or ''}")
            linked += bool(c.source_chunk_id)
        for i in p.integrations:
            i.source_chunk_id = _match(f"{i.system_name} {i.integration_type or ''} {i.lessons_learned or ''}")
            linked += bool(i.source_chunk_id)
        for l in p.lessons:
            l.source_chunk_id = _match(f"{l.lesson} {l.recommendation or ''} {l.evidence or ''}")
            linked += bool(l.source_chunk_id)
        for a in p.reusable_assets:
            a.source_chunk_id = _match(f"{a.asset_name} {a.asset_type or ''}")
            linked += bool(a.source_chunk_id)
        for e in p.expertise:
            e.source_chunk_id = _match(f"{e.person_name} {e.role_on_project or ''} {e.capability or ''}")
            linked += bool(e.source_chunk_id)
        db.commit()
        return {"slug": slug, "status": "ok", "linked": linked}
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def link_all_evidence() -> dict:
    """One-shot: link evidence for every existing profile (no rebuild needed)."""
    db = SessionLocal()
    try:
        slugs = [s for (s,) in db.query(ProjectProfile.project_slug).all()]
    finally:
        db.close()
    results = []
    for s in slugs:
        try:
            results.append(link_evidence(s))
        except Exception as exc:
            results.append({"slug": s, "status": "error", "reason": str(exc)})
    linked = sum(r.get("linked", 0) for r in results)
    return {"profiles": len(slugs), "facts_linked": linked}


def _attach_quotes(d: dict) -> None:
    """Resolve source_chunk_id → a supporting quote snippet for each child fact."""
    ids = set()
    for key in ("capabilities", "integrations", "lessons", "reusable_assets", "expertise"):
        for x in d.get(key) or []:
            if x.get("source_chunk_id"):
                ids.add(x["source_chunk_id"])
    if not ids:
        return
    db = SessionLocal()
    try:
        rows = db.query(PolicyChunk.id, PolicyChunk.text).filter(PolicyChunk.id.in_(ids)).all()
        texts = {cid: txt for cid, txt in rows}
    finally:
        db.close()

    def _ft(key, x):
        if key == "capabilities":
            return f"{x.get('capability_name','')} {x.get('evidence') or ''}"
        if key == "integrations":
            return f"{x.get('system_name','')} {x.get('lessons_learned') or ''}"
        if key == "lessons":
            return f"{x.get('lesson','')} {x.get('recommendation') or ''}"
        if key == "reusable_assets":
            return x.get("asset_name", "")
        return f"{x.get('person_name','')} {x.get('capability') or ''}"

    for key in ("capabilities", "integrations", "lessons", "reusable_assets", "expertise"):
        for x in d.get(key) or []:
            cid = x.get("source_chunk_id")
            if cid and cid in texts:
                x["source_quote"] = _best_quote(texts[cid], _ft(key, x))


# ── Portfolio analytics (aggregate across all DNA) ───────────────────────────

def portfolio_analytics() -> dict:
    """Org-wide rollups over the DNA library: capability/tech/integration frequency,
    industry & status distribution, and overall health — powers the analytics tab."""
    from collections import Counter
    db = SessionLocal()
    try:
        profiles = db.query(ProjectProfile).all()
        dicts = [_profile_to_dict(p, include_children=True) for p in profiles]
    finally:
        db.close()

    caps, techs, integ = Counter(), Counter(), Counter()
    industries, statuses, health_levels = Counter(), Counter(), Counter()
    reviewed = total_lessons = total_assets = total_experts = 0
    for d in dicts:
        for c in d.get("capabilities", []):
            if c.get("capability_name"):
                caps[c["capability_name"].strip()] += 1
        for t in d.get("technology_stack", []):
            if t:
                techs[str(t).strip()] += 1
        for i in d.get("integrations", []):
            if i.get("system_name"):
                integ[i["system_name"].strip()] += 1
        if d.get("client_industry"):
            industries[d["client_industry"].strip()] += 1
        if d.get("status"):
            statuses[d["status"].strip()] += 1
        if d.get("review_status") == "reviewed":
            reviewed += 1
        total_lessons += len(d.get("lessons", []))
        total_assets += len(d.get("reusable_assets", []))
        total_experts += len(d.get("expertise", []))
        health_levels[d["health"]["level"]] += 1

    def _top(counter, n=20):
        return [{"label": k, "count": v} for k, v in counter.most_common(n)]

    return {
        "total_projects": len(dicts),
        "reviewed": reviewed,
        "draft": len(dicts) - reviewed,
        "totals": {"lessons": total_lessons, "assets": total_assets, "experts": total_experts},
        "health": dict(health_levels),
        "capabilities": _top(caps),
        "technologies": _top(techs),
        "integrations": _top(integ),
        "industries": _top(industries),
        "statuses": _top(statuses),
    }


def record_queries(slugs: list[str]) -> None:
    """Bump query_count / last_queried_at for surfaced projects (triage signal)."""
    slugs = [s for s in slugs if s]
    if not slugs:
        return
    db = SessionLocal()
    try:
        for p in db.query(ProjectProfile).filter(ProjectProfile.project_slug.in_(slugs)).all():
            p.query_count = (p.query_count or 0) + 1
            p.last_queried_at = datetime.datetime.utcnow()
        db.commit()
    except Exception:
        db.rollback()
    finally:
        db.close()


# ── Phase 2: Recurring-risk radar ────────────────────────────────────────────

def recurring_risks(min_projects: int = 2, limit: int = 30) -> list[dict]:
    """Cross-project lessons that appear in ≥ min_projects — the "watch list" for
    delivery teams.  Groups by category first, then de-duplicates within category
    by fuzzy keyword overlap so the same lesson phrased differently isn't split."""
    db = SessionLocal()
    try:
        rows = (
            db.query(ProjectLesson, ProjectProfile.name, ProjectProfile.project_slug)
            .join(ProjectProfile, ProjectLesson.profile_id == ProjectProfile.id)
            .all()
        )
    finally:
        db.close()

    # bucket: (category, frozenset-of-key-tokens) → list of (lesson, recommendation, project_name, slug)
    from collections import defaultdict
    buckets: dict[tuple, list] = defaultdict(list)
    for lesson, pname, pslug in rows:
        cat = (lesson.category or "General").strip()
        toks = frozenset(
            w for w in re.findall(r"[a-z]{4,}", (lesson.lesson or "").lower())
            if w not in _STOP
        )
        # Match to nearest existing bucket (≥40% token overlap) or start a new one.
        matched = None
        for key in buckets:
            kcat, ktoks = key
            if kcat != cat or not ktoks:
                continue
            overlap = len(toks & ktoks) / max(len(toks | ktoks), 1)
            if overlap >= 0.40:
                matched = key
                break
        key = matched or (cat, toks)
        buckets[key].append({
            "lesson": lesson.lesson,
            "recommendation": lesson.recommendation,
            "impact_level": lesson.impact_level,
            "confidence": lesson.confidence,
            "project": pname,
            "slug": pslug,
        })

    risks = []
    for (cat, _), entries in buckets.items():
        projects = list({e["slug"]: e["project"] for e in entries}.items())
        if len(projects) < min_projects:
            continue
        # Representative lesson = longest text (usually the most complete phrasing).
        rep = max(entries, key=lambda e: len(e.get("lesson") or ""))
        rec = next((e["recommendation"] for e in entries if e.get("recommendation")), None)
        has_high = any(str(e.get("impact_level") or "").lower() == "high" for e in entries)
        risks.append({
            "category": cat,
            "lesson": rep["lesson"],
            "recommendation": rec,
            "impact_level": "high" if has_high else rep.get("impact_level"),
            "recurrence": len(projects),
            "projects": [{"slug": s, "name": n} for s, n in projects],
        })

    risks.sort(key=lambda r: (-r["recurrence"], r["category"]))
    return risks[:limit]


# ── Phase 2: Experience × Availability staffing ───────────────────────────────

def _latest_allocation_snapshot() -> "datetime.date | None":
    db = SessionLocal()
    try:
        row = db.execute(
            __import__("sqlalchemy").text(
                "SELECT MAX(allocation_date) FROM enterprise_ai.employee_allocations"
            )
        ).fetchone()
        return row[0] if row else None
    finally:
        db.close()


def find_available_experts(skills: str, limit: int = 12) -> list[dict]:
    """People with evidence-backed experience in *skills* who appear available
    (< 80% allocated) in the latest snapshot.

    Joins ProjectExpertise (delivery experience) with the employee_allocations
    monthly snapshot to surface 'has done it AND has capacity'.
    """
    from sqlalchemy import or_

    # 1. Gather expertise-matched people from DNA.
    experts = find_experts(skills, limit=50)  # broader initial pull
    if not experts:
        return []

    names = [e["person_name"] for e in experts]

    # 2. Latest allocation snapshot date.
    snap = _latest_allocation_snapshot()
    if not snap:
        # No allocation data — return expertise results without availability.
        return [
            {**e, "availability": "unknown", "utilization_pct": None, "current_projects": []}
            for e in experts[:limit]
        ]

    db = SessionLocal()
    try:
        # 3. Sum efforts for each person on the latest snapshot that are ongoing.
        rows = db.execute(
            __import__("sqlalchemy").text("""
                SELECT employee_name,
                       SUM(efforts_percent) AS total_pct,
                       array_agg(DISTINCT project_name) AS projects
                FROM enterprise_ai.employee_allocations
                WHERE allocation_date = :snap
                  AND project_status NOT LIKE '%Completed%'
                  AND employee_name = ANY(:names)
                GROUP BY employee_name
            """),
            {"snap": snap, "names": names},
        ).fetchall()
    finally:
        db.close()

    util: dict[str, dict] = {}
    for emp_name, total_pct, projs in rows:
        util[emp_name] = {
            "utilization_pct": round(float(total_pct or 0), 1),
            "current_projects": [p for p in (projs or []) if p],
        }

    results = []
    for e in experts:
        u = util.get(e["person_name"], {})
        pct = u.get("utilization_pct")
        if pct is None:
            avail = "likely available"  # not in latest snapshot → bench
        elif pct >= 100:
            avail = "fully allocated"
        elif pct >= 80:
            avail = "mostly allocated"
        elif pct >= 40:
            avail = "partially available"
        else:
            avail = "available"
        results.append({
            **e,
            "availability": avail,
            "utilization_pct": pct,
            "current_projects": u.get("current_projects", []),
        })

    # Sort: available first, then partially, then mostly, then full.
    _rank = {"available": 0, "likely available": 1, "partially available": 2,
             "mostly allocated": 3, "fully allocated": 4}
    results.sort(key=lambda r: (_rank.get(r["availability"], 5), -r.get("project_count", 0)))
    return results[:limit]


# ── Phase 2: Kickoff brief generator ─────────────────────────────────────────

_BRIEF_PROMPT = """You are a senior delivery principal. Using ONLY the past-project summaries below, generate a concise kickoff brief for a NEW project with the description provided.

The brief must contain exactly these sections:
1. Objectives & Scope (2–3 sentences)
2. Recommended Tech Stack (bullet list, drawn from comparable past projects)
3. Suggested Team Structure (bullet list of roles + rough headcount)
4. Key Risks to Watch (bullet list, sourced from past lessons)
5. Reusable Assets / Accelerators (bullet list from past projects, if any)
6. Comparable Past Projects (1-line each with similarity note)

Rules:
- Draw ONLY from the context below. Do NOT invent technologies, numbers, or project names.
- Be concise. Each section ≤ 5 bullet points or 3 sentences.
- Return plain markdown — no JSON, no code fences.
"""


def generate_kickoff_brief(description: str) -> dict:
    """Generate a structured kickoff brief for a new project from similar past projects."""
    if not description or not description.strip():
        return {"status": "error", "reason": "description is required"}

    similar = find_similar_projects(description, limit=4)
    if not similar:
        return {
            "status": "no_data",
            "brief": (
                "No comparable past projects found in Project IQ yet. "
                "Once the project corpus is fully ingested, I can generate a richer brief."
            ),
            "sources": [],
        }

    # Build a compact context from the top matches.
    ctx_parts = []
    for p in similar:
        bits = [f"**{p['name']}** (similarity {int((p.get('similarity') or 0) * 100)}%)"]
        if p.get("solution_summary"):
            bits.append(p["solution_summary"])
        if p.get("technology_stack"):
            bits.append("Tech: " + ", ".join(p["technology_stack"][:6]))
        if p.get("team_size"):
            bits.append(f"Team: {p['team_size']}")
        lessons = [l["lesson"] for l in (p.get("lessons") or [])[:3]]
        if lessons:
            bits.append("Lessons: " + "; ".join(lessons))
        assets = [a["asset_name"] for a in (p.get("reusable_assets") or [])[:3]]
        if assets:
            bits.append("Assets: " + ", ".join(assets))
        ctx_parts.append("\n".join(bits))

    context = "\n\n---\n\n".join(ctx_parts)
    prompt = (
        f"{_BRIEF_PROMPT}\n\nNEW PROJECT DESCRIPTION:\n{description.strip()}\n\n"
        f"PAST PROJECT CONTEXT:\n{context}\n\nBRIEF:"
    )

    try:
        from app.services import llm_controls_service as llm_controls
        model = llm_controls.get_llm("service", default_timeout=120)
        resp = model.invoke(prompt)
        brief_text = (resp.content or "").strip() or _template_brief(description, similar)
    except Exception:
        brief_text = _template_brief(description, similar)

    return {
        "status": "ok",
        "brief": brief_text,
        "sources": [
            {"slug": p["slug"], "name": p["name"],
             "similarity": round(p.get("similarity") or 0, 3)}
            for p in similar
        ],
    }


def _template_brief(description: str, similar: list[dict]) -> str:
    """Template-based brief when the LLM is unavailable."""
    techs: list[str] = []
    lessons: list[str] = []
    assets: list[str] = []
    for p in similar:
        techs += (p.get("technology_stack") or [])[:4]
        lessons += [l["lesson"] for l in (p.get("lessons") or [])[:2]]
        assets += [a["asset_name"] for a in (p.get("reusable_assets") or [])[:2]]
    seen = set()
    techs = [t for t in techs if not (t in seen or seen.add(t))][:8]
    seen = set()
    lessons = [l for l in lessons if not (l in seen or seen.add(l))][:5]
    seen = set()
    assets = [a for a in assets if not (a in seen or seen.add(a))][:5]

    parts = [f"## Kickoff Brief\n\n**New project:** {description}\n"]
    if techs:
        parts.append("### Recommended Tech Stack\n" + "\n".join(f"- {t}" for t in techs))
    if lessons:
        parts.append("### Key Risks to Watch\n" + "\n".join(f"- {l}" for l in lessons))
    if assets:
        parts.append("### Reusable Assets\n" + "\n".join(f"- {a}" for a in assets))
    refs = "\n".join(
        f"- **{p['name']}** — {int((p.get('similarity') or 0)*100)}% match"
        for p in similar
    )
    parts.append(f"### Comparable Past Projects\n{refs}")
    return "\n\n".join(parts)


# ── Phase 2: Lesson → Training recommendations ────────────────────────────────

def lessons_to_training(slug: str, max_courses_per_area: int = 3) -> dict:
    """Map project lessons to Udemy course recommendations for upskilling.

    For each unique capability/category from this project's lessons, searches the
    Udemy Business catalog and returns top matching courses.  Falls back gracefully
    if the Udemy connector is not configured."""
    profile = get_profile(slug)
    if not profile:
        return {"status": "no_profile", "slug": slug, "areas": []}

    lessons = profile.get("lessons") or []
    caps = profile.get("capabilities") or []

    # Build a set of skill areas from lessons + capabilities.
    areas: dict[str, list[str]] = {}  # area label → search terms
    for l in lessons:
        cat = (l.get("category") or "").strip()
        if cat and cat.lower() not in ("general", ""):
            areas.setdefault(cat, []).append(l.get("lesson", "")[:60])
    for c in caps:
        name = (c.get("capability_name") or "").strip()
        if name:
            areas.setdefault(name, [])

    if not areas:
        return {"status": "no_areas", "slug": slug, "areas": []}

    try:
        from app.services import udemy_business_service as udemy
        if not udemy.configured():
            return {"status": "udemy_unavailable", "slug": slug, "areas": []}
    except ImportError:
        return {"status": "udemy_unavailable", "slug": slug, "areas": []}

    result_areas = []
    for area, lesson_texts in list(areas.items())[:8]:  # cap at 8 areas
        query = area + (f" {lesson_texts[0]}" if lesson_texts else "")
        try:
            result = udemy.search_courses(query, page_size=max_courses_per_area)
            courses = result.get("results", [])
        except Exception:
            courses = []
        if courses:
            result_areas.append({
                "area": area,
                "courses": [
                    {
                        "title": c.get("title", ""),
                        "url": c.get("url", ""),
                        "headline": c.get("headline", ""),
                        "rating": c.get("avg_rating"),
                        "num_subscribers": c.get("num_subscribers"),
                    }
                    for c in courses
                ],
            })

    return {
        "status": "ok",
        "slug": slug,
        "project_name": profile.get("name", slug),
        "areas": result_areas,
    }


def agentic_dna_search(query_text: str) -> dict:
    """Agentic RAG for DNA: multi-hop traversal of project lineage."""
    # Hop 1: Semantic search
    initial_hits = find_similar_projects(query_text, limit=3)
    if not initial_hits:
        return {"answer": "No projects match the query.", "profiles": []}
    
    # Hop 2: Traversal (gather lineage docs/related projects)
    profiles = {}
    for hit in initial_hits:
        profiles[hit["slug"]] = hit
        for related in hit.get("related_projects") or []:
            if related not in profiles:
                # Naive slug mapping, fetch profile
                p = get_profile(related)
                if p: profiles[related] = p
                
    # Build context
    context_lines = []
    for p in profiles.values():
        context_lines.append(f"Project: {p['name']} (Slug: {p['slug']})")
        context_lines.append(f"Lineage: {p.get('lineage_summary') or 'N/A'}")
        context_lines.append(f"References: {p.get('reference_docs') or []}")
        context_lines.append(f"Capabilities: {[c.get('capability_name') for c in p.get('capabilities') or []][:3]}")
        context_lines.append("")
    context_str = "\n".join(context_lines)

    prompt = f"""You are a Project DNA analyst. Answer the user's query about our delivery capabilities by synthesizing a multi-hop lineage response based on the following project context. Include references to specific projects.

USER QUERY: {query_text}

CONTEXT:
{context_str}

Respond in markdown. Be concise and focus on lineage and capabilities."""

    try:
        from app.services import llm_controls_service as llm_controls
        model = llm_controls.get_llm("service")
        # simple invoke
        response = model.invoke(prompt)
        answer = getattr(response, "content", "")
    except Exception as exc:
        logger.error(f"[ProjectIQ] Agentic search error: {exc}")
        answer = "Sorry, failed to generate an agentic response."
        
    return {
        "answer": answer,
        "profiles": list(profiles.values()),
    }
