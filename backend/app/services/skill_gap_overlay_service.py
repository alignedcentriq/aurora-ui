"""
Skill-gap × allocation overlay — the join no single portal does today.

Alchemy's skill-gap dashboard benchmarks our skill COVERAGE against the external
job MARKET (demand = postings × companies). It answers "the market wants X and few
of our people have it." It has no idea whether the people who DO have X are actually
free to staff — they might all be billable-locked on live projects.

This service supplies the missing half: it crosses each high-gap skill's holders
against the EmployeeAllocation feed to compute DEPLOYABLE coverage (free capacity),
who's billable-locked, and who rolls off soon — then tags each skill with the
buy / train / redeploy decision a staffing manager actually needs.

Primary lens (chosen 2026-06-23): "what can't we staff?" — rank by high market
demand AND low deployable coverage.

SOURCES:
  • skill gaps  → Alchemy /skills/skill-gap-analysis/table (demand, coverage, holders)
  • availability→ EmployeeAllocation, matched to holders by NAME (the shared key,
                  same convention as resource_matching_service).
"""

import datetime
from typing import Optional

from sqlalchemy import func

from app.database import SessionLocal
from app.models import EmployeeAllocation
from app.services import alchemy_service
from app.services.resource_matching_service import _alchemy_token

import logging
log = logging.getLogger("aurora-logger")

# A holder counts as "deployable" if they have at least this much free capacity.
_DEPLOYABLE_FREE_PCT = 40.0
# Booked holders rolling off within this horizon are "freeing up soon".
_ROLLOFF_HORIZON_DAYS = 45


class SkillSupplyService:

    @classmethod
    def analyze(
        cls,
        user_email: Optional[str] = None,
        top_n: int = 10,
        today: Optional[datetime.date] = None,
    ) -> dict:
        """Return the gap × availability overlay for the top-N hardest-to-staff skills.

        Result: {ok, source, rows:[...], summary:{...}, generated_on, note?} or
        {ok: False, message} when Alchemy can't be reached (e.g. not connected).
        """
        today = today or datetime.date.today()
        token = _alchemy_token(user_email)
        if not token:
            return {
                "ok": False,
                "message": (
                    "Skill-supply analysis needs a live Alchemy connection. "
                    "Connect your Microsoft account (Settings > Connected Accounts) and retry."
                ),
            }

        # 1) Top gaps from Alchemy (one call) — sorted worst-first by gap.
        try:
            data = alchemy_service.get_skill_gap_table(
                token, page=1, page_size=max(top_n * 2, 30),
                sort_by="gap", sort_order="desc",
            )
        except PermissionError:
            return {"ok": False, "message": "Alchemy denied access — please reconnect Microsoft."}
        except Exception as exc:
            log.warning("[skill_supply] gap table fetch failed: %s", exc)
            return {"ok": False, "message": f"Couldn't load Alchemy skill-gap data: {exc}"}

        gaps = data.get("skill_gaps") or []
        if not gaps:
            return {"ok": True, "source": "Alchemy", "rows": [],
                    "summary": {}, "generated_on": today.isoformat()}

        # 2) One DB pass: availability for every holder named across these skills.
        all_names = {
            (h.get("name") or "").strip()
            for g in gaps for h in (g.get("employee_names_preview") or [])
            if (h.get("name") or "").strip()
        }
        avail = cls._availability_map(all_names, today)

        # 3) Overlay each skill and classify.
        rows = []
        preview_capped = False
        for g in gaps:
            holders = [(h.get("name") or "").strip()
                       for h in (g.get("employee_names_preview") or [])
                       if (h.get("name") or "").strip()]
            coverage_count = int(g.get("coverage_count") or 0)
            if coverage_count and len(holders) < coverage_count:
                preview_capped = True  # preview shorter than the true count

            deployable, locked, rolloff = [], [], []
            for name in holders:
                a = avail.get(name.lower())
                if a is None or a["free"] >= _DEPLOYABLE_FREE_PCT:
                    deployable.append(name)
                else:
                    locked.append(name)
                    if a["earliest_free"] and a["earliest_free"] <= today + datetime.timedelta(days=_ROLLOFF_HORIZON_DAYS):
                        rolloff.append({"name": name, "date": a["earliest_free"].isoformat()})

            demand = float(g.get("demand") or 0)
            action, rationale = cls._classify(
                demand=demand, coverage_count=coverage_count,
                deployable=len(deployable), rolloff=len(rolloff),
            )
            # Higher = harder to staff: strong market pull, weak deployable bench.
            deployable_score = min(len(deployable), 10) / 10 * 100
            supply_risk = round(demand - deployable_score, 1)

            rows.append({
                "skill_id": g.get("skill_id"),
                "skill_name": g.get("skill_name"),
                "status": g.get("status"),
                "is_external": bool(g.get("is_external")),
                "demand": demand,
                "demand_jobs": g.get("demand_jobs"),
                "demand_companies": g.get("demand_companies"),
                "coverage_pct": g.get("coverage"),
                "coverage_count": coverage_count,
                "deployable_count": len(deployable),
                "locked_count": len(locked),
                "deployable_names": deployable[:8],
                "rolling_off": rolloff[:8],
                "supply_risk": supply_risk,
                "action": action,
                "rationale": rationale,
            })

        # Hardest-to-staff first.
        rows.sort(key=lambda r: r["supply_risk"], reverse=True)
        rows = rows[:top_n]

        summary = {
            "buy": sum(1 for r in rows if r["action"] == "BUY"),
            "train": sum(1 for r in rows if r["action"] == "TRAIN"),
            "redeploy": sum(1 for r in rows if r["action"] == "REDEPLOY"),
            "staffable": sum(1 for r in rows if r["action"] == "STAFFABLE"),
        }
        out = {
            "ok": True, "source": "Alchemy", "rows": rows, "summary": summary,
            "generated_on": today.isoformat(),
        }
        if preview_capped:
            out["note"] = ("Holder lists are Alchemy previews; deployable counts for the "
                           "largest skills may be slightly understated.")
        return out

    # ── helpers ───────────────────────────────────────────────────────────────

    @classmethod
    def _availability_map(cls, names: set[str], today: datetime.date) -> dict:
        """name(lower) → {load, free, earliest_free} for everyone named, in one pass.

        Capacity is computed from each person's LATEST allocation snapshot (not summed
        across months) and `earliest_free` is the real project rolloff (next-snapshot
        diff) — NOT the LWD/attrition date. Delegates to allocation_snapshot_service so
        the math matches resource matching. A name with no rows is absent (fully free).
        """
        if not names:
            return {}
        from app.services import allocation_snapshot_service as snap
        db = SessionLocal()
        try:
            full = snap.current_load_map(db, names, as_of=today)
        finally:
            db.close()
        return {k: {"load": v["load"], "free": v["free"], "earliest_free": v["earliest_free"]}
                for k, v in full.items()}

    @staticmethod
    def _classify(demand: float, coverage_count: int, deployable: int, rolloff: int):
        """Map (demand, holders, deployable, rolling-off) → buy/train/redeploy/staffable."""
        if deployable > 0:
            return "STAFFABLE", f"{deployable} holder(s) have free capacity now."
        # Nobody deployable right now:
        if rolloff > 0:
            return "REDEPLOY", f"{rolloff} holder(s) roll off within {_ROLLOFF_HORIZON_DAYS} days — plan to redeploy."
        if coverage_count <= 3:
            return "BUY", f"Only {coverage_count} people have it and none are free — hire to meet demand."
        return "TRAIN", f"{coverage_count} have it but all are booked with none rolling off — upskill more people."

    # ── chat rendering (for the PMO agent tool) ────────────────────────────────

    @classmethod
    def render(cls, user_email: Optional[str] = None, top_n: int = 8) -> str:
        res = cls.analyze(user_email=user_email, top_n=top_n)
        if not res.get("ok"):
            return res.get("message", "Skill-supply analysis is unavailable right now.")
        rows = res.get("rows") or []
        if not rows:
            return "No skill gaps are currently reported by Alchemy."

        s = res.get("summary", {})
        head = (f"**Skill supply — what we can't staff (top {len(rows)})**\n"
                f"_Market demand from Alchemy; availability from live allocations._\n"
                f"BUY {s.get('buy', 0)} · TRAIN {s.get('train', 0)} · "
                f"REDEPLOY {s.get('redeploy', 0)} · STAFFABLE {s.get('staffable', 0)}\n")
        lines = [head]
        for i, r in enumerate(rows, 1):
            bits = (f"demand {r['demand']:g}, {r['coverage_count']} know it, "
                    f"{r['deployable_count']} free now")
            if r["rolling_off"]:
                soonest = min(x["date"] for x in r["rolling_off"])
                bits += f", {len(r['rolling_off'])} roll off by {soonest}"
            lines.append(f"{i}. **{r['skill_name']}** — `{r['action']}` ({bits})\n   {r['rationale']}")
        if res.get("note"):
            lines.append(f"\n_{res['note']}_")
        return "\n".join(lines)
