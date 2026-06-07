"""Form Library service for Centriq AI.

Admins define fillable forms (visitor pass, parking request, desk booking, …) from the Form
Library page — a name, description, and an arbitrary list of fields — with no code change. Each
form's name + description + field labels are embedded once; at chat time a user's message is
matched against those embeddings by pgvector cosine similarity (see `match`), and a confident
match short-circuits the router to render the form inline. The user fills it and submits → a
FormSubmission row, with the admin notified by email.

Mirrors AppDirectoryService for the embed + cosine-k-NN pattern and reuses the shared, cached,
fail-soft PolicyService._get_embedding (no new embedding client). Field-validation follows the
DocumentTemplate field shape: [{name,label,type,required,options?,placeholder?}].
"""

import datetime

from app.config import settings
from app.database import SessionLocal
from app.models import Employee, FormSubmission, FormTemplate
from app.services.policy_service import PolicyService

# Field input types the dynamic renderer + validator understand.
_FIELD_TYPES = {"text", "textarea", "date", "select", "number", "email", "checkbox", "user"}


# Migration bridge: the seeded "Visitor Pass" / "Parking Request" forms are now rendered through
# the dynamic Form Library, but their submissions still flow into AdminService so the existing
# VisitorPass / ParkingSticker records, their bespoke emails, and the Admin Portal tabs keep
# working unchanged. Keyed by lowercased form name. A delegate takes (email, field_values) and
# returns the user-facing message; when one runs, no generic FormSubmission row is created (the
# legacy table is the source of truth for these two).
def _delegate_visitor_pass(email: str, v: dict) -> str:
    from app.services.admin_service import AdminService
    return AdminService.request_visitor_pass(
        email,
        v.get("visitor_name", ""),
        v.get("visit_date", ""),
        v.get("purpose", ""),
        v.get("visit_time", ""),
        v.get("visitor_company", ""),
    )


def _delegate_parking(email: str, v: dict) -> str:
    from app.services.admin_service import AdminService
    return AdminService.request_parking_sticker(
        email,
        v.get("vehicle_type", ""),
        v.get("vehicle_number", ""),
        v.get("vehicle_make", ""),
        v.get("vehicle_model", ""),
    )


_SUBMIT_DELEGATES = {
    "visitor pass": _delegate_visitor_pass,
    "parking request": _delegate_parking,
}


class FormLibraryService:
    # ── Embedding ────────────────────────────────────────────────────────────────
    @staticmethod
    def _embed_text(name: str, description: str, category: str | None, fields: list | None):
        """Embed the combined descriptive text of a form. Returns a 768-dim list or None."""
        labels = " ".join(
            str(f.get("label") or f.get("name") or "")
            for f in (fields or []) if isinstance(f, dict)
        )
        combined = ". ".join(
            p.strip() for p in (name, description, category or "", labels) if p and p.strip()
        )
        return PolicyService._get_embedding(combined)

    # ── Field validation ─────────────────────────────────────────────────────────
    @staticmethod
    def _validate_fields(fields) -> tuple[bool, str]:
        """Validate the admin-supplied field schema. Returns (ok, error_message)."""
        if not isinstance(fields, list) or not fields:
            return False, "A form needs at least one field."
        seen = set()
        for f in fields:
            if not isinstance(f, dict):
                return False, "Each field must be an object."
            name = (f.get("name") or "").strip()
            if not name:
                return False, "Every field needs a name."
            if name in seen:
                return False, f"Duplicate field name '{name}'."
            seen.add(name)
            ftype = (f.get("type") or "text").strip()
            if ftype not in _FIELD_TYPES:
                return False, f"Unsupported field type '{ftype}' for '{name}'."
            if ftype == "select":
                opts = f.get("options")
                if not isinstance(opts, list) or not [o for o in opts if str(o).strip()]:
                    return False, f"Select field '{name}' needs at least one option."
        return True, ""

    @staticmethod
    def _normalize_fields(fields) -> list:
        """Coerce the field schema to the stored shape, dropping unknown keys."""
        out = []
        for f in fields:
            ftype = (f.get("type") or "text").strip()
            entry = {
                "name": (f.get("name") or "").strip(),
                "label": (f.get("label") or f.get("name") or "").strip(),
                "type": ftype,
                "required": bool(f.get("required")),
            }
            if f.get("placeholder"):
                entry["placeholder"] = str(f["placeholder"]).strip()
            if ftype == "select":
                entry["options"] = [str(o).strip() for o in (f.get("options") or []) if str(o).strip()]
            out.append(entry)
        return out

    @staticmethod
    def _to_dict(r: FormTemplate, include_embedding_flag: bool = True) -> dict:
        d = {
            "id": r.id,
            "name": r.name,
            "description": r.description,
            "category": r.category or "",
            "fields": r.fields or [],
            "enabled": r.enabled,
            "notify_email": r.notify_email or "",
            "notify_domain": r.notify_domain or "",
            "created_by": r.created_by,
            "created_at": r.created_at.isoformat() if r.created_at else None,
            "updated_at": r.updated_at.isoformat() if r.updated_at else None,
        }
        if include_embedding_flag:
            d["has_embedding"] = r.embedding is not None
        return d

    # ── CRUD ────────────────────────────────────────────────────────────────────
    @staticmethod
    def create(name: str, description: str, fields: list, category: str = "",
               notify_email: str = "", notify_domain: str = "", created_by: str = "") -> dict:
        name = (name or "").strip()
        description = (description or "").strip()
        category = (category or "").strip()
        if not name or not description:
            return {"status": "error", "message": "name and description are required."}
        ok, err = FormLibraryService._validate_fields(fields)
        if not ok:
            return {"status": "error", "message": err}
        norm = FormLibraryService._normalize_fields(fields)

        db = SessionLocal()
        try:
            if db.query(FormTemplate).filter(FormTemplate.name == name).first():
                return {"status": "error", "message": f"A form named '{name}' already exists."}
            row = FormTemplate(
                name=name,
                description=description,
                category=category or None,
                fields=norm,
                embedding=FormLibraryService._embed_text(name, description, category, norm),
                notify_email=(notify_email or "").strip() or None,
                notify_domain=(notify_domain or "").strip() or None,
                created_by=created_by or None,
            )
            db.add(row)
            db.commit()
            db.refresh(row)
            return {"status": "ok", "id": row.id, "message": f"Created '{name}'."}
        except Exception as e:
            db.rollback()
            return {"status": "error", "message": str(e)}
        finally:
            db.close()

    @staticmethod
    def update(form_id: int, name: str = None, description: str = None, fields: list = None,
               category: str = None, enabled: bool = None, notify_email: str = None,
               notify_domain: str = None) -> dict:
        db = SessionLocal()
        try:
            row = db.query(FormTemplate).filter(FormTemplate.id == form_id).first()
            if not row:
                return {"status": "error", "message": "Form not found."}
            if name is not None and name.strip():
                clash = (
                    db.query(FormTemplate)
                    .filter(FormTemplate.name == name.strip(), FormTemplate.id != form_id)
                    .first()
                )
                if clash:
                    return {"status": "error", "message": f"A form named '{name.strip()}' already exists."}
                row.name = name.strip()
            if description is not None and description.strip():
                row.description = description.strip()
            if category is not None:
                row.category = category.strip() or None
            if fields is not None:
                ok, err = FormLibraryService._validate_fields(fields)
                if not ok:
                    return {"status": "error", "message": err}
                row.fields = FormLibraryService._normalize_fields(fields)
            if enabled is not None:
                row.enabled = enabled
            if notify_email is not None:
                row.notify_email = notify_email.strip() or None
            if notify_domain is not None:
                row.notify_domain = notify_domain.strip() or None
            # Re-embed from the (possibly) updated descriptive text + labels.
            row.embedding = FormLibraryService._embed_text(
                row.name, row.description, row.category, row.fields
            )
            db.commit()
            return {"status": "ok", "message": f"Updated '{row.name}'."}
        except Exception as e:
            db.rollback()
            return {"status": "error", "message": str(e)}
        finally:
            db.close()

    @staticmethod
    def delete(form_id: int) -> dict:
        db = SessionLocal()
        try:
            row = db.query(FormTemplate).filter(FormTemplate.id == form_id).first()
            if not row:
                return {"status": "error", "message": "Form not found."}
            db.delete(row)
            db.commit()
            return {"status": "ok", "message": "Deleted."}
        except Exception as e:
            db.rollback()
            return {"status": "error", "message": str(e)}
        finally:
            db.close()

    @staticmethod
    def list_all(include_disabled: bool = False) -> list[dict]:
        db = SessionLocal()
        try:
            q = db.query(FormTemplate)
            if not include_disabled:
                q = q.filter(FormTemplate.enabled.is_(True))
            rows = q.order_by(FormTemplate.name).all()
            return [FormLibraryService._to_dict(r) for r in rows]
        except Exception as e:
            print(f"[FormLibrary] list_all skipped ({type(e).__name__}): {e}")
            return []
        finally:
            db.close()

    @staticmethod
    def get(form_id: int) -> dict | None:
        db = SessionLocal()
        try:
            row = db.query(FormTemplate).filter(FormTemplate.id == form_id).first()
            return FormLibraryService._to_dict(row) if row else None
        except Exception as e:
            print(f"[FormLibrary] get skipped ({type(e).__name__}): {e}")
            return None
        finally:
            db.close()

    # ── Matching (used by the router) ─────────────────────────────────────────────
    @staticmethod
    def match(query: str, k: int = 1, threshold: float | None = None) -> dict | None:
        """Return the best enabled form semantically matching the query, or None. Fail-soft:
        returns None (never raises) when the embed model is unavailable, so chat degrades to
        normal routing."""
        query = (query or "").strip()
        if not query:
            return None
        if threshold is None:
            threshold = settings.FORM_MATCH_SIM_THRESHOLD

        query_emb = PolicyService._get_embedding(query)
        if not query_emb:
            return None  # embedding model unavailable — fall through silently

        max_dist = 1.0 - threshold
        db = SessionLocal()
        try:
            dist_expr = FormTemplate.embedding.cosine_distance(query_emb)
            row = (
                db.query(FormTemplate, dist_expr.label("dist"))
                .filter(
                    FormTemplate.embedding.isnot(None),
                    FormTemplate.enabled.is_(True),
                    dist_expr <= max_dist,
                )
                .order_by(dist_expr)
                .limit(k)
                .first()
            )
            if not row:
                return None
            r, dist = row
            d = FormLibraryService._to_dict(r, include_embedding_flag=False)
            d["similarity"] = round(1.0 - float(dist), 4)
            return d
        except Exception as e:
            print(f"[FormLibrary] match skipped ({type(e).__name__}): {e}")
            return None
        finally:
            db.close()

    @staticmethod
    def backfill_embeddings() -> int:
        """Embed any rows missing a vector (e.g. created while the embed model was down).
        Safe to run on every boot; returns rows back-filled."""
        db = SessionLocal()
        try:
            rows = db.query(FormTemplate).filter(FormTemplate.embedding.is_(None)).all()
            filled = 0
            for r in rows:
                emb = FormLibraryService._embed_text(r.name, r.description, r.category, r.fields)
                if emb:
                    r.embedding = emb
                    filled += 1
            if filled:
                db.commit()
            return filled
        except Exception as e:
            db.rollback()
            print(f"[FormLibrary] backfill skipped ({type(e).__name__}): {e}")
            return 0
        finally:
            db.close()

    # ── Submissions ───────────────────────────────────────────────────────────────
    @staticmethod
    def submit(form_template_id: int, employee_email: str, field_values: dict) -> dict:
        """Validate required fields server-side, persist the submission, and notify the admin.
        `employee_email` must come from the authenticated user, never the client payload."""
        employee_email = (employee_email or "").strip()
        if not employee_email:
            return {"status": "error", "message": "Missing user identity."}
        field_values = field_values or {}

        db = SessionLocal()
        try:
            tpl = db.query(FormTemplate).filter(FormTemplate.id == form_template_id).first()
            if not tpl or not tpl.enabled:
                return {"status": "error", "message": "This form is no longer available."}

            # Server-side required-field validation + value coercion against the schema.
            cleaned: dict = {}
            missing: list[str] = []
            for f in (tpl.fields or []):
                name = f.get("name")
                label = f.get("label") or name
                raw = field_values.get(name)
                val = "" if raw is None else (raw if isinstance(raw, bool) else str(raw).strip())
                if f.get("type") == "select" and val and val not in (f.get("options") or []):
                    return {"status": "error", "message": f"'{val}' is not a valid option for {label}."}
                if f.get("required") and (val == "" or val is False):
                    missing.append(label)
                cleaned[name] = val
            if missing:
                return {"status": "error", "message": f"Please fill: {', '.join(missing)}."}

            # Migrated legacy forms delegate to AdminService (real records + bespoke emails + the
            # existing Admin Portal tab). No generic FormSubmission row for these — the legacy
            # table stays the single source of truth.
            delegate = _SUBMIT_DELEGATES.get((tpl.name or "").strip().lower())
            if delegate:
                msg = delegate(employee_email, cleaned)
                return {"status": "ok", "reference_id": "", "message": msg}

            emp = FormLibraryService._get_or_create_employee(db, employee_email)
            reference_id = f"FRM-{datetime.datetime.now().strftime('%m%d%H%M%S')}"
            sub = FormSubmission(
                reference_id=reference_id,
                form_template_id=tpl.id,
                employee_id=emp.id,
                employee_email=employee_email,
                field_values=cleaned,
                status="Pending",
            )
            db.add(sub)
            db.commit()

            # Notify (fail-soft) — explicit notify_email wins, else the default admin inbox.
            try:
                from app.services.email_service import send_form_submission_email
                rows = [(f.get("label") or f.get("name"), cleaned.get(f.get("name"), ""))
                        for f in (tpl.fields or [])]
                send_form_submission_email(
                    user_email=employee_email,
                    employee_name=emp.name,
                    employee_email=emp.email,
                    form_name=tpl.name,
                    reference_id=reference_id,
                    rows=rows,
                    to=tpl.notify_email or None,
                )
            except Exception:
                pass

            return {
                "status": "ok",
                "reference_id": reference_id,
                "message": (f"Your **{tpl.name}** request has been submitted. "
                            f"**Reference: {reference_id}**. The team has been notified."),
            }
        except Exception as e:
            db.rollback()
            return {"status": "error", "message": str(e)}
        finally:
            db.close()

    @staticmethod
    def _get_or_create_employee(db, email: str) -> Employee:
        """Get-or-create the employee row (mirrors AdminService — never fail on unknown user)."""
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
    def list_submissions(form_template_id: int | None = None, status: str | None = None) -> list[dict]:
        db = SessionLocal()
        try:
            q = db.query(FormSubmission, FormTemplate.name).join(
                FormTemplate, FormSubmission.form_template_id == FormTemplate.id
            )
            if form_template_id is not None:
                q = q.filter(FormSubmission.form_template_id == form_template_id)
            if status:
                q = q.filter(FormSubmission.status == status)
            rows = q.order_by(FormSubmission.submitted_at.desc()).all()
            return [
                {
                    "id": s.id,
                    "reference_id": s.reference_id,
                    "form_template_id": s.form_template_id,
                    "form_name": form_name,
                    "employee_email": s.employee_email,
                    "field_values": s.field_values or {},
                    "status": s.status,
                    "admin_remarks": s.admin_remarks or "",
                    "reviewed_by": s.reviewed_by,
                    "submitted_at": s.submitted_at.isoformat() if s.submitted_at else None,
                }
                for s, form_name in rows
            ]
        except Exception as e:
            print(f"[FormLibrary] list_submissions skipped ({type(e).__name__}): {e}")
            return []
        finally:
            db.close()

    @staticmethod
    def review_submission(submission_id: int, status: str, remarks: str = "",
                          reviewer: str = "") -> dict:
        if status not in {"Approved", "Rejected", "Pending"}:
            return {"status": "error", "message": "Invalid status."}
        db = SessionLocal()
        try:
            sub = db.query(FormSubmission).filter(FormSubmission.id == submission_id).first()
            if not sub:
                return {"status": "error", "message": "Submission not found."}
            sub.status = status
            sub.admin_remarks = (remarks or "").strip() or None
            sub.reviewed_by = reviewer or None
            db.commit()
            return {"status": "ok", "message": f"Marked {status}."}
        except Exception as e:
            db.rollback()
            return {"status": "error", "message": str(e)}
        finally:
            db.close()
