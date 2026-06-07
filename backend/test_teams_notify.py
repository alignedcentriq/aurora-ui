"""
One-shot Teams notification test.
Always uses YOUR OWN connected MS365 account as the sender.

Usage:
    # Self-send (requires you have opened "Chat with yourself" in Teams first):
    venv\Scripts\python.exe test_teams_notify.py shivam.sharma@alignedautomation.com

    # Send to a specific recipient (recommended for first test):
    venv\Scripts\python.exe test_teams_notify.py shivam.sharma@alignedautomation.com recipient@alignedautomation.com
"""
import sys, os
sys.path.insert(0, os.path.dirname(__file__))

from app.database import SessionLocal
from app.models import ConnectedAccount
from app.services.email_service import _send_teams_message


def main():
    if len(sys.argv) < 2:
        print("Usage: venv\\Scripts\\python.exe test_teams_notify.py <your-email> [recipient-email]")
        return

    my_email = sys.argv[1].strip().lower()
    recipient = sys.argv[2].strip().lower() if len(sys.argv) >= 3 else my_email

    db = SessionLocal()
    try:
        account = (
            db.query(ConnectedAccount)
            .filter(
                ConnectedAccount.provider == "microsoft",
                ConnectedAccount.user_email == my_email,
            )
            .first()
        )
        if not account:
            print(f"[test] No connected Microsoft account for {my_email}.")
            print("       Connect MS365 in Settings -> Connected Accounts first.")
            return

        print(f"[test] Sending from {my_email} -> {recipient} ...")
        ok = _send_teams_message(
            sender_email=my_email,
            recipient_email=recipient,
            title="Centriq AI -- Teams Notification Test",
            body_html=(
                "<b>This is a test message from Centriq AI.</b><br>"
                "If you see this, approval and decision notifications are working.<br><br>"
                "<b>What happens next:</b> Every approval request (leave, desk key, Udemy, "
                "bookshelf, project update) and every decision email will also arrive as a "
                "Teams chat message with clickable Approve / Reject links."
            ),
        )
        if ok:
            print(f"[test] Delivered. Check {recipient}'s Teams chat.")
        else:
            print("[test] Failed -- see log lines above for the Graph API error.")
    finally:
        db.close()


if __name__ == "__main__":
    main()
