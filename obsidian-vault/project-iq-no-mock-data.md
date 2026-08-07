---
name: project-iq-no-mock-data
description: Project IQ must never use mock/seed data — always uses real SharePoint corpus
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 34822c9a-98a1-4199-a7df-5cbb1a52dfca
---

Never use mock data for Project IQ. All Project DNA must come exclusively from the live SharePoint project corpus (ingested via sharepoint_project_sync). The seed_project_iq.py seeder is intentionally disabled and must stay disabled.

**Why:** Project IQ is meant to surface real, verified delivery knowledge. Seeded/mock data would pollute the knowledge base with fake project history.

**How to apply:** Do not re-enable seed_project_iq.py, do not add demo profiles, do not insert fake ProjectProfile records. All data flows from the real SharePoint corpus only.
