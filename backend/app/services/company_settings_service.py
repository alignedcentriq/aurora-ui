import datetime
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
