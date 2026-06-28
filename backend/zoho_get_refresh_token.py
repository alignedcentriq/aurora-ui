"""Run once to exchange Zoho auth code for a refresh_token."""
import requests

CLIENT_ID     = ""   # paste your client_id
CLIENT_SECRET = ""   # paste your client_secret
AUTH_CODE     = ""   # paste the code from Self Client
REDIRECT_URI  = "https://www.zoho.com/books/page/oauth-redirect.html"  # use the one registered in your app

resp = requests.post(
    "https://accounts.zoho.com/oauth/v2/token",
    data={
        "grant_type":   "authorization_code",
        "client_id":    CLIENT_ID,
        "client_secret": CLIENT_SECRET,
        "redirect_uri": REDIRECT_URI,
        "code":         AUTH_CODE,
    },
    timeout=10,
)

data = resp.json()
print(data)

if data.get("refresh_token"):
    print(f"\nSave this to your .env:\nZOHO_REFRESH_TOKEN={data['refresh_token']}")
else:
    print("\nNo refresh_token returned — check CLIENT_ID, CLIENT_SECRET, and that the code hasn't expired (10 min window).")
