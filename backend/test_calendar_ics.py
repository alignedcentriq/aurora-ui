import os, requests, datetime
from icalendar import Calendar
from dotenv import load_dotenv

load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), ".env"))

ICS_URL = os.getenv("SALWEEN_ICS_URL")

def get_week_events(ics_url):
    resp = requests.get(ics_url)
    resp.raise_for_status()

    cal = Calendar.from_ical(resp.content)
    today = datetime.date.today()
    monday = today - datetime.timedelta(days=today.weekday())
    sunday = monday + datetime.timedelta(days=6)

    events = []
    for component in cal.walk():
        if component.name != "VEVENT":
            continue
        start = component.get("DTSTART").dt
        end   = component.get("DTEND").dt
        start_date = start.date() if hasattr(start, "date") else start
        if monday <= start_date <= sunday:
            events.append({
                "subject":  str(component.get("SUMMARY", "(no subject)")),
                "start":    str(start),
                "end":      str(end),
                "location": str(component.get("LOCATION", "")),
            })

    events.sort(key=lambda e: e["start"])
    return events

if __name__ == "__main__":
    if not ICS_URL:
        print("Set SALWEEN_ICS_URL in backend/.env first.")
        raise SystemExit(1)

    events = get_week_events(ICS_URL)
    print(f"\n=== Calendar this week ===\n")
    if not events:
        print("No events found.")
    for e in events:
        print(f"  {e['start'][:16]}  ->  {e['end'][:16]}")
        print(f"  Subject  : {e['subject']}")
        if e["location"]:
            print(f"  Location : {e['location']}")
        print()
