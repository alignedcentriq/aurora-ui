"""
HR Letters & Certificates directory — the list shown on the Documents page's
"Letters & Certificates" tab. Generation itself happens in Zoho People; this
table only controls what employees see and where the "Request" button
deep-links to. HR manages the list (add / enable / disable / remove) from the
Documents page's "Manage letters" tab.
"""

import datetime

from app.models import HRLetterType

ZOHO_ORG = "alignedautomationservices"
ZOHO_BASE = f"https://people.zoho.com/{ZOHO_ORG}/zp#hrservices"

CATEGORIES = ["employment", "certification", "separation", "admin"]

_SEED = [
    dict(
        key="bonafide", label="Bonafide Letter",
        description="Confirms current employment status for official or external use (bank account, higher studies, visa).",
        icon="ShieldCheck", category="employment", zoho_path="bonafideletter",
        fields=["Reason for request"], enabled=True, sort_order=0,
    ),
    dict(
        key="experience", label="Experience Letter",
        description="Certifies tenure, designation and function — required by future employers or background checks.",
        icon="Award", category="employment", zoho_path="experienceletter",
        fields=["Reason for request"], enabled=True, sort_order=1,
    ),
    dict(
        key="employment_verification", label="Employment Verification Letter",
        description="Formal letter verifying you are an active employee, issued to third parties on request.",
        icon="UserRound", category="employment", zoho_path=None,
        fields=[], enabled=False, sort_order=2,
    ),
    dict(
        key="address_proof", label="Address Proof Letter",
        description="Company-certified address verification for banks, government offices, or visa applications.",
        icon="Home", category="employment", zoho_path=None,
        fields=["Purpose"], enabled=False, sort_order=3,
    ),
    dict(
        key="noc", label="No Objection Certificate",
        description="States the company has no objection to you pursuing a specific activity (studies, travel, side project).",
        icon="CheckCircle2", category="employment", zoho_path=None,
        fields=["Purpose"], enabled=False, sort_order=4,
    ),
    dict(
        key="internship", label="Internship Completion Certificate",
        description="Certifies successful completion of your internship, including duration and role.",
        icon="GraduationCap", category="certification", zoho_path=None,
        fields=["Internship duration"], enabled=False, sort_order=5,
    ),
    dict(
        key="recommendation", label="Recommendation Letter",
        description="Professional recommendation from the company for higher studies or career opportunities.",
        icon="ThumbsUp", category="certification", zoho_path=None,
        fields=["Purpose", "Recipient"], enabled=False, sort_order=6,
    ),
    dict(
        key="relieving", label="Relieving Letter",
        description="Issued upon separation — confirms last working date, role, and formal clearance.",
        icon="LogOut", category="separation", zoho_path=None,
        fields=["Last working date"], enabled=False, sort_order=7,
    ),
    dict(
        key="travel_support", label="Travel / Visa Support Letter",
        description="Official letter supporting your visa application or business travel abroad.",
        icon="Plane", category="admin", zoho_path=None,
        fields=["Destination", "Travel purpose", "Travel dates"], enabled=False, sort_order=8,
    ),
]


def seed_hr_letter_types(db) -> None:
    """Insert the built-in letter catalogue on first boot. Idempotent — skips if any row
    already exists so HR's edits/additions are never overwritten on restart."""
    if db.query(HRLetterType).first() is not None:
        return
    now = datetime.datetime.utcnow()
    for row in _SEED:
        db.add(HRLetterType(created_at=now, updated_at=now, **row))
    db.commit()


def _slugify(label: str) -> str:
    slug = "".join(c.lower() if c.isalnum() else "_" for c in label).strip("_")
    while "__" in slug:
        slug = slug.replace("__", "_")
    return slug or "letter"


def _unique_key(db, base: str) -> str:
    key = base
    n = 2
    while db.query(HRLetterType).filter(HRLetterType.key == key).first() is not None:
        key = f"{base}_{n}"
        n += 1
    return key


def to_dict(row: HRLetterType) -> dict:
    return {
        "id": row.id,
        "key": row.key,
        "label": row.label,
        "description": row.description or "",
        "icon": row.icon or "FileText",
        "category": row.category or "admin",
        "zoho_path": row.zoho_path,
        "zoho_url": f"{ZOHO_BASE}/{row.zoho_path}/add" if row.zoho_path else None,
        "fields": row.fields or [],
        "enabled": bool(row.enabled),
        "sort_order": row.sort_order or 0,
        "updated_at": row.updated_at.isoformat() if row.updated_at else None,
    }


def list_all(db) -> list:
    rows = (
        db.query(HRLetterType)
        .order_by(HRLetterType.category, HRLetterType.sort_order, HRLetterType.label)
        .all()
    )
    return [to_dict(r) for r in rows]


def create(db, payload: dict, created_by: str) -> dict:
    label = str(payload.get("label") or "").strip()
    if not label:
        raise ValueError("Label is required.")
    category = payload.get("category") if payload.get("category") in CATEGORIES else "admin"
    fields = payload.get("fields")
    fields = [str(f).strip() for f in fields if str(f).strip()] if isinstance(fields, list) else []
    zoho_path = (payload.get("zoho_path") or "").strip() or None
    row = HRLetterType(
        key=_unique_key(db, _slugify(label)),
        label=label[:200],
        description=str(payload.get("description") or "").strip()[:500],
        icon=str(payload.get("icon") or "FileText").strip() or "FileText",
        category=category,
        zoho_path=zoho_path,
        fields=fields,
        enabled=bool(payload.get("enabled")) and bool(zoho_path),
        sort_order=int(payload.get("sort_order") or 0),
        created_by=created_by,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return to_dict(row)


def update(db, letter_id: int, payload: dict) -> dict | None:
    row = db.query(HRLetterType).filter(HRLetterType.id == letter_id).first()
    if not row:
        return None
    if "label" in payload and str(payload["label"]).strip():
        row.label = str(payload["label"]).strip()[:200]
    if "description" in payload:
        row.description = str(payload["description"] or "").strip()[:500]
    if "icon" in payload and str(payload["icon"]).strip():
        row.icon = str(payload["icon"]).strip()
    if "category" in payload and payload["category"] in CATEGORIES:
        row.category = payload["category"]
    if "zoho_path" in payload:
        row.zoho_path = (str(payload["zoho_path"]).strip() or None) if payload["zoho_path"] else None
    if "fields" in payload and isinstance(payload["fields"], list):
        row.fields = [str(f).strip() for f in payload["fields"] if str(f).strip()]
    if "enabled" in payload:
        row.enabled = bool(payload["enabled"]) and bool(row.zoho_path)
    if "sort_order" in payload:
        row.sort_order = int(payload["sort_order"] or 0)
    db.commit()
    db.refresh(row)
    return to_dict(row)


def delete(db, letter_id: int) -> bool:
    row = db.query(HRLetterType).filter(HRLetterType.id == letter_id).first()
    if not row:
        return False
    db.delete(row)
    db.commit()
    return True
