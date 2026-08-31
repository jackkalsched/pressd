"""Check that discussion subject keys group records the way they should.

PLAN_discussions.md §14.1 calls this out as the highest-consequence, lowest-
visibility failure in the feature: a key that fragments looks fine in dev with
one user and splits into ghost towns in production. Run it after the backfill
and after any change to subject_key_album.

Two failure modes, and they pull in opposite directions:

  FRAGMENTATION  one record under several keys — the ghost-town case. Detected
                 by looking, within one artist, for album names where one is a
                 prefix of another but the keys differ.
  COLLISION      several records under one key — two different albums sharing a
                 room. Detected by a key whose raw names are not just edition
                 variants of each other.

    python -m backend.verify_subject_keys
"""

from __future__ import annotations

import re
import sys
from collections import defaultdict

from sqlalchemy import text
from sqlmodel import Session

from .database import engine
from .trackkeys import _clean, artist_key


# A trailing number or roman numeral means a sequel — a different record — not
# an edition of the one before it. "Luv Is Rage" and "Luv Is Rage 2" are two
# albums and belong in two rooms; without this the check reports every sequel
# in the library as a fragmentation bug and stops being worth running.
_SEQUEL_TAIL = re.compile(r"^(\d+( \d+)*|i{1,3}|iv|vi{0,3}|ix|xi{0,3})$")

# Any bracketed aside, not just the edition qualifiers _clean_album knows.
_PARENS = re.compile(r"[\(\[][^\)\]]*[\)\]]")


def main() -> int:
    with Session(engine) as session:
        rows = session.execute(text(
            "SELECT subject_key, album_name, artist, COUNT(*) AS copies"
            " FROM album WHERE subject_key IS NOT NULL"
            " GROUP BY subject_key, album_name, artist"
        )).fetchall()

    by_key: dict[str, list[tuple[str, str, int]]] = defaultdict(list)
    by_artist: dict[str, set[str]] = defaultdict(set)
    for key, name, artist, copies in rows:
        by_key[key].append((name, artist, copies))
        by_artist[artist_key(artist or "")].add(key)

    print(f"{len(rows)} (key, name) pairs over {len(by_key)} distinct keys, "
          f"{len(by_artist)} artists\n")

    # ── Fragmentation ────────────────────────────────────────────────────────
    frag = []
    for akey, keys in by_artist.items():
        names = sorted(({k: k.split("||", 1)[1] for k in keys}).items(), key=lambda kv: len(kv[1]))
        for i, (k1, n1) in enumerate(names):
            for k2, n2 in names[i + 1:]:
                # One name contained in the other, under one artist, but keyed
                # apart — "take care" vs "take care deluxe edition" would land
                # here if _clean_album ever stopped stripping the qualifier.
                if not (n1 and n2 and n1 != n2 and n2.startswith(n1 + " ")):
                    continue
                extra = n2[len(n1):].strip()
                if _SEQUEL_TAIL.match(extra):
                    continue        # a sequel, correctly kept apart
                frag.append((akey, n1, n2, extra))
    print(f"FRAGMENTATION (should be 0): {len(frag)} suspect pair(s)")
    for akey, n1, n2, extra in frag[:15]:
        print(f"  {akey}: {n1!r} vs {n2!r}  (extra: {extra!r})")
    if len(frag) > 15:
        print(f"  ... and {len(frag) - 15} more")

    # ── Collision ────────────────────────────────────────────────────────────
    # A merge is expected when the names differ only *inside* parentheses —
    # that is where catalogs put editions, and "(Deluxe Edition)" vs
    # "(Remaster)" are two pressings of one record, not two records. If the
    # names still disagree once every bracketed aside is removed, the key
    # merged two different works and someone has to look.
    coll = []
    for key, entries in by_key.items():
        outside = {_clean(_PARENS.sub(" ", n)) for n, _, _ in entries}
        if len(outside) > 1:
            coll.append((key, sorted({n for n, _, _ in entries})))
    print(f"\nCOLLISION (should be 0): {len(coll)} key(s) merging unrelated titles")
    for key, names in coll[:15]:
        print(f"  {key}")
        for n in names:
            print(f"      {n!r}")

    # ── What the keys actually bought ────────────────────────────────────────
    merged = [(k, v) for k, v in by_key.items() if len({n for n, _, _ in v}) > 1]
    print(f"\nMERGES: {len(merged)} record(s) whose spellings now share one room")
    for k, v in sorted(merged, key=lambda kv: -len(kv[1]))[:10]:
        print(f"  {k} <- {sorted({n for n, _, _ in v})}")
    return 1 if (frag or coll) else 0


if __name__ == "__main__":
    sys.exit(main())
