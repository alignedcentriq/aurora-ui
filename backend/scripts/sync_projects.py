"""Manual one-shot runner for the SharePoint company-project sync.

Walks the SHAREPOINT_PROJECTS_ROOT tree, ingesting each project folder's
summaries / demo transcripts / details into the Project Showcase category.
Requires SHAREPOINT_SITE_URL + SHAREPOINT_PROJECTS_ROOT configured, the Graph
app granted on the site, and the DB + embedding model reachable. Run from backend/:

    python -m scripts.sync_projects
"""

import json

from app.services.sharepoint_project_sync import sync_projects


def main():
    print("Starting SharePoint company-project sync...")
    result = sync_projects()
    print(json.dumps(result, indent=2, default=str))


if __name__ == "__main__":
    main()
