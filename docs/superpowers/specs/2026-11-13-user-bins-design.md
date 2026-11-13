# User bins — design

2026-11-13. Brainstormed with a research agent; decisions are Jack's unless marked *my call*.
Builds on `2026-11-11-bins-design.md` (curated bins), whose §7 sketched this phase.

## 1. What a user bin is for

A bin is **how the app learns which albums to predict**. Putting an album in any bin tells
Pressd to give every user a prediction for it (the curated rule, CLAUDE.md §5) — that is the
purpose, not a side effect. Bins are **not a social surface**: no likes, comments, follows or
notifications. People see each other's public bins only as lists to browse.

## 2. Scope (v1)

- **Albums and EPs only.** Song bins later.
- **Any album in the catalog**, held on Pressd or not (resolved like an import, stored as
  `tracklist_json`, as curated entries are). **Never an unreleased album** (refused at add)
  and never a single (≤ 2 tracks).
- An entry is a **record** (`subject_key`), never a copy; one record once per bin.
- **At most 100 albums a bin, 25 bins a person.**
- Optional **ranked** order (the list's order is the rank) — *my call*: kept from the model.
- **Optional note per album**, up to 280 characters; a **description** for the bin, up to 500.
- **Cover**: the 2×2 of the first four albums by default; the owner **may upload an image**
  instead (square, normalised like banners: EXIF stripped, rotation applied, pixel-bomb guard),
  and remove it to go back to the mosaic.

## 3. Visibility

- **Private** — the owner only. **Public** — anyone signed in, listed under "From the
  community" and found by search. No unlisted level. A new bin is **private**; the owner can
  switch it to public (and back) at any time.
- **Every bin feeds predictions, private included** (§1). The one exception: a bin hidden by
  reports (§6) stops counting. One SQL rule in `backend/bins.py` says which bins count, and
  every reader of `binentry` uses it — `catalog_predict.bin_records`, the audio queue,
  `link_bin_entries`, the factors backfill, `song_score_model` (today all five read every
  bin unchecked).
- Cost: albums only a user bin holds queue for audio **behind** curated bins' tracks, inside
  the existing nightly cap (`BIN_TRACKS_PER_RUN`, 700). The size limits bound the rest.

## 4. Account deletion

- **Private bins are deleted** with the account (entries, their `bintrack` rows, cover).
- **Public bins stay**, ownerless (`owner_id` null), shown as by "a former Pressd member" —
  as recommendations sent stay with their recipients, unnamed. Their notes, description and
  uploaded cover stay with them (published content, like a public post's place in a thread).
  *Open: if Jack would rather a deleted account's public bins go too, this becomes one
  `DELETE`.*
- Fixes the existing order bug: `delete_own_account` deletes `binentry` without its
  `bintrack` rows first, which fails on the foreign key once a user owns a bin.

## 5. Where you make and edit them (both platforms)

- **Bins page**: "New bin" (web button, iPhone +); a **Your bins** section above Pressd
  Official and From the community.
- **Your bin's page**: an edit mode — title, description, ranked, visibility, cover (upload /
  remove), drag to reorder, remove, a note per row (shown where blurbs show). "Add albums":
  your library plus a catalog search (Add an album's search).
- **Album pages** (your copy and the community view): **Add to bin…** — your bins, plus New bin.
  Never inside the rating flow.
- Someone else's public bin reads like a curated one: your own progress, Sort by, search,
  Rate now / Add.

## 6. Moderation

Report a bin (`BinReport`, one per user and bin); five distinct reporters hide it
(`hidden_at`, as `REPORTS_TO_HIDE` in discussions); a report hides it from the reporter at
once. Blocking hides each other's bins. Titles, descriptions and notes are plain text with
length limits; covers are unmoderated, as avatars and banners are. Terms and Community
Guidelines mention bins.

## 7. For You's BINS section

Up to three cards: **at least one Pressd Official bin**, the rest **public community bins at
random** (re-drawn per load; none hidden, blocked or the caller's own — *my call*). Curated
fill the rest when the community has too few.

## 8. Ordering of From the community

**Most popular first** (Jack). With no likes, popularity is **how many different people
opened the bin in the last 30 days**, the owner not counted (*my call*): `BinView (bin_id,
user_id, viewed_at)`, one row per person per bin, its time refreshed by `GET /bins/{slug}`.
Ties, and bins nobody has opened yet, go newest first (`updated_at`). The count is never
shown — it orders the list, nothing more, since bins aren't a social surface.

## 8a. Global search

Bins come up in the app's one search box (`/search/all`, both platforms' search screens): a
**Bins** group beside People, Albums, Artists and Songs, matching title and description
(`binCardMatches`' rules: case, accents and punctuation ignored, every word required). It
returns Pressd Official bins, public community bins (not hidden, not blocked either way) and
the caller's own bins, private included — never anyone else's private bin. Ranked: your own
first, then Official, then by §8's popularity. A row is the bin's mosaic or cover, title, and
"N albums · by {name}" (Pressd for Official); a tap opens the bin. Recents keep it like any
other result.

## 9. Data and API (sketch)

- `Bin`: existing `kind` user, `owner_id` (nullable), `description`, `ranked`, `visibility`
  (private | published), `hidden_at`, `updated_at`; random slug for user bins; new
  `cover_url`. New tables `BinCover (bin_id, content_type, data, updated_at)`,
  `BinReport (user_id, bin_id, reason, created_at)` and `BinView (bin_id, user_id,
  viewed_at)`; `delete_own_account` deletes the user's reports and views.
- `GET /bins?scope=mine|community|for_you`, `POST /bins`, `PATCH`/`DELETE /bins/{slug}`,
  `POST /bins/{slug}/entries` (`album_id`, or a resolved catalog release), `PATCH`/`DELETE
  /bins/{slug}/entries/{id}` (note / remove), `PUT /bins/{slug}/order`,
  `POST`/`DELETE`/`GET /bins/{slug}/cover`, `POST /bins/{slug}/report`; `/search/all` gains the `bins` group. Owner-only writes;
  `GET /bins/{slug}` admits a public bin to anyone, a private one to its owner, 404 for
  hidden or blocked; adds `owner` (`public_user` or null) and `can_edit`.
- Tests: permissions, the limits, reorder, the prediction rule, the delete order, popularity
  order, and search never returning someone else's private bin.

## 10. Later

Song bins; a Bins shelf in Library and on profiles; copying a bin; "where Pressd disagrees".
