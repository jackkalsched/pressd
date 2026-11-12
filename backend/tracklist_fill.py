"""Bring a short tracklist up to what the record holds, without losing a song.

A copy's songs used to be fixed at import. A record added from Upcoming before
it was out got none at all, because a catalog's pre-release listing is often
just the singles so far and "a copy with songs is never filled again". So Lil
Baby's *FRESH*, on To Listen the week before release, showed nothing, though
"Dead Fresh" had been out as its lead single for months, and a listener who
had rated that single had no way to see it waiting on the album.

Filling is now a **merge**, here once for its two callers: the owner opening
a copy (`POST /albums/{id}/tracklist`) and the daily worker
(`worker/fill_tracklists.py`, before the cover fill in
.github/workflows/fill-covers.yml). A pre-release add keeps whatever the
catalog lists, and may be topped up as more singles are announced.

**One pull after release, then never again** (Jack, November 2026). On or after
its release date a copy gets exactly one merge — whatever it adds, even
nothing — and is stamped `Album.tracklist_settled_at`; from then on neither
caller, nor another copy, changes it. A copy that gets songs while its record is
out (an import, a clone, a bin's add) is settled the moment it has them
(backend/tracklist_settle.py). So what this tops up is: songless copies,
copies whose release is ahead, and released copies not yet pulled.

The rules, all in `plan_merge` (pure, tested in tests/test_tracklist_fill.py):

  - Songs are only ever added. None is deleted, none is re-scored, and a
    tracklist never shrinks.
  - A song already on the copy is matched to the incoming list by recording
    identity — the same `trackkeys.recording_key` that `tracklink` stores, with
    its "two songs on one copy are two recordings" disambiguation, computed on
    the album's own artists so a catalog's per-song billing can't split a
    match — or by `track_id` when the incoming list comes from another copy.
    Never by a bare title compare. One fallback stops a respelled title being
    added twice: an unmatched pair at the same position whose known durations
    agree within carryover's 5s is one song.
  - Track numbers follow the incoming list's order. A song of the copy the list
    doesn't hold keeps its row and goes after, in its old order: no score is
    lost because a catalog dropped a track.
  - A copy the list adds nothing to is not touched at all, not even renumbered.
  - New songs are linked through `tracklink.link_album`, so "Dead Fresh" added
    to FRESH lands on the `Track` the single's copy already holds, and
    carryover (backend/carryover.py: a ≤6-track source needs no duration)
    pre-fills its score when the album is rated.

Rated and settled copies are left alone. Rating is blocked while a record is
unreleased, so the copies this is for are To Listen and Listening.

Where the songs come from
-------------------------
Another copy of the record (`subject_key`) — a database read, no network —
only when it is the **same edition**: `trackkeys._clean` of the two names is
equal (edition qualifiers kept, unlike `subject_key`, which folds "(Deluxe)"
and even "(Taylor's Version)" into the original), and every linked song of the
short copy is on the longer one. In production on 2026-11-12, 66 copies were
shorter than another copy of their record; the same-name pairs differed by an
interlude a spreadsheet import had dropped ("Sometimes...", "29 Intro") or a
catalog's bonus track, while the cross-name ones were deluxes, anniversaries
and Taylor's Versions — whose extra songs a standard copy must not take. When
several same-edition copies are longer, the tracklist most copies share wins.
A copy with no songs at all may take the fewest-song non-single copy of any
edition (the standard edition, as the endpoint always did). For a released
copy the other copy must itself be settled: its list is a finished pull, so
taking it is this copy's pull too, with no network. Before release any longer
same-edition copy may top it up.

Otherwise the catalog: Deezer, then iTunes, searched by name and artist and
accepted only through `same_album`, the edition matching the copy's own name
first, and never a single for a copy that isn't one. A catalog list is applied
to the copies of its own edition, and to any copy with no songs. A list a
client sends (the endpoint's body) goes on the caller's own unsettled copy only.
A lookup that errors settles nothing: the next run tries again.
"""
from __future__ import annotations

import time
from datetime import date, datetime, timezone
from dataclasses import dataclass, field
from typing import Iterable

import httpx
from sqlmodel import Session, select
from sqlalchemy.orm import selectinload

from .carryover import DURATION_TOLERANCE_MS
from .credits import extras_of, primary_act
from .models import Album, Song
from .scoring import is_single_release
from .tracklink import SongRow, copy_keys, link_album
from .tracklist_settle import MERGING
from .trackkeys import _clean, same_album

UA = {"User-Agent": "Pressd/1.0 (music-rating-app)"}

# Between outbound calls. Deezer allows 50 requests per 5 seconds and answers
# over it with a 200 and an error body; iTunes asks for ~20 a minute.
PACE_S = 0.3
ITUNES_PACE_S = 3.0


# ── The merge itself (pure) ──────────────────────────────────────────────────

@dataclass
class Incoming:
    title: str
    track_number: int | None = None
    duration_ms: int | None = None
    artist: str | None = None
    explicit: bool = False
    track_id: int | None = None   # set when the list comes from another copy


@dataclass
class Plan:
    renumber: dict[int, int] = field(default_factory=dict)   # song id -> number
    add: list[tuple[int, Incoming]] = field(default_factory=list)   # (number, track)
    matched: int = 0

    @property
    def changes(self) -> bool:
        return bool(self.add)


def _keys(rows: list[SongRow], album_artist: str | None, extra_artists: str | None,
          album_name: str | None) -> dict[int, str]:
    # The album's artists only (artist=None): within one record a title names
    # the song, and a catalog billing a track to its feature mustn't split it.
    plain = [SongRow(r.id, r.title, None, r.track_number, r.duration_ms) for r in rows]
    return copy_keys(plain, album_artist, extra_artists, album_name)


def _positions(incoming: list[Incoming]) -> list[int]:
    """The list's own numbers when they climb (a partial pre-release list keeps
    "Dead Fresh" at 10), else its order: Deezer restarts at 1 on each disc."""
    nums = [t.track_number for t in incoming]
    if all(isinstance(n, int) and n > 0 for n in nums) and all(
            a < b for a, b in zip(nums, nums[1:])):
        return list(nums)  # type: ignore[arg-type]
    return list(range(1, len(incoming) + 1))


def plan_merge(existing: list[SongRow], incoming: list[Incoming], album_artist: str | None,
               extra_artists: str | None, album_name: str | None) -> Plan:
    """What merging `incoming` into a copy holding `existing` would do."""
    incoming = [t for t in incoming if (t.title or "").strip()]
    if not incoming:
        return Plan()
    ex_keys = _keys(existing, album_artist, extra_artists, album_name)
    in_rows = [SongRow(-(i + 1), t.title, None, t.track_number, t.duration_ms)
               for i, t in enumerate(incoming)]
    in_keys = _keys(in_rows, album_artist, extra_artists, album_name)
    pos = _positions(incoming)

    by_tid = {s.track_id: s for s in existing if s.track_id is not None}
    by_key: dict[str, SongRow] = {}
    for s in existing:
        by_key.setdefault(ex_keys[s.id], s)

    used: set[int] = set()
    match: dict[int, SongRow] = {}            # incoming index -> existing song
    for i, t in enumerate(incoming):
        s = by_tid.get(t.track_id) if t.track_id is not None else None
        if s is None or s.id in used:
            s = by_key.get(in_keys[-(i + 1)])
        if s is not None and s.id not in used:
            match[i] = s
            used.add(s.id)

    # A respelled title at the same place with the same length is one song.
    for i, t in enumerate(incoming):
        if i in match or not t.duration_ms:
            continue
        for s in existing:
            if (s.id not in used and s.track_number == pos[i] and s.duration_ms
                    and abs(s.duration_ms - t.duration_ms) <= DURATION_TOLERANCE_MS):
                match[i] = s
                used.add(s.id)
                break

    add = [(pos[i], t) for i, t in enumerate(incoming) if i not in match]
    if not add:
        return Plan(matched=len(match))

    renumber: dict[int, int] = {}
    for i, s in match.items():
        if s.track_number != pos[i]:
            renumber[s.id] = pos[i]
    nxt = max(pos) + 1
    rest = sorted((s for s in existing if s.id not in used),
                  key=lambda s: (s.track_number is None, s.track_number or 0, s.id))
    for s in rest:
        if s.track_number != nxt:
            renumber[s.id] = nxt
        nxt += 1
    return Plan(renumber=renumber, add=add, matched=len(match))


def same_edition(a: str | None, b: str | None) -> bool:
    """Two names for one edition: equal with their edition qualifiers kept."""
    return _clean(a or "") == _clean(b or "")


# ── Sources ──────────────────────────────────────────────────────────────────

def _rows(album: Album) -> list[SongRow]:
    return [SongRow(s.id, s.title, s.artist, s.track_number, s.duration_ms, s.track_id)
            for s in album.songs]


def from_copy(album: Album) -> list[Incoming]:
    return [Incoming(s.title, s.track_number, s.duration_ms, s.artist, s.explicit, s.track_id)
            for s in sorted(album.songs, key=lambda s: (s.track_number is None, s.track_number or 0, s.id))]


def from_tracks(tracks: Iterable[dict]) -> list[Incoming]:
    """/search/resolve's track dicts (or a client's body) as incoming songs."""
    out = []
    for t in tracks or []:
        if not isinstance(t, dict) or not str(t.get("title") or "").strip():
            continue
        tn = t.get("track_number")
        dur = t.get("duration_ms")
        out.append(Incoming(
            title=str(t["title"]),
            track_number=tn if isinstance(tn, int) else None,
            duration_ms=dur if isinstance(dur, int) and dur > 0 else None,
            artist=t.get("artist") or None,
            explicit=bool(t.get("explicit", False)),
        ))
    return out


def is_out(album, today: date | None = None) -> bool:
    """Whether the copy's record is out: no date, or today or earlier."""
    rd = getattr(album, "release_date", None)
    return rd is None or rd <= (today or date.today())


def is_settled(album) -> bool:
    return getattr(album, "tracklist_settled_at", None) is not None


def donor_for(copy, copies: list, *, released: bool = False):
    """The other copy whose songs this one may take (module docstring). For a
    released copy only a settled one: a finished pull."""
    mine = {s.track_id for s in copy.songs if s.track_id is not None}
    n = len(copy.songs)
    pool = [c for c in copies if c.id != copy.id and (is_settled(c) or not released)]
    same = [c for c in pool
            if len(c.songs) > n and same_edition(c.album_name, copy.album_name)
            and mine <= {s.track_id for s in c.songs}]
    if same:
        shapes: dict[frozenset, list] = {}
        for c in same:
            shapes.setdefault(frozenset(s.track_id for s in c.songs), []).append(c)
        group = max(shapes.values(), key=lambda g: (len(g), len(g[0].songs), -min(c.id for c in g)))
        return min(group, key=lambda c: c.id)
    if n == 0:
        any_ed = [c for c in pool if c.songs and not is_single_release(c.album_name, len(c.songs))]
        return min(any_ed, key=lambda c: (len(c.songs), c.id), default=None)
    return None


def takes_catalog(copy, resolved_name: str | None) -> bool:
    """A catalog list goes on a copy of its own edition, or one with no songs."""
    return not copy.songs or not resolved_name or same_edition(copy.album_name, resolved_name)


# ── Applying ─────────────────────────────────────────────────────────────────

@dataclass
class Change:
    album_id: int
    user_id: int
    status: str
    source: str
    before: int
    after: int
    added: list[str]
    renumbered: int
    new: list[Incoming] = field(default_factory=list)


def merge_copy(session: Session, album: Album, incoming: list[Incoming], source: str,
               *, dry_run: bool = False) -> Change | None:
    """Merge `incoming` into one unsettled, unrated copy; commit and link. None
    when nothing to add. Never settles: the caller does, once its pull is done."""
    if album.status == "rated" or is_settled(album):
        return None
    plan = plan_merge(_rows(album), incoming, album.artist, album.extra_artists, album.album_name)
    if not plan.changes:
        return None
    before = len(album.songs)
    change = Change(album.id, album.user_id, album.status, source, before, before + len(plan.add),
                    [t.title for _, t in plan.add], len(plan.renumber),
                    [t for _, t in plan.add])
    if dry_run:
        return change
    session.info[MERGING] = True
    try:
        songs = {s.id: s for s in album.songs}
        for sid, n in plan.renumber.items():
            songs[sid].track_number = n
            session.add(songs[sid])
        taken = {s.track_id for s in album.songs if s.track_id is not None}
        for n, t in plan.add:
            tid = t.track_id if t.track_id is not None and t.track_id not in taken else None
            if tid is not None:
                taken.add(tid)
            session.add(Song(
                title=t.title, track_number=n, duration_ms=t.duration_ms, explicit=t.explicit,
                artist=primary_act(t.artist) if t.artist else album.artist,
                track_id=tid, album_id=album.id,
            ))
        album.total_tracks = max(album.total_tracks or 0, change.after)
        session.add(album)
        session.commit()
    finally:
        session.info.pop(MERGING, None)
    try:
        link_album(session, album.id)
        session.commit()
    except Exception as e:  # the worker's build_tracks is the backstop
        session.rollback()
        print(f"[tracklist_fill] link album {album.id} failed: {e}")
    session.refresh(album)
    return change


def settle(session: Session, album: Album, *, has_songs: bool | None = None,
           dry_run: bool = False) -> bool:
    """Stamp a copy's one post-release pull done, if its record is out and it has
    songs. `has_songs` stands in for a dry run's merges that weren't written."""
    if is_settled(album) or not is_out(album):
        return False
    if not (has_songs if has_songs is not None else bool(album.songs)):
        return False
    if not dry_run:
        album.tracklist_settled_at = datetime.now(timezone.utc)
        session.add(album)
        session.commit()
    return True


def preview_links(session: Session, album: Album, change: Change) -> list[tuple[str, int | None]]:
    """Read-only: (title, the existing track each added song would link to, or
    None for a new one), as `link_album` would decide it."""
    from sqlalchemy import text
    from .tracklink import Candidate, base_of, resolve
    rows = _rows(album) + [SongRow(-(i + 1), t.title, t.artist, None, t.duration_ms)
                           for i, t in enumerate(change.new)]
    keys = copy_keys(rows, album.artist, album.extra_artists, album.album_name)
    out = []
    for i, t in enumerate(change.new):
        if t.track_id is not None:
            out.append((t.title, t.track_id))
            continue
        key = keys[-(i + 1)]
        like = key.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        cands = [Candidate(*r) for r in session.execute(text(
            "SELECT track_key, id, duration_ms FROM track"
            " WHERE track_key = :k OR track_key LIKE :p ESCAPE '\\'"),
            {"k": key, "p": like + "||d%"}).all()]
        tid, _ = resolve(key, t.duration_ms, [c for c in cands if base_of(c.track_key) == key])
        out.append((t.title, tid))
    return out


def record_copies(session: Session, album: Album) -> list[Album]:
    """Every copy of `album`'s record, songs loaded."""
    if not album.subject_key:
        return [album]
    return list(session.exec(
        select(Album).where(Album.subject_key == album.subject_key)
        .options(selectinload(Album.songs))
    ).all())


# ── The catalog ──────────────────────────────────────────────────────────────

class CatalogError(Exception):
    """A source answered with an error rather than a result."""


@dataclass
class Resolved:
    album_name: str
    artist: str
    tracks: list[Incoming]
    cover_url: str | None
    source: str


def _artists(artist: str, extra_artists: str | None) -> list[str]:
    return [a for a in [artist, *extras_of(extra_artists)] if a]


def _pick(name: str, hits: list[tuple[str, int, dict]]) -> dict | None:
    """The hit of this copy's own edition first, then the fewest tracks."""
    if not hits:
        return None
    return min(hits, key=lambda h: (not same_edition(h[0], name), h[1]))[2]


def _deezer(client: httpx.Client, name: str, artist: str, artists: list[str],
            want_single: bool) -> Resolved | None:
    time.sleep(PACE_S)
    r = client.get("https://api.deezer.com/search/album",
                   params={"q": f'artist:"{artist}" album:"{name}"', "limit": 15})
    body = r.json() if r.is_success else None
    if not isinstance(body, dict) or "error" in body:
        raise CatalogError(f"deezer search: {r.status_code} {str(body)[:120] if body else ''}")
    hits = []
    for a in body.get("data") or []:
        kind = a.get("record_type")
        if kind == "compile" or (kind == "single" and not want_single):
            continue
        got_artist = (a.get("artist") or {}).get("name") or ""
        if any(same_album(name, w, a.get("title") or "", got_artist) for w in artists):
            hits.append((a.get("title") or "", a.get("nb_tracks") or 0, a))
    hit = _pick(name, hits)
    if hit is None:
        return None
    time.sleep(PACE_S)
    r = client.get(f"https://api.deezer.com/album/{hit['id']}")
    album = r.json() if r.is_success else None
    if not isinstance(album, dict) or "error" in album:
        raise CatalogError(f"deezer album {hit['id']}: {r.status_code}")
    data = (album.get("tracks") or {}).get("data") or []
    album_artist = (album.get("artist") or {}).get("name") or artist
    tracks = [Incoming(
        title=t.get("title") or "",
        track_number=t.get("track_position"),
        duration_ms=(t.get("duration") or 0) * 1000 or None,
        artist=(t.get("artist") or {}).get("name") or album_artist,
        explicit=bool(t.get("explicit_lyrics")),
    ) for t in data]
    # Positions restart per disc; plan_merge falls back to the list's order then.
    return Resolved(album.get("title") or hit["title"], album_artist, tracks,
                    album.get("cover_xl") or album.get("cover_big"), f"deezer:{hit['id']}")


def _itunes(client: httpx.Client, name: str, artist: str, artists: list[str],
            want_single: bool) -> Resolved | None:
    time.sleep(ITUNES_PACE_S)
    r = client.get("https://itunes.apple.com/search",
                   params={"term": f"{name} {artist}", "entity": "album", "limit": 15})
    if not r.is_success:
        raise CatalogError(f"itunes search: {r.status_code}")
    hits = []
    for a in r.json().get("results") or []:
        title = a.get("collectionName") or ""
        if title.lower().endswith("- single") and not want_single:
            continue
        if any(same_album(name, w, title, a.get("artistName") or "") for w in artists):
            hits.append((title, a.get("trackCount") or 0, a))
    hit = _pick(name, hits)
    if hit is None:
        return None
    time.sleep(ITUNES_PACE_S)
    r = client.get("https://itunes.apple.com/lookup",
                   params={"id": hit["collectionId"], "entity": "song", "limit": 200})
    if not r.is_success:
        raise CatalogError(f"itunes lookup {hit['collectionId']}: {r.status_code}")
    songs = sorted((t for t in r.json().get("results") or [] if t.get("wrapperType") == "track"),
                   key=lambda t: (t.get("discNumber") or 1, t.get("trackNumber") or 0))
    tracks = [Incoming(
        title=t.get("trackName") or "",
        track_number=t.get("trackNumber"),
        duration_ms=t.get("trackTimeMillis"),
        artist=t.get("artistName") or hit.get("artistName"),
        explicit=t.get("trackExplicitness") == "explicit",
    ) for t in songs]
    raw = hit.get("artworkUrl100") or ""
    return Resolved(hit.get("collectionName") or name, hit.get("artistName") or artist, tracks,
                    raw.replace("100x100bb", "1000x1000bb") or None, f"itunes:{hit['collectionId']}")


def resolve_catalog(client: httpx.Client, name: str, artist: str, extra_artists: str | None = None,
                    *, want_single: bool = False) -> tuple[Resolved | None, list[str]]:
    """(the record's catalog tracklist or None, the errors met on the way).
    Deezer first, then iTunes; a source that errors doesn't stop the next."""
    artists = _artists(artist, extra_artists)
    errors: list[str] = []
    for source in (_deezer, _itunes):
        try:
            got = source(client, name, artist, artists, want_single)
        except (httpx.HTTPError, CatalogError, ValueError) as e:
            errors.append(f"{source.__name__.strip('_')}: {type(e).__name__}: {e}"[:200])
            continue
        if got and got.tracks:
            return got, errors
    return None, errors

