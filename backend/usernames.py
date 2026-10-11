"""What a username is, in one place.

`PressUser.name` began as a display name copied from Google or Apple ("Jack
Kalsched"). Since October 2026 it is a username a person picks: a handle
rather than a full name, so it reads the same in a feed row, a thread and a
search result, and it never carries a surname someone didn't mean to publish.

Accounts named before then keep their names until they next change it; the
rule applies to every name set from now on, not retroactively.
"""
import re

USERNAME_MIN = 3
USERNAME_MAX = 20
# Lowercase only, so "Jack" and "jack" can't be two people.
USERNAME_RE = re.compile(rf"^[a-z0-9._]{{{USERNAME_MIN},{USERNAME_MAX}}}$")

USERNAME_RULE = (
    f"Usernames are {USERNAME_MIN}–{USERNAME_MAX} characters: "
    "lowercase letters, numbers, . and _"
)


def suggest_username(base: str | None) -> str:
    """A valid starting point from a provider name or an email's local part:
    "Jack Kalsched" → "jackkalsched". Uniqueness is the caller's job."""
    handle = re.sub(r"[^a-z0-9._]", "", (base or "").lower())[:USERNAME_MAX]
    return handle if len(handle) >= USERNAME_MIN else (handle + "user")[:USERNAME_MAX]
