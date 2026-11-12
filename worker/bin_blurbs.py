"""Write a one-sentence blurb for each record (or song) in a bin.

    python -m worker.bin_blurbs apple-music-100-best-albums --dry-run
    python -m worker.bin_blurbs apple-music-100-best-albums
    python -m worker.bin_blurbs <slug> --force            # write every blurb again

The blurb is Pressd's own sentence, drawn under a row on the bin's page. The
lists' editorial write-ups are their publishers' and are never copied: Claude
is given only the facts — artist, title, year, genre, and for a song the
album it came out on — and asked for a factual line of its own.

Reusable for every bin. The blurbs live in `data/bins/<slug>.blurbs.json`,
keyed by the list's rank, versioned with the list, and in `BinEntry.note`,
which the bin's page serves as `blurb`; worker/import_bin.py sets `note` from
the file on every re-import, so a re-match never loses them. A run asks only
for ranks the file lacks (all of them with --force) and then writes the whole
file to the database — so correcting a blurb is editing the file and running
this again. --dry-run asks Claude and prints, writing neither.

The database connection is held only to read the entries and to write the
notes, never across a Claude call (CLAUDE.md §7, connection discipline).
"""
import argparse
import json
import os
import pathlib
import re
import sys

from dotenv import load_dotenv

load_dotenv()

DATA = pathlib.Path(__file__).resolve().parent.parent / "data" / "bins"
MODEL = "claude-opus-5-5"
BATCH = 20
MAX_WORDS = 24

ALBUM_BRIEF = (
    "For each album below, write one sentence about the record: what it is and what it's "
    "known for — its sound, how it was made, a defining song, its place in the artist's "
    "work or in music history. Facts only: nothing you aren't confident is true."
)
SONG_BRIEF = (
    "For each song below, write one sentence about the song: what it sounds like, what it's "
    "about, how it came about, or its place in the artist's work or in rock history. "
    "Facts only: nothing you aren't confident is true."
)
RULES = (
    f"Rules: at most {MAX_WORDS - 2} words. Plain, specific and evocative, never promotional — "
    "no 'iconic', 'masterpiece', 'timeless', 'groundbreaking', 'genre-defining', 'must-listen'. "
    "No opinions of quality, no scores or rankings, no mention of any list. Don't start with "
    "'This album', 'This song', the title or the artist's name. Don't repeat the year or genre "
    "given. Put song titles in double quotes.\n\n"
    'Answer with JSON only: an object mapping each id to its sentence, e.g. {"1": "…", "2": "…"}.'
)


def blurbs_path(slug: str) -> pathlib.Path:
    return DATA / f"{slug}.blurbs.json"


def load_blurbs(slug: str) -> dict[int, str]:
    """The bin's stored blurbs by rank ({} when it has none yet)."""
    p = blurbs_path(slug)
    if not p.exists():
        return {}
    return {int(k): v for k, v in json.loads(p.read_text()).items() if v}


def save_blurbs(slug: str, blurbs: dict[int, str]) -> None:
    body = {str(k): blurbs[k] for k in sorted(blurbs)}
    blurbs_path(slug).write_text(json.dumps(body, indent=2, ensure_ascii=False) + "\n")


def _entries(slug: str) -> tuple[str, list[dict]]:
    from sqlmodel import Session, select
    from backend.database import engine
    from backend.genres import canonical_genre
    from backend.models import Bin, BinEntry

    with Session(engine) as s:
        b = s.exec(select(Bin).where(Bin.slug == slug)).first()
        if b is None:
            raise SystemExit(f"[bin_blurbs] no bin {slug!r}; import it first (worker.import_bin)")
        rows = s.exec(select(BinEntry).where(BinEntry.bin_id == b.id).order_by(BinEntry.position)).all()
        out = []
        for e in rows:
            resolved = json.loads(e.tracklist_json) if e.tracklist_json else {}
            out.append({
                "rank": e.rank if e.rank is not None else e.position + 1,
                "artist": e.artist, "album": e.album_name, "song": e.song_title, "year": e.year,
                "genre": canonical_genre(resolved.get("genre")) if resolved else None,
                "note": e.note,
            })
        return b.item_type, out


def _line(e: dict, item_type: str) -> str:
    if item_type == "song":
        bits = [f'"{e["song"]}" by {e["artist"]}']
        if e["album"]:
            bits.append(f'from the album "{e["album"]}"')
    else:
        bits = [f'"{e["album"]}" by {e["artist"]}']
    if e["year"]:
        bits.append(str(e["year"]))
    if e["genre"] and item_type != "song":
        bits.append(e["genre"])
    return f'{e["rank"]}: ' + ", ".join(bits)


def _parse(text: str) -> dict:
    text = text.strip()
    fence = re.search(r"```(?:json)?\s*(.*?)```", text, re.S)
    if fence:
        text = fence.group(1)
    start = text.find("{")
    if start < 0:
        raise ValueError("no JSON object in the answer")
    # The first object, whatever follows it (a note, a second block).
    return json.JSONDecoder().raw_decode(text[start:])[0]


def _clean(s: str) -> str | None:
    s = " ".join(str(s).split())
    # A sentence wrapped whole in quotes loses them; a title's quotes stay.
    if len(s) > 1 and s[0] == s[-1] == '"' and s.count('"') == 2:
        s = s[1:-1].strip()
    if not s or len(s.split()) > MAX_WORDS + 4:  # a rambling answer is dropped, asked again next run
        return None
    return s if s.rstrip('"\'').endswith((".", "!", "?")) else s + "."


def ask(client, batch: list[dict], item_type: str) -> dict[int, str]:
    brief = SONG_BRIEF if item_type == "song" else ALBUM_BRIEF
    prompt = brief + "\n\n" + RULES + "\n\n" + "\n".join(_line(e, item_type) for e in batch)
    resp = client.messages.create(
        model=MODEL,
        max_tokens=8000,
        messages=[{"role": "user", "content": prompt}],
        extra_body={"output_config": {"effort": "low"}},
    )
    if resp.stop_reason in ("refusal", "max_tokens"):
        print(f"[bin_blurbs] batch from #{batch[0]['rank']} stopped ({resp.stop_reason}); skipped")
        return {}
    text = "".join(b.text for b in resp.content if getattr(b, "type", None) == "text")
    try:
        data = _parse(text)
    except (ValueError, json.JSONDecodeError) as exc:
        print(f"[bin_blurbs] batch from #{batch[0]['rank']}: unreadable answer ({exc}); skipped")
        return {}
    wanted = {e["rank"] for e in batch}
    out = {}
    for k, v in data.items():
        if str(k).isdigit() and int(k) in wanted and (c := _clean(v)):
            out[int(k)] = c
    return out


def write_notes(slug: str, blurbs: dict[int, str]) -> int:
    """Set every entry's note from the file; returns how many changed."""
    from sqlmodel import Session, select
    from backend.database import engine
    from backend.models import Bin, BinEntry

    changed = 0
    with Session(engine) as s:
        b = s.exec(select(Bin).where(Bin.slug == slug)).one()
        for e in s.exec(select(BinEntry).where(BinEntry.bin_id == b.id)).all():
            want = blurbs.get(e.rank if e.rank is not None else e.position + 1)
            if want is not None and e.note != want:
                e.note = want
                s.add(e)
                changed += 1
        s.commit()
    return changed


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("slug")
    ap.add_argument("--dry-run", action="store_true", help="ask and print; write nothing")
    ap.add_argument("--force", action="store_true", help="write every blurb again")
    args = ap.parse_args()

    item_type, entries = _entries(args.slug)
    blurbs = {} if args.force else load_blurbs(args.slug)
    todo = [e for e in entries if e["rank"] not in blurbs]
    print(f"[bin_blurbs] {args.slug}: {len(entries)} entries, {len(todo)} to write")

    if todo:
        import anthropic
        client = anthropic.Anthropic(api_key=os.environ.get("ANTHROPIC_API_KEY"))
        for i in range(0, len(todo), BATCH):
            batch = todo[i:i + BATCH]
            got = ask(client, batch, item_type)
            for e in batch:
                if e["rank"] in got:
                    print(f"  #{e['rank']:>3} {e['song'] or e['album']} — {got[e['rank']]}", flush=True)
                else:
                    print(f"  #{e['rank']:>3} {e['song'] or e['album']} — (none)", flush=True)
            blurbs.update(got)
            if not args.dry_run:
                save_blurbs(args.slug, blurbs)  # after each batch, so a failure keeps what came back

    if args.dry_run:
        print("[bin_blurbs] dry run: nothing written")
        return 0
    missing = sum(1 for e in entries if e["rank"] not in blurbs)
    changed = write_notes(args.slug, blurbs)
    print(f"[bin_blurbs] {len(blurbs)} blurbs in {blurbs_path(args.slug).name}; {changed} notes written; {missing} missing")
    return 1 if missing else 0


if __name__ == "__main__":
    sys.exit(main())
