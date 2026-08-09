---
name: onboarding-journey
description: Guided new-hire onboarding journey — stepper page, HR tracker, doc upload→email HR, induction video; built 2026-06-23
metadata:
  type: project
---

Seamless employee onboarding flow for new hires (Employee.joining_date within ONBOARDING_WINDOW_DAYS, default 60). Built 2026-06-23.

**Spine reuse:** static step template (`services/onboarding_template.py`, mirrors [[adoption-mechanics]] capability_registry) defines 8 ordered steps + 6 joining docs; per-employee state in 3 tables (OnboardingJourney / OnboardingStepProgress / OnboardingDocSubmission). Service `onboarding_service.py` seeds journeys, `recompute()` auto-completes steps from real signals (IT ticket Resolved/Closed → it_setup; all required docs uploaded → onboarding_documents). Manual step completion routes through the [[action-registry-spine]] (`onboarding_complete_step`, receipt + undo "reopen step"). Proactive next-step nudge added to nudge_service detectors ([[proactive-nudge-layer]], action_type `open_onboarding`). Assistant: `onboarding_status` tool on HR agent (passthrough) + `onboarding` capability for starters/adoption.

**Documents flow (per user req):** download blank template (generated from doc.fields text form if no HR-authored file in uploads/onboarding_templates/) → fill offline → upload → saved under uploads/onboarding_docs/<email>/ → emailed to HR with file attached via `email_service._send_html(files=...)` + `notify_teams_activity`. HR recipient = ONBOARDING_HR_EMAIL or NOTIFY_TO_EMAIL.

**Induction video:** config-driven INDUCTION_VIDEO_URL + static chapters (seek points) in onboarding_service.INDUCTION_CHAPTERS; HTML5 player jumps to chapter via currentTime.

**Frontend:** `src/pages/OnboardingJourney.tsx` (employee stepper + docs + video sub-views, route `/onboarding`, nav item in _layout.tsx shown to all); `src/pages/OnboardingTracker.tsx` HR view registered as Control Hub tab `onboarding-tracker` (HR/Admin). Deeplink step CTAs dispatch `centriq:quick-action` event + navigate "/". Template download uses fetch-as-blob (auth headers needed; plain anchor would 403).

**API:** `/api/onboarding/me`, `/me/steps/{key}/complete`, `/me/documents`, `/documents/{key}/template`, `/me/documents/{key}/upload`, `/induction-video`, `/overview`, `/overview/{email}`.
