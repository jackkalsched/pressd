"""Carry a song score forward from a single or EP onto a longer record.

A user rates a single, then adds the album that single ended up on. It is the
same recording; asking them to score it a second time is busywork, and the two
scores then disagree in their own library.

Songs already share a global identity — `Song.track_id`, the `Track` row that
audio analysis is keyed on — so the match itself is a join. The care is all in
deciding when a shared `track_id` is *enough* evidence.

Why the guards exist
--------------------
`track_key` is `_clean(artist)||_clean(title)`, which collapses distinct songs
that share a title within an artist's catalogue. Measured against the live
database on 2026-08-30, every cross-record `track_id` match in user 1's library
was a false positive or unverifiable:

    Intro  2014 Forest Hills Drive (129s)  ->  KOD (107s)          different song
    Intro  2014 Forest Hills Drive (129s)  ->  Cole World (82s)    different song
    Intro  The Come Up, Vol. 1     (  ?s)  ->  KOD (107s)          unverifiable
    KING   BULLY                   (  ?s)  ->  VULTURES 1 (?s)     unverifiable

Prefilling on `track_id` alone would therefore have written J. Cole's *2014
Forest Hills Drive* intro onto *KOD*'s entirely different intro. Duration is the
natural tiebreak but is missing on 68.6% of songs, so it cannot carry the whole
argument on its own. Three guards together do:

  1. The source must be a single or EP (<= CARRYOVER_MAX_SOURCE_TRACKS). This is
     the case that was actually asked for, and it is also where the evidence is
     strongest: a two-track single exists to carry one recording, whereas two
     full albums by one artist are exactly where generic titles collide. Every
     false positive above came from a full-album source.
  2. Titles that name a position on a record rather than a song — intro, outro,
     interlude, skit — are refused unless duration positively confirms them.
     These are the titles that repeat across an artist's catalogue.
  3. When both durations are known they must agree within DURATION_TOLERANCE_MS.
     `_link_tracks` already uses a 10s tolerance to decide two recordings are
     *different*; this is deliberately tighter, because there the cost of a
     wrong call is a duplicate audio download and here it is a wrong score in
     someone's library.

Relaxing rule 1 re-admits the *Intro* class of false positive and must not be
done without stronger title evidence than a normalised string match.

Nothing here writes. It reports what *could* carry; the rating screen prefills
the draft and shows where the number came from, and the user submits it or
overwrites it like any other score. A wrong suggestion costs one keystroke,
which is the reason the guards can be pragmatic rather than perfect.
"""

from __future__ import annotations

from sqlalchemy import text as _sql
from sqlmodel import Session

from .scoring import EP_MAX_TRACKS

# A single or an EP. Same threshold the rating flow uses to decide an album
# skips the external factors, and named separately because the two answer
# different questions and could diverge.
CARRYOVER_MAX_SOURCE_TRACKS = EP_MAX_TRACKS

# Tighter than _link_tracks' 10s: see the module docstring.
DURATION_TOLERANCE_MS = 5_000

# Titles that name a slot on a record rather than a song, and so repeat across
# an artist's catalogue. Matched after normalising, so "Intro." and "intro"
# both land here; a title that merely *contains* one of these ("Interlude in
# Amber") is a real title and is not caught.
POSITIONAL_TITLES = frozenset({
    "intro", "introduction", "outro", "interlude", "skit", "prelude",
    "reprise", "untitled", "instrumental", "bonus track", "hidden track",
})


def _norm_title(title: str | None) -> str:
    return " ".join((title or "").strip().lower().split())


def is_positional_title(title: str | None) -> bool:
    """True for a title that names a position on a record, not a song."""
    t = _norm_title(title)
    if t in POSITIONAL_TITLES:
        return True
    # "Intro 2", "Skit #3" — a positional title with a disambiguating number is
    # still positional, and the number is not evidence the songs match.
    head = t.rstrip("0123456789 #.-")
    return bool(head) and head in POSITIONAL_TITLES


def _durations_agree(a: int | None, b: int | None) -> bool | None:
    """True/False when both durations are known, None when they are not."""
    if not a or not b:
        return None
    return abs(a - b) <= DURATION_TOLERANCE_MS


def carryover_for_album(session: Session, album_id: int, user_id: int) -> dict[int, dict]:
    """{song_id: {"score", "from_album_id", "from_album_name"}} for the unscored
    songs on `album_id` that this user already scored on a single or EP.

    Read-only. Returns {} rather than raising if anything goes wrong — a
    prefill is a convenience, and losing it must never block a rating.
    """
    try:
        rows = session.execute(_sql("""
            WITH src AS (
                SELECT s.track_id, s.score, s.duration_ms, s.title,
                       a.id AS album_id, a.album_name, a.date_rated,
                       COUNT(*) OVER (PARTITION BY a.id) AS n_tracks
                FROM song s
                JOIN album a ON a.id = s.album_id
                WHERE a.user_id = :uid
                  AND a.status = 'rated'
                  AND a.id <> :aid
                  AND s.score IS NOT NULL
                  AND s.track_id IS NOT NULL
            )
            SELECT tgt.id, tgt.title, tgt.duration_ms,
                   src.score, src.album_id, src.album_name, src.duration_ms, src.title
            FROM song tgt
            JOIN src ON src.track_id = tgt.track_id
            WHERE tgt.album_id = :aid
              AND tgt.score IS NULL
              AND tgt.track_id IS NOT NULL
              AND src.n_tracks <= :maxsrc
            ORDER BY src.date_rated DESC NULLS LAST, src.album_id DESC
        """), {"uid": user_id, "aid": album_id,
               "maxsrc": CARRYOVER_MAX_SOURCE_TRACKS}).fetchall()
    except Exception as e:  # pragma: no cover - a prefill is never worth a 500
        print(f"[carryover] album {album_id} user {user_id} failed: {e}")
        return {}

    out: dict[int, dict] = {}
    for song_id, t_title, t_dur, score, src_album_id, src_album, s_dur, s_title in rows:
        # Ordered most-recently-rated first, so the first hit for a song wins.
        if song_id in out:
            continue
        agree = _durations_agree(t_dur, s_dur)
        if agree is False:
            continue                                    # guard 3
        if is_positional_title(t_title) and agree is not True:
            continue                                    # guard 2
        out[song_id] = {
            "score": float(score),
            "from_album_id": int(src_album_id),
            "from_album_name": src_album,
        }
    return out
