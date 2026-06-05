"""Unit tests for the semantic router's tiering logic.

Pure logic — `knn` and the live config are stubbed, so these run with NO database and NO network
(no embedding model needed). Runnable either with pytest or directly:

    python -m tests.test_semantic_router
"""

from app.services import semantic_router_service as srs
from app.services.semantic_router_service import SemanticRouterService, Neighbor


# ── harness ──────────────────────────────────────────────────────────────────
_CFG = {"enabled": True, "mode": "live", "high_thresh": 0.75, "strong_thresh": 0.90,
        "ambig_low": 0.55, "agree_frac": 0.6, "k": 5}


def _patch(monkey_neighbors, cfg=None):
    """Stub knn() and semantic_router_cfg() for one classify() call."""
    srs.SemanticRouterService.knn = staticmethod(lambda query, k=5: monkey_neighbors)
    srs.llm_controls.semantic_router_cfg = lambda: dict(cfg or _CFG)


def _n(domain, sim, sub="x"):
    return Neighbor(domain=domain, sub_intent=sub, similarity=sim, utterance="u")


def _run(name, fn):
    fn()
    print(f"  ok  {name}")


# ── tests ──────────────────────────────────────────────────────────────────────
def test_exact_dictionary_hits_seed():
    # A seeded phrasing resolves via the O(1) dictionary — no knn/embedding, no network.
    d = SemanticRouterService.exact_match("Find Python developers")
    assert d is not None and d.tier == "exact", d
    assert d.domain == "hr" and d.sub_intent == "employee_search"
    assert d.similarity == 1.0


def test_exact_dictionary_is_case_and_space_insensitive():
    d = SemanticRouterService.exact_match("  find   PYTHON   developers ")
    assert d is not None and d.domain == "hr", d


def test_exact_dictionary_miss_returns_none():
    assert SemanticRouterService.exact_match("zxcv qwerty nonsense phrase") is None


def test_high_when_strong_and_agreeing():
    _patch([_n("hr", 0.91, "employee_search"), _n("hr", 0.88), _n("hr", 0.84),
            _n("it_support", 0.60), _n("hr", 0.58)])
    d = SemanticRouterService.classify("find python developers")
    assert d.tier == "high", d.tier
    assert d.domain == "hr"
    assert d.sub_intent == "employee_search"
    assert d.similarity == 0.91


def test_ambiguous_when_domains_disagree():
    # top sim is above high_thresh but below strong, and the top-k split across domains →
    # no agreement, no near-exact match → ambiguous
    _patch([_n("hr", 0.88), _n("it_support", 0.87), _n("admin", 0.86),
            _n("ms365", 0.85), _n("pmo", 0.84)])
    d = SemanticRouterService.classify("something mixed")
    assert d.tier == "ambiguous", d.tier
    # candidate_domains preserves best-first distinct order for the LLM hint
    assert d.candidate_domains[:3] == ["hr", "it_support", "admin"]


def test_strong_bypass_overrides_disagreement():
    # A near-exact seed match (>= strong_thresh) routes high even when neighbours disagree —
    # this is the "find python developers" case (sim 1.0, but 'python' pulls install neighbours).
    _patch([_n("hr", 0.99, "employee_search"), _n("it_support", 0.82),
            _n("pmo", 0.78), _n("it_support", 0.70), _n("hr", 0.66)])
    d = SemanticRouterService.classify("find python developers")
    assert d.tier == "high", d.tier
    assert d.domain == "hr" and d.sub_intent == "employee_search"


def test_ambiguous_when_midband_similarity():
    _patch([_n("admin", 0.70), _n("admin", 0.66), _n("admin", 0.64), _n("admin", 0.60), _n("admin", 0.58)])
    d = SemanticRouterService.classify("kinda admin-ish")
    assert d.tier == "ambiguous", d.tier  # agrees, but below high_thresh


def test_low_when_weak():
    _patch([_n("hr", 0.40), _n("admin", 0.38)])
    d = SemanticRouterService.classify("totally unrelated gibberish")
    assert d.tier == "low", d.tier


def test_unavailable_when_embedding_down():
    _patch(None)  # knn returns None → embedding model unreachable
    d = SemanticRouterService.classify("anything")
    assert d.tier == "unavailable", d.tier


def test_disabled_short_circuits():
    _patch([_n("hr", 0.99)], cfg={**_CFG, "mode": "off"})
    d = SemanticRouterService.classify("find python developers")
    assert d.tier == "unavailable", d.tier


def test_agree_frac_boundary():
    # 3/5 = 0.6 meets the default agree_frac exactly → high
    _patch([_n("hr", 0.90), _n("hr", 0.88), _n("hr", 0.86), _n("admin", 0.85), _n("pmo", 0.84)])
    d = SemanticRouterService.classify("boundary case")
    assert d.tier == "high", d.tier
    # 2/5 = 0.4 < 0.6 and top (0.88) < strong (0.90) → ambiguous
    _patch([_n("hr", 0.88), _n("hr", 0.86), _n("admin", 0.84), _n("pmo", 0.83), _n("ms365", 0.82)])
    d = SemanticRouterService.classify("boundary case 2")
    assert d.tier == "ambiguous", d.tier


def test_empty_neighbors_is_low():
    _patch([])
    d = SemanticRouterService.classify("")
    assert d.tier == "low", d.tier


def main():
    print("test_semantic_router:")
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            _run(name, fn)
    print("ALL PASSED")


if __name__ == "__main__":
    main()
