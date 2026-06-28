"""Action registry package. Importing it registers every catalog action (import side effects).

    from app.services import actions
    spec = actions.get("it_ticket")
    result = actions.dispatch(spec, actions.ActionContext(actor_email=..., params=...))
"""

from app.services.actions.registry import (  # noqa: F401
    ActionContext,
    ActionResult,
    ActionSpec,
    all_specs,
    dispatch,
    get,
    register,
    run,
)

# Import each catalog module so its register(...) call runs.
from app.services.actions.catalog import hr_query as _hr_query  # noqa: F401,E402
from app.services.actions.catalog import it_ticket as _it_ticket  # noqa: F401,E402
from app.services.actions.catalog import onboarding_step as _onboarding_step  # noqa: F401,E402
