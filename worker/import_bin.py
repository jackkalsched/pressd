"""Import a published list into a Pressd bin, or update one already imported.

    python -m worker.import_bin data/bins/apple-music-100-best-albums.csv --dry-run
    python -m worker.import_bin data/bins/apple-music-100-best-albums.csv
    python -m worker.import_bin data/bins/<slug>.csv --set 18 123456   # rank 18 is Deezer album 123456

Reusable for every list, not a one-off: the CSV (rank,artist,title,year — the
list as its source prints it) and the sibling <slug>.json (the bin's title,
source, link and date) stay in the repo as the bin's record of where it came
from. Lists are typed in once and checked, never scraped while the app runs.

A song list (`item_type` "song" in the JSON) matches each row to the song's
release instead — Deezer track search, the studio take on the album it came out
on (backend.bins.pick_song_release) — and stores that album's tracklist.

Each album row is matched on Deezer (backend.bins.pick_release: `same_album`, then
an album over a compilation, the standard edition over a deluxe, the list's
year, the fewest tracks), falling back to iTunes, and resolved the way
/search/resolve resolves a pick, so the stored tracklist is exactly what an
import from search would have written. `--set` pins a row to a Deezer album by
hand and records it in the JSON's `overrides`, so the next run keeps it. The
dry run prints every doubtful and unmatched row and writes nothing; an
unmatched row is still stored, in its place, with nothing to add.

Re-running replaces the bin's entries with the new match; the bin's id and
slug stay.
"""
import argparse
import asyncio
import json
import pathlib
import re
import sys
from datetime import datetime, timezone

import httpx

from backend.bins import ListRow, parse_list_csv, parse_list_meta, pick_release, pick_song_release
from backend.new_releases import DEEZER_BASE, UA, _Pacer
from backend.trackkeys import subject_key_album

DEEZER_PER_SECOND = 6
ITUNES_PER_SECOND = 0.3
ITUNES_SEARCH = "https://itunes.apple.com/search"


async def _deezer(client: httpx.AsyncClient, pacer: _Pacer, path: str, **params) -> dict:
    for attempt in range(4):
        await pacer.wait()
        try:
            resp = await client.get(f"{DEEZER_BASE}{path}", params=params)
            body = resp.json() if resp.is_success else {"error": resp.status_code}
        except (httpx.HTTPError, ValueError):
            body = {"error": "network"}
        if not body.get("error"):  # rate limiting arrives as HTTP 200 with an error body
            return body
        await asyncio.sleep(2 * (attempt + 1))
    return {}


def _year(s: str | None) -> int | None:
    return int(s[:4]) if s and s[:4].isdigit() else None


async def deezer_hits(client, pacer, row: ListRow) -> list[dict]:
    """Deezer hits for the row from two searches — the strict one finds an
    exact title the loose one buries, the loose one the standard edition the
    strict one misses — with each plausible hit's year (a search result
    carries none, so those few are fetched)."""
    from backend.trackkeys import same_album

    seen, hits = set(), []
    for q in (f'artist:"{row.artist}" album:"{row.title}"', f"{row.artist} {row.title}"):
        for a in (await _deezer(client, pacer, "/search/album", q=q, limit=25)).get("data", []):
            if a.get("id") in seen:
                continue
            seen.add(a["id"])
            hits.append({
                "id": a["id"], "title": a.get("title") or "", "artist": (a.get("artist") or {}).get("name") or "",
                "record_type": a.get("record_type"), "nb_tracks": a.get("nb_tracks"),
            })
    for h in hits:
        if same_album(row.title, row.artist, h["title"], h["artist"]):
            h["year"] = _year((await _deezer(client, pacer, f"/album/{h['id']}")).get("release_date"))
    return hits


async def itunes_hits(client, pacer, row: ListRow) -> list[dict]:
    await pacer.wait()
    try:
        resp = await client.get(ITUNES_SEARCH, headers={"User-Agent": UA}, params={
            "term": f"{row.artist} {row.title}", "entity": "album", "country": "us", "limit": 25})
        body = resp.json() if resp.is_success else {}
    except (httpx.HTTPError, ValueError):
        return []
    return [{
        "id": a["collectionId"], "title": a.get("collectionName") or "", "artist": a.get("artistName") or "",
        "record_type": "album", "nb_tracks": a.get("trackCount"), "year": _year(a.get("releaseDate")),
    } for a in body.get("results", []) if a.get("collectionId")]


async def deezer_song_hits(client, pacer, row: ListRow, albums: dict[int, dict]) -> list[dict]:
    """Deezer track hits for a song row, each with its album's type, size and
    year (fetched once per album, kept in `albums`) — the song's release is
    chosen by them (bins.pick_song_release)."""
    from backend.trackkeys import artist_matches, match_title

    # The list prints guests and backing bands ("Willow feat. Travis Barker",
    # "Neil Young and Crazy Horse"); the catalog may file the song under the
    # lead alone, so that is searched too.
    lead = re.split(r"\s+(?:feat\.?|featuring|with|and|&)\s+", row.artist, maxsplit=1)[0]
    queries = [f'artist:"{row.artist}" track:"{row.title}"', f"{row.artist} {row.title}"]
    if lead != row.artist:
        queries += [f'artist:"{lead}" track:"{row.title}"', f"{lead} {row.title}"]
    seen, hits = set(), []
    for q in queries:
        for t in (await _deezer(client, pacer, "/search/track", q=q, limit=50)).get("data", []):
            a = t.get("album") or {}
            if not a.get("id") or t.get("id") in seen:
                continue
            seen.add(t["id"])
            hits.append({
                "track_title": t.get("title") or "", "artist": (t.get("artist") or {}).get("name") or "",
                "album_id": a["id"], "album_title": a.get("title") or "",
            })
    want = match_title(row.title)
    for h in hits:
        if not ((artist_matches(row.artist, h["artist"]) or artist_matches(lead, h["artist"]))
                and match_title(h["track_title"]) == want):
            continue
        if h["album_id"] not in albums:
            d = await _deezer(client, pacer, f"/album/{h['album_id']}")
            albums[h["album_id"]] = {"record_type": d.get("record_type"), "nb_tracks": d.get("nb_tracks"),
                                     "year": _year(d.get("release_date")),
                                     "album_artist": (d.get("artist") or {}).get("name")}
        h.update(albums[h["album_id"]])
    return hits


async def match_rows(rows: list[ListRow], overrides: dict[int, int], item_type: str = "album") -> list[dict]:
    """Each row with what it matched: source, id (the album's), the resolved
    album, status, and for a song bin the catalog's title for the song."""
    from backend.routers.search import resolve_album

    dz, it = _Pacer(DEEZER_PER_SECOND), _Pacer(ITUNES_PER_SECOND)
    album_info: dict[int, dict] = {}
    out = []
    async with httpx.AsyncClient(timeout=20, headers={"User-Agent": UA}) as client:
        for row in rows:
            source, hit, status = "deezer", None, "unmatched"
            if row.rank in overrides:
                hit, status = {"id": overrides[row.rank]}, "manual"
            elif item_type == "song":
                hits = await deezer_song_hits(client, dz, row, album_info)
                hit, status = pick_song_release(row.title, row.artist, row.year, hits)
                if hit is None:
                    lead = re.split(r"\s+(?:feat\.?|featuring|with|and|&)\s+", row.artist, maxsplit=1)[0]
                    hit, status = pick_song_release(row.title, lead, row.year, hits)
                if hit is not None:
                    hit = {**hit, "id": hit["album_id"]}
            else:
                hit, status = pick_release(row.title, row.artist, row.year, await deezer_hits(client, dz, row))
                if hit is None:
                    source = "itunes"
                    hit, status = pick_release(row.title, row.artist, row.year, await itunes_hits(client, it, row))
            resolved = None
            if hit is not None:
                try:
                    resolved = await resolve_album(source=source, id=str(hit["id"]))
                except Exception as e:  # noqa: BLE001 — a failed resolve is an unmatched row, said so
                    print(f"  #{row.rank} resolve failed: {type(e).__name__}: {e}")
                    status = "unmatched"
                if resolved is not None and not resolved.get("tracks"):
                    resolved, status = None, "unmatched"
            if resolved is None:
                status = "unmatched"
            out.append({"row": row, "source": source, "id": hit["id"] if hit else None,
                        "resolved": resolved, "status": status,
                        "song": (hit or {}).get("track_title") if item_type == "song" else None})
            r = resolved or {}
            mark = {"matched": " ", "manual": "=", "doubtful": "?", "unmatched": "✗"}[status]
            print(f"{mark} #{row.rank:>3} {row.artist} – {row.title} ({row.year})"
                  + (f"  →  {source} {hit['id']}: {r.get('artist')} – "
                     + (f"“{hit.get('track_title') or row.title}” on " if item_type == "song" else "")
                     + f"{r.get('album_name')} "
                     f"({r.get('year')}, {len(r.get('tracks') or [])} tracks)" if resolved else ""),
                  flush=True)
    return out


def write(meta, matched: list[dict]) -> int:
    from sqlmodel import Session, delete, select
    from backend.database import engine
    from backend.models import Bin, BinEntry

    with Session(engine) as s:
        b = s.exec(select(Bin).where(Bin.slug == meta.slug)).first()
        if b is None:
            b = Bin(slug=meta.slug, kind="curated", owner_id=None, visibility="published", title=meta.title)
        b.title, b.item_type, b.description = meta.title, meta.item_type, meta.description
        b.source_name, b.source_url, b.source_published = meta.source_name, meta.source_url, meta.source_published
        b.sort_order, b.ranked, b.entry_count = meta.sort_order, True, len(matched)
        b.updated_at = datetime.now(timezone.utc)
        s.add(b)
        s.flush()
        s.exec(delete(BinEntry).where(BinEntry.bin_id == b.id))
        for pos, m in enumerate(matched):
            row, r = m["row"], m["resolved"]
            # The catalog's artist — the primary credit, which every key is
            # built on (Apple prints "Prince and the Revolution", Deezer files
            # *Purple Rain* under Prince) — and the list's own title: the
            # catalog's says "Abbey Road (2019 Mix)" or "Exile On Main Street
            # (2010 Re-Mastered)", and a copy added from the bin takes the
            # entry's name (bins.copy_data). Keyed on the list's title, the
            # entry meets everyone's copy of the record whichever edition they
            # imported, since editions fold into one subject key.
            artist = r["artist"] if r else row.artist
            name = row.title
            song = None
            if meta.item_type == "song":
                # A song bin's entry is the song (the list's title for it) on
                # the album it came out on, as the catalog names that album.
                song, name = row.title, (r["album_name"] if r else "")
            s.add(BinEntry(
                bin_id=b.id, position=pos, rank=row.rank,
                artist=artist, album_name=name, year=row.year, song_title=song,
                subject_key=subject_key_album(artist, name),
                deezer_id=int(m["id"]) if r and m["source"] == "deezer" else None,
                cover_url=r.get("cover_url") if r else None,
                tracklist_json=json.dumps(r) if r else None,
                match_status="unmatched" if not r else ("manual" if m["status"] == "manual" else "matched"),
            ))
        s.commit()
        return b.id


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("csv", type=pathlib.Path)
    ap.add_argument("--dry-run", action="store_true", help="match and report; write nothing")
    ap.add_argument("--set", nargs=2, type=int, action="append", metavar=("RANK", "DEEZER_ID"),
                    help="pin a row to a Deezer album, kept in the JSON's overrides")
    args = ap.parse_args()

    meta_path = args.csv.with_suffix(".json")
    meta_json = json.loads(meta_path.read_text())
    if args.set:
        meta_json.setdefault("overrides", {}).update({str(r): d for r, d in args.set})
        if not args.dry_run:
            meta_path.write_text(json.dumps(meta_json, indent=2, ensure_ascii=False) + "\n")
    meta = parse_list_meta(json.dumps(meta_json))
    overrides = {int(k): int(v) for k, v in meta_json.get("overrides", {}).items()}
    rows = parse_list_csv(args.csv.read_text())

    print(f"[import_bin] {meta.slug}: {len(rows)} rows")
    matched = asyncio.run(match_rows(rows, overrides, meta.item_type))
    counts = {k: sum(1 for m in matched if m["status"] == k) for k in ("matched", "manual", "doubtful", "unmatched")}
    print(f"[import_bin] {counts}")
    for k in ("doubtful", "unmatched"):
        for m in matched:
            if m["status"] == k:
                print(f"[import_bin] {k}: #{m['row'].rank} {m['row'].artist} – {m['row'].title}")
    if args.dry_run:
        print("[import_bin] dry run: nothing written")
        return 0
    bin_id = write(meta, matched)
    print(f"[import_bin] wrote bin {bin_id} ({meta.slug}), {len(matched)} entries")
    return 0


if __name__ == "__main__":
    sys.exit(main())
