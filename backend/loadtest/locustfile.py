"""Load test for the Centriq AI chat SSE endpoint.

Simulates many users sending chat messages concurrently and measures the two
metrics that matter for the shared GPU server:

  - ttft            : time-to-first-token (ms) — how long until the user sees
                      the first streamed character. This is what feels "slow".
  - POST /api/chat  : full request duration (until the stream completes).

It also counts how often the concurrency gate queues ("queued") or rejects
("busy") requests, so you can find the point where ml01 saturates.

Run (after `pip install -r backend/requirements-dev.txt`):

    locust -f backend/loadtest/locustfile.py --host http://localhost:8080

Then open http://localhost:8089 and set the number of users (concurrency) and
spawn rate. Or run headless, e.g. 30 concurrent users for 2 minutes:

    locust -f backend/loadtest/locustfile.py --host http://localhost:8080 \
           --headless -u 30 -r 5 -t 2m

Watch the gate live in another terminal:

    while true; do curl -s http://localhost:8080/api/chat/load; echo; sleep 1; done

Override the prompt / identity via env vars:
    LOADTEST_MESSAGE, LOADTEST_USER_EMAIL, LOADTEST_USER_ROLE
"""
import json
import os
import time
import uuid

from locust import HttpUser, between, events, task

MESSAGE = os.getenv("LOADTEST_MESSAGE", "What is the casual leave policy?")
USER_EMAIL = os.getenv("LOADTEST_USER_EMAIL", "employee1@centriq.ai")
USER_ROLE = os.getenv("LOADTEST_USER_ROLE", "employee")


def _record(name: str, ms: float, exc=None):
    events.request.fire(
        request_type="SSE",
        name=name,
        response_time=ms,
        response_length=0,
        exception=exc,
    )


class ChatUser(HttpUser):
    # Think-time between messages from a single simulated user.
    wait_time = between(2, 8)

    @task
    def chat(self):
        session_id = f"loadtest-{uuid.uuid4()}"
        payload = {"message": MESSAGE, "session_id": session_id}
        headers = {
            "x-user-email": USER_EMAIL,
            "x-user-role": USER_ROLE,
            "Content-Type": "application/json",
            "Accept": "text/event-stream",
        }

        start = time.time()
        ttft_recorded = False
        busy = queued = False

        try:
            with self.client.post(
                "/api/chat",
                json=payload,
                headers=headers,
                stream=True,
                catch_response=True,
                name="POST /api/chat",
            ) as resp:
                if resp.status_code != 200:
                    resp.failure(f"HTTP {resp.status_code}")
                    return

                for raw in resp.iter_lines():
                    if not raw:
                        continue
                    line = raw.decode("utf-8") if isinstance(raw, bytes) else raw
                    if not line.startswith("data:"):
                        continue
                    try:
                        evt = json.loads(line[len("data:"):].strip())
                    except ValueError:
                        continue

                    etype = evt.get("type")
                    if etype == "queued":
                        queued = True
                    elif etype == "busy":
                        busy = True
                    elif etype == "token":
                        if not ttft_recorded:
                            _record("ttft", (time.time() - start) * 1000)
                            ttft_recorded = True
                    elif etype == "error":
                        resp.failure(f"stream error: {str(evt.get('message'))[:200]}")
                        return
                    elif etype == "done":
                        break

                if busy:
                    # Gate rejected us — count it so you can see the rejection rate.
                    _record("busy (rejected)", (time.time() - start) * 1000)
                    resp.failure("server busy (queue full)")
                else:
                    if queued:
                        _record("queued (waited)", (time.time() - start) * 1000)
                    resp.success()
        except Exception as exc:  # noqa: BLE001 - report any transport error
            _record("exception", (time.time() - start) * 1000, exc=exc)
