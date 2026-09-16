# 10 — System design, hot paths, and scaling

Format per finding: **current behavior → evidence → risk → cheapest intervention.**
Nothing here is implemented.

## P1 — Finishing a rating rescores the entire userbase (HIGH)

**Current.** `PATCH /albums/{id}` calls `recompute_all_scores(session)` whenever any of
`theme, replay_value, production, distinctness, status` is in the body
([albums.py:236-238](../../backend/routers/albums.py#L236-L238)) — which is exactly the
request that finishes every album rating.

`recompute_all_scores` ([scoring.py:256](../../backend/scoring.py#L256)) loops **every
`PressUser` row**. Per user: one `SELECT *` over their rated albums to read four floats
(`:118-128`), plus a second query with `selectinload(Album.songs)` (`:225-230`). Plus
one userbase-wide `SELECT *` for the global prior (`:262`). Then one commit for all of it.

**Evidence.** `2N + 1` queries for N users; every rated album and every song row in the
database pulled into Python, including the `review` and `predicted_theme_reasoning`
TEXT columns. Synchronous, inside the request the user is waiting on.

**Risk: HIGH.** Cost is O(total corpus), not O(this user). At ~33 users it is fine. An
invite wave that multiplies users also multiplies the per-rating cost, so latency
degrades **quadratically** in total activity. This is the first thing that breaks.

**Cheapest intervention.** The global prior only moves materially when the userbase
grows. Recompute the rater's own albums inline (`recompute_user_scores`, already
factored out and already takes a `prior`), and move the full pass to the nightly worker.
One line at the call site plus a worker stage.

## P2 — `/discover/charts` reads every rated album per request (HIGH)

**Current.** `discover.py:371-377` selects every rated album's columns with no filter,
then builds facets, filters, and groups **twice** (today's board and yesterday's, at
`:452-456`) in Python.

**Evidence.** No cache on the endpoint. `compute_global_ratings` inside it is memoised
60s (`global_rating.py:45`), but the row scan and the double group-by are not. `limit`
caps the *output* at 50; the scan is unbounded.

**Risk: HIGH** — this is the Charts tab, hit on every open, on both platforms.

**Cheapest intervention.** Memoise the whole response on
`(period, genre, decade, year, artist, limit)` with the same 60s TTL and the same
`invalidate_cache()` hook the global rating already uses.

## P3 — `/discover/picks` runs a correlated subquery with no usable index (MEDIUM)

**Current.** `discover.py:503-509`: for each `albumprediction` row, a `NOT EXISTS`
against `album` comparing `lower(trim(album_name))` and `lower(trim(artist))`.

**Evidence.** Neither side has a functional index on `lower(trim(...))`, so Postgres
cannot use `ix_album_subject_key` or any name index — it is a sequential scan of `album`
per prediction row.

**Risk: MEDIUM.** `albumprediction` grows as `users × catalog`, so this is the row count
that scales worst in the whole schema.

**Cheapest intervention.** `albumprediction.album_key` already exists and `album`
already has an indexed `subject_key`. They are computed by different normalizers
(`album_key` vs `subject_key_album`), so they don't join directly — but adding
`album_key` to `Album` as a stored column, or a functional index on the lowered pair,
turns the scan into a lookup.

## P4 — `/albums/{id}/report` aggregates the whole `song` table (MEDIUM)

**Current.** [albums.py:547-550](../../backend/routers/albums.py#L547-L550):
`select(Song.album_id, func.count(Song.id)).group_by(Song.album_id)` with **no WHERE**,
then filtered in Python to the user's album ids at `:550`.

**Risk: MEDIUM.** A full aggregate over every song in the database on every report open.

**Cheapest intervention.** Add `.where(Song.album_id.in_(_user_album_ids))`. One line;
the id set is already computed on the line above.

## P5 — All caching is per-process in-memory (HIGH the moment you scale out)

| Cache | Where | TTL | Scope |
|---|---|---|---|
| global ratings board | `global_rating.py:45` | 60s | process |
| search results | `search.py:34-37` | 600s, max 500 | process |
| new releases | `discover.py:32-33` | 6h | process |
| Apple JWKS | `auth.py:21` | SDK default | process |
| FCM credentials | `push.py:48` | lifetime | process |
| artist photos | `ArtistMeta` **in Postgres** | 30d | shared ✅ |
| album factors | `albumfactors` **in Postgres** | forever | shared ✅ |

**Risk.** Today the backend is a single process, so this all works. The moment there is
a second uvicorn worker or a second Render instance:
- `invalidate_cache()` clears **one** process's board. The others serve a stale chart
  for up to 60s after someone rates an album.
- The 6h new-releases cache is duplicated per process, multiplying the ~25-call cold
  fetch by the instance count.
- The search cache hit rate divides by the instance count, pushing more traffic onto
  four unkeyed upstreams.

**Cheapest intervention.** Before adding a second instance, move the global-ratings
board and the new-releases list to a shared store. There is no Redis today; Postgres
tables work, and `ArtistMeta` is the precedent already in the codebase.

## P6 — `/discover/new-releases` has a thundering-herd window (MEDIUM)

**Current.** `discover.py:181-183` checks the cache, and on a miss does the full
AOTY + ~24-concurrent-Deezer fetch under a 20s timeout. No lock, no single-flight.

**Risk: MEDIUM.** Every request arriving in the cold window does the whole fetch. Ten
concurrent openers on an expired cache is ~250 outbound calls, which is how you get
rate-limited by Deezer, which makes the fetch fail, which prevents the cache being
written (`:254` refuses to cache empties) — a feedback loop.

**Cheapest intervention.** An `asyncio.Lock` around the refill, serving the stale value
to waiters.

## P7 — ~90 migration statements run on every boot (LOW–MEDIUM)

**Current.** `init_db()` (`database.py:47-186`) executes ~90 statements sequentially on
every startup, including three `DELETE`s (`:88-91`) and six full-table `UPDATE`s
(`:84`, `:116-119`, `:181`) that were one-shot backfills.

**Risk: LOW–MEDIUM.** ~90 sequential round trips to a remote pooler on every cold start,
and `SET statement_timeout = 0` (`:59`) means a slow one has no ceiling.

**Cheapest intervention.** A `schema_version` table, or at minimum move the `UPDATE`s
and `DELETE`s behind a "has this run" check.

## P8 — Connection pool vs. the Supabase pooler ceiling (HIGH at scale)

**Current.** `create_engine(..., pool_size=5, max_overflow=10)` (`database.py:28`) — up
to **15 connections per process**. `worker/backfill_factors.py:35` records that
Supabase's session-mode pooler allows **15 across the entire project**.

**Risk: HIGH.** The web service alone can saturate the project's entire allowance. A
nightly worker run, or a second instance, then cannot connect. The worker already
mitigates on its side — fresh connection per stage (`nightly_predict.py:249-251`) and
`analyze_album` holding no connection across LLM calls (`global_factors.py:188-192`) —
but the web service does not.

**Cheapest intervention.** Confirm which pooler mode is in use (transaction mode raises
the ceiling substantially), and size `pool_size` against the real limit divided by the
instance count.

## P9 — N+1 on import and in the worker (LOW)

`_link_tracks` (`albums.py:468-501`) runs 2–3 queries per song; a 15-track import is
~35 round trips. `sync_predictions_to_albums` (`nightly_predict.py:127-137`) and
`predict_replay_all` (`:242-244`) each `UPDATE` one row at a time in a Python loop.
`worker/migrate_tracks.py:46` shows the team already knows the fix — it uses bulk
`execute_values` "throughout — row-by-row round trips to Supabase take…".

**Risk: LOW** for the worker (nightly, has time). Noticeable on import.

## P10 — `GET /stats/analysis`: unbounded synchronous LLM call (MEDIUM, latent)

See `07-llm.md`. Unbounded prompt, no cache, no timeout, blocking `def` holding a
threadpool slot, 500 on any API error, and reachable for a **friend's** library via
`viewable_user_id`. Latent only because no client calls it.

**Cheapest intervention.** Delete it, or cap the prompt and cache per user per day.

## P11 — Security: the `/util/*` router had no auth (FIXED)

Full detail in `01-foundation-auth-data.md`. 11 mutating/expensive endpoints, zero
guards. `POST /util/analyze-song` (`util.py:519`) passes a caller-supplied URL to
`yt-dlp` as argv and writes features onto any `song_id`. `/util/backfill-genres` and
`/backfill-genres-mb` rewrite genre across the whole catalog.

**Fixed** by putting the dependency on the `APIRouter` itself, and moving the two bare
`fetch` call sites onto `fetchAlbumColor`. Verified all ten answer 401 without a token.
The note below is retained because it is the reason the fix was not a one-liner:
three `/util` endpoints are called by clients —
`album-color`, `artist-image`, `backfill-covers` — and two of those call sites use a
**bare `fetch`** that attaches no token (`frontend/src/components/ShareCard.tsx:35`,
`frontend/src/pages/AlbumDetail.tsx:33`). Those two must move to `fetchAlbumColor`
(which already exists at `shared/src/api.ts:450` and uses `apiFetch`) in the same change.

## P12 — `JWT_SECRET` fails open (MEDIUM)

`deps.py:18` defaults to the literal `"dev-insecure-secret-change-me"`, which is public
in this repo. No startup assertion. If the var were ever missing in production, the
service boots and signs forgeable tokens.

**Cheapest intervention.** Raise at import when `JWT_SECRET` is unset and
`APP_URL`/`DATABASE_URL` indicate production. Three lines.

## What the clients do when the backend fails

- `apiFetch` (`shared/src/api.ts:36`) handles **401 only** — clears the token and calls
  `onUnauthorized`. Every other status is left to the caller, and 54 of the ~76 call
  sites do `if (!res.ok) throw`.
- No timeout anywhere. Browser `fetch` has no default timeout, so a hung Render request
  hangs the query until the user leaves.
- No backoff. React Query is configured `retry: 1` on both platforms
  (`frontend/src/main.tsx:12`, `mobile/app/_layout.tsx:48`), so a 429 gets retried once,
  immediately, which is the wrong response to a rate limit.
- `staleTime` is 30s on web, 60s on mobile.

**Risk: MEDIUM.** A 429 or 502 surfaces as a thrown error and whatever the page's error
branch renders. There is no shared "the service is having trouble" surface.

**Cheapest intervention.** Add a `retry`/`retryDelay` function to the two `QueryClient`
configs that backs off exponentially and does not retry 4xx. Two files, ~6 lines.

## If you add product analytics

There is none today (confirmed with Jack). `@react-native-firebase/analytics` is in
`mobile/package.json` but is not imported anywhere in `mobile/`, so it ships unused.

The seams that already exist, where events would cost almost nothing to emit:

| Loop | Existing seam |
|---|---|
| invite → signup | `POST /users/invite/{token}/accept` (`users.py:209`); `Invite.accepted_at` is already stored |
| recommend → rate | `POST /albums/{id}/recommend` (`albums.py:771`); `Album.recommended_by` + `recommended_at` already persist the edge |
| rating funnel drop-off | `POST /songs/batch-rate` then `PATCH /albums/{id}` — the gap between them *is* the abandonment |
| share card | `frontend/.../ShareCard.tsx` download, `mobile/.../ShareCard.tsx` `captureRef` + `expo-sharing` — **currently emits nothing, and a shared PNG carries no link back** |
| discovery → library | `/discover/picks` and `/discover/new-releases` both hand off to `POST /albums/import` |

The one structural gap worth naming: share cards are rasterised **client-side** (html2canvas
on web, `react-native-view-shot` on mobile) and produce a bare image. There is no
server-rendered OG image and no deep link, so the app's stated primary growth mechanic is
both unmeasurable and unattributable. A `GET /share/{album_id}.png` plus a `/a/{id}`
landing route would fix measurement and attribution together.
