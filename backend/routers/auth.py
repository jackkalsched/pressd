import json
import os

import httpx
import jwt
from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select

from ..database import get_session
from ..models import PressUser

router = APIRouter(prefix="/auth", tags=["auth"])

APPLE_KEYS_URL = "https://appleid.apple.com/auth/keys"
APPLE_ISSUER = "https://appleid.apple.com"

_apple_jwks_cache: dict | None = None


def _get_apple_public_key(kid: str):
    global _apple_jwks_cache
    for attempt in range(2):
        if not _apple_jwks_cache or attempt == 1:
            resp = httpx.get(APPLE_KEYS_URL, timeout=10)
            _apple_jwks_cache = resp.json()
        key_data = next((k for k in _apple_jwks_cache["keys"] if k["kid"] == kid), None)
        if key_data:
            return jwt.algorithms.RSAAlgorithm.from_jwk(json.dumps(key_data))
    raise HTTPException(status_code=401, detail="Apple signing key not found")


def _verify_apple_token(id_token: str) -> dict:
    client_id = os.getenv("APPLE_CLIENT_ID")
    if not client_id:
        raise HTTPException(status_code=500, detail="APPLE_CLIENT_ID not configured on server")
    header = jwt.get_unverified_header(id_token)
    pub_key = _get_apple_public_key(header["kid"])
    return jwt.decode(
        id_token,
        pub_key,
        algorithms=["RS256"],
        audience=client_id,
        issuer=APPLE_ISSUER,
    )


@router.post("/apple")
def sign_in_with_apple(data: dict, session: Session = Depends(get_session)):
    id_token: str = data.get("id_token", "")
    display_name: str | None = (data.get("name") or "").strip() or None
    link_user_id: int | None = data.get("link_user_id")

    if not id_token:
        raise HTTPException(status_code=400, detail="id_token required")

    try:
        payload = _verify_apple_token(id_token)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=401, detail=f"Invalid Apple token: {e}")

    apple_sub: str = payload["sub"]
    apple_email: str | None = payload.get("email")

    def _user_response(u: PressUser) -> dict:
        return {"id": u.id, "name": u.name, "avatar_url": u.avatar_url}

    # 1. Existing account already linked to this Apple ID
    user = session.exec(select(PressUser).where(PressUser.apple_sub == apple_sub)).first()
    if user:
        return _user_response(user)

    # 2. Caller has an existing local account and wants to link it
    if link_user_id:
        user = session.get(PressUser, link_user_id)
        if user:
            user.apple_sub = apple_sub
            if apple_email and not user.email:
                user.email = apple_email
            session.add(user)
            session.commit()
            session.refresh(user)
            return _user_response(user)

    # 3. Match by email Apple provided
    if apple_email:
        user = session.exec(select(PressUser).where(PressUser.email == apple_email)).first()
        if user:
            user.apple_sub = apple_sub
            session.add(user)
            session.commit()
            session.refresh(user)
            return _user_response(user)

    # 4. Create new account
    name = display_name or (apple_email.split("@")[0] if apple_email else "User")
    base, suffix = name, 1
    while session.exec(select(PressUser).where(PressUser.name == name)).first():
        name = f"{base}{suffix}"
        suffix += 1

    user = PressUser(name=name, apple_sub=apple_sub, email=apple_email)
    session.add(user)
    session.commit()
    session.refresh(user)
    return _user_response(user)
