"""The upcoming-releases build (backend/upcoming_releases.py): parsing Wikipedia
and ListenBrainz, merging them, ordering, and what the endpoint serves. No
network and no database."""
from datetime import date

from backend.trackkeys import artist_key

from backend.upcoming_releases import (
    NOTABLE_LISTENERS, mark_notable_by_listeners, merge, order, parse_listenbrainz, parse_wikitext, select_upcoming, wiki_text, wikipedia_titles,
)

WIKITEXT = """
{| class="wikitable plainrowheaders"
|-
! scope="col" | Release date
! scope="col" | Artist
|-
! scope="row" rowspan="2" style="text-align: center;" | November<br>13
| [[Aesop Rock]] and [[Blockhead (music producer)|Blockhead]]
| ''Trouble Mountain''
| [[Hip-hop]]
| [[Rhymesayers Entertainment|Rhymesayers]]
| <ref>{{cite web |url=https://x |title=Aesop Rock ''announces'' |date=July 14, 2026}}</ref>
|-
| [[Ateez]]
| ''[[Golden Hour: Part.6]]''
|
| Sony Music Korea, [[RCA Records|RCA]]
| <ref name="a" />
|-
! scope="row" style="text-align: center;" | December<br>TBA
| Somebody
| ''Undated''
|-
! scope="row" style="text-align: center;" | December<br>4
| [[Bicep (duo)|Bicep]] || ''SLUG'' || Electronic || Ninja Tune
|}
"""


def lb(name, artist, day, kind="Album", secondary=None, group=None, caa=True):
    return {"release_name": name, "artist_credit_name": artist, "release_date": day,
            "release_group_primary_type": kind, "release_group_secondary_type": secondary,
            "release_group_mbid": group or f"g-{name}", "release_mbid": f"r-{name}",
            "caa_id": 1 if caa else None, "caa_release_mbid": "m" if caa else None,
            "release_tags": ["rock", "indie", "a", "b", "c", "d"]}


def test_wiki_text_reduces_markup_to_what_shows():
    assert wiki_text("[[Bicep (duo)|Bicep]]") == "Bicep"
    assert wiki_text("''[[Golden Hour: Part.6]]''") == "Golden Hour: Part.6"
    assert wiki_text("Sony <ref>{{cite web |x=1}}</ref>&amp; [[RCA Records|RCA]]") == "Sony & RCA"


def test_parse_wikitext_dates_rows_and_skips_undated():
    rows = parse_wikitext(WIKITEXT, 2026)
    assert [(r["release_date"], r["artist"], r["title"]) for r in rows] == [
        ("2026-11-13", "Aesop Rock and Blockhead", "Trouble Mountain"),
        ("2026-11-13", "Ateez", "Golden Hour: Part.6"),       # second row of the day, no header
        ("2026-12-04", "Bicep", "SLUG"),                      # cells on one line, split on ||
    ]
    assert rows[0]["genre"] == "Hip-hop" and rows[0]["label"] == "Rhymesayers"
    assert rows[1]["genre"] == "" and rows[1]["label"] == "Sony Music Korea, RCA"


def test_wikipedia_titles_cover_this_year_and_next():
    assert [t for t, _ in wikipedia_titles(date(2026, 11, 10))] == [
        "List of 2026 albums (July–December)", "List of 2027 albums", "List of 2027 albums (January–June)"]
    assert wikipedia_titles(date(2026, 3, 1))[0] == ("List of 2026 albums (January–June)", 2026)


def test_parse_listenbrainz_one_row_per_release_group_and_known_types():
    rows = parse_listenbrainz([
        lb("A", "X", "2026-11-20"),
        lb("A", "X", "2026-11-20", group="g-A"),        # another edition of the same group
        lb("Live", "X", "2026-11-21", secondary="Live"),
        lb("Thing", "Y", "2026-11-22", kind="Broadcast"),
        lb("S", "Z", "2026-11-23T00:00:00", kind="Single", caa=False),
    ])
    assert [(r["title"], r["type"], r["secondary"]) for r in rows] == [
        ("A", "album", None), ("Live", "album", "live"), ("S", "single", None)]
    assert rows[0]["cover_url"] and rows[2]["cover_url"] is None
    assert rows[2]["release_date"] == "2026-11-23" and len(rows[0]["tags"]) == 5


def test_merge_marks_notable_and_adds_what_listenbrainz_missed():
    rows = merge(
        parse_listenbrainz([lb("Trouble Mountain", "Aesop Rock & Blockhead", "2026-11-13"),
                            lb("Other", "Q", "2026-11-14")]),
        [{"release_date": "2026-11-12", "artist": "Aesop Rock", "title": "Trouble Mountain",
          "genre": "Hip-hop", "label": "Rhymesayers"},
         {"release_date": "2026-11-20", "artist": "Teddy Swims", "title": "UGLY", "genre": "", "label": "Warner"}])
    by = {r["title"]: r for r in rows}
    tm = by["Trouble Mountain"]
    assert tm["notable"] and tm["notable_by"] == "wikipedia" and tm["sources"] == ["listenbrainz", "wikipedia"]
    assert tm["release_date"] == "2026-11-13"          # MusicBrainz's exact date wins
    assert tm["label"] == "Rhymesayers" and tm["genre"] == "Hip-hop"
    assert not by["Other"]["notable"]
    ugly = by["UGLY"]
    assert ugly["notable"] and ugly["sources"] == ["wikipedia"] and ugly["type"] == "album"
    assert ugly["genre"] is None and ugly["label"] == "Warner" and ugly["key"]


def test_order_by_date_then_notable_then_listeners():
    base = {"secondary": None}
    rows = [
        {**base, "release_date": "2026-11-14", "notable": False, "artist_listeners": 9, "artist": "a"},
        {**base, "release_date": "2026-11-13", "notable": False, "artist_listeners": 900, "artist": "b"},
        {**base, "release_date": "2026-11-13", "notable": True, "artist_listeners": 5, "artist": "c"},
        {**base, "release_date": "2026-11-13", "notable": True, "artist_listeners": None, "artist": "d"},
    ]
    assert [r["artist"] for r in order(rows)] == ["c", "d", "b", "a"]


def test_select_upcoming_filters_and_flags_library_artists():
    rows = merge(parse_listenbrainz([
        lb("Out", "A", "2026-11-10"),                       # out today: not upcoming
        lb("Soon", "Frank Ocean", "2026-11-12"),
        lb("Single", "B", "2026-11-13", kind="Single"),
        lb("Live", "C", "2026-11-14", secondary="Live"),
        lb("Far", "D", "2027-03-01"),
    ]), [{"release_date": "2026-11-15", "artist": "E", "title": "Notable", "genre": "", "label": ""}])
    today = date(2026, 11, 10)
    lib = {artist_key("Frank Ocean")}
    got = select_upcoming(rows, today, 90, {"album", "ep", "single"}, False, False, lib)
    assert [r["title"] for r in got] == ["Soon", "Single", "Notable"]
    assert got[0]["artist_in_library"] and not got[1]["artist_in_library"]
    assert [r["title"] for r in select_upcoming(rows, today, 90, {"album"}, False, False, lib)] == ["Soon", "Notable"]
    assert [r["title"] for r in select_upcoming(rows, today, 90, {"album"}, True, False, lib)] == ["Notable"]
    assert "Live" in [r["title"] for r in select_upcoming(rows, today, 90, {"album"}, False, True, lib)]
    assert "Far" in [r["title"] for r in select_upcoming(rows, today, 180, {"album"}, False, False, lib)]


def test_big_artists_albums_are_notable_off_wikipedia():
    rows = merge(parse_listenbrainz([
        lb("SUIATSU", "Stray Kids", "2026-11-20"),
        lb("Live at X", "Stray Kids", "2026-11-21", secondary="Live"),
        lb("A Single", "Stray Kids", "2026-11-22", kind="Single"),
        lb("Small", "Nobody", "2026-11-23"),
        lb("Listed", "Tiny Band", "2026-11-24"),
    ]), [{"release_date": "2026-11-24", "artist": "Tiny Band", "title": "Listed", "genre": "", "label": ""}])
    for r in rows:
        r["artist_listeners"] = {"Stray Kids": 1_200_000, "Nobody": NOTABLE_LISTENERS - 1, "Tiny Band": 900}[r["artist"]]
    assert mark_notable_by_listeners(rows) == 1
    by = {r["title"]: (r["notable"], r["notable_by"]) for r in rows}
    assert by == {"SUIATSU": (True, "listeners"),
                  "Live at X": (False, None),       # a live album isn't the record
                  "A Single": (False, None),        # nor is a single
                  "Small": (False, None),           # one listener short
                  "Listed": (True, "wikipedia")}    # Wikipedia's rule keeps its own reason
