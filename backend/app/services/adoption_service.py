"""Feature-adoption analytics — "which capabilities are undiscovered?".

Answers questions like "80% of staff have never used doc issuance" so growth
becomes measurable and drivable, not hoped-for. The denominator is the curated
`capability_registry`; the numerator is distinct users in `AiRequestLog` whose
(domain, sub_intent) maps to each capability.

Two honesty guards:
  • exact distinct-user counts (sets unioned in Python), not summed approximations;
  • an `unmapped` list of (domain, sub_intent) buckets that carry real traffic but
    match no capability — so a wrong sub_intent guess shows up as unmapped usage
    instead of silently making a capability look undiscovered.
"""
import datetime
from typing import Optional

from sqlalchemy import func

from app.database import SessionLocal
from app.models import AiRequestLog, Employee
from app.services import capability_registry as caps


def _norm(s: Optional[str]) -> str:
    return (s or "").strip().lower()


def feature_adoption(window_days: int = 90) -> dict:
    """Compute adoption for every capability over the trailing `window_days`."""
    cutoff = datetime.datetime.utcnow() - datetime.timedelta(days=window_days)
    db = SessionLocal()
    try:
        total_staff = (
            db.query(func.count(Employee.id))
            .filter(Employee.email.isnot(None))
            .scalar()
        ) or 0

        # Per-bucket distinct users: one row per (domain, sub_intent, user_email).
        user_rows = (
            db.query(
                AiRequestLog.domain,
                AiRequestLog.sub_intent,
                AiRequestLog.user_email,
            )
            .filter(
                AiRequestLog.created_at >= cutoff,
                AiRequestLog.user_email.isnot(None),
                AiRequestLog.user_email != "",
            )
            .distinct()
            .all()
        )

        # Per-bucket volume + recency.
        stat_rows = (
            db.query(
                AiRequestLog.domain,
                AiRequestLog.sub_intent,
                func.count(AiRequestLog.id),
                func.max(AiRequestLog.created_at),
            )
            .filter(AiRequestLog.created_at >= cutoff)
            .group_by(AiRequestLog.domain, AiRequestLog.sub_intent)
            .all()
        )

        # Index buckets by normalized (domain, sub_intent).
        bucket_users: dict[tuple[str, str], set] = {}
        active_users: set = set()
        for domain, sub_intent, email in user_rows:
            key = (_norm(domain), _norm(sub_intent))
            bucket_users.setdefault(key, set()).add(email)
            active_users.add(email)

        bucket_stats: dict[tuple[str, str], dict] = {}
        for domain, sub_intent, count, last in stat_rows:
            bucket_stats[(_norm(domain), _norm(sub_intent))] = {
                "requests": int(count or 0),
                "last_used": last.isoformat() if last else None,
            }

        active_count = len(active_users)
        claimed_buckets: set[tuple[str, str]] = set()
        features: list[dict] = []

        for cap in caps.all_capabilities():
            # Explicit (domain, sub_intent) pairs; "*" = any sub_intent in domain.
            exact = {(_norm(d), _norm(si)) for d, si in cap.usage if si != "*"}
            wildcard_domains = {_norm(d) for d, si in cap.usage if si == "*"}
            users: set = set()
            requests = 0
            last_used: Optional[str] = None
            for (bd, bsi), uset in bucket_users.items():
                if (bd, bsi) not in exact and bd not in wildcard_domains:
                    continue
                users |= uset
                claimed_buckets.add((bd, bsi))
                st = bucket_stats.get((bd, bsi))
                if st:
                    requests += st["requests"]
                    if st["last_used"] and (last_used is None or st["last_used"] > last_used):
                        last_used = st["last_used"]

            n_users = len(users)
            features.append({
                "key": cap.key,
                "title": cap.title,
                "category": cap.category,
                "domain": cap.domain,
                "users": n_users,
                "requests": requests,
                "last_used": last_used,
                "adoption_pct_staff": round(100.0 * n_users / total_staff, 1) if total_staff else 0.0,
                "adoption_pct_active": round(100.0 * n_users / active_count, 1) if active_count else 0.0,
                "never_used_staff": max(total_staff - n_users, 0),
            })

        # Most-undiscovered first (fewest unique users, then least recent traffic).
        features.sort(key=lambda f: (f["users"], f["requests"]))

        # Real traffic that no capability claimed — registry blind spots / wrong
        # sub_intent guesses surface here instead of corrupting a feature's number.
        unmapped: list[dict] = []
        for key, uset in bucket_users.items():
            if key in claimed_buckets:
                continue
            bd, bsi = key
            st = bucket_stats.get(key, {})
            unmapped.append({
                "domain": bd,
                "sub_intent": bsi or "(none)",
                "users": len(uset),
                "requests": st.get("requests", 0),
                "last_used": st.get("last_used"),
            })
        unmapped.sort(key=lambda b: b["requests"], reverse=True)

        undiscovered = [f for f in features if f["users"] == 0]

        return {
            "window_days": window_days,
            "total_staff": total_staff,
            "active_users": active_count,
            "feature_count": len(features),
            "undiscovered_count": len(undiscovered),
            "features": features,
            "unmapped": unmapped,
        }
    finally:
        db.close()
