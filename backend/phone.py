"""Phone numbers: verified by Firebase, stored only as a keyed hash.

Why a number at all: finding friends from an address book. Contacts hold phone
numbers far more often than emails, and the emails Pressd has are mostly
Google addresses — or Apple's private relay, which no one has saved — so email
alone matches few people.

Verification happens on the client. Firebase Phone Auth texts a code to the
number and, once the code is entered, signs the device into Firebase with a
short-lived ID token whose `phone_number` claim is the number it proved. The
client hands Pressd that token, never the number itself: the number is read
out of a token Google signed, so nobody can attach a phone they don't hold.
Nothing else about the Firebase session is used, and the clients sign out of
Firebase straight after.

Stored as HMAC-SHA256 under PHONE_HASH_KEY, not as the number and not as a
plain hash. There are only about ten billion possible numbers, so an unkeyed
SHA-256 is reversed by hashing every one of them; with a secret key a leaked
column is useless without the key. Matching contacts later means hashing each
candidate under the same key on the server, so the key must be identical
everywhere this database is written from — Render and any local backend
(whose .env points at production, CLAUDE.md §3). The last four digits are kept
beside the hash so Settings can show which number is on file.
"""
from __future__ import annotations

import hashlib
import hmac
import os
import time

from google.auth.transport import requests as google_requests
from google.oauth2 import id_token as google_id_token

# How recently the code must have been entered. A Firebase ID token lives an
# hour; anything older than this was minted for something else, or is a replay.
MAX_VERIFY_AGE_S = 10 * 60


class PhoneNotConfigured(RuntimeError):
    """PHONE_HASH_KEY or FIREBASE_PROJECT_ID is missing on this server."""


class PhoneTokenInvalid(ValueError):
    """The token didn't prove a phone number just now."""


def _hash_key() -> bytes:
    key = os.getenv("PHONE_HASH_KEY")
    # No fallback literal: a default key would be public in this repo, and
    # every hash written under it would be reversible (cf. JWT_SECRET, P12).
    if not key:
        raise PhoneNotConfigured("PHONE_HASH_KEY is not set")
    return key.encode()


def phone_hash(e164: str) -> str:
    """The stored form of a number. Callers pass E.164 (`+15551234567`), which
    is what Firebase's claim carries, so one number has exactly one hash."""
    return hmac.new(_hash_key(), e164.encode(), hashlib.sha256).hexdigest()


def verified_number(id_token: str) -> str:
    """The E.164 number a fresh Firebase phone sign-in proved, or raises."""
    project = os.getenv("FIREBASE_PROJECT_ID")
    if not project:
        raise PhoneNotConfigured("FIREBASE_PROJECT_ID is not set")
    _hash_key()  # fail before doing any work if the number couldn't be stored
    try:
        claims = google_id_token.verify_firebase_token(
            id_token, google_requests.Request(), audience=project,
        )
    except Exception as e:  # expired, wrong project, bad signature
        raise PhoneTokenInvalid(f"Couldn’t verify that code: {e}") from e
    if not claims:
        raise PhoneTokenInvalid("Couldn’t verify that code")
    if (claims.get("firebase") or {}).get("sign_in_provider") != "phone":
        raise PhoneTokenInvalid("That sign-in didn’t verify a phone number")
    number = claims.get("phone_number")
    if not number or not number.startswith("+"):
        raise PhoneTokenInvalid("No phone number on that sign-in")
    if time.time() - float(claims.get("auth_time", 0)) > MAX_VERIFY_AGE_S:
        raise PhoneTokenInvalid("That code was entered too long ago — send a new one")
    return number
