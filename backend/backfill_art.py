"""
Backfill album_art_url for all albums in the DB using Spotify search.
Run from the Press'd directory:
    python3 -m backend.backfill_art
"""

import json
import time
from pathlib import Path

from sqlmodel import Session, select

from backend.database import engine
from backend.models import Album

CONFIG_PATH = Path.home() / ".spotdl" / "config.json"


def main():
    with open(CONFIG_PATH) as f:
        cfg = json.load(f)

    from spotdl.utils.spotify import SpotifyClient
    SpotifyClient.init(
        client_id=cfg["client_id"],
        client_secret=cfg["client_secret"],
        no_cache=True,
    )
    spotify = SpotifyClient()

    with Session(engine) as session:
        albums = session.exec(
            select(Album).where(Album.album_art_url == None)
        ).all()

        print(f"Backfilling art for {len(albums)} albums...")
        updated = 0
        failed = 0

        for i, album in enumerate(albums):
            try:
                query = f"album:{album.album_name} artist:{album.artist}"
                results = spotify.search(query, type="album")
                items = results.get("albums", {}).get("items", [])

                if not items:
                    # Fallback: looser search
                    results = spotify.search(
                        f"{album.album_name} {album.artist}", type="album"
                    )
                    items = results.get("albums", {}).get("items", [])

                if items:
                    images = items[0].get("images", [])
                    if images:
                        # Spotify returns images sorted largest→smallest; take first
                        album.album_art_url = images[0]["url"]
                        session.add(album)
                        updated += 1
                    else:
                        failed += 1
                else:
                    failed += 1

                if (i + 1) % 50 == 0:
                    session.commit()
                    print(f"  {i + 1}/{len(albums)} — {updated} updated, {failed} not found")

                # Respect Spotify rate limits
                time.sleep(0.05)

            except Exception as e:
                print(f"  ✗ {album.album_name} — {album.artist}: {e}")
                failed += 1
                time.sleep(0.5)

        session.commit()

    print(f"\n✓ Done — {updated} updated, {failed} not found")


if __name__ == "__main__":
    main()
