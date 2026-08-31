"""One-off: fill album.subject_key for rows that predate the column.

Not a migration string in init_db(): the value comes from Python normalisation
(trackkeys.subject_key_album), which SQL cannot reproduce. Idempotent and safe
to re-run — it only touches rows whose stored key differs from the computed one,
so a second run reports zero.

    python -m backend.backfill_subject_keys [--dry-run]

See PLAN_discussions.md §2.3. `backend/verify_subject_keys.py` is the check that
this produced one key per record, and should be run after.
"""

from __future__ import annotations

import sys

from sqlalchemy import text
from sqlmodel import Session

from .database import engine
from .trackkeys import subject_key_album

BATCH = 500


def main(dry_run: bool = False) -> int:
    with Session(engine) as session:
        rows = session.execute(text(
            "SELECT id, album_name, artist, subject_key FROM album"
        )).fetchall()

        pending = []
        for aid, name, artist, stored in rows:
            want = subject_key_album(artist or "", name or "")
            if stored != want:
                pending.append({"i": aid, "k": want})

        print(f"{len(rows)} albums, {len(pending)} need a key written")
        if dry_run:
            for p in pending[:10]:
                print(f"  would set {p['i']} -> {p['k']}")
            if len(pending) > 10:
                print(f"  ... and {len(pending) - 10} more")
            return 0

        for i in range(0, len(pending), BATCH):
            chunk = pending[i:i + BATCH]
            session.execute(text("UPDATE album SET subject_key = :k WHERE id = :i"), chunk)
            session.commit()
            print(f"  wrote {min(i + BATCH, len(pending))}/{len(pending)}")

        missing = session.execute(text(
            "SELECT COUNT(*) FROM album WHERE subject_key IS NULL")).scalar()
        print(f"done. {missing} albums still have a NULL subject_key")
        return 0


if __name__ == "__main__":
    sys.exit(main(dry_run="--dry-run" in sys.argv))
