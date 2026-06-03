"""
BookshelfService — all data comes from the Nexus Library mock server (port 8092).
The Nexus server is the single source of truth for book inventory.
"""

import datetime
import logging
import secrets
import threading
from typing import Optional

import httpx

from app.config import settings
from app.database import SessionLocal
from app.models import ApprovalToken

logger = logging.getLogger("aurora-logger")

_TIMEOUT = 10.0
_APPROVAL_TOKEN_TTL_HOURS = 72


def _nexus(path: str) -> str:
    return f"{settings.NEXUS_LIBRARY_URL}{path}"


def _get(path: str, **params) -> dict | list | None:
    try:
        r = httpx.get(_nexus(path), params=params or None, timeout=_TIMEOUT)
        r.raise_for_status()
        return r.json()
    except Exception as e:
        logger.error("[bookshelf] GET %s failed: %s", path, e)
        return None


def _post(path: str, body: dict) -> dict | None:
    try:
        r = httpx.post(_nexus(path), json=body, timeout=_TIMEOUT)
        r.raise_for_status()
        return r.json()
    except httpx.HTTPStatusError as e:
        detail = ""
        try:
            detail = e.response.json().get("detail", "")
        except Exception:
            pass
        raise RuntimeError(detail or str(e))
    except Exception as e:
        raise RuntimeError(str(e))


def _put(path: str, body: dict = None) -> dict | None:
    try:
        r = httpx.put(_nexus(path), json=body or {}, timeout=_TIMEOUT)
        r.raise_for_status()
        return r.json()
    except httpx.HTTPStatusError as e:
        detail = ""
        try:
            detail = e.response.json().get("detail", "")
        except Exception:
            pass
        raise RuntimeError(detail or str(e))
    except Exception as e:
        raise RuntimeError(str(e))


class BookshelfService:

    @staticmethod
    def list_available_books() -> list[dict]:
        data = _get("/api/library/books", available_only=True)
        return data or []

    @staticmethod
    def list_all_books() -> list[dict]:
        data = _get("/api/library/books")
        return data or []

    @staticmethod
    def get_book(book_id: int) -> Optional[dict]:
        return _get(f"/api/library/books/{book_id}")

    @staticmethod
    def get_dashboard() -> Optional[dict]:
        return _get("/api/library/dashboard")

    @staticmethod
    def _mint_action_tokens(entity_type: str, entity_id: int, approver_email: str, employee_email: str) -> tuple[str, str]:
        """Create approve/reject ApprovalToken rows for an email action link and return the two tokens."""
        approve_tok = secrets.token_urlsafe(32)
        reject_tok = secrets.token_urlsafe(32)
        expires = datetime.datetime.utcnow() + datetime.timedelta(hours=_APPROVAL_TOKEN_TTL_HOURS)
        db = SessionLocal()
        try:
            for tok, action in ((approve_tok, "approve"), (reject_tok, "reject")):
                db.add(ApprovalToken(
                    token=tok,
                    entity_type=entity_type,
                    entity_id=entity_id,
                    action=action,
                    approver_email=approver_email,
                    employee_email=employee_email,
                    expires_at=expires,
                ))
            db.commit()
        finally:
            db.close()
        return approve_tok, reject_tok

    @staticmethod
    def request_book(employee_email: str, employee_name: str, book_id: int, notes: str = "") -> str:
        try:
            result = _post("/api/library/requests", {
                "employee_email": employee_email,
                "employee_name": employee_name,
                "book_id": book_id,
                "notes": notes,
            })
        except RuntimeError as e:
            return f"Could not submit request: {e}"

        request_id = result.get("id")
        ticket_id = result.get("ticket_id", "—")
        due_date = result.get("due_date", "—")

        # get book title for the email
        book_title, book_author = "the book", ""
        book = _get(f"/api/library/books/{book_id}")
        if book:
            book_title = book.get("title", book_title)
            book_author = book.get("author", "")

        # Mint Approve/Reject tokens so the admin can act from email.
        approve_tok = reject_tok = None
        try:
            if request_id and settings.BOOKSHELF_NOTIFY_EMAIL:
                approve_tok, reject_tok = BookshelfService._mint_action_tokens(
                    entity_type="book_request",
                    entity_id=int(request_id),
                    approver_email=settings.BOOKSHELF_NOTIFY_EMAIL,
                    employee_email=employee_email,
                )
        except Exception as e:
            logger.warning("[bookshelf] Could not mint approval tokens for request %s: %s", request_id, e)

        approve_url = f"{settings.APP_BASE_URL}/api/approve/{approve_tok}" if approve_tok else ""
        reject_url = f"{settings.APP_BASE_URL}/api/approve/{reject_tok}" if reject_tok else ""

        def _notify():
            try:
                from app.services.email_service import send_book_request_email
                send_book_request_email(
                    user_email=employee_email,
                    employee_name=employee_name,
                    employee_email=employee_email,
                    book_title=book_title,
                    book_author=book_author,
                    ticket_id=ticket_id,
                    notes=notes,
                    approve_url=approve_url,
                    reject_url=reject_url,
                )
            except Exception as e:
                logger.warning("[bookshelf] Admin notification email failed for %s: %s", ticket_id, e)

        threading.Thread(target=_notify, daemon=True).start()

        return (
            f"Your request to borrow **{book_title}** has been submitted!\n\n"
            f"**Ticket ID:** {ticket_id}\n"
            f"**Status:** Pending admin approval\n"
            f"**Expected return date (if approved):** {due_date}\n\n"
            f"Admin has been notified and will get back to you shortly."
        )

    @staticmethod
    def check_my_requests(employee_email: str) -> str:
        rows = _get("/api/library/requests/my", email=employee_email)
        if not rows:
            return "You haven't made any book requests yet."
        lines = ["Here are your recent book requests:\n"]
        for r in rows[:10]:
            line = (
                f"- **{r['book_title']}** | Ticket: `{r['ticket_id']}` | "
                f"Status: **{r['status']}**"
            )
            if r.get("due_date") and r["status"] == "Approved":
                line += f" | Due: {r['due_date']}"
            if r.get("admin_remarks"):
                line += f" | Note: {r['admin_remarks']}"
            lines.append(line)
        return "\n".join(lines)

    # ── Admin helpers (used by portal routes) ─────────────────────────────────

    @staticmethod
    def list_requests(status: Optional[str] = None) -> list[dict]:
        params = {}
        if status:
            params["status"] = status
        return _get("/api/library/requests", **params) or []

    @staticmethod
    def approve_request(request_id: int, admin_remarks: str = "", due_date: str = "") -> dict:
        body = {}
        if admin_remarks:
            body["admin_remarks"] = admin_remarks
        if due_date:
            body["due_date"] = due_date
        return _put(f"/api/library/requests/{request_id}/approve", body)

    @staticmethod
    def reject_request(request_id: int, admin_remarks: str = "") -> dict:
        return _put(f"/api/library/requests/{request_id}/reject", {"admin_remarks": admin_remarks})

    @staticmethod
    def return_book(request_id: int, admin_remarks: str = "") -> dict:
        return _put(f"/api/library/requests/{request_id}/return", {"admin_remarks": admin_remarks})

    @staticmethod
    def mark_copy_lost(copy_id: int) -> dict:
        return _put(f"/api/library/copies/{copy_id}/lost", {})

    @staticmethod
    def mark_copy_damaged(copy_id: int) -> dict:
        return _put(f"/api/library/copies/{copy_id}/damaged", {})

    @staticmethod
    def restore_copy(copy_id: int) -> dict:
        return _put(f"/api/library/copies/{copy_id}/restore", {})

    @staticmethod
    def add_book(title: str, author: str, category: str, description: str, total_copies: int) -> dict:
        return _post("/api/library/books", {
            "title": title, "author": author, "category": category,
            "description": description, "total_copies": total_copies,
        })

    @staticmethod
    def update_book(book_id: int, title: str = None, author: str = None, category: str = None, description: str = None) -> dict:
        body = {k: v for k, v in {"title": title, "author": author, "category": category, "description": description}.items() if v is not None}
        return _put(f"/api/library/books/{book_id}", body)

    @staticmethod
    def add_copies(book_id: int, count: int) -> dict:
        return _post(f"/api/library/books/{book_id}/copies", {"count": count})

    # ── Employee self-service ────────────────────────────────────────────────

    @staticmethod
    def find_my_request_by_ticket(employee_email: str, ticket_id: str) -> Optional[dict]:
        ticket_q = (ticket_id or "").strip().upper()
        if not ticket_q:
            return None
        rows = _get("/api/library/requests/my", email=employee_email) or []
        for r in rows:
            if (r.get("ticket_id") or "").upper() == ticket_q:
                return r
        return None

    @staticmethod
    def employee_return(employee_email: str, ticket_id: str) -> dict:
        req = BookshelfService.find_my_request_by_ticket(employee_email, ticket_id)
        if not req:
            return {"ok": False, "message": f"No borrow with ticket {ticket_id} found on your account."}
        if req.get("status") != "Approved":
            return {"ok": False, "message": f"Borrow {ticket_id} is {req.get('status')} — only active borrows can be returned."}
        try:
            _put(f"/api/library/requests/{req['id']}/return", {"admin_remarks": "Returned by employee"})
        except RuntimeError as e:
            return {"ok": False, "message": f"Return failed: {e}"}

        def _notify():
            try:
                from app.services.email_service import send_book_return_confirmation
                send_book_return_confirmation(
                    user_email=employee_email,
                    employee_email=employee_email,
                    employee_name=req.get("employee_name") or "",
                    book_title=req.get("book_title") or "",
                    ticket_id=req["ticket_id"],
                )
            except Exception as e:
                logger.warning("[bookshelf] return confirmation email failed for %s: %s", req["ticket_id"], e)

        threading.Thread(target=_notify, daemon=True).start()
        return {"ok": True, "message": f"Returned **{req.get('book_title') or 'the book'}** (ticket {req['ticket_id']}).", "request": req}

    @staticmethod
    def request_extension(employee_email: str, ticket_id: str, additional_days: int = 7, reason: str = "") -> dict:
        req = BookshelfService.find_my_request_by_ticket(employee_email, ticket_id)
        if not req:
            return {"ok": False, "message": f"No borrow with ticket {ticket_id} found on your account."}
        if req.get("status") != "Approved":
            return {"ok": False, "message": f"Borrow {ticket_id} is {req.get('status')} — only active borrows can be extended."}
        try:
            ext = _post(f"/api/library/requests/{req['id']}/extension", {
                "employee_email": employee_email,
                "additional_days": additional_days,
                "reason": reason or "",
            })
        except RuntimeError as e:
            return {"ok": False, "message": f"Extension request failed: {e}"}

        ext_id = ext.get("id")
        approve_url = reject_url = ""
        try:
            if ext_id and settings.BOOKSHELF_NOTIFY_EMAIL:
                approve_tok, reject_tok = BookshelfService._mint_action_tokens(
                    entity_type="book_extension",
                    entity_id=int(ext_id),
                    approver_email=settings.BOOKSHELF_NOTIFY_EMAIL,
                    employee_email=employee_email,
                )
                approve_url = f"{settings.APP_BASE_URL}/api/approve/{approve_tok}"
                reject_url = f"{settings.APP_BASE_URL}/api/approve/{reject_tok}"
        except Exception as e:
            logger.warning("[bookshelf] Could not mint extension tokens for ext %s: %s", ext_id, e)

        def _notify():
            try:
                from app.services.email_service import send_extension_request_email
                send_extension_request_email(
                    user_email=employee_email,
                    employee_name=req.get("employee_name") or "",
                    employee_email=employee_email,
                    book_title=req.get("book_title") or "",
                    ticket_id=req["ticket_id"],
                    additional_days=additional_days,
                    current_due_date=req.get("due_date") or "",
                    reason=reason or "",
                    approve_url=approve_url,
                    reject_url=reject_url,
                )
            except Exception as e:
                logger.warning("[bookshelf] extension request email failed for %s: %s", req["ticket_id"], e)

        threading.Thread(target=_notify, daemon=True).start()
        return {
            "ok": True,
            "message": (
                f"Extension request submitted for **{req.get('book_title') or 'your book'}** "
                f"(ticket {req['ticket_id']}). +{additional_days} day(s) pending admin approval."
            ),
            "extension_id": ext_id,
        }

    # ── Extension admin helpers ─────────────────────────────────────────────

    @staticmethod
    def list_extensions(status: Optional[str] = None) -> list[dict]:
        params = {}
        if status:
            params["status"] = status
        return _get("/api/library/extensions", **params) or []

    @staticmethod
    def list_my_extensions(employee_email: str) -> list[dict]:
        return _get("/api/library/extensions/my", email=employee_email) or []

    @staticmethod
    def approve_extension(ext_id: int, admin_remarks: str = "") -> dict:
        return _put(f"/api/library/extensions/{ext_id}/approve", {"admin_remarks": admin_remarks})

    @staticmethod
    def reject_extension(ext_id: int, admin_remarks: str = "") -> dict:
        return _put(f"/api/library/extensions/{ext_id}/reject", {"admin_remarks": admin_remarks})

    @staticmethod
    def get_extension(ext_id: int) -> Optional[dict]:
        rows = BookshelfService.list_extensions() or []
        for r in rows:
            if r.get("id") == ext_id:
                return r
        return None
