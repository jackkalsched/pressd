"""One set of genre tags per record, across every copy of it.

An album row is one person's copy (models.Album), but a record's genre and
subgenres are facts about the record, not about whoever added it — so every
copy of a record (`subject_key`, any edition) carries the same four values,
and when they change on one copy they change on all of them (Jack, November
2026). Until then each copy was tagged on its own: the catalog's genre at
import, then Claude's subgenres in a background thread, so two people's copies
of one album could read "Pop" and "R&B" with different subgenres under each.

Enforced here, on the session, rather than at each writer — the import, the
tagger, recommendations, copying from the community view, the audio
aggregates, the maintenance backfills and PATCH /albums/{id} all write these
columns, and a rule kept at each of them holds only until the next one is
added (the reason `Album.subject_key` is kept by a mapper event too):

* A **new copy** takes the tags the record already has on Pressd, whatever the
  catalog said; a record nobody holds yet keeps the catalog's, and they become
  the record's.
* A copy whose tags **change** passes them to every other copy, in the same
  flush.
* A copy **renamed** onto another record (artist or title edited) takes that
  record's tags.

`backend/normalize_genres.py` renames a value across every row at once, so it
can't split a record and needs nothing from here.
"""
from sqlalchemy import event, inspect, text
from sqlalchemy.orm import Session

from .trackkeys import subject_key_album

GENRE_FIELDS = ("genre", "sub_genre1", "sub_genre2", "sub_genre3")
_PENDING = "genre_sync_pending"


def _key(album) -> str:
    return subject_key_album(album.artist or "", album.album_name or "")


def record_tags(conn, key: str, exclude_id: int | None = None) -> tuple | None:
    """The record's tags, from any copy that has some — every copy agrees once
    this module has had its say, so any one will do; the most complete wins
    should two disagree (a copy written before it existed)."""
    row = conn.execute(
        text(
            "SELECT genre, sub_genre1, sub_genre2, sub_genre3 FROM album"
            " WHERE subject_key = :k AND (CAST(:x AS INTEGER) IS NULL OR id <> :x)"
            " AND (genre IS NOT NULL OR sub_genre1 IS NOT NULL)"
            " ORDER BY (genre IS NOT NULL)::int + (sub_genre1 IS NOT NULL)::int"
            " + (sub_genre2 IS NOT NULL)::int + (sub_genre3 IS NOT NULL)::int DESC, id"
            " LIMIT 1"
        ),
        {"k": key, "x": exclude_id},
    ).first()
    return tuple(row) if row else None


def _adopt(album, tags: tuple) -> None:
    for field, value in zip(GENRE_FIELDS, tags):
        setattr(album, field, value)


def _changed(state, fields) -> bool:
    return any(state.attrs[f].history.has_changes() for f in fields)


@event.listens_for(Session, "before_flush")
def _before_flush(session, flush_context, instances) -> None:
    from .models import Album

    pending = session.info.setdefault(_PENDING, [])
    for obj in list(session.new):
        if not isinstance(obj, Album):
            continue
        tags = record_tags(session.connection(), _key(obj))
        if tags:
            _adopt(obj, tags)
        elif any(getattr(obj, f) for f in GENRE_FIELDS):
            pending.append(obj)  # the first copy's tags become the record's
    for obj in list(session.dirty):
        if not isinstance(obj, Album):
            continue
        state = inspect(obj)
        if _changed(state, GENRE_FIELDS):
            pending.append(obj)
        elif _changed(state, ("artist", "album_name")):
            tags = record_tags(session.connection(), _key(obj), exclude_id=obj.id)
            if tags:
                _adopt(obj, tags)


@event.listens_for(Session, "after_flush")
def _after_flush(session, flush_context) -> None:
    from .models import Album

    pending = session.info.pop(_PENDING, [])
    seen = set()
    for obj in pending:
        key = _key(obj)
        if obj.id is None or key in seen:
            continue
        seen.add(key)
        session.connection().execute(
            text(
                "UPDATE album SET genre = :g, sub_genre1 = :s1, sub_genre2 = :s2, sub_genre3 = :s3"
                " WHERE subject_key = :k AND id <> :id"
            ),
            {"g": obj.genre, "s1": obj.sub_genre1, "s2": obj.sub_genre2, "s3": obj.sub_genre3,
             "k": key, "id": obj.id},
        )
        # Copies already loaded in this session would otherwise keep reading
        # their old tags until they were refreshed.
        for other in list(session.identity_map.values()):
            if isinstance(other, Album) and other.id != obj.id and other.subject_key == key:
                session.expire(other, list(GENRE_FIELDS))
