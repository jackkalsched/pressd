"""One-off: give every stored album the artist credit the resolvers now give a
new import — the primary artist in `artist`, the other credited artists in
`extra_artists` (backend/credits.py).

Until October 2026 an iTunes import stored a collaboration's joined string
("Anderson .Paak & Cordae"), a Deezer import stored only the primary, and
`extra_artists` held whatever someone typed into the rating screen's box —
song titles and "me" among it. So Jack's and Allison's copies of *Heavy Is the
Crown* were two records, with two sets of tracks and two threads.

Each distinct (album, artist) is looked up on Deezer, which lists a record's
Main contributors. Then, per copy:

  - stored artist is Deezer's primary → `extra_artists` becomes Deezer's other
    Main artists, or nothing (which clears the typed junk);
  - stored artist is a joined credit naming Deezer's primary and every other
    Main artist → `artist` becomes the primary, the rest go to `extra_artists`,
    and the copy's songs, tracks and thread follow it;
  - anything else — not on Deezer, or Deezer's record isn't this one — is left
    exactly as it is.

When the artist changes, songs carrying the old credit take the primary, each
song's `track` is re-keyed (renamed when nothing else uses it, so analysed
audio stays attached; pointed at the existing row when the other copy's key
already exists), and the album's thread is renamed, or merged into the room
the other copy already had.

Dry run by default. Lookups are cached to a file, so the apply reuses them:

    python -m backend.backfill_artist_credits --cache /tmp/credits.json
    python -m backend.backfill_artist_credits --cache /tmp/credits.json --apply
"""
from __future__ import annotations

import argparse
import json
import os
import re
import time

import httpx
from sqlalchemy import text

from .credits import dedupe_extras, extras_of, named_in
from .database import engine
from .trackkeys import artist_key, same_album, subject_key_album, track_key

PACE = 0.13  # Deezer allows 50 requests per 5 s


def deezer_credit(client: httpx.Client, name: str, artist: str) -> dict | None:
    """Deezer's primary and Main artists for this record, or None."""
    for q in (f"{name} {artist}", name):
        time.sleep(PACE)
        r = client.get("https://api.deezer.com/search/album", params={"q": q, "limit": 10})
        if not r.is_success:
            continue
        hit = next(
            (h for h in (r.json().get("data") or [])
             if same_album(name, artist, h.get("title", ""), (h.get("artist") or {}).get("name", ""))),
            None,
        )
        if not hit:
            continue
        time.sleep(PACE)
        d = client.get(f"https://api.deezer.com/album/{hit['id']}")
        if not d.is_success or "error" in d.json():
            return None
        body = d.json()
        primary = (body.get("artist") or {}).get("name", "")
        mains = [c["name"] for c in body.get("contributors") or [] if c.get("role") == "Main" and c.get("name")]
        return {"primary": primary, "mains": mains or [primary], "deezer_id": hit["id"]}
    return None


def itunes_credit(client: httpx.Client, name: str, primary: str) -> str | None:
    """The credit iTunes prints for this record — the check on Deezer's list,
    which also names a band's members as Main (credits.named_in)."""
    time.sleep(PACE)
    r = client.get("https://itunes.apple.com/search",
                   params={"term": f"{name} {primary}", "entity": "album", "limit": 10})
    if not r.is_success:
        return None
    hit = next(
        (h for h in (r.json().get("results") or [])
         if same_album(name, primary, h.get("collectionName", ""), h.get("artistName", ""))),
        None,
    )
    return hit["artistName"] if hit else None


def plan_for(stored: str, extras: list[str], credit: dict | None) -> tuple[str, list[str]] | None:
    """(artist, extra_artists) to store, or None to leave the copy alone."""
    if not credit or not credit["primary"]:
        return None
    primary, mains = credit["primary"], credit["mains"]
    # Confirmed by a printed credit — iTunes's, or this copy's own when it is
    # the joined iTunes string — or by a name someone typed into the old box
    # that Deezer lists too. Unconfirmed co-artists are dropped, and so is
    # anything typed that Deezer doesn't list ("me", song titles).
    printed = " / ".join(c for c in (credit.get("itunes"), stored, *extras) if c)
    new_extras = named_in(printed, dedupe_extras(primary, mains))
    # The spelling already stored wins ("MIKE" over Deezer's "Mike").
    known = {artist_key(e): e for e in extras}
    new_extras = [known.get(artist_key(e), e) for e in new_extras]
    sk = artist_key(stored).replace(" ", "")
    if artist_key(stored) == artist_key(primary):
        return stored, new_extras
    keys = [artist_key(m).replace(" ", "") for m in [primary, *new_extras]]
    if new_extras and all(k and k in sk for k in keys):
        return primary, new_extras
    return None


def main(apply: bool, cache_path: str | None) -> None:
    cache: dict[str, dict | None] = {}
    if cache_path and os.path.exists(cache_path):
        cache = json.load(open(cache_path))

    with engine.connect() as conn:
        albums = conn.execute(text(
            "SELECT id, album_name, artist, extra_artists FROM album ORDER BY id")).all()

    distinct = sorted({(a.album_name or "", a.artist or "") for a in albums})
    todo = [d for d in distinct if f"{d[0]}||{d[1]}" not in cache]
    print(f"{len(albums)} albums, {len(distinct)} distinct records, {len(todo)} to look up")
    with httpx.Client(timeout=15) as client:
        for i, (name, artist) in enumerate(todo, 1):
            try:
                cache[f"{name}||{artist}"] = deezer_credit(client, name, artist)
            except (httpx.HTTPError, ValueError) as e:
                print(f"  lookup failed: {artist} — {name}: {e}")
                continue
            if i % 100 == 0:
                print(f"  {i}/{len(todo)}")
                if cache_path:
                    json.dump(cache, open(cache_path, "w"))
        # The iTunes check, only where Deezer names more than one artist.
        need = [k for k, v in cache.items() if v and len(v["mains"]) > 1 and "itunes" not in v]
        print(f"{len(need)} multi-artist credits to confirm on iTunes")
        for k in need:
            name = k.split("||")[0]
            try:
                cache[k]["itunes"] = itunes_credit(client, name, cache[k]["primary"])
            except (httpx.HTTPError, ValueError) as e:
                print(f"  iTunes failed: {k}: {e}")
    if cache_path:
        json.dump(cache, open(cache_path, "w"))

    changes = []
    not_found = 0
    for a in albums:
        credit = cache.get(f"{a.album_name or ''}||{a.artist or ''}")
        if credit is None:
            not_found += 1
        old_extras = extras_of(a.extra_artists)
        plan = plan_for(a.artist or "", old_extras, credit)
        if plan is None:
            continue
        new_artist, new_extras = plan
        if new_artist == a.artist and new_extras == old_extras:
            continue
        changes.append((a, new_artist, new_extras))

    renamed = [c for c in changes if c[1] != c[0].artist]
    print(f"\n{not_found} copies not matched on Deezer (left alone)")
    print(f"{len(changes)} copies change; {len(renamed)} of them change primary artist\n")
    for a, new_artist, new_extras in changes:
        before = f"{a.artist!r} + {extras_of(a.extra_artists)}"
        after = f"{new_artist!r} + {new_extras}"
        print(f"  #{a.id:<5} {a.album_name[:38]:38}  {before}  →  {after}")

    if not apply:
        print("\nDry run — nothing written. Re-run with --apply.")
        return

    with engine.begin() as conn:
        thread_cols = {r[0] for r in conn.execute(text(
            "SELECT table_name FROM information_schema.columns "
            "WHERE table_schema = 'public' AND column_name = 'thread_id'"))}
        if thread_cols - {"post"}:
            raise SystemExit(f"thread_id also lives in {thread_cols - {'post'}}; extend the merge first")

        moves: dict[str, tuple[str, str]] = {}
        for a, new_artist, new_extras in changes:
            old_sk = subject_key_album(a.artist or "", a.album_name or "")
            new_sk = subject_key_album(new_artist, a.album_name or "")
            conn.execute(text(
                "UPDATE album SET artist = :ar, extra_artists = :ex, subject_key = :sk WHERE id = :id"),
                {"ar": new_artist, "ex": json.dumps(new_extras) if new_extras else None,
                 "sk": new_sk, "id": a.id})
            if new_artist == a.artist:
                continue
            if old_sk != new_sk:
                moves[old_sk] = (new_sk, new_artist)
            conn.execute(text(
                "UPDATE song SET artist = :new WHERE album_id = :id AND (artist = :old OR artist IS NULL OR artist = '')"),
                {"new": new_artist, "old": a.artist, "id": a.id})

        # Tracks: re-key every song of a renamed copy onto the primary.
        renamed_ids = [a.id for a, na, _ in changes if na != a.artist]
        if renamed_ids:
            songs = conn.execute(text(
                "SELECT s.id, s.title, s.artist, s.track_id, t.track_key "
                "FROM song s JOIN track t ON t.id = s.track_id WHERE s.album_id = ANY(:ids)"),
                {"ids": renamed_ids}).all()
            by_track: dict[int, list] = {}
            for s in songs:
                by_track.setdefault(s.track_id, []).append(s)
            moved = set(s.id for s in songs)
            for tid, group in by_track.items():
                old_key = group[0].track_key
                suffix = m.group(0) if (m := re.search(r"\|\|d\d+$", old_key)) else ""
                new_key = track_key(group[0].artist or "", group[0].title or "") + suffix
                if new_key == old_key:
                    continue
                target = conn.execute(text("SELECT id FROM track WHERE track_key = :k"), {"k": new_key}).scalar()
                others = conn.execute(text(
                    "SELECT COUNT(*) FROM song WHERE track_id = :t AND NOT (id = ANY(:ids))"),
                    {"t": tid, "ids": list(moved)}).scalar()
                if target is None and not others:
                    a_norm, t_norm = new_key.split("||")[0], new_key.split("||")[1]
                    conn.execute(text(
                        "UPDATE track SET track_key = :k, artist_norm = :a, title_norm = :t WHERE id = :id"),
                        {"k": new_key, "a": a_norm, "t": t_norm, "id": tid})
                    continue
                if target is None:
                    a_norm, t_norm = new_key.split("||")[0], new_key.split("||")[1]
                    target = conn.execute(text(
                        "INSERT INTO track (track_key, artist_norm, title_norm, duration_ms, created_at) "
                        "SELECT :k, :a, :t, duration_ms, NOW() FROM track WHERE id = :old RETURNING id"),
                        {"k": new_key, "a": a_norm, "t": t_norm, "old": tid}).scalar()
                conn.execute(text("UPDATE song SET track_id = :new WHERE id = ANY(:ids)"),
                             {"new": target, "ids": [s.id for s in group]})

        # Threads: rename the room, or fold it into the one the other copy had.
        for old_sk, (new_sk, new_artist) in moves.items():
            old = conn.execute(text(
                "SELECT id, post_count, last_post_at FROM thread WHERE subject_type = 'album' AND subject_key = :k"),
                {"k": old_sk}).first()
            if not old:
                continue
            new = conn.execute(text(
                "SELECT id FROM thread WHERE subject_type = 'album' AND subject_key = :k"), {"k": new_sk}).scalar()
            if new is None:
                conn.execute(text("UPDATE thread SET subject_key = :k, subtitle = :s WHERE id = :id"),
                             {"k": new_sk, "s": new_artist, "id": old.id})
                print(f"  thread {old.id} renamed to {new_sk}")
            else:
                conn.execute(text("UPDATE post SET thread_id = :new WHERE thread_id = :old"),
                             {"new": new, "old": old.id})
                conn.execute(text(
                    "UPDATE thread SET post_count = post_count + :n, "
                    "last_post_at = GREATEST(last_post_at, :at) WHERE id = :id"),
                    {"n": old.post_count or 0, "at": old.last_post_at, "id": new})
                conn.execute(text("DELETE FROM thread WHERE id = :id"), {"id": old.id})
                print(f"  thread {old.id} merged into {new}")
    print("\nApplied.")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--cache")
    args = ap.parse_args()
    main(args.apply, args.cache)
