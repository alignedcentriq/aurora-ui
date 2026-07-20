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


_MC_SETTINGS_KEY = "manager_call_settings"

_DEFAULT_MC_SUBJECT = "Schedule an intro call with {new_hire_name}"
_DEFAULT_MC_INTRO = (
    "Hi {manager_name_first},\n\n"
    "{new_hire_name} has just joined your team. Please schedule a short intro call to "
    "welcome them and help them get started.\n\n"
    "Click below to pick a date and time — a Microsoft Teams meeting will be created and "
    "sent to you both automatically."
)


def _mc_defaults() -> dict:
    return {
        "sender_email": "",  # blank = fall back to PARKING_REMINDER_SENDER / NOTIFY_TO_EMAIL
        "subject": _DEFAULT_MC_SUBJECT,
        "intro": _DEFAULT_MC_INTRO,
        "reminder_days": 3,
    }


def get_settings() -> dict:
    """Current manager-call config (sender/subject/intro/reminder cadence), merged over
    defaults. HR-editable via /api/manager-call/settings."""
    import json
    from app.services.company_settings_service import CompanySettingsService

    cfg = _mc_defaults()
    raw = CompanySettingsService.get(_MC_SETTINGS_KEY)
    if raw:
        try:
            stored = json.loads(raw)
            if isinstance(stored, dict):
                cfg.update({k: stored[k] for k in cfg if k in stored})
        except Exception:
            pass
    try:
        cfg["reminder_days"] = max(1, int(cfg["reminder_days"]))
    except (TypeError, ValueError):
        cfg["reminder_days"] = 3
    return cfg


def set_settings(data: dict, actor_email: str = "") -> dict:
    """Persist (partial) manager-call config; returns the full merged, validated config."""
    import json
    from app.services.company_settings_service import CompanySettingsService

    cfg = get_settings()
    for key in ("sender_email", "subject", "intro"):
        if key in data:
            cfg[key] = (data.get(key) or "").strip()
    if "reminder_days" in data:
        try:
            cfg["reminder_days"] = max(1, int(data["reminder_days"]))
        except (TypeError, ValueError):
            pass
    CompanySettingsService.set(_MC_SETTINGS_KEY, json.dumps(cfg), updated_by=actor_email)
    return cfg


def _render_subject_template(tmpl: str, new_hire_label: str, manager_name: str) -> str:
    first = (manager_name.split(" ")[0] if manager_name else "") or "there"
    return (
        tmpl.replace("{new_hire_name}", new_hire_label)
        .replace("{manager_name_first}", first)
        .replace("{manager_name}", manager_name or "there")
    )


def _render_intro_html(tmpl: str, new_hire_label: str, manager_name: str) -> str:
    import html as html_mod

    escaped = html_mod.escape(tmpl)
    first = (manager_name.split(" ")[0] if manager_name else "") or "there"
    escaped = escaped.replace("{new_hire_name}", f"<strong>{html_mod.escape(new_hire_label)}</strong>")
    escaped = escaped.replace("{manager_name_first}", html_mod.escape(first))
    escaped = escaped.replace("{manager_name}", html_mod.escape(manager_name or "there"))
    paragraphs = [p.strip() for p in escaped.split("\n\n") if p.strip()]
    return "".join(f"<p>{p.replace(chr(10), '<br>')}</p>" for p in paragraphs)


def _build_invite_email(new_hire_label: str, manager_name: str, token: str) -> tuple[str, str]:
    """Build (subject, html_body) for the manager-call invite email — shared by the
    automatic send (ensure_invite) and the HR "Resend" button (resend_invite)."""
    import html as html_mod
    from app.services.email_service import _email_shell, _detail_rows, _button_row

    cfg = get_settings()
    subject = _render_subject_template(cfg["subject"] or _DEFAULT_MC_SUBJECT, new_hire_label, manager_name)
    intro_html = _render_intro_html(cfg["intro"] or _DEFAULT_MC_INTRO, new_hire_label, manager_name)

    base_url = getattr(settings, "APP_BASE_URL", "http://localhost:8080").rstrip("/")
    schedule_url = f"{base_url}/api/manager-call/schedule/{token}"
    body = (
        _detail_rows([
            ("New team member", html_mod.escape(new_hire_label)),
            ("Suggested length", "30 minutes"),
        ])
        + _button_row([("Schedule the intro call", schedule_url, "#1B6FC8")])
    )
    html_body = _email_shell(
        "Schedule your intro call",
        intro_html,
        body,
        preheader=f"{new_hire_label} joined your team — schedule a welcome call.",
    )
    return subject, html_body


def _system_sender() -> str:
    """Mailbox used to send the manager invite + confirmation emails and (as a fallback)
    to host the Teams event. Must be an account with a connected MS365 mailbox."""
    cfg = get_settings()
    return cfg.get("sender_email") or settings.PARKING_REMINDER_SENDER or settings.NOTIFY_TO_EMAIL or ""


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
        from app.services.email_service import _send_html

        sender = _system_sender()
        if not sender:
            logger.warning("[manager-call] No system sender configured — invite email skipped.")
            return

        subject, html_body = _build_invite_email(new_hire_label, manager_name, token)
        _send_html(sender, manager_email, subject, html_body)
        logger.info("[manager-call] Invite email sent to manager %s", manager_email)
    except Exception as e:
        logger.error("[manager-call] Invite email failed for %s: %s", manager_email, e)


def resend_invite(invite_id: int, db) -> dict:
    """HR-triggered manual resend of the manager-call invite email. Synchronous (unlike
    the fire-and-forget background thread used for the automatic send) since this is a
    direct button click that should report success/failure immediately. Re-resolves the
    manager first if none was ever found."""
    from app.services.email_service import _send_html

    inv = db.query(ManagerCallInvite).filter(ManagerCallInvite.id == invite_id).first()
    if not inv:
        return {"ok": False, "error": "Invite not found."}
    if inv.status == "scheduled":
        label = inv.new_hire_name or inv.new_hire_email
        return {"ok": False, "error": f"{label} already scheduled their intro call."}

    manager_email = inv.manager_email
    manager_name = inv.manager_name or ""
    if not manager_email:
        manager_email, manager_name = _resolve_manager(inv.new_hire_email, db)
        if manager_email:
            inv.manager_email = manager_email
            inv.manager_name = manager_name or None
            db.commit()
    if not manager_email:
        return {"ok": False, "error": "No manager could be resolved. Set one manually first."}

    sender = _system_sender()
    if not sender:
        return {"ok": False, "error": "No sender mailbox configured/connected."}

    new_hire_label = inv.new_hire_name or inv.new_hire_email
    subject, html_body = _build_invite_email(new_hire_label, manager_name, inv.token)
    ok = _send_html(sender, manager_email, subject, html_body)
    if ok:
        logger.info("[manager-call] Invite manually resent to manager %s", manager_email)
    return {"ok": ok, "manager_email": manager_email, "manager_name": manager_name}


def update_invite_manager(invite_id: int, manager_email: str, manager_name: str, db) -> dict:
    """HR override — correct a wrongly-resolved (or missing) manager for an invite."""
    inv = db.query(ManagerCallInvite).filter(ManagerCallInvite.id == invite_id).first()
    if not inv:
        return {"ok": False, "error": "Invite not found."}
    inv.manager_email = (manager_email or "").strip().lower() or None
    inv.manager_name = (manager_name or "").strip() or None
    db.commit()
    return {"ok": True}


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


def _zoho_profiles_by_email(db, emails: list[str]) -> dict:
    """official_email (lowercased) -> EmployeeZohoProfile, for the HR-directory fields
    (designation, function, skills, tenure) that MS365 doesn't carry."""
    from app.models import EmployeeZohoProfile

    if not emails:
        return {}
    rows = (
        db.query(EmployeeZohoProfile)
        .filter(EmployeeZohoProfile.official_email.in_(emails))
        .all()
    )
    return {(r.official_email or "").lower(): r for r in rows}


def _person_card(email: str, ms365_row, zoho_row, fallback_name: str = "") -> dict:
    name = (ms365_row.name if ms365_row else None) or fallback_name or email
    return {
        "name": name,
        "email": email,
        "designation": (zoho_row.designation if zoho_row else None)
            or (ms365_row.job_title if ms365_row else None),
        "department": (zoho_row.function if zoho_row else None)
            or (ms365_row.department if ms365_row else None),
        "skills": zoho_row.skill_set if zoho_row else None,
        "total_experience": zoho_row.total_experience if zoho_row else None,
        "office_location": ms365_row.office_location if ms365_row else None,
    }


def get_my_manager_team(email: str) -> dict:
    """New-hire's manager + the manager's other direct reports (same manager_email in the
    synced MS365 directory) — a scoped slice of the org hierarchy for the onboarding
    "Meet your manager & team" step, not the full company tree. Enriched with the same
    HR-directory fields (designation, department, skills, experience) the Directory page
    shows, so it's not just a bare name/email."""
    from app.models import MS365User

    db = SessionLocal()
    try:
        manager_email, manager_name = _resolve_manager(email, db)
        if not manager_email:
            return {"manager": None, "team": []}

        mgr_row = db.query(MS365User).filter(MS365User.email == manager_email).first()
        peers = (
            db.query(MS365User)
            .filter(MS365User.manager_email == manager_email, MS365User.email != email.lower())
            .order_by(MS365User.name)
            .all()
        )

        all_emails = [manager_email] + [p.email for p in peers if p.email]
        zoho_by_email = _zoho_profiles_by_email(db, all_emails)

        manager = _person_card(manager_email, mgr_row, zoho_by_email.get(manager_email), manager_name)
        team = [_person_card(p.email, p, zoho_by_email.get((p.email or "").lower())) for p in peers]
        return {"manager": manager, "team": team}
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
