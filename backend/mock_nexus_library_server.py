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
import sqlite3
import os
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
            due_date             TEXT
        );
        """)
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


def _request_row(row, book_title="") -> dict:
    return {
        "id": row["id"],
        "ticket_id": row["ticket_id"],
        "employee_email": row["employee_email"],
        "employee_name": row["employee_name"],
        "book_id": row["book_id"],
        "book_title": book_title or "",
        "copy_id": row["copy_id"],
        "request_type": row["request_type"],
        "status": row["status"],
        "notes": row["notes"] or "",
        "admin_remarks": row["admin_remarks"] or "",
        "requested_at": row["requested_at"],
        "approved_at": row["approved_at"],
        "returned_at": row["returned_at"],
        "due_date": row["due_date"],
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
                "SELECT r.*, b.title as book_title FROM borrow_requests r JOIN books b ON b.id=r.book_id WHERE r.status=? ORDER BY r.requested_at DESC",
                (status,),
            ).fetchall()
        else:
            rows = con.execute(
                "SELECT r.*, b.title as book_title FROM borrow_requests r JOIN books b ON b.id=r.book_id ORDER BY r.requested_at DESC"
            ).fetchall()
        return [_request_row(r, r["book_title"]) for r in rows]


@app.get("/api/library/requests/my")
def my_requests(email: str = Query(...)):
    with _db() as con:
        rows = con.execute(
            "SELECT r.*, b.title as book_title FROM borrow_requests r JOIN books b ON b.id=r.book_id WHERE r.employee_email=? ORDER BY r.requested_at DESC",
            (email,),
        ).fetchall()
        return [_request_row(r, r["book_title"]) for r in rows]


@app.post("/api/library/requests", status_code=201)
def create_request(body: CreateRequestBody):
    with _db() as con:
        book = con.execute("SELECT * FROM books WHERE id=?", (body.book_id,)).fetchone()
        if not book:
            raise HTTPException(404, "Book not found")
        if book["available_copies"] <= 0:
            raise HTTPException(400, f"'{book['title']}' has no available copies right now.")

        ts = datetime.datetime.utcnow().strftime("%m%d%H%M%S")
        ticket_id = f"BK-{ts}"

        due = (datetime.date.today() + datetime.timedelta(days=14)).isoformat()
        con.execute(
            """INSERT INTO borrow_requests
               (ticket_id, employee_email, employee_name, book_id, request_type, status, notes, due_date)
               VALUES (?,?,?,?,?,?,?,?)""",
            (ticket_id, body.employee_email, body.employee_name,
             body.book_id, "Issue", "Pending", body.notes, due),
        )
        return {"ticket_id": ticket_id, "due_date": due, "message": "Request submitted successfully."}


@app.put("/api/library/requests/{request_id}/approve")
def approve_request(request_id: int, body: ApproveBody):
    with _db() as con:
        req = con.execute("SELECT * FROM borrow_requests WHERE id=?", (request_id,)).fetchone()
        if not req:
            raise HTTPException(404, "Request not found")
        if req["status"] != "Pending":
            raise HTTPException(400, f"Request is already {req['status']}")

        # Assign first available copy
        copy = con.execute(
            "SELECT * FROM book_copies WHERE book_id=? AND status='Available' ORDER BY copy_number LIMIT 1",
            (req["book_id"],),
        ).fetchone()
        if not copy:
            raise HTTPException(400, "No available copies left")

        due_date = body.due_date or (datetime.date.today() + datetime.timedelta(days=14)).isoformat()
        now = datetime.datetime.utcnow().isoformat()

        con.execute(
            "UPDATE book_copies SET status='Issued', current_employee_email=?, current_employee_name=?, issued_at=?, due_date=? WHERE id=?",
            (req["employee_email"], req["employee_name"], now, due_date, copy["id"]),
        )
        con.execute(
            "UPDATE borrow_requests SET status='Approved', copy_id=?, admin_remarks=?, approved_at=?, due_date=? WHERE id=?",
            (copy["id"], body.admin_remarks, now, due_date, request_id),
        )
        _recalculate_book_counts(con, req["book_id"])
        return {"message": "Request approved", "copy_number": copy["copy_number"], "due_date": due_date}


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
        overdue = con.execute(
            "SELECT COUNT(*) FROM book_copies WHERE status='Issued' AND due_date < ?", (today,)
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

        return {
            "metrics": {
                "total_books": totals["total_books"] or 0,
                "total_copies": totals["total_copies"] or 0,
                "available_copies": totals["available_copies"] or 0,
                "issued_copies": totals["issued_copies"] or 0,
                "reserved_copies": totals["reserved_copies"] or 0,
                "overdue_books": overdue or 0,
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
        }
