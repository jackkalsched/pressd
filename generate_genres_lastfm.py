"""
Generate / override album genres and subgenres using Last.fm tags.
Tags are pulled from cached corpus JSON files first, then live Last.fm API.

Usage:
    python generate_genres_lastfm.py              # every album, every user
    python generate_genres_lastfm.py --dry-run    # print without writing
    python generate_genres_lastfm.py --album-id 5 # single album

Scoping one user's back catalogue:
    python generate_genres_lastfm.py --user-id 1 --status rated \
        --missing-subgenres --oldest --limit 20 --dry-run

Unscoped is the whole table — 44 users' libraries, one Haiku call each. The
selection flags exist so a re-tagging pass can be aimed at the albums that
actually need it, and `--backup` writes the prior values first so an overwrite
can be undone.
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
        if not LASTFM_KEY:  # env-only; without it there are no artist tags
            return []
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


def _subgenre_canon(session) -> dict[str, str]:
    """Map lowercased subgenre → the spelling already used in the database.

    Subgenres are grouped by exact string everywhere they're read — the Stats
    breakdown keys a dict on the raw value, and the drill-down board matches on
    it. So "Dream pop" from the classifier does not join "Dream Pop"'s 24
    albums, it starts a second bar with 1. The live vocabulary is uniformly
    Title Case with no collisions today, and this keeps it that way.

    An unseen subgenre is Title Cased to match, but only word by word and only
    where the word is already all-lowercase — blanket `str.title()` would
    rewrite "UK Drill" to "Uk Drill" and invent a collision rather than prevent
    one. A 119-album pass adds a lot of vocabulary at once, and whatever it
    writes becomes the canon for everything after it.
    """
    from backend.models import Album
    from sqlmodel import select

    canon: dict[str, str] = {}
    for row in session.exec(
        select(Album.sub_genre1, Album.sub_genre2, Album.sub_genre3)
    ).all():
        for s in row:
            if s:
                canon.setdefault(s.strip().lower(), s.strip())
    return canon


def _tidy_subgenre(s: str, canon: dict[str, str]) -> str:
    """Fold onto the existing spelling, else Title Case a lowercase word."""
    s = s.strip()
    if s.lower() in canon:
        return canon[s.lower()]
    return " ".join(w.capitalize() if w.islower() else w for w in s.split(" "))


def run(
    dry_run: bool = False,
    album_id: int | None = None,
    overwrite: bool = False,
    user_id: int | None = None,
    status: str | None = None,
    missing_subgenres: bool = False,
    oldest: bool = False,
    limit: int | None = None,
    backup: str | None = None,
    list_only: bool = False,
    restore: str | None = None,
):
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).parent / ".env")

    from backend.database import _build_engine
    from backend.models import Album
    from sqlmodel import Session, select

    engine = _build_engine()
    updated = failed = fell_back = 0

    with Session(engine) as session:
        # Put back exactly what a --backup recorded. This is the one path that
        # is allowed to write None over a value, because None is what the row
        # held before the pass being undone.
        if restore:
            rows = json.loads(Path(restore).read_text())
            n = 0
            for row in rows:
                alb = session.get(Album, row["id"])
                if alb is None:
                    print(f"  [{row['id']}] gone, skipped")
                    continue
                alb.genre = row["genre"]
                alb.sub_genre1 = row["sub_genre1"]
                alb.sub_genre2 = row["sub_genre2"]
                alb.sub_genre3 = row["sub_genre3"]
                session.add(alb)
                n += 1
            if dry_run:
                print(f"Would restore {n} album(s) from {restore}. Nothing written.")
            else:
                session.commit()
                print(f"Restored {n} album(s) from {restore}.")
            return

        q = select(Album)
        if album_id:
            q = q.where(Album.id == album_id)
        if user_id is not None:
            q = q.where(Album.user_id == user_id)
        if status:
            q = q.where(Album.status == status)
        if missing_subgenres:
            # The Last.fm-era signature: a genre voted from tags, no subgenres,
            # because that path returned `subgenres = []`. These are the rows a
            # re-tag actually has something to add to.
            q = q.where((Album.sub_genre1.is_(None)) | (Album.genre.is_(None)))
        if oldest:
            # Oldest first by when it was rated. Nulls last so an unrated row
            # can't occupy the front of a "start with the old ones" pass.
            q = q.order_by(Album.date_rated.is_(None), Album.date_rated, Album.id)
        if limit:
            q = q.limit(limit)
        albums = session.exec(q).all()

        print(f"Selected {len(albums)} album(s).\n")

        # Built from the whole table, not the selection: the tag vocabulary is
        # shared app-wide — charts filter on it across users.
        canon = _subgenre_canon(session)

        # Snapshot before touching anything. An LLM re-classification is not
        # reversible from the values it produces, and these rows are shared —
        # they feed the charts and every genre breakdown on the app.
        if backup and not dry_run:
            Path(backup).write_text(json.dumps(
                [
                    {
                        "id": a.id, "user_id": a.user_id,
                        "artist": a.artist, "album_name": a.album_name,
                        "genre": a.genre, "sub_genre1": a.sub_genre1,
                        "sub_genre2": a.sub_genre2, "sub_genre3": a.sub_genre3,
                    }
                    for a in albums
                ],
                indent=1,
            ))
            print(f"Backed up prior tags for {len(albums)} album(s) → {backup}\n")

        # Review the target set without spending a classifier call on it. The
        # point of this mode is to be able to sign off on exactly which rows an
        # --overwrite pass will rewrite, before it rewrites them.
        if list_only:
            for a in albums:
                subs = [a.sub_genre1, a.sub_genre2, a.sub_genre3]
                print(f"[{a.id}] {str(a.genre):<14} {str(subs):<48} {a.artist} – {a.album_name}")
            print(f"\nListed {len(albums)} album(s). Nothing was classified or written.")
            return

        for alb in albums:
            via_fallback = False
            try:
                genre, subgenres = classify_genre_claude(alb.artist, alb.album_name, alb.year)
            except Exception as e:
                print(f"  Claude failed for {alb.artist} – {alb.album_name}: {e}")
                # fallback to Last.fm for genre only
                via_fallback = True
                fell_back += 1
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

            # Fold onto the spelling already in use before anything reads these
            # as distinct tags, and drop any duplicate the fold creates — the
            # breakdown counts an album once per *distinct* subgenre, so
            # ["Dream pop", "Dream Pop"] collapsing to one is correct.
            subgenres = list(dict.fromkeys(
                _tidy_subgenre(s, canon) for s in subgenres if s and s.strip()
            ))

            sub1 = subgenres[0] if len(subgenres) > 0 else None
            sub2 = subgenres[1] if len(subgenres) > 1 else None
            sub3 = subgenres[2] if len(subgenres) > 2 else None

            # Shown as a diff rather than as the new values alone: on an
            # overwrite pass the thing worth reading is what is being replaced.
            before = (alb.genre, alb.sub_genre1, alb.sub_genre2, alb.sub_genre3)
            after = (genre, sub1, sub2, sub3)
            print(f"[{alb.id}] {alb.artist} – {alb.album_name}"
                  + ("   (Last.fm fallback)" if via_fallback else ""))
            print(f"  before: genre={before[0]}  subs={list(before[1:])}")
            print(f"  after : genre={after[0]}  subs={list(after[1:])}"
                  + ("   << genre change" if before[0] != after[0] else ""))

            if not dry_run:
                # `is not None` rather than a bare truth test, on every field: a
                # classifier that returned nothing for a slot has told us it
                # doesn't know, not that the slot should be empty. The old
                # `overwrite or not x` wrote the None straight through, so an
                # --overwrite pass during an API outage — when every album takes
                # the fallback and the fallback always returns `subgenres = []` —
                # erased the subgenres of every album it touched.
                if (overwrite or not alb.genre) and genre is not None:
                    alb.genre = genre
                if (overwrite or not alb.sub_genre1) and sub1 is not None:
                    alb.sub_genre1 = sub1
                if (overwrite or not alb.sub_genre2) and sub2 is not None:
                    alb.sub_genre2 = sub2
                if (overwrite or not alb.sub_genre3) and sub3 is not None:
                    alb.sub_genre3 = sub3
                session.add(alb)
            updated += 1

        if not dry_run:
            session.commit()

    print(f"\nDone — updated: {updated}, failed/no result: {failed}, via Last.fm fallback: {fell_back}")
    if fell_back:
        # Worth shouting about. The fallback is the pre-Haiku process — the one
        # whose tag-voting produced the rows this script is usually run to fix —
        # and it never returns subgenres. A pass that fell back throughout has
        # not re-tagged anything with the current classifier, however many rows
        # it reports as updated.
        print(
            f"\n  WARNING: {fell_back}/{len(albums)} album(s) were classified by the Last.fm\n"
            f"  fallback, not by Claude. The fallback returns no subgenres and votes\n"
            f"  genres from raw tags. Fix the classifier before trusting these results."
        )


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run",  action="store_true")
    parser.add_argument("--overwrite", action="store_true", help="overwrite existing genre/subgenre values")
    parser.add_argument("--album-id", type=int)
    parser.add_argument("--user-id", type=int, help="scope to one user's library")
    parser.add_argument("--status", help="scope to a status, e.g. 'rated'")
    parser.add_argument("--missing-subgenres", action="store_true",
                        help="only albums with no subgenres or no genre")
    parser.add_argument("--oldest", action="store_true", help="oldest-rated first")
    parser.add_argument("--limit", type=int, help="cap how many albums are touched")
    parser.add_argument("--backup", help="write prior tag values to this JSON before writing")
    parser.add_argument("--restore", help="put back tag values from a --backup JSON")
    parser.add_argument("--list-only", action="store_true",
                        help="print the selected albums and exit; no classifier calls, no writes")
    args = parser.parse_args()
    run(
        dry_run=args.dry_run,
        album_id=args.album_id,
        overwrite=args.overwrite,
        user_id=args.user_id,
        status=args.status,
        missing_subgenres=args.missing_subgenres,
        oldest=args.oldest,
        limit=args.limit,
        backup=args.backup,
        list_only=args.list_only,
        restore=args.restore,
    )
