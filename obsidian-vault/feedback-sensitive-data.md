---
name: feedback-sensitive-data
description: "Never read, display, log, or include sensitive employee PII fields in any code, queries, API responses, or UI"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 819326d0-f418-4804-9a7e-8c8d23c33b8d
---

Never touch sensitive employee data fields under any circumstances. This includes:

- PAN number
- PF number / UAN
- Aadhaar number
- Bank account number / IFSC / bank name
- Passport number / expiry
- Fixed CTC / Variable / Total CTC
- Personal mobile number
- Personal email address
- Date of birth (full — day+month only is OK for directory birthday display)
- Marital status
- Date of Exit
- Present / Permanent address
- Any salary or compensation data

**Why:** Hard rule from the project owner — these fields must never appear in code paths, API responses, logs, or UI under any circumstances.

**How to apply:** When writing queries, models, API endpoints, or UI components that touch employee data — skip these columns entirely. Do not read them, do not SELECT them, do not pass them through, do not display them. If an existing code path exposes them, flag it rather than silently using the data. The `import_employees.py` script already marks these as `None` (skip) in `_PROFILE_COL_MAP` — follow the same pattern everywhere.
