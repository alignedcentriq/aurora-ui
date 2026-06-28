"""Offline unit test for the helpdesk lifecycle-mail parser.

Pure regex over the REAL email shapes the IT helpdesk sends across a request's life
(logged -> assigned -> approved -> resolved), all captured from real samples for RE-7964/RE-7735.
No network — exercises parsing, status detection, and id<->title correlation only.

    python -m tests.test_helpdesk_mail
"""

import sys

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

from app.services.helpdesk_mail import (
    _parse_event, _detect_status, _title_matches_software, _looks_like_helpdesk,
    _normalize_id, find_request_status, ms365_service,
)

# Real samples (subject, preview) for one request, RE-7964 (+ a logged RE-7735 for slack).
LOGGED = ("Your request has been logged with request id ##RE-7964##",
          "Dear Shivam Sharma, Your request has been created with id 7964. The title of the "
          "request is : Request for Azure App API Permissions for CentriqAI View Request "
          "Please get back to us for any further clarifications.")
ASSIGNED = ("Your request with id ##RE-7964## has been assigned to Vyas Verma",
            "Dear Shivam Sharma, Your request with id 7964 has been assigned to technician - "
            "Vyas Verma View Request")
APPROVED = ("Request Id ##RE-7964## has been Approved",
            "Request ID-7964 has been Approved Request Details, Request ID: 7964 "
            "Title : Request for Azure App API Permissions for CentriqAI View Request")
RESOLVED = ("Your Request with ID :##RE-7964## has been Resolved.",
            "Dear Shivam Sharma, Your Request [ID:7964] has been resolved. "
            "Title : Request for Azure App API Permissions for CentriqAI Description : Hi Team,")
SLACK_LOGGED = ("Your request has been logged with request id ##RE-7735##",
                "Your request has been created with id 7735. The title of the request is : "
                "Software Installation Request - Slack View Request")


async def _run_async_checks(ok):
    """find_request_status, with fetch_my_emails monkeypatched to canned inbox data."""
    def _email(sub_prev, received):
        return {"subject": sub_prev[0], "from_name": "helpdesk",
                "from_email": "helpdesk@alignedautomation.com", "preview": sub_prev[1],
                "received": received}

    orig = ms365_service.fetch_my_emails

    async def fake(token, top=15):
        return {"success": True, "emails": [
            # newest first (as Graph returns), full RE-7964 lifecycle + a slack logged
            _email(RESOLVED, "2026-06-02T18:39:00Z"),
            _email(APPROVED, "2026-06-02T16:59:00Z"),
            _email(ASSIGNED, "2026-06-01T12:25:00Z"),
            _email(LOGGED,   "2026-06-01T12:23:00Z"),
            _email(SLACK_LOGGED, "2026-06-20T10:00:00Z"),
        ]}

    ms365_service.fetch_my_emails = fake
    try:
        # CentriqAI request's latest state is RESOLVED -> not open
        st = await find_request_status("tok", "CentriqAI", within_days=90)
        ok(st and st["request_id"] == "RE-7964", "correlates lifecycle to RE-7964 by id")
        ok(st and st["status"] == "resolved", "latest status is resolved (newest mail wins)")
        ok(st and st["is_open"] is False, "resolved request is NOT open")

        # slack has only a 'logged' mail -> open, blocks a duplicate
        st2 = await find_request_status("tok", "slack", within_days=90)
        ok(st2 and st2["request_id"] == "RE-7735", "slack maps to its logged request")
        ok(st2 and st2["status"] == "logged" and st2["is_open"], "slack request is open")

        # software with no helpdesk mail -> None (caller falls back to window)
        st3 = await find_request_status("tok", "figma", within_days=90)
        ok(st3 is None, "unknown software -> None")

        # no token -> None
        st4 = await find_request_status("", "slack")
        ok(st4 is None, "no token -> None")
    finally:
        ms365_service.fetch_my_emails = orig


def main():
    import asyncio
    fails = []

    def ok(cond, msg):
        print(f"  {'ok  ' if cond else 'FAIL'} {msg}")
        if not cond:
            fails.append(msg)

    print("id normalization:")
    ok(_normalize_id("RE-7964") == "RE-7964", "RE-7964 -> RE-7964")
    ok(_normalize_id("7964") == "RE-7964", "bare 7964 -> RE-7964")

    print("status detection (subject):")
    ok(_detect_status(LOGGED[0]) == "logged", "logged subject")
    ok(_detect_status(ASSIGNED[0]) == "assigned", "assigned subject")
    ok(_detect_status(APPROVED[0]) == "approved", "approved subject")
    ok(_detect_status(RESOLVED[0]) == "resolved", "resolved subject")

    print("event parse (each lifecycle mail):")
    e = _parse_event(*LOGGED)
    ok(e and e["request_id"] == "RE-7964" and e["status"] == "logged", "logged: id+status")
    ok(e and e["title"] == "Request for Azure App API Permissions for CentriqAI", "logged: title")
    a = _parse_event(*ASSIGNED)
    ok(a and a["status"] == "assigned" and a["request_id"] == "RE-7964", "assigned: id+status")
    ok(a and a["technician"] == "Vyas Verma", "assigned: technician extracted")
    ok(a and a["title"] == "", "assigned mail carries no title (id-only)")
    p = _parse_event(*APPROVED)
    ok(p and p["status"] == "approved" and p["title"].endswith("CentriqAI"), "approved: status+title")
    r = _parse_event(*RESOLVED)
    ok(r and r["status"] == "resolved" and r["title"].endswith("CentriqAI"), "resolved: status+title (stops before Description)")

    print("sender / software matching:")
    ok(_looks_like_helpdesk("helpdesk@alignedautomation.com", "helpdesk", LOGGED[0]), "helpdesk sender")
    ok(_looks_like_helpdesk("noreply@x.com", "", ASSIGNED[0]), "lifecycle subject recognized when sender masked")
    ok(not _looks_like_helpdesk("boss@x.com", "Boss", "Re: lunch"), "random sender not helpdesk")
    ok(_title_matches_software("Software Installation Request - Slack", "slack"), "slack matches title")
    ok(not _title_matches_software("Software Installation Request - Slack", "figma"), "figma does not match")

    print("find_request_status (canned inbox):")
    import asyncio
    asyncio.run(_run_async_checks(ok))

    print(f"\n{'=' * 50}")
    if fails:
        print(f"FAILED: {len(fails)} check(s).")
        raise SystemExit(1)
    print("ALL PASSED.")


if __name__ == "__main__":
    main()
