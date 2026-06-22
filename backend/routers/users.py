import os
import uuid
import smtplib
from email.mime.text import MIMEText
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlmodel import Session, select

from ..database import get_session
from ..models import PressUser, Invite, Friendship

router = APIRouter(prefix="/users", tags=["users"])

APP_URL = os.getenv("APP_URL", "http://localhost:5173")
SMTP_HOST = os.getenv("SMTP_HOST", "smtp.gmail.com")
SMTP_PORT = int(os.getenv("SMTP_PORT", "587"))
SMTP_USER = os.getenv("SMTP_USER", "")
SMTP_PASS = os.getenv("SMTP_PASS", "")


def _send_invite_email(to_email: str, inviter_name: str, token: str):
    if not SMTP_USER or not SMTP_PASS:
        print(f"[invite] SMTP not configured — invite link: {APP_URL}/join?token={token}")
        return
    link = f"{APP_URL}/join?token={token}"
    body = (
        f"{inviter_name} has invited you to join Press'd, a personal music rating app.\n\n"
        f"Click the link below to create your account:\n{link}\n\n"
        f"This invite is single-use."
    )
    msg = MIMEText(body)
    msg["Subject"] = f"{inviter_name} invited you to Press'd"
    msg["From"] = SMTP_USER
    msg["To"] = to_email
    try:
        with smtplib.SMTP(SMTP_HOST, SMTP_PORT) as s:
            s.starttls()
            s.login(SMTP_USER, SMTP_PASS)
            s.send_message(msg)
    except Exception as e:
        print(f"[invite] email failed: {e} — link: {link}")


@router.get("/")
def list_users(session: Session = Depends(get_session)):
    return session.exec(select(PressUser)).all()


@router.get("/search")
def search_users(q: str = Query(""), exclude_user_id: int = Query(0), session: Session = Depends(get_session)):
    if not q.strip():
        return []
    pattern = f"%{q.strip()}%"
    users = session.exec(
        select(PressUser).where(
            PressUser.name.ilike(pattern),
            PressUser.id != exclude_user_id,
        ).limit(20)
    ).all()

    # Get existing friend IDs for the requester
    friendships = session.exec(
        select(Friendship).where(
            (Friendship.user_id_a == exclude_user_id) | (Friendship.user_id_b == exclude_user_id)
        )
    ).all()
    friend_ids = {
        f.user_id_b if f.user_id_a == exclude_user_id else f.user_id_a
        for f in friendships
    }

    return [
        {"id": u.id, "name": u.name, "avatar_url": u.avatar_url, "already_friends": u.id in friend_ids}
        for u in users
    ]


@router.post("/")
def create_user(data: dict, session: Session = Depends(get_session)):
    name = (data.get("name") or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="name is required")
    existing = session.exec(select(PressUser).where(PressUser.name == name)).first()
    if existing:
        raise HTTPException(status_code=409, detail="Name already taken")
    user = PressUser(name=name)
    session.add(user)
    session.commit()
    session.refresh(user)
    return user


@router.get("/{user_id}/invite-link")
def get_invite_link(user_id: int, session: Session = Depends(get_session)):
    """Return (or create) a permanent, reusable invite link for this user."""
    inviter = session.get(PressUser, user_id)
    if not inviter:
        raise HTTPException(status_code=404, detail="User not found")
    invite = session.exec(
        select(Invite).where(Invite.invited_by == user_id, Invite.permanent == True)
    ).first()
    if not invite:
        invite = Invite(invited_by=user_id, token=str(uuid.uuid4()), permanent=True)
        session.add(invite)
        session.commit()
        session.refresh(invite)
    return {"link": f"{APP_URL}/join?token={invite.token}", "inviter_name": inviter.name}


@router.post("/invite")
def send_invite(data: dict, session: Session = Depends(get_session)):
    """Legacy one-time invite (email flow). Kept for backwards compat."""
    from_user_id: int = data.get("from_user_id", 1)
    email: str = (data.get("email") or "").strip()

    inviter = session.get(PressUser, from_user_id)
    if not inviter:
        raise HTTPException(status_code=404, detail="Inviting user not found")

    token = str(uuid.uuid4())
    invite = Invite(invited_by=from_user_id, email=email, token=token)
    session.add(invite)
    session.commit()

    if email:
        _send_invite_email(email, inviter.name, token)
    return {"ok": True, "link": f"{APP_URL}/join?token={token}"}


@router.get("/invite/{token}")
def get_invite(token: str, session: Session = Depends(get_session)):
    invite = session.exec(select(Invite).where(Invite.token == token)).first()
    if not invite:
        raise HTTPException(status_code=404, detail="Invite not found")
    if not invite.permanent and invite.accepted_at is not None:
        raise HTTPException(status_code=410, detail="Invite already used")
    inviter = session.get(PressUser, invite.invited_by)
    return {"inviter_name": inviter.name if inviter else "Someone", "email": invite.email}


@router.post("/invite/{token}/accept")
def accept_invite(token: str, data: dict, session: Session = Depends(get_session)):
    invite = session.exec(select(Invite).where(Invite.token == token)).first()
    if not invite:
        raise HTTPException(status_code=404, detail="Invite not found")
    if not invite.permanent and invite.accepted_at is not None:
        raise HTTPException(status_code=410, detail="Invite already used")

    user_id = data.get("user_id")
    if user_id:
        user = session.get(PressUser, int(user_id))
        if not user:
            raise HTTPException(status_code=404, detail="User not found")
    else:
        name = (data.get("name") or "").strip()
        if not name:
            raise HTTPException(status_code=400, detail="name or user_id is required")
        if session.exec(select(PressUser).where(PressUser.name == name)).first():
            raise HTTPException(status_code=409, detail="Name already taken")
        user = PressUser(name=name)
        session.add(user)
        session.flush()

    # Don't add self as friend
    if user.id != invite.invited_by:
        a, b = min(invite.invited_by, user.id), max(invite.invited_by, user.id)
        if not session.exec(select(Friendship).where(Friendship.user_id_a == a, Friendship.user_id_b == b)).first():
            session.add(Friendship(user_id_a=a, user_id_b=b))

    # Only mark used for one-time invites
    if not invite.permanent:
        invite.accepted_at = datetime.utcnow()
        session.add(invite)

    session.commit()
    session.refresh(user)
    return {"id": user.id, "name": user.name, "avatar_url": user.avatar_url}


@router.patch("/{user_id}")
def update_user(user_id: int, data: dict, session: Session = Depends(get_session)):
    user = session.get(PressUser, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if "name" in data:
        name = (data["name"] or "").strip()
        if not name:
            raise HTTPException(status_code=400, detail="name cannot be empty")
        existing = session.exec(select(PressUser).where(PressUser.name == name, PressUser.id != user_id)).first()
        if existing:
            raise HTTPException(status_code=409, detail="Name already taken")
        user.name = name
    if "avatar_url" in data:
        user.avatar_url = (data["avatar_url"] or "").strip() or None
    session.add(user)
    session.commit()
    session.refresh(user)
    return {"id": user.id, "name": user.name, "avatar_url": user.avatar_url}


@router.get("/{user_id}/friends")
def list_friends(user_id: int, session: Session = Depends(get_session)):
    friendships = session.exec(
        select(Friendship).where(
            (Friendship.user_id_a == user_id) | (Friendship.user_id_b == user_id)
        )
    ).all()
    friend_ids = [
        (f.user_id_b if f.user_id_a == user_id else f.user_id_a)
        for f in friendships
    ]
    friends = [session.get(PressUser, fid) for fid in friend_ids]
    return [{"id": u.id, "name": u.name, "avatar_url": u.avatar_url} for u in friends if u]


@router.post("/{user_id}/friends")
def add_friend(user_id: int, data: dict, session: Session = Depends(get_session)):
    friend_id = data.get("friend_id")
    if not friend_id or friend_id == user_id:
        raise HTTPException(status_code=400, detail="Invalid friend_id")
    for uid in [user_id, friend_id]:
        if not session.get(PressUser, uid):
            raise HTTPException(status_code=404, detail="User not found")
    a, b = min(user_id, friend_id), max(user_id, friend_id)
    if session.exec(select(Friendship).where(Friendship.user_id_a == a, Friendship.user_id_b == b)).first():
        return {"ok": True, "already_friends": True}
    session.add(Friendship(user_id_a=a, user_id_b=b))
    session.commit()
    return {"ok": True, "already_friends": False}


@router.delete("/{user_id}/friends/{friend_id}")
def remove_friend(user_id: int, friend_id: int, session: Session = Depends(get_session)):
    a, b = min(user_id, friend_id), max(user_id, friend_id)
    friendship = session.exec(
        select(Friendship).where(Friendship.user_id_a == a, Friendship.user_id_b == b)
    ).first()
    if not friendship:
        raise HTTPException(status_code=404, detail="Friendship not found")
    session.delete(friendship)
    session.commit()
    return {"ok": True}
