---
name: techelevate-local-lms
description: Local in-house TechElevate LMS (dummy data) closing the Alchemy→train→verified-skill flywheel; built 2026-06-25
metadata:
  type: project
---

Because the external TechElevate API is unreachable ([[techelevate-portal]] — no stored MS token), we built a **local LMS** backed by our own DB so the training experience works headlessly AND closes the upskilling flywheel. Scope chosen with the user: **Flywheel core + seeded dummy data** (deferred groups, login-activity, deep analytics dashboards).

**Flywheel:** Alchemy gap → `recommend_training` (internal ▸ Udemy fallback) → take MCQ assessment (graded in-app) → on pass, the training's `skill_tags` are written back to the employee as **verified** `EmployeeSkill` rows (`certification = "TechElevate: <title>"`), which [[resource-matching-feature]] and [[skill-supply-overlay]] already read. Write-back is idempotent (guarded by `TeAssignment.skills_applied`; never duplicates a skill).

**Backend:** models `TeTraining`/`TeTrainingLevel`/`TeMcqQuestion`/`TeAssignment` (models.py); `techelevate_local_service.py` (seed 8 trainings skill-tagged + sample assignments/completions, CRUD, `submit_evaluation` grading, `recommend_for_skill`); routes `techelevate_local_routes.py` prefix `/api/portal/te-local` (kept SEPARATE from the blocked external `techelevate_routes.py` proxy so they never collide); PMO chat tools `recommend_training` + `get_my_trainings` (passthrough in tool_registry + pmo_agent). Config flag `TECHELEVATE_LOCAL` (default **true**). Seeds on boot via a background thread in database.py (idempotent).

**Frontend:** `src/pages/TechElevateLocalPortal.tsx` — Control Hub tab `te-lms` "TechElevate LMS" (Trainings / Admin / Groups / My Learning). The wow moment: taking an assessment shows score + "Verified skills added to your profile".

**Authoring added 2026-06-25 (2nd pass):** clicking a training card opens a **detail modal** (Overview = description/levels/skills · Assessment = MCQ list, admin can add/delete · Enrolled = who's enrolled + status/score). Multi-level toggle in create-training. **MCQ authoring** (tap a letter to mark the correct answer). **Groups** module: `TeGroup` model (members inline JSON), create group with employee-search picker, assign a training to all members. New routes under `/api/portal/te-local`: POST/DELETE `…/trainings/{id}/questions` + `…/questions/{id}`, GET `…/trainings/{id}/enrollments`, GET `…/employees?search`, GET/POST/DELETE `…/groups` + POST `…/groups/{id}/assign`.

**Seed is split (user decision 2026-06-25):** catalog (8 trainings) always seeds; the sample-assignments seed — which writes verified skills onto ~40 REAL employees — is gated behind `TECHELEVATE_SEED_ASSIGNMENTS` (default **false**) so shared Postgres gets the catalog without mutating live skill profiles. Real employees only gain a verified skill when they actually pass an assessment.

**Verified** on throwaway SQLite end-to-end (pass→skill write-back, idempotency, fail→no skill, recommender ranking). NOT yet activated on shared Postgres (per [[live-config-needs-approval]] — needs a backend restart to create `te_*` tables + seed the catalog).
