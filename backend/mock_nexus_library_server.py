"""
Mock Nexus Library Server
--------------------------
Simulates the company Nexus Bookshelf Buddy system — single source of truth
for all library inventory.

Swagger UI: http://localhost:8092/docs

Usage:
    cd backend
    uvicorn mock_nexus_library_server:app --port 8092

Set in .env.local:
    NEXUS_LIBRARY_URL=http://localhost:8092
"""

import datetime
import os
import secrets
import sqlite3
from contextlib import contextmanager
from typing import Optional

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

app = FastAPI(
    title="Nexus Library Server",
    version="1.0",
    description="Mock Nexus Bookshelf Buddy — library inventory source of truth.",
    docs_url="/docs",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

DB_PATH = os.path.join(os.path.dirname(__file__), "nexus_library.db")


# ── Database Setup ────────────────────────────────────────────────────────────

def _init_db():
    with sqlite3.connect(DB_PATH) as con:
        con.executescript("""
        PRAGMA journal_mode=WAL;

        CREATE TABLE IF NOT EXISTS books (
            id               INTEGER PRIMARY KEY AUTOINCREMENT,
            title            TEXT NOT NULL,
            author           TEXT,
            category         TEXT,
            description      TEXT,
            total_copies     INTEGER DEFAULT 1,
            available_copies INTEGER DEFAULT 1,
            issued_copies    INTEGER DEFAULT 0,
            reserved_copies  INTEGER DEFAULT 0,
            lost_copies      INTEGER DEFAULT 0,
            damaged_copies   INTEGER DEFAULT 0,
            created_at       TEXT DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS book_copies (
            id                    INTEGER PRIMARY KEY AUTOINCREMENT,
            book_id               INTEGER NOT NULL REFERENCES books(id),
            copy_number           INTEGER NOT NULL,
            status                TEXT DEFAULT 'Available',
            current_employee_email TEXT,
            current_employee_name  TEXT,
            issued_at             TEXT,
            due_date              TEXT,
            UNIQUE(book_id, copy_number)
        );

        CREATE TABLE IF NOT EXISTS borrow_requests (
            id                   INTEGER PRIMARY KEY AUTOINCREMENT,
            ticket_id            TEXT UNIQUE NOT NULL,
            employee_email       TEXT NOT NULL,
            employee_name        TEXT NOT NULL,
            book_id              INTEGER NOT NULL REFERENCES books(id),
            copy_id              INTEGER REFERENCES book_copies(id),
            request_type         TEXT DEFAULT 'Issue',
            status               TEXT DEFAULT 'Pending',
            notes                TEXT,
            admin_remarks        TEXT,
            requested_at         TEXT DEFAULT (datetime('now')),
            approved_at          TEXT,
            returned_at          TEXT,
            due_date             TEXT,
            extension_count      INTEGER DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS extension_requests (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            request_id      INTEGER NOT NULL REFERENCES borrow_requests(id),
            employee_email  TEXT NOT NULL,
            additional_days INTEGER NOT NULL,
            reason          TEXT,
            status          TEXT DEFAULT 'Pending',
            admin_remarks   TEXT,
            previous_due    TEXT,
            new_due_date    TEXT,
            requested_at    TEXT DEFAULT (datetime('now')),
            actioned_at     TEXT
        );
        """)
        # Idempotent column migration for older DBs created before extension_count existed.
        cols = {row[1] for row in con.execute("PRAGMA table_info(borrow_requests)").fetchall()}
        if "extension_count" not in cols:
            con.execute("ALTER TABLE borrow_requests ADD COLUMN extension_count INTEGER DEFAULT 0")
        # Seed sample books if empty
        count = con.execute("SELECT COUNT(*) FROM books").fetchone()[0]
        if count == 0:
            _seed_books(con)


def _seed_books(con):
    books = [
        ("Clean Code", "Robert C. Martin", "Technology",
         "A handbook of agile software craftsmanship.", 5, 5),
        ("The Pragmatic Programmer", "David Thomas & Andrew Hunt", "Technology",
         "Your journey to mastery in software development.", 3, 3),
        ("Design Patterns", "Gang of Four", "Technology",
         "Elements of reusable object-oriented software.", 4, 4),
        ("Atomic Habits", "James Clear", "Self-Help",
         "An easy and proven way to build good habits.", 6, 6),
        ("Deep Work", "Cal Newport", "Productivity",
         "Rules for focused success in a distracted world.", 4, 4),
        ("The Lean Startup", "Eric Ries", "Management",
         "How today's entrepreneurs use continuous innovation.", 3, 3),
        ("Thinking, Fast and Slow", "Daniel Kahneman", "Psychology",
         "Explores the two systems that drive the way we think.", 2, 2),
        ("Zero to One", "Peter Thiel", "Management",
         "Notes on startups, or how to build the future.", 3, 3),
    ]
    for title, author, category, description, total, available in books:
        cur = con.execute(
            "INSERT INTO books (title, author, category, description, total_copies, available_copies) VALUES (?,?,?,?,?,?)",
            (title, author, category, description, total, available),
        )
        book_id = cur.lastrowid
        for i in range(1, total + 1):
            con.execute(
                "INSERT INTO book_copies (book_id, copy_number, status) VALUES (?,?,?)",
                (book_id, i, "Available"),
            )
    con.commit()


_init_db()


@contextmanager
def _db():
    con = sqlite3.connect(DB_PATH)
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA journal_mode=WAL")
    try:
        yield con
        con.commit()
    except Exception:
        con.rollback()
        raise
    finally:
        con.close()


def _book_row(row) -> dict:
    return {
        "id": row["id"],
        "title": row["title"],
        "author": row["author"] or "",
        "category": row["category"] or "",
        "description": row["description"] or "",
        "total_copies": row["total_copies"],
        "available_copies": row["available_copies"],
        "issued_copies": row["issued_copies"],
        "reserved_copies": row["reserved_copies"],
        "lost_copies": row["lost_copies"],
        "damaged_copies": row["damaged_copies"],
        "availability_status": _availability_label(row["available_copies"], row["total_copies"]),
        "created_at": row["created_at"],
    }


def _availability_label(available: int, total: int) -> str:
    if available <= 0:
        return "Currently Unavailable"
    ratio = available / max(total, 1)
    if ratio > 0.5:
        return "Available Now"
    return "Limited Availability"


def _copy_row(row) -> dict:
    return {
        "id": row["id"],
        "book_id": row["book_id"],
        "copy_number": row["copy_number"],
        "status": row["status"],
        "current_employee_email": row["current_employee_email"],
        "current_employee_name": row["current_employee_name"],
        "issued_at": row["issued_at"],
        "due_date": row["due_date"],
    }


def _request_row(row, book_title="", book_author="") -> dict:
    return {
        "id": row["id"],
        "ticket_id": row["ticket_id"],
        "employee_email": row["employee_email"],
        "employee_name": row["employee_name"],
        "book_id": row["book_id"],
        "book_title": book_title or "",
        "book_author": book_author or "",
        "copy_id": row["copy_id"],
        "request_type": row["request_type"],
        "status": row["status"],
        "notes": row["notes"] or "",
        "admin_remarks": row["admin_remarks"] or "",
        "requested_at": row["requested_at"],
        "approved_at": row["approved_at"],
        "returned_at": row["returned_at"],
        "due_date": row["due_date"],
        "extension_count": row["extension_count"] if "extension_count" in row.keys() else 0,
    }


def _extension_row(row) -> dict:
    return {
        "id": row["id"],
        "request_id": row["request_id"],
        "employee_email": row["employee_email"],
        "additional_days": row["additional_days"],
        "reason": row["reason"] or "",
        "status": row["status"],
        "admin_remarks": row["admin_remarks"] or "",
        "previous_due": row["previous_due"],
        "new_due_date": row["new_due_date"],
        "requested_at": row["requested_at"],
        "actioned_at": row["actioned_at"],
    }


def _recalculate_book_counts(con, book_id: int):
    """Recompute inventory counts from copy statuses."""
    rows = con.execute(
        "SELECT status, COUNT(*) as cnt FROM book_copies WHERE book_id=? GROUP BY status",
        (book_id,),
    ).fetchall()
    counts = {r["status"]: r["cnt"] for r in rows}
    con.execute(
        """UPDATE books SET
            available_copies = ?,
            issued_copies    = ?,
            reserved_copies  = ?,
            lost_copies      = ?,
            damaged_copies   = ?
        WHERE id = ?""",
        (
            counts.get("Available", 0),
            counts.get("Issued", 0),
            counts.get("Reserved", 0),
            counts.get("Lost", 0),
            counts.get("Damaged", 0) + counts.get("Under Maintenance", 0),
            book_id,
        ),
    )


# ── Pydantic Models ───────────────────────────────────────────────────────────

class AddBookBody(BaseModel):
    title: str
    author: Optional[str] = None
    category: Optional[str] = None
    description: Optional[str] = None
    total_copies: int = 1


class UpdateBookBody(BaseModel):
    title: Optional[str] = None
    author: Optional[str] = None
    category: Optional[str] = None
    description: Optional[str] = None


class AddCopiesBody(BaseModel):
    count: int = 1


class CreateRequestBody(BaseModel):
    employee_email: str
    employee_name: str
    book_id: int
    notes: Optional[str] = None


class ApproveBody(BaseModel):
    admin_remarks: Optional[str] = None
    due_date: Optional[str] = None  # YYYY-MM-DD


class RejectBody(BaseModel):
    admin_remarks: Optional[str] = None


class CopyStatusBody(BaseModel):
    admin_remarks: Optional[str] = None


class ExtensionRequestBody(BaseModel):
    employee_email: str
    additional_days: int = 7
    reason: Optional[str] = None


class ExtensionActionBody(BaseModel):
    admin_remarks: Optional[str] = None


# ── Books ─────────────────────────────────────────────────────────────────────

@app.get("/api/library/books")
def list_books(available_only: bool = Query(False)):
    with _db() as con:
        if available_only:
            rows = con.execute(
                "SELECT * FROM books WHERE available_copies > 0 ORDER BY title"
            ).fetchall()
        else:
            rows = con.execute("SELECT * FROM books ORDER BY title").fetchall()
        return [_book_row(r) for r in rows]


@app.get("/api/library/books/{book_id}")
def get_book(book_id: int):
    with _db() as con:
        book = con.execute("SELECT * FROM books WHERE id=?", (book_id,)).fetchone()
        if not book:
            raise HTTPException(404, "Book not found")
        copies = con.execute(
            "SELECT * FROM book_copies WHERE book_id=? ORDER BY copy_number", (book_id,)
        ).fetchall()
        return {**_book_row(book), "copies": [_copy_row(c) for c in copies]}


@app.post("/api/library/books", status_code=201)
def add_book(body: AddBookBody):
    with _db() as con:
        cur = con.execute(
            "INSERT INTO books (title, author, category, description, total_copies, available_copies) VALUES (?,?,?,?,?,?)",
            (body.title.strip(), body.author, body.category, body.description,
             body.total_copies, body.total_copies),
        )
        book_id = cur.lastrowid
        for i in range(1, body.total_copies + 1):
            con.execute(
                "INSERT INTO book_copies (book_id, copy_number, status) VALUES (?,?,?)",
                (book_id, i, "Available"),
            )
        book = con.execute("SELECT * FROM books WHERE id=?", (book_id,)).fetchone()
        return _book_row(book)


@app.put("/api/library/books/{book_id}")
def update_book(book_id: int, body: UpdateBookBody):
    with _db() as con:
        book = con.execute("SELECT * FROM books WHERE id=?", (book_id,)).fetchone()
        if not book:
            raise HTTPException(404, "Book not found")
        updates = {k: v for k, v in body.model_dump().items() if v is not None}
        if updates:
            sets = ", ".join(f"{k}=?" for k in updates)
            con.execute(f"UPDATE books SET {sets} WHERE id=?", (*updates.values(), book_id))
        book = con.execute("SELECT * FROM books WHERE id=?", (book_id,)).fetchone()
        return _book_row(book)


@app.post("/api/library/books/{book_id}/copies")
def add_copies(book_id: int, body: AddCopiesBody):
    with _db() as con:
        book = con.execute("SELECT * FROM books WHERE id=?", (book_id,)).fetchone()
        if not book:
            raise HTTPException(404, "Book not found")
        max_copy = con.execute(
            "SELECT MAX(copy_number) FROM book_copies WHERE book_id=?", (book_id,)
        ).fetchone()[0] or 0
        for i in range(1, body.count + 1):
            con.execute(
                "INSERT INTO book_copies (book_id, copy_number, status) VALUES (?,?,?)",
                (book_id, max_copy + i, "Available"),
            )
        con.execute(
            "UPDATE books SET total_copies = total_copies + ?, available_copies = available_copies + ? WHERE id=?",
            (body.count, body.count, book_id),
        )
        return {"message": f"Added {body.count} copies.", "total_copies": book["total_copies"] + body.count}


# ── Copies ────────────────────────────────────────────────────────────────────

@app.get("/api/library/copies/{copy_id}")
def get_copy(copy_id: int):
    with _db() as con:
        copy = con.execute("SELECT * FROM book_copies WHERE id=?", (copy_id,)).fetchone()
        if not copy:
            raise HTTPException(404, "Copy not found")
        return _copy_row(copy)


@app.put("/api/library/copies/{copy_id}/lost")
def mark_lost(copy_id: int, body: CopyStatusBody):
    with _db() as con:
        copy = con.execute("SELECT * FROM book_copies WHERE id=?", (copy_id,)).fetchone()
        if not copy:
            raise HTTPException(404, "Copy not found")
        if copy["status"] == "Lost":
            raise HTTPException(400, "Copy is already marked Lost")
        con.execute("UPDATE book_copies SET status='Lost', current_employee_email=NULL, current_employee_name=NULL WHERE id=?", (copy_id,))
        _recalculate_book_counts(con, copy["book_id"])
        return {"message": "Copy marked as Lost"}


@app.put("/api/library/copies/{copy_id}/damaged")
def mark_damaged(copy_id: int, body: CopyStatusBody):
    with _db() as con:
        copy = con.execute("SELECT * FROM book_copies WHERE id=?", (copy_id,)).fetchone()
        if not copy:
            raise HTTPException(404, "Copy not found")
        con.execute("UPDATE book_copies SET status='Damaged' WHERE id=?", (copy_id,))
        _recalculate_book_counts(con, copy["book_id"])
        return {"message": "Copy marked as Damaged"}


@app.put("/api/library/copies/{copy_id}/restore")
def restore_copy(copy_id: int):
    with _db() as con:
        copy = con.execute("SELECT * FROM book_copies WHERE id=?", (copy_id,)).fetchone()
        if not copy:
            raise HTTPException(404, "Copy not found")
        con.execute("UPDATE book_copies SET status='Available', current_employee_email=NULL, current_employee_name=NULL WHERE id=?", (copy_id,))
        _recalculate_book_counts(con, copy["book_id"])
        return {"message": "Copy restored to Available"}


# ── Requests ──────────────────────────────────────────────────────────────────

@app.get("/api/library/requests")
def list_requests(status: Optional[str] = Query(None)):
    with _db() as con:
        if status:
            rows = con.execute(
                "SELECT r.*, b.title as book_title, b.author as book_author FROM borrow_requests r JOIN books b ON b.id=r.book_id WHERE r.status=? ORDER BY r.requested_at DESC",
                (status,),
            ).fetchall()
        else:
            rows = con.execute(
                "SELECT r.*, b.title as book_title, b.author as book_author FROM borrow_requests r JOIN books b ON b.id=r.book_id ORDER BY r.requested_at DESC"
            ).fetchall()
        return [_request_row(r, r["book_title"], r["book_author"]) for r in rows]


@app.get("/api/library/requests/my")
def my_requests(email: str = Query(...)):
    with _db() as con:
        rows = con.execute(
            "SELECT r.*, b.title as book_title, b.author as book_author FROM borrow_requests r JOIN books b ON b.id=r.book_id WHERE r.employee_email=? ORDER BY r.requested_at DESC",
            (email,),
        ).fetchall()
        return [_request_row(r, r["book_title"], r["book_author"]) for r in rows]


@app.post("/api/library/requests", status_code=201)
def create_request(body: CreateRequestBody):
    with _db() as con:
        book = con.execute("SELECT * FROM books WHERE id=?", (body.book_id,)).fetchone()
        if not book:
            raise HTTPException(404, "Book not found")
        if book["available_copies"] <= 0:
            raise HTTPException(400, f"'{book['title']}' has no available copies right now.")

        # Ticket id includes a short random suffix so two requests in the
        # same second don't collide on the UNIQUE constraint.
        ts = datetime.datetime.utcnow().strftime("%m%d%H%M%S")
        ticket_id = f"BK-{ts}-{secrets.token_hex(2).upper()}"

        due = (datetime.date.today() + datetime.timedelta(days=14)).isoformat()
        cur = con.execute(
            """INSERT INTO borrow_requests
               (ticket_id, employee_email, employee_name, book_id, request_type, status, notes, due_date)
               VALUES (?,?,?,?,?,?,?,?)""",
            (ticket_id, body.employee_email, body.employee_name,
             body.book_id, "Issue", "Pending", body.notes, due),
        )
        return {
            "id": cur.lastrowid,
            "ticket_id": ticket_id,
            "due_date": due,
            "message": "Request submitted successfully.",
        }


@app.put("/api/library/requests/{request_id}/approve")
def approve_request(request_id: int, body: ApproveBody):
    # Use a single transaction with row-conditional copy assignment so two
    # concurrent approvals can never both grab the same Available copy.
    con = sqlite3.connect(DB_PATH, isolation_level=None)  # manual txn control
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA journal_mode=WAL")
    try:
        for attempt in range(3):
            con.execute("BEGIN IMMEDIATE")
            try:
                req = con.execute("SELECT * FROM borrow_requests WHERE id=?", (request_id,)).fetchone()
                if not req:
                    con.execute("ROLLBACK")
                    raise HTTPException(404, "Request not found")
                if req["status"] != "Pending":
                    con.execute("ROLLBACK")
                    raise HTTPException(400, f"Request is already {req['status']}")

                copy = con.execute(
                    "SELECT * FROM book_copies WHERE book_id=? AND status='Available' ORDER BY copy_number LIMIT 1",
                    (req["book_id"],),
                ).fetchone()
                if not copy:
                    con.execute("ROLLBACK")
                    raise HTTPException(400, "No available copies left")

                due_date = body.due_date or (datetime.date.today() + datetime.timedelta(days=14)).isoformat()
                now = datetime.datetime.utcnow().isoformat()

                # Conditional UPDATE — only succeeds if the copy is still Available.
                cur = con.execute(
                    "UPDATE book_copies SET status='Issued', current_employee_email=?, current_employee_name=?, issued_at=?, due_date=? "
                    "WHERE id=? AND status='Available'",
                    (req["employee_email"], req["employee_name"], now, due_date, copy["id"]),
                )
                if cur.rowcount == 0:
                    # Lost race against a concurrent approval — retry to pick another copy.
                    con.execute("ROLLBACK")
                    continue

                con.execute(
                    "UPDATE borrow_requests SET status='Approved', copy_id=?, admin_remarks=?, approved_at=?, due_date=? WHERE id=? AND status='Pending'",
                    (copy["id"], body.admin_remarks, now, due_date, request_id),
                )
                _recalculate_book_counts(con, req["book_id"])
                con.execute("COMMIT")
                return {"message": "Request approved", "copy_number": copy["copy_number"], "due_date": due_date}
            except HTTPException:
                raise
            except Exception:
                con.execute("ROLLBACK")
                raise
        raise HTTPException(409, "Could not assign a copy due to contention. Try again.")
    finally:
        con.close()


@app.put("/api/library/requests/{request_id}/reject")
def reject_request(request_id: int, body: RejectBody):
    with _db() as con:
        req = con.execute("SELECT * FROM borrow_requests WHERE id=?", (request_id,)).fetchone()
        if not req:
            raise HTTPException(404, "Request not found")
        if req["status"] != "Pending":
            raise HTTPException(400, f"Request is already {req['status']}")
        con.execute(
            "UPDATE borrow_requests SET status='Rejected', admin_remarks=? WHERE id=?",
            (body.admin_remarks, request_id),
        )
        return {"message": "Request rejected"}


@app.put("/api/library/requests/{request_id}/return")
def return_book(request_id: int, body: CopyStatusBody):
    with _db() as con:
        req = con.execute("SELECT * FROM borrow_requests WHERE id=?", (request_id,)).fetchone()
        if not req:
            raise HTTPException(404, "Request not found")
        if req["status"] != "Approved":
            raise HTTPException(400, "Only approved requests can be returned")

        now = datetime.datetime.utcnow().isoformat()
        if req["copy_id"]:
            con.execute(
                "UPDATE book_copies SET status='Available', current_employee_email=NULL, current_employee_name=NULL, issued_at=NULL, due_date=NULL WHERE id=?",
                (req["copy_id"],),
            )
            _recalculate_book_counts(con, req["book_id"])

        con.execute(
            "UPDATE borrow_requests SET status='Returned', returned_at=?, admin_remarks=? WHERE id=?",
            (now, body.admin_remarks, request_id),
        )
        return {"message": "Book returned successfully"}


# ── Dashboard ─────────────────────────────────────────────────────────────────

@app.get("/api/library/dashboard")
def dashboard():
    with _db() as con:
        totals = con.execute("""
            SELECT
                COUNT(*) as total_books,
                SUM(total_copies) as total_copies,
                SUM(available_copies) as available_copies,
                SUM(issued_copies) as issued_copies,
                SUM(reserved_copies) as reserved_copies,
                SUM(lost_copies) as lost_copies,
                SUM(damaged_copies) as damaged_copies
            FROM books
        """).fetchone()

        today = datetime.date.today().isoformat()
        soon = (datetime.date.today() + datetime.timedelta(days=7)).isoformat()

        overdue = con.execute(
            "SELECT COUNT(*) FROM book_copies WHERE status='Issued' AND due_date < ?", (today,)
        ).fetchone()[0]

        due_soon = con.execute(
            "SELECT COUNT(*) FROM book_copies WHERE status='Issued' AND due_date >= ? AND due_date <= ?",
            (today, soon),
        ).fetchone()[0]

        pending_requests = con.execute(
            "SELECT COUNT(*) FROM borrow_requests WHERE status='Pending'"
        ).fetchone()[0]

        pending_extensions = con.execute(
            "SELECT COUNT(*) FROM extension_requests WHERE status='Pending'"
        ).fetchone()[0]

        active_borrowers = con.execute(
            "SELECT COUNT(DISTINCT employee_email) FROM borrow_requests WHERE status='Approved'"
        ).fetchone()[0]

        popular = con.execute("""
            SELECT b.title, b.author, COUNT(r.id) as request_count
            FROM borrow_requests r JOIN books b ON b.id=r.book_id
            GROUP BY b.id ORDER BY request_count DESC LIMIT 5
        """).fetchall()

        most_issued = con.execute("""
            SELECT b.title, b.author, b.issued_copies
            FROM books b ORDER BY b.issued_copies DESC LIMIT 5
        """).fetchall()

        overdue_books = con.execute("""
            SELECT b.title, r.employee_name, r.employee_email, r.due_date, c.copy_number
            FROM borrow_requests r
            JOIN books b ON b.id=r.book_id
            LEFT JOIN book_copies c ON c.id=r.copy_id
            WHERE r.status='Approved' AND r.due_date < ?
            ORDER BY r.due_date ASC
        """, (today,)).fetchall()

        due_soon_list = con.execute("""
            SELECT b.title, r.employee_name, r.employee_email, r.due_date, c.copy_number
            FROM borrow_requests r
            JOIN books b ON b.id=r.book_id
            LEFT JOIN book_copies c ON c.id=r.copy_id
            WHERE r.status='Approved' AND r.due_date >= ? AND r.due_date <= ?
            ORDER BY r.due_date ASC
        """, (today, soon)).fetchall()

        assignment_list = con.execute("""
            SELECT r.ticket_id, b.title as book_title, b.author as book_author,
                   r.employee_name, r.employee_email,
                   c.copy_number, c.issued_at, r.due_date,
                   CASE WHEN r.due_date < ? THEN 'Overdue' ELSE 'Issued' END as status
            FROM borrow_requests r
            JOIN books b ON b.id=r.book_id
            LEFT JOIN book_copies c ON c.id=r.copy_id
            WHERE r.status='Approved'
            ORDER BY r.due_date ASC
        """, (today,)).fetchall()

        return {
            "metrics": {
                "total_books": totals["total_books"] or 0,
                "total_copies": totals["total_copies"] or 0,
                "available_copies": totals["available_copies"] or 0,
                "issued_copies": totals["issued_copies"] or 0,
                "reserved_copies": totals["reserved_copies"] or 0,
                "overdue_books": overdue or 0,
                "due_soon": due_soon or 0,
                "pending_requests": pending_requests or 0,
                "pending_extensions": pending_extensions or 0,
                "active_borrowers": active_borrowers or 0,
                "lost_books": totals["lost_copies"] or 0,
                "damaged_books": totals["damaged_copies"] or 0,
            },
            "popular_books": [
                {"title": r["title"], "author": r["author"], "request_count": r["request_count"]}
                for r in popular
            ],
            "most_issued": [
                {"title": r["title"], "author": r["author"], "issued_copies": r["issued_copies"]}
                for r in most_issued
            ],
            "overdue_list": [
                {
                    "title": r["title"],
                    "employee_name": r["employee_name"],
                    "employee_email": r["employee_email"],
                    "due_date": r["due_date"],
                    "copy_number": r["copy_number"],
                }
                for r in overdue_books
            ],
            "due_soon_list": [
                {
                    "title": r["title"],
                    "employee_name": r["employee_name"],
                    "employee_email": r["employee_email"],
                    "due_date": r["due_date"],
                    "copy_number": r["copy_number"],
                }
                for r in due_soon_list
            ],
            "assignment_list": [
                {
                    "ticket_id": r["ticket_id"],
                    "book_title": r["book_title"],
                    "book_author": r["book_author"] or "",
                    "employee_name": r["employee_name"],
                    "employee_email": r["employee_email"],
                    "copy_number": r["copy_number"],
                    "issued_at": r["issued_at"],
                    "due_date": r["due_date"],
                    "status": r["status"],
                }
                for r in assignment_list
            ],
        }


# ── Extensions ────────────────────────────────────────────────────────────────

@app.post("/api/library/requests/{request_id}/extension", status_code=201)
def create_extension(request_id: int, body: ExtensionRequestBody):
    with _db() as con:
        req = con.execute("SELECT * FROM borrow_requests WHERE id=?", (request_id,)).fetchone()
        if not req:
            raise HTTPException(404, "Borrow request not found")
        if req["employee_email"].lower() != body.employee_email.lower():
            raise HTTPException(403, "You can only extend your own borrow")
        if req["status"] != "Approved":
            raise HTTPException(400, "Only approved (active) borrows can be extended")

        existing_pending = con.execute(
            "SELECT id FROM extension_requests WHERE request_id=? AND status='Pending'",
            (request_id,),
        ).fetchone()
        if existing_pending:
            raise HTTPException(400, "An extension request is already pending for this borrow")

        if body.additional_days <= 0 or body.additional_days > 30:
            raise HTTPException(400, "additional_days must be between 1 and 30")

        cur = con.execute(
            """INSERT INTO extension_requests
               (request_id, employee_email, additional_days, reason, status, previous_due)
               VALUES (?,?,?,?, 'Pending', ?)""",
            (request_id, body.employee_email, body.additional_days, body.reason, req["due_date"]),
        )
        return {"id": cur.lastrowid, "message": "Extension request submitted"}


@app.get("/api/library/extensions")
def list_extensions(status: Optional[str] = Query(None)):
    with _db() as con:
        sql = """
            SELECT e.*, r.ticket_id, r.employee_name, b.title as book_title, b.author as book_author,
                   r.due_date as current_due_date
            FROM extension_requests e
            JOIN borrow_requests r ON r.id=e.request_id
            JOIN books b ON b.id=r.book_id
        """
        params = ()
        if status:
            sql += " WHERE e.status=?"
            params = (status,)
        sql += " ORDER BY e.requested_at DESC"
        rows = con.execute(sql, params).fetchall()
        return [
            {
                **_extension_row(r),
                "ticket_id": r["ticket_id"],
                "employee_name": r["employee_name"],
                "book_title": r["book_title"],
                "book_author": r["book_author"] or "",
                "current_due_date": r["current_due_date"],
            }
            for r in rows
        ]


@app.get("/api/library/extensions/my")
def my_extensions(email: str = Query(...)):
    with _db() as con:
        rows = con.execute(
            """SELECT e.*, r.ticket_id, b.title as book_title, b.author as book_author,
                      r.due_date as current_due_date
               FROM extension_requests e
               JOIN borrow_requests r ON r.id=e.request_id
               JOIN books b ON b.id=r.book_id
               WHERE e.employee_email=? ORDER BY e.requested_at DESC""",
            (email,),
        ).fetchall()
        return [
            {
                **_extension_row(r),
                "ticket_id": r["ticket_id"],
                "book_title": r["book_title"],
                "book_author": r["book_author"] or "",
                "current_due_date": r["current_due_date"],
            }
            for r in rows
        ]


@app.put("/api/library/extensions/{ext_id}/approve")
def approve_extension(ext_id: int, body: ExtensionActionBody):
    with _db() as con:
        ext = con.execute("SELECT * FROM extension_requests WHERE id=?", (ext_id,)).fetchone()
        if not ext:
            raise HTTPException(404, "Extension request not found")
        if ext["status"] != "Pending":
            raise HTTPException(400, f"Extension already {ext['status']}")

        req = con.execute("SELECT * FROM borrow_requests WHERE id=?", (ext["request_id"],)).fetchone()
        if not req or req["status"] != "Approved":
            raise HTTPException(400, "Linked borrow is no longer active")

        current_due = datetime.date.fromisoformat(req["due_date"])
        new_due = (current_due + datetime.timedelta(days=ext["additional_days"])).isoformat()
        now = datetime.datetime.utcnow().isoformat()

        con.execute(
            "UPDATE extension_requests SET status='Approved', admin_remarks=?, new_due_date=?, actioned_at=? WHERE id=?",
            (body.admin_remarks, new_due, now, ext_id),
        )
        con.execute(
            "UPDATE borrow_requests SET due_date=?, extension_count=COALESCE(extension_count,0)+1 WHERE id=?",
            (new_due, ext["request_id"]),
        )
        if req["copy_id"]:
            con.execute("UPDATE book_copies SET due_date=? WHERE id=?", (new_due, req["copy_id"]))
        return {"message": "Extension approved", "new_due_date": new_due}


@app.put("/api/library/extensions/{ext_id}/reject")
def reject_extension(ext_id: int, body: ExtensionActionBody):
    with _db() as con:
        ext = con.execute("SELECT * FROM extension_requests WHERE id=?", (ext_id,)).fetchone()
        if not ext:
            raise HTTPException(404, "Extension request not found")
        if ext["status"] != "Pending":
            raise HTTPException(400, f"Extension already {ext['status']}")
        now = datetime.datetime.utcnow().isoformat()
        con.execute(
            "UPDATE extension_requests SET status='Rejected', admin_remarks=?, actioned_at=? WHERE id=?",
            (body.admin_remarks, now, ext_id),
        )
        return {"message": "Extension rejected"}
