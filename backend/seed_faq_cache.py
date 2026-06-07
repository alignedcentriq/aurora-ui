"""Warm the semantic answer cache with curated FAQ answers.

For each question in app/data/faq_seed.json, this:
  1. Retrieves the relevant policy text from the live DB (PolicyService).
  2. Runs ONE format pass through the agent model to produce a clean answer.
  3. Stores it in the cached_answers table with is_seed=True.

Because seeded policy answers go through the same store as organic ones, they are
auto-invalidated the next time the underlying SharePoint doc changes — the seed never
goes stale. Run on demand / after deploy:

    python backend/seed_faq_cache.py
"""

import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

SEED_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "app", "data", "faq_seed.json")

# Answers must follow the same quality rules as live policy responses:
# no metadata, author names, version numbers, or stale dates.
_FORMAT_SYSTEM = (
    "You are a concise enterprise assistant. Answer the employee's question using ONLY the "
    "provided policy context. Be direct and helpful. Use short paragraphs or bullet points. "
    "Do NOT include document metadata, author names, version numbers, review dates, or "
    "'as per the document' phrasing. If the context does not cover the question, give a brief, "
    "accurate general answer and suggest who to contact. Never invent specific numbers."
)


def _format_answer(question: str, policy_context: str) -> str | None:
    """One LLM pass to turn retrieved policy text into a clean answer."""
    from openai import OpenAI
    from app.config import settings

    client = OpenAI(base_url=settings.AGENT_BASE_URL, api_key=settings.AGENT_API_KEY)
    context = policy_context.strip() if policy_context else "(no specific policy found)"
    try:
        resp = client.chat.completions.create(
            model=settings.AGENT_MODEL_NAME,
            temperature=0.0,
            messages=[
                {"role": "system", "content": _FORMAT_SYSTEM},
                {"role": "user", "content": f"Question: {question}\n\nPolicy context:\n{context}"},
            ],
        )
        return (resp.choices[0].message.content or "").strip() or None
    except Exception as e:
        print(f"  ! format failed: {type(e).__name__}: {e}")
        return None


def main():
    from app.hr_service import HRService
    from app.services.answer_cache_service import AnswerCacheService
    from app.database import SessionLocal
    from app.models import CachedAnswer

    with open(SEED_PATH, "r", encoding="utf-8") as f:
        seeds = json.load(f)

    # Clear any prior seed rows so re-running doesn't pile up duplicates.
    db = SessionLocal()
    try:
        cleared = db.query(CachedAnswer).filter(CachedAnswer.is_seed.is_(True)).delete()
        db.commit()
        print(f"Cleared {cleared} existing seed rows.")
    except Exception as e:
        db.rollback()
        print(f"Could not clear seed rows: {e}")
    finally:
        db.close()

    stored = 0
    for entry in seeds:
        question = entry.get("question", "").strip()
        domain = entry.get("domain", "general").strip()
        direct_answer = (entry.get("direct_answer") or "").strip()
        if not question:
            continue

        # Direct answers bypass policy lookup and LLM formatting entirely.
        if direct_answer:
            ok = AnswerCacheService.store(
                query=question,
                answer=direct_answer,
                domain=domain,
                sub_intent="general",
                source_keys=None,
                is_seed=True,
            )
            if ok:
                stored += 1
                print(f"  + cached [direct/{domain}] {question}")
            else:
                print(f"  - skip (store failed): {question}")
            continue

        policy_context = ""
        try:
            result = HRService.search_policies(question, limit=2)
            if result and "No policies found" not in result and "No specific policy" not in result:
                policy_context = result
        except Exception as e:
            print(f"  ! policy search failed for '{question}': {e}")

        # For policy domains, require actual policy context; general can answer without it.
        if domain in ("hr", "admin") and not policy_context:
            print(f"  - skip (no policy): {question}")
            continue

        answer = _format_answer(question, policy_context)
        if not answer:
            print(f"  - skip (no answer): {question}")
            continue

        ok = AnswerCacheService.store(
            query=question,
            answer=answer,
            domain=domain,
            sub_intent="policy_query" if domain in ("hr", "admin") else "general",
            source_keys=None,
            is_seed=True,
        )
        if ok:
            stored += 1
            print(f"  + cached [{domain}] {question}")

    print(f"\nDone. Seeded {stored}/{len(seeds)} FAQ answers into the semantic cache.")


if __name__ == "__main__":
    main()
