"""Bins (backend/bins.py): a caller's progress through a bin, what an entry's
copy is made from, the list files, and which catalog release a list row means.
No network and no database."""
import json
from types import SimpleNamespace as NS

import pytest

from backend.trackkeys import subject_key_album
from backend.bins import (
    best_copies, copy_data, parse_list_csv, parse_list_meta, pick_release, pick_song_release, progress, song_states,
)


def copy(id, key, status, score=None):
    return NS(id=id, subject_key=key, status=status, score=score)


def entry(key, tracks=True, artist="A", name="N"):
    return NS(subject_key=key, tracklist_json=json.dumps({"album_name": "x", "artist": "y", "tracks": [1]}) if tracks else None,
              artist=artist, album_name=name)


def test_best_copy_is_the_most_finished_edition():
    mine = best_copies([copy(1, "a", "to_listen"), copy(2, "a", "rated", 8.1), copy(3, "b", "listening"),
                        copy(4, "b", "to_listen"), copy(5, None, "rated")])
    assert mine == {"a": {"id": 2, "status": "rated", "score": 8.1},
                    "b": {"id": 3, "status": "listening", "score": None}}


def test_progress_counts_each_entry():
    states = [{"status": "rated"}, {"status": "listening"}, {"status": "to_listen"}, None]
    assert progress(states) == {"rated": 1, "listening": 1, "to_listen": 1, "total": 4}


def test_copy_data_takes_the_entrys_name_and_the_chosen_status():
    data = copy_data(entry("k", artist="Prince", name="Purple Rain"), "listening")
    assert (data["artist"], data["album_name"], data["status"], data["tracks"]) == ("Prince", "Purple Rain", "listening", [1])


def test_list_files():
    rows = parse_list_csv('rank,artist,title,year\n2,B,"Good Kid, M.A.A.D City",2012\n1,A,X,\n')
    assert [(r.rank, r.title, r.year) for r in rows] == [(1, "X", None), (2, "Good Kid, M.A.A.D City", 2012)]
    with pytest.raises(ValueError):
        parse_list_csv("rank,artist,title,year\n1,A,X,1\n1,B,Y,2\n")
    meta = parse_list_meta('{"slug": "apple-100", "title": "T", "source_published": "2024-05-22"}')
    assert meta.slug == "apple-100" and meta.source_published.year == 2024
    with pytest.raises(ValueError):
        parse_list_meta('{"slug": "Bad Slug", "title": "T"}')


def hit(id, title, artist, year=None, record_type="album", nb_tracks=10):
    return {"id": id, "title": title, "artist": artist, "year": year, "record_type": record_type, "nb_tracks": nb_tracks}


def test_pick_release_prefers_the_artist_and_the_standard_edition():
    hits = [
        hit(1, "Revolver", "The Beatles Complete On Ukulele", 2020, nb_tracks=15),
        hit(2, "Revolver (Super Deluxe)", "The Beatles", 2022, nb_tracks=63),
        hit(3, "Revolver (Remastered 2009)", "The Beatles", 2009, nb_tracks=14),
    ]
    assert pick_release("Revolver", "The Beatles", 1966, hits) == (hits[2], "matched")


def test_pick_release_refuses_singles_and_other_records():
    hits = [hit(1, "Hotel California", "Eagles Experience", record_type="single", nb_tracks=1),
            hit(2, "Hotel California", "Someone Else")]
    assert pick_release("Hotel California", "Eagles", 1976, hits) == (None, "unmatched")


def test_pick_release_doubts_an_earlier_year_and_a_partial_credit():
    assert pick_release("X", "A", 2010, [hit(1, "X", "A", 2001)])[1] == "doubtful"
    assert pick_release("X", "A", 2010, [hit(1, "X", "A", 2020)])[1] == "matched"     # a reissue
    assert pick_release("Purple Rain", "Prince and the Revolution", 1984,
                        [hit(1, "Purple Rain", "Prince", 2005)])[1] == "doubtful"


def test_pick_release_takes_an_ep_over_a_deluxe_album():
    hits = [hit(1, "The Fame Monster (Deluxe Edition)", "Lady Gaga", 2009, nb_tracks=22),
            hit(2, "The Fame Monster", "Lady Gaga", 2009, record_type="ep", nb_tracks=8)]
    assert pick_release("The Fame Monster", "Lady Gaga", 2009, hits)[0]["id"] == 2


def song(track_title, album_title, artist="Yeah Yeah Yeahs", album_artist=None, record_type="album", nb_tracks=11, year=2003, album_id=1):
    return {"track_title": track_title, "album_title": album_title, "artist": artist,
            "album_artist": album_artist or artist, "record_type": record_type, "nb_tracks": nb_tracks,
            "year": year, "album_id": album_id}


def test_pick_song_release_takes_the_studio_album():
    hits = [
        song("Maps (Live)", "Live at the Hollywood Bowl", album_id=1),
        song("Maps", "Greatest Hits", year=2010, nb_tracks=20, album_id=2),
        song("Maps", "Now That's Rock", album_artist="Various Artists", album_id=3),
        song("Maps", "Maps", record_type="single", nb_tracks=1, album_id=4),
        song("Maps", "Fever To Tell", year=2017, nb_tracks=12, album_id=5),
    ]
    best, status = pick_song_release("Maps", "Yeah Yeah Yeahs", 2003, hits)
    assert best["album_id"] == 5 and status == "matched"      # a reissue's later date is no doubt


def test_pick_song_release_falls_back_to_the_single_and_refuses_others():
    hits = [song("Ocean Avenue", "Ocean Avenue", artist="Yellowcard", record_type="single", nb_tracks=2, album_id=9),
            song("Ocean Avenue", "Covers", artist="Tribute Band", album_id=10)]
    assert pick_song_release("Ocean Avenue", "Yellowcard", 2003, hits)[0]["album_id"] == 9
    assert pick_song_release("Nothing", "Yellowcard", 2003, hits) == (None, "unmatched")


def test_song_states_scores_and_progress():
    entry = NS(subject_key="yyy||fever to tell", song_title="Maps")
    rows = [
        NS(user_id=1, album_id=10, subject_key="yyy||fever to tell", status="rated", title="Maps", score=9.0, track_id=7),
        NS(user_id=2, album_id=11, subject_key="yyy||fever to tell", status="listening", title="Maps (Remastered)", score=7.0, track_id=7),
        NS(user_id=3, album_id=12, subject_key="yyy||fever to tell", status="to_listen", title="Maps", score=None, track_id=7),
        NS(user_id=3, album_id=12, subject_key="yyy||fever to tell", status="to_listen", title="Y Control", score=None, track_id=8),
    ]
    mine1, mine3, mine4 = (song_states([entry], rows, me)[0] for me in (1, 3, 4))
    assert mine1 == {"mine": {"id": 10, "status": "rated", "score": 9.0}, "pressd_avg": 8.0, "pressd_raters": 2, "track_id": 7}
    assert mine3["mine"] == {"id": 12, "status": "to_listen", "score": None}
    assert mine4["mine"] is None


# ── The router's pure parts (backend/routers/bins.py) ─────────────────────────

def _bin(**kw):
    base = dict(slug="u-abc", title="T", kind="user", item_type="album", ranked=True, source_name=None,
                source_url=None, source_published=None, entry_count=0, visibility="private",
                owner_id=5, cover_url=None)
    return NS(**{**base, **kw})


def test_card_marks_ownership():
    from backend.routers.bins import _card
    owner = NS(id=5, name="jack", avatar_url=None, bio=None, email="secret@x")
    mine = _card(_bin(), [], [], 5, owner=owner)
    assert mine["can_edit"] is True
    assert mine["owner"] == {"id": 5, "name": "jack", "avatar_url": None, "bio": None}
    assert _card(_bin(), [], [], 6, owner=owner)["can_edit"] is False
    gone = _card(_bin(owner_id=None, visibility="published"), [], [], 6)
    assert gone["owner"] is None and gone["can_edit"] is False
    curated = _card(_bin(kind="curated", owner_id=None, visibility="published"), [], [], 5)
    assert curated["can_edit"] is False and curated["owner"] is None
    assert {"kind", "visibility", "cover_url"} <= set(mine)


def test_reorder_rejects_stale_lists():
    from fastapi import HTTPException
    from backend.routers.bins import checked_order
    assert checked_order([1, 2, 3], [3, 1, 2]) == [3, 1, 2]
    for bad in ([1, 2], [1, 2, 3, 4], [1, 1, 2], []):
        with pytest.raises(HTTPException) as e:
            checked_order([1, 2, 3], bad)
        assert e.value.status_code == 400


def test_routes_exist():
    import inspect
    from backend.routers.bins import list_bins, router
    paths = {r.path for r in router.routes}
    assert {"/bins/{slug}/entries", "/bins/{slug}/order", "/bins/{slug}/cover", "/bins/{slug}/report"} <= paths
    assert "scope" in inspect.signature(list_bins).parameters


def test_entry_from_release_keeps_the_resolve_shape():
    from backend.routers.bins import entry_fields
    release = {"album_name": "Blonde", "artist": "Frank Ocean", "year": 2016, "cover_url": "c",
               "deezer_id": "123", "genre": "R&B", "tracks": [{"title": "Nikes"}] * 17}
    f = entry_fields(release)
    assert f["artist"] == "Frank Ocean" and f["album_name"] == "Blonde" and f["year"] == 2016
    assert f["deezer_id"] == 123 and f["cover_url"] == "c"
    assert f["subject_key"] == subject_key_album("Frank Ocean", "Blonde")
    # The stored tracklist is the resolve itself, so a bin's Add makes the copy from it.
    assert copy_data(NS(tracklist_json=f["tracklist_json"], artist=f["artist"], album_name=f["album_name"]),
                     "listening")["tracks"][0]["title"] == "Nikes"
    with pytest.raises(ValueError):
        entry_fields({"album_name": "", "artist": "x", "tracks": []})


def test_release_refusal():
    from datetime import date, timedelta
    from backend.routers.bins import release_refusal
    today = date(2026, 11, 13)
    ten = [{"title": str(i)} for i in range(10)]
    assert release_refusal({"tracks": ten, "album_name": "X"}, today) is None
    assert release_refusal({"tracks": ten, "album_name": "X",
                            "release_date": (today + timedelta(days=3)).isoformat()}, today) == "unreleased"
    assert release_refusal({"tracks": ten, "album_name": "X", "year": 2027}, today) == "unreleased"
    assert release_refusal({"tracks": ten[:2], "album_name": "X"}, today) == "single"
    assert release_refusal({"tracks": ten, "album_name": "X - Single"}, today) == "single"
    assert release_refusal({"tracks": [], "album_name": "X"}, today) == "single"


def test_release_from_copy():
    from datetime import date
    from backend.routers.bins import release_from_copy
    album = NS(album_name="N", artist="A", extra_artists='["B"]', year=2020, release_date=date(2020, 5, 1),
               album_art_url="art", total_tracks=2, genre="Rock")
    songs = [NS(title="two", track_number=2, duration_ms=1000, explicit=False, artist="A"),
             NS(title="one", track_number=1, duration_ms=None, explicit=True, artist="A")]
    r = release_from_copy(album, songs)
    assert [t["title"] for t in r["tracks"]] == ["one", "two"]
    assert r["extra_artists"] == ["B"] and r["release_date"] == "2020-05-01" and r["cover_url"] == "art"


def test_a_malformed_release_is_refused_before_it_is_stored():
    from backend.routers.bins import MAX_RELEASE_TRACKS, clean_release, entry_fields
    base = {"album_name": "N", "artist": "A"}
    for tracks in (["a", "b", "c"], [{"title": ""}], [{"title": 5}], [{"title": "x", "duration_ms": "x"}],
                   [{"title": "x", "track_number": [1]}], [{"title": "x"}] * (MAX_RELEASE_TRACKS + 1)):
        with pytest.raises(ValueError):
            entry_fields({**base, "tracks": tracks})
    with pytest.raises(ValueError):
        clean_release("not a dict")
    r = clean_release({**base, "junk": {"x": 1}, "extra_artists": ["B", 3],
                       "tracks": [{"title": " s ", "track_number": "2", "duration_ms": 1500.0, "artist": None,
                                   "evil": "y"}]})
    assert r["tracks"] == [{"title": "s", "track_number": 2, "duration_ms": 1500, "explicit": False,
                            "spotify_id": None, "artist": "A"}]
    assert "junk" not in r and r["extra_artists"] == ["B"]
    # What is stored is what tracklink.bin_songs reads without a surprise.
    from backend.tracklink import bin_songs
    songs = bin_songs(json.loads(entry_fields({**base, "tracks": r["tracks"]})["tracklist_json"]), "A")
    assert songs[0].track_number == 2 and songs[0].duration_ms == 1500
