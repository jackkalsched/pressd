import os

import httpx
from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select

from ..database import get_session
from ..models import PressUser

router = APIRouter(prefix="/auth", tags=["auth"])

GOOGLE_TOKENINFO_URL = "https://oauth2.googleapis.com/tokeninfo"


def _verify_google_token(id_token: str) -> dict:
    client_id = os.getenv("GOOGLE_CLIENT_ID")
    if not client_id:
        raise HTTPException(status_code=500, detail="GOOGLE_CLIENT_ID not configured on server")
    resp = httpx.get(GOOGLE_TOKENINFO_URL, params={"id_token": id_token}, timeout=10)
    if resp.status_code != 200:
        raise HTTPException(status_code=401, detail="Invalid Google token")
    payload = resp.json()
    if payload.get("aud") != client_id:
        raise HTTPException(status_code=401, detail="Token was not issued for this app")
    return payload


@router.post("/google")
def sign_in_with_google(data: dict, session: Session = Depends(get_session)):
    id_token: str = data.get("id_token", "")
    link_user_id: int | None = data.get("link_user_id")

    if not id_token:
        raise HTTPException(status_code=400, detail="id_token required")

    try:
        payload = _verify_google_token(id_token)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=401, detail=f"Google token error: {e}")

    google_sub: str = payload["sub"]
    google_email: str | None = payload.get("email")
    google_name: str | None = payload.get("name")

    def _user_response(u: PressUser) -> dict:
        return {"id": u.id, "name": u.name, "avatar_url": u.avatar_url}

    # 1. Existing account already linked to this Google ID
    user = session.exec(select(PressUser).where(PressUser.google_sub == google_sub)).first()
    if user:
        return _user_response(user)

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
            return _user_response(user)

    # 3. Match by email Google provided
    if google_email:
        user = session.exec(select(PressUser).where(PressUser.email == google_email)).first()
        if user:
            user.google_sub = google_sub
            session.add(user)
            session.commit()
            session.refresh(user)
            return _user_response(user)

    # 4. Create new account
    name = google_name or (google_email.split("@")[0] if google_email else "User")
    base, suffix = name, 1
    while session.exec(select(PressUser).where(PressUser.name == name)).first():
        name = f"{base}{suffix}"
        suffix += 1

    user = PressUser(name=name, google_sub=google_sub, email=google_email)
    session.add(user)
    session.commit()
    session.refresh(user)
    return _user_response(user)
