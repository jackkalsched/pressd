"""
Ranking and grouping for the single search box, with no database in it.

The router fetches candidate rows (every copy whose name, artist or title
touches the query) and hands them here, so the rules that decide what a person
sees can be tested without a connection.

Why the grouping looks the way it does:

- `Album` is a per-user copy (models.py), so "Take Care" and "Take Care
  (Deluxe)" arrive as separate rows. They are one record, and one row, keyed on
  `subject_key`. The caller's own copy stands for the record when they have one,
  because tapping it should open their rating; otherwise the spelling most
  raters hold does.
- A record owned only by others, and only as a To Listen or a half-finished
  listen, has no opinion on it yet and is left out: search would surface a
  stranger's queue. A record qualifies when the caller owns a copy or someone
  has rated one. Singles stay; the library hides them, search shouldn't.
- A record belongs to every credited artist (`credits.album_artists`), so a
  collaborator is findable by name. Artists are distinct on `artist_key`.
- A song is one row per `track_id`; its title is only a label, so the most
  common spelling wins (CLAUDE.md §12).

Matching is on folded text (accents, case and punctuation gone) so "kaytramine"
finds KAYTRAMINÉ and "ac dc" finds AC/DC. Pure stdlib plus `credits` and
`trackkeys`.
"""
import re
import unicodedata
from collections import Counter

from .credits import album_artists
from .trackkeys import artist_key

_NON_ALNUM = re.compile(r"[\W_]+")


def fold(s: str | None) -> str:
    """Comparison form: NFKD, casefolded, marks dropped, punctuation runs to one space."""
    if not s:
        return ""
    s = unicodedata.normalize("NFKD", s).casefold()
    s = "".join(c for c in s if not unicodedata.combining(c))
    return _NON_ALNUM.sub(" ", s).strip()


def match_rank(q: str, name: str) -> int | None:
    """0 exact, 1 prefix, 2 a word starts with it, 3 anywhere, None no match."""
    fq, fn = fold(q), fold(name)
    if not fq or fq not in fn:
        return None
    if fn == fq:
        return 0
    if fn.startswith(fq):
        return 1
    if any(w.startswith(fq) for w in fn.split()):
        return 2
    return 3


def _best(ranks) -> int | None:
    found = [r for r in ranks if r is not None]
    return min(found) if found else None


def _representative(copies):
    """The copy most others hold: the commonest title among rated copies."""
    rated = [c for c in copies if c.status == "rated"] or list(copies)
    top = Counter(c.album_name for c in rated).most_common(1)[0][0]
    return next(c for c in rated if c.album_name == top)


def _records(cands, me) -> list[dict]:
    """Qualifying records, one per subject_key."""
    by_key: dict[str, list] = {}
    for c in cands:
        by_key.setdefault(c.subject_key, []).append(c)
    out = []
    for copies in by_key.values():
        mine = [c for c in copies if c.user_id == me]
        rated = [c for c in copies if c.status == "rated"]
        if not mine and not rated:
            continue
        if mine:
            rep = next((c for c in mine if c.status == "rated"), mine[0])
        else:
            rep = _representative(copies)
        scores = [c.score for c in rated if c.score is not None]
        out.append({
            "rep": rep,
            "mine": bool(mine),
            "raters": len(rated),
            "avg": round(sum(scores) / len(scores), 2) if scores else None,
        })
    return out


def albums_group(q, cands, me, limit) -> list[dict]:
    rows = []
    for r in _records(cands, me):
        rep = r["rep"]
        rank = _best([match_rank(q, rep.album_name), *(match_rank(q, n) for n in album_artists(rep))])
        if rank is None:
            continue
        rows.append(((not r["mine"], rank, -r["raters"], fold(rep.album_name)), {
            "album_id": rep.id,
            "name": rep.album_name,
            "artist": rep.artist,
            "art_url": rep.art_url,
            "mine": r["mine"],
            "status": rep.status,
            "your_score": rep.score if r["mine"] else None,
            "pressd_avg": r["avg"],
            "raters": r["raters"],
        }))
    rows.sort(key=lambda x: x[0])
    return [row for _, row in rows[:limit]]


def artists_group(q, cands, me, limit) -> list[dict]:
    names: dict[str, str] = {}
    counts: Counter = Counter()
    for r in _records(cands, me):
        for name in album_artists(r["rep"]):
            k = artist_key(name)
            names.setdefault(k, name)
            counts[k] += 1
    rows = []
    for k, name in names.items():
        rank = match_rank(q, name)
        if rank is not None:
            rows.append((rank, -counts[k], fold(name), {"name": name, "records": counts[k]}))
    rows.sort(key=lambda x: x[:3])
    return [row for *_, row in rows[:limit]]


def songs_group(q, cands, me, limit) -> list[dict]:
    # A record qualifies on the song candidates' own copies: rated, or the caller's.
    qualifying = {c.subject_key for c in cands if c.status == "rated" or c.user_id == me}
    by_track: dict[int, list] = {}
    for c in cands:
        if c.subject_key in qualifying:
            by_track.setdefault(c.track_id, []).append(c)
    rows = []
    for track_id, copies in by_track.items():
        title = Counter(c.title for c in copies).most_common(1)[0][0]
        rank = match_rank(q, title)
        if rank is None:
            continue
        mine = [c for c in copies if c.user_id == me]
        rep = (next((c for c in mine if c.status == "rated"), mine[0]) if mine
               else _representative(copies))
        rows.append((rank, -len(copies), fold(title), {
            "track_id": track_id,
            "title": title,
            "album_id": rep.album_id,
            "album_name": rep.album_name,
            "artist": rep.artist,
            "mine": bool(mine),
            "status": rep.status,
        }))
    rows.sort(key=lambda x: x[:3])
    return [row for *_, row in rows[:limit]]


def people_group(q, rows, limit) -> list[dict]:
    ranked = []
    for r in rows:
        rank = match_rank(q, r["name"])
        if rank is not None:
            ranked.append((not r.get("already_friends"), rank, fold(r["name"]), r))
    ranked.sort(key=lambda x: x[:3])
    return [r for *_, r in ranked[:limit]]
