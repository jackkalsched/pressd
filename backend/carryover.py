"""Carry a song score forward from one of the user's records onto another.

A user rates a record, then adds another that holds the same recordings — the
album a single ended up on, or the deluxe edition of an album they already
rated. It is the same recording; asking them to score it a second time is
busywork, and the two scores then disagree in their own library.

Songs already share a global identity — `Song.track_id`, the `Track` row that
audio analysis is keyed on — so the match itself is a join. The care is all in
deciding when a shared `track_id` is *enough* evidence.

Why the guards exist
--------------------
A track is keyed by `trackkeys.recording_key` — the primary artist and the
title with edition qualifiers folded — so distinct songs that share a plain
title within an artist's catalogue ("Intro") still land on one track unless
their durations tell them apart. Measured against the live database on
2026-08-30, under the older `track_key`, every cross-record `track_id` match in
user 1's library was a false positive or unverifiable:

    Intro  2014 Forest Hills Drive (129s)  ->  KOD (107s)          different song
    Intro  2014 Forest Hills Drive (129s)  ->  Cole World (82s)    different song
    Intro  The Come Up, Vol. 1     (  ?s)  ->  KOD (107s)          unverifiable
    KING   BULLY                   (  ?s)  ->  VULTURES 1 (?s)     unverifiable

Prefilling on `track_id` alone would therefore have written J. Cole's *2014
Forest Hills Drive* intro onto *KOD*'s entirely different intro. Duration is the
natural tiebreak but was missing on 68.6% of songs then, so it cannot carry the
whole argument on its own. The rule:

  1. When both durations are known they must agree within
     DURATION_TOLERANCE_MS, and then the source may be any record of any
     status — rated or still being listened to. A title match *and* a
     runtime match within five seconds is strong evidence of one recording.
     `_link_tracks` already uses a 10s tolerance to decide two recordings are
     *different*; this is deliberately tighter, because there the cost of a
     wrong call is a duplicate audio download and here it is a wrong score in
     someone's library.
  2. When either duration is missing, the source must be a single or EP
     (<= CARRYOVER_MAX_SOURCE_TRACKS songs, counted over the whole source
     album), or the two records must overlap (rule 4). A two-track single
     exists to carry one recording, whereas two full albums by one artist are
     exactly where generic titles collide.
  3. Titles that name a position on a record rather than a song — intro, outro,
     interlude, skit — are refused unless duration positively confirms them or
     the two records overlap. These are the titles that repeat across a
     catalogue.
  4. Two records overlap when they share at least MIN_SHARED_TRACKS tracks,
     counted over all their songs, scored or not. A shared title can be a
     coincidence; several on one pair of records cannot, so those are editions
     of one another and no duration is needed. Positional titles and pairs whose
     durations disagree don't count towards it. It never overrides durations
     that are known to disagree (rule 1).

Until October 2026 rule 2 applied to every match, durations or not, and it was
also miscounted — the window counted the source's *scored* songs rather than
its tracks. Measured then, it blocked every real match in production: all 18
candidate matches came from full albums, 12 of them *The Life of a Showgirl*'s
songs already rated on *The Encore*, and the 3 *Intro* matches among them are
exactly the false positives above, which rule 3 still refuses. Agreeing
durations are what separate the two, so they now open the full-album case.

Rule 4 came later that month. Songs imported from the old spreadsheet have no
duration at all, so a deluxe of a record rated that way could never match: all
24 songs of *CALL ME IF YOU GET LOST: The Estate Sale* share a track with the
24-track copy of *CALL ME IF YOU GET LOST* the owner had rated, and rule 2
refused every one. Overlap is measured between the two records rather than read
from their names because it also covers a differently titled edition. Measured
then, over every pair of one user's records: editions share 4, 12 and 24 tracks,
and every other pair at most 2 (*KING* on VULTURES 1 and BULLY, *Pull Up* on
International Artist and Hoodie SZN, and the J. Cole *Intro*s, share 1 or 0).

Only this user's own scores are ever read. When several records hold the same
recording, the one most recently rated (or, for one still being listened to,
most recently added) wins.

Nothing here writes. It reports what *could* carry; the rating screen prefills
the draft and says where the number came from, and the user submits it or
overwrites it like any other score. Changing it never touches the source.
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

# How many tracks two records must share to count as editions of one another.
# See rule 4 in the module docstring for the gap in the data this sits in.
MIN_SHARED_TRACKS = 3

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
    """{song_id: {"score", "from_album_id", "from_album_name",
    "from_album_art_url"}} for the unscored songs on `album_id` that this user
    already scored on another of their records. See the module docstring.

    Read-only. Returns {} rather than raising if anything goes wrong — a
    prefill is a convenience, and losing it must never block a rating.
    """
    try:
        rows = session.execute(_sql("""
            WITH src_album AS (
                -- Counted over every song, scored or not: the guard is about
                -- what the source record is, not how far through it the user is.
                SELECT a.id, a.album_name, a.album_art_url,
                       COALESCE(a.date_rated::timestamptz, a.created_at) AS recency,
                       (SELECT COUNT(*) FROM song x WHERE x.album_id = a.id) AS n_tracks
                FROM album a
                WHERE a.user_id = :uid
                  AND a.id <> :aid
            )
            SELECT tgt.id, tgt.title, tgt.duration_ms, tgt.score,
                   s.score, sa.id, sa.album_name, sa.album_art_url,
                   s.duration_ms, sa.n_tracks, tgt.track_id
            FROM song tgt
            JOIN song s ON s.track_id = tgt.track_id
            JOIN src_album sa ON sa.id = s.album_id
            WHERE tgt.album_id = :aid
              AND tgt.track_id IS NOT NULL
            ORDER BY sa.recency DESC NULLS LAST, sa.id DESC
        """), {"uid": user_id, "aid": album_id}).fetchall()
    except Exception as e:  # pragma: no cover - a prefill is never worth a 500
        print(f"[carryover] album {album_id} user {user_id} failed: {e}")
        return {}

    # Rule 4, so over every shared song: a song already scored on either record
    # is still evidence that the two records are editions of one another.
    shared: dict[int, set[int]] = {}
    for (_, t_title, t_dur, _, _, src_album_id, _, _, s_dur, _, track_id) in rows:
        if not is_positional_title(t_title) and _durations_agree(t_dur, s_dur) is not False:
            shared.setdefault(src_album_id, set()).add(track_id)

    out: dict[int, dict] = {}
    for (song_id, t_title, t_dur, t_score, score, src_album_id, src_album, src_art,
         s_dur, n_tracks, _) in rows:
        if t_score is not None or score is None:
            continue
        # Ordered most recent first, so the first acceptable hit for a song wins.
        if song_id in out:
            continue
        agree = _durations_agree(t_dur, s_dur)
        if agree is False:
            continue                                    # rule 1
        overlap = len(shared.get(src_album_id, ())) >= MIN_SHARED_TRACKS
        if agree is None and n_tracks > CARRYOVER_MAX_SOURCE_TRACKS and not overlap:
            continue                                    # rule 2
        if is_positional_title(t_title) and agree is not True and not overlap:
            continue                                    # rule 3
        out[song_id] = {
            "score": float(score),
            "from_album_id": int(src_album_id),
            "from_album_name": src_album,
            "from_album_art_url": src_art,
        }
    return out
