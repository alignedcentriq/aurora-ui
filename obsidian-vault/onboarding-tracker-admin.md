---
name: onboarding-tracker-admin
description: Onboarding Tracker Content view expanded — HR-editable journey steps, quick links, stalled reminders, preview mode
metadata:
  type: project
---

Onboarding Tracker (Control Hub → "Onboarding Tracker", HR-only) has three top views: **Tracker** (joiner progress), **Content** (management), **Preview** (new-hire flow, read-only). Built 2026-07-06, extends [[onboarding-journey]].

The **Content** view ([OnboardingContentAdmin.tsx](src/pages/OnboardingContentAdmin.tsx)) is a tabbed sub-nav: Journey Steps · Videos · Documents · Reference Docs · Quick Links · Reminders.

- **Journey Steps** are now fully HR-editable, mirroring the `OnboardingDocSection` doc pattern: DB table `OnboardingStepOverride` merged over the frozen `tmpl.STEPS` via `onboarding_service._merged_steps_list()`. `all_steps()`/`get_step()`/`required_step_keys()` are the service-level merged accessors — internal call sites and the action catalog (`onboarding_step.py`) + complete-step route use these, NOT `tmpl.*`. Built-ins are editable (override row) + hideable (soft-delete); custom steps are `manual` or `deeplink` (never auto-complete). Custom step keys are `custom_<slug>`.
- **Quick Links** = `OnboardingQuickLink` table, link-only Day-1 tiles; surfaced to hires in the video-library/resources panel of [OnboardingJourney.tsx](src/pages/OnboardingJourney.tsx).
- **Stalled reminders**: config stored in `CompanySettings` key `onboarding_reminders` (JSON: enabled/stall_days/remind_hire/remind_manager/remind_hr/hr_email), read via `get_reminder_settings()`. Detector `nudge_service.detect_stalled_onboarding` fires weekly-bucketed nudges; also drives the tracker's Stalled count (overview uses configured stall_days, not env). New nudge action_type `open_onboarding_tracker`.
- **Preview**: `GET /api/onboard/admin/preview` → `svc.preview_journey()` returns the effective flow (all steps pending, no employee); rendered read-only by `PreviewPanel` in OnboardingTracker.

All Content lists are **drag-to-reorder** (native HTML5 DnD, no library — React 19 rules out react-beautiful-dnd): grip handle per row → `POST /api/onboard/admin/{steps|doc-sections|quick-links|videos|induction-docs}/reorder` with `{order:[keys]}`, rewrites sort_order to 10,20,30…. Manual "Order" number fields were removed from the dialogs.

New tables auto-create via `Base.metadata.create_all` (no migration). All admin routes under `/api/onboard/admin/{steps,quick-links,reminder-settings}` gated by `require_hr`.
