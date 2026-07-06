"""Proactive nudge service — deterministic detectors + the in-app feed store.

Mirrors automation_service.py: run_due() is called every NUDGE_SCAN_INTERVAL_MIN
from the startup scheduler (see main.py). It scans for actionable situations with
pure DB look-ups — **no LLM** — and upserts ProactiveNudge rows keyed by
``dedup_key`` so re-scanning never creates duplicates and a dismissed nudge stays
dismissed for its period.

Detectors (v1):
  • detect_expiring_leaves — non-carry-forward leave balances that lapse at the
    configured fiscal year-end, within LEAVE_EXPIRY_WINDOW_DAYS.
  • detect_stale_approvals — a Leave left "Pending" longer than STALE_APPROVAL_DAYS
    → the employee gets a one-click "nudge manager" that re-sends the approval email.

The in-app feed (list_for_user / count_unread) is the source of truth; an optional
best-effort Teams/email push is gated by settings.NUDGE_PUSH_ENABLED (OFF by default).
"""

from __future__ import annotations

import datetime
import logging
from typing import Optional, TypedDict

from app.config import settings
from app.database import SessionLocal
from app.models import ProactiveNudge, Employee, Leave, LeaveType, LeaveBalance, ConnectedAccount

log = logging.getLogger("aurora-logger")

# A nudge in one of these statuses is "live" — it occupies the dedup slot and shows
# in the feed. dismissed / expired free nothing (the slot stays so it can't reappear).
_LIVE_STATUSES = ("new", "seen", "actioned")


class NudgeSpec(TypedDict, total=False):
    user_email: str
    nudge_type: str
    dedup_key: str
    title: str
    body: str
    severity: str
    action_type: Optional[str]
    action_payload: Optional[dict]
    entity_type: Optional[str]
    entity_id: Optional[str]


def _now() -> datetime.datetime:
    return datetime.datetime.utcnow()


# ── Small formatting helpers ─────────────────────────────────────────────────

def _fmt_num(n) -> str:
    """3.0 -> '3', 1.5 -> '1.5'."""
    try:
        f = float(n)
    except (TypeError, ValueError):
        return str(n)
    return str(int(f)) if f == int(f) else f"{f:g}"


def _date_range(start: Optional[datetime.date], end: Optional[datetime.date]) -> str:
    if start and end:
        return start.strftime("%d %b") if start == end else f"{start.strftime('%d %b')}–{end.strftime('%d %b')}"
    if start:
        return start.strftime("%d %b")
    return "your request"


def _fiscal_year_end(today: datetime.date) -> datetime.date:
    """Next occurrence of the configured financial year-end (MM-DD) on/after ``today``.

    Default 03-31 (Indian financial year). The detector only fires inside the window
    before this date, which always lands in the same calendar year as the year-end.
    """
    try:
        mm, dd = (int(x) for x in settings.FISCAL_YEAR_END.split("-"))
    except Exception:
        mm, dd = 3, 31
    try:
        candidate = datetime.date(today.year, mm, dd)
    except ValueError:
        candidate = datetime.date(today.year, 3, 31)
    if candidate < today:
        candidate = datetime.date(today.year + 1, mm, dd)
    return candidate


# ── Detectors (pure: return list[NudgeSpec], no writes) ──────────────────────

def detect_expiring_leaves(db, emp: Employee, today: Optional[datetime.date] = None) -> list[NudgeSpec]:
    """Non-carry-forward leave balances that lapse at fiscal year-end.

    Balances are tracked per calendar year (LeaveBalance.year), so we look up the
    current year's balance and fire only inside the expiry window.
    """
    today = today or _now().date()
    fy_end = _fiscal_year_end(today)
    days_left = (fy_end - today).days
    if days_left < 0 or days_left > settings.LEAVE_EXPIRY_WINDOW_DAYS:
        return []

    rows = (
        db.query(LeaveBalance, LeaveType)
        .join(LeaveType, LeaveBalance.leave_type_id == LeaveType.id)
        .filter(
            LeaveBalance.employee_id == emp.id,
            LeaveBalance.year == today.year,
            LeaveBalance.balance > 0,
            LeaveType.is_active.is_(True),
            LeaveType.carry_forward.is_(False),
        )
        .all()
    )

    specs: list[NudgeSpec] = []
    for lb, lt in rows:
        bal = _fmt_num(lb.balance)
        plural = "s" if lb.balance != 1 else ""
        day_word = "day" if days_left == 1 else "days"
        specs.append(NudgeSpec(
            user_email=emp.email,
            nudge_type="leave_expiring",
            dedup_key=f"leave_expiring:{emp.email}:{today.year}:{lt.code}",
            title=f"{bal} {lt.name} leave{plural} expiring this year",
            body=(
                f"You have {bal} {lt.name} ({lt.code}) leave{plural} that lapse on "
                f"{fy_end.strftime('%d %b %Y')} — {days_left} {day_word} left. "
                f"Apply before they're lost."
            ),
            severity="action",
            action_type="apply_leave",
            action_payload={
                "leave_type": lt.name,
                "code": lt.code,
                "balance": lb.balance,
                "expiry_date": fy_end.isoformat(),
            },
            entity_type="leave_type",
            entity_id=str(lt.id),
        ))
    return specs


def detect_stale_approvals(db, now: Optional[datetime.datetime] = None) -> list[NudgeSpec]:
    """Leaves still 'Pending' beyond STALE_APPROVAL_DAYS → nudge the employee to ping their manager."""
    now = now or _now()
    cutoff = now - datetime.timedelta(days=settings.STALE_APPROVAL_DAYS)
    stale = (
        db.query(Leave)
        .filter(Leave.status == "Pending", Leave.created_at.isnot(None), Leave.created_at < cutoff)
        .all()
    )

    specs: list[NudgeSpec] = []
    for lv in stale:
        emp = db.query(Employee).filter(Employee.id == lv.employee_id).first()
        if not emp or not emp.email:
            continue
        manager_email = _resolve_manager_email(db, emp)
        if not manager_email or "@" not in manager_email:
            continue  # no one to nudge → not actionable, skip

        dr = _date_range(lv.start_date, lv.end_date)
        applied = lv.created_at.strftime("%d %b") if lv.created_at else "earlier"
        leave_word = f"{lv.leave_type} leave" if lv.leave_type else "leave"
        specs.append(NudgeSpec(
            user_email=emp.email,
            nudge_type="approval_stale",
            dedup_key=f"approval_stale:leave:{lv.id}",
            title=f"Leave ({dr}) still awaiting approval",
            body=(
                f"Your {leave_word} ({dr}) has been pending your manager's approval "
                f"since {applied}. Want to nudge them?"
            ),
            severity="action",
            action_type="nudge_manager",
            action_payload={
                "leave_id": lv.id,
                "manager_email": manager_email,
                "leave_type": lv.leave_type,
                "start_date": lv.start_date.isoformat() if lv.start_date else "",
                "end_date": lv.end_date.isoformat() if lv.end_date else "",
            },
            entity_type="leave",
            entity_id=str(lv.id),
        ))
    return specs


def detect_onboarding_next_step(db, emp: Employee) -> list[NudgeSpec]:
    """A new hire with an incomplete journey gets one nudge for their NEXT step.

    Pure DB look-up via onboarding_service (no LLM). The dedup_key includes the step key so
    each step nudges once and a dismissal sticks; when the hire advances, the next step gets
    its own fresh nudge. Stops entirely once the journey is complete or the person is no
    longer a new hire.
    """
    from app.services import onboarding_service as ob
    from app.services import onboarding_template as ob_tmpl

    if not emp.email or not ob.is_new_hire(emp):
        return []

    view = ob.get_for_employee(emp.email)
    if not view or view.get("status") == "completed":
        return []
    next_key = view.get("next_step")
    if not next_key:
        return []
    step = ob_tmpl.get_step(next_key)
    if step is None:
        return []

    pct = view.get("progress_pct", 0)
    return [NudgeSpec(
        user_email=emp.email,
        nudge_type="onboarding_step",
        dedup_key=f"onboarding_step:{emp.email}:{next_key}",
        title=f"Next onboarding step: {step.title}",
        body=(
            f"You're {pct}% through onboarding. Next up — {step.title.lower()}. "
            f"{step.description}"
        ),
        severity="action",
        action_type="open_onboarding",
        action_payload={"step_key": next_key, "route": "/onboarding"},
        entity_type="onboarding_step",
        entity_id=next_key,
    )]


def detect_stalled_onboarding(db, now: Optional[datetime.datetime] = None) -> list[NudgeSpec]:
    """Onboarding journeys with no activity beyond the configured stall window → remind the
    hire, their manager, and/or HR, per the HR-tuned cadence.

    Config comes from onboarding_service.get_reminder_settings() (runtime-editable in the
    Onboarding Tracker, not env vars). Weekly dedup bucket so a stalled journey nudges at most
    once per recipient per week; a dismissal sticks for that week and the reminder re-arms next
    week if still stalled. Distinct from detect_onboarding_next_step, which nudges the hire
    about their next step regardless of stall — this one escalates a genuinely stuck journey.
    """
    from app.services import onboarding_service as ob
    from app.models import OnboardingJourney

    cfg = ob.get_reminder_settings()
    if not cfg.get("enabled"):
        return []
    now = now or _now()
    cutoff = now - datetime.timedelta(days=cfg["stall_days"])
    week = now.strftime("%Y-W%W")

    journeys = (
        db.query(OnboardingJourney, Employee)
        .join(Employee, OnboardingJourney.employee_id == Employee.id)
        .filter(OnboardingJourney.status == "active")
        .all()
    )
    tracker_route = "/control-hub?tab=onboarding-tracker"

    specs: list[NudgeSpec] = []
    for journey, emp in journeys:
        if not emp or not emp.email:
            continue
        last_activity = max(
            [s.updated_at or s.created_at for s in journey.steps]
            + [journey.started_at or journey.created_at],
            default=journey.created_at,
        )
        if last_activity is None or last_activity >= cutoff:
            continue  # not stalled

        view = ob.get_for_employee(emp.email)
        if view and view.get("status") == "completed":
            continue
        pct = view.get("progress_pct", 0) if view else 0
        days_idle = (now - last_activity).days
        name = emp.name or emp.email

        if cfg.get("remind_hire"):
            specs.append(NudgeSpec(
                user_email=emp.email,
                nudge_type="onboarding_stalled",
                dedup_key=f"onboarding_stalled:hire:{emp.email}:{week}",
                title="Your onboarding is waiting for you",
                body=(f"You're {pct}% through onboarding and it's been {days_idle} days since your "
                      f"last step. Pick up where you left off — it only takes a few minutes."),
                severity="action",
                action_type="open_onboarding",
                action_payload={"route": "/onboarding"},
                entity_type="onboarding_journey",
                entity_id=str(journey.id),
            ))
        if cfg.get("remind_manager"):
            mgr = _resolve_manager_email(db, emp)
            if mgr and "@" in mgr and mgr.lower() != emp.email.lower():
                specs.append(NudgeSpec(
                    user_email=mgr,
                    nudge_type="onboarding_stalled",
                    dedup_key=f"onboarding_stalled:mgr:{emp.email}:{week}",
                    title=f"{name}'s onboarding has stalled",
                    body=(f"{name} is {pct}% through onboarding with no activity for {days_idle} days. "
                          f"A quick check-in could help them get unstuck."),
                    severity="action",
                    action_type="open_onboarding_tracker",
                    action_payload={"route": tracker_route},
                    entity_type="onboarding_journey",
                    entity_id=str(journey.id),
                ))
        hr_email = (cfg.get("hr_email") or "").strip()
        if cfg.get("remind_hr") and "@" in hr_email:
            specs.append(NudgeSpec(
                user_email=hr_email,
                nudge_type="onboarding_stalled",
                dedup_key=f"onboarding_stalled:hr:{emp.email}:{week}",
                title=f"Onboarding stalled: {name}",
                body=(f"{name} ({emp.email}) is {pct}% through onboarding with no activity for "
                      f"{days_idle} days. Consider following up."),
                severity="action",
                action_type="open_onboarding_tracker",
                action_payload={"route": tracker_route},
                entity_type="onboarding_journey",
                entity_id=str(journey.id),
            ))
    return specs


def detect_bench_reports(db, today: Optional[datetime.date] = None) -> list[NudgeSpec]:
    """For each manager, fire ONE nudge when ≥2 of their direct reports are on the
    bench or rolling off within the rolloff horizon — capacity they should act on.

    Pure DB look-up: capacity comes from allocation_snapshot_service (latest snapshot
    per person). One bulk load_map for everyone, then grouped per manager.
    """
    today = today or _now().date()
    from app.services import allocation_snapshot_service as snap

    employees = db.query(Employee).all()
    by_id = {e.id: e for e in employees}
    reports: dict[int, list[Employee]] = {}
    for e in employees:
        if e.manager_id:
            reports.setdefault(e.manager_id, []).append(e)
    if not reports:
        return []

    load_map = snap.current_load_map(db, as_of=today)
    horizon = today + datetime.timedelta(days=snap.ROLLOFF_HORIZON_DAYS)

    specs: list[NudgeSpec] = []
    for mgr_id, team in reports.items():
        mgr = by_id.get(mgr_id)
        if not mgr or not mgr.email:
            continue
        free_people = []
        for e in team:
            v = load_map.get((e.name or "").strip().lower())
            if not v:
                continue
            on_bench = v["is_bench"] and v.get("active")
            rolling = v["earliest_free"] and v["earliest_free"] <= horizon
            if on_bench or rolling:
                free_people.append(e.name)
        if len(free_people) < 2:
            continue
        names = ", ".join(free_people[:4]) + ("…" if len(free_people) > 4 else "")
        # Month-bucketed dedup so it can re-fire next month but not spam within one.
        specs.append(NudgeSpec(
            user_email=mgr.email,
            nudge_type="bench_capacity",
            dedup_key=f"bench_capacity:{mgr.email}:{today.strftime('%Y-%m')}",
            title=f"{len(free_people)} of your reports have capacity soon",
            body=(
                f"{names} are on the bench or rolling off within "
                f"{snap.ROLLOFF_HORIZON_DAYS} days. Review the team digest to plan "
                f"redeployment or upskilling before the capacity sits idle."
            ),
            severity="action",
            action_type="open_team_digest",
            action_payload={"route": "/control-hub?tab=manager-portal"},
            entity_type="manager",
            entity_id=str(mgr_id),
        ))
    return specs


def detect_new_mail(user_email: str, graph_token: str, window_minutes: int) -> list[NudgeSpec]:
    """Bundle unread mail received in the last scan window into one nudge.

    Bucketed by scan run (not per-message) so an inbox with many unread emails
    doesn't flood the feed with one entry each — mirrors detect_bench_reports'
    bucketed-dedup style. Requires a connected Microsoft account (graph_token).
    """
    import asyncio
    from app.services import ms365_service

    since = (_now() - datetime.timedelta(minutes=window_minutes)).strftime("%Y-%m-%dT%H:%M:%SZ")
    try:
        result = asyncio.run(ms365_service.fetch_unread_since(graph_token, since, top=10))
    except Exception as exc:
        log.warning("[nudge] new-mail fetch failed for %s: %s", user_email, exc)
        return []
    if not result.get("success") or not result.get("emails"):
        return []

    emails = result["emails"]
    count = len(emails)
    bucket = _now().strftime("%Y-%m-%dT%H:%M")  # minute-precision scan-run bucket
    first = emails[0]
    plural = "s" if count != 1 else ""
    title = f"{count} new unread email{plural}" if count > 1 else f"New email: {first.get('subject', '(no subject)')}"
    body = (
        f"From {first.get('from_name') or 'someone'}: \"{first.get('subject', '(no subject)')}\""
        + (f" — and {count - 1} more." if count > 1 else ".")
    )
    return [NudgeSpec(
        user_email=user_email,
        nudge_type="new_mail",
        dedup_key=f"new_mail:{user_email}:{bucket}",
        title=title,
        body=body,
        severity="info",
        entity_type="email",
        entity_id=first.get("id"),
    )]


def detect_new_community_posts(user_email: str, yammer_token: str, window_minutes: int) -> list[NudgeSpec]:
    """Bundle new Viva Engage (Teams community) feed posts since the last scan into one nudge.

    Same bucketed-dedup approach as detect_new_mail — one notification per scan run
    covering everything new, not one row per post.
    """
    import asyncio
    from app.services import yammer_service

    try:
        result = asyncio.run(yammer_service.fetch_my_feed(yammer_token, top=20))
    except Exception as exc:
        log.warning("[nudge] community-post fetch failed for %s: %s", user_email, exc)
        return []
    if not result.get("success") or not result.get("messages"):
        return []

    cutoff = _now() - datetime.timedelta(minutes=window_minutes)
    fresh = [m for m in result["messages"] if _parse_yammer_time(m.get("created_at")) and _parse_yammer_time(m.get("created_at")) >= cutoff]
    if not fresh:
        return []

    count = len(fresh)
    bucket = _now().strftime("%Y-%m-%dT%H:%M")
    first = fresh[0]
    plural = "s" if count != 1 else ""
    title = f"{count} new community post{plural}" if count > 1 else f"New post in {first.get('group_name') or 'a community'}"
    body = (
        f"{first.get('sender_name') or 'Someone'} posted in {first.get('group_name') or 'a community'}: "
        f"\"{(first.get('text') or '')[:120]}\""
        + (f" — and {count - 1} more." if count > 1 else "")
    )
    return [NudgeSpec(
        user_email=user_email,
        nudge_type="new_community_post",
        dedup_key=f"new_community_post:{user_email}:{bucket}",
        title=title,
        body=body,
        severity="info",
        entity_type="community_post",
        entity_id=str(first.get("id") or ""),
    )]


def _parse_yammer_time(raw: Optional[str]) -> Optional[datetime.datetime]:
    """Yammer's created_at looks like '2026/06/30 12:34:56 +0000'."""
    if not raw:
        return None
    try:
        return datetime.datetime.strptime(raw.split(" +")[0], "%Y/%m/%d %H:%M:%S")
    except Exception:
        return None


def _resolve_manager_email(db, emp: Employee) -> Optional[str]:
    """Best-effort manager lookup. Returns None instead of raising (HRService's
    fallback touches settings.HR_EMAIL which may be unset)."""
    try:
        from app.hr_service import HRService
        return HRService._find_manager_email(db, emp)
    except Exception:
        # Direct manager_id is the reliable path; fall back to that alone.
        try:
            if emp.manager_id:
                mgr = db.query(Employee).filter(Employee.id == emp.manager_id).first()
                if mgr and mgr.email:
                    return mgr.email
        except Exception:
            pass
        return None


# ── Upsert (idempotent) ──────────────────────────────────────────────────────

def upsert(db, spec: NudgeSpec) -> str:
    """Insert a nudge, or refresh the live one. Returns 'created' | 'updated' | 'skipped'.

    A dismissed/expired nudge for the same dedup_key is NOT resurrected within its
    period (the dedup_key encodes the period), so dismissals stick.
    """
    existing = db.query(ProactiveNudge).filter(ProactiveNudge.dedup_key == spec["dedup_key"]).first()
    ttl = _now() + datetime.timedelta(days=settings.NUDGE_TTL_DAYS)
    if existing:
        if existing.status not in _LIVE_STATUSES:
            return "skipped"
        existing.title = spec["title"]
        existing.body = spec["body"]
        existing.action_payload = spec.get("action_payload")
        existing.expires_at = ttl
        return "updated"

    db.add(ProactiveNudge(
        user_email=spec["user_email"],
        nudge_type=spec["nudge_type"],
        dedup_key=spec["dedup_key"],
        title=spec["title"],
        body=spec["body"],
        severity=spec.get("severity", "action"),
        action_type=spec.get("action_type"),
        action_payload=spec.get("action_payload"),
        entity_type=spec.get("entity_type"),
        entity_id=spec.get("entity_id"),
        status="new",
        expires_at=ttl,
    ))
    return "created"


def expire_old_nudges(db, now: Optional[datetime.datetime] = None) -> int:
    now = now or _now()
    return (
        db.query(ProactiveNudge)
        .filter(
            ProactiveNudge.status.in_(("new", "seen")),
            ProactiveNudge.expires_at.isnot(None),
            ProactiveNudge.expires_at < now,
        )
        .update({"status": "expired", "updated_at": now}, synchronize_session=False)
    )


# ── Scheduler entry point ────────────────────────────────────────────────────

def run_due() -> int:
    """Run every detector, upsert results, expire stale nudges. Returns # created.

    Called every NUDGE_SCAN_INTERVAL_MIN from main.py. Per-detector and per-employee
    exceptions are swallowed so one bad row never stalls the whole scan.
    """
    db = SessionLocal()
    created = 0
    try:
        expire_old_nudges(db)

        # Stale approvals: one query over all pending leaves.
        try:
            for spec in detect_stale_approvals(db):
                if upsert(db, spec) == "created":
                    created += 1
        except Exception as exc:
            db.rollback()
            log.warning("[nudge] stale-approval detector failed: %s", exc)

        # Bench/rolloff capacity alerts for managers: one bulk pass over allocations.
        try:
            for spec in detect_bench_reports(db):
                if upsert(db, spec) == "created":
                    created += 1
        except Exception as exc:
            db.rollback()
            log.warning("[nudge] bench-reports detector failed: %s", exc)

        # Stalled onboarding journeys: remind hire/manager/HR per the HR-tuned cadence.
        try:
            for spec in detect_stalled_onboarding(db):
                if upsert(db, spec) == "created":
                    created += 1
        except Exception as exc:
            db.rollback()
            log.warning("[nudge] stalled-onboarding detector failed: %s", exc)

        # New mail / new community posts: only for users with a connected Microsoft
        # account (no point hitting Graph/Yammer for accounts that aren't linked).
        # Window padded past the scan interval so a slow tick can't drop an email.
        window_minutes = settings.NUDGE_SCAN_INTERVAL_MIN + 5
        accounts = (
            db.query(ConnectedAccount)
            .filter(ConnectedAccount.provider == "microsoft", ConnectedAccount.status == "active")
            .all()
        )
        for acc in accounts:
            if not acc.user_email:
                continue
            try:
                import asyncio
                from app.services import oauth_service
                graph_token = asyncio.run(oauth_service.get_valid_token(acc.user_email, "microsoft"))
                if graph_token:
                    for spec in detect_new_mail(acc.user_email, graph_token, window_minutes):
                        if upsert(db, spec) == "created":
                            created += 1
            except Exception as exc:
                db.rollback()
                log.warning("[nudge] new-mail detector failed for %s: %s", acc.user_email, exc)
            try:
                import asyncio
                from app.services import oauth_service
                yammer_token = asyncio.run(oauth_service.get_yammer_token(acc.user_email))
                if yammer_token:
                    for spec in detect_new_community_posts(acc.user_email, yammer_token, window_minutes):
                        if upsert(db, spec) == "created":
                            created += 1
            except Exception as exc:
                db.rollback()
                log.warning("[nudge] community-post detector failed for %s: %s", acc.user_email, exc)

        # Expiring leaves: per active employee.
        employees = db.query(Employee).filter(Employee.email.isnot(None)).all()
        for emp in employees:
            try:
                for spec in detect_expiring_leaves(db, emp):
                    if upsert(db, spec) == "created":
                        created += 1
            except Exception as exc:
                db.rollback()
                log.warning("[nudge] expiring-leaves detector failed for %s: %s",
                            getattr(emp, "email", "?"), exc)
            try:
                for spec in detect_onboarding_next_step(db, emp):
                    if upsert(db, spec) == "created":
                        created += 1
            except Exception as exc:
                db.rollback()
                log.warning("[nudge] onboarding detector failed for %s: %s",
                            getattr(emp, "email", "?"), exc)

        db.commit()

        if settings.NUDGE_PUSH_ENABLED and created:
            try:
                _push_new(db)
            except Exception as exc:
                log.warning("[nudge] best-effort push failed: %s", exc)

        return created
    except Exception as exc:
        db.rollback()
        log.warning("[nudge] run_due failed: %s", exc)
        return 0
    finally:
        db.close()


def _push_new(db) -> None:
    """Best-effort Teams/email push of not-yet-delivered new nudges. Gated OFF by
    default; stays silent (no raises) until Azure/Teams is provisioned."""
    from app.services.email_service import notify_teams
    sender = settings.PARKING_REMINDER_SENDER or settings.NOTIFY_TO_EMAIL
    if not sender:
        return
    pending = (
        db.query(ProactiveNudge)
        .filter(ProactiveNudge.status == "new", ProactiveNudge.last_delivered_at.is_(None))
        .all()
    )
    for n in pending:
        try:
            notify_teams(sender, n.user_email, n.title, f"<p>{n.body}</p>")
            n.last_delivered_at = _now()
        except Exception:
            pass
    if pending:
        db.commit()


# ── Feed queries ─────────────────────────────────────────────────────────────

def _to_dict(r: ProactiveNudge) -> dict:
    return {
        "id": r.id,
        "nudge_type": r.nudge_type,
        "title": r.title,
        "body": r.body,
        "severity": r.severity,
        "action_type": r.action_type,
        "action_payload": r.action_payload or {},
        "entity_type": r.entity_type,
        "entity_id": r.entity_id,
        "status": r.status,
        "created_at": r.created_at.isoformat() if r.created_at else None,
    }


def list_for_user(email: str) -> list[dict]:
    db = SessionLocal()
    try:
        rows = (
            db.query(ProactiveNudge)
            .filter(ProactiveNudge.user_email == email, ProactiveNudge.status.in_(_LIVE_STATUSES))
            .order_by(ProactiveNudge.created_at.desc())
            .all()
        )
        return [_to_dict(r) for r in rows]
    finally:
        db.close()


def count_unread(email: str) -> int:
    db = SessionLocal()
    try:
        return (
            db.query(ProactiveNudge)
            .filter(ProactiveNudge.user_email == email, ProactiveNudge.status == "new")
            .count()
        )
    finally:
        db.close()


def mark_seen(email: str, ids: Optional[list[int]] = None) -> int:
    db = SessionLocal()
    try:
        q = db.query(ProactiveNudge).filter(
            ProactiveNudge.user_email == email, ProactiveNudge.status == "new"
        )
        if ids:
            q = q.filter(ProactiveNudge.id.in_(ids))
        n = q.update({"status": "seen", "updated_at": _now()}, synchronize_session=False)
        db.commit()
        return n
    finally:
        db.close()


def dismiss(email: str, nudge_id: int) -> bool:
    db = SessionLocal()
    try:
        row = (
            db.query(ProactiveNudge)
            .filter(ProactiveNudge.id == nudge_id, ProactiveNudge.user_email == email)
            .first()
        )
        if not row:
            return False
        row.status = "dismissed"
        row.updated_at = _now()
        db.commit()
        return True
    finally:
        db.close()


# ── One-click actions ────────────────────────────────────────────────────────

def act(email: str, nudge_id: int) -> dict:
    db = SessionLocal()
    try:
        row = (
            db.query(ProactiveNudge)
            .filter(ProactiveNudge.id == nudge_id, ProactiveNudge.user_email == email)
            .first()
        )
        if not row:
            return {"success": False, "error": "not_found"}

        if row.action_type == "apply_leave":
            result = _act_apply_leave(row)
        elif row.action_type == "nudge_manager":
            result = _act_nudge_manager(db, row)
        elif row.action_type == "open_onboarding":
            result = _act_open_onboarding(row)
        elif row.action_type in ("open_team_digest", "open_onboarding_tracker"):
            result = _act_navigate(row)
        else:
            return {"success": False, "error": "no_action"}

        if result.get("success"):
            row.status = "actioned"
            row.last_actioned_at = _now()
            db.commit()
        return result
    finally:
        db.close()


def _act_apply_leave(row: ProactiveNudge) -> dict:
    """Hand the user the Zoho apply-leave deep-link (Zoho owns leave application)."""
    from app.services import zoho_leave_links
    lt = (row.action_payload or {}).get("leave_type") or ""
    link = zoho_leave_links.apply_url()
    which = f"{lt} leave" if lt else "leave"
    return {
        "success": True,
        "action": "open_apply_form",
        "link": link,
        "message": f"Apply your {which} in Zoho People before it lapses — [open the leave form]({link}).",
    }


def _act_open_onboarding(row: ProactiveNudge) -> dict:
    """Hand the user a deep-link to their onboarding page (open at the next step)."""
    payload = row.action_payload or {}
    route = payload.get("route", "/onboarding")
    return {
        "success": True,
        "action": "navigate",
        "route": route,
        "message": f"Opening your onboarding — [continue here]({route}).",
    }


def _act_navigate(row: ProactiveNudge) -> dict:
    """Generic deep-link action — hand the client a route to open."""
    route = (row.action_payload or {}).get("route", "/control-hub")
    return {"success": True, "action": "navigate", "route": route,
            "message": f"Opening [the team digest]({route})."}


def _act_nudge_manager(db, row: ProactiveNudge) -> dict:
    """Re-send the leave approval request to the manager (fresh 24h tokens).

    Guarded by a cooldown so repeated clicks can't spam the manager.
    """
    cooldown = datetime.timedelta(hours=settings.NUDGE_MANAGER_COOLDOWN_HOURS)
    if row.last_actioned_at and (_now() - row.last_actioned_at) < cooldown:
        return {
            "success": False,
            "error": "cooldown",
            "message": "Your manager was reminded recently — give them a little time before nudging again.",
        }

    import secrets
    from app.models import ApprovalToken
    from app.services.email_service import send_leave_approval_request

    payload = row.action_payload or {}
    leave_id = payload.get("leave_id") or (int(row.entity_id) if row.entity_id else None)
    lv = db.query(Leave).filter(Leave.id == leave_id).first()
    if not lv:
        return {"success": False, "error": "leave_not_found"}
    if lv.status != "Pending":
        return {
            "success": False,
            "error": "already_decided",
            "message": "This leave has already been decided — nothing to nudge.",
        }

    emp = db.query(Employee).filter(Employee.id == lv.employee_id).first()
    if not emp:
        return {"success": False, "error": "employee_not_found"}

    manager_email = payload.get("manager_email") or _resolve_manager_email(db, emp)
    if not manager_email or "@" not in manager_email:
        return {"success": False, "error": "no_manager",
                "message": "We couldn't find your manager's email to send the reminder."}

    expires = _now() + datetime.timedelta(hours=24)
    approve_tok = secrets.token_urlsafe(32)
    reject_tok = secrets.token_urlsafe(32)
    db.add(ApprovalToken(token=approve_tok, entity_type="leave", entity_id=lv.id,
                         action="approve", approver_email=manager_email,
                         employee_email=emp.email, expires_at=expires))
    db.add(ApprovalToken(token=reject_tok, entity_type="leave", entity_id=lv.id,
                         action="reject", approver_email=manager_email,
                         employee_email=emp.email, expires_at=expires))
    db.commit()

    ok = send_leave_approval_request(
        user_email=emp.email,
        employee_name=emp.name,
        employee_email=emp.email,
        leave_type=lv.leave_type or "",
        start_date=lv.start_date.isoformat() if lv.start_date else "",
        end_date=lv.end_date.isoformat() if lv.end_date else "",
        reason=lv.reason or "",
        approve_url=f"{settings.APP_BASE_URL}/api/approve/{approve_tok}",
        reject_url=f"{settings.APP_BASE_URL}/api/approve/{reject_tok}",
        manager_email=manager_email,
        leave_id=lv.id,
    )
    if ok:
        return {"success": True, "message": "Reminder sent to your manager ✓"}
    return {
        "success": False,
        "error": "send_failed",
        "message": ("Couldn't reach your manager right now (Microsoft 365 may not be connected). "
                    "Your leave is still pending and visible in the portal."),
    }
