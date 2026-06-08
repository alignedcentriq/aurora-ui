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
    try:
        new = llm_controls.update_config(patch, updated_by=user.email)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
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


@router.post("/reset")
async def reset_llm_controls(user: CurrentUser = Depends(require_super_admin)):
    """Clear all overrides — revert to env defaults."""
    new = llm_controls.reset_config(updated_by=user.email)
    return {"status": "ok", "effective": new, **llm_controls.get_meta()}


