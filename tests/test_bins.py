"""Bins (backend/bins.py): a caller's progress through a bin, what an entry's
copy is made from, the list files, and which catalog release a list row means.
No network and no database."""
import json
from types import SimpleNamespace as NS

import pytest

from backend.bins import (
    best_copies, copy_data, parse_list_csv, parse_list_meta, pick_release, progress,
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
    mine = {"a": {"status": "rated"}, "b": {"status": "listening"}, "c": {"status": "to_listen"}}
    assert progress(["a", "b", "c", "d"], mine) == {"rated": 1, "listening": 1, "to_listen": 1, "total": 4}


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
