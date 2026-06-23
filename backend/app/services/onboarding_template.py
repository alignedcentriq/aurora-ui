"""Canonical onboarding journey template — ONE source of truth for the step sequence.

Mirrors `capability_registry.py`: a frozen dataclass + an ordered tuple, with small
lookup helpers. The per-employee *progress* lives in the DB (OnboardingJourney /
OnboardingStepProgress / OnboardingDocSubmission); this module only declares WHAT the
journey is — the ordered steps every new hire walks, and the documents they must submit.

Each step maps to an existing Centriq capability (IT tickets, HR policy Q&A, org
hierarchy, training) or to one of two purpose-built sub-flows:
  • `documents` — download a blank template, fill it offline, upload it; the app emails
    the filled file to HR and notifies them (see onboarding_service.submit_document).
  • `video`    — an in-app, chaptered induction video the hire can seek through.

A step's `kind` tells the frontend how to render its primary CTA:
  manual    → a "Mark done" button (optionally with a chat prompt to help)
  deeplink  → drop `action_payload["prompt"]` into the chat, or navigate `["route"]`
  documents → open the documents sub-view
  video     → open the induction-video sub-view

`auto_signal` marks steps that complete from a real signal instead of a manual click
(checked in onboarding_service.recompute), so the journey reflects reality, not box-ticking.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional


@dataclass(frozen=True)
class OnboardingStep:
    key: str
    title: str
    description: str
    category: str
    order: int
    kind: str                                  # manual | deeplink | documents | video
    cta_label: str
    action_payload: dict = field(default_factory=dict)   # {"prompt": ...} or {"route": ...}
    auto_signal: Optional[str] = None          # "it_ticket_resolved" | "docs_submitted"
    required: bool = True

    def to_dict(self) -> dict:
        return {
            "key": self.key,
            "title": self.title,
            "description": self.description,
            "category": self.category,
            "order": self.order,
            "kind": self.kind,
            "cta_label": self.cta_label,
            "action_payload": dict(self.action_payload),
            "auto": bool(self.auto_signal),
            "required": self.required,
        }


@dataclass(frozen=True)
class OnboardingDoc:
    doc_key: str
    name: str
    description: str
    # Field labels used to generate a fillable text template when no real (HR-authored)
    # template file has been dropped into uploads/onboarding_templates/<doc_key>.*
    fields: tuple[str, ...] = ()
    required: bool = True

    def to_dict(self) -> dict:
        return {
            "doc_key": self.doc_key,
            "name": self.name,
            "description": self.description,
            "fields": list(self.fields),
            "required": self.required,
        }


# ── The journey ────────────────────────────────────────────────────────────────
# Ordered exactly as a new hire should walk it. `order` is explicit so reordering
# never depends on tuple position.
STEPS: tuple[OnboardingStep, ...] = (
    OnboardingStep(
        key="profile_confirm",
        title="Confirm your profile",
        description="Check that your name, department, designation, and contact details are correct.",
        category="Get set up",
        order=1,
        kind="manual",
        cta_label="Review my details",
        action_payload={"prompt": "Show my profile details so I can confirm they're correct."},
    ),
    OnboardingStep(
        key="it_setup",
        title="Set up your laptop & accounts",
        description="Raise an IT ticket to get your device, email, and system access ready. "
                    "This step completes automatically once IT resolves your ticket.",
        category="Get set up",
        order=2,
        kind="deeplink",
        cta_label="Raise IT setup ticket",
        action_payload={"prompt": "I'm a new joiner — please set up my laptop, email, and system access."},
        auto_signal="it_ticket_resolved",
    ),
    OnboardingStep(
        key="onboarding_documents",
        title="Complete your joining documents",
        description="Download each form, fill it in, and upload it back. We'll send the completed "
                    "documents to HR for you. This step completes once all required forms are uploaded.",
        category="Paperwork",
        order=3,
        kind="documents",
        cta_label="View documents",
        auto_signal="docs_submitted",
    ),
    OnboardingStep(
        key="induction_video",
        title="Watch the team induction",
        description="A short induction video introducing the company and your team. "
                    "Jump to any chapter you like.",
        category="Learn the ropes",
        order=4,
        kind="video",
        cta_label="Watch induction",
    ),
    OnboardingStep(
        key="policy_ack",
        title="Read & acknowledge key policies",
        description="Go through the essential HR and workplace policies so you know how things work here.",
        category="Learn the ropes",
        order=5,
        kind="deeplink",
        cta_label="Show key policies",
        action_payload={"prompt": "What are the key HR policies a new joiner should read first?"},
    ),
    OnboardingStep(
        key="meet_manager",
        title="Meet your manager & team",
        description="See who your manager is and who's on your team, so you know who to reach out to.",
        category="Learn the ropes",
        order=6,
        kind="deeplink",
        cta_label="Show my team",
        action_payload={"prompt": "Who is my manager and who is on my team?"},
    ),
    OnboardingStep(
        key="first_training",
        title="Start your first training",
        description="Kick off your first learning course on TechElevate to ramp up on the tools you'll use.",
        category="Grow",
        order=7,
        kind="deeplink",
        cta_label="Browse training",
        action_payload={"prompt": "Show me training courses I should start as a new joiner."},
    ),
    OnboardingStep(
        key="explore_assistant",
        title="Explore what the assistant can do",
        description="A quick tour of everything Centriq can help you with day to day.",
        category="Grow",
        order=8,
        kind="manual",
        cta_label="Show me around",
        action_payload={"prompt": "What can you help me with?"},
    ),
)

# ── The joining documents ────────────────────────────────────────────────────────
ONBOARDING_DOCS: tuple[OnboardingDoc, ...] = (
    OnboardingDoc(
        doc_key="personal_info",
        name="Employee personal information form",
        description="Your basic personal and contact details for our records.",
        fields=("Full name", "Date of birth", "Personal email", "Mobile number",
                "Permanent address", "Current address"),
    ),
    OnboardingDoc(
        doc_key="bank_details",
        name="Bank & salary account details",
        description="Account details for salary credit.",
        fields=("Account holder name", "Bank name", "Account number",
                "IFSC / SWIFT code", "Branch"),
    ),
    OnboardingDoc(
        doc_key="tax_declaration",
        name="Tax declaration (PAN / investment)",
        description="PAN and tax-regime declaration for payroll.",
        fields=("PAN number", "Tax regime (Old / New)", "Declared investments (if any)"),
    ),
    OnboardingDoc(
        doc_key="emergency_contact",
        name="Emergency contact & nominee",
        description="Who we should contact in an emergency, plus your insurance nominee.",
        fields=("Contact name", "Relationship", "Contact number", "Nominee name", "Nominee relationship"),
    ),
    OnboardingDoc(
        doc_key="nda",
        name="Non-disclosure agreement",
        description="Read, sign, and upload the signed confidentiality agreement.",
        fields=("Employee name", "Signature", "Date"),
    ),
    OnboardingDoc(
        doc_key="id_proof",
        name="Identity & address proof",
        description="A scanned copy of a government ID (e.g. passport / national ID) and address proof.",
        fields=(),  # upload-only (no fillable fields)
        required=True,
    ),
)


# ── Lookups ──────────────────────────────────────────────────────────────────────
_STEP_BY_KEY = {s.key: s for s in STEPS}
_DOC_BY_KEY = {d.doc_key: d for d in ONBOARDING_DOCS}


def all_steps() -> tuple[OnboardingStep, ...]:
    return STEPS


def get_step(key: str) -> Optional[OnboardingStep]:
    return _STEP_BY_KEY.get(key)


def required_step_keys() -> set[str]:
    return {s.key for s in STEPS if s.required}


def all_docs() -> tuple[OnboardingDoc, ...]:
    return ONBOARDING_DOCS


def get_doc(doc_key: str) -> Optional[OnboardingDoc]:
    return _DOC_BY_KEY.get(doc_key)


def required_doc_keys() -> set[str]:
    return {d.doc_key for d in ONBOARDING_DOCS if d.required}
