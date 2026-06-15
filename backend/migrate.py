"""
One-time migration: Jack Kalsched Album Rankings.xlsx → pressd.db

Run from the Press'd directory:
    python -m backend.migrate
"""

import sys
import os
from datetime import date
from pathlib import Path

import pandas as pd
from sqlmodel import Session, select

# Allow running as a script from the Press'd root
sys.path.insert(0, str(Path(__file__).parent.parent))

from backend.database import engine, init_db
from backend.models import Album, Song
from backend.scoring import compute_a_score, compute_album_score

EXCEL_PATH = Path(__file__).parent.parent / "Jack Kalsched Album Rankings.xlsx"

FACTOR_LABELS = {"theme", "replay value", "production", "distinctness"}

SKIP_ARTIST_SHEETS = {"Record Ratings", "Year By Year", "Song Ratings", "More Data"}


def normalize(s: str) -> str:
    """Lowercase, replace & with 'and', strip punctuation for fuzzy matching."""
    import re
    s = s.lower().replace("&", "and")
    return re.sub(r"[^a-z0-9 ]", "", s).strip()


def clean_score(val) -> float | None:
    """Return a float score or None for blanks, '--', '#DIV/0!' etc."""
    if val is None:
        return None
    s = str(val).strip()
    if s in ("", "--", "nan", "#DIV/0!", "#DIV/0") or s.startswith("#"):
        return None
    try:
        f = float(s)
        return round(f, 4)
    except ValueError:
        return None


def parse_artist_sheet(df: pd.DataFrame) -> dict[str, dict]:
    """
    Each album occupies 3 columns: [song_name, score, spacer].
    Header row (row 0 of the df) contains 'Album (Year)' and its score.
    Subsequent rows: song titles + scores.
    Factor rows at the bottom: 'Theme', 'Replay Value', 'Production', 'Distinctness'.

    Returns dict keyed by album header string → {
        'score': float | None,
        'songs': [(title, score), ...],
        'theme': float | None, 'replay_value': float | None,
        'production': float | None, 'distinctness': float | None,
    }
    """
    albums = {}

    cols = list(df.columns)
    # Albums start at col 0, each group spans 3 columns
    for i in range(0, len(cols), 3):
        header_col = cols[i]
        score_col = cols[i + 1] if i + 1 < len(cols) else None

        header_str = str(header_col).strip()
        if not header_str or header_str == "nan" or header_str.startswith("Unnamed:") or header_str.startswith("#"):
            continue
        # Skip cells that are decimal numbers (score values leaked into header position)
        try:
            float(header_str)
            if '.' in header_str:
                continue
        except ValueError:
            pass

        album_score = clean_score(score_col)

        songs = []
        factors: dict[str, float | None] = {
            "theme": None, "replay_value": None,
            "production": None, "distinctness": None,
        }

        for _, row in df.iterrows():
            title_raw = row.iloc[i] if i < len(row) else None
            score_raw = row.iloc[i + 1] if i + 1 < len(row) else None

            title = str(title_raw).strip() if title_raw is not None and str(title_raw) != "nan" else None
            if not title:
                continue

            title_lower = title.lower()

            if title_lower == "theme":
                factors["theme"] = clean_score(score_raw)
            elif title_lower == "replay value":
                factors["replay_value"] = clean_score(score_raw)
            elif title_lower == "production":
                factors["production"] = clean_score(score_raw)
            elif title_lower == "distinctness":
                factors["distinctness"] = clean_score(score_raw)
            elif title_lower not in FACTOR_LABELS:
                score = clean_score(score_raw)
                songs.append((title, score))

        albums[header_str] = {
            "score": album_score,
            "songs": songs,
            **factors,
        }

    return albums


def parse_album_header(header: str) -> tuple[str, int | None]:
    """'good kid, m.A.A.d city (2012)' → ('good kid, m.A.A.d city', 2012)"""
    if "(" in header and header.endswith(")"):
        name = header[:header.rfind("(")].strip()
        year_str = header[header.rfind("(") + 1:-1].strip()
        try:
            return name, int(year_str)
        except ValueError:
            return header, None
    return header, None


def main():
    print(f"Reading {EXCEL_PATH}")
    xl = pd.ExcelFile(EXCEL_PATH)

    # ── 1. Read master Record Ratings for genre / sub-genre ──────────────────
    rr = xl.parse("Record Ratings")
    # Build lookup keyed by BOTH exact and normalized name for fuzzy matching
    master: dict[tuple[str, str], dict] = {}
    master_norm: dict[tuple[str, str], dict] = {}  # normalized keys
    for _, row in rr.iterrows():
        name = str(row.get("Album Name (Jack)", "")).strip()
        artist = str(row.get("Artist", "")).strip()
        if name and artist:
            entry = {
                "album_name": name,
                "artist": artist,
                "genre": str(row.get("Genre", "")).strip() or None,
                "sub_genre1": str(row.get("Sub-Genre", "")).strip() or None,
                "sub_genre2": str(row.get("Sub-Genre.1", "")).strip() or None,
                "score": clean_score(row.get("Score")),
                "year": int(row["Year"]) if pd.notna(row.get("Year")) else None,
                "theme": clean_score(row.get("Theme")),
                "replay_value": clean_score(row.get("Replay Value")),
                "production": clean_score(row.get("Production")),
                "distinctness": clean_score(row.get("Distinctness")),
            }
            # Clean "nan" strings
            for k in ("genre", "sub_genre1", "sub_genre2"):
                if entry[k] == "nan":
                    entry[k] = None
            master[(name.lower(), artist.lower())] = entry
            master_norm[(normalize(name), normalize(artist))] = entry

    print(f"  Master sheet: {len(master)} albums")

    # ── 2. Read Song Ratings for songs missing from artist sheets ─────────────
    sr = xl.parse("Song Ratings")
    song_lookup: dict[tuple[str, str], float] = {}  # (title_lower, album_lower) → score
    for _, row in sr.iterrows():
        title = str(row.get("Song", "")).strip()
        album = str(row.get("Album", "")).strip()
        score = clean_score(row.get("Score"))
        if title and album and score is not None:
            song_lookup[(title.lower(), album.lower())] = score

    print(f"  Song Ratings sheet: {len(song_lookup)} songs")

    # ── 3. Init DB ─────────────────────────────────────────────────────────────
    init_db()

    artist_sheets = [s for s in xl.sheet_names if s.strip() not in SKIP_ARTIST_SHEETS]
    print(f"  Artist sheets to parse: {len(artist_sheets)}")

    albums_created = 0
    songs_created = 0
    skipped = 0

    with Session(engine) as session:
        # Clear existing data
        existing_songs = session.exec(select(Song)).all()
        existing_albums = session.exec(select(Album)).all()
        for s in existing_songs:
            session.delete(s)
        for a in existing_albums:
            session.delete(a)
        session.commit()
        print("  Cleared existing data")

        for sheet_name in artist_sheets:
            artist_name = sheet_name.strip()
            try:
                df = xl.parse(sheet_name, header=0)
            except Exception as e:
                print(f"  ⚠ Could not parse sheet '{sheet_name}': {e}")
                continue

            album_data = parse_artist_sheet(df)

            for header, data in album_data.items():
                album_name, year = parse_album_header(header)
                if not album_name:
                    continue

                # Look up genre/meta — try exact then normalized name
                meta = (
                    master.get((album_name.lower(), artist_name.lower()))
                    or master_norm.get((normalize(album_name), normalize(artist_name)))
                    or {}
                )

                # Prefer master sheet score (it's the authoritative computed value)
                stored_score = meta.get("score") or data["score"]

                # Prefer canonical name from master sheet
                canon_name = meta.get("album_name") or album_name
                canon_artist = meta.get("artist") or artist_name
                canon_year = meta.get("year") or year

                # Prefer master sheet factors if artist sheet is missing them
                theme = data["theme"] or meta.get("theme")
                replay_value = data["replay_value"] or meta.get("replay_value")
                production = data["production"] or meta.get("production")
                distinctness = data["distinctness"] or meta.get("distinctness")

                album = Album(
                    album_name=canon_name,
                    artist=canon_artist,
                    year=canon_year,
                    status="rated" if stored_score is not None else "to_listen",
                    score=stored_score,
                    theme=theme,
                    replay_value=replay_value,
                    production=production,
                    distinctness=distinctness,
                    genre=meta.get("genre"),
                    sub_genre1=meta.get("sub_genre1"),
                    sub_genre2=meta.get("sub_genre2"),
                    date_added=date.today(),
                    date_rated=date.today() if stored_score is not None else None,
                )
                session.add(album)
                session.flush()  # get album.id

                track_number = 1
                for title, score in data["songs"]:
                    # Fall back to Song Ratings sheet if score missing
                    if score is None:
                        score = song_lookup.get((title.lower(), album_name.lower()))

                    a_score = compute_a_score(score) if score is not None else None

                    song = Song(
                        title=title,
                        track_number=track_number,
                        score=score,
                        a_score=a_score,
                        artist=artist_name,
                        album_id=album.id,
                    )
                    session.add(song)
                    track_number += 1
                    songs_created += 1

                albums_created += 1

        session.commit()

    # ── 4. Import any rated albums from master sheet not in artist sheets ──────
    with Session(engine) as session:
        existing_norm = {
            (normalize(a.album_name), normalize(a.artist))
            for a in session.exec(select(Album)).all()
        }

        extra = 0
        for (name_lower, artist_lower), meta in master.items():
            if (normalize(meta["album_name"]), normalize(meta["artist"])) in existing_norm:
                continue

            album = Album(
                album_name=meta["album_name"],
                artist=meta["artist"],
                year=meta.get("year"),
                status="rated" if meta.get("score") else "to_listen",
                score=meta.get("score"),
                theme=meta.get("theme"),
                replay_value=meta.get("replay_value"),
                production=meta.get("production"),
                distinctness=meta.get("distinctness"),
                genre=meta.get("genre"),
                sub_genre1=meta.get("sub_genre1"),
                sub_genre2=meta.get("sub_genre2"),
                date_added=date.today(),
                date_rated=date.today() if meta.get("score") else None,
            )
            session.add(album)
            extra += 1
            albums_created += 1

        session.commit()
        if extra:
            print(f"  Added {extra} albums from master sheet not in artist sheets")

    print(f"\n✓ Migration complete")
    print(f"  Albums: {albums_created}")
    print(f"  Songs:  {songs_created}")


if __name__ == "__main__":
    main()
