from types import SimpleNamespace as N
from backend.search_rank import fold, match_rank, albums_group, artists_group, songs_group, people_group

def a(id, user, name, artist, key, status="rated", score=8.0, extra=None, tracks=10):
    return N(id=id, user_id=user, album_name=name, artist=artist, subject_key=key, status=status,
             score=score, art_url=None, extra_artists=extra, track_count=tracks)

def test_fold_drops_accents_case_and_punctuation():
    assert fold("KAYTRAMINÉ") == "kaytramine"
    assert fold("  AC/DC ") == "ac dc"
    assert fold(None) == ""

def test_match_rank_orders_exact_prefix_word_contains():
    assert match_rank("blonde", "Blonde") == 0
    assert match_rank("blo", "Blonde") == 1
    assert match_rank("cre", "Tyler, The Creator") == 2
    assert match_rank("ond", "Blonde") == 3
    assert match_rank("xyz", "Blonde") is None
    assert match_rank("kaytramine", "KAYTRAMINÉ") == 0

def test_editions_are_one_row_and_my_copy_leads():
    cands = [a(1, 2, "Take Care", "Drake", "drake||take care", score=9.0),
             a(2, 3, "Take Care (Deluxe)", "Drake", "drake||take care", score=7.0),
             a(3, 1, "Take Care (Deluxe)", "Drake", "drake||take care", status="listening", score=None)]
    rows = albums_group("take care", cands, me=1, limit=4)
    assert len(rows) == 1
    assert rows[0]["album_id"] == 3 and rows[0]["mine"] and rows[0]["status"] == "listening"
    assert rows[0]["raters"] == 2 and rows[0]["pressd_avg"] == 8.0

def test_record_only_in_others_to_listen_is_left_out_but_singles_stay():
    cands = [a(1, 2, "Blonde", "Frank Ocean", "frank ocean||blonde", status="to_listen", score=None),
             a(2, 2, "Nights", "Frank Ocean", "frank ocean||nights", tracks=1)]
    rows = albums_group("n", cands, me=1, limit=4)
    assert [r["name"] for r in rows] == ["Nights"]

def test_collaboration_counts_for_each_artist():
    cands = [a(1, 2, "Heavy Is the Crown", "Anderson .Paak", "anderson paak||heavy is the crown",
               extra='["Cordae"]')]
    assert [r["name"] for r in artists_group("cordae", cands, me=1, limit=4)] == ["Cordae"]

def test_song_is_one_row_per_track_and_points_at_my_copy():
    s = lambda tid, title, aid, user, status="rated": N(track_id=tid, title=title, album_id=aid, album_name="Blonde",
        artist="Frank Ocean", subject_key="frank ocean||blonde", user_id=user, status=status, art_url=f"art{aid}")
    cands = [s(7, "Nights", 10, 2), s(7, "Nights", 11, 3), s(7, "NIGHTS", 12, 1, status="listening")]
    rows = songs_group("nights", cands, me=1, limit=4)
    assert len(rows) == 1 and rows[0]["album_id"] == 12 and rows[0]["mine"] and rows[0]["title"] == "Nights"
    # The cover is the pointed-at copy's.
    assert rows[0]["art_url"] == "art12"

def test_people_friends_first():
    rows = [{"id": 1, "name": "jackk", "already_friends": False, "request_sent": False, "request_received": False},
            {"id": 2, "name": "jack", "already_friends": True, "request_sent": False, "request_received": False}]
    assert [r["id"] for r in people_group("jack", rows, limit=4)] == [2, 1]

def test_unlinked_songs_are_left_out():
    s = lambda tid, aid: N(track_id=tid, title="Nights", album_id=aid, album_name="Blonde",
        artist="Frank Ocean", subject_key="frank ocean||blonde", user_id=1, status="rated", art_url=None)
    rows = songs_group("nights", [s(None, 10), s(None, 11), s(7, 12)], me=1, limit=4)
    assert [r["track_id"] for r in rows] == [7]
