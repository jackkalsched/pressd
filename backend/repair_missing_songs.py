"""
Repair: link songs from the Excel Song Ratings sheet to rated albums that have 0 songs.

Run from the Press'd directory:
    python -m backend.repair_missing_songs
"""

import sys
import re
from pathlib import Path

import pandas as pd
from sqlmodel import Session, select

sys.path.insert(0, str(Path(__file__).parent.parent))

from backend.database import engine
from backend.models import Album, Song
from backend.scoring import compute_a_score

EXCEL_PATH = Path(__file__).parent.parent / "Jack Kalsched Album Rankings.xlsx"


def normalize(s: str) -> str:
    s = s.lower().replace("&", "and")
    return re.sub(r"[^a-z0-9 ]", "", s).strip()


def strip_year(name: str) -> str:
    """Remove trailing ' (YYYY)' from album name."""
    return re.sub(r"\s*\(\d{4}\)\s*$", "", name).strip()


def clean_score(val) -> float | None:
    if val is None:
        return None
    s = str(val).strip()
    if s in ("", "--", "nan", "#DIV/0!", "#DIV/0") or s.startswith("#"):
        return None
    try:
        return round(float(s), 4)
    except ValueError:
        return None


def main():
    print(f"Reading {EXCEL_PATH}")
    xl = pd.ExcelFile(EXCEL_PATH)
    sr = xl.parse("Song Ratings")

    # Build lookup: normalized_album_name → list of (title, score, artist, order)
    song_map: dict[str, list[tuple[str, float | None, str, int]]] = {}
    for i, row in sr.iterrows():
        title = str(row.get("Song", "")).strip()
        album = str(row.get("Album", "")).strip()
        artist = str(row.get("Artist", "")).strip()
        score = clean_score(row.get("Score"))
        if title and album and title != "nan" and album != "nan":
            key = normalize(album)
            if key not in song_map:
                song_map[key] = []
            song_map[key].append((title, score, artist, int(i)))

    with Session(engine) as session:
        # Find all rated albums with 0 songs
        all_albums = session.exec(select(Album)).all()
        albums_with_songs = {
            s.album_id for s in session.exec(select(Song)).all()
        }
        empty_rated = [
            a for a in all_albums
            if a.status == "rated" and a.id not in albums_with_songs
        ]

        print(f"Rated albums with 0 songs: {len(empty_rated)}")

        total_songs = 0
        fixed = 0
        skipped = []

        for album in empty_rated:
            # Try exact normalized match first, then strip trailing year
            key = normalize(album.album_name)
            songs = song_map.get(key)
            if songs is None:
                key_stripped = normalize(strip_year(album.album_name))
                songs = song_map.get(key_stripped)

            if not songs:
                skipped.append(album)
                continue

            # Sort by original row order so track numbers are preserved
            songs_sorted = sorted(songs, key=lambda x: x[3])

            for track_num, (title, score, artist, _) in enumerate(songs_sorted, start=1):
                a_score = compute_a_score(score) if score is not None else None
                session.add(Song(
                    title=title,
                    track_number=track_num,
                    score=score,
                    a_score=a_score,
                    artist=artist or album.artist,
                    album_id=album.id,
                ))
                total_songs += 1

            fixed += 1
            print(f"  ✓ {album.artist} — {album.album_name}: {len(songs_sorted)} songs")

        session.commit()

    print(f"\n✓ Repair complete: fixed {fixed} albums, inserted {total_songs} songs")
    if skipped:
        print(f"\n⚠ Could not find songs for {len(skipped)} albums:")
        for a in skipped:
            print(f"  [{a.id}] {a.artist} — {a.album_name}")


if __name__ == "__main__":
    main()
