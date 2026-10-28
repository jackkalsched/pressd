"""
Linking songs to the global Track store — one implementation for the import
path (`albums._link_tracks`, one album at a time) and the nightly backstop
(`worker.migrate_tracks.build_tracks`, every unlinked song at once).

Until October 2026 each of those built its own key inline, and the one-off
artist-credit backfill a third, so a fix to one drifted from the others. The key itself is `trackkeys.recording_key`; this module adds the two
rules that need more than one song's title to decide:

Two songs on one album copy are never one recording. A copy that holds
"Karma" and "Karma (feat. Ice Spice)", or Coloring Book's two "Blessings",
has two recordings by definition, whatever their titles reduce to — and the
ingest downloads per copy, so a shared id meant one analysis overwritten by
the other. When songs on a copy meet on a key, the plainest title keeps it (then the
first by track number) and the n-th gets `||alt<n>`, a position rather than
anything random, so the same alternate on another user's copy of the record
lands on the same id.

Same key, different length. Duration is a tiebreak only — 59% of songs carry
none — so a song joins an existing track of its key (or a `||d<sec>` sibling)
whose duration is within DUR_TOL_MS, the closest first. Same-recording copies
differ by up to ~6s across catalogs. Only when every sibling is further off
does it get a `||d<sec>` key of its own. The old rule compared against the
base key alone and required the exact second for the suffix, so a third copy
a second away from the second forked again.

No FastAPI imports: the worker and one-off scripts import this.
"""
import re
from dataclasses import dataclass
from datetime import datetime

from sqlalchemy import text

from .credits import extras_of
from .trackkeys import key_parts, recording_key

# Duration disagreement beyond this means "different recording, same name".
DUR_TOL_MS = 10_000

_DUR_SUFFIX = re.compile(r"\|\|d\d+$")
_DECORATED = re.compile(r"[(\[]|\s[-\u2013\u2014]\s")


@dataclass
class SongRow:
    id: int
    title: str | None
    artist: str | None
    track_number: int | None
    duration_ms: int | None
    track_id: int | None = None


@dataclass
class Candidate:
    track_key: str
    id: int
    duration_ms: int | None


def copy_keys(songs: list[SongRow], album_artist: str | None,
              extra_artists: str | None, album_name: str | None) -> dict[int, str]:
    """Recording key for every song on ONE album copy, disambiguated so no two
    songs on it share one. Pass every song on the copy, linked or not — the
    `||alt<n>` positions are counted over the whole tracklist."""
    artists = [album_artist or "", *extras_of(extra_artists)]
    keys = {s.id: recording_key(s.title or "", s.artist, artists, album_name or "")
            for s in songs}
    by_key: dict[str, list[SongRow]] = {}
    for s in songs:
        by_key.setdefault(keys[s.id], []).append(s)
    for key, group in by_key.items():
        if len(group) < 2:
            continue
        # The plainly titled one keeps the key: "lost souls" before "lost
        # souls (with Brent Faiyaz)" whichever a catalog numbers first, so
        # copies from different catalogs agree on which is the alternate.
        group.sort(key=lambda s: (bool(_DECORATED.search(s.title or "")),
                                  s.track_number is None, s.track_number or 0, s.id))
        for n, s in enumerate(group[1:], start=2):
            keys[s.id] = f"{key}||alt{n}"
    return keys


def base_of(track_key: str) -> str:
    """A stored key without its duration suffix — what `resolve` groups on."""
    return _DUR_SUFFIX.sub("", track_key)


def resolve(key: str, duration_ms: int | None,
            candidates: list[Candidate]) -> tuple[int | None, str]:
    """(existing track id or None, key to create) for one song.

    `candidates` are the tracks whose key is `key` or `key||d<sec>`."""
    exact = next((c for c in candidates if c.track_key == key), None)
    if duration_ms:
        close = [c for c in candidates
                 if c.duration_ms and abs(c.duration_ms - duration_ms) <= DUR_TOL_MS]
        if close:
            best = min(close, key=lambda c: (abs(c.duration_ms - duration_ms),
                                             c.track_key != key, c.id))
            return best.id, best.track_key
        if exact and not exact.duration_ms:
            return exact.id, exact.track_key
        if exact:
            return None, f"{key}||d{duration_ms // 1000}"
        return None, key
    if exact:
        return exact.id, exact.track_key
    if candidates:
        first = min(candidates, key=lambda c: c.id)
        return first.id, first.track_key
    return None, key


def link_album(db, album_id: int) -> int:
    """Link one album copy's unlinked songs. `db` is a Session or Connection;
    the caller commits. Returns the number of songs linked."""
    album = db.execute(text(
        "SELECT artist, extra_artists, album_name FROM album WHERE id = :id"),
        {"id": album_id}).first()
    if album is None:
        return 0
    songs = [SongRow(*r) for r in db.execute(text(
        "SELECT id, title, artist, track_number, duration_ms, track_id"
        " FROM song WHERE album_id = :id"), {"id": album_id}).all()]
    keys = copy_keys(songs, album.artist, album.extra_artists, album.album_name)
    taken = {s.track_id for s in songs if s.track_id is not None}

    linked = 0
    for s in songs:
        if s.track_id is not None:
            continue
        key = keys[s.id]
        like = key.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        cands = [Candidate(*r) for r in db.execute(text(
            "SELECT track_key, id, duration_ms FROM track"
            " WHERE track_key = :k OR track_key LIKE :p ESCAPE '\\'"),
            {"k": key, "p": like + "||d%"}).all()]
        cands = [c for c in cands if base_of(c.track_key) == key]
        tid, new_key = resolve(key, s.duration_ms, cands)
        if tid in taken:
            # Only reachable for a copy linked under an older rule; a
            # per-song key keeps the copy's recordings apart.
            tid, new_key = None, f"{key}||s{s.id}"
        if tid is None:
            a_norm, t_norm = key_parts(new_key)
            tid = db.execute(text(
                "INSERT INTO track (track_key, artist_norm, title_norm, duration_ms, created_at)"
                " VALUES (:k, :a, :t, :d, NOW()) ON CONFLICT (track_key) DO UPDATE"
                " SET track_key = EXCLUDED.track_key RETURNING id"),
                {"k": new_key, "a": a_norm, "t": t_norm, "d": s.duration_ms}).scalar()
        db.execute(text("UPDATE song SET track_id = :tid WHERE id = :sid"),
                   {"tid": tid, "sid": s.id})
        taken.add(tid)
        linked += 1
    return linked


def link_unlinked(con) -> dict[int, int]:
    """Link every unlinked song in the database; return {song_id: track_id}.
    `con` is an engine Connection whose driver connection is psycopg2; this
    commits. Bulk execute_values throughout — row-by-row round trips to
    Supabase took ~20 min for the initial 9.5k-song backfill."""
    from psycopg2.extras import execute_values

    rows = con.execute(text("""
        SELECT s.album_id, s.id, s.title, s.artist, s.track_number, s.duration_ms,
               s.track_id, a.artist, a.extra_artists, a.album_name
        FROM song s JOIN album a ON a.id = s.album_id
        WHERE s.album_id IN (SELECT album_id FROM song WHERE track_id IS NULL)
    """)).fetchall()
    if not rows:
        return {}

    by_base: dict[str, list[Candidate]] = {}
    for k, tid, dur in con.execute(text(
            "SELECT track_key, id, duration_ms FROM track")).fetchall():
        by_base.setdefault(base_of(k), []).append(Candidate(k, tid, dur))

    copies: dict[int, tuple[tuple, list[SongRow]]] = {}
    for album_id, sid, title, artist, tn, dur, tid, a_artist, a_extra, a_name in rows:
        copies.setdefault(album_id, ((a_artist, a_extra, a_name), []))[1].append(
            SongRow(sid, title, artist, tn, dur, tid))

    # New tracks get placeholder ids (negative) until inserted, so later songs
    # in the same run join them rather than inserting the key twice.
    new_tracks: dict[str, tuple[int, int | None]] = {}   # key -> (placeholder, dur)
    song_to: dict[int, int] = {}
    for (a_artist, a_extra, a_name), songs in copies.values():
        keys = copy_keys(songs, a_artist, a_extra, a_name)
        taken = {s.track_id for s in songs if s.track_id is not None}
        for s in songs:
            if s.track_id is not None:
                continue
            key = keys[s.id]
            tid, new_key = resolve(key, s.duration_ms, by_base.get(key, []))
            if tid in taken:
                tid, new_key = None, f"{key}||s{s.id}"
            if tid is None:
                tid = -(len(new_tracks) + 1)
                new_tracks[new_key] = (tid, s.duration_ms)
                by_base.setdefault(base_of(new_key), []).append(
                    Candidate(new_key, tid, s.duration_ms))
            song_to[s.id] = tid
            taken.add(tid)

    raw = con.connection.driver_connection
    with raw.cursor() as cur:
        if new_tracks:
            execute_values(cur,
                "INSERT INTO track (track_key, artist_norm, title_norm, duration_ms, created_at)"
                " VALUES %s ON CONFLICT (track_key) DO NOTHING",
                [(k, *key_parts(k), d, datetime.utcnow())
                 for k, (_, d) in new_tracks.items()])
            cur.execute("SELECT track_key, id FROM track WHERE track_key = ANY(%s)",
                        (list(new_tracks),))
            real = {new_tracks[k][0]: tid for k, tid in cur.fetchall()}
            song_to = {sid: real.get(tid, tid) for sid, tid in song_to.items()}
        pairs = [(sid, tid) for sid, tid in song_to.items() if tid > 0]
        if pairs:
            execute_values(cur,
                "UPDATE song SET track_id = data.tid FROM (VALUES %s) AS data (sid, tid)"
                " WHERE song.id = data.sid",
                pairs)
    raw.commit()
    return dict(pairs)
