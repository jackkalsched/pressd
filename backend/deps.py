"""Authentication dependencies: JWT issuance + server-side identity verification.

Every request that touches user-owned data must depend on `current_user`, which
derives the caller's identity from a signed token — never from a client-supplied
`user_id`. Read endpoints that support viewing a friend's data should call
`authorize_view` to confirm the caller is the target user or one of their friends.
"""
import os
from datetime import datetime, timedelta, timezone

import jwt
from fastapi import Depends, Header, HTTPException, Query
from sqlmodel import Session, select

from .database import get_session
from .models import PressUser, Friendship

JWT_SECRET = os.getenv("JWT_SECRET", "dev-insecure-secret-change-me")
JWT_ALGO = "HS256"
TOKEN_TTL_DAYS = 7


def create_access_token(user_id: int) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "sub": str(user_id),
        "iat": now,
        "exp": now + timedelta(days=TOKEN_TTL_DAYS),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGO)


def auth_response(user: PressUser) -> dict:
    """Standard login payload: a session token plus the public user fields."""
    return {
        "token": create_access_token(user.id),
        "user": {"id": user.id, "name": user.name, "avatar_url": user.avatar_url,
                 "bio": user.bio},
    }


def current_user(
    authorization: str | None = Header(default=None),
    session: Session = Depends(get_session),
) -> PressUser:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="Not authenticated")
    token = authorization.split(" ", 1)[1].strip()
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGO])
    except jwt.PyJWTError:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    sub = payload.get("sub")
    user = session.get(PressUser, int(sub)) if sub is not None else None
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    return user


def optional_user(
    authorization: str | None = Header(default=None),
    session: Session = Depends(get_session),
) -> PressUser | None:
    """Like current_user but returns None instead of 401 when no valid token."""
    if not authorization or not authorization.lower().startswith("bearer "):
        return None
    try:
        payload = jwt.decode(
            authorization.split(" ", 1)[1].strip(), JWT_SECRET, algorithms=[JWT_ALGO]
        )
    except jwt.PyJWTError:
        return None
    sub = payload.get("sub")
    return session.get(PressUser, int(sub)) if sub is not None else None


def are_friends(session: Session, a: int, b: int) -> bool:
    if a == b:
        return True
    lo, hi = min(a, b), max(a, b)
    # Pending requests grant no access — only accepted friendships count
    return session.exec(
        select(Friendship).where(
            Friendship.user_id_a == lo,
            Friendship.user_id_b == hi,
            Friendship.status == "accepted",
        )
    ).first() is not None


def authorize_view(viewer: PressUser, target_user_id: int, session: Session) -> None:
    """Allow reading `target_user_id`'s data only if it's the viewer or a friend."""
    if target_user_id != viewer.id and not are_friends(session, viewer.id, target_user_id):
        raise HTTPException(status_code=403, detail="Not authorized to view this user's data")


def viewable_user_id(
    user_id: int | None = Query(default=None),
    user: PressUser = Depends(current_user),
    session: Session = Depends(get_session),
) -> int:
    """Resolve the target user for a read endpoint: the caller by default, or a
    friend if `?user_id=` is supplied and the friendship check passes."""
    target = user_id if user_id is not None else user.id
    authorize_view(user, target, session)
    return target
