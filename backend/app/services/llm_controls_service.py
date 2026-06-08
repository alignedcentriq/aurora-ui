"""Runtime LLM controls — IT's live levers over the AI.

Single source of truth for the settings IT can change at runtime without a restart:

  * chat_enabled       — global kill switch for all AI chat
  * disabled_domains   — turn off individual domain agents (hr/admin/it_support/…)
  * max_concurrency    — GPU load throttle (cap on simultaneous generations)
  * max_queue          — bounded wait queue size
  * tiers              — per-tier model params (model, temperature, max_tokens, timeout)

Persistence reuses the existing ``company_settings`` key-value table (one JSON blob
under the key ``llm_controls``) so changes survive restarts. A short-TTL in-process
cache bounds DB reads to ~1 per worker per ``_TTL`` seconds and propagates an IT
change to every worker within that window — no restart, no redeploy.

Defaults mirror today's ``settings.*`` so an absent/empty row behaves exactly as the
app did before this feature existed: nothing changes until IT explicitly overrides.

The ``get_llm()`` factory replaces the module-level ``ChatOpenAI`` singletons that
used to be built once at import. It returns a cached client keyed by the effective
parameter signature, so the object is reused on the hot path and transparently
rebuilt only when IT changes a value.
"""
from __future__ import annotations

import datetime
import json
import threading
import time
from typing import Any, Optional

from langchain_openai import ChatOpenAI

from app.config import settings
from app.services.company_settings_service import CompanySettingsService

_KEY = "llm_controls"
_TTL = 5.0  # seconds — propagation window across workers

# Domains an admin may switch off. Mirrors the router's DOMAIN_REGISTRY keys minus
# "general"/"deeplink" (greetings + navigation must always work). Hardcoded to avoid
# importing the router (which pulls in every agent) at this low level.
DISABLEABLE_DOMAINS = ["hr", "admin", "it_support", "pmo", "ms365", "functional_manager"]

VALID_TIERS = ("agent", "service", "router", "general", "summarizer")

# What Ollama capabilities each tier requires.  "tools" means the model must support
# bind_tools() / with_structured_output() — without it the tier will error at runtime.
TIER_REQUIREMENTS: dict[str, list[str]] = {
    "agent":      ["tools"],   # HR/MS365 reasoning — bind_tools()
    "service":    ["tools"],   # Admin/IT/PMO/Manager — bind_tools()
    "router":     ["tools"],   # Intent routing — with_structured_output()
    "general":    [],
    "summarizer": [],
}

# Connection (base_url + api_key) is fixed per tier and NOT IT-editable — it points
# at the shared Aligned server. Only model/temperature/max_tokens/timeout are tunable.
_TIER_CONN = {
    "agent": (settings.AGENT_BASE_URL, settings.AGENT_API_KEY),
    "service": (settings.AGENT_BASE_URL, settings.AGENT_API_KEY),
    "router": (settings.ROUTER_BASE_URL, settings.ROUTER_API_KEY),
    "general": (settings.AGENT_BASE_URL, settings.AGENT_API_KEY),
    "summarizer": (settings.AGENT_BASE_URL, settings.AGENT_API_KEY),
}

# Bounds enforced server-side on every write (defense in depth — never trust client).
BOUNDS = {
    "temperature": (0.0, 2.0),
    "max_tokens": (1, 8192),       # or null (= use the call-site default)
    "timeout": (5, 300),           # or null (= use the call-site default)
    "max_concurrency": (1, 64),
    "max_queue": (0, 500),
    "sr_high_thresh": (0.0, 1.0),
    "sr_strong_thresh": (0.0, 1.0),
    "sr_ambig_low": (0.0, 1.0),
    "sr_agree_frac": (0.0, 1.0),
    "sr_k": (1, 25),
}

SR_MODES = ("live", "off")


def known_models() -> list[str]:
    """Static fallback allow-list (the models this app is known to use). Used when
    the live server list can't be reached, so a model change is never validated
    against nothing."""
    candidates = {
        settings.AGENT_MODEL_NAME,
        settings.ROUTER_MODEL_NAME,
        settings.FAST_MODEL_NAME,
        settings.GENERAL_MODEL_NAME,
        settings.SUMMARIZER_MODEL_NAME,
        "gpt-oss:latest",
        "llama3.2:3b",
        "llama3.1:8b",
    }
    return sorted(c for c in candidates if c)


# ── live model availability (Ollama /api/tags) ─────────────────────────────────
# Changing a tier's model is the one genuinely dangerous knob: pointing a tier at a
# model that isn't pulled on the server breaks every request in that tier. So we
# validate the chosen model against what the server actually has loaded, and only
# fall back to the static allow-list if the server can't be reached.
_models_cache: tuple[float, Optional[list[str]]] = (0.0, None)
_MODELS_TTL = 60.0


def _tags_url() -> str:
    root = settings.AGENT_BASE_URL.rstrip("/")
    if root.endswith("/v1"):
        root = root[:-3]
    return root.rstrip("/") + "/api/tags"


def available_models() -> Optional[list[str]]:
    """Models currently pulled on the Ollama server, or None if it can't be reached.
    Cached for ``_MODELS_TTL`` seconds."""
    global _models_cache
    now = time.time()
    if _models_cache[1] is not None and (now - _models_cache[0]) < _MODELS_TTL:
        return _models_cache[1]
    try:
        import urllib.request
        with urllib.request.urlopen(_tags_url(), timeout=3) as resp:  # noqa: S310 — internal host
            data = json.loads(resp.read().decode("utf-8"))
        names = sorted({m.get("name", "") for m in data.get("models", []) if m.get("name")})
        if names:
            _models_cache = (now, names)
            return names
    except Exception as exc:  # noqa: BLE001
        pass
    return None


def _show_url() -> str:
    root = settings.AGENT_BASE_URL.rstrip("/")
    if root.endswith("/v1"):
        root = root[:-3]
    return root.rstrip("/") + "/api/show"


_cap_cache: dict[str, tuple[float, dict]] = {}
_CAP_TTL = 300.0  # 5 minutes


def model_capabilities(model_name: str) -> dict:
    """Return Ollama-reported capabilities for a model via /api/show.

    Result: {model, capabilities: list[str], supports_tools: bool, error: str|None}
    Cached 5 minutes per model name.  Always returns a valid dict (never raises).
    """
    now = time.time()
    cached = _cap_cache.get(model_name)
    if cached and (now - cached[0]) < _CAP_TTL:
        return cached[1]

    result: dict = {"model": model_name, "capabilities": [], "supports_tools": False, "error": None}
    try:
        import urllib.request as _urlreq
        body = json.dumps({"model": model_name}).encode()
        req = _urlreq.Request(
            _show_url(), data=body, method="POST",
            headers={"Content-Type": "application/json"},
        )
        with _urlreq.urlopen(req, timeout=6) as resp:  # noqa: S310 — internal host
            info = json.loads(resp.read().decode("utf-8"))
        caps = info.get("capabilities") or []
        result["capabilities"] = caps
        result["supports_tools"] = "tools" in caps
    except Exception as exc:  # noqa: BLE001
        result["error"] = str(exc)

    _cap_cache[model_name] = (now, result)
    return result


def _defaults() -> dict[str, Any]:
    """Effective config when IT has overridden nothing. Mirrors current behavior:
    summarizer/general use FAST_MODEL_NAME (the dedicated *_MODEL_NAME env vars are
    not wired into the live LLMs today, so we don't change that here). max_tokens and
    timeout default to None → each call site keeps its own historical default."""
    return {
        "chat_enabled": True,
        "disabled_domains": [],
        "max_concurrency": settings.CHAT_MAX_CONCURRENCY,
        "max_queue": settings.CHAT_MAX_QUEUE,
        "tiers": {
            "agent":      {"model": settings.AGENT_MODEL_NAME,  "temperature": settings.AGENT_TEMPERATURE, "max_tokens": None, "timeout": None},
            "service":    {"model": settings.SERVICE_MODEL_NAME, "temperature": 0.0, "max_tokens": None, "timeout": None},
            "router":     {"model": settings.ROUTER_MODEL_NAME, "temperature": 0.0, "max_tokens": None, "timeout": None},
            "general":    {"model": settings.FAST_MODEL_NAME,   "temperature": 0.7, "max_tokens": None, "timeout": None},
            "summarizer": {"model": settings.FAST_MODEL_NAME,   "temperature": 0.3, "max_tokens": None, "timeout": None},
        },
        # Embedding-based intent router. mode="off" is the instant kill-switch back to the
        # pure LLM router (the go-live safety net). Thresholds are IT-tunable at runtime.
        "semantic_router": {
            "enabled": settings.SEMANTIC_ROUTER_ENABLED,
            "mode": "live",                                 # live | off
            "high_thresh": settings.SEMANTIC_ROUTER_HIGH_THRESHOLD,
            "strong_thresh": settings.SEMANTIC_ROUTER_STRONG_THRESHOLD,
            "ambig_low": settings.SEMANTIC_ROUTER_AMBIG_LOW,
            "agree_frac": settings.SEMANTIC_ROUTER_AGREE_FRAC,
            "k": settings.SEMANTIC_ROUTER_K,
        },
    }


def defaults() -> dict[str, Any]:
    """Public copy of the env-derived defaults (for the GET endpoint / reset hints)."""
    return _defaults()


# Per-tier hardcoded fallback values used by call sites when IT has set no override.
# Exposed via the API so the UI can show "Default (45 s)" instead of a bare "Default".
TIER_CALL_DEFAULTS: dict[str, dict[str, Any]] = {
    "agent":      {"max_tokens": None, "timeout": 45},
    "service":    {"max_tokens": None, "timeout": 120},
    "router":     {"max_tokens": 256,  "timeout": 30},
    "general":    {"max_tokens": None, "timeout": 20},
    "summarizer": {"max_tokens": None, "timeout": 20},
}


# ── cache ────────────────────────────────────────────────────────────────────
_lock = threading.Lock()
_cache: Optional[dict[str, Any]] = None
_cache_at = 0.0


def _invalidate() -> None:
    global _cache, _cache_at
    with _lock:
        _cache = None
        _cache_at = 0.0


def _deep_merge(base: dict, over: dict) -> dict:
    """Recursively merge ``over`` onto a copy of ``base`` (dicts only; lists/scalars replace)."""
    out = dict(base)
    for k, v in over.items():
        if isinstance(v, dict) and isinstance(out.get(k), dict):
            out[k] = _deep_merge(out[k], v)
        else:
            out[k] = v
    return out


def get_config() -> dict[str, Any]:
    """Effective config: stored overrides merged over env defaults. Cached for ``_TTL``s."""
    global _cache, _cache_at
    now = time.time()
    if _cache is not None and (now - _cache_at) < _TTL:
        return _cache

    merged = _defaults()
    try:
        raw = CompanySettingsService.get(_KEY)
        if raw and raw.strip():
            stored = json.loads(raw)
            if isinstance(stored, dict):
                merged = _deep_merge(merged, stored)
    except Exception as exc:  # noqa: BLE001 — never let config errors break chat
        pass

    with _lock:
        _cache = merged
        _cache_at = now
    return merged


# ── convenience accessors (hot path) ───────────────────────────────────────────
def is_chat_enabled() -> bool:
    return bool(get_config().get("chat_enabled", True))



def disabled_domains() -> list[str]:
    return list(get_config().get("disabled_domains", []) or [])


def is_domain_enabled(domain: str) -> bool:
    return domain not in disabled_domains()


def concurrency_limits() -> tuple[int, int]:
    cfg = get_config()
    return int(cfg.get("max_concurrency", settings.CHAT_MAX_CONCURRENCY)), int(
        cfg.get("max_queue", settings.CHAT_MAX_QUEUE)
    )


def tier_params(tier: str) -> dict[str, Any]:
    if tier not in VALID_TIERS:
        raise ValueError(f"unknown tier {tier!r}")
    return get_config()["tiers"][tier]


def semantic_router_cfg() -> dict[str, Any]:
    """Effective semantic-router config (enabled/mode/thresholds). Falls back to the
    env defaults if an older stored blob has no semantic_router section."""
    cfg = get_config().get("semantic_router") or {}
    d = _defaults()["semantic_router"]
    return {**d, **cfg}


# ── LLM factory ────────────────────────────────────────────────────────────────
_LLM_CACHE: dict[tuple, ChatOpenAI] = {}


def get_llm(tier: str, *, default_timeout: Optional[float] = None,
            default_max_tokens: Optional[int] = None) -> ChatOpenAI:
    """Return a ChatOpenAI for ``tier`` built from the live IT-tunable params.

    ``default_timeout`` / ``default_max_tokens`` are the call site's historical
    values; they apply only when IT has not set a tier-level override (the stored
    value is None). Cached by the effective signature so the client is reused until
    a parameter actually changes, then rebuilt transparently.
    """
    cfg = tier_params(tier)
    base_url, api_key = _TIER_CONN[tier]
    model = cfg["model"]
    temperature = cfg["temperature"]
    max_tokens = cfg["max_tokens"] if cfg.get("max_tokens") is not None else default_max_tokens
    timeout = cfg["timeout"] if cfg.get("timeout") is not None else default_timeout

    sig = (tier, base_url, model, temperature, max_tokens, timeout)
    cached = _LLM_CACHE.get(sig)
    if cached is not None:
        return cached

    kwargs: dict[str, Any] = dict(
        base_url=base_url, api_key=api_key, model=model,
        temperature=temperature, max_retries=2, timeout=timeout,
        # Include token usage in the final streaming chunk (stream_options.include_usage).
        # Required for the observability token charts — without this, usage_metadata is None.
        stream_usage=True,
        # Ask Ollama to keep this model in VRAM for 15 min after each call.
        # Default is 5 min; extending it 3x dramatically reduces cold-reload
        # evictions when the shared ml01 server is under concurrent load.
        extra_body={"keep_alive": "15m"},
    )
    if max_tokens is not None:
        kwargs["max_tokens"] = max_tokens
    llm = ChatOpenAI(**kwargs)
    _LLM_CACHE[sig] = llm
    return llm


# ── writes (IT endpoints) ───────────────────────────────────────────────────────
def _check_range(name: str, value) -> None:
    lo, hi = BOUNDS[name]
    if not (lo <= value <= hi):
        raise ValueError(f"{name} must be between {lo} and {hi} (got {value})")


def _validate_patch(patch: dict) -> dict:
    """Validate a partial update and return a clean patch. Raises ValueError on bad input."""
    if not isinstance(patch, dict):
        raise ValueError("patch must be an object")
    clean: dict[str, Any] = {}

    if "chat_enabled" in patch:
        clean["chat_enabled"] = bool(patch["chat_enabled"])

    if "disabled_domains" in patch:
        doms = patch["disabled_domains"] or []
        if not isinstance(doms, list):
            raise ValueError("disabled_domains must be a list")
        bad = [d for d in doms if d not in DISABLEABLE_DOMAINS]
        if bad:
            raise ValueError(f"unknown domain(s): {bad}")
        clean["disabled_domains"] = list(dict.fromkeys(doms))  # dedupe, preserve order

    for fld in ("max_concurrency", "max_queue"):
        if fld in patch:
            v = int(patch[fld])
            _check_range(fld, v)
            clean[fld] = v

    if "semantic_router" in patch:
        sr = patch["semantic_router"]
        if not isinstance(sr, dict):
            raise ValueError("semantic_router must be an object")
        csr: dict[str, Any] = {}
        if "enabled" in sr:
            csr["enabled"] = bool(sr["enabled"])
        if "mode" in sr:
            mode = (sr["mode"] or "").strip().lower()
            if mode not in SR_MODES:
                raise ValueError(f"semantic_router.mode must be one of {SR_MODES}")
            csr["mode"] = mode
        for fld, key in (("high_thresh", "sr_high_thresh"), ("strong_thresh", "sr_strong_thresh"),
                         ("ambig_low", "sr_ambig_low"), ("agree_frac", "sr_agree_frac")):
            if fld in sr:
                v = float(sr[fld])
                _check_range(key, v)
                csr[fld] = v
        if "k" in sr:
            k = int(sr["k"])
            _check_range("sr_k", k)
            csr["k"] = k
        if csr:
            clean["semantic_router"] = csr

    if "tiers" in patch:
        tiers = patch["tiers"]
        if not isinstance(tiers, dict):
            raise ValueError("tiers must be an object")
        clean_tiers: dict[str, Any] = {}
        # Prefer the live server list (authoritative); fall back to the static
        # allow-list only when the server is unreachable.
        live = available_models()
        allowed = set(live) if live is not None else set(known_models())
        for tname, tcfg in tiers.items():
            if tname not in VALID_TIERS:
                raise ValueError(f"unknown tier: {tname}")
            if not isinstance(tcfg, dict):
                raise ValueError(f"tier {tname} must be an object")
            ct: dict[str, Any] = {}
            if "model" in tcfg:
                m = (tcfg["model"] or "").strip()
                if m not in allowed:
                    src = "loaded on the server" if live is not None else "in the known model list"
                    raise ValueError(
                        f"model {m!r} is not {src}. Available: {sorted(allowed)}"
                    )
                ct["model"] = m
            if "temperature" in tcfg:
                t = float(tcfg["temperature"])
                _check_range("temperature", t)
                ct["temperature"] = t
            if "max_tokens" in tcfg:
                mt = tcfg["max_tokens"]
                if mt is not None and mt != "":
                    mt = int(mt)
                    _check_range("max_tokens", mt)
                    ct["max_tokens"] = mt
                else:
                    ct["max_tokens"] = None
            if "timeout" in tcfg:
                to = tcfg["timeout"]
                if to is not None and to != "":
                    to = int(to)
                    _check_range("timeout", to)
                    ct["timeout"] = to
                else:
                    ct["timeout"] = None
            if ct:
                clean_tiers[tname] = ct
        if clean_tiers:
            clean["tiers"] = clean_tiers

    return clean


def update_config(patch: dict, updated_by: str = "") -> dict[str, Any]:
    """Validate + deep-merge a partial update into the stored config, persist, and
    invalidate the cache. Returns the new effective config."""
    clean = _validate_patch(patch)
    current = get_config()
    new = _deep_merge(current, clean)
    CompanySettingsService.set(_KEY, json.dumps(new), updated_by=updated_by)
    _invalidate()
    return new


def reset_config(updated_by: str = "") -> dict[str, Any]:
    """Clear all overrides — revert to env defaults."""
    CompanySettingsService.set(_KEY, "", updated_by=updated_by)
    _invalidate()
    return _defaults()


def get_meta() -> dict[str, Optional[str]]:
    """Who last changed the config and when (for the UI footer)."""
    from app.database import SessionLocal
    from app.models import CompanySettings
    db = SessionLocal()
    try:
        row = db.query(CompanySettings).filter(CompanySettings.key == _KEY).first()
        if not row or not (row.value or "").strip():
            return {"updated_by": None, "updated_at": None}
        return {
            "updated_by": row.updated_by,
            "updated_at": row.updated_at.isoformat() if isinstance(row.updated_at, datetime.datetime) else None,
        }
    finally:
        db.close()
