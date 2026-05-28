import datetime
import threading
from app.database import SessionLocal
from app.config import settings
from app.models import Employee, Book, BookRequest


class BookshelfService:

    @staticmethod
    def _get_or_create_employee(db, email: str) -> Employee:
        emp = db.query(Employee).filter(Employee.email == email).first()
        if not emp:
            name = email.split("@")[0].replace(".", " ").replace("_", " ").title()
            emp = Employee(
                employee_id=f"EMP{abs(hash(email)) % 9000 + 1000}",
                name=name,
                email=email,
                department="General",
                designation="Employee",
                joining_date=datetime.date.today(),
                employment_type="Full-time",
                shift_type="Day",
            )
            db.add(emp)
            db.commit()
            db.refresh(emp)
        return emp

    @staticmethod
    def list_available_books() -> list[dict]:
        db = SessionLocal()
        try:
            books = (
                db.query(Book)
                .filter(Book.status == "Active", Book.available_copies > 0)
                .order_by(Book.title)
                .all()
            )
            return [
                {
                    "id": b.id,
                    "title": b.title,
                    "author": b.author or "Unknown",
                    "category": b.category or "General",
                    "description": b.description or "",
                    "available_copies": b.available_copies,
                    "total_copies": b.total_copies,
                }
                for b in books
            ]
        finally:
            db.close()

    @staticmethod
    def list_all_books() -> list[dict]:
        db = SessionLocal()
        try:
            books = db.query(Book).order_by(Book.title).all()
            return [
                {
                    "id": b.id,
                    "title": b.title,
                    "author": b.author or "",
                    "category": b.category or "",
                    "description": b.description or "",
                    "available_copies": b.available_copies,
                    "total_copies": b.total_copies,
                    "status": b.status,
                    "created_at": b.created_at.isoformat(),
                }
                for b in books
            ]
        finally:
            db.close()

    @staticmethod
    def request_book(email: str, book_id: int, notes: str = "") -> str:
        db = SessionLocal()
        try:
            emp = BookshelfService._get_or_create_employee(db, email)
            book = db.query(Book).filter(Book.id == book_id).first()
            if not book:
                return "Book not found. Please check the book ID and try again."
            if book.available_copies <= 0:
                return f"Sorry, '{book.title}' is currently not available. All copies are checked out."

            ts = datetime.datetime.utcnow().strftime("%m%d%H%M%S")
            ticket_id = f"BK-{ts}"

            req = BookRequest(
                ticket_id=ticket_id,
                employee_id=emp.id,
                book_id=book.id,
                request_type="Issue",
                status="Pending",
                notes=notes,
                due_date=datetime.date.today() + datetime.timedelta(days=14),
            )
            db.add(req)
            db.commit()
            db.refresh(req)

            def _notify():
                try:
                    from app.services.email_service import send_book_request_email
                    send_book_request_email(
                        user_email=email,
                        employee_name=emp.name,
                        employee_email=emp.email,
                        book_title=book.title,
                        book_author=book.author or "Unknown",
                        ticket_id=ticket_id,
                        notes=notes,
                    )
                except Exception:
                    pass

            threading.Thread(target=_notify, daemon=True).start()

            return (
                f"Your request to borrow **{book.title}** has been submitted successfully!\n\n"
                f"**Ticket ID:** {ticket_id}\n"
                f"**Status:** Pending admin approval\n"
                f"**Expected return date (if approved):** {req.due_date}\n\n"
                f"Admin has been notified and will get back to you shortly."
            )
        finally:
            db.close()

    @staticmethod
    def check_my_requests(email: str) -> str:
        db = SessionLocal()
        try:
            emp = db.query(Employee).filter(Employee.email == email).first()
            if not emp:
                return "No book requests found for your account."
            rows = (
                db.query(BookRequest, Book)
                .join(Book, BookRequest.book_id == Book.id)
                .filter(BookRequest.employee_id == emp.id)
                .order_by(BookRequest.requested_at.desc())
                .limit(10)
                .all()
            )
            if not rows:
                return "You haven't made any book requests yet."
            lines = ["Here are your recent book requests:\n"]
            for req, book in rows:
                lines.append(
                    f"- **{book.title}** | Ticket: {req.ticket_id} | Status: **{req.status}**"
                    + (f" | Due: {req.due_date}" if req.due_date and req.status == "Approved" else "")
                    + (f" | Remarks: {req.admin_remarks}" if req.admin_remarks else "")
                )
            return "\n".join(lines)
        finally:
            db.close()
