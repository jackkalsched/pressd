"""Sending push notifications through FCM's HTTP v1 API.

The receiving half has existed since the Firebase work — `mobile/lib/push.ts`
registers a token per install and `POST /users/push-token` stores it. Nothing
ever sent one. This is that missing half.

No `firebase-admin`
-------------------
That package pulls a large dependency tree into the web service to wrap one
HTTP call. `google-auth` (already installed, for other Google APIs) mints the
access token and `requests` posts the message, which is the whole protocol.

Pruning is the part that matters
--------------------------------
A token identifies an *app install*, and installs die: reinstalls, restores,
devices wiped, apps deleted. FCM answers a dead token with 404 UNREGISTERED,
and — worse — a token that is merely stale can accept a send that never
arrives. If nothing deletes them the table only grows, and every send fans out
to a longer list of addresses that will never answer. So a failed send prunes.

Nothing here is allowed to raise into a request. A notification is a courtesy
attached to something the user actually did; the thing they did must survive
its failure.
"""

from __future__ import annotations

import json
import os
import threading

import requests
from google.auth.transport.requests import Request as GoogleRequest
from google.oauth2 import service_account
from sqlalchemy import text as _sql
from sqlmodel import Session

from .database import engine

SCOPES = ["https://www.googleapis.com/auth/firebase.messaging"]
TIMEOUT_S = 10

# Errors that mean the address is gone rather than the message was bad. Anything
# else — a network blip, a 5xx from Google — leaves the token alone, because
# deleting a live token costs a user their notifications until they reinstall.
DEAD_TOKEN_STATUSES = {"UNREGISTERED", "NOT_FOUND", "INVALID_ARGUMENT"}

_creds = None
_creds_lock = threading.Lock()


def _credentials():
    """The service account, loaded once and refreshed by google-auth as needed.

    Render holds the JSON inline because it has no repo file to point at; local
    dev points at the key file. Reading the inline form first means production
    never depends on a path that does not exist there.
    """
    global _creds
    with _creds_lock:
        if _creds is not None:
            return _creds
        raw = os.getenv("FIREBASE_CREDENTIALS_JSON")
        if raw:
            _creds = service_account.Credentials.from_service_account_info(
                json.loads(raw), scopes=SCOPES)
        else:
            path = os.getenv("FIREBASE_CREDENTIALS_FILE")
            if not path or not os.path.exists(path):
                return None
            _creds = service_account.Credentials.from_service_account_file(path, scopes=SCOPES)
        return _creds


def _access_token() -> str | None:
    creds = _credentials()
    if creds is None:
        return None
    if not creds.valid:
        creds.refresh(GoogleRequest())
    return creds.token


def tokens_for_user(session: Session, user_id: int) -> list[str]:
    """Every device this person has registered.

    Read inside the request, before the response is sent, because the send
    itself happens afterwards on a background task and this session will be
    gone by then. A user can hold several — a phone, a tablet, a reinstall that
    left the old row behind.
    """
    return [r[0] for r in session.execute(_sql(
        "SELECT token FROM pushtoken WHERE user_id = :u"), {"u": user_id}).fetchall()]


def _prune(tokens: list[str]) -> None:
    if not tokens:
        return
    try:
        with Session(engine) as s:
            s.execute(_sql("DELETE FROM pushtoken WHERE token IN :t"), {"t": tuple(tokens)})
            s.commit()
        print(f"[push] pruned {len(tokens)} dead token(s)")
    except Exception as e:  # pragma: no cover
        print(f"[push] prune failed: {e}")


def send_push(tokens: list[str], title: str, body: str, data: dict[str, str]) -> None:
    """Fan one notification out to a person's devices, and forget the dead ones.

    Safe to hand to a background task: it opens its own session for pruning and
    swallows everything. Every value in `data` must be a string — FCM rejects
    the message outright otherwise, which is a tedious way to discover you sent
    an int.
    """
    if not tokens:
        return
    token = _access_token()
    project = os.getenv("FIREBASE_PROJECT_ID")
    if not token or not project:
        print("[push] no credentials configured; skipping send")
        return

    url = f"https://fcm.googleapis.com/v1/projects/{project}/messages:send"
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    payload_data = {k: str(v) for k, v in data.items()}
    dead: list[str] = []

    for t in tokens:
        try:
            r = requests.post(url, headers=headers, timeout=TIMEOUT_S, json={
                "message": {
                    "token": t,
                    "notification": {"title": title, "body": body},
                    "data": payload_data,
                    # Without this iOS delivers silently when the app is
                    # backgrounded — the whole point is the banner.
                    "apns": {"payload": {"aps": {"sound": "default"}}},
                },
            })
            if r.ok:
                continue
            status = ((r.json() or {}).get("error") or {}).get("status", "")
            if status in DEAD_TOKEN_STATUSES:
                dead.append(t)
            else:
                print(f"[push] send failed ({r.status_code} {status}) for …{t[-10:]}")
        except Exception as e:  # pragma: no cover
            print(f"[push] send errored for …{t[-10:]}: {e}")

    _prune(dead)
