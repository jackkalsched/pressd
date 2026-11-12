"""Bin records in the prediction catalog: their songs keyed as a copy's would be,
a song bin's song found on its album, and which bin records the catalog scores."""
import json

from backend.tracklink import bin_songs, copy_keys, song_position
from backend.trackkeys import album_key
from worker.catalog_predict import pick_bin_records


TRACKLIST = {
    "artist": "Kanye West", "album_name": "Late Registration", "extra_artists": [],
    "genre": "Hip-Hop/Rap", "year": 2005,
    "tracks": [
        {"title": "Wake Up Mr. West", "track_number": 1, "duration_ms": 41000},
        {"title": "Touch The Sky (feat. Lupe Fiasco)", "track_number": 4, "duration_ms": 236000,
         "artist": "Kanye West"},
        {"title": "Gold Digger (Album Version)", "track_number": 5, "duration_ms": 207000},
        {"title": "Gold Digger", "track_number": 6, "duration_ms": 207000},
    ],
}


def test_bin_songs_are_the_tracklist_by_position():
    songs = bin_songs(TRACKLIST, "Kanye West")
    assert [s.id for s in songs] == [0, 1, 2, 3]
    assert songs[0].artist == "Kanye West"          # no per-track credit → the entry's
    assert songs[1].duration_ms == 236000
    assert bin_songs({}, "x") == []


def test_bin_keys_match_a_copy_and_never_share_one_on_the_record():
    songs = bin_songs(TRACKLIST, "Kanye West")
    keys = copy_keys(songs, "Kanye West", None, "Late Registration")
    # "(Album Version)" folds into the song, so the two Gold Diggers meet on a
    # key — and the second on the record takes ||alt2, as a copy's would.
    assert keys[3] != keys[2]
    assert keys[2].endswith("||alt2") or keys[3].endswith("||alt2")
    assert len(set(keys.values())) == 4


def test_song_position_folds_feat_and_edition_tags():
    titles = [t["title"] for t in TRACKLIST["tracks"]]
    assert song_position("Touch the Sky", titles) == 1
    assert song_position("Gold Digger", titles) == 2     # the first that is the song
    assert song_position("Diamonds from Sierra Leone", titles) is None
    assert song_position(None, titles) is None
    assert song_position("Transparent Soul", ["Gaslight", "t r a n s p a r e n t s o u l"]) == 1
    assert song_position("B.O.B.", ["Intro", "B.O.B. (Bombs Over Baghdad)", "Xplosion"]) == 1
    # Opening two titles is no answer.
    assert song_position("Gold", ["Gold Digger", "Gold Rush"]) is None


def _row(eid, artist, name, subject, n, tl=TRACKLIST, year=None, cover=None):
    return (eid, artist, name, year, subject, cover, json.dumps(tl) if tl else None, n)


def test_pick_bin_records_skips_what_a_copy_covers_and_what_has_no_audio():
    copies = [{"album_key": album_key("Frank Ocean", "Blonde"), "subject_key": "frank ocean||blonde"}]
    rows = [
        _row(1, "Frank Ocean", "Blonde", "frank ocean||blonde", 17),            # a copy stands for it
        _row(2, "Kanye West", "Late Registration", "kanye west||late registration", 0),  # no audio yet
        _row(3, "Radiohead", "Kid A", "radiohead||kid a", 5, year=2000),
        _row(4, "Radiohead", "Kid A", "radiohead||kid a", 9),                   # same record, more audio
        _row(5, "Radiohead", "OK Computer", "radiohead||ok computer", 4),
    ]
    got = pick_bin_records(rows, copies)
    assert [r["bin_entry_id"] for r in got] == [4, 5]
    kid_a = got[0]
    assert kid_a["album_id"] == -4                       # never meets a real album id
    assert kid_a["album_key"] == album_key("Radiohead", "Kid A")
    assert kid_a["genre"] == "Hip-Hop"                   # canonical, from the stored resolve
    assert kid_a["year"] == 2005                         # the entry's own year, else the resolve's


def test_pick_bin_records_ties_go_to_the_earliest_entry():
    rows = [_row(8, "Radiohead", "Kid A", "radiohead||kid a", 3),
            _row(6, "Radiohead", "Kid A", "radiohead||kid a", 3)]
    assert [r["bin_entry_id"] for r in pick_bin_records(rows, [])] == [6]


def test_pick_bin_records_falls_back_to_the_artists_genre():
    alt = {**TRACKLIST, "genre": "Alternative"}       # a qualifier, not a genre
    rows = [_row(1, "Radiohead", "Kid A", "radiohead||kid a", 3, tl=alt),
            _row(2, "Bon Iver", "22, A Million", "bon iver||22 a million", 3, tl=alt)]
    got = {r["bin_entry_id"]: r["genre"] for r in pick_bin_records(rows, [], {"radiohead": "Rock"})}
    assert got == {1: "Rock", 2: None}
