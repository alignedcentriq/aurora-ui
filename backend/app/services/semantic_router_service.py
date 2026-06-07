"""Embedding-based semantic intent router for Centriq AI.

Why this exists
---------------
The generative LLM router (router.py, a 3B model) has an *open* output space: it can anchor on a
stray token ("Python" → software install) and reason its way to the wrong domain. No prompt
tuning permanently fixes that. This service reframes routing as a *closed-set* nearest-neighbour
problem: the incoming message is embedded and matched against a table of labeled seed utterances
(``router_examples``) by pgvector cosine similarity. The output domain can only be one of the
stored labels — so the router structurally cannot hallucinate a domain.

What it does and does NOT touch
-------------------------------
It changes only the *classification* step (which domain + sub_intent). The seed table holds
example PHRASINGS, never ANSWERS. Live Zoho/Graph API calls, announcement DB reads, and
domain-manager prompt configs all run downstream of routing and are unaffected.

Infra reuse (no new dependencies)
---------------------------------
Mirrors AnswerCacheService: ``PolicyService._get_embedding`` (nomic-embed-text, 768-dim, LRU
cache, None on failure) for embeddings, ``_expand_query`` for acronym expansion, and pgvector's
``cosine_distance`` against the HNSW index on ``router_examples.embedding``.

Fail-soft contract: any embedding/DB failure yields tier="unavailable" so ``intent_router`` falls
back to the existing LLM router. This service never raises into the request path.
"""

from __future__ import annotations

import datetime
from dataclasses import dataclass, field

from app.database import SessionLocal
from app.models import RouterExample
from app.services import llm_controls_service as llm_controls
from app.services.policy_service import PolicyService, _expand_query
from app.router_seeds import ROUTER_SEEDS, _norm


@dataclass
class Neighbor:
    domain: str
    sub_intent: str
    similarity: float
    utterance: str
    entities: dict = field(default_factory=dict)


@dataclass
class SemanticDecision:
    # exact → dictionary hit (0 LLM, 0 network); high → embedding route (0 LLM);
    # ambiguous → hinted LLM; low → plain LLM; unavailable → LLM
    tier: str
    domain: str | None = None
    sub_intent: str | None = None
    similarity: float = 0.0
    entities: dict = field(default_factory=dict)
    neighbors: list[Neighbor] = field(default_factory=list)
    candidate_domains: list[str] = field(default_factory=list)  # distinct top-k domains, best-first → LLM hint
    reasoning: str = ""


# ── Fast Intent Dictionary ────────────────────────────────────────────────────────
# O(1) exact-match layer in front of the embedding call: normalise the query and look it
# up in an in-memory map of curated/learned phrasings. Microseconds, zero ml01 load, 100%
# precise (it's the labeled set itself). Catches the high-frequency head + every seeded
# exact phrasing; the embedding layer then only has to generalise to novel paraphrases.
# Seeded from ROUTER_SEEDS at import (already in-process — no DB read needed) and extended
# by add_example() as the router learns. Lookup cost is flat regardless of intent count.
_EXACT: dict[str, dict] = {
    _norm(s["utterance"]): {"domain": s["domain"], "sub_intent": s["sub_intent"],
                            "entities": s.get("entities") or {}}
    for s in ROUTER_SEEDS
}


class SemanticRouterService:
    # ── fast intent dictionary (layer 4.5) ────────────────────────────────────────
    @staticmethod
    def exact_match(query: str) -> SemanticDecision | None:
        """O(1) exact normalised lookup. Returns an 'exact' decision on hit, else None
        (caller falls through to the embedding layer). No network, never raises."""
        hit = _EXACT.get(_norm(query or ""))
        if not hit:
            return None
        return SemanticDecision(
            tier="exact",
            domain=hit["domain"],
            sub_intent=hit["sub_intent"],
            similarity=1.0,
            entities=dict(hit.get("entities") or {}),
            candidate_domains=[hit["domain"]],
            reasoning=f"exact intent dictionary -> {hit['domain']}/{hit['sub_intent']}",
        )

    # ── lookup ──────────────────────────────────────────────────────────────────
    @staticmethod
    def knn(query: str, k: int = 5) -> list[Neighbor] | None:
        """Top-k nearest seed utterances by cosine similarity, best-first.
        Returns None if the embedding model is unavailable (→ caller falls back to LLM)."""
        query = (query or "").strip()
        if not query:
            return []

        expanded, _ = _expand_query(query)
        emb = PolicyService._get_embedding(expanded)
        if not emb:
            return None  # embedding model unavailable

        db = SessionLocal()
        try:
            dist_expr = RouterExample.embedding.cosine_distance(emb)
            rows = (
                db.query(RouterExample, dist_expr.label("dist"))
                .filter(
                    RouterExample.embedding.isnot(None),
                    RouterExample.is_active.is_(True),
                )
                .order_by(dist_expr)
                .limit(k)
                .all()
            )
            return [
                Neighbor(
                    domain=r.domain,
                    sub_intent=r.sub_intent,
                    similarity=round(1.0 - float(dist), 4),
                    utterance=r.utterance,
                    entities=r.entities or {},
                )
                for (r, dist) in rows
            ]
        except Exception as e:  # noqa: BLE001 — never break the request path
            print(f"[SemanticRouter] knn skipped ({type(e).__name__}): {e}")
            return None
        finally:
            db.close()

    @staticmethod
    def classify(query: str, k: int | None = None) -> SemanticDecision:
        """Embed → k-NN → tiered decision. Reads thresholds from the live IT-tunable config."""
        cfg = llm_controls.semantic_router_cfg()
        if not cfg.get("enabled", True) or cfg.get("mode") == "off":
            return SemanticDecision(tier="unavailable", reasoning="semantic router disabled")

        high = float(cfg.get("high_thresh", 0.75))
        strong = float(cfg.get("strong_thresh", 0.90))
        ambig_low = float(cfg.get("ambig_low", 0.55))
        agree_frac = float(cfg.get("agree_frac", 0.6))
        k = int(k if k is not None else cfg.get("k", 5))

        neighbors = SemanticRouterService.knn(query, k=k)
        if neighbors is None:
            return SemanticDecision(tier="unavailable", reasoning="embedding model unavailable")
        if not neighbors:
            return SemanticDecision(tier="low", reasoning="no seed neighbours")

        top = neighbors[0]
        # distinct domains across the top-k, ordered by their best (first) appearance
        candidate_domains: list[str] = []
        for n in neighbors:
            if n.domain not in candidate_domains:
                candidate_domains.append(n.domain)
        agree = sum(1 for n in neighbors if n.domain == top.domain) / len(neighbors)

        base = dict(
            domain=top.domain, sub_intent=top.sub_intent, similarity=top.similarity,
            entities=dict(top.entities or {}), neighbors=neighbors,
            candidate_domains=candidate_domains,
        )

        # HIGH when neighbours agree on a strong match, OR when the top-1 is a near-exact match
        # to a curated seed (>= strong) regardless of agreement — an almost-identical labeled
        # phrasing is the highest-confidence signal available.
        if (top.similarity >= high and agree >= agree_frac) or top.similarity >= strong:
            why = "near-exact seed match" if top.similarity >= strong else f"agree={agree:.2f}"
            return SemanticDecision(
                tier="high",
                reasoning=f"semantic match sim={top.similarity} {why} -> {top.domain}/{top.sub_intent}",
                **base,
            )
        if top.similarity >= ambig_low:
            return SemanticDecision(
                tier="ambiguous",
                reasoning=f"semantic ambiguous sim={top.similarity} agree={agree:.2f}; candidates={candidate_domains}",
                **base,
            )
        return SemanticDecision(
            tier="low",
            reasoning=f"semantic weak sim={top.similarity} < {ambig_low}",
            **base,
        )

    # ── writes (seeding + self-learning) ──────────────────────────────────────────
    @staticmethod
    def add_example(utterance: str, domain: str, sub_intent: str,
                    entities: dict | None = None, source: str = "manual",
                    embedding: list | None = None) -> bool:
        """Idempotent upsert of one labeled example, keyed by normalised utterance.

        If ``embedding`` is supplied (e.g. ChatFeedback.user_message_embedding for a confirmed
        correction) it is reused verbatim — zero re-embed. Otherwise the utterance is embedded
        now. Returns False on any failure (fail-soft)."""
        utterance = (utterance or "").strip()
        if not utterance or not domain or not sub_intent:
            return False
        norm = _norm(utterance)

        if embedding is None:
            expanded, _ = _expand_query(utterance)
            embedding = PolicyService._get_embedding(expanded)
            # embedding may still be None (model down) — we persist the row anyway so a later
            # re-seed pass can back-fill it; knn() filters out NULL-embedding rows meanwhile.

        db = SessionLocal()
        try:
            row = db.query(RouterExample).filter(RouterExample.utterance_norm == norm).first()
            if row is None:
                row = RouterExample(utterance=utterance, utterance_norm=norm)
                db.add(row)
            row.domain = domain
            row.sub_intent = sub_intent
            row.entities = entities or {}
            row.source = source
            row.is_active = True
            if embedding is not None:
                row.embedding = embedding
            row.created_at = row.created_at or datetime.datetime.utcnow()
            db.commit()
            # Keep the in-memory exact-match dictionary in sync so a learned/corrected
            # phrasing gets the O(1) path on the next identical query (no restart needed).
            _EXACT[norm] = {"domain": domain, "sub_intent": sub_intent, "entities": entities or {}}
            return True
        except Exception as e:  # noqa: BLE001
            db.rollback()
            print(f"[SemanticRouter] add_example skipped ({type(e).__name__}): {e}")
            return False
        finally:
            db.close()

    @staticmethod
    def seed_from_catalog() -> dict:
        """Idempotently load ROUTER_SEEDS. Inserts missing rows and back-fills rows whose
        embedding is NULL (e.g. ml01 was down on a prior boot). Safe to run on every startup.
        Designed to run in a daemon thread — embeds one seed per Ollama call (LRU-cached)."""
        inserted = embedded = skipped = failed = 0
        db = SessionLocal()
        try:
            existing = {
                r.utterance_norm: r
                for r in db.query(RouterExample).filter(RouterExample.source != "manual").all()
            }
        except Exception as e:  # noqa: BLE001
            print(f"[SemanticRouter] seed_from_catalog read failed ({type(e).__name__}): {e}")
            db.close()
            return {"error": str(e)}
        finally:
            db.close()

        for seed in ROUTER_SEEDS:
            norm = _norm(seed["utterance"])
            row = existing.get(norm)
            # Skip only if the row is embedded AND the domain/sub_intent are already correct.
            # If domain or sub_intent changed in the catalog, re-apply via add_example (upsert).
            if (row is not None and row.embedding is not None
                    and row.domain == seed["domain"]
                    and row.sub_intent == seed["sub_intent"]):
                skipped += 1
                continue
            expanded, _ = _expand_query(seed["utterance"])
            emb = PolicyService._get_embedding(expanded)
            ok = SemanticRouterService.add_example(
                utterance=seed["utterance"], domain=seed["domain"],
                sub_intent=seed["sub_intent"], entities=seed.get("entities") or {},
                source="seed", embedding=emb,
            )
            if not ok:
                failed += 1
            elif row is None:
                inserted += 1
                embedded += 1 if emb is not None else 0
            else:
                embedded += 1 if emb is not None else 0

        summary = {"total": len(ROUTER_SEEDS), "inserted": inserted,
                   "embedded": embedded, "skipped": skipped, "failed": failed}
        print(f"[SemanticRouter] seed_from_catalog: {summary}")
        return summary
