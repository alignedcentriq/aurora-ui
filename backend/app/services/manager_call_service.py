"""Manager intro-call scheduling for new hires.

Flow (mirrors welcome_service's magic-link pattern):
1. New employee detected in _get_or_create_employee → ensure_invite()
2. We resolve the new hire's manager (synced MS365 directory, else live Graph) and email
   the *manager* a magic link — authenticated by an unguessable token, no login needed.
3. Manager opens the link (backend-rendered page in manager_call_routes), picks a date/time.
4. schedule() books a real Teams online-meeting event via Microsoft Graph, stores the join
   link, and emails both the manager and the new hire a confirmation.
5. Until then, the new hire's onboarding view shows "Meeting not scheduled yet".

All side effects (email, Graph) are best-effort: the recorded invite state never depends on
them succeeding, so a missing connected mailbox degrades to "recorded, awaiting delivery".
"""

from __future__ import annotations

import datetime
import logging
import secrets
import threading

from app.config import settings
from app.database import SessionLocal
from app.models import ManagerCallInvite

logger = logging.getLogger("aurora-logger")

_TZ_LABEL = "IST"
_TZ_GRAPH = "Asia/Kolkata"


def _system_sender() -> str:
    """Mailbox used to send the manager invite + confirmation emails and (as a fallback)
    to host the Teams event. Must be an account with a connected MS365 mailbox."""
    return settings.PARKING_REMINDER_SENDER or settings.NOTIFY_TO_EMAIL or ""


# ── Manager resolution ───────────────────────────────────────────────────────────

def _resolve_manager(new_hire_email: str, db) -> tuple[str, str]:
    """Return (manager_email, manager_name) for a new hire. Tries the synced MS365
    directory first (fast), then a live Graph lookup. Returns ("", "") if unknown."""
    from app.models import MS365User

    row = db.query(MS365User).filter(MS365User.email == new_hire_email.lower()).first()
    if row and row.manager_email:
        return row.manager_email.lower(), (row.manager_name or "")

    # Live Graph fallback (app-only) — robust when the directory sync lags a new joiner.
    try:
        from app.services import ms365_service
        from app.services.email_service import _run_coro
        res = _run_coro(ms365_service.fetch_user_manager(new_hire_email))
        if res.get("success") and res.get("manager"):
            m = res["manager"]
            return (m.get("email") or "").lower(), m.get("name") or ""
    except Exception as e:
        logger.warning("[manager-call] live manager lookup failed for %s: %s", new_hire_email, e)

    return "", ""


# ── Invite lifecycle ─────────────────────────────────────────────────────────────

def ensure_invite(new_hire_email: str, new_hire_name: str, db) -> None:
    """Create a ManagerCallInvite for a new hire and email the manager a scheduling link.
    Idempotent — one invite per new hire (unique on new_hire_email). Non-blocking email."""
    new_hire_email = (new_hire_email or "").lower()
    if not new_hire_email:
        return
    if db.query(ManagerCallInvite).filter(
        ManagerCallInvite.new_hire_email == new_hire_email
    ).first():
        return

    manager_email, manager_name = _resolve_manager(new_hire_email, db)

    invite = ManagerCallInvite(
        new_hire_email=new_hire_email,
        new_hire_name=new_hire_name,
        manager_email=manager_email or None,
        manager_name=manager_name or None,
        token=secrets.token_urlsafe(48)[:64],
        status="pending",
    )
    db.add(invite)
    db.commit()

    if not manager_email:
        logger.info("[manager-call] No manager resolved for %s — invite recorded, email skipped.",
                    new_hire_email)
        return

    threading.Thread(
        target=_send_manager_invite_email,
        args=(invite.token, manager_email, manager_name, new_hire_name or new_hire_email),
        daemon=True,
    ).start()
    logger.info("[manager-call] Invite queued: manager=%s new_hire=%s", manager_email, new_hire_email)


def _send_manager_invite_email(token: str, manager_email: str, manager_name: str,
                               new_hire_label: str) -> None:
    try:
        import html as html_mod
        from app.services.email_service import _send_html, _email_shell, _detail_rows, _button_row

        sender = _system_sender()
        if not sender:
            logger.warning("[manager-call] No system sender configured — invite email skipped.")
            return

        base_url = getattr(settings, "APP_BASE_URL", "http://localhost:8080").rstrip("/")
        schedule_url = f"{base_url}/api/manager-call/schedule/{token}"

        greeting = f"Hi {html_mod.escape(manager_name.split(' ')[0])}," if manager_name else "Hi,"
        intro = (
            f"<p>{greeting}</p>"
            f"<p><strong>{html_mod.escape(new_hire_label)}</strong> has just joined your team. "
            f"Please schedule a short intro call to welcome them and help them get started.</p>"
            f"<p>Click below to pick a date and time — a Microsoft Teams meeting will be created "
            f"and sent to you both automatically.</p>"
        )
        body = (
            _detail_rows([
                ("New team member", html_mod.escape(new_hire_label)),
                ("Suggested length", "30 minutes"),
            ])
            + _button_row([("Schedule the intro call", schedule_url, "#1B6FC8")])
        )
        html_body = _email_shell(
            "Schedule your intro call",
            intro,
            body,
            preheader=f"{new_hire_label} joined your team — schedule a welcome call.",
        )
        _send_html(sender, manager_email, f"Schedule an intro call with {new_hire_label}", html_body)
        logger.info("[manager-call] Invite email sent to manager %s", manager_email)
    except Exception as e:
        logger.error("[manager-call] Invite email failed for %s: %s", manager_email, e)


# ── Reads ────────────────────────────────────────────────────────────────────────

def _fmt(dt: datetime.datetime | None) -> str:
    """Friendly label for a scheduled slot, e.g. 'Sat, 05 Jul 2026 · 4:00 PM IST'."""
    if not dt:
        return ""
    return dt.strftime("%a, %d %b %Y · %I:%M %p ").replace(" 0", " ") + _TZ_LABEL


def get_for_new_hire(email: str) -> dict:
    """The new hire's manager-call status for their onboarding view."""
    db = SessionLocal()
    try:
        inv = db.query(ManagerCallInvite).filter(
            ManagerCallInvite.new_hire_email == (email or "").lower()
        ).first()
        if not inv:
            return {"status": "none"}
        return {
            "status": inv.status,   # pending | scheduled | cancelled
            "manager_name": inv.manager_name,
            "manager_email": inv.manager_email,
            "scheduled_start": inv.scheduled_start.isoformat() if inv.scheduled_start else None,
            "scheduled_label": _fmt(inv.scheduled_start),
            "teams_join_url": inv.teams_join_url,
        }
    finally:
        db.close()


def get_by_token(token: str) -> dict | None:
    """Invite dict for the public scheduling page, or None if the token is unknown."""
    db = SessionLocal()
    try:
        inv = db.query(ManagerCallInvite).filter(ManagerCallInvite.token == token).first()
        if not inv:
            return None
        return {
            "token": inv.token,
            "status": inv.status,
            "new_hire_name": inv.new_hire_name,
            "new_hire_email": inv.new_hire_email,
            "manager_name": inv.manager_name,
            "manager_email": inv.manager_email,
            "scheduled_start": inv.scheduled_start.isoformat() if inv.scheduled_start else None,
            "scheduled_label": _fmt(inv.scheduled_start),
            "teams_join_url": inv.teams_join_url,
        }
    finally:
        db.close()


# ── Scheduling (books the real Teams event) ───────────────────────────────────────

def schedule(token: str, start_local: str, duration_minutes: int = 30) -> dict:
    """Book the intro call. `start_local` is a naive local (IST) datetime string from the
    picker ('YYYY-MM-DDTHH:MM'). Creates a Teams event, stores the join link, emails both
    parties. Returns {ok, ...}. Idempotent-ish: re-scheduling updates the same invite."""
    from app.services import ms365_service
    from app.services.email_service import _run_coro
    from app.services.oauth_service import get_valid_token

    db = SessionLocal()
    try:
        inv = db.query(ManagerCallInvite).filter(ManagerCallInvite.token == token).first()
        if not inv:
            return {"ok": False, "error": "Invalid or expired scheduling link."}

        try:
            start_dt = datetime.datetime.fromisoformat(start_local)
        except (ValueError, TypeError):
            return {"ok": False, "error": "Please choose a valid date and time."}
        if start_dt < datetime.datetime.now() - datetime.timedelta(minutes=1):
            return {"ok": False, "error": "Please choose a time in the future."}

        duration = duration_minutes if duration_minutes in (15, 30, 45, 60) else 30
        end_dt = start_dt + datetime.timedelta(minutes=duration)
        start_str = start_dt.strftime("%Y-%m-%dT%H:%M:%S")
        end_str = end_dt.strftime("%Y-%m-%dT%H:%M:%S")

        new_hire_label = inv.new_hire_name or inv.new_hire_email
        subject = f"Intro call · {inv.manager_name or 'Manager'} & {new_hire_label}"

        # Pick an organizer mailbox: the manager's connected account if available, else the
        # system sender. Either way both people are invited as attendees.
        organizer = None
        for candidate in [inv.manager_email, _system_sender()]:
            if not candidate:
                continue
            try:
                tok = _run_coro(get_valid_token(candidate, "microsoft"))
            except Exception:
                tok = None
            if tok:
                organizer = candidate
                organizer_token = tok
                break

        join_url = ""
        event_id = ""
        if organizer:
            attendees = [e for e in [inv.manager_email, inv.new_hire_email] if e and e != organizer]
            res = _run_coro(ms365_service.create_teams_event(
                organizer_token, subject, start_str, end_str, attendees,
                body_html=f"Welcome intro call for {new_hire_label}.",
                timezone=_TZ_GRAPH,
            ))
            if res.get("success"):
                join_url = res.get("join_url", "")
                event_id = res.get("event_id", "")
            else:
                logger.warning("[manager-call] Teams event creation failed: %s", res.get("error"))
        else:
            logger.info("[manager-call] No connected mailbox to host the event — recording slot only.")

        inv.status = "scheduled"
        inv.scheduled_start = start_dt
        inv.scheduled_end = end_dt
        inv.teams_join_url = join_url or None
        inv.graph_event_id = event_id or None
        inv.graph_organizer_email = organizer
        inv.scheduled_at = datetime.datetime.utcnow()
        db.commit()
        db.refresh(inv)

        _notify_scheduled(inv)
        return {
            "ok": True,
            "scheduled_label": _fmt(inv.scheduled_start),
            "teams_join_url": inv.teams_join_url,
            "new_hire_name": new_hire_label,
        }
    finally:
        db.close()


def _notify_scheduled(inv: ManagerCallInvite) -> None:
    """Email both the manager and the new hire that the call is booked (non-blocking)."""
    def _run():
        try:
            import html as html_mod
            from app.services.email_service import _send_html, _email_shell, _detail_rows, _button_row

            sender = _system_sender()
            if not sender:
                return
            label = _fmt(inv.scheduled_start)
            new_hire_label = inv.new_hire_name or inv.new_hire_email
            rows = [
                ("When", html_mod.escape(label)),
                ("Manager", html_mod.escape(inv.manager_name or inv.manager_email or "—")),
                ("New team member", html_mod.escape(new_hire_label)),
            ]
            buttons = []
            if inv.teams_join_url:
                buttons = [("Join Microsoft Teams meeting", inv.teams_join_url, "#4b53bc")]
            body = _detail_rows(rows) + (_button_row(buttons) if buttons else "")
            intro = "<p>Your onboarding intro call is scheduled. See you there!</p>"
            html_body = _email_shell("Intro call scheduled", intro, body,
                                     preheader=f"Intro call scheduled for {label}")
            recipients = [e for e in [inv.manager_email, inv.new_hire_email] if e]
            for r in recipients:
                _send_html(sender, r, f"Intro call scheduled · {label}", html_body)
        except Exception as e:
            logger.error("[manager-call] Confirmation email failed: %s", e)

    threading.Thread(target=_run, daemon=True).start()
