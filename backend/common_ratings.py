"""What the userbase's statistics are allowed to count.

The artist page's Pressd-average scope (`stats._artist_payload(...,
common_only=True)`, population=global) pools every user's ratings into one league table, one scatter of song score
against external factors, and one set of percentiles. Pooled raw, a song one
person has rated speaks for "Pressd" as loudly as one twenty people have, and an
artist one listener went deep on lands on the board on that listener's say-so —
which is the userbase reading as a single person's taste.

So the userbase numbers count only what the userbase has in common (Jack,
November 2026):

  - a song only if at least `MIN_COMMON_RATERS` different users scored it, as one
    recording (`track_id`; a title only for a song with no track yet, the rule
    `_artist_track_scores` uses);
  - a record's external factors only if at least `MIN_COMMON_RATERS` different
    users rated a copy of it (`subject_key`, any edition);
  - an artist on the board only with at least `MIN_COMMON_SONGS` such songs.

Only that page. One user's own stats, and both halves of the artist page's
compare view, keep every rating (Jack): a person's library is theirs to read in
full.
"""
from collections import defaultdict
from typing import Hashable, Iterable

MIN_COMMON_RATERS = 3
MIN_COMMON_SONGS = 15


def song_key(track_id: int | None, title: str | None) -> Hashable:
    """One recording across copies: its track, else its folded title."""
    return track_id if track_id is not None else "t:" + (title or "").strip().lower()


def common_keys(pairs: Iterable[tuple[Hashable, int]], min_raters: int = MIN_COMMON_RATERS) -> set:
    """The keys at least `min_raters` distinct users appear against."""
    users: dict[Hashable, set[int]] = defaultdict(set)
    for key, user_id in pairs:
        if key is not None:
            users[key].add(user_id)
    return {k for k, us in users.items() if len(us) >= min_raters}


def qualifying_artists(keys_by_artist: dict[str, set], min_songs: int = MIN_COMMON_SONGS) -> set[str]:
    """Artists with at least `min_songs` distinct common songs."""
    return {a for a, keys in keys_by_artist.items() if len(keys) >= min_songs}
