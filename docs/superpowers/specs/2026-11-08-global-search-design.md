# Global search — design

2026-11-08. Agreed with Jack in conversation; calls marked *(builder's call)* were
made in writing this up and are open to change.

## Why

Finding anything in Pressd means knowing first where it lives:

- someone you don't know: Social → Friends → Find friends;
- a friend: scroll the friends list on Social → Friends;
- a record you haven't added: the Add an album button;
- a record you've rated, or one you're curious about: scroll your own library, or
  find it again through Add an album;
- a song: nowhere — nothing searches songs.

One search box replaces knowing the route. You type, and whatever matches comes back,
whatever kind of thing it is. Success: any person, record, artist or song is two taps
and a few letters from For You.

## Goals

- One search across **people, albums, artists and songs**, on **both platforms**
  (CLAUDE.md §1: features stay in lockstep; layouts may differ).
- Opened from a **search icon at the top right of For You, in place of the date**.
- Albums from three places in one list: **your own copies**, **records others on
  Pressd have rated**, and **records nobody on Pressd has yet** (the catalogs, as Add an
  album finds them today).
- Songs searchable for the first time.

## Non-goals

- **The old routes stay.** Find friends, the friends list and Add an album keep
  working as they do; search is the fast way in, not their replacement.
- No song page. A song result opens its record (below).
- No search beyond names and titles: no lyrics, reviews, threads, genres or tags.
- No search service (Algolia, Elasticsearch). The data is small (124 users, ~1,100
  distinct records, ~500 artists, ~15,000 tracks, November 2026); Postgres name
  matching is milliseconds.

## Anti-goals

- **Never show private fields of another user.** People results carry only what
  `/users/search` rows carry today (`_with_relationship`: id, name, avatar, and where
  you stand) — never email, phone, location or anything from `own_user`.
- **Never split one record into several rows.** Pressd's records group on
  `Album.subject_key` (CLAUDE.md §12: any grouping across users goes through
  `trackkeys.py`); songs on `track_id`. "Take Care" and "Take Care (Deluxe)" are one
  result.
- **Never let the slow catalog lookup hold up Pressd's own results.**
- Not a way round the rating flow or `thread_access`: search opens the pages that
  already exist, under their existing rules.

## The screen (option A, chosen by Jack from mockups)

### Opening

- The date at the top right of For You (`mobile/app/(tabs)/index.tsx` masthead,
  `styles.date`; web `frontend/src/pages/ForYou.tsx` header, `dateStr`) is replaced by
  a **search icon**.
- Tapping it opens **its own search screen** with the keyboard up and the box focused.
  **Cancel** returns to For You where you were.
- Mobile: a new route (*builder's call:* `mobile/app/search.tsx`, pushed over the tabs).
  Web: a new route (*builder's call:* `/search`, inside `Layout`), the same icon in the
  same place on For You, and a wide page — the memory rule is that web fills the
  desktop width. *(Builder's call:* on web the groups sit in columns rather than one
  long column.)

### Before typing

Your **last few searches** (*builder's call:* the last 8 tapped results, not typed
strings — a row you can tap straight back into), kept on the device: mobile in
`mobile/lib/prefs.ts`' Keychain store, web in `localStorage` (both already hold
per-device conveniences). **Keyed by user id and cleared on sign-out**, so a shared
device never shows one account's searches to the next. *(Builder's call.)* A way to
clear them. Nothing else — no suggestions, no trending.

### While typing

Results update as you type (*builder's call:* debounced ~200 ms, from 2 characters),
in groups, in this order:

1. **People** — friends first, then everyone else.
2. **Albums** — one row per record (`subject_key`, any edition). Your own copy first,
   in any shelf: rated shows **your score**, Listening or To Listen shows that status.
   Then records **others have rated** (at least one rated copy — the community page's
   own condition), showing the **Pressd average** (`avg_score`, PRESSD AVG). Records
   that sit only in other people's To Listen or Listening aren't in this group; the
   catalogs cover them. **Singles (≤ 2 tracks) are included** — Jack's decision, unlike
   libraries and charts, which leave them out: search is for finding a thing, and a
   single is a thing people look for. Scores to two decimals (CLAUDE.md §12).
   *(Builder's call: the on-Pressd condition.)*
3. **Artists** — artists credited on at least one record in the Albums group's sense
   (a rated copy by anyone, or your own copy), with the number of such records as the
   subline. *(Builder's call.)*
4. **Songs** — one row per `track_id`, from the same records as the Albums group (so a
   tap never lands on a record with no page), labelled with the record it's on.
   *(Builder's call.)*
5. **From the catalogs** — the existing multi-source album search
   (`shared/src/hooks/useAlbumSearch.ts` / `albumSearch.ts`), **minus records already
   on Pressd**, filled in when it arrives without holding the rest. The record key is
   computed only in Python (`trackkeys`), so the client doesn't compute it: it sends the
   catalog hits' names and artists to the server (*builder's call:* `POST
   /search/known` with `[{name, artist}]`, returning the `subject_key` and Pressd copy id
   of each one Pressd has), and drops those, checked against every Pressd match, not just
   the four shown. No TypeScript copy of the key, which would drift.

Each group shows its **top 3–4**, with **See all** opening that group's full list
(*builder's call:* the same screen filtered to that group, up to 25). A group with no
matches is left out; nothing matching at all says so in one line.

Ranking within a group (*builder's call*): exact match, then prefix (of the name or of
any word in it), then contains; ties by how many people on Pressd rated it (records,
artists, songs) or by friendship (people).

### Tapping a result

| Result | Opens |
|---|---|
| A person | their profile (mobile `useOpenProfile`; web `/u/:id`) |
| Your own copy | your copy (`/album/:id`) |
| A record others rated, that you don't own | its Pressd page (web `/album/:id/community`; mobile's community view of `album/[id]`) |
| An artist | the artist page (web `/artist/:name`, mobile `app/artist/[name].tsx`), with the credited name as written — a co-credited artist's own name, which the page already resolves through `album_artists` |
| A song | its record's Pressd page, **scrolled to that track and highlighted**. If you own the record and have **rated** it, your copy, scrolled and highlighted the same way. If your copy is unfinished (Listening / To Listen), your copy opens as it would from your library, **with no highlight and no jump**: the first-pass rule (CLAUDE.md §1, songs unlock in order) is never bypassed by a search. *(Builder's call.)* |
| A catalog album | **Rate** or **Add to library**, as Add an album offers them today (resolve, then import) |

Tapping a result records it in recent searches.

## How it gets made

- **One new endpoint**, `GET /search/all?q=` (*builder's call:* in a new
  `backend/routers/search_all.py`, or beside `/users/search`), behind `current_user`
  — the four existing `/search/*` catalog proxies are deliberately open; this one reads
  Pressd's users and libraries, so it isn't. Returns `{people, albums, artists,
  songs}`, each capped (*builder's call:* 4 each, `?group=<name>&limit=25` for See
  all). Matching with `ILIKE` on the folded name/title; *builder's call:* fold
  diacritics the way `trackkeys` does, so "kaytramine" finds *KAYTRAMINÉ*.
  - albums: one row per `subject_key`; the caller's copy if they have one, else the
    most-rated copy, with rater count and Pressd average;
  - artists: from `album_artists` (CLAUDE.md §12: a co-credited record belongs to each
    of its artists), so a collaboration shows under both;
  - songs: one row per `track_id`, title from the most common spelling (§12: the title
    is only a label);
  - people: `_with_relationship` rows, friends first.
- **`shared/src/api.ts`**: `searchAll(q, group?)`, camelCase at the boundary, plus the
  result types in `shared/src/types.ts`.
- **Both clients**: the icon on For You, the search screen, recent searches, and the
  song-highlight parameter on the record page (*builder's call:* `?track=<track_id>`).
- Platform rules from CLAUDE.md §12 apply: `VinylSpinner` while waiting, covers through
  `CoverImg` / `CoverImage` with `coverUrl`, dark mode via tokens (web `--c-…`
  variables; mobile `colors` / `useColors`, borders from `tc`), Playfair italic for
  album titles, no grey helper captions (memory rule).
- **CLAUDE.md** gains the endpoint, the screen and the For You header change in the
  same commit.

## Left to the builder

Everything marked *builder's call*, the exact icon, spacing and motion (web's
`page-enter` / `rise-in` vocabulary; mobile's existing push transition), empty-state
wording, and keyboard handling on web (Esc closes; arrow keys and Enter move through
results).
