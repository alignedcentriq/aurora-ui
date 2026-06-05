import io
import re
from datetime import datetime

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_RIGHT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import cm
from reportlab.platypus import HRFlowable, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle


BRAND_DARK = colors.HexColor("#0A2540")
BRAND_CYAN = colors.HexColor("#00D4AA")
TEXT_MUTED = colors.HexColor("#64748B")
TEXT_BODY = colors.HexColor("#1E293B")
BORDER_LIGHT = colors.HexColor("#E2E8F0")

_HEADER_H = 3.2 * cm  # height of the canvas-drawn letterhead band

DOC_TYPE_LABELS = {
    "project_status_report": "Project Status Report",
    "sprint_summary": "Sprint Summary",
    "meeting_minutes": "Meeting Minutes",
    "leave_application_letter": "Leave Application",
    "experience_certificate": "Experience Certificate",
    "expense_summary": "Expense Claim Summary",
    "onboarding_checklist": "Onboarding Checklist",
    "offboarding_checklist": "Offboarding Checklist",
    # ── HR / employee letters (Document Generation section) ──
    "no_objection_certificate": "No Objection Certificate",
    "employment_verification": "Employment Verification Letter",
    "project_proposal": "Project Proposal",
    "address_proof": "Address Proof Letter",
    "relieving_letter": "Relieving Letter",
    "internship_certificate": "Internship Completion Certificate",
    "recommendation_letter": "Recommendation Letter",
    "travel_support_letter": "Travel / Visa Support Letter",
}

_HR_LETTER_TYPES = {
    "no_objection_certificate", "experience_certificate", "employment_verification",
    "address_proof", "relieving_letter", "internship_certificate",
    "recommendation_letter", "travel_support_letter", "project_proposal",
}

_REF_PREFIXES = {
    "no_objection_certificate": "NOC",
    "experience_certificate":   "EXP",
    "employment_verification":  "EMV",
    "address_proof":            "ADD",
    "relieving_letter":         "REL",
    "internship_certificate":   "INT",
    "recommendation_letter":    "REC",
    "travel_support_letter":    "TRV",
    "project_proposal":         "PPR",
}

# Lines that the LLM may still emit as a signature block — stripped so the
# PDF-rendered block (always appended at the end) is the single authoritative one.
_LEGACY_SIG_RE = re.compile(
    r"^(for aligned automation|human resources department|hr department"
    r"|authorised signatory|authorized signatory)[,.]?\s*$",
    re.I,
)
_CLOSING_RE = re.compile(
    r"^(yours (faithfully|sincerely|truly)|sincerely yours|warm regards)[,.]?\s*$",
    re.I,
)


def _make_ref(doc_type: str, doc_id: str) -> str:
    prefix = _REF_PREFIXES.get(doc_type, "DOC")
    year = datetime.now().year
    try:
        seq = str(int(doc_id)).zfill(4)
    except (ValueError, TypeError):
        seq = (doc_id or "")[:4].upper() or "0001"
    return f"AA/HR/{prefix}/{year}/{seq}"


def generate_pdf(
    doc_type: str,
    title: str,
    content: str,
    generated_by: str = "Aligned Automation HR",
    thread_id: str = "",
    watermark: str = "",
    qr_url: str = "",
    subject_name: str = "",
) -> bytes:
    buffer = io.BytesIO()
    doc = SimpleDocTemplate(
        buffer,
        pagesize=A4,
        topMargin=_HEADER_H + 0.9 * cm,   # canvas letterhead lives above this margin
        bottomMargin=2.8 * cm,
        leftMargin=2.5 * cm,
        rightMargin=2.5 * cm,
    )

    styles = getSampleStyleSheet()

    # ── Typography ──────────────────────────────────────────────────────────────
    ref_style = ParagraphStyle("Ref", parent=styles["Normal"],
        fontSize=9, fontName="Helvetica", textColor=TEXT_MUTED)
    ref_right_style = ParagraphStyle("RefRight", parent=styles["Normal"],
        fontSize=9, fontName="Helvetica", textColor=TEXT_MUTED, alignment=TA_RIGHT)
    title_style = ParagraphStyle("DocTitle", parent=styles["Normal"],
        fontSize=13, fontName="Helvetica-Bold", textColor=BRAND_DARK,
        alignment=TA_CENTER, spaceAfter=0)
    section_style = ParagraphStyle("Section", parent=styles["Normal"],
        fontSize=11, fontName="Helvetica-Bold", textColor=BRAND_DARK,
        spaceBefore=0.5 * cm, spaceAfter=0.2 * cm)
    body_style = ParagraphStyle("Body", parent=styles["Normal"],
        fontSize=10.5, fontName="Helvetica", textColor=TEXT_BODY,
        leading=18, spaceAfter=0)
    closing_style = ParagraphStyle("Closing", parent=styles["Normal"],
        fontSize=10.5, fontName="Helvetica-Oblique", textColor=TEXT_BODY, leading=18)
    sig_name_style = ParagraphStyle("SigName", parent=styles["Normal"],
        fontSize=10.5, fontName="Helvetica-Bold", textColor=BRAND_DARK)
    sig_dept_style = ParagraphStyle("SigDept", parent=styles["Normal"],
        fontSize=10, fontName="Helvetica", textColor=TEXT_MUTED)
    footer_style = ParagraphStyle("Footer", parent=styles["Normal"],
        fontSize=8, fontName="Helvetica", textColor=TEXT_MUTED, alignment=TA_CENTER)

    story = []
    doc_label = DOC_TYPE_LABELS.get(doc_type, "Document")
    today = datetime.now().strftime("%B %d, %Y")
    ref = _make_ref(doc_type, thread_id)

    # ── Ref / date row ────────────────────────────────────────────────────────────
    ref_tbl = Table(
        [[
            Paragraph(f"Ref No.: {ref}", ref_style),
            Paragraph(f"Date: {today}", ref_right_style),
        ]],
        colWidths=["60%", "40%"],
    )
    ref_tbl.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("TOPPADDING", (0, 0), (-1, -1), 3),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
    ]))
    story.append(ref_tbl)
    story.append(Spacer(1, 0.4 * cm))
    story.append(HRFlowable(width="100%", thickness=0.5, color=BORDER_LIGHT, spaceAfter=0.5 * cm))

    # ── Document title with cyan underline ────────────────────────────────────────
    story.append(Paragraph(_escape((title or doc_label).upper()), title_style))
    title_tbl = Table([[""]],
        colWidths=["100%"],
        rowHeights=[0.06 * cm],
        hAlign="CENTER",
    )
    title_tbl.setStyle(TableStyle([
        ("LINEBELOW", (0, 0), (-1, -1), 1.5, BRAND_CYAN),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
    ]))
    story.append(title_tbl)
    story.append(Spacer(1, 0.65 * cm))

    # ── Letter content ────────────────────────────────────────────────────────────
    _render_content(story, content, section_style, body_style, closing_style)

    # ── Formal signature block — only for HR/employee letters ────────────────────
    if doc_type in _HR_LETTER_TYPES:
        story.append(Spacer(1, 2.0 * cm))
        sig_line_tbl = Table([[""]],
            colWidths=["38%"],
            rowHeights=[0.06 * cm],
        )
        sig_line_tbl.setStyle(TableStyle([
            ("LINEBELOW", (0, 0), (-1, -1), 0.75, TEXT_BODY),
            ("TOPPADDING", (0, 0), (-1, -1), 0),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
        ]))
        story.append(sig_line_tbl)
        story.append(Spacer(1, 0.25 * cm))
        story.append(Paragraph("Authorised Signatory", sig_name_style))
        story.append(Paragraph("Human Resources Department", sig_dept_style))
        story.append(Paragraph("Aligned Automation", sig_dept_style))

    # ── Footer ────────────────────────────────────────────────────────────────────
    story.append(Spacer(1, 0.8 * cm))
    story.append(HRFlowable(width="100%", thickness=0.5, color=BORDER_LIGHT, spaceAfter=0.3 * cm))
    if qr_url:
        footer_text = (
            "Verified and released by Aligned Automation HR.  "
            "Scan the QR code to confirm document authenticity."
        )
    else:
        footer_text = (
            "This is a system-generated draft pending HR review and approval.  |  "
            "Aligned Automation  |  Confidential"
        )
    story.append(Paragraph(footer_text, footer_style))

    # ── Build with canvas decorator (letterhead + optional watermark/QR) ──────────
    decorator = _page_decorator(watermark, qr_url)
    doc.build(story, onFirstPage=decorator, onLaterPages=decorator)
    return buffer.getvalue()


def _page_decorator(watermark: str, qr_url: str):
    """Canvas callback that draws the full-bleed letterhead on every page,
    plus an optional diagonal watermark and/or a verification QR code."""

    def _decorate(canvas, doc):
        w, h = A4
        canvas.saveState()

        # ── Letterhead band (full bleed, dark background) ─────────────────────────
        canvas.setFillColor(BRAND_DARK)
        canvas.rect(0, h - _HEADER_H, w, _HEADER_H, fill=1, stroke=0)

        # Cyan accent strip at the very bottom of the header band
        canvas.setFillColor(BRAND_CYAN)
        canvas.rect(0, h - _HEADER_H, w, 0.22 * cm, fill=1, stroke=0)

        # Company name
        canvas.setFillColor(colors.white)
        canvas.setFont("Helvetica-Bold", 19)
        canvas.drawString(2.5 * cm, h - 1.55 * cm, "ALIGNED AUTOMATION")

        # Tagline
        canvas.setFillColor(BRAND_CYAN)
        canvas.setFont("Helvetica", 8.5)
        canvas.drawString(2.5 * cm, h - 2.15 * cm, "Technology & AI Solutions")

        # Right side label
        canvas.setFillColor(colors.HexColor("#94A3B8"))
        canvas.setFont("Helvetica", 7.5)
        canvas.drawRightString(w - 2.5 * cm, h - 1.55 * cm, "HUMAN RESOURCES DEPARTMENT")

        canvas.restoreState()

        # ── Diagonal watermark ────────────────────────────────────────────────────
        if watermark:
            canvas.saveState()
            canvas.setFont("Helvetica-Bold", 60)
            canvas.setFillColor(colors.HexColor("#CBD5E1"))
            try:
                canvas.setFillAlpha(0.22)
            except Exception:
                pass
            canvas.translate(w / 2, h / 2)
            canvas.rotate(45)
            canvas.drawCentredString(0, 0, watermark)
            canvas.restoreState()

        # ── QR verification code ──────────────────────────────────────────────────
        if qr_url:
            _draw_qr(canvas, qr_url, w)

    return _decorate


def _draw_qr(canvas, url: str, page_width: float):
    """Draw a small verification QR in the bottom-right corner with a caption."""
    from reportlab.graphics import renderPDF
    from reportlab.graphics.barcode import qr
    from reportlab.graphics.shapes import Drawing

    size = 2.2 * cm
    widget = qr.QrCodeWidget(url)
    bounds = widget.getBounds()
    bw = bounds[2] - bounds[0]
    bh = bounds[3] - bounds[1]
    drawing = Drawing(size, size, transform=[size / bw, 0, 0, size / bh, 0, 0])
    drawing.add(widget)
    x = page_width - 2.5 * cm - size
    y = 1.3 * cm
    renderPDF.draw(drawing, canvas, x, y)
    canvas.saveState()
    canvas.setFont("Helvetica", 6)
    canvas.setFillColor(TEXT_MUTED)
    canvas.drawCentredString(x + size / 2, y - 0.25 * cm, "Scan to verify")
    canvas.restoreState()


def _render_content(story, content: str, section_style, body_style, closing_style=None):
    """Parse letter prose into styled ReportLab flowables.

    Blank lines in the source are treated as paragraph breaks, giving the
    rendered output proper inter-paragraph spacing instead of a wall of text.
    Common closing lines ('Yours faithfully,') are rendered in italic.
    Legacy LLM-generated signature block lines are silently stripped because
    generate_pdf always appends the authoritative signature block itself.
    """
    if closing_style is None:
        closing_style = body_style

    # Split source into paragraph blocks by one or more blank lines.
    blocks = re.split(r"\n[ \t]*\n", content.strip())

    for block in blocks:
        raw_lines = [ln.strip() for ln in block.splitlines() if ln.strip()]
        if not raw_lines:
            continue

        # ── Bullet list block ─────────────────────────────────────────────────────
        if any(ln.startswith(("- ", "* ")) for ln in raw_lines):
            for ln in raw_lines:
                if ln.startswith(("- ", "* ")):
                    story.append(Paragraph(f"•  {_escape(ln[2:].strip())}", body_style))
                else:
                    story.append(Paragraph(_escape(ln), body_style))
                story.append(Spacer(1, 0.18 * cm))
            story.append(Spacer(1, 0.15 * cm))
            continue

        # ── Single / multi-line prose paragraph ───────────────────────────────────
        text = " ".join(raw_lines)

        # Skip legacy signature-block lines emitted by older prompts.
        if _LEGACY_SIG_RE.match(text.strip()):
            continue

        # Section header: ends with ":", ALL-CAPS short phrase, or starts with "#".
        is_header = (
            (text.endswith(":") and len(text) < 70 and not text.startswith("http"))
            or text.startswith("#")
            or (text.isupper() and 3 < len(text) < 80 and len(text.split()) > 1)
        )

        if is_header:
            story.append(Paragraph(_escape(text.lstrip("#").rstrip(":").strip()), section_style))
        elif _CLOSING_RE.match(text.strip()):
            story.append(Spacer(1, 0.35 * cm))
            story.append(Paragraph(_escape(text), closing_style))
        else:
            story.append(Paragraph(_escape(text), body_style))

        story.append(Spacer(1, 0.32 * cm))


def _escape(text: str) -> str:
    return text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
