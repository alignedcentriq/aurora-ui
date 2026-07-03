"""Super Admin-only endpoints for the runtime LLM controls (kill switch, load throttle,
per-tier model params, per-domain disable). Gated by ``require_super_admin``."""
from fastapi import APIRouter, Body, Depends, HTTPException, Query

from app.auth import CurrentUser, require_super_admin
from app.services import llm_controls_service as llm_controls

router = APIRouter(prefix="/api/it/llm-controls", tags=["llm-controls"])


@router.get("")
async def get_llm_controls(_: CurrentUser = Depends(require_super_admin)):
    """Current effective config plus the metadata the UI needs to render the
    editor: env defaults, validation bounds, the model allow-list, disableable
    domains, tier names, and who last changed it."""
    live = llm_controls.available_models()
    return {
        "effective": llm_controls.get_config(),
        "defaults": llm_controls.defaults(),
        "tier_call_defaults": llm_controls.TIER_CALL_DEFAULTS,
        "bounds": {k: list(v) for k, v in llm_controls.BOUNDS.items()},
        # Authoritative list (what's actually pulled on the server) when reachable;
        # otherwise the static known list so the dropdown is never empty.
        "models": live if live is not None else llm_controls.known_models(),
        "models_live": live is not None,
        "domains": llm_controls.DISABLEABLE_DOMAINS,
        "tiers": list(llm_controls.VALID_TIERS),
        **llm_controls.get_meta(),
    }


@router.put("")
async def update_llm_controls(
    patch: dict = Body(...),
    user: CurrentUser = Depends(require_super_admin),
):
    """Validate + persist a partial update. Bounds are enforced server-side."""
    old_config = llm_controls.get_config()
    try:
        new = llm_controls.update_config(patch, updated_by=user.email)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    from app.services import activity_log_service
    activity_log_service.emit(
        user.email, "settings", "settings_llm_controls",
        "{actor} updated LLM controls (" + ", ".join(patch.keys()) + ").",
        target_type="setting", target_id="llm_controls", target_name="LLM Model Controls",
        old_value=old_config, new_value=new,
    )

    return {"status": "ok", "effective": new, **llm_controls.get_meta()}


@router.get("/model-capabilities")
async def get_model_capabilities(
    model: str = Query(..., description="Model name to check"),
    _: CurrentUser = Depends(require_super_admin),
):
    """Fetch Ollama-reported capabilities for a model and compare against per-tier requirements.
    Used by the UI to warn IT before applying a model that lacks required capabilities."""
    result = llm_controls.model_capabilities(model)
    # Annotate which tiers this model would be incompatible with
    incompatible = [
        tier for tier, reqs in llm_controls.TIER_REQUIREMENTS.items()
        if reqs and not all(c in result["capabilities"] for c in reqs)
    ]
    result["incompatible_tiers"] = incompatible
    result["tier_requirements"] = llm_controls.TIER_REQUIREMENTS
    return result


@router.get("/capacity")
async def get_capacity(_: CurrentUser = Depends(require_super_admin)):
    """Live capacity picture across all three layers, for the LLM controls dashboard:

      * gate      — our app admission queue (how many chats are running the LLM chain
                    right now / waiting / the caps that bound them).
      * ollama    — the *real* GPU/CPU placement of every loaded model on ml01 (from
                    /api/ps). Surfaces CPU eviction, the usual "requests never finish" cause.
      * capacity  — how many concurrent requests the system actually admits, plus any
                    server-side Ollama parallelism knobs visible from here.

    Read-only. Cached ~3s server-side so many admin pollers issue one ml01 probe."""
    from app.concurrency import chat_gate

    gate = await chat_gate.stats()
    residency = llm_controls.ollama_residency()
    parallel = llm_controls.ollama_parallelism()

    try:
        from app.services.llm_resilience import get_breaker_status
        breakers = get_breaker_status()
    except Exception:  # noqa: BLE001
        breakers = {}

    max_conc, max_queue = llm_controls.concurrency_limits()
    return {
        "gate": gate,
        "ollama": residency,
        "capacity": {
            # The authoritative ceiling on simultaneous generations is our app gate,
            # since the shared server can't be tuned from here.
            "max_concurrency": max_conc,
            "max_queue": max_queue,
            "loaded_models": len(residency.get("models") or []),
            "ollama_parallel": parallel,
            # Safe ceiling for max_concurrency (drives the editor's validation).
            "server_capacity": llm_controls.server_capacity(),
        },
        "circuit_breakers": breakers,
    }


@router.post("/reset")
async def reset_llm_controls(user: CurrentUser = Depends(require_super_admin)):
    """Clear all overrides — revert to env defaults."""
    old_config = llm_controls.get_config()
    new = llm_controls.reset_config(updated_by=user.email)

    from app.services import activity_log_service
    activity_log_service.emit(
        user.email, "settings", "settings_llm_controls_reset",
        "{actor} reset LLM controls to defaults.",
        target_type="setting", target_id="llm_controls", target_name="LLM Model Controls",
        old_value=old_config, new_value=new,
    )

    return {"status": "ok", "effective": new, **llm_controls.get_meta()}


