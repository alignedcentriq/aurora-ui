"""Run once to exchange Zoho auth code for a refresh_token."""
import requests

CLIENT_ID     = "1000.ZZQTETO0T4XMY2XI9TCJV18H3C7ZJA"   # paste your client_id
CLIENT_SECRET = "e04ab1b8837d8bbc80e9de9f62c804cf874ac393e6"   # paste your client_secret
AUTH_CODE     = "1000.90a30d77f264717a11f39399d3b23964.693e6e347f6d4a7748ba864167d56df4"
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
