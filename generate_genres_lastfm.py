"""
Generate / override album genres and subgenres using Last.fm tags.
Tags are pulled from cached corpus JSON files first, then live Last.fm API.

Usage:
    python generate_genres_lastfm.py              # override all
    python generate_genres_lastfm.py --dry-run    # print without writing
    python generate_genres_lastfm.py --album-id 5 # single album
"""

import argparse
import json
import os
import re
import sys
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

CORPUS_DIR = Path(__file__).parent / "corpus"

# ── Tag → Canonical Genre ────────────────────────────────────────────────────

TAG_TO_GENRE: dict[str, str] = {
    # Hip-Hop
    "hip hop": "Hip-Hop", "hip-hop": "Hip-Hop", "rap": "Hip-Hop",
    "trap": "Hip-Hop", "drill": "Hip-Hop", "boom bap": "Hip-Hop",
    "conscious hip hop": "Hip-Hop", "pop rap": "Hip-Hop",
    "jazz rap": "Hip-Hop", "cloud rap": "Hip-Hop",
    "abstract hip hop": "Hip-Hop", "experimental hip hop": "Hip-Hop",
    "east coast hip hop": "Hip-Hop", "west coast hip hop": "Hip-Hop",
    "gangsta rap": "Hip-Hop", "alternative hip hop": "Hip-Hop",
    "hip hop & rap": "Hip-Hop", "crunk": "Hip-Hop",

    # R&B / Soul
    "r&b": "R&B", "rnb": "R&B", "soul": "R&B",
    "neo soul": "R&B", "neo-soul": "R&B",
    "alternative r&b": "R&B", "alternative rnb": "R&B",
    "contemporary r&b": "R&B", "quiet storm": "R&B",
    "rhythm and blues": "R&B",

    # Pop
    "pop": "Pop", "indie pop": "Pop", "synth-pop": "Pop",
    "electropop": "Pop", "chamber pop": "Pop",
    "baroque pop": "Pop", "dream pop": "Pop",
    "teen pop": "Pop", "power pop": "Pop", "art pop": "Pop",
    "hyperpop": "Pop",

    # Rock / Alternative
    "rock": "Rock", "indie rock": "Rock", "alternative": "Rock",
    "alternative rock": "Rock", "punk": "Rock", "post-punk": "Rock",
    "post-rock": "Rock", "shoegaze": "Rock", "grunge": "Rock",
    "psychedelic rock": "Rock", "garage rock": "Rock",
    "math rock": "Rock", "emo": "Rock", "indie": "Rock",
    "hard rock": "Rock", "metal": "Rock", "punk rock": "Rock",
    "noise rock": "Rock", "folk rock": "Rock",

    # Electronic
    "electronic": "Electronic", "edm": "Electronic",
    "house": "Electronic", "techno": "Electronic",
    "ambient": "Electronic", "experimental electronic": "Electronic",
    "idm": "Electronic", "electronica": "Electronic",
    "lo-fi": "Electronic", "chillwave": "Electronic",
    "synthwave": "Electronic", "vaporwave": "Electronic",
    "dnb": "Electronic", "drum and bass": "Electronic",

    # Folk
    "folk": "Folk", "indie folk": "Folk",
    "freak folk": "Folk", "anti-folk": "Folk",
    "chamber folk": "Folk", "contemporary folk": "Folk",

    # Singer-Songwriter
    "singer-songwriter": "Singer-Songwriter",
    "singer songwriter": "Singer-Songwriter",

    # Country
    "country": "Country", "country pop": "Country",
    "alt-country": "Country", "americana": "Country",

    # Jazz
    "jazz": "Jazz", "jazz fusion": "Jazz", "smooth jazz": "Jazz",
    "nu jazz": "Jazz", "free jazz": "Jazz",

    # Latin
    "latin": "Latin", "reggaeton": "Latin", "latin pop": "Latin",
    "bachata": "Latin", "salsa": "Latin", "latin trap": "Latin",

    # Afrobeats
    "afrobeats": "Afrobeats", "afropop": "Afrobeats",
    "afro pop": "Afrobeats", "highlife": "Afrobeats",
    "afro-pop": "Afrobeats",

    # Classical / Soundtrack
    "classical": "Classical", "orchestral": "Classical",
    "film score": "Classical", "soundtrack": "Classical",
    "neo-classical": "Classical",

    # Funk / Disco / Blues / Gospel
    "funk": "Funk", "disco": "Disco", "funk rock": "Funk",
    "blues": "Blues", "gospel": "Gospel",
}

# Tags that make good subgenres (more specific than parent genre)
SUBGENRE_PRIORITY: list[str] = [
    # Hip-Hop subgenres
    "jazz rap", "cloud rap", "conscious hip hop", "trap", "drill",
    "boom bap", "abstract hip hop", "gangsta rap", "alternative hip hop",
    "pop rap", "experimental hip hop", "east coast hip hop",
    "west coast hip hop",
    # R&B subgenres
    "neo soul", "neo-soul", "alternative r&b", "alternative rnb",
    # Pop subgenres
    "indie pop", "synth-pop", "chamber pop", "dream pop",
    "baroque pop", "art pop", "hyperpop", "electropop",
    # Rock subgenres
    "shoegaze", "post-punk", "post-rock", "emo", "math rock",
    "psychedelic rock", "garage rock", "grunge", "noise rock",
    "folk rock", "indie rock",
    # Electronic subgenres
    "ambient", "idm", "house", "techno", "chillwave",
    "synthwave", "vaporwave", "dnb",
    # Folk/other
    "indie folk", "chamber folk", "singer-songwriter",
    "jazz fusion", "nu jazz",
    "latin pop", "reggaeton", "latin trap",
    "afropop",
]

NOISE_PATTERNS = [
    r'^\d{4}s?$',
    r'^best of',
    r'albums.*(own|have|listened|heard)',
    r'^favorite',
    r'^10k',
    r'^melhores',
    r'^seen live',
    r'^good',
    r'^loved',
    r'^love',
    r'^classic',
    r'^awesome',
    r'^i (own|have|like)',
]


def normalize(tag: str) -> str:
    return tag.lower().strip()


def is_noise(tag: str) -> bool:
    t = normalize(tag)
    return any(re.search(p, t) for p in NOISE_PATTERNS)


def infer_genres(tags: list[str]) -> tuple[str | None, list[str]]:
    """Return (canonical_genre, [subgenre1, subgenre2, subgenre3])."""
    genre_votes: dict[str, int] = defaultdict(int)
    subgenres_found: list[str] = []
    seen_subgenres: set[str] = set()

    for raw in tags:
        if is_noise(raw):
            continue
        t = normalize(raw)
        if t in TAG_TO_GENRE:
            genre_votes[TAG_TO_GENRE[t]] += 1

    # Collect subgenres in priority order
    for sub in SUBGENRE_PRIORITY:
        for raw in tags:
            if normalize(raw) == sub and sub not in seen_subgenres:
                subgenres_found.append(raw)
                seen_subgenres.add(sub)
                break
        if len(subgenres_found) == 3:
            break

    top_genre = max(genre_votes, key=genre_votes.get) if genre_votes else None
    return top_genre, subgenres_found[:3]


def _fetch_artist_tags(artist: str) -> list[str]:
    """Fetch top tags for an artist from Last.fm."""
    try:
        from theme_predictor.corpus import LASTFM_KEY
        import pylast
        network = pylast.LastFMNetwork(api_key=LASTFM_KEY)
        tags = [t.item.name for t in (network.get_artist(artist).get_top_tags(limit=10) or [])]
        return tags
    except Exception:
        return []


def get_tags_for_album(album_id: int, artist: str, album_name: str) -> list[str]:
    """Get tags from corpus cache → album Last.fm → normalized album name → artist Last.fm."""
    slug = f"{artist}_{album_name}".replace("/", "-").replace("\\", "-").replace(" ", "_")
    slug = "".join(c for c in slug if c.isalnum() or c in "-_")[:120]
    path = CORPUS_DIR / f"{slug}.json"

    if path.exists():
        data = json.loads(path.read_text())
        tags = data.get("lastfm_tags", [])
        if tags:
            return tags

    try:
        from theme_predictor.corpus import fetch_lastfm

        # Try exact album name first
        tags = fetch_lastfm(artist, album_name).get("tags", [])
        if tags:
            return tags

        # Try title-cased / lowercased album name (catches ALL-CAPS mismatches)
        normalized = album_name.title()
        if normalized != album_name:
            tags = fetch_lastfm(artist, normalized).get("tags", [])
            if tags:
                return tags

        # Fall back to artist-level tags
        return _fetch_artist_tags(artist)

    except Exception:
        return []


GENRE_LIST = [
    "Hip-Hop", "R&B", "Pop", "Rock", "Electronic", "Folk",
    "Singer-Songwriter", "Country", "Jazz", "Latin", "Afrobeats",
    "Classical", "Funk", "Disco", "Blues", "Gospel",
]


def classify_genre_claude(artist: str, album_name: str, year: int | None) -> tuple[str | None, list[str]]:
    """Use Claude Haiku to classify main genre + up to 3 subgenres."""
    import anthropic
    client = anthropic.Anthropic()
    year_str = f" ({year})" if year else ""
    prompt = (
        f'Album: "{album_name}" by {artist}{year_str}\n\n'
        f'Classify this album. Respond with JSON only, no explanation:\n'
        f'{{"genre": "<one of: {", ".join(GENRE_LIST)}>", '
        f'"subgenres": ["<specific subgenre 1>", "<specific subgenre 2>", "<specific subgenre 3>"]}}'
    )
    resp = client.messages.create(
        model="claude-haiku-4-5-20251001",
        max_tokens=120,
        temperature=0,
        messages=[{"role": "user", "content": prompt}],
    )
    text = resp.content[0].text.strip()
    if text.startswith("```"):
        text = text.split("```")[1]
        if text.startswith("json"):
            text = text[4:]
    data = json.loads(text.strip())
    genre = data.get("genre") if data.get("genre") in GENRE_LIST else None
    subgenres = [s for s in data.get("subgenres", []) if isinstance(s, str) and s.strip()][:3]
    return genre, subgenres


def run(dry_run: bool = False, album_id: int | None = None, overwrite: bool = False):
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).parent / ".env")

    from backend.database import _build_engine
    from backend.models import Album
    from sqlmodel import Session, select

    engine = _build_engine()
    updated = failed = 0

    with Session(engine) as session:
        q = select(Album)
        if album_id:
            q = q.where(Album.id == album_id)
        albums = session.exec(q).all()

        for alb in albums:
            try:
                genre, subgenres = classify_genre_claude(alb.artist, alb.album_name, alb.year)
            except Exception as e:
                print(f"  Claude failed for {alb.artist} – {alb.album_name}: {e}")
                # fallback to Last.fm for genre only
                try:
                    tags = get_tags_for_album(alb.id, alb.artist, alb.album_name)
                    genre, _ = infer_genres(tags)
                    subgenres = []
                except Exception:
                    failed += 1
                    continue

            if not genre and not subgenres:
                failed += 1
                continue

            sub1 = subgenres[0] if len(subgenres) > 0 else None
            sub2 = subgenres[1] if len(subgenres) > 1 else None
            sub3 = subgenres[2] if len(subgenres) > 2 else None

            print(f"{alb.artist} – {alb.album_name}")
            print(f"  genre={genre}  sub1={sub1}  sub2={sub2}  sub3={sub3}")

            if not dry_run:
                if overwrite or not alb.genre:
                    alb.genre = genre
                if overwrite or not alb.sub_genre1:
                    alb.sub_genre1 = sub1
                if overwrite or not alb.sub_genre2:
                    alb.sub_genre2 = sub2
                if overwrite or not alb.sub_genre3:
                    alb.sub_genre3 = sub3
                session.add(alb)
            updated += 1

        if not dry_run:
            session.commit()

    print(f"\nDone — updated: {updated}, failed/no result: {failed}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run",  action="store_true")
    parser.add_argument("--overwrite", action="store_true", help="overwrite existing genre/subgenre values")
    parser.add_argument("--album-id", type=int)
    args = parser.parse_args()
    run(dry_run=args.dry_run, album_id=args.album_id, overwrite=args.overwrite)
