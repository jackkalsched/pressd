import os

import httpx
import jwt
from jwt import PyJWKClient
from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select

from ..database import get_session
from ..deps import auth_response
from ..models import PressUser

router = APIRouter(prefix="/auth", tags=["auth"])

GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v3/userinfo"

# Sign in with Apple — native iOS tokens carry aud = the app's bundle id.
APPLE_KEYS_URL = "https://appleid.apple.com/auth/keys"
APPLE_ISSUER = "https://appleid.apple.com"
APPLE_AUDIENCE = os.getenv("APPLE_BUNDLE_ID", "com.pressd.app")
_apple_jwks = PyJWKClient(APPLE_KEYS_URL)


def _unique_name(session: Session, base: str) -> str:
    name, suffix = base, 1
    while session.exec(select(PressUser).where(PressUser.name == name)).first():
        name = f"{base}{suffix}"
        suffix += 1
    return name


def _get_google_userinfo(access_token: str) -> dict:
    resp = httpx.get(
        GOOGLE_USERINFO_URL,
        headers={"Authorization": f"Bearer {access_token}"},
        timeout=10,
    )
    if resp.status_code != 200:
        raise HTTPException(status_code=401, detail="Invalid Google access token")
    return resp.json()


@router.post("/google")
def sign_in_with_google(data: dict, session: Session = Depends(get_session)):
    access_token: str = data.get("access_token", "")
    link_user_id: int | None = data.get("link_user_id")

    if not access_token:
        raise HTTPException(status_code=400, detail="access_token required")

    try:
        payload = _get_google_userinfo(access_token)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=401, detail=f"Google token error: {e}")

    google_sub: str = payload["sub"]
    google_email: str | None = payload.get("email")
    google_name: str | None = payload.get("name")

    # 1. Existing account already linked to this Google ID
    user = session.exec(select(PressUser).where(PressUser.google_sub == google_sub)).first()
    if user:
        return auth_response(user)

    # 2. Caller wants to link their existing local account
    if link_user_id:
        user = session.get(PressUser, link_user_id)
        if user:
            user.google_sub = google_sub
            if google_email and not user.email:
                user.email = google_email
            session.add(user)
            session.commit()
            session.refresh(user)
            return auth_response(user)

    # 3. Match by email Google provided
    if google_email:
        user = session.exec(select(PressUser).where(PressUser.email == google_email)).first()
        if user:
            user.google_sub = google_sub
            session.add(user)
            session.commit()
            session.refresh(user)
            return auth_response(user)

    # 4. Create new account
    name = _unique_name(session, google_name or (google_email.split("@")[0] if google_email else "User"))
    user = PressUser(name=name, google_sub=google_sub, email=google_email)
    session.add(user)
    session.commit()
    session.refresh(user)
    return auth_response(user)


@router.post("/apple")
def sign_in_with_apple(data: dict, session: Session = Depends(get_session)):
    """Verify an Apple identity token (native Sign in with Apple) and log the
    user in, mirroring the Google flow. `full_name` is only sent by the client
    on the very first sign-in, so we use it when creating the account."""
    identity_token: str = data.get("identity_token", "")
    full_name: str | None = data.get("full_name")
    link_user_id: int | None = data.get("link_user_id")

    if not identity_token:
        raise HTTPException(status_code=400, detail="identity_token required")

    try:
        signing_key = _apple_jwks.get_signing_key_from_jwt(identity_token)
        payload = jwt.decode(
            identity_token,
            signing_key.key,
            algorithms=["RS256"],
            audience=APPLE_AUDIENCE,
            issuer=APPLE_ISSUER,
        )
    except Exception as e:
        raise HTTPException(status_code=401, detail=f"Invalid Apple token: {e}")

    apple_sub: str = payload["sub"]
    apple_email: str | None = payload.get("email")

    # 1. Existing account linked to this Apple ID
    user = session.exec(select(PressUser).where(PressUser.apple_sub == apple_sub)).first()
    if user:
        return auth_response(user)

    # 2. Caller wants to link their existing local account
    if link_user_id:
        user = session.get(PressUser, link_user_id)
        if user:
            user.apple_sub = apple_sub
            if apple_email and not user.email:
                user.email = apple_email
            session.add(user)
            session.commit()
            session.refresh(user)
            return auth_response(user)

    # 3. Match by email Apple provided
    if apple_email:
        user = session.exec(select(PressUser).where(PressUser.email == apple_email)).first()
        if user:
            user.apple_sub = apple_sub
            session.add(user)
            session.commit()
            session.refresh(user)
            return auth_response(user)

    # 4. Create new account
    base = full_name or (apple_email.split("@")[0] if apple_email else "User")
    user = PressUser(name=_unique_name(session, base), apple_sub=apple_sub, email=apple_email)
    session.add(user)
    session.commit()
    session.refresh(user)
    return auth_response(user)
