"""Set a record's cover by hand, for the records no catalog has art for.

`backend/covers.py` finds covers on its own for nearly everything; what it
can't find is a record no catalog lists (a 1996 indie LP) or one whose stored
name is wrong, and a wrong name is better corrected, since the search then
finds the cover itself. For the rest, find the art somewhere stable (Discogs,
Bandcamp, the label's site), copy the image's address, and run:

    python -m worker.set_cover 1241 https://…/cover.jpg        # by album copy id
    python -m worker.set_cover 1241 https://…/cover.jpg --dry-run

The address must answer with an image. Every copy of the record (`subject_key`)
gets it, so other people's copies are covered too, and the daily search leaves
them alone from then on, because it only looks at copies with no cover.
"""
import argparse
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).parent.parent))

import httpx
from sqlmodel import Session, select

import backend.models  # noqa: F401 — registers tables in SQLModel.metadata
from backend.covers import UA
from backend.database import engine
from backend.models import Album


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("album_id", type=int, help="any copy of the record")
    ap.add_argument("image_url")
    ap.add_argument("--dry-run", action="store_true", help="check the image and list the copies; store nothing")
    args = ap.parse_args()

    with httpx.Client(timeout=20, headers=UA, follow_redirects=True) as client:
        with client.stream("GET", args.image_url) as r:
            kind = r.headers.get("content-type", "")
            if r.status_code != 200 or not kind.startswith("image/"):
                print(f"[set-cover] {args.image_url} answered {r.status_code} {kind or '(no type)'}, not an image")
                return 1
            url = str(r.url)

    with Session(engine) as session:
        album = session.get(Album, args.album_id)
        if album is None:
            print(f"[set-cover] no album {args.album_id}")
            return 1
        copies = session.exec(select(Album).where(Album.subject_key == album.subject_key)).all() if album.subject_key else [album]
        print(f"[set-cover] {album.artist} — {album.album_name}: {len(copies)} copies")
        for c in copies:
            print(f"  {c.id}  was {c.album_art_url or '(none)'}")
        if args.dry_run:
            return 0
        for c in copies:
            c.album_art_url = url
            session.add(c)
        session.commit()
    print(f"[set-cover] stored {url}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
