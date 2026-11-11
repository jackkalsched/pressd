# Bins — design

2026-11-11. Brainstormed with a research agent; decisions below are Jack's unless marked
*my call*. The agent's full brief (research notes, rejected approaches) informed this and
is not kept in the repo.

## 1. What a bin is

A **bin** is an ordered collection of records **or** songs — never both in one bin. Two
kinds share one model:

- **Curated** — made by Pressd from a published list. No owner. Credited to its source
  ("Apple Music · 2024", not linked), shown under the source's own title. No artwork,
  logos or editorial blurbs copied from the source: rank, title, artist and year only.
- **User** — made by a person (v2): "for her", "My fall collection". Private, unlisted or
  published; optionally ranked; a note per entry.

A bin **points at records**; it never holds anyone's copies. To Listen, the library and
the shelf stay as they are. Adding a record from a bin is an ordinary Rate now or Add to
To Listen: the copy goes where the user put it and **does not remember the bin** (no
`from_bin` column).

## 2. Decisions

| # | Question | Decision |
|---|---|---|
| 1 | Mixed albums + songs in one bin? | No. `item_type` is `album` or `song`. |
| 2 | First bin's name | Apple's own: **Apple Music 100 Best Albums**, credited. |
| 3 | Where bins are found | For You section **and** a menu entry: web's sidebar; on iPhone, a new **side menu** (≡) beside the search icon in For You's masthead. |
| 3b | Library | A **Bins** tab beside Rated / Listening / To Listen, holding the user's **own** bins — arrives with user bins (v2). |
| 4 | Tag copies added from a bin? | No. They land wherever the user put them. |
| 5 | Fold the shelf into bins? | No. |
| 6 | Source artwork / blurbs? | No — facts and a link. |
| 7 | Song bins soon? | Yes, straight after v1 (Rolling Stone's 200). |
| 8 | Published bins visible signed-out? | Yes, later (v3), published only, without the owner's scores. |
| — | "Pressd vs the list" | Waits until most entries have 3+ raters (*my call*, agent's recommendation). |

## 3. Data model

New tables only — `create_all` builds them and the last migration enables RLS; no
`ALTER TABLE` lines.

```python
class Bin(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    slug: str = Field(unique=True, index=True)   # 'apple-music-100-best-albums'; user bins random
    kind: str = Field(index=True)                 # 'curated' | 'user'
    owner_id: int | None = Field(default=None, foreign_key="pressuser.id", index=True)
    item_type: str                                # 'album' | 'song'
    title: str                                    # ≤ 60
    description: str | None = None                # ≤ 280, plain text
    ranked: bool = True
    visibility: str = "published"                 # private | unlisted | published
    source_name: str | None = None                # curated: 'Apple Music'
    source_url: str | None = None
    source_published: date | None = None
    entry_count: int = 0
    hidden_at: datetime | None = None             # moderation (v2)
    created_at / updated_at: TIMESTAMPTZ

class BinEntry(SQLModel, table=True):
    id, bin_id (FK, index), position (0-based order), rank (source's printed rank)
    note: str | None                              # ≤ 280, user bins only
    artist, album_name, year                      # the catalog's spelling, after matching
    subject_key: str (index)                      # trackkeys.subject_key_album — the join to copies
    deezer_id, cover_url
    tracklist_json                                # resolved tracklist: adding needs no outbound call
    match_status: 'matched' | 'unmatched' | 'manual'
    song_title, track_id (FK track, nullable), track_ref ('' for albums)   # song bins
    unique (bin_id, subject_key, track_ref)
```

- **Albums join on `subject_key`**, never an `Album` id. The caller's progress and per-row
  status is one indexed query (`Album.user_id = me AND subject_key IN …`); the PRESSD AVG
  per row is one grouped query over rated copies, the community page's own number.
- **Songs** carry `track_id` when the `Track` exists, else `track_ref` (the recording key an
  import would produce, matched on `tracklink`'s base key) and are filled in lazily on read.
- An album bin refuses a ≤ 2-track record (`is_single_release`).
- Private bins are a 404 to anyone else; owners appear only as `public_user`;
  `delete_own_account` deletes a user's bins and entries.

## 4. Getting a list in

`python -m worker.import_bin data/bins/<slug>.csv [--dry-run] [--set RANK DEEZER_ID]` —
reusable for every list; the CSV (`rank,artist,title,year`, songs add `album`) plus a
sibling metadata JSON stays in the repo as the bin's record of where it came from.
Re-running upserts by `(slug, rank)`.

Matching, per entry: Deezer album search, a hit accepted only when `same_album` agrees and
the year is within one; prefer `record_type` album, then the standard edition, then the
fewest tracks; fall back to iTunes, then MusicBrainz. Store the catalog's artist and name
(so `subject_key` matches what an import produces — Apple's "Prince and the Revolution" vs
the catalog's "Prince"), Deezer id, cover and tracklist. Songs: Deezer track search,
preferring the original studio album over live albums and compilations. The dry run lists
matched, doubtful and unmatched entries for Jack to check. An unmatched entry is still
stored and shown in place (no cover, no buttons), so 100 stays 100.

Apple's list is transcribed once from 100best.music.apple.com and checked against
Wikipedia's table. Never scraped at runtime.

## 5. Endpoints (v1)

- `GET /bins` → curated (and later published) bin cards: title, cover (2×2 of the first
  four entries' covers), entry count, the caller's progress.
- `GET /bins/{slug}` → the bin and its entries resolved for the caller: their copy
  `{id, status, score}`, PRESSD AVG and rater count, predicted score (only when
  `predictions_unlocked`).
- Per-entry Rate now / Add use the existing import path (`/discover/deezer/{id}` →
  `/albums/import`, as search's catalog rows do).
- `shared/src/api.ts`: `fetchBins`, `fetchBin`, `addBinToListen`.

## 6. Surfaces (both platforms)

- **For You:** a BINS section (`SectionHead`, "See all →"). With one bin, a single
  `SpotlightCard`-style card: 2×2 cover, title, progress bar and "34 / 100".
- **Menu:** web — **Bins** in the sidebar (`/bins`). iPhone — a ≡ button beside the search
  icon in For You's masthead opens a side menu sliding in from the left; Bins is its
  first entry (*my call*: a menu built to take more entries later; v1 holds Bins only).
- **Bins index:** web `/bins`, mobile `app/bins/index.tsx` — the bin cards.
- **Bin page:** web `/bins/:slug`, mobile `app/bins/[slug].tsx`.
  - Header: cover, title in Playfair, the source line, progress bar and
    "34 of 100 rated".
  - Sort pills **List / Pressd / For you** (For you only when predictions are unlocked;
    records without a prediction sort last) and **All / Not rated**.
  - Rows: rank in Playfair, cover, title and artist in Add an album's type; on the right
    your score (two decimals, score colour), your status, or **Rate now / Add**; PRESSD AVG
    beside it. A tap opens your copy, otherwise the community view by name.
  - Web: full width, sticky header column as on the album pages. Mobile: one column; the
    title scrolls to top.
- Waits use `VinylSpinner`; covers `CoverImg` / `CoverImage`; colours per the dark-mode
  rules.

## 6b. Predictions

**Rule (Jack, 2026-11-11): every album in a bin must be considered for every user's picks
predictions** — scored nightly into `albumprediction` whether or not anyone has added it.
Not met at v1: `catalog_predict` builds its catalog from copies with analysed audio. Needs
bin entries as catalog records (tracks → audio ingest, `albumfactors`, `catalog_albums`).
"Add the rest to To Listen" was dropped (Jack, 2026-11-11).

## 7. Phases

1. **v1 — the Apple 100.** Tables; `worker/import_bin.py` + the Apple CSV; three
   endpoints + the shared client; For You section, sidebar entry, iPhone side menu, index
   and bin page on both platforms; tests for CSV parsing, matching preference and the
   progress logic; CLAUDE.md.
2. **v1.5 — song bins.** Rolling Stone's *200 Greatest Rock Songs of the 21st Century So
   Far* (title and full list verified against the source when transcribed). Song score and
   Pressd song average by `track_id`; a tap opens the album with `?track=`.
3. **v2 — user bins.** Create, edit, reorder, notes, ranked toggle, visibility;
   **Library → Bins** tab (own bins); "Add to bin…" from the album page's menu and search
   (never inside the rating flow); a profile section; reports (`BinReport`, five hide a
   bin, as posts).
4. **v3.** Save/follow bins, friends' progress, where Pressd disagrees with the list,
   recommend a bin, share links and signed-out published bins, a thread per bin.
