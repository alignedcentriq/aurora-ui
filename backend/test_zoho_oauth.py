"""Quick Zoho OAuth + API connectivity test."""
import os, sys, requests
from dotenv import load_dotenv

load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), ".env"))

CLIENT_ID     = os.getenv("ZOHO_CLIENT_ID", "")
CLIENT_SECRET = os.getenv("ZOHO_CLIENT_SECRET", "")
REFRESH_TOKEN = os.getenv("ZOHO_REFRESH_TOKEN", "")

missing = [k for k, v in {
    "ZOHO_CLIENT_ID": CLIENT_ID,
    "ZOHO_CLIENT_SECRET": CLIENT_SECRET,
    "ZOHO_REFRESH_TOKEN": REFRESH_TOKEN,
}.items() if not v]

if missing:
    print(f"MISSING in .env: {', '.join(missing)}")
    sys.exit(1)

print("Credentials found. Requesting access token...")

resp = requests.post(
    "https://accounts.zoho.com/oauth/v2/token",
    data={
        "grant_type":    "refresh_token",
        "client_id":     CLIENT_ID,
        "client_secret": CLIENT_SECRET,
        "refresh_token": REFRESH_TOKEN,
    },
    timeout=10,
)

data = resp.json()
token = data.get("access_token")

if not token:
    print(f"Token exchange FAILED: {data}")
    sys.exit(1)

print(f"Access token obtained. (expires_in={data.get('expires_in')}s)\n")

HEADERS = {"Authorization": f"Zoho-oauthtoken {token}"}

TESTS = [
    ("Zoho People  — employee list",
     "https://people.zoho.com/people/api/forms/P_EmployeeView/records?limit=1"),
    ("Zoho Expense — organizations",
     "https://expense.zoho.com/api/v1/organizations"),
    ("Zoho Recruit — job openings",
     "https://recruit.zoho.com/recruit/v2/JobOpenings?per_page=1"),
]

for label, url in TESTS:
    try:
        r = requests.get(url, headers=HEADERS, timeout=10)
        status = r.status_code
        snippet = str(r.json())[:120] if r.headers.get("content-type","").startswith("application/json") else r.text[:120]
        mark = "OK" if status < 400 else "FAIL"
        print(f"[{mark}] {label}\n     HTTP {status} | {snippet}\n")
    except Exception as e:
        print(f"[ERR] {label}\n     {e}\n")
