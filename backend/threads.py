"""Thread creation and the review→post mirror (PLAN_discussions.md §3, §5.1).

Lives outside `routers/` because two routers need it: `discussions` creates a
thread when someone posts, and `albums` has to keep a written review in step
with its post. A router importing another router to share a helper is how that
turns into a cycle.

Why a review is a real Post row and not a synthetic one assembled at read time
-----------------------------------------------------------------------------
Reviews were the conversation before threads existed — on a record two people
have both reviewed, the discussion has already started, and a thread that opens
with "be the first" is simply wrong. They could be unioned in when a thread is
read, which would avoid any duplication, but then they would have no post id,
and a review is exactly the thing people want to reply to and like.

So `album.review` stays the canonical text and this mirrors it into the thread.
That is a sync point, and sync points rot — this one is affordable because a
review has one owner and exactly two write paths — `albums.save_review` and
its delete twin. `review` is deliberately absent from ALBUM_MUTABLE_FIELDS, so
the generic PATCH cannot reach it. Contrast `album.subject_key`, which is
written from five places and therefore uses a mapper event instead.
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import text as _sql
from sqlmodel import Session

from .models import Post, Thread

SPOILER_FLAGS_TO_BLUR = 3


def display_for(session: Session, subject_type: str, key: str) -> tuple[str, str | None, str | None]:
    """Title, subtitle and art for a thread, denormalised at creation (§3).

    Prefers a copy that actually has cover art — the row that happens to sort
    first is often a stub someone imported without one.
    """
    if subject_type == "album":
        row = session.execute(_sql(
            "SELECT album_name, artist, album_art_url FROM album WHERE subject_key = :k"
            " ORDER BY (album_art_url IS NULL), id LIMIT 1"), {"k": key}).first()
        return (row[0], row[1], row[2]) if row else (key.split("||")[-1], None, None)
    if subject_type == "artist":
        row = session.execute(_sql(
            "SELECT a.artist, m.image_url FROM album a"
            " LEFT JOIN artistmeta m ON m.artist = a.artist"
            " WHERE a.subject_key LIKE :p ORDER BY (m.image_url IS NULL), a.id LIMIT 1"),
            {"p": f"{key}||%"}).first()
        return (row[0], None, row[1]) if row else (key, None, None)
    row = session.execute(_sql(
        "SELECT s.title, a.album_name, a.album_art_url FROM song s"
        " JOIN album a ON a.id = s.album_id WHERE s.track_id = :t"
        " ORDER BY (a.album_art_url IS NULL), s.id LIMIT 1"), {"t": key}).first()
    return (row[0], row[1], row[2]) if row else (f"track {key}", None, None)


def get_or_create_thread(session: Session, subject_type: str, key: str) -> Thread:
    """Lazily, on first use. Most subjects are never discussed, and a row per
    album in the catalogue would turn "is anyone talking about this?" into a
    scan (§3)."""
    hit = session.execute(_sql(
        "SELECT id FROM thread WHERE subject_type = :s AND subject_key = :k"),
        {"s": subject_type, "k": key}).first()
    if hit:
        return session.get(Thread, hit[0])
    title, subtitle, art = display_for(session, subject_type, key)
    thread = Thread(subject_type=subject_type, subject_key=key,
                    title=title, subtitle=subtitle, art_url=art)
    session.add(thread)
    session.commit()
    session.refresh(thread)
    maybe_seed(session, thread)
    return thread


def maybe_seed(session: Session, thread: Thread) -> None:
    """Open a room with something true about the record, so nobody walks into
    an empty one.

    Skipped below three raters: "the room agrees" is not a sentence two people
    can support, and a seed that overclaims is worse than no seed.
    """
    if thread.subject_type != "album":
        return
    stats = session.execute(_sql("""
        SELECT COUNT(DISTINCT a.user_id), AVG(a.score), STDDEV_POP(a.score)
        FROM album a WHERE a.subject_key = :k AND a.status = 'rated' AND a.score IS NOT NULL
    """), {"k": thread.subject_key}).first()
    if not stats or (stats[0] or 0) < 3:
        return
    raters, mean, spread = stats[0], float(stats[1] or 0), float(stats[2] or 0)

    top = session.execute(_sql("""
        SELECT s.title, AVG(s.score) FROM song s JOIN album a ON a.id = s.album_id
        WHERE a.subject_key = :k AND s.score IS NOT NULL AND s.track_id IS NOT NULL
        GROUP BY s.track_id, s.title HAVING COUNT(*) > 1
        ORDER BY AVG(s.score) DESC LIMIT 1
    """), {"k": thread.subject_key}).first()

    # Two places for the album mean, one for the track: a final album score is
    # shown to two everywhere in the app, and a song score to one.
    bits = [f"{raters} people have rated this, averaging {mean:.2f}."]
    if top:
        bits.append(f"Most-loved track: {top[0]} ({float(top[1]):.1f}).")
    bits.append("Opinion is split." if spread >= 1.0 else "They mostly agree.")

    session.add(Post(thread_id=thread.id, user_id=None, kind="system", body=" ".join(bits)))
    session.commit()


def _recount(session: Session, thread_id: int) -> None:
    """Post count and last activity, recomputed rather than nudged.

    A review can appear, change and vanish, and each of those would need its own
    increment — counting is cheap here and cannot drift.
    """
    row = session.execute(_sql(
        "SELECT COUNT(*), MAX(created_at) FROM post"
        " WHERE thread_id = :t AND deleted_at IS NULL AND kind <> 'system'"),
        {"t": thread_id}).first()
    thread = session.get(Thread, thread_id)
    if thread:
        thread.post_count = row[0] or 0
        thread.last_post_at = row[1]
        session.add(thread)
        session.commit()


def sync_review_post(session: Session, album) -> None:
    """Mirror this album copy's review into the record's thread.

    Called after any write that could touch `album.review`. Idempotent, and
    quiet on failure — a thread is a consequence of a review, and losing the
    mirror must never cost someone the review itself.
    """
    try:
        key = album.subject_key
        if not key:
            return
        body = (album.review or "").strip()

        existing = session.execute(_sql("""
            SELECT p.id, p.thread_id FROM post p JOIN thread t ON t.id = p.thread_id
            WHERE t.subject_type = 'album' AND t.subject_key = :k
              AND p.user_id = :u AND p.kind = 'review'
            LIMIT 1"""), {"k": key, "u": album.user_id}).first()

        if not body:
            # Cleared. Soft-delete rather than remove, so any replies it drew
            # still have something to hang from.
            if existing:
                post = session.get(Post, existing[0])
                if post and not post.deleted_at:
                    post.deleted_at = datetime.utcnow()
                    session.add(post)
                    session.commit()
                    _recount(session, existing[1])
            return

        if existing:
            post = session.get(Post, existing[0])
            if post:
                if post.body != body:
                    post.body = body
                    post.edited_at = datetime.utcnow()
                # A review that was cleared and rewritten comes back rather
                # than leaving a tombstone where the text now is.
                post.deleted_at = None
                session.add(post)
                session.commit()
                _recount(session, existing[1])
            return

        thread = get_or_create_thread(session, "album", key)
        post = Post(thread_id=thread.id, user_id=album.user_id, kind="review", body=body)
        # Carry the review's own timestamp so it sorts where it was written,
        # not where it was mirrored — these are months old.
        if album.review_at:
            post.created_at = album.review_at
        session.add(post)
        session.commit()
        _recount(session, thread.id)
    except Exception as e:  # pragma: no cover
        session.rollback()
        print(f"[sync_review_post] album {getattr(album, 'id', '?')} failed: {e}")
