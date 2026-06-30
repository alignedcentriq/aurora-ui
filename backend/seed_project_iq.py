"""DEPRECATED — Project IQ no longer uses seeded/mock data.

Project DNA is now built exclusively from real SharePoint project content via
``app.services.sharepoint_project_sync.sync_projects`` (routing each
'Transcripts & Summary' document and each 'Individual Project Data' subfolder to
its own project) followed by ``project_iq_service.build_all_dna``.

This script previously inserted three fictional projects (Phoenix / Titan / Helix).
It is intentionally disabled so it can never repopulate fake data. To (re)build DNA
from the live corpus instead:

    POST /api/sharepoint/sync-projects     # ingest + auto-build DNA
    POST /api/project-iq/rebuild-all       # rebuild DNA from already-ingested corpus
    # or: python -m scripts.sync_projects
"""

import sys


def seed_project_iq():
    raise SystemExit(
        "seed_project_iq is deprecated. Project IQ uses real SharePoint data only — "
        "run the project sync (see module docstring), not this seeder."
    )


if __name__ == "__main__":
    print(__doc__, file=sys.stderr)
    seed_project_iq()
