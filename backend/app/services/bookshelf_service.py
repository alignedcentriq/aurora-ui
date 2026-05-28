"""
BookshelfService — all data comes from the Nexus Library mock server (port 8092).
The Nexus server is the single source of truth for book inventory.
"""

import logging
import threading
from typing import Optional

import httpx

from app.config import settings

logger = logging.getLogger("aurora-logger")

_TIMEOUT = 10.0


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

        ticket_id = result.get("ticket_id", "—")
        due_date = result.get("due_date", "—")

        # get book title for the email
        book_title, book_author = "the book", ""
        book = _get(f"/api/library/books/{book_id}")
        if book:
            book_title = book.get("title", book_title)
            book_author = book.get("author", "")

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
                )
            except Exception:
                pass

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
