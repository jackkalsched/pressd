"""A copy's tracklist settles once it has songs and its record is out.

Jack's rule (November 2026): a tracklist is adjusted after the first
post-release pull never again. Before release a copy may hold a partial list —
the singles so far — and be topped up as more are announced; on or after
release day it gets one pull (backend/tracklist_fill.py), and from then on
nothing changes it: not the daily worker, not another copy, not the app.

Copies are made in many places — an import, a bin's add, a clone for a
recommendation or a copy from the community page — so the stamp is kept here,
on the session, rather than at each writer: whenever songs are inserted into a
copy whose record is out (`release_date` null or today or earlier) and that
isn't settled yet, it is stamped in the same flush. A songless copy stays
unsettled until it gets songs; a copy whose release is ahead stays unsettled
however many songs it gets.

The merge itself opts out (`MERGING` in `session.info`) and stamps on its own
terms, because its pull is several steps — another copy's songs, then the
catalog's — and the first of them must not settle the copy before the rest.
"""
from sqlalchemy import bindparam, event, text
from sqlalchemy.orm import Session

MERGING = "tracklist_merge"

_SETTLE = text(
    "UPDATE album SET tracklist_settled_at = CURRENT_TIMESTAMP"
    " WHERE id IN :ids AND tracklist_settled_at IS NULL"
    " AND (release_date IS NULL OR release_date <= CURRENT_DATE)"
).bindparams(bindparam("ids", expanding=True))


@event.listens_for(Session, "after_flush")
def _settle_on_songs(session, flush_context) -> None:
    if session.info.get(MERGING):
        return
    from .models import Album, Song

    ids = {obj.album_id for obj in session.new if isinstance(obj, Song) and obj.album_id is not None}
    if not ids:
        return
    session.connection().execute(_SETTLE, {"ids": sorted(ids)})
    # Copies already loaded here would otherwise keep reading null.
    for obj in list(session.identity_map.values()):
        if isinstance(obj, Album) and obj.id in ids:
            session.expire(obj, ["tracklist_settled_at"])
