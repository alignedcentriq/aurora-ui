import datetime
import json
from app.database import SessionLocal
from app.models import CompanySettings


class CompanySettingsService:
    @staticmethod
    def get(key: str) -> str:
        db = SessionLocal()
        try:
            row = db.query(CompanySettings).filter(CompanySettings.key == key).first()
            return row.value if row else ""
        finally:
            db.close()

    @staticmethod
    def set(key: str, value: str, updated_by: str = "") -> None:
        db = SessionLocal()
        try:
            row = db.query(CompanySettings).filter(CompanySettings.key == key).first()
            if row:
                row.value = value
                row.updated_by = updated_by
                row.updated_at = datetime.datetime.utcnow()
            else:
                db.add(CompanySettings(key=key, value=value, updated_by=updated_by))
            db.commit()
        finally:
            db.close()

    @staticmethod
    def get_company_context() -> str:
        return CompanySettingsService.get("company_context")

    @staticmethod
    def get_cabin_info(location: str) -> str:
        """Return formatted cabin info for the given office location (city name)."""
        raw = CompanySettingsService.get("cabin_directory")
        if not raw:
            return "No cabin directory has been set up. Please contact your Super Admin."
        try:
            offices: list[dict] = json.loads(raw)
            loc_lower = location.lower().strip()
            # Exact match first, then partial
            match = next(
                (o for o in offices if o.get("name", "").lower() == loc_lower),
                None,
            )
            if not match:
                match = next(
                    (o for o in offices
                     if loc_lower in o.get("name", "").lower()
                     or o.get("name", "").lower() in loc_lower),
                    None,
                )
            if not match:
                names = ", ".join(o["name"] for o in offices if o.get("name"))
                return (
                    f"No cabin info found for '{location}'. "
                    f"Configured offices: {names or 'none'}."
                )
            lines = [f"**{match['name']} Office — Department Cabins**"]
            dept_labels = [("admin", "Admin"), ("hr", "HR"), ("it", "IT Support"), ("pmo", "PMO")]
            for key, label in dept_labels:
                val = (match.get(key) or "").strip()
                if val:
                    lines.append(f"- {label}: {val}")
            if len(lines) == 1:
                return f"Cabin info for {match['name']} is not filled in yet. Contact Admin."
            return "\n".join(lines)
        except Exception:
            return "Cabin directory data is unavailable. Please contact Super Admin."
