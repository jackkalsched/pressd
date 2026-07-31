import os

import httpx
import jwt
from jwt import PyJWKClient
from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select

from ..database import get_session
from ..deps import auth_response, current_user, optional_user
from ..models import PressUser

router = APIRouter(prefix="/auth", tags=["auth"])

GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v3/userinfo"

# Sign in with Apple — native iOS tokens carry aud = the app's bundle id.
APPLE_KEYS_URL = "https://appleid.apple.com/auth/keys"
APPLE_ISSUER = "https://appleid.apple.com"
APPLE_AUDIENCE = os.getenv("APPLE_BUNDLE_ID", "com.pressd.app")
_apple_jwks = PyJWKClient(APPLE_KEYS_URL)


def _link_provider(
    session: Session,
    caller: PressUser | None,
    field: str,
    sub: str,
    email: str | None,
) -> dict:
    """Attach a provider identity to the *authenticated* caller.

    Only ever reached when the client asked to link. The caller is taken from
    the bearer token rather than the request body — a client-supplied user id
    here would let anyone attach their own Google/Apple identity to someone
    else's account and log in as them.
    """
    if caller is None:
        raise HTTPException(status_code=401, detail="Sign in before linking an account")

    owner = session.exec(select(PressUser).where(getattr(PressUser, field) == sub)).first()
    if owner and owner.id != caller.id:
        raise HTTPException(
            status_code=409,
            detail="That account is already linked to a different Press'd user",
        )

    setattr(caller, field, sub)
    if email and not caller.email:
        caller.email = email
    session.add(caller)
    session.commit()
    session.refresh(caller)
    return auth_response(caller)


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
def sign_in_with_google(
    data: dict,
    session: Session = Depends(get_session),
    caller: PressUser | None = Depends(optional_user),
):
    access_token: str = data.get("access_token", "")
    link: bool = bool(data.get("link"))

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
    # Auto-matching on an unverified address would let anyone who can set that
    # address on a throwaway Google account take over the Press'd account.
    google_email_verified: bool = bool(payload.get("email_verified"))

    # 1. Linking to the signed-in account, at the user's explicit request
    if link:
        return _link_provider(session, caller, "google_sub", google_sub, google_email)

    # 2. Existing account already linked to this Google ID
    user = session.exec(select(PressUser).where(PressUser.google_sub == google_sub)).first()
    if user:
        return auth_response(user)

    # 3. Match by email Google provided
    if google_email and google_email_verified:
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
def sign_in_with_apple(
    data: dict,
    session: Session = Depends(get_session),
    caller: PressUser | None = Depends(optional_user),
):
    """Verify an Apple identity token (native Sign in with Apple) and log the
    user in, mirroring the Google flow. `full_name` is only sent by the client
    on the very first sign-in, so we use it when creating the account."""
    identity_token: str = data.get("identity_token", "")
    full_name: str | None = data.get("full_name")
    link: bool = bool(data.get("link"))

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
    # Apple sends this as the string "true"/"false" rather than a JSON bool.
    apple_email_verified: bool = str(payload.get("email_verified", "")).lower() == "true"
    # A "Hide My Email" relay address is unique per app, so it can never match
    # an address the user gave any other way — matching on it only risks noise.
    is_relay = str(payload.get("is_private_email", "")).lower() == "true"

    # 1. Linking to the signed-in account, at the user's explicit request
    if link:
        return _link_provider(session, caller, "apple_sub", apple_sub, apple_email)

    # 2. Existing account linked to this Apple ID
    user = session.exec(select(PressUser).where(PressUser.apple_sub == apple_sub)).first()
    if user:
        return auth_response(user)

    # 3. Match by email Apple provided
    if apple_email and apple_email_verified and not is_relay:
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


PROVIDER_FIELDS = {"google": "google_sub", "apple": "apple_sub"}


@router.get("/providers")
def linked_providers(user: PressUser = Depends(current_user)):
    """Which sign-in methods reach this account, for the Settings screen."""
    return {
        "google": user.google_sub is not None,
        "apple": user.apple_sub is not None,
        "email": user.email,
    }


@router.delete("/providers/{provider}")
def unlink_provider(provider: str, session: Session = Depends(get_session),
                    user: PressUser = Depends(current_user)):
    field = PROVIDER_FIELDS.get(provider)
    if field is None:
        raise HTTPException(status_code=400, detail="Unknown provider")

    if getattr(user, field) is None:
        raise HTTPException(status_code=400, detail=f"No {provider} account is linked")

    # Removing the last provider would lock the account out permanently — there
    # is no password to fall back on.
    remaining = [f for f in PROVIDER_FIELDS.values() if f != field and getattr(user, f) is not None]
    if not remaining:
        raise HTTPException(
            status_code=400,
            detail="Link another sign-in method before removing this one",
        )

    setattr(user, field, None)
    session.add(user)
    session.commit()
    return {"google": user.google_sub is not None, "apple": user.apple_sub is not None}
