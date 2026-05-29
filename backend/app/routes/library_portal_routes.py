"""
Employee-facing Library Portal routes.

Counterpart to admin_portal_routes' bookshelf section, but scoped to the
caller's own borrows so any logged-in employee can browse the catalog,
manage their requests, return books, and request extensions.
"""

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.auth import CurrentUser, get_current_user
from app.services.bookshelf_service import BookshelfService


router = APIRouter(prefix="/api/portal/library", tags=["Library Portal"])


class CreateRequestBody(BaseModel):
    book_id: int
    notes: Optional[str] = None


class ExtensionBody(BaseModel):
    additional_days: int = 7
    reason: Optional[str] = None


def _nexus_error(e: Exception):
    raise HTTPException(status_code=502, detail=f"Nexus Library error: {e}")


def _emp_name(user: CurrentUser) -> str:
    name = (getattr(user, "name", "") or "").strip()
    if name:
        return name
    return (user.email.split("@")[0] or "").replace(".", " ").replace("_", " ").title()


@router.get("/books")
def list_books(
    available_only: bool = False,
    user: CurrentUser = Depends(get_current_user),
):
    """Catalog — visible to any signed-in user."""
    if available_only:
        return BookshelfService.list_available_books()
    return BookshelfService.list_all_books()


@router.get("/my-requests")
def my_requests(user: CurrentUser = Depends(get_current_user)):
    """All borrow requests for the caller (Pending / Approved / Rejected / Returned)."""
    from app.services.bookshelf_service import _get  # type: ignore
    rows = _get("/api/library/requests/my", email=user.email) or []
    return rows


@router.post("/requests", status_code=201)
def create_request(body: CreateRequestBody, user: CurrentUser = Depends(get_current_user)):
    """Employee submits a borrow request for themselves."""
    name = _emp_name(user)
    text = BookshelfService.request_book(user.email, name, body.book_id, body.notes or "")
    if text.lower().startswith("could not submit"):
        raise HTTPException(status_code=400, detail=text)
    return {"message": text}


@router.put("/requests/{ticket_id}/return")
def return_book(ticket_id: str, user: CurrentUser = Depends(get_current_user)):
    """Employee self-service return — only allowed for the caller's own borrow."""
    result = BookshelfService.employee_return(user.email, ticket_id)
    if not result.get("ok"):
        raise HTTPException(status_code=400, detail=result.get("message", "Return failed"))
    return {"message": result["message"]}


@router.post("/requests/{ticket_id}/extension", status_code=201)
def request_extension(
    ticket_id: str,
    body: ExtensionBody,
    user: CurrentUser = Depends(get_current_user),
):
    """Employee requests an extension on their own active borrow."""
    result = BookshelfService.request_extension(
        user.email, ticket_id, body.additional_days, body.reason or ""
    )
    if not result.get("ok"):
        raise HTTPException(status_code=400, detail=result.get("message", "Extension failed"))
    return {"message": result["message"], "extension_id": result.get("extension_id")}


@router.get("/my-extensions")
def my_extensions(user: CurrentUser = Depends(get_current_user)):
    return BookshelfService.list_my_extensions(user.email)
