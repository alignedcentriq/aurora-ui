import requests
import json
import time

url = "http://localhost:8080/api/track"
events = [
    {"event": "user_login", "data": {"user_id": 123, "ip": "192.168.1.1"}},
    {"event": "page_view", "data": {"page": "/dashboard", "duration_ms": 4500}},
    {"event": "button_click", "data": {"button_id": "submit_leave", "success": True}}
]

for ev in events:
    try:
        response = requests.post(url, json=ev)
        print(f"Sent {ev['event']}, response: {response.status_code} {response.text}")
        time.sleep(1)
    except Exception as e:
        print(f"Failed to send {ev['event']}: {e}")
