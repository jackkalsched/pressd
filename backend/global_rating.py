"""
The global Pressd rating: one score per record, for the whole userbase.

Rather than averaging finished per-user scores — each of which was z-scored
against its own owner's library, so they aren't on a common scale — this pools
the *raw inputs* across every copy of a record and runs them through
compute_album_score once, as if the userbase were a single listener:

  - song scores are averaged per track first (via the shared track_id), then
    across tracks. Averaging every song row instead would let whichever edition
    carried more tracks outvote the others — the 16-track deluxe against the 15.
  - the four external factors are averaged across the copies that carry a
    complete set.
  - the result is z-scored against the userbase-wide factor distribution and
    the default weights, not any one person's.

The upshot is that a user with two rated albums no longer moves the board with
a score that only meant something relative to their own two albums.
"""
import time
from collections import defaultdict

from sqlalchemy import text

from .scoring import (
    EP_MAX_TRACKS,
    FACTOR_KEYS,
    WEIGHTS,
    compute_album_score,
    get_global_factor_stats,
)

# The board reads the whole song table, which is ~400ms against a remote
# Postgres — too slow to repeat on every chart load. The numbers only move when
# somebody finishes rating an album, so a short TTL is plenty; a stale board for
# under a minute is invisible, and invalidate_cache() clears it on a write.
_CACHE_TTL_S = 60.0
_cache: dict[str, object] = {"at": 0.0, "value": None}


def invalidate_cache() -> None:
    """Drop the memoised board — call after anything that changes a score."""
    _cache["at"], _cache["value"] = 0.0, None


def record_key(album_name: str, artist: str) -> tuple[str, str]:
    """Group key for "the same record" — matches how the chart endpoints group."""
    return (album_name.strip().lower(), artist.strip().lower())


def compute_global_ratings(session, use_cache: bool = True) -> dict[tuple[str, str], dict]:
    """{record_key: {"score", "raters", "track_count"}} across every rated copy.

    Two queries and an in-memory group-by; the rated corpus is small enough that
    this stays cheap once memoised. Pass use_cache=False to force a fresh read.
    """
    if use_cache and _cache["value"] is not None and (time.monotonic() - _cache["at"]) < _CACHE_TTL_S:
        return _cache["value"]
    value = _compute(session)
    _cache["at"], _cache["value"] = time.monotonic(), value
    return value


def _compute(session) -> dict[tuple[str, str], dict]:
    rows = session.execute(text("""
        SELECT a.id, a.user_id, a.album_name, a.artist,
               a.theme, a.replay_value, a.production, a.distinctness
        FROM album a
        WHERE a.status = 'rated' AND a.score IS NOT NULL
    """)).fetchall()

    songs = session.execute(text("""
        SELECT s.album_id, s.track_id, s.title, s.score
        FROM song s JOIN album a ON a.id = s.album_id
        WHERE a.status = 'rated' AND a.score IS NOT NULL AND s.score IS NOT NULL
    """)).fetchall()

    songs_by_album = defaultdict(list)
    for s in songs:
        songs_by_album[s.album_id].append(s)

    groups: dict[tuple[str, str], dict] = {}
    for a in rows:
        g = groups.setdefault(record_key(a.album_name, a.artist),
                              {"copies": [], "raters": set()})
        g["copies"].append(a)
        if a.user_id is not None:
            g["raters"].add(a.user_id)

    prior = get_global_factor_stats(session)
    out: dict[tuple[str, str], dict] = {}

    for key, g in groups.items():
        # Songs: mean per track, then mean across tracks.
        per_track: dict[object, list[float]] = defaultdict(list)
        for a in g["copies"]:
            for s in songs_by_album.get(a.id, []):
                tk = s.track_id if s.track_id is not None else ("t:" + (s.title or "").strip().lower())
                per_track[tk].append(s.score)
        if not per_track:
            continue
        avg_song = sum(sum(v) / len(v) for v in per_track.values()) / len(per_track)

        # Factors: mean across the copies carrying a complete set.
        complete = [a for a in g["copies"]
                    if all(getattr(a, f) is not None for f in FACTOR_KEYS)]
        if complete:
            factors = {f: sum(getattr(a, f) for a in complete) / len(complete)
                       for f in FACTOR_KEYS}
            score = compute_album_score(
                [avg_song],
                factors["theme"], factors["replay_value"],
                factors["production"], factors["distinctness"],
                prior, WEIGHTS,
            )
        else:
            # EPs skip the factor ratings by design, and a full album still
            # awaiting them has nothing to z-score — both fall back to the
            # song mean, mirroring the per-user rule.
            score = round(avg_song, 2)

        out[key] = {
            "score": score,
            "raters": len(g["raters"]),
            "track_count": len(per_track),
            "is_ep": len(per_track) <= EP_MAX_TRACKS,
        }

    return out
