# Global Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One search across people, albums, artists and songs on Pressd (plus catalog albums), opened from a search icon that replaces the date at the top right of For You, on web and iPhone.

**Architecture:** A pure ranking module (`backend/search_rank.py`) decides matching, order and grouping over plain rows; a thin router (`backend/routers/search_all.py`) fetches candidate rows from Postgres and hands them to it. The shared client adds `searchAll` / `searchKnown` and a storage-agnostic recent-searches list. Each app gets a search screen that shows Pressd's groups at once and the catalog group (the existing `useAlbumSearch`) when it arrives, minus records the server says Pressd already has.

**Tech Stack:** FastAPI + SQLModel on Postgres; pytest (no DB connection); React 19 + React Router + TanStack Query 5 + Tailwind 4 (web); Expo 57 + expo-router (iPhone); `@pressd/shared` TS.

**Spec:** `docs/superpowers/specs/2026-11-08-global-search-design.md`

## Global Constraints

- Every endpoint here is behind `current_user` (`backend/deps.py`); identity never comes from a client-supplied id.
- A person result carries only `users._with_relationship` fields (id, name, avatar, relationship flags) — never email, phone, location, or anything from `own_user`.
- Records group on `Album.subject_key`; songs on `track_id`. Never group by raw name/title (CLAUDE.md §12).
- Albums group: the caller's own copies in any status, plus records with ≥ 1 copy `status = 'rated'` by anyone. **Singles (≤ 2 tracks) are included.**
- Artists and songs come only from records that qualify for the Albums group.
- Per-group preview limit `PREVIEW = 4`; See all limit `FULL = 25`; recent searches `RECENT_MAX = 8`; client debounce 200 ms; minimum query length 2 characters (after trim).
- Album scores to two decimals (`8.20`), never one.
- A song tap never jumps ahead in an unfinished copy: highlight only on a rated copy or a community page.
- The catalog group never holds up Pressd's groups, and drops any record `POST /search/known` reports Pressd has.
- Recent searches are stored per user id and cleared on sign-out.
- Web: colours only as `var(--c-…)` / `text-(--c-…)` classes, `VinylSpinner` for waits, `CoverImg` for covers with `coverUrl`, motion from `index.css`'s vocabulary, page fills the desktop width. iPhone: `colors.X` in styles, `tc.X` (`useColors()`) for icons/SVG and every border, `VinylSpinner`, `CoverImage`.
- Album titles in Playfair italic (web `<i>` inside `.font-display`; mobile `fonts.displayItalic`). No grey helper captions under headings. User-facing name is "Pressd".
- The existing `frontend/src/pages/Search.tsx` is an orphan and stays untouched; the new web page is `GlobalSearch.tsx`.
- Commits go to a feature branch; nothing reaches `main` without Jack asking. No `Co-Authored-By` or other Claude attribution lines in commits.

## Review Focus

- A query with diacritics or none ("kaytramine" vs *KAYTRAMINÉ*, "beyonce" vs Beyoncé) should find the record either way — Task 1 pins `fold`.
- Punctuation and SQL wildcards in the query (`%`, `_`, `'`, `AC/DC`) must not break or widen the search — Task 2 escapes `ILIKE` patterns and tests the escape.
- Two editions of one record ("Take Care", "Take Care (Deluxe)") must come back as one album row — Task 1 tests grouping on `subject_key`.
- A song whose record you are mid-way through must open your copy with no highlight — Task 3's `songTarget` decides it once for both apps (there is no TS test runner, so Task 3's verification step checks its three cases with a one-off `npx tsx -e` call), and Tasks 4 and 5 route through it, never around it.
- Typing fast must not show an older query's results over a newer one's — Tasks 4 and 5 key the query on the debounced string (TanStack Query) so stale responses are dropped.

---

### Task 1: Ranking and grouping (pure)

**Files:**
- Create: `backend/search_rank.py`
- Test: `tests/test_search_rank.py`

**Interfaces:**
- Produces:
  - `fold(s: str | None) -> str` — NFKD, casefold, combining marks dropped, every run of non-alphanumerics → one space, trimmed.
  - `match_rank(q: str, name: str) -> int | None` — both folded inside; `0` exact, `1` name starts with q, `2` a word of name starts with q, `3` q anywhere in name, `None` no match.
  - Row inputs are plain objects/dicts with these attributes:
    - `AlbumCand`: `id, user_id, album_name, artist, subject_key, status, score, art_url, extra_artists, track_count`
    - `SongCand`: `track_id, title, album_id, album_name, artist, subject_key, user_id, status`
    - `PersonCand`: the `_with_relationship` dict (`already_friends`, `request_sent`, `request_received`, `name`, …)
  - `albums_group(q, cands, me, limit) -> list[dict]` — one row per `subject_key`: `{album_id, name, artist, art_url, mine: bool, status, your_score, pressd_avg, raters}`. The caller's copy (by `user_id == me`) represents the record when present; otherwise the copy of that record most others have (`raters` = count of rated copies, `pressd_avg` = plain mean of rated copies' `score`, rounded to 2). A record qualifies only if `mine` or `raters >= 1`. Order: mine first, then `match_rank` on the better of album name / artist, then `raters` desc.
  - `artists_group(q, cands, me, limit) -> list[dict]` — `{name, records}`; a record counts for **each** credited artist (`backend.credits.album_artists`), over qualifying records only; order by `match_rank`, then `records` desc. Distinct by `artist_key`.
  - `songs_group(q, cands, me, limit) -> list[dict]` — one row per `track_id`: `{track_id, title, album_id, album_name, artist, mine, status}`; title is the most common spelling across copies; the row points at the caller's copy when they own the record, else the record's most-rated copy; qualifying records only; order by `match_rank` on title, then number of copies desc.
  - `people_group(q, rows, limit) -> list[dict]` — the rows as given, filtered by `match_rank` on `name`, ordered friends first (`already_friends`), then `match_rank`, then name.

- [ ] **Step 1: Write the failing tests**

```python
from types import SimpleNamespace as N
from backend.search_rank import fold, match_rank, albums_group, artists_group, songs_group, people_group

def a(id, user, name, artist, key, status="rated", score=8.0, extra=None, tracks=10):
    return N(id=id, user_id=user, album_name=name, artist=artist, subject_key=key, status=status,
             score=score, art_url=None, extra_artists=extra, track_count=tracks)

def test_fold_drops_accents_case_and_punctuation():
    assert fold("KAYTRAMINÉ") == "kaytramine"
    assert fold("  AC/DC ") == "ac dc"
    assert fold(None) == ""

def test_match_rank_orders_exact_prefix_word_contains():
    assert match_rank("blonde", "Blonde") == 0
    assert match_rank("blo", "Blonde") == 1
    assert match_rank("cre", "Tyler, The Creator") == 2
    assert match_rank("ond", "Blonde") == 3
    assert match_rank("xyz", "Blonde") is None
    assert match_rank("kaytramine", "KAYTRAMINÉ") == 0

def test_editions_are_one_row_and_my_copy_leads():
    cands = [a(1, 2, "Take Care", "Drake", "drake||take care", score=9.0),
             a(2, 3, "Take Care (Deluxe)", "Drake", "drake||take care", score=7.0),
             a(3, 1, "Take Care (Deluxe)", "Drake", "drake||take care", status="listening", score=None)]
    rows = albums_group("take care", cands, me=1, limit=4)
    assert len(rows) == 1
    assert rows[0]["album_id"] == 3 and rows[0]["mine"] and rows[0]["status"] == "listening"
    assert rows[0]["raters"] == 2 and rows[0]["pressd_avg"] == 8.0

def test_record_only_in_others_to_listen_is_left_out_but_singles_stay():
    cands = [a(1, 2, "Blonde", "Frank Ocean", "frank ocean||blonde", status="to_listen", score=None),
             a(2, 2, "Nights", "Frank Ocean", "frank ocean||nights", tracks=1)]
    rows = albums_group("n", cands, me=1, limit=4)
    assert [r["name"] for r in rows] == ["Nights"]

def test_collaboration_counts_for_each_artist():
    cands = [a(1, 2, "Heavy Is the Crown", "Anderson .Paak", "anderson paak||heavy is the crown",
               extra='["Cordae"]')]
    assert [r["name"] for r in artists_group("cordae", cands, me=1, limit=4)] == ["Cordae"]

def test_song_is_one_row_per_track_and_points_at_my_copy():
    s = lambda tid, title, aid, user, status="rated": N(track_id=tid, title=title, album_id=aid, album_name="Blonde",
        artist="Frank Ocean", subject_key="frank ocean||blonde", user_id=user, status=status)
    cands = [s(7, "Nights", 10, 2), s(7, "Nights", 11, 3), s(7, "NIGHTS", 12, 1, status="listening")]
    rows = songs_group("nights", cands, me=1, limit=4)
    assert len(rows) == 1 and rows[0]["album_id"] == 12 and rows[0]["mine"] and rows[0]["title"] == "Nights"

def test_people_friends_first():
    rows = [{"id": 1, "name": "jackk", "already_friends": False, "request_sent": False, "request_received": False},
            {"id": 2, "name": "jack", "already_friends": True, "request_sent": False, "request_received": False}]
    assert [r["id"] for r in people_group("jack", rows, limit=4)] == [2, 1]
```

- [ ] **Step 2: Run to verify they fail**

Run: `PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 python3.13 -m pytest tests/test_search_rank.py -q -p no:warnings`
Expected: FAIL with `ModuleNotFoundError: No module named 'backend.search_rank'`

- [ ] **Step 3: Implement `backend/search_rank.py`** with the signatures above. Pure stdlib plus `backend.credits.album_artists` and `backend.trackkeys.artist_key`; a module docstring giving the why (CLAUDE.md §12 register). The songs group needs the qualifying set: a `subject_key` qualifies when any `AlbumCand`-equivalent copy in the song candidates is rated or is the caller's — compute it from the song candidates' own `status` / `user_id`.

- [ ] **Step 4: Run to verify they pass**

Run: `PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 python3.13 -m pytest tests/test_search_rank.py -q -p no:warnings`
Expected: `7 passed`

- [ ] **Step 5: Commit** — `git add backend/search_rank.py tests/test_search_rank.py && git commit -m "Rank and group search results across people, records, artists and songs"`

---

### Task 2: The search endpoints

**Files:**
- Create: `backend/routers/search_all.py`
- Modify: `backend/main.py` (import + `app.include_router(search_all.router)`)
- Modify: `backend/routers/albums.py` — `_community_payload` (`:1115`) track rows gain `"track_id"` (the bucket key when it is an int, else `None`)
- Modify: `CLAUDE.md` — §5 a `backend/routers/search_all.py` entry (both endpoints, the qualifying rule, singles included), §2 table count of routers/endpoints
- Test: `tests/test_search_router.py`

**Interfaces:**
- Consumes: Task 1's `fold`, `albums_group`, `artists_group`, `songs_group`, `people_group`.
- Produces:
  - `GET /search/all?q=&group=&limit=` → `{"people": [...], "albums": [...], "artists": [...], "songs": [...]}`; `q` trimmed shorter than 2 → all four empty; `group` one of `people|albums|artists|songs` returns only that key, `limit` default `PREVIEW` (4), capped at `FULL` (25); a bad `group` → 422.
  - `POST /search/known` body `[{"name": str, "artist": str}]` (≤ 50 items, else 422) → `[{"index": int, "subject_key": str, "album_id": int}]` for each item whose `trackkeys.subject_key_album(artist, name)` matches a qualifying record; `album_id` as `albums_group` would pick it.
  - Community track rows: `track_id: int | null`.
  - `like_pattern(q: str) -> str` in `search_all.py`: escapes `\`, `%`, `_` and wraps in `%…%`.

- [ ] **Step 1: Write the failing tests**

```python
from backend.routers.search_all import like_pattern, parse_known, ALLOWED_GROUPS
import pytest

def test_like_pattern_escapes_wildcards():
    assert like_pattern("100%_x") == "%100\\%\\_x%"
    assert like_pattern("a\\b") == "%a\\\\b%"

def test_parse_known_caps_and_validates():
    assert parse_known([{"name": "Blonde", "artist": "Frank Ocean"}]) == [("Blonde", "Frank Ocean")]
    with pytest.raises(ValueError):
        parse_known([{"name": "x", "artist": "y"}] * 51)
    with pytest.raises(ValueError):
        parse_known([{"name": "x"}])

def test_groups():
    assert ALLOWED_GROUPS == ("people", "albums", "artists", "songs")
```

- [ ] **Step 2: Run to verify they fail**

Run: `PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 python3.13 -m pytest tests/test_search_router.py -q -p no:warnings`
Expected: FAIL with `ModuleNotFoundError`

- [ ] **Step 3: Implement the router.** `APIRouter(prefix="/search", dependencies=[Depends(current_user)])`. Candidate SQL, each with `ESCAPE '\'`:
  - albums: copies where `album_name ILIKE p OR artist ILIKE p OR extra_artists ILIKE p OR subject_key ILIKE pf` (`pf = like_pattern(fold(q))`), and (`user_id = me` OR `status = 'rated'`), with a track count subquery; cap 400 candidates;
  - songs: `song JOIN album` where `song.track_id IS NOT NULL` and (`song.title ILIKE p` OR the song's `track.title_norm ILIKE pf`) and the same copy condition; cap 400;
  - people: reuse `users._relationships` and `users._with_relationship` over `PressUser.name ILIKE p`, excluding the caller; cap 40.
  The router imports `users` helpers rather than copying them. `parse_known` raises `ValueError`; the route turns it into 422.

- [ ] **Step 4: Run tests and import the app**

Run: `PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 python3.13 -m pytest tests -q -p no:warnings && python3.13 -c "import backend.main"`
Expected: all pass (95 existing + 10 new), import clean.

- [ ] **Step 5: Check against the running backend** (the local backend reads the production database; read-only calls only). With a dev token for user 1: `curl -s "localhost:8000/search/all?q=kaytramine" -H "Authorization: Bearer $T"` returns album *KAYTRAMINÉ* (`mine: true`) and artist KAYTRAMINÉ; `?q=take%20care` returns one album row; `?q=%25` returns no rows beyond those literally containing `%`; without the header → 401.

- [ ] **Step 6: Commit** — `git commit -m "Search people, records, artists and songs in one call, and say which catalog albums Pressd already has"`

---

### Task 3: Shared client

**Files:**
- Modify: `shared/src/types.ts` — result types
- Modify: `shared/src/api.ts` — `searchAll`, `searchKnown`; `CommunityTrack.track_id?: number | null`
- Create: `shared/src/recentSearches.ts`

**Interfaces:**
- Consumes: Task 2's wire shapes.
- Produces:
  - Types: `SearchPerson` (`UserSearchResult`), `SearchAlbum {albumId, name, artist, artUrl, mine, status: AlbumStatus, yourScore: number|null, pressdAvg: number|null, raters}`, `SearchArtist {name, records}`, `SearchSong {trackId, title, albumId, albumName, artist, mine, status: AlbumStatus}`, `SearchResults {people, albums, artists, songs}`, `SearchGroup = 'people'|'albums'|'artists'|'songs'`.
  - `searchAll(q: string, group?: SearchGroup): Promise<SearchResults>` (snake → camel at the boundary; a failed response throws).
  - `searchKnown(items: {name: string; artist: string}[]): Promise<{index: number; subjectKey: string; albumId: number}[]>`.
  - `recentSearches.ts`: `type RecentItem = {kind: 'person'|'album'|'artist'|'song'|'catalog', key: string, label: string, sub?: string, artUrl?: string|null, target: unknown}`; `RECENT_MAX = 8`; `pushRecent(list: RecentItem[], item: RecentItem): RecentItem[]` (newest first, de-duplicated on `kind+key`, capped); `recentKey(userId: number): string` → `` `pressd_recent_search_${userId}` ``.
  - `songTarget(song: SearchSong): {kind: 'own', albumId: number, highlight: number | null} | {kind: 'community', albumId: number, highlight: number}` — `mine && status === 'rated'` → own with highlight; `mine` otherwise → own, `highlight: null`; not mine → community with highlight.

- [ ] **Step 1: Implement** the above; `pushRecent` and `songTarget` are pure.
- [ ] **Step 2: Typecheck both apps**

Run: `cd frontend && npm run typecheck && cd ../mobile && npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Check `songTarget`'s three cases**

Run from `shared/`: `npx tsx -e "import {songTarget as t} from './src/recentSearches'; const b={trackId:7,title:'x',albumId:3,albumName:'a',artist:'b'}; console.log(JSON.stringify([t({...b,mine:true,status:'rated'}),t({...b,mine:true,status:'listening'}),t({...b,mine:false,status:'rated'})]))"`
Expected: `[{"kind":"own","albumId":3,"highlight":7},{"kind":"own","albumId":3,"highlight":null},{"kind":"community","albumId":3,"highlight":7}]`

- [ ] **Step 4: Commit** — `git commit -m "Add the search client and a per-account recent-searches list"`

---

### Task 4: iPhone

**Files:**
- Create: `mobile/app/search.tsx`
- Modify: `mobile/app/(tabs)/index.tsx` — masthead: replace `styles.date` text with a search `Pressable` (lucide `Search`, `tc.ink`), 36pt round, `accessibilityLabel="Search"`, `router.push('/search')`; remove the now-unused `today` value and `date` style
- Modify: `mobile/app/album/[id].tsx` — `track` search param: scroll to and briefly highlight the row whose `trackId` (own copy) / `track_id` (community) matches, only when the copy is rated or the view is community
- Modify: `mobile/lib/auth.tsx` — `signOut` removes `recentKey(user.id)` from SecureStore
- Modify: `CLAUDE.md` — For You masthead and the search screen (iPhone)

**Interfaces:**
- Consumes: Task 3's `searchAll`, `searchKnown`, `pushRecent`, `recentKey`, `songTarget`, types; existing `useAlbumSearch`, `resolveAlbum`, `importAlbum`, `useOpenProfile`.

- [ ] **Step 1: Build `search.tsx`.** Top row: search field (autofocus, `returnKeyType="search"`, clear button) and **Cancel** (`router.back()`). Debounced 200 ms query, ≥ 2 chars → `useQuery(['search', userId, q], () => searchAll(q))`. Sections in order People, Albums, Artists, Songs, From the catalogs; each shows its rows (≤ 4) and **See all** when it has 4, which re-queries that group (`searchAll(q, group)`) in place. Catalog section: `useAlbumSearch(q)` results, then `searchKnown` on them, dropping known indices; while pending, a small `VinylSpinner` in the section header. Empty query: recent items from SecureStore under `recentKey(user.id)` with **Clear**. Nothing matching: one line, "Nothing on Pressd matches “{q}”." Row taps: person → `useOpenProfile`; album mine → `/album/{id}`; album not mine → `/album/{id}?community=1`; artist → `/artist/{name}`; song → `songTarget` (own → `/album/{id}` with `track` only when highlight is set; community → `/album/{id}?community=1&track={trackId}`); catalog → the same action sheet `add.tsx` offers (Rate now / Add to library: `resolveAlbum` then `importAlbum(full, 'listening'|'to_listen', user.id)`, then route as `add.tsx` does). Each tap `pushRecent`s and saves.
- [ ] **Step 2: Wire the For You icon and the album page's `track` param.**
- [ ] **Step 3: Verify**

Run: `cd mobile && npm run typecheck && npx eslint . 2>&1 | tail -1`
Expected: typecheck clean; eslint no more than **126 errors and 6 warnings**. Metro log (`expo.log`) shows a clean reload. Jack checks the simulator himself (no screenshots).

- [ ] **Step 4: Commit** — `git commit -m "Search Pressd from For You on iPhone"`

---

### Task 5: Web

**Files:**
- Create: `frontend/src/pages/GlobalSearch.tsx`
- Modify: `frontend/src/App.tsx` — `<Route path="/search" element={<GlobalSearch />} />` inside the protected routes
- Modify: `frontend/src/pages/ForYou.tsx` — header: replace the date (`dateStr`) with a round search button (lucide `Search`) linking to `/search`; drop unused date code
- Modify: `frontend/src/pages/AlbumDetail.tsx` and `frontend/src/pages/CommunityAlbum.tsx` — `?track=<id>` scrolls to and `flash`es that track row (own copy only when rated)
- Modify: `frontend/src/context/UserContext.tsx` — `signOut` removes `localStorage[recentKey(id)]` (in try/catch)
- Modify: `CLAUDE.md` — For You header, `/search`, the album pages' `track` param, and §12 nothing else

**Interfaces:**
- Consumes: Task 3's exports; existing `useAlbumSearch`, `resolveAlbum`, `importAlbum`.

- [ ] **Step 1: Build `GlobalSearch.tsx`** — the same behaviour as Task 4's screen, laid out wide: the field across the top (autofocused; **Esc** returns to the previous page), then People, Albums, Artists and Songs as columns on desktop (one column below `md`), and From the catalogs across the full width below. ↑/↓ move a highlight through visible rows, Enter opens it. Catalog **Rate** / **Add** buttons on each catalog row (as `AddAlbumModal` does: rate → `/rate/{id}`). Recents in `localStorage` under `recentKey(id)`, every access in try/catch. Uses `CoverImg`, `VinylSpinner`, `rise-in` with `--i` for result rows, `var(--c-…)` colours.
- [ ] **Step 2: Wire the For You button and the `track` param.**
- [ ] **Step 3: Verify**

Run: `cd frontend && npm run typecheck && npx eslint . 2>&1 | tail -1`
Expected: typecheck clean; eslint no more than **14 problems (10 errors, 4 warnings)**. Then in the running dev server, `/search?` with "kaytramine", "take care" and a friend's name return the expected groups, and Esc goes back.

- [ ] **Step 4: Commit** — `git commit -m "Search Pressd from For You on the web"`
