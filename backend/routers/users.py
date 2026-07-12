import os
import uuid
import smtplib
from email.mime.text import MIMEText
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, select

from ..database import get_session
from ..deps import current_user, optional_user, authorize_view, auth_response
from ..models import PressUser, Invite, Friendship
from ..scoring import (
    get_user_points,
    recompute_user_scores,
    DEFAULT_FACTOR_POINTS,
    FACTOR_KEYS,
    MIN_FACTOR_POINTS,
    TOTAL_FACTOR_POINTS,
)

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
def list_users(
    user: PressUser = Depends(current_user),
    session: Session = Depends(get_session),
):
    return session.exec(select(PressUser)).all()


@router.get("/search")
def search_users(
    q: str = Query(""),
    user: PressUser = Depends(current_user),
    session: Session = Depends(get_session),
):
    exclude_user_id = user.id
    if not q.strip():
        return []
    pattern = f"%{q.strip()}%"
    users = session.exec(
        select(PressUser).where(
            PressUser.name.ilike(pattern),
            PressUser.id != exclude_user_id,
        ).limit(20)
    ).all()

    # Partition the requester's friendships into accepted vs pending
    friendships = session.exec(
        select(Friendship).where(
            (Friendship.user_id_a == exclude_user_id) | (Friendship.user_id_b == exclude_user_id)
        )
    ).all()
    friend_ids: set[int] = set()
    pending_out: set[int] = set()  # I requested them
    pending_in: set[int] = set()   # they requested me
    for f in friendships:
        other = f.user_id_b if f.user_id_a == exclude_user_id else f.user_id_a
        if f.status == "accepted":
            friend_ids.add(other)
        elif f.requested_by == exclude_user_id:
            pending_out.add(other)
        else:
            pending_in.add(other)

    return [
        {
            "id": u.id,
            "name": u.name,
            "avatar_url": u.avatar_url,
            "already_friends": u.id in friend_ids,
            "request_sent": u.id in pending_out,
            "request_received": u.id in pending_in,
        }
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
def get_invite_link(
    user_id: int,
    user: PressUser = Depends(current_user),
    session: Session = Depends(get_session),
):
    """Return (or create) a permanent, reusable invite link for this user."""
    if user_id != user.id:
        raise HTTPException(status_code=403, detail="Not authorized")
    try:
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
    except HTTPException:
        raise
    except Exception as e:
        print(f"[invite-link] ERROR for user {user_id}: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to generate invite link: {e}")


@router.post("/invite")
def send_invite(
    data: dict,
    user: PressUser = Depends(current_user),
    session: Session = Depends(get_session),
):
    """Legacy one-time invite (email flow). Kept for backwards compat."""
    from_user_id: int = user.id
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
def accept_invite(
    token: str,
    data: dict,
    current: PressUser | None = Depends(optional_user),
    session: Session = Depends(get_session),
):
    invite = session.exec(select(Invite).where(Invite.token == token)).first()
    if not invite:
        raise HTTPException(status_code=404, detail="Invite not found")
    if not invite.permanent and invite.accepted_at is not None:
        raise HTTPException(status_code=410, detail="Invite already used")

    # An already-signed-in user accepts as themselves — identity comes from their
    # token, never a client-supplied user_id (which could impersonate anyone).
    if current is not None:
        user = current
    else:
        name = (data.get("name") or "").strip()
        if not name:
            raise HTTPException(status_code=400, detail="name or user_id is required")
        if session.exec(select(PressUser).where(PressUser.name == name)).first():
            raise HTTPException(status_code=409, detail="Name already taken")
        user = PressUser(name=name)
        session.add(user)
        session.commit()
        session.refresh(user)

    # Don't add self as friend. Committed separately so a duplicate-friendship
    # race can't roll back the freshly created account.
    if user.id != invite.invited_by:
        a, b = min(invite.invited_by, user.id), max(invite.invited_by, user.id)
        existing = session.exec(select(Friendship).where(Friendship.user_id_a == a, Friendship.user_id_b == b)).first()
        if not existing:
            # Invite links are mutual consent — accepted immediately
            session.add(Friendship(user_id_a=a, user_id_b=b, status="accepted", requested_by=invite.invited_by))
        elif existing.status == "pending":
            existing.status = "accepted"
            session.add(existing)
            try:
                session.commit()
            except IntegrityError:
                session.rollback()  # already friends — fine

    # Only mark used for one-time invites
    if not invite.permanent:
        invite.accepted_at = datetime.utcnow()
        session.add(invite)
        session.commit()

    session.refresh(user)
    return auth_response(user)


@router.patch("/{user_id}")
def update_user(
    user_id: int,
    data: dict,
    current: PressUser = Depends(current_user),
    session: Session = Depends(get_session),
):
    if user_id != current.id:
        raise HTTPException(status_code=403, detail="Not authorized")
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
    if "bio" in data:
        bio = (data["bio"] or "").strip()
        if len(bio) > 240:
            raise HTTPException(status_code=400, detail="Bio must be 240 characters or fewer")
        user.bio = bio or None
    session.add(user)
    session.commit()
    session.refresh(user)
    return {"id": user.id, "name": user.name, "avatar_url": user.avatar_url, "bio": user.bio}


@router.get("/{user_id}/factor-weights")
def get_factor_weights(
    user_id: int,
    user: PressUser = Depends(current_user),
    session: Session = Depends(get_session),
):
    """The user's external-factor point allocation (60-point budget), plus the
    default allocation and the budget constraints so the UI can seed sliders."""
    if user_id != user.id:
        raise HTTPException(status_code=403, detail="Not authorized")
    return {
        "points": get_user_points(user),
        "default": DEFAULT_FACTOR_POINTS,
        "total": TOTAL_FACTOR_POINTS,
        "min": MIN_FACTOR_POINTS,
    }


@router.put("/{user_id}/factor-weights")
def set_factor_weights(
    user_id: int,
    data: dict,
    user: PressUser = Depends(current_user),
    session: Session = Depends(get_session),
):
    """Persist a new factor point allocation and re-score the user's rated albums.
    Enforces the budget: every factor ≥ MIN, and the four summing to TOTAL."""
    if user_id != user.id:
        raise HTTPException(status_code=403, detail="Not authorized")

    points: dict[str, int] = {}
    for key in FACTOR_KEYS:
        raw = data.get(key)
        if isinstance(raw, bool) or not isinstance(raw, (int, float)) or (isinstance(raw, float) and not raw.is_integer()):
            raise HTTPException(status_code=400, detail=f"{key} must be a whole number")
        value = int(raw)
        if value < MIN_FACTOR_POINTS:
            raise HTTPException(status_code=400, detail=f"{key} must be at least {MIN_FACTOR_POINTS}")
        points[key] = value

    if sum(points.values()) != TOTAL_FACTOR_POINTS:
        raise HTTPException(status_code=400, detail=f"Points must sum to {TOTAL_FACTOR_POINTS}")

    user.theme_pts = points["theme"]
    user.replay_pts = points["replay_value"]
    user.production_pts = points["production"]
    user.distinctness_pts = points["distinctness"]
    session.add(user)

    recomputed = recompute_user_scores(session, user)
    session.commit()

    return {"points": points, "recomputed": recomputed}


@router.get("/{user_id}/friends")
def list_friends(
    user_id: int,
    user: PressUser = Depends(current_user),
    session: Session = Depends(get_session),
):
    authorize_view(user, user_id, session)
    friendships = session.exec(
        select(Friendship).where(
            (Friendship.user_id_a == user_id) | (Friendship.user_id_b == user_id),
            Friendship.status == "accepted",
        )
    ).all()
    friend_ids = [
        (f.user_id_b if f.user_id_a == user_id else f.user_id_a)
        for f in friendships
    ]
    friends = [session.get(PressUser, fid) for fid in friend_ids]
    return [{"id": u.id, "name": u.name, "avatar_url": u.avatar_url, "bio": u.bio}
            for u in friends if u]


@router.post("/{user_id}/friends")
def add_friend(
    user_id: int,
    data: dict,
    user: PressUser = Depends(current_user),
    session: Session = Depends(get_session),
):
    """Send a friend request (or accept one, if the other user already asked)."""
    if user_id != user.id:
        raise HTTPException(status_code=403, detail="Not authorized")
    friend_id = data.get("friend_id")
    if not friend_id or friend_id == user_id:
        raise HTTPException(status_code=400, detail="Invalid friend_id")
    for uid in [user_id, friend_id]:
        if not session.get(PressUser, uid):
            raise HTTPException(status_code=404, detail="User not found")
    a, b = min(user_id, friend_id), max(user_id, friend_id)
    existing = session.exec(
        select(Friendship).where(Friendship.user_id_a == a, Friendship.user_id_b == b)
    ).first()
    if existing:
        if existing.status == "accepted":
            return {"ok": True, "status": "accepted", "already_friends": True}
        if existing.requested_by == user.id:
            return {"ok": True, "status": "pending", "already_friends": False}
        # They already requested us — requesting back is mutual consent
        existing.status = "accepted"
        session.add(existing)
        session.commit()
        return {"ok": True, "status": "accepted", "already_friends": True}
    session.add(Friendship(user_id_a=a, user_id_b=b, status="pending", requested_by=user.id))
    try:
        session.commit()
    except IntegrityError:
        # Concurrent request won the race — a row exists, which is fine
        session.rollback()
    return {"ok": True, "status": "pending", "already_friends": False}


@router.get("/{user_id}/friend-requests")
def list_friend_requests(
    user_id: int,
    user: PressUser = Depends(current_user),
    session: Session = Depends(get_session),
):
    if user_id != user.id:
        raise HTTPException(status_code=403, detail="Not authorized")
    pending = session.exec(
        select(Friendship).where(
            (Friendship.user_id_a == user_id) | (Friendship.user_id_b == user_id),
            Friendship.status == "pending",
        )
    ).all()
    incoming, outgoing = [], []
    for f in pending:
        other_id = f.user_id_b if f.user_id_a == user_id else f.user_id_a
        other = session.get(PressUser, other_id)
        if not other:
            continue
        info = {"id": other.id, "name": other.name, "avatar_url": other.avatar_url}
        (outgoing if f.requested_by == user_id else incoming).append(info)
    return {"incoming": incoming, "outgoing": outgoing}


@router.post("/{user_id}/friend-requests/{other_id}/accept")
def accept_friend_request(
    user_id: int,
    other_id: int,
    user: PressUser = Depends(current_user),
    session: Session = Depends(get_session),
):
    if user_id != user.id:
        raise HTTPException(status_code=403, detail="Not authorized")
    a, b = min(user_id, other_id), max(user_id, other_id)
    f = session.exec(
        select(Friendship).where(
            Friendship.user_id_a == a,
            Friendship.user_id_b == b,
            Friendship.status == "pending",
        )
    ).first()
    if not f:
        raise HTTPException(status_code=404, detail="No pending request")
    if f.requested_by == user.id:
        raise HTTPException(status_code=400, detail="Can't accept your own request")
    f.status = "accepted"
    session.add(f)
    session.commit()
    return {"ok": True}


@router.delete("/{user_id}/friend-requests/{other_id}")
def decline_friend_request(
    user_id: int,
    other_id: int,
    user: PressUser = Depends(current_user),
    session: Session = Depends(get_session),
):
    """Decline an incoming request, or cancel one you sent."""
    if user_id != user.id:
        raise HTTPException(status_code=403, detail="Not authorized")
    a, b = min(user_id, other_id), max(user_id, other_id)
    f = session.exec(
        select(Friendship).where(
            Friendship.user_id_a == a,
            Friendship.user_id_b == b,
            Friendship.status == "pending",
        )
    ).first()
    if not f:
        raise HTTPException(status_code=404, detail="No pending request")
    session.delete(f)
    session.commit()
    return {"ok": True}


@router.delete("/{user_id}/friends/{friend_id}")
def remove_friend(
    user_id: int,
    friend_id: int,
    user: PressUser = Depends(current_user),
    session: Session = Depends(get_session),
):
    if user_id != user.id:
        raise HTTPException(status_code=403, detail="Not authorized")
    a, b = min(user_id, friend_id), max(user_id, friend_id)
    friendship = session.exec(
        select(Friendship).where(Friendship.user_id_a == a, Friendship.user_id_b == b)
    ).first()
    if not friendship:
        raise HTTPException(status_code=404, detail="Friendship not found")
    session.delete(friendship)
    session.commit()
    return {"ok": True}
