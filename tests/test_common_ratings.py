from backend.common_ratings import (
    MIN_COMMON_RATERS, MIN_COMMON_SONGS, common_keys, qualifying_artists, song_key,
)


def test_thresholds():
    assert (MIN_COMMON_RATERS, MIN_COMMON_SONGS) == (3, 15)


def test_song_key_prefers_the_track_then_the_folded_title():
    assert song_key(7, "Nights") == 7
    assert song_key(None, " Nights ") == song_key(None, "nights") == "t:nights"


def test_a_key_needs_three_different_users_not_three_scores():
    pairs = [(7, 1), (7, 1), (7, 2),          # two users, three scores
             (8, 1), (8, 2), (8, 3),          # three users
             (None, 1), (None, 2), (None, 3)]  # no key never counts
    assert common_keys(pairs) == {8}


def test_an_artist_needs_fifteen_distinct_common_songs():
    assert qualifying_artists({"A": set(range(15)), "B": set(range(14))}) == {"A"}
