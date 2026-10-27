"""One-off: give every album a genre and subgenres, with "Alternative" tied to the
genre it qualifies.

Three faults left most of October 2026's imports untagged (CLAUDE.md §5):
Render's unpinned `anthropic` reached 1.x, which rejects the `temperature`
the tagger passes, so every Claude call raised; the raise skipped the Last.fm
fallback; and the tagger only ran when the catalog had sent no genre, which
iTunes and Deezer usually do — so albums got a genre and never a subgenre.
152 of the 154 albums added that month had none. And iTunes filed 97 albums
under "Alternative", which is not a genre (genres.QUALIFIERS).

Selected: no genre, a bare qualifier for a genre, no first subgenre, or a bare
qualifier among the subgenres. Grouped by record (`subject_key`), so one record
is tagged once and its copies agree: a copy anywhere that already has a real
genre and subgenres donates them; otherwise Claude is asked once per record,
told about the qualifier when a copy carried one. Only empty or qualifier
fields are written — a genre someone or a catalog set stays.

All the API calls happen before a database connection is opened for writing,
so the run never holds one of Supabase's 15 pooler slots across a call (§7).
Dry run by default:

    python -m backend.backfill_genre_tags                # report, calls Claude
    python -m backend.backfill_genre_tags --apply        # write
    python -m backend.backfill_genre_tags --cache F      # reuse answers across runs
"""
from __future__ import annotations

import argparse
import json
import os
from collections import defaultdict

from sqlalchemy import text

from .database import engine
from .genres import canonical_genre, canonical_subgenre, genre_qualifier


def needs(a) -> bool:
    subs = (a.sub_genre1, a.sub_genre2, a.sub_genre3)
    return (
        not a.genre or bool(genre_qualifier(a.genre)) or not a.sub_genre1
        or any(s and genre_qualifier(s) for s in subs)
    )


def good(a) -> bool:
    return bool(a.genre and not genre_qualifier(a.genre) and a.sub_genre1
                and not any(s and genre_qualifier(s) for s in (a.sub_genre1, a.sub_genre2, a.sub_genre3)))


def main(apply: bool, cache_path: str | None) -> None:
    from .routers.albums import _classify_genre_claude, _clean_subgenres

    with engine.connect() as conn:
        rows = conn.execute(text(
            "SELECT id, subject_key, artist, album_name, year, genre, sub_genre1, sub_genre2, sub_genre3 "
            "FROM album")).all()

    by_record: dict[str, list] = defaultdict(list)
    for a in rows:
        by_record[a.subject_key or f"id:{a.id}"].append(a)

    cache: dict[str, dict] = {}
    if cache_path and os.path.exists(cache_path):
        cache = json.load(open(cache_path))

    plan: list[tuple] = []  # (album id, genre, [subs], source)
    asked = donated = 0
    for key, copies in by_record.items():
        todo = [a for a in copies if needs(a)]
        if not todo:
            continue
        donor = next((a for a in copies if good(a)), None)
        if donor:
            genre, subs, source = donor.genre, [s for s in (donor.sub_genre1, donor.sub_genre2, donor.sub_genre3) if s], "copy"
            donated += 1
        else:
            if key not in cache:
                ref = todo[0]
                qualifier = next((q for a in copies if (q := genre_qualifier(a.genre))), None)
                try:
                    g, s = _classify_genre_claude(ref.artist, ref.album_name, ref.year, qualifier)
                except Exception as e:
                    print(f"  Claude failed: {ref.artist} — {ref.album_name}: {e}")
                    continue
                cache[key] = {"genre": g, "subs": s}
                asked += 1
                if asked % 25 == 0:
                    print(f"  {asked} asked")
                    if cache_path:
                        json.dump(cache, open(cache_path, "w"))
            genre, subs, source = cache[key]["genre"], cache[key]["subs"], "claude"
        for a in todo:
            plan.append((a, genre, subs, source))
    if cache_path:
        json.dump(cache, open(cache_path, "w"))

    writes = []
    for a, genre, subs, source in plan:
        new_genre = a.genre if a.genre and not genre_qualifier(a.genre) else canonical_genre(genre)
        old_subs = [a.sub_genre1, a.sub_genre2, a.sub_genre3]
        if not a.sub_genre1:
            new_subs = _clean_subgenres(subs, new_genre, a.artist)
        else:
            new_subs = [x for s in old_subs if s and (x := canonical_subgenre(s, new_genre))]
        new_subs += [None] * (3 - len(new_subs))
        if new_genre == a.genre and new_subs == old_subs:
            continue
        writes.append((a, new_genre, new_subs, source))

    print(f"\n{len(rows)} albums; {sum(needs(a) for a in rows)} need tags across "
          f"{sum(1 for c in by_record.values() if any(needs(a) for a in c))} records")
    print(f"{donated} records copied from a tagged copy, {asked} asked of Claude this run")
    print(f"{len(writes)} albums change\n")
    for a, g, s, src in writes[:40]:
        print(f"  #{a.id:<5} [{src:6}] {a.artist[:22]:22} {a.album_name[:30]:30} "
              f"{a.genre!s:12} → {g!s:12} {[x for x in s if x]}")
    if len(writes) > 40:
        print(f"  … and {len(writes) - 40} more")

    if not apply:
        print("\nDry run — nothing written. Re-run with --apply.")
        return
    with engine.begin() as conn:
        for a, g, s, _ in writes:
            conn.execute(text(
                "UPDATE album SET genre = :g, sub_genre1 = :s1, sub_genre2 = :s2, sub_genre3 = :s3 WHERE id = :id"),
                {"g": g, "s1": s[0], "s2": s[1], "s3": s[2], "id": a.id})
    print(f"\nApplied {len(writes)}.")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--cache")
    args = ap.parse_args()
    main(args.apply, args.cache)
