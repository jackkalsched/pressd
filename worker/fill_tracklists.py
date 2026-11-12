"""Top up every album copy whose tracklist isn't settled yet.

Runs daily in .github/workflows/fill-covers.yml, before the cover fill, so a
copy that gains its songs tonight can gain its cover in the same run. The merge
and its rules are backend/tracklist_fill.py: songs are only added, matched by
recording identity, never deleted or re-scored; rated and settled copies are
left alone. A copy settles at its one pull on or after release day, so this
reads only unsettled, unrated copies:
  (a) songless ones;
  (b) ones whose release is ahead — pre-release top-ups, as singles appear;
  (c) released ones with songs not yet pulled — added before release.
A released copy whose pull finds nothing still settles if it has songs; one
whose lookup errored doesn't, and is tried again tomorrow.

Records are grouped, so each is looked up once. Another copy of the same
edition is tried first, from the database (for a released copy only a settled
one, whose list is a finished pull); a record with a copy still owed a pull or
before release is then looked up on Deezer (then iTunes) with no database
connection held — the 15-client pooler is shared with production — and the
catalog list is merged in a second short session.

A source that errors is reported (the `workerrun` row's `network_failures` and
`errors`) and the run still exits 0. Job 'fill_tracklists'.

    python -m worker.fill_tracklists              # look and store
    python -m worker.fill_tracklists --dry-run    # print what would change; store nothing
    python -m worker.fill_tracklists --limit 20   # at most 20 records
"""
import argparse
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).parent.parent))

import httpx
from sqlalchemy import text
from sqlalchemy.orm import selectinload
from sqlmodel import Session, select

import backend.models  # noqa: F401 — registers tables in SQLModel.metadata
from backend import tracklist_fill as tf
from backend.database import engine
from backend.models import Album
from backend.scoring import is_single_release
from worker import runlog

CANDIDATES = """
    SELECT a.id, a.subject_key,
           NOT EXISTS (SELECT 1 FROM song s WHERE s.album_id = a.id) AS songless,
           a.release_date IS NOT NULL AND a.release_date > CURRENT_DATE AS upcoming
    FROM album a
    WHERE a.status <> 'rated' AND a.subject_key IS NOT NULL AND a.tracklist_settled_at IS NULL
"""


def _copies(session: Session, keys: list[str]) -> dict[str, list[Album]]:
    out: dict[str, list[Album]] = {}
    if not keys:
        return out
    for a in session.exec(select(Album).where(Album.subject_key.in_(keys))
                          .options(selectinload(Album.songs))).all():
        out.setdefault(a.subject_key, []).append(a)
    return out


def _show(session: Session, copies: list[Album], changes: list[tf.Change], dry_run: bool) -> None:
    by_id = {c.id: c for c in copies}
    for ch in changes:
        a = by_id[ch.album_id]
        print(f"  album {ch.album_id} (user {ch.user_id}, {ch.status}) {a.artist} — {a.album_name}:"
              f" {ch.before} → {ch.after} songs from {ch.source}, {ch.renumbered} renumbered")
        links = tf.preview_links(session, a, ch) if dry_run else [(t, None) for t in ch.added]
        for title, tid in links:
            print(f"      + {title}" + (f"  → track {tid}" if dry_run and tid else "  → new track" if dry_run else ""))


def _candidate(c) -> bool:
    return c.status != "rated" and not tf.is_settled(c)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true", help="print what would change; store nothing")
    ap.add_argument("--limit", type=int, default=None, help="at most this many records")
    args = ap.parse_args()
    dry = args.dry_run

    run_id = None
    if not dry:
        with engine.connect() as con:
            run_id = runlog.start(con, "fill_tracklists")

    counts = {"songless": 0, "upcoming": 0, "unpulled": 0}
    stats = {"records": 0, "from_copies": 0, "catalog_looked_up": 0, "catalog_found": 0,
             "catalog_not_found": 0, "network_failures": 0, "from_catalog": 0, "songs_added": 0,
             "settled": 0}
    errors: list[str] = []
    # A dry run writes nothing, so it keeps each copy's song count itself.
    songs_after: dict[int, int] = {}
    settled_ids: set[int] = set()

    def show(session, copies, changes):
        _show(session, copies, changes, dry)
        for ch in changes:
            songs_after[ch.album_id] = ch.after

    def settle(session, copy) -> None:
        has = songs_after.get(copy.id, len(copy.songs)) > 0
        if copy.id not in settled_ids and tf.settle(session, copy, has_songs=has, dry_run=dry):
            settled_ids.add(copy.id)
            stats["settled"] += 1
            print(f"  settled album {copy.id} (user {copy.user_id}) {copy.artist} — {copy.album_name}")

    try:
        # 1. Candidates, and merges from other copies, one session.
        lookups: list[tuple[str, str, str, str | None, bool]] = []
        with Session(engine) as session:
            want: set[str] = set()
            for _id, key, songless, upcoming in session.execute(text(CANDIDATES)).all():
                counts["songless" if songless else "upcoming" if upcoming else "unpulled"] += 1
                want.add(key)
            keys = sorted(want)[: args.limit] if args.limit else sorted(want)
            stats["records"] = len(keys)
            print(f"[fill-tracklists] candidates (unsettled, unrated): {counts['songless']} songless,"
                  f" {counts['upcoming']} not out yet, {counts['unpulled']} out but not yet pulled;"
                  f" {len(keys)} records")
            records = _copies(session, keys)
            for key in keys:
                copies = records.get(key, [])
                owed = []
                for copy in sorted(filter(_candidate, copies), key=lambda c: c.id):
                    out = tf.is_out(copy)
                    donor = tf.donor_for(copy, copies, released=out)
                    if donor is not None:
                        ch = tf.merge_copy(session, copy, tf.from_copy(donor), f"copy:{donor.id}", dry_run=dry)
                        if ch:
                            show(session, copies, [ch])
                            stats["from_copies"] += 1
                            stats["songs_added"] += len(ch.added)
                    if out and donor is not None:
                        settle(session, copy)   # a settled copy's list was its pull
                    else:
                        owed.append(copy)
                if owed:
                    rep = min(owed, key=lambda c: (not c.release_date, c.id))
                    n = songs_after.get(rep.id, len(rep.songs))
                    lookups.append((key, rep.album_name, rep.artist, rep.extra_artists,
                                    n > 0 and is_single_release(rep.album_name, n)))

        # 2. The catalog, no connection held.
        found: dict[str, tf.Resolved | None] = {}
        with httpx.Client(timeout=15, headers=tf.UA) as client:
            for key, name, artist, extras, single in lookups:
                stats["catalog_looked_up"] += 1
                got, errs = tf.resolve_catalog(client, name, artist, extras, want_single=single)
                if errs:
                    stats["network_failures"] += len(errs)
                    errors += [f"{artist} — {name}: {e}" for e in errs]
                if got:
                    stats["catalog_found"] += 1
                    found[key] = got
                elif not errs:
                    # A clean miss is an answer: a released copy's pull is done.
                    stats["catalog_not_found"] += 1
                    found[key] = None
                    print(f"  no catalog list for {artist} — {name}")
                else:
                    print(f"  lookup failed for {artist} — {name}; tried again next run")

        # 3. The catalog merges, and the pulls they finish, a second short session.
        if found:
            with Session(engine) as session:
                records = _copies(session, list(found))
                for key, resolved in found.items():
                    for copy in sorted(filter(_candidate, records.get(key, [])), key=lambda c: c.id):
                        if copy.id in settled_ids:
                            continue
                        if resolved and tf.takes_catalog(copy, resolved.album_name):
                            ch = tf.merge_copy(session, copy, resolved.tracks, resolved.source, dry_run=dry)
                            if ch:
                                show(session, records[key], [ch])
                                stats["from_catalog"] += 1
                                stats["songs_added"] += len(ch.added)
                                if not dry and not copy.album_art_url and resolved.cover_url:
                                    copy.album_art_url = resolved.cover_url
                                    session.add(copy)
                                    session.commit()
                        settle(session, copy)
    except Exception as e:
        if run_id is not None:
            with engine.connect() as con:
                runlog.finish(con, run_id, "error", error=f"{type(e).__name__}: {e}"[:500])
        raise

    print(f"[fill-tracklists] {stats}")
    for e in errors[:20]:
        print(f"  ! {e}")
    if run_id is not None:
        with engine.connect() as con:
            runlog.finish(con, run_id, "ok", candidates=counts, errors=errors[:20], **stats)
    return 0


if __name__ == "__main__":
    sys.exit(main())
