# CLAUDE.md

Guidance for Claude Code (claude.ai/code) working in this repository.

Audited at commit `d8a76fc` (331 commits, 2026-09-06). Non-obvious claims carry a
`file:line`. Exhaustive per-module notes live in [docs/codebase-notes/](docs/codebase-notes/);
open questions in [QUESTIONS.md](QUESTIONS.md). Where I am summarising rather than
certain, I say so.

---

## 1. What Press'd is

Press'd is a **social** music rating app — Letterboxd for albums, aimed at the
RateYourMusic/AOTY crowd. A user rates every song on a record, then rates the record
itself on four external factors, and gets a composite score. They follow friends,
recommend albums, discuss records, and see what everyone is rating. Live at
pressdmusic.com and on TestFlight.

The rating flow is the opinionated part: **songs unlock one at a time, in track order**,
because the app is meant to make people listen to an album front to back the way records
were meant to be heard. Don't add jump-ahead affordances without a deliberate decision —
the constraint is the product.

The constraint applies to the **first pass only**. Once an album is rated, the user can
edit any song score or factor freely, which recomputes the album score.

A song the user has **already scored on another record** — the single, the standard
edition of a deluxe — arrives pre-filled and counts as done (§5, carryover), so they
start at the first song that genuinely needs them. A pre-filled song further down the
record stays locked until the listener reaches it; it is never a way to jump ahead.

Vocabulary of the core loop:

- **To Listen** — the queue of records the user intends to hear, sorted best-predicted-first.
- **Listening** — mid-album, partially rated.
- **Rated** — finished; carries a score, four factors, optionally a written review.
- **Recommending** an album drops it into a friend's To Listen, tagged with who sent it
  (`recommended_by`, `recommendation_note`). It is offered only on a record you have
  **finished rating** (Jack's rule, November 2026): your rated copy on both platforms'
  album pages and web's Library card, and web's community page's "Recommend to a friend"
  only when your copy (any edition) is rated — never while it's Listening or To Listen.
  Pass it on draws from your top-rated records already.

Surfaces: **Library/profile** (three buckets plus stats), **Rankings** (labelled Ratings until November 2026; the `ratings` keys and web's
`/ratings` route keep the old name — rankings by
various metrics, including baseball-style artist stats — SAR, consistency+, bang %,
skip %), **Charts** (userbase-wide, week and all-time), **For You** (home feed),
**Social** (activity, reviews, discussions, friend comparison), and **threads** (one
discussion room per record, on both platforms since September 2026).

**Web and mobile are meant to stay in lockstep on features.** Layout and visual design
differ per platform and are expected to — the shared thing is the feature and the API.
They are **not** in lockstep today; see §11.

---

## 2. Repo map

Four deployables in one repo.

```
backend/          FastAPI web service        → Render  (uvicorn backend.main:app)
frontend/         React 19 + Vite SPA        → Vercel
mobile/           Expo SDK 57 iOS app        → TestFlight
worker/           nightly ML pipeline        → GitHub Actions, 02:30 PT
ops/launchd/      nightly audio ingest       → launchd on the Mac, from a deploy clone of main
tests/            pytest, backend-only: taste overlap, the audio ingest's scheduler, upcoming releases, bins, the locked thread's preview (no DB connection)
data/bins/        curated bins' source lists: <slug>.csv (the list as printed) + <slug>.json (title, source, overrides)
                  + <slug>.blurbs.json (Pressd's one-sentence blurbs by rank, worker/bin_blurbs.py)
shared/           @pressd/shared — TS source consumed by frontend + mobile, no build
theme_predictor/  LLM album analysis; imported by the worker AND the web service
song_score_model.py  LightGBM per-song model (1,211 lines) — train + inference
corpus/           709 cached per-album LLM analyses (gitignored, local only)
docs/codebase-notes/  this audit's working notes
PLAN_*.md         gitignored design docs; code cites them by section
```

| Area | Role | LOC |
|---|---|---|
| `backend/main.py` | CORS, 17 routers, `init_db()` on startup, `/health` | 46 |
| `backend/database.py` | engine + **the entire migration system** (§3) | 274 |
| `backend/models.py` | 34 SQLModel tables | 722 |
| `backend/deps.py` | `current_user`, `viewable_user_id`, `thread_access` — the auth invariant | 148 |
| `backend/scoring.py` | framework 1: the user's own album score | 267 |
| `backend/global_rating.py` | framework 2: the userbase-pooled rating | 155 |
| `backend/trackkeys.py` | normalization keys; pure stdlib, imported everywhere | 163 |
| `backend/routers/` | 17 routers, **130 endpoints** | 8,357 |
| `worker/` | `nightly_predict`, `catalog_predict`, `artist_clusters`, `audio_ingest`, `refresh_new_releases`, `taste_nightly`, `taste_health`, … | 3,449 |
| `theme_predictor/` | `predict_single`, `personalize`, `global_factors`, `corpus`, … | 1,896 |
| `shared/src/api.ts` | the single API client, 111 exported functions | 2,147 |
| `frontend/src/` | 22 pages, 35 components, 8 lib modules | 16,566 |
| `mobile/` | 20 routes, 38 components, 22 lib modules | 21,555 |

**Stack, as verified.** FastAPI 0.103 + SQLModel on **Postgres only** — Supabase is a
Postgres *host*, no SDK, no Supabase auth (`database.py:11-29`). **Row-level security is
on for every public table, with no policies**, so Supabase's auto-generated REST API
(`anon`/`authenticated`) reads nothing; the backend connects as `postgres`, which owns
the tables and has `BYPASSRLS`, so it is unaffected. The last migration in `init_db()`
enables it on any table that lacks it, so a new table is covered on the next boot. Never
add `FORCE ROW LEVEL SECURITY` — that would bind the owner too. Firebase is
**FCM push and phone-number verification only**, not a datastore (`push.py`,
`phone.py`). React 19 / Vite 8 / TanStack Query 5 /
Tailwind 4 on web; Expo 57 / RN 0.86 / expo-router on mobile. Plain REST, JSON,
snake_case on the wire, camelCase at the client boundary.

**The test suite is small and backend-only** (`tests/`, pytest, added with taste
overlap: its matrix, baseline, live path, nightly stage, health check, router and the
schema's delete order), plus the audio ingest's download scheduler and the upcoming-releases
build's parsing, merge and filter
(`tests/test_audio_queue.py`). Plus the tracklist merge's pure core (`tests/test_tracklist_fill.py`), and bin records' place in the prediction catalog (`tests/test_bin_catalog.py`). Nothing else is covered — no vitest, nothing for scoring
or the other routers — so for everything else verification is typecheck + lint +
running it. Tests never open a database connection (`tests/conftest.py`).

---

## 3. Run it

Python 3.13 (`runtime.txt`), Node via npm workspaces.

```bash
# Backend — from the repo root; backend/database.py's load_dotenv() expects it
pip install -r requirements.txt
uvicorn backend.main:app --reload            # http://localhost:8000

# Web
npm install                                  # root: workspaces (shared, frontend, mobile)
cd frontend && npm run dev                   # http://localhost:5173
npm run typecheck && npm run lint            # tsc -b; eslint .

# Mobile (Expo)
cd mobile && npx expo start
npm run typecheck && npm run lint
# Never run `npx expo prebuild --clean` casually — it wipes native config. See mobile/TESTFLIGHT.md.

# Tests — pytest is not in either requirements file; a global pytest_asyncio plugin breaks
# plain `pytest`, hence the env var. From the repo root.
PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 python3.13 -m pytest tests -q -p no:warnings

# ML worker — requirements-worker.txt is deliberately NOT installed on the web service
pip install -r requirements-worker.txt
python -m worker.nightly_predict             # all eligible users
python -m worker.nightly_predict --user 1 --skip-llm --force
python -m worker.catalog_predict --dry-run
python song_score_model.py                   # retrain → song_score_model.pkl
python -m worker.fill_tracklists [--dry-run] [--limit N]  # top up unsettled copies: songless, not out yet, or out
                                             # but not yet pulled (merge, backend/tracklist_fill.py; daily in CI,
                                             # fill-covers.yml, before covers)
python -m worker.fill_covers [--dry-run]    # look again for every album copy with no cover (also daily in CI, fill-covers.yml)
python -m worker.refresh_upcoming_releases [--dry-run]  # rebuild the upcoming-releases list (daily in CI, upcoming-releases.yml)
python -m worker.set_cover ID URL [--dry-run]  # a cover by hand, for a record no catalog has: every copy gets it
python -m worker.deep_stats ID|"name" [--user 1] [--out DIR] [--html]
                                             # a 1080×1920 "deeper stats" PNG of one rated album, for the end of a
                                             # review video; outside both apps, read-only, drawn by headless Chrome
                                             # (default folder export/deep-stats/)
python -m worker.import_bin data/bins/<slug>.csv [--dry-run] [--set RANK DEEZER_ID]
                                             # a list file into a curated bin, matched on Deezer (iTunes fallback);
                                             # the dry run lists doubtful rows; --set pins one, kept in the JSON;
                                             # a write ends by putting the entries' songs on Tracks (link_bin_entries)
python -m worker.backfill_factors --bins [--dry-run]  # Claude's albumfactors for bin records that lack them
                                             # (the nightly prediction run does this itself)
python -m worker.bin_blurbs <slug> [--dry-run] [--force]
                                             # a one-sentence blurb per bin entry from Claude (claude-opus-5-5, effort
                                             # low, 20 a request) into data/bins/<slug>.blurbs.json and BinEntry.note;
                                             # asks only for ranks the file lacks; edit the file and re-run to correct one
python -m worker.taste_evaluate --out PATH   # taste overlap: factorization vs layered baseline on held-out
                                             # song scores; reads production only; names users, keep it local
                                             # (--pairs 1:84,1:12: eye-test pairs by user id; default user 1's)
python -m worker.taste_nightly --dry-run     # taste overlap's nightly stage, read-only: counts + percentiles
python -m worker.taste_health --dry-run      # taste overlap's health row, read-only: prints the detail JSON
                                             # (--report PATH: also the checkpoint report, if due; local only)

# Audio ingest — the Mac only: yt-dlp is bot-blocked from datacenter IPs.
./run_audio_ingest.sh [--limit 20]           # by hand
./run_audio_ingest.sh --preflight            # tools, canary download + analysis, DB; writes nothing
ops/launchd/install.sh [--ref B] [--uninstall]  # 00:30 local + at login; preflights *under launchd* first
python -m worker.audio_health                # the check GitHub runs: exit 1 if stale or failed
```

**The deeper-stats card (`worker/deep_stats.py`)** is Jack's end card for album-review
videos — a creator tool, deliberately in neither app. Run it from the repo root (it needs
`.env`, Google Chrome in `/Applications`, and a connection for the fonts and cover):
`python3.13 -m worker.deep_stats "kid a"` searches user 1's rated albums by name (a name
matching several lists them with ids and exits 1; pass the id instead), and prints the
PNG's path, `export/deep-stats/<album>.png` (`export/` is untracked). The card: cover,
title, bang and skip rates (AlbumDetail's figures) and the score; every track as a bar
with its score and a BANG/SKIP tag in a right-aligned column (`BANG`/`SKIP` restate
`shared/src/types.ts`'s thresholds — change both), a green ▲ on the favourite
(`top_song_id`, else the first top score) and a red ▼ on the least, and a dashed line at
the owner's song average over their whole library; the album's percentile on a density
curve of the owner's album scores, the share below shaded; and the four factors as
histograms of the owner's values with this album's marked. Distributions leave out
singles, as the library does. Playfair's own old-style numerals are kept on purpose.

**The nightly job runs from a deploy clone, not this working copy.** macOS privacy
protection (TCC) denies launchd jobs access to `~/Desktop` — `Operation not permitted`,
exit 126, verified 2026-09-29 — and a working copy would run whatever branch is checked
out. So `install.sh` clones the repo (over HTTPS; it is public, and launchd has no SSH
agent) into `~/Library/Application Support/pressd/ingest`, copies `.env` in at `0600`,
and puts `nightly.sh` beside it. Each night `nightly.sh` fetches `origin/main`, checks it
out detached, and runs it — **merged code reaches the job with no reinstall; unmerged
code never does.** Re-run `install.sh` after changing `.env`. The installer refuses when
the target ref lacks the canary-era ingest, rather than schedule the old silent one.
`--uninstall` deletes the clone and its `.env` copy. The job logs to
`~/Library/Logs/pressd/audio-ingest.log`, unbuffered, so `tail -f` follows it live;
`workerrun` and `trackaudio` in Supabase are the durable record.

**When it runs — in practice, the first awake, online half-hour after 00:30.** Two
agents, neither needing VS Code or Claude open, both needing you logged in.
`com.pressd.audio-ingest` fires at 00:30 local, or on the next wake if the Mac was asleep
then (`man launchd.plist`: missed runs coalesce into one).
`com.pressd.audio-ingest.catchup` runs at login and every 30 minutes with `--catch-up`,
and does the run only when tonight's is still owed: no success (`last_success`, a stamp
beside the clone written only by a finished real run) since the most recent 00:30, and
at least an hour past it. Offline, either agent exits 0 and leaves the night to the
next catch-up — the scheduled run after waiting up to 3 min, a catch-up after 1 min.
Neither starts a run in a dark wake (`pmset -g systemstate` without Graphics): on Oct 6
one did, advanced in few-second bursts with the lid shut, and finished 22h later. A
`lockf` lock stops the two running at once; finding it held exits 0. `audio-health`
forgives a run stuck at `running` while a success is under 36h old.

A run that *starts* awake can still have the lid shut under it. It then advances in
dark-wake bursts, which is slow but harmless, except to a database call in flight: on
Oct 11 a `COMMIT` landed on the server, its reply was lost in the sleep, and libpq sat
in `poll()` for eleven hours holding the lock. The engine now sets TCP keepalives
(`database.py`, `_build_engine`), so a dead connection raises about a minute after the
next wake instead. A hung run otherwise needs killing by hand (`pgrep -f
worker.audio_ingest`), and its `workerrun` row marking `error`.

The catch-up replaced a login-only agent (`.login`, which `install.sh` now removes)
after Oct 3–5 2026: the Mac slept on battery through 00:30, macOS spent the missed run on
a 5–9 s "DarkWake" maintenance wake with no Wi-Fi, and the run failed at its database
connection — or froze and resumed when the lid opened, before Wi-Fi reconnected. Opening
the lid is a wake, not a login, so nothing retried and `audio-health` went red. The rule
used to be "no success in 20h", which a periodic check would turn into a schedule that
creeps earlier each day. `pmset -g log` shows the dark wakes if it recurs.

**Env vars.** Backend/worker: `DATABASE_URL` **or** `PG_HOST`/`PG_PORT`/`PG_DB`/`PG_USER`/
`PG_PASSWORD`; `JWT_SECRET`, `TOKEN_TTL_DAYS`, `APP_URL`, `ANTHROPIC_API_KEY`,
`LASTFM_API_KEY`, `DISCOGS_TOKEN`, `GENIUS_ACCESS_TOKEN`, `THEME_LLM_MODEL`,
`APPLE_BUNDLE_ID`, `FIREBASE_PROJECT_ID`, `FIREBASE_CREDENTIALS_JSON` (Render) |
`FIREBASE_CREDENTIALS_FILE` (local), `SMTP_*`, `DB_POOL_SIZE` / `DB_MAX_OVERFLOW` (the
engine's pool; default 5 + 10 with `DATABASE_URL`, i.e. Render and the GitHub workers,
and 2 + 2 when configured from `PG_*`, i.e. anything run on the Mac, because the
project's 15 pooler clients are shared with production), `PHONE_HASH_KEY` (the HMAC key phone
numbers are stored under — **the same value on Render and in local `.env`**, since both
write the production database; unset, adding a number answers 503, and there is no
fallback literal, on purpose). `GITHUB_DISPATCH_TOKEN` (the Mac's `.env` only — a
fine-grained token for this repo with *Actions: read and write*; the nightly ingest uses
it to start the prediction workflow, and without it predictions wait for GitHub's cron;
re-run `ops/launchd/install.sh` after adding it, since the job reads a copy of `.env`).
Web: `VITE_API_URL`, `VITE_GOOGLE_CLIENT_ID`, `VITE_IOS_APP_URL` (overrides the App
Store link the public pages' iPhone buttons open; unset, they use the listing constant in
`frontend/src/lib/iosApp.ts`), `VITE_FIREBASE_API_KEY` / `_AUTH_DOMAIN` / `_PROJECT_ID` /
`_APP_ID` (the Firebase web app's config, for phone verification; unset, web hides the
phone prompt and Settings row). Mobile: `EXPO_PUBLIC_API_URL`,
`EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID`, `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID`.
Files: `.env` at root, `frontend/.env.local`, `mobile/.env`.
`EXPO_PUBLIC_*` vars are **inlined into the shipped iOS bundle** — never secrets.

⚠️ Local `.env` points `PG_HOST` at the **production** Supabase pooler, and `init_db()`
runs every migration on startup — so starting `uvicorn` locally after adding an
`ALTER TABLE` line applies it to production.

Local `.env` sets neither `JWT_SECRET` nor `DISCOGS_TOKEN`. The first falls back to a
public literal (§10, P12); the second means `/aoty/*` discographies degrade in dev.

**`render.yaml` is not authoritative.** It still says `plan: free` (production is on a
paid tier) and declares four env vars where the code reads about fifteen. Don't reason
about deploy config from it.

**Migrations are a list of idempotent SQL strings** in `init_db()`
([backend/database.py:66-201](backend/database.py#L66-L201)), run on **every startup**.
There is no Alembic and no version table. Adding a column means adding a SQLModel field
**and** appending an `ALTER TABLE … ADD COLUMN` line. `_exec_migration` (`:33`) swallows
"already exists" and logs everything else, so drift is loud rather than silent.
Before an `ADD COLUMN` or `CREATE INDEX IF NOT EXISTS` it asks the catalog, which takes no
lock, and skips one already applied (`_already_applied`); the boot also sets `lock_timeout`
to 5s. Both since 2026-11-05, when two backends booting at once against a prediction job's
open transaction stalled every album read in production: an `ALTER TABLE` takes its
exclusive lock *before* it finds the column there, and Postgres queues every later read of
the table behind a waiting one. A migration that does need a lock and can't get it in 5s
logs and runs again on the next boot.

---

## 4. Architecture & data flow

```
 iOS (Expo)          Web (Vite SPA)
     │                    │
     └── mobile/lib/api ──┴── frontend/src/api ──┐
              (configureApi injects base URL, token storage, 401 handler)
                                                 ▼
                                    shared/src/api.ts  ── snake_case → camelCase
                                                 │  REST + JWT bearer
                                                 ▼
                              FastAPI (Render)  backend/main.py
                                 │
          ┌──────────────────────┼───────────────────────────┐
          ▼                      ▼                           ▼
   routers/ (16)           scoring.py                trackkeys.py
   125 endpoints           global_rating.py          (normalization —
                                 │                    imported by web,
                                 ▼                    worker, and scripts)
                          Postgres (Supabase)
                                 ▲
                                 │  nightly 02:30 PT
                    worker/nightly_predict.py ── song_score_model.py (LightGBM)
                                              ├─ worker/artist_clusters.py (KMeans)
                                              ├─ theme_predictor/ ── Anthropic
                                              └─ worker/catalog_predict.py
```

### Journey: submit a rating

```
GET /albums/{id}                    carried_score on unscored songs (carryover.py)
  shared/src/rating.ts seedDrafts   pre-fills them, resumes at the first open track
frontend RatingScreen.tsx `submit` / mobile rate/[id].tsx `submit`
  POST /songs/batch-rate            songs.py:83   writes scores; NO recompute
  PATCH /albums/{id}                albums.py:215 status + 4 factors
    ├─ recompute_user_scores()      albums.py:260  the rater's library only
    ├─ invalidate_global_ratings()  global_rating.py:49  (this process only)
    └─ _queue_song_repredictions()  albums.py:375  ⚠️ dies on Render (§11)
  → returns album + songs (the share card renders straight from this response)
nightly, 02:30 PT:
  rescore_library_scores()          nightly_predict.py:385  every user, exact again
```
Other users' stored scores lag by the day's drift in the shared prior. Measured on 544
real rated albums, 20 sampled ratings move the most-affected album by about 0.01 and the
average album by 0.0004; scores display to two decimals. Charts are unaffected either
way, because the global board recomputes from raw ratings.

### Journey: load the new-releases feed

```
every 6h, GitHub Actions          .github/workflows/new-releases.yml
  worker/refresh_new_releases.py → backend/new_releases.py build()
     1. AOTY this-week scrape     ranked by rater count; every request has met a
                                  Cloudflare challenge since 2026-09, so this is []
     2. ListenBrainz fresh releases (every album + EP of the last 7 days, ~950)
        ∪ Apple Music most-played albums released in the window
        → Last.fm album.getinfo listeners for each, paced 4.5/s   ~3.5 min
        → top 45 resolved on Deezer for importable ids; 30 stored in cachedfeed
     fails (exit 1, workerrun 'error') rather than store a thin list; the last one stays.
     Each run's workerrun row carries `lastfm`, the count of every lookup outcome
     (found / not found / rate limited / gave up…), so a "too few releases" failure —
     5 of ~40 runs in early October 2026 — says what Last.fm actually did
GET /discover/new-releases        discover.py
  a. in-memory dict               re-read from the row every 30 min
  b. cachedfeed row               served while under 3 days old
  c. quick_build                  only with no recent row: Apple's recent most-played,
                                  padded with Deezer's album chart, ~4s; then stored
  d. an older row if even that fails; 502 only with nothing stored at all
```
Why Last.fm: scored against AOTY's own archived this-week lists for the weeks of
2026-09-12, -19 and -26, 11, 12 and 11 of our top 12 were on AOTY's list. The old
fallback — 24 releases sampled at random, ranked by the artist's total Deezer fans —
managed 0–3, and in the week of 2026-09-26 showed Kärbholz and Blitzkid where AOTY's
top two were Tinashe and Taylor Swift; the new build puts those two first. Apple is
there for the biggest records MusicBrainz hasn't listed yet (Swift's *The Encore* that
week). ListenBrainz's own `listen_count` is 0 for fresh releases, so it cannot rank.
The page never waits on an outside source.

### Journey: upcoming releases (November 2026; iPhone and web)

```
daily, GitHub Actions 04:40 UTC     .github/workflows/upcoming-releases.yml
  worker/refresh_upcoming_releases.py → backend/upcoming_releases.py build()
     1. ListenBrainz fresh releases, future=true, two 90-day windows → ~900 albums/EPs/singles
        dated after today (one row per release group; live/compilation/… kept as `secondary`)
     2. Wikipedia "List of {year} albums" pages (this year's half, next year's) → ~250 notable
        records; a match marks a row `notable`, the rest (~110) join as albums
     3. every artist's Last.fm listeners, for the order within a day — and the second way to be
        notable: an album or EP (not live / compilation / soundtrack / remix / demo) by an artist
        with NOTABLE_LISTENERS (500,000) or more; `notable_by` says which rule
     4. notable rows: Deezer search (paced 6/s, retried when refused) → importable id, tracks,
        cover; iTunes search (0.3/s) for what Deezer lacks
     ~1,000 rows, ordered date → notable → listeners; stored in cachedfeed 'upcoming_releases'
     fails (exit 1, workerrun 'error') when ListenBrainz gives < 100 or Wikipedia < 30
GET /discover/upcoming?days=&types=&notable=&include_secondary=&limit=
  reads the row (30-min memory copy), drops what's out since, filters, and flags
  `artist_in_library` (the caller's albums' credited artists, by `artist_key`)
```
**Notable** — the page shows only these — is Wikipedia's list (an artist with an article of
their own, and a cited announcement: 994 of 998 rows link one) **or** the listener rule,
Jack's choice on 2026-11-10. Wikipedia alone missed 13 records by 500k+ artists that day,
Stray Kids' *SUIATSU* among them; 250,000 would have added 28.
The sources were chosen by live research on 2026-11-10 (the module docstring has it):
ListenBrainz had 111 of the 191 notable records Wikipedia listed for the next 90 days,
with the same date on 110, and is strong on indie, metal and international; Wikipedia is
the notability filter and fills mainstream gaps. Ruled out: Genius's release calendar
(Cloudflare challenge even from a residential IP, and sparse), Spotify (no upcoming data;
closed to small apps in 2026), AOTY / RYM / AllMusic (Cloudflare), Reddit (login wall).
Bandcamp's undocumented discover endpoint has indie pre-orders and is left out for now.

**On iPhone** (`mobile/app/upcoming.tsx`): For You's NEW & POPULAR heading ends in "📅 Upcoming →"
(`SectionHead`'s `action`), which pushes the page over the tabs. It asks for notable albums and
EPs out to 180 days and draws a month at a time as a wall calendar: a release day is a tile of
its biggest record's cover (by the artist's Last.fm listeners) with the date in the corner and
"+N" for the rest; other days are grey numbers; arrows step between this month and the last
with releases. Under it, "N releases scheduled" for the month, then each release day's
records biggest first — cover, title, artist, "in N days". A tile scrolls to its day; a record
opens its **album page** — `album/[id]` by name and artist, with `deezer` when the row has one and
`release` / `cover` from the list — the community view, filled from the catalog when it can be
(cover, year, a tracklist if Deezer already lists one) and from the list's cover and date when not.
While `isUnreleased(release)` (`shared/src/types.ts`) it reads "Out {day} · in N days" under the
artist, has no Rate now, and its one button is **Add to Library** (then *In Library*; the copy goes on the To Listen shelf). That adds
a To Listen copy carrying **whatever tracklist the catalog lists now** — often only the lead
singles, none → a songless copy — with `release_date`, the cover and the list's own name and artist
(so the page finds it again); an import with no songs queues no prediction. A copy with no songs
isn't a single, so it shows in the library. **Rating waits for release whatever songs a copy has**:
your copy's page has no Rate now (and no TRACKS heading without songs) while `isUnreleased(releaseDate)`
or it has no songs, and the rating screen says "Not out yet" (or "No tracklist yet") with Go back,
seeding no drafts until the tracklist has settled. A community page opened by a copy's id knows the
date too: `_community_payload` sends `release_date`, the latest any copy of the record carries, and
both apps drop Rate now while it's ahead.

The rest arrives by **merge** (`backend/tracklist_fill.py`, November 2026): songs are only added,
matched to what the copy holds by recording identity (`recording_key` on the album's own artists,
`tracklink`'s two-songs-one-copy rule, or `track_id` from another copy — never a bare title), numbered
in the list's order with anything the list lacks kept after it, never deleted or re-scored, and a
copy the list adds nothing to isn't touched; new songs link through `tracklink.link_album`, so a lead
single already rated lands on its `Track` and carryover pre-fills it. **Before release a copy may be
topped up any number of times** (singles as they're announced); **on or after release day it gets
exactly one pull, and is never adjusted again** (Jack, November 2026). That is
`Album.tracklist_settled_at`: stamped by the pull, whatever it added, once the copy has songs — and by
`backend/tracklist_settle.py`, a session hook that stamps any copy given songs while its record is out
(an import, a clone, a bin's add, a recommendation), so a copy made from a released record is settled
from birth. The merge opts out of the hook (`MERGING`) and stamps once its pull is done. Songless
copies, and copies whose release is ahead, stay unsettled. Its migration (a one-shot `DO` block in
`init_db()`) stamped every copy with songs whose record was out; on 2026-11-12 that was all 1,699.
Rated and settled copies are left alone. Sources: a longer copy of the record of the **same
edition** (`_clean` of the names equal, which keeps "(Deluxe)" and "(Taylor's Version)" apart where
`subject_key` folds them, and every linked song of the short copy on it; most-shared tracklist
wins; a songless copy may take the standard edition) — for a released copy only a **settled** one,
whose list is a finished pull, so taking it is the pull — then the catalog (Deezer, then iTunes,
`same_album`, own edition first, never a single for a non-single). `POST /albums/{id}/tracklist`
(`albums.fill_tracklist`; owner only) writes the caller's own copy and nothing else — a list a
client sends can reach someone else's copy only if that copy, unsettled and of the same edition,
later takes yours as its donor — so a settled or rated copy comes back untouched; otherwise another copy's songs, then the body (a release the client
resolved, with `album_name`), then, if the record is out, the stamp; a prediction is queued for a To
Listen copy that changed. It returns the copy, `tracklist_settled` and `tracks_added`; `GET
/albums/{id}` sends `tracklist_settled` too, and other album rows carry `tracklist_settled_at`
(shared `Album.tracklistSettled`, null from a server that predates it).
`mobile/lib/useTracklistFill.ts` (web's is the same hook) calls it when you open your own unrated
copy that isn't settled — the catalog looked up first by name and sent with it, one request, once
per copy per session; a released copy with songs whose lookup failed isn't sent, so a dropped
connection can't spend its one pull. And `worker/fill_tracklists.py` does it daily for every
unsettled, unrated copy — songless, not out yet, or out but not yet pulled (each record looked up once,
no connection held across the calls) — in `fill-covers.yml` before the cover fill; a clean catalog
miss still settles a released copy with songs, an errored lookup settles nothing and is tried the
next night; `workerrun` job `fill_tracklists`, exit 0 with `network_failures` counted. Its first run
(2026-11-12, under the earlier top-up-anything rule) added 242 songs to 25 copies (13 from copies, 12
from the catalog); under this rule it has nothing to do until a record is added before release.
No genre, by decision: Wikipedia's
genre column is mostly blank and the fallbacks were too thin to be worth a chip.

**On web** (`frontend/src/pages/Upcoming.tsx` at `/upcoming`, November 2026) — the same page laid
out wide. Reached from the sidebar's **Upcoming** (lucide `CalendarDays`, right after Bins, as in
iPhone's side menu; also in the small-screen bottom bar) and from "Upcoming →" at the end of For
You's New & Popular heading. Same query (`['upcoming', userId]`: notable albums and EPs, 180 days).
The calendar runs the page's full width (Jack's call, November 2026; it was pinned beside the
list): a 7-column grid whose day boxes are square on a phone, 4:3 at `sm` and 16:9 at `xl` (`CELL`),
so six weeks fit on one screen — the biggest record's cover filling the box (cropped), the date
top-left in white, "+N" bottom-right; other days grey numbers; ‹ › step between months that have
releases. The list sits below it: "N releases scheduled", then each release day's records biggest
first, two / three / four across at `sm` / `lg` / `2xl` — cover, title, artist, "in N days".
A tile scrolls its day into view in `<main>`. A record is a link to `CommunityAlbum` by name —
`/album/community?name=&artist=&deezer=&release=&cover=` (`lib/upcoming.ts`'s
`upcomingAlbumPath`, beside `localDay` / `untilText` / `outLine`, which restate mobile's wording;
change both). While `isUnreleased(release)` that page reads "Out {Weekday, Month D} · in N days"
under the artist, has no Rate now and no Recommend, and its one button is **Add to Library** (then
*In Library*), which imports a To Listen copy with `release_date`, the cover and the list's name and
artist, carrying **whatever tracklist the catalog lists now** (often only the lead singles; none →
a songless copy); it falls back to the list's cover and year, and hides TRACKS when there are none.
Rating waits for release on web whatever songs a copy has: `AlbumDetail` hides Rate / Continue /
Rate it yourself unless the copy has songs **and** isn't unreleased (it also shows the "Out …" line),
and `RatingScreen` says "Not out yet" for an unreleased copy and "No tracklist yet" for a released
one with no songs, with Go back. `frontend/src/lib/useTracklistFill.ts` (mobile's hook, line for
line) calls `POST /albums/{id}/tracklist` — the **merge** — when the owner opens an unrated copy
that isn't settled (album page or rating screen): `resolveReleaseByName` first, then one request
carrying it; once per copy per page load, refetching the album only when its songs or settled
state changed. Before release that's a top-up; on or after release day it is the copy's one pull.
The daily `worker/fill_tracklists.py` does the same server-side; this is the fast path. `CommunityAlbum` drops Rate now too when opened by id for a record whose `release_date` is ahead.

### Journey: the charts

```
GET /discover/charts              discover.py:169
  → SELECT every rated album (no filter)
  → facets + filter + group in Python, TWICE (today + yesterday, for movement)
  → ranked by compute_global_ratings()   global_rating.py:59, 60s memo
  → charts only with MIN_CHART_RATERS raters in the period: 3 this week, 5 all time
```
The rater bar (November 2026) applies to yesterday's board too, so a record that
crosses it today reads as new rather than as a climb. With ~30 raters it leaves about
ten records on each board. The public charts (`public.py`) don't apply it.

### Journey: taste overlap

```
nightly, inside nightly_predict, right after the artist map persists (not on --user runs)
  worker/taste_nightly.run_nightly      one read transaction, closed before computing
    build_cells (taste_matrix)          every user's z-scored cells; aggregates 1.0, album score on
    load_album_features / taste_vectors album feature vectors (Claude's six + audio means), per-user taste
    baseline_similarity (taste_baseline) every pair: direct + category + feature layers → (r, evidence)
    to_percent (taste_overlap)          γ 0.5, EVIDENCE_K 10 — 50 until there is evidence
    displayed → smooth                  eases 30%/night; jumps if either user's rated_at is newer
    reason_for                          a fixed template by band: agree / mixed / split / artist / genre / shared
  one write transaction, bulk          tasteitem (album:<id> vectors + `raters`), tasteuser, tasteoverlap off 50% only
                                        workerrun job 'taste_overlap'
```
A missing `tasteoverlap` row reads as 50%, measured or not. Rows are replaced only if
stamped at or before the night's read, so a newer row from the live path (after a
rating) survives. **All pairs, ~3,000 today, grows with users²**: candidate pairs
(shared records or artists, friends) are needed before a few thousand users; not built.
The run takes seconds now.

```
live, in the request, only when the caller rated since their tasteuser row (taste_live.is_stale)
GET /overlap/sheet         vs that record's other raters  → tasteuser + their pairs upserted
GET /users/{id}/overlap    vs that one person             → that pair only; tasteuser untouched
  load_rows(con, users)    these users' rows; Claude's measures still scaled over the whole catalog
  tasteitem / tasteuser    stored album vectors and the others' taste vectors — never re-standardized
  baseline_similarity(only=caller, raters=catalog-wide: direct counted live, category from the night)
  read, commit, compute, write: the connection is back in the process's pool while computing;
  a recompute that fails rolls back and the stored numbers are served
```

### Journey: a review in the feed and in its thread

```
GET /social/feed                 social.py    a review item carries post_id: its post in the record's thread
  like_count / liked_by_me / comment_count  →  that post's up-votes, your up-vote, its reply_count
POST /social/like?album_id=      toggle_like  a reviewed copy → an up-vote on the post (postlike, recounted);
                                              a bare rating → the old per-copy `like` row
```
One conversation, wherever it's read (November 2026): liking a review in the feed is the
thread's up-arrow, and its replies are the thread's — the feed's "N replies" opens the
thread. The feed's like skips `thread_access`: you were shown a friend's review, you didn't
walk into the room. Likes given in the feed before were moved onto their posts by a boot
migration that also deletes the moved `like` rows (`database.py`), so an up-vote taken back
can't return. Comments on a copy still mirror into the thread only when the commenter may
read it (`threads.sync_comment_post`). On mobile the thread previews a post's first reply
under it, two lines and "View all N replies"; web's thread doesn't yet.

### Journey: the Compare tab

```
GET /social/compare               social.py:329
  → accepted friendships → every rated album of the caller + friends (full ORM rows)
  → group, keep only albums with the caller's score AND ≥1 friend's
  → widest-spread album flagged "disagreement"
```
**Not** O(n²) across the userbase — scoped to the caller's friend set. But live and
uncached on every Social open.

### Journey: get a recommendation

```
nightly: worker → albumprediction(user_id, album_key) for the WHOLE catalog
live:    GET /discover/picks      discover.py:296  ORDER BY predicted_score DESC
         → [] below MIN_RATED_ALBUMS (scoring.py)
         → excludes already_rated and anything already in the library
```

### Journey: "Pass it on" (For You, both platforms)

```
launch / return after 30 min   lib/passItOn.ts   counts an "open" — Keychain on mobile,
                                                  localStorage on web (a page load, or the
                                                  tab visible again after 30 min hidden)
due?  opens ≥ nextAt (a random 3–5 after the last showing), not already today
GET /discover/recommend-suggestion?exclude=albumId:friendId,…
  → caller's rated albums with score ≥ 8.0 AND in their own top quarter, with a tracklist
  → accepted friends with ≥ MIN_RATED_ALBUMS rated
  → albumprediction > 7.5 for that friend, matched on album_key
  → drop friends who own the record in any edition (Album.subject_key)
  → random pair, avoiding recently shown ones; null when none qualifies
PassItOnCell → RecommendSheet / RecommendModal, friend preselected → POST /albums/{id}/recommend
```
The friend's predicted score qualifies the pair on the server and is **never sent**: it
is built from the friend's ratings. The response carries the album and `public_user`
only. A null answer still starts a new gap, so a user with no pair to offer doesn't
spend a request on every open.

### Hubs — blast radius

| Module | Imported by | Break it and… |
|---|---|---|
| `backend.database` | 20 modules | everything |
| `backend.models` | 17 | everything |
| `backend.trackkeys` | 13 (web + worker + theme_predictor + scripts) | every cross-user grouping silently forks |
| `backend.scoring` | 8 (incl. both workers) | predictions and outcomes leave one scale |
| `shared/src/api.ts` | both clients entirely | both apps |
| `song_score_model` | 6 | the whole ML pipeline |

---

## 5. Module reference

**`backend/models.py`** — 34 tables (`Block` for blocking, §5; `Bin`, `BinEntry` and `BinTrack` for bins, §5; `SongPrediction`, a song bin's per-song predictions, §6.3; five for the taste overlap: `TasteItem`, `TasteUser`, `TasteOverlap`, `OverlapSheet`, `OverlapEvent`; the first three written nightly by `worker/taste_nightly.py` and for one caller by the live path, all five served by `routers/overlap.py`). `Album` is a **per-user copy**, not a record
(`:89`); anything "global" must pool copies. `Song` carries `track_id` into the global
`Track`, so audio is analyzed once and shared (`:258-260`) — that split is what makes
the ML affordable. A mapper event keeps `Album.subject_key` in step with artist+name on
every write (`:173-187`), deliberately, because albums are constructed in four places
and `PATCH` writes arbitrary fields through `setattr`. `favorite_*_id` and `top_song_id`
are **plain ints, not FKs** (`:18-19`): a deleted album should blank the pick, not block
the delete.

**`backend/deps.py`** — every endpoint touching user data depends on `current_user`;
identity never comes from a client-supplied `user_id`. **Profiles are public since
October 2026:** `authorize_view` / `viewable_user_id` let any signed-in user read any
user's library, album copies, ratings and stats (404 for a user that doesn't exist).
Before that they required an accepted friendship, and a reviewer's name in For You or a
thread led to "This profile isn't available" for nearly everyone. `authorize_friend`
keeps the old rule — accepted friendship only, pending grants nothing — for what is a
conversation between friends: comments on an album copy (`comments.py`), and the
uncached Claude analysis (`/stats/analysis`, P10). A recommendation note is blanked for
anyone but its recipient (`albums.py`, `_for_viewer`). `thread_access` (`:121`) is stricter: you may read an album's
thread only if **you have rated that album**, because a thread on a record you're
halfway through is the most spoiler-prone surface in the app. It is also the one gate
under which a **non-friend's per-song scores** are visible: `GET /posts/{id}/rating`
(`discussions.post_author_rating`) returns a post author's full rating of the thread's
record — score, factors, every song, review — to anyone past `thread_access`. It is
keyed on a post, not a user id, so only people who have spoken in the room can be
looked up, and only for that record, never their library. **One narrow exception
lets the locked room be seen through the glass** (`GET /threads/preview`,
`discussions.thread_preview`, November 2026, Jack's request): any signed-in caller gets
the room's three most popular top-level **reviews** (`kind` review; the thread's
`popular` order, then all-time standing, then newest), each body clipped server-side to
`PREVIEW_CHARS` (280) so the rest never leaves the server, authors as `public_user` plus
their album score. Never replies, votes, per-song scores or a full rating. Spoilers are
held back harder than inside: a post marked a spoiler by its author, or flagged as one by
*anyone*, is left out entirely, as are deleted posts, posts hidden by reports or reported
by the caller, and authors blocked either way (`BLOCKED_SQL`). It also returns the
caller's copy of the record in any edition (`your_copy`) or the copy Rate now would clone
(`source`), each with `can_rate` (songs, and out). `public_user` is the only
shape one user may see of another (id, name, avatar, bio); `own_user` adds the caller's
private state and backs `auth_response` and `GET /users/me`. Returning a `PressUser`
row directly hands every column to the caller — email and provider ids included — which
is how `GET /users/` leaked them until September 2026.

**`backend/trackkeys.py`** — pure stdlib, safe to import from web, worker and scripts.
Users' catalogs disagree about editions, feat-credits and apostrophes; these keys
collapse "Take Care", "Take Care (Deluxe)" and "Take Care (Deluxe Version)" into one
record. Read §12 before adding a grouping.

**Recording identity (`trackkeys.recording_key`, `backend/tracklink.py`, October
2026).** A `Track` is one *recording*, so audio is analysed once and the global board
pools a song across every edition it appears on. Its key is the album's **primary**
artist (`artist_key`; a song's own credit only when it names none of the album's
artists and most of the copy's songs are like that, as on a soundtrack) and the title with each `(…)`/`[…]` group and ` - …` tail
classified. **Folded** — the same recording: remaster/remastered (any year), deluxe,
expanded, anniversary, edition, bonus, explicit/clean, album/original version,
reissue, and credits that *start* with feat/ft/featuring/with. **Kept apart** as a
`||v:` tag — a different recording: live, demo, voice memo, acoustic, unplugged,
stripped, piano, orchestral, instrumental, a cappella, session, rehearsal, alt/alternate,
take N, outtake, basic track, sped up, slowed, reverb, edit, mono, stereo, and any
"<x> remix", "<x> mix" or "<x> version" (Taylor's Version, Cardi B Version), whose
naming words are kept so two different remixes don't share audio. A version word wins
over a credit ("(Afrojack Remix ft. Pitbull)" stays a remix). An album name contributes
its tag only from a **trailing** qualifier ("Loveworm (Bedroom Sessions)" → `v:session`)
and only when the title carries none — never from a plain word search, because "Dark
Lane Demo Tapes" and "LONG.LIVE.A$AP" are original songs. Titles are NFKD-folded with
apostrophes dropped and Unicode letters kept; a punctuation-only title ("!!!!!!!")
keys on its code points. `tracklink` adds the two rules one title can't decide: **two
songs on one album copy never share a track** (the second "Karma" on *Midnights Til
Dawn* is `||alt2`, ordered so every copy of the record agrees), and duration is a
tiebreak only, matched within 10s (59% of songs have none, and copies of one recording
differ by up to 6s). `link_album` (import, via `albums._link_tracks`) and `link_unlinked`
(the worker's `build_tracks`) are the only writers for songs, so they can't drift again;
`link_bin_entries` is the third, for a bin record's tracklist (§5, Bins), on the same
`copy_keys` and `resolve`.
Until October 2026 each built its own key on `_clean`, which folded "- Live"/"- Demo"/
"- Remix" into the studio song, kept "(2012 Remaster)" apart from the original, and keyed
on the song's full credit string: 58 redundant tracks (The Stone Roses, The Smiths and
Led Zeppelin IV remasters; MBDTF's "Monster" family), 21 album copies with two songs on
one track, and 8 empty-title keys. `_clean`, `album_key` and `track_key` are untouched —
`album_key` is a stored unique key — and `track_key` is legacy. The stored tracks were
re-keyed in one transaction (55 merged into the copy with audio, 22 songs split onto 19
new tracks with no audio, so the ingest fetches the right version). Split tracks never
inherit a song's legacy `songaudiofeatures` row: `backfill_audio` copies one only when it
was analysed after the track was created. Still open: an album that is live throughout
with bare titles ("MTV Unplugged in New York") still shares the studio keys, and
`subject_key_album` / `match_title` still fold "(Taylor's Version)" and "(Remix)" into
the original on threads and the community view.

**Carryover (`backend/carryover.py`).** `GET /albums/{id}`, for the owner, sends
`carried_score` / `carried_from_album_*` on each unscored song whose `track_id` the
same user has scored on another of their records (rated or listening; never another
user's). A source of any size counts when both durations are known and agree within
5s; without durations, a ≤6-track source (a single or EP) does, or any source sharing
at least `MIN_SHARED_TRACKS` (3) tracks with this record, which makes it an edition of
it. Positional titles (intro, outro, skit…) need agreeing durations or that overlap,
and don't count towards it; durations that disagree always refuse. On the data real
editions share 4–24 tracks and every other pair at most 2; *CMIYGL: The Estate Sale*
against a rated copy with no stored durations is why the overlap rule exists. Most recent
wins. Both screens seed it through `shared/src/rating.ts` (`seedDrafts`,
`firstOpenIndex`, `canJumpTo`, `nextTrackIndex` — the first-pass rules, once for both
platforms): the song shows its score with a small "from <album>" note, counts as done,
stays editable, and Next passes over it. It is written to the new copy on the next save
and never back to the source. It used to be an opt-in "Use it" button gated to ≤6-track
sources, and that gate blocked every real match there was (12 *Showgirl* songs from
*The Encore*, all full-album sources); the gate also counted the source's scored songs,
not its tracks.

**Bins (`backend/bins.py`, `backend/routers/bins.py`, November 2026)** — themed collections
of records; spec `docs/superpowers/specs/2026-11-11-bins-design.md`. v1 is Pressd's
**curated** bins, the first the *Apple Music 100 Best Albums* (2024, credited by name, not linked;
no Apple artwork or blurbs — rank, title, artist, year; the blurb under each row is Pressd's own, below). `Bin` (slug, kind `curated` |
`user`, `owner_id` null for Pressd's, `item_type` album | song, source name / link / date,
`visibility`, `sort_order`) and `BinEntry` (position, the source's `rank`, the matched
catalog's **primary artist** with the **list's own title** — so *Purple Rain* is Prince's,
and *Abbey Road* isn't "(2019 Mix)" — `subject_key`, Deezer id, cover, and the resolved
album as `tracklist_json`, /search/resolve's shape). An entry is a **record, never a
copy**: a caller's progress and per-row state join their copies on `subject_key`, so any
edition counts (rated = done; listening, To Listen shown as such). Written only by
`worker/import_bin.py` from `data/bins/<slug>.csv` + `.json` — reusable for every list;
matching is `bins.pick_release` (`same_album`, then the exact artist — a substring credit
let "The Beatles Complete On Ukulele" pass for *Revolver* — then album or EP over
compilation, the standard edition over deluxe / edited / anniversary, the list's year
within one, fewest tracks; never a single). Two Apple rows are pinned by hand
(`overrides`: *Exile on Main St.*, *The Velvet Underground & Nico*); three are doubtful only
because the credit differs (Ms. Lauryn Hill, Prince, Jimi Hendrix). An unmatched row is
kept in place with nothing to add. A run that loses the network for any lookup writes nothing
and exits 1 (`NETWORK_FAILURES`): on 2026-11-11 a dropped connection mid-run stored the
Rolling Stone bin with 134 holes until it was run again. Endpoints, all behind `current_user`: `GET /bins`
(cards: the first four covers as a 2×2, the caller's `progress`), `GET /bins/{slug}`
(each entry with `mine` `{id, status, score}`, `pressd_avg` / `pressd_raters` — the plain
mean of rated copies, the community page's number — and `predicted_score` only when
`predictions_unlocked`), and `POST /bins/{slug}/entries/{id}/add` `{status: listening |
to_listen}` (Rate now / Add; returns the copy already held, in any edition, instead).
There is **no "add the whole bin"** — Jack removed it (November 2026); records go in one at
a time. A copy comes from the stored tracklist through `albums.create_copy` — the same
insert as an import, no outbound call — and **doesn't remember the bin** (Jack's call).

⚠️ **Rule (Jack, November 2026): every album in a bin must be considered for every user's
picks predictions** — the nightly `catalog_predict` must score bin records into
`albumprediction` whether or not anyone has added them, so a bin's For you order and
`/discover/picks` can offer them. **Met since 2026-11-12, as audio arrives:** a bin entry
is a catalog record. (1) Its stored tracklist is on `Track`s through
`tracklink.link_bin_entries` — one `BinTrack` row per song (`entry_id`, `position`, title,
`track_id`), keyed exactly as the copy a bin's Add makes, so that copy (or any edition from
search) links to the same tracks and their audio; a song entry's `BinEntry.track_id` is its
song's track (`song_position`: `match_title`, then the letters without spaces, then the one
title that opens with it). `import_bin` runs it after every write, the nightly ingest as a
backstop; idempotent. (2) The audio ingest queues those tracks **after every library track,
at most `BIN_TRACKS_PER_RUN` (700) a night** (`tracks_needing_audio`), searched by the
entry's artist and title, record by record — capped because predictions start only when
the ingest ends. (3) Claude's `albumfactors` by the entry's `album_key`
(`albums_missing_factors` lists bin records after the library's, skipping one a measured
copy stands for; `backfill_factors --bins`, and the nightly prediction run does the same
before reading the theme axes, so a new bin is measured on its first night). (4)
`catalog_albums` adds `bin_records`: one per `subject_key` with analysed audio that no
catalog copy covers, `album_id` the entry's id negated, genre the catalog's or, for
"Alternative" (a qualifier), the artist's usual genre on Pressd; `song_score_model.bin_frames`
builds its songs' frame. A record with no analysed song yet waits: the song model needs
audio (below). `GET /bins/{slug}`'s `predicted_score` is the record's, by `album_key`, else
by subject key when another edition's copy stands for it; on a **song bin**, the song's own
(`SongPrediction`, one decimal, written by the catalog stage for every song bin's track). On
2026-11-12: 297 entries linked, 3,672 songs on 3,597 tracks (2,770 new, needing audio;
786 already analysed); 195 of 197 song entries on their track (*Blackstar*'s "★" and an
R.E.M. compilation that doesn't hold "Imitation of Life" are not). A private bin
will be a 404 to anyone but its owner; `delete_own_account` deletes a user's bins.
Surfaces: For You's **BINS** section (up to three `BinCard`s, "See all →") on both
platforms — a Pressd bin's card carries the full-colour Pressd mark on a cream chip in
the collage's lower-right corner (`BinMosaic`'s `pressd`); web's sidebar **Bins** (`/bins`, `/bins/:slug`: the banner, the centred title and progress, then the
list, two columns at `2xl`);
iPhone's **side menu** (`components/SideMenu.tsx`, the ≡ beside For You's search icon,
sliding in from the right, the button's side, with its own ≡ landing exactly where the
masthead's was — measured on the tap — so the same finger closes it; the header is the Pressd mark and wordmark on the ≡'s line; sections split by hairlines: Getting Started (the first-run tutorial with `replay: '1'`, as Settings → *How Pressd works* opens it) on its own at the top; the four tabs in the tab bar's own order, icons and labels (For You, Library, Social, Charts — switched to with `router.navigate`, not pushed; For You just closes the menu); Bins and Upcoming; and, pinned to the foot of the panel, Settings and Contact support (a mail to pressdmusicapp@gmail.com; when nothing handles `mailto:` — no Mail app, or the simulator — `openURL` rejects and the menu opens Settings with `focus` `contact` instead, scrolled to About's Contact support row, which takes a green wash fading over 1.5 s. `canOpenURL` isn't asked: `mailto` isn't in Info.plist's `LSApplicationQueriesSchemes`, and adding it needs a native rebuild). Web's sidebar follows the same order, less Getting Started: For You, Library, **Your Rankings** (web's own `/ratings`, its sidebar label since November 2026; the page's heading stays Rankings, since it also shows a friend's library) and Stats beside Library, Social, Charts, then under a hairline Bins and Upcoming (`nav` in `Layout.tsx`, which the small-screen bottom bar also draws) — with the same icons for the pages both have (`ListMusic`, `CircleUser`, `Users`, `BarChart3`, `Package`, `CalendarDays`; web's Stats is `ChartPie`). At the sidebar's foot, under a hairline and above your own name, **Settings** (lucide `Settings`) — a button, not a route, opening `SettingsDialog` in `settings` mode as the profile's gear does; the small-screen bottom bar has no room for it (nine items already), so there the profile's gear is the way. Settings is
the profile's `SettingsSheet` in `settings` mode, which For You mounts too, opened once the
menu has slid away), `app/bins/index.tsx` and
`app/bins/[slug].tsx`. The bin page opens on a **banner** the width of the screen: the lead record's cover blurred
into a wash, and over it the bin's first three covers fanned out (the first in front, the
next two tilted behind), ending in a hard edge — no fade into the page (Jack's call); its
colours are literal, dark in either appearance. Below it, centred: on a Pressd bin (`kind`
curated) the bare Pressd mark — no chip behind it on the page — then the title in Playfair,
then **progress** (`BinProgress`, one per platform): "22 of 100 rated" over a strip of one
cell per record in the **list's own order**, fifty to a row (`binCells` in
`shared/src/binSort.ts`), green where you've rated it, a pale green where it's in your
library, empty otherwise, so the fills sit where your rated records sit in the list. No
source line and no average (Jack's calls). A Pressd bin's **card** keeps the full-colour
mark on a cream chip in its collage's corner (`PressdBinBadge`). Then Sort by and the
records. On iPhone the back button floats on a dark disc and the status bar is light.
A row always opens the record's Pressd page (the community view — through your copy's id
when you hold one, else by name), never anyone's own rating. A **Sort by**
dropdown (iPhone: `AnchoredMenu`, which gained `divider`; web: its own menu) picks the
source's order, Pressd's order (the average), Most rated (raters on Pressd), Your rating, or Not yet rated (unrated
records first, best predicted first, then rated ones by your score), and Ascending /
Descending; choosing an order resets the direction to its own (the list 1 → 100, scores
high → low), and a record with no number stays last either way. The rules are
`shared/src/binSort.ts`, once for both. **Search** (`BinSearch`, one per platform) is a round
magnifier beside Sort by on a bin's page and on the Bins page beside the title (iPhone) or at the header's far right, opening leftward (web); a tap opens
the field, focused, and ✕ (or Escape, or leaving it empty) folds it. On a bin's page opening it
squishes Sort by down to its ⇅ icon on the left while the field grows across the row, and
tapping that icon folds the search away and lets the sort back out — the page holds the open
state (`open` / `onOpenChange`); iPhone animates it as one `LayoutAnimation`, web as width
transitions on one element each. It filters the bin's
records by title, song, artist, album, year or genre — or the bins by title and source —
ignoring case, accents and punctuation, every word typed required (`binEntryMatches`,
`binCardMatches`). A change of order slides each row to its new place
— `LayoutAnimation` on iPhone, a FLIP on web (`useSlideRows` in `pages/Bin.tsx`) — and
nothing moves under Reduce Motion. A row (taller since November 2026, faint hairlines between) starts with a large cover
at the page's left edge (120pt iPhone, 152px web), the rank printed on it in white
Playfair Black, lower left; beside it the title, artist and year · genre, then the
figures — YOU (once you've rated it) leading, PRESSD (the average) smaller in grey; in
Pressd's order the other way round, and in Most rated a RATINGS count leads with both
scores grey — and, while you haven't,
a star (Rate now; continues your copy if you hold one) and a bookmark (save to your
library, filled once it's there). On web the figures and the two buttons are one group at
the row's right edge, on the words' bottom line, and the middle holds the entry's **blurb**
(two lines at most, from `md`; below `sm` the group drops under the words, figures left,
buttons right). iPhone shows no blurb: its rows are already taller than their 120pt cover.
**Blurbs** are Pressd's own sentence per entry (`BinEntry.note`, served as `blurb`), never
the source's write-up: `worker/bin_blurbs.py` gives Claude only the facts (artist, title,
year, genre; a song's album) and asks for one factual line of at most ~22 words — no
hype words, no quality talk, no "This album". They live in `data/bins/<slug>.blurbs.json`
by rank, versioned with the list; `import_bin` sets `note` from that file on every
re-import. On 2026-11-12 all 100 Apple and 200 Rolling Stone entries got one, each read for
accuracy and about 30 corrected by hand in the file. Each row carries year · genre: the genre its copies on Pressd
carry most, else the catalog's from the stored resolve. **Song bins** (November 2026, `item_type` song): the second Pressd bin is Rolling Stone's
*The 200 Greatest Rock Songs of the 21st Century So Far* (published 2026-10-27; ranks, artists,
titles and years read once from the article's own list data into
`data/bins/rolling-stone-200-greatest-rock-songs-21st-century.csv`). The import tool matches a
song row by Deezer track search (`bins.pick_song_release`: the track's and the album's artist —
never a various-artists sampler — the title by `match_title`, then the studio take, a
non-collection album over hits / best-of / Christmas sets, the album over the single, the
list's year, the earliest) and stores the album it came out on: `BinEntry.song_title` is the
song (the list's spelling), `album_name` / `subject_key` / `tracklist_json` the album. A song
entry has no track of its own; `bins.song_states` finds it on everyone's copies of the album
by `match_title`: your score once given (status rated), else the album's place in your
library; the PRESSD figure is the plain mean of everyone's scores for it, one decimal as song
scores are; `track_id` when any copy holds it, so a tap opens the album's Pressd page with the
song highlighted (`track`). Progress counts scored songs. Rate now / Add act on the album.
Later phases (spec §7): user bins with Library → Bins (own bins only), then following and
"where Pressd disagrees".

**Blocking (`backend/blocks.py`, `Block`, November 2026).** Blocking someone — the "…" on their
profile, both platforms (iPhone's round button in the banner's corner opens an action sheet; web's
profile menu) — means **neither sees the other's reviews or social activity**, and any friendship
or request between them ends (`POST /users/{id}/block`; `DELETE` lifts it, without restoring the
friendship). Ratings still count everywhere: charts, averages, Pressd scores (Jack's rule). One
definition, checked at each surface: `blocked_ids` (either direction) for ORM reads, `BLOCKED_SQL`
for raw post SQL, `is_blocked` for a pair. Applied to For You's userbase reviews, recommendations in
the feed, a thread's posts and replies and the discussions feed, people search (`/users/search`,
`/search/all`) and contact matching, the people sheet and a profile's friends list
(`Store.blocked`), friend requests (refused) and reply notifications; friends-only surfaces drop the
person because the friendship is gone. `GET /users/{id}/profile` adds `blocked_by_me` (never whether
they blocked you). **Settings → Blocked users** (both platforms) lists `GET /users/me/blocked`,
newest first, each with Unblock. `delete_own_account` deletes blocks either way. Apple's guideline
1.2 wants report *and* block for apps with user content; Pressd had only report.

**Settings, both platforms (November 2026).** iPhone (`SettingsSheet`, `settings` mode):
Notifications (its dropdown shows an up chevron while open), Preferences, Sign-in methods, Account
(email, phone, **Blocked users** — a page inside the sheet with a back chevron), **About** (How
Pressd works, **Rate Pressd** — `itms-apps://…/id6796907083?action=write-review`, the listing in
`frontend/src/lib/iosApp.ts` — Contact support, Privacy policy, **Terms of use**, **Community
guidelines**), then Sign out and **Delete account** last. Web's `SettingsDialog` now carries the same
sections less what only a phone has (notifications, haptics, Library's start shelf): sign-in methods
(`fetchLinkedProviders`; Google connect / disconnect, Apple shown but connectable only on iPhone,
the last method never disconnectable), phone, Blocked users, Appearance, the same About links, Sign
out and **Delete account** (a confirm dialog, then `deleteOwnAccount`) — so a web-only user can
delete their account. Support mail goes to **pressdmusicapp@gmail.com** (both apps and the privacy
policy). The public legal pages — `/privacy`, `/terms`, `/guidelines` (`pages/Privacy.tsx`,
`Terms.tsx`, `Guidelines.tsx`) — share `components/LegalPage.tsx`; the terms and guidelines describe
blocking, reports and deletion as built, so change them with the product.

**`backend/routers/search_all.py`** (November 2026) — the single search box. `GET /search/all?q=&group=&limit=`
returns `people`, `albums`, `artists`, `songs` (one key with `group`; `limit` 4, capped at 25; `q` under two
characters answers empty; a bad `group` is 422), ranked by `search_rank`. `POST /search/known` takes up to 50
`{name, artist}` from a catalog search and says which Pressd already has, so the client opens that record instead of
offering an import. A record qualifies when the caller owns a copy or anyone has rated one — the SQL applies it, so
a stranger's To Listen never leaves the database — and **singles are included**, which the library hides. Candidates
load in two steps (copies whose own text matches, then every visible copy of those records by `subject_key`),
because the ranker counts raters from what it is handed; the first step is capped (400 copies, 40 people).
`_community_payload` track rows now carry `track_id` (null for a title-keyed bucket). A song row carries the
`art_url` of the copy it points at, so its cover is the record a tap opens.

**Search on iPhone** (`mobile/app/search.tsx`, November 2026) — opened by the bare search
icon at the top right of For You's masthead, where the date was; pushed over the tabs,
field focused, **Cancel** back. From two characters (200 ms debounce) it asks
`searchAll` and draws People, Albums, Artists, Songs, then **From the catalogs**:
`useAlbumSearch`'s hits minus every one `searchKnown` says Pressd has, held back until
that check answers (a small spinner in the heading meanwhile). Each group shows four;
**See all** re-asks that one group (`searchAll(q, group)`) in place, **Show less** puts it
back. Every row uses Add an album's row type (Plus Jakarta, no Playfair italic; scores in Playfair); albums and songs
show the cover, artists their photo (`['artist-image', name]`, the artist page's cache),
people their avatar. An album shows your score, Listening / To Listen, or the PRESSD AVG,
to two decimals. Taps: a person through `useOpenProfile`; your copy `/album/{id}`; anyone
else's record its community view; an artist `/artist/{name}?mode=pressd` (the artist page opens on the Pressd average for `mode=pressd`, as it does on Compare for `mode=compare`; no param is still *mine*); a song through
`songTarget`, which adds `track` only to a rated copy of yours or the community view. A
catalog row previews the record, and its Rate now / Add to library buttons are Add an
album's, both screens going through `mobile/lib/catalogPick.ts` (`useCatalogPick`).
Before typing, the last `RECENT_MAX` (8) tapped results, kept in the Keychain under
`recentKey(user id)` with **Clear**; `signOut` deletes that item. `album/[id]` reads the
`track` param (a track id): once the row lays out it scrolls into the upper third and a
green wash fades over 1.5 s — own copy only when rated, community view by `track_id`.

**Search on the web** (`frontend/src/pages/GlobalSearch.tsx` at `/search`, November 2026)
— iPhone's screen, laid out wide. For You's header has the same bare `Search` icon at its
top right, where the date was (no circle or fill behind it). The field runs across the top,
autofocused; **Esc** or Cancel goes back (`/for-you` with no history); ↑/↓ move a highlight
through the visible rows, in reading order, and Enter opens it. People, Albums, Artists and
Songs sit as four columns at `lg` (two at `md`, one below), From the catalogs full width
under them. The behaviour is mobile's line for line: the debounce, four per group with See
all / Show less, the catalog check by name|artist (only unchecked hits asked, an unchecked
hit hidden, shown if the check fails), the "Nothing on Pressd matches" line and the error
only once the current query has answered (`!isPlaceholderData`), the same taps (a person
`/u/{id}`, an artist `/artist/{name}?mode=pressd`), and rows in Add an album's type
(`AddAlbumModal`'s `text-sm font-medium` / `text-xs`). A catalog row opens the record's
community page by name; its Rate now / Add buttons resolve and import as Add an album does
(rate → `/rate/{id}`). Recents live in `localStorage` under `recentKey(user id)`, read
synchronously so a tap can't be overwritten by the read; `UserContext.signOut` removes the
item. `AlbumDetail` (your copy, only when rated) and `CommunityAlbum` read `?track=` through
`lib/trackHighlight.ts`: the row with that `data-track-id` scrolls to the middle and plays
`flash` once. The orphan `pages/Search.tsx` is a different, older page.

**`backend/routers/albums.py`** (1,335) — the largest router. `import_album` (`:398`)
dedups, inserts, then `_link_tracks` resolves global track ids through
`tracklink.link_album` (recording identity, above). `GET /albums/{id}` also returns
`owner` (`public_user`) and `viewer_copy` (`{id, status, score}`: the caller's copy of the
record in any edition, by `subject_key`, or null), which both clients use to decide what
someone else's copy offers: your rating and compare, continue rating, or rate/add. Before
this web offered Rate/Add on every copy that wasn't yours, even a record you'd rated.
`recommend_album` (`:803`) refuses without a tracklist (`:831-836`) and fills in whatever
the recipient's shell copy is missing, but leaves anything they've engaged with alone.
⚠️ **`GET /albums/` (the list) returns albums without their songs**; only
`GET /albums/{id}` carries them. Anything that needs per-song state for a listed album —
how many tracks are scored, say — must fetch the album itself. Both For You screens do
this for the "Pick this back up" card; web counted songs on the list row until
September 2026 and so always read 0.

**Phone numbers (both platforms, October 2026)** — for finding friends from contacts,
which hold numbers far more often than the emails Pressd has. Verified with **Firebase
Phone Auth on the client** (`mobile/lib/phoneVerify.ts`, `frontend/src/lib/phoneVerify.ts`):
Firebase texts and checks the code, and the client sends `POST /users/me/phone` the ID
token that comes back — never the number. `backend/phone.py` reads the number out of
that Google-signed token (provider `phone`, verified within 10 minutes) and stores only
`PressUser.phone_hash`, an HMAC-SHA256 under `PHONE_HASH_KEY` (a plain hash of a
ten-billion-number space is reversed by brute force), plus `phone_last4` for Settings.
One account per number (a partial unique index; 409 otherwise). `DELETE /users/me/phone`
forgets it. A **one-time prompt** asks every account that hasn't answered
(`phone_prompt` null — existing accounts included, unlike the tutorial). A new account
meets it as the username page's second step, on both platforms (Continue opens the
phone sheet / dialog there, and either answer moves on); an older one after the
tutorial: *Add* records `added` via the add itself,
*Not now* records `skipped` via `POST /users/me/phone-prompt`, each with
`phone_prompt_at`. `own_user` carries `phone_prompt_done` and `phone_last4`. Both
clients refresh `GET /users/me` behind the stored session — mobile at launch, web
whenever the signed-in id changes — because a session stored before the fields existed
would otherwise never see the prompt. UI: `PhoneSheet` (mobile; Settings → Account) and
`PhoneDialog` (web; the Edit Profile dialog). Setup outside the repo: Phone sign-in on
in the Firebase console, `PHONE_HASH_KEY` on Render, and the four `VITE_FIREBASE_*` on
Vercel with the site's domains authorised.

**Custom profile banners (both platforms, October 2026)** — an uploaded picture,
stored **24:5 at 1920×400** (`BANNER_SIZE`) through the same decode path as
avatars (`_normalize_image` in `users.py`: EXIF stripped, rotation applied, pixel-bomb
guard). Both apps show it **sharp**, as a rounded strip at the top of every profile
(Pressd green when there's none) — on web with the avatar riding up over its bottom
edge, in front of it; on iPhone nearly edge to edge (`BANNER_INSET`, 6pt from the screen's sides and below
the status bar), with the avatar riding up over its bottom edge the same way; web has
a pencil (Edit profile, where the banner changes) and a gear (Settings) on your own. Mobile's strip (`ProfileBanner`, `BANNER_HEIGHT`) is 112pt
tall, so it loses a little of the sides of what was framed. It was 480×200 while it was only ever
blurred — no banner had been uploaded when it changed. Both apps crop to 24:5 before
uploading (mobile's picker `aspect: [24, 5]`; web's `BannerCropper`, drag and zoom,
opened whenever the picked picture isn't already 24:5 — `lib/banner.ts`, and
`lib/useBanner.tsx`, which Settings and the profile's button share),
so what someone frames is what's kept. Sharp means seen as uploaded: avatars were
already in that position, and there is no moderation of either. `UserBanner` holds the
bytes and `PressUser.banner_url` points at them. The endpoints are
`POST`/`DELETE /users/{id}/banner`, plus an unauthenticated `GET` for the same `<Image>`
reason as avatars. `banner_url` rides on `GET /users/{id}/profile`; an album cover never
stands in for it. It's set in Settings → Profile,
which writes the new URL straight into the `['profile', id]` cache. Web sets it in
Settings (`SettingsDialog.tsx`). Neither app draws a blurred wash on a profile.

**Other people's profiles on mobile** are `app/friend/[id].tsx`, for anyone, friend or
not: identity comes from `GET /users/{id}/profile` as on web, a failed load says "This
profile isn't available", and the button is Add, Requested, Accept or Friends.
`lib/useOpenProfile.ts` is the one way to open a person (your own id goes to the Profile
tab); every name and avatar goes through it, except `RecommendSheet` rows, where a tap
selects the recipient, and `RecommendationBanner`, whose whole surface opens the
recommendation. Under the banner it shows the taste overlap (below, **On iPhone**).

**Your own profile on web (October 2026)** is `FriendProfile` at `/u/{your id}` — the
sidebar's name and the small-screen *Profile* button open it. The header: the banner
strip, the avatar riding up over its edge, the name with "@handle" under it, the bio on its own line,
the album-score distribution (`ScoreHistogram`, no axis) under the avatar, and a stat
row between two rules in mobile's order: Avg score, Albums, Artists (distinct,
case-folded), Songs and Friends. When it's you, the friend button becomes **Share profile** (your invite link,
through the share sheet or the clipboard — a profile itself is behind sign-in), and the
banner carries mobile's pencil and gear, opening `components/SettingsDialog.tsx` (which
was the Edit Profile modal inside `Layout.tsx`) in `mode` `profile` — photo, banner,
username, bio, location — or `settings` — phone, Google link, the tutorial replay,
sign-out. Every profile now shows **the shelf**
(`components/ProfilePicks.tsx`; mobile's `ProfileBanner` `ShelfRow`) — "{name}'s shelf":
four of the person's own rated albums, by slot, drawn as covers overlapping and
staggered (`TILT` / `LIFT`, `SHELF_TILT` / `SHELF_LIFT`), under a heading in Unbounded Bold.
Every cover is the width it has on a full shelf of `SHELF_SIZE`, however many are shown,
on both platforms; on web they stretched to fill the row until November 2026, so a shelf
of one was a 768px cover. On your own page
every slot shows, empty ones dashed with a +, and a slot opens a picker over your rated
albums best first (web's `ShelfDialog`, mobile's `app/favorite/album?slot=N`, also
reached from Edit profile → Shelf); an album already on the shelf moves to the new slot
(`shelfWith` in `shared/src/api.ts`). On someone else's only the albums show, each
opening their copy, and a bare shelf isn't drawn. Stored as `PressUser.shelf`, a JSON
array of `SHELF_SIZE` (4) album ids or nulls (it was 5 for a day; a longer stored array reads as its first four), written by `PATCH /users/{id}` with
`shelf` (each one of the caller's rated albums, none twice) and served resolved on
`GET /users/{id}/profile` (a deleted album reads as an empty slot). Its migration seeded
slot 1 from `favorite_album_id`. It replaced **My Picks** (favourite song, album and
artist) in November 2026: those columns and their `favorite_*` payload fields stay, for
app builds that predate the shelf, but neither app shows or edits them, and mobile's
`app/favorite/song.tsx` / `artist.tsx` are unreachable. Hidden below ten rated albums
(`picks_unlocked`), on both platforms. Someone else's profile adds the taste overlap under the name
(below). Account deletion
now removes both picture rows; before this it never removed `UserAvatar`, whose
foreign key blocked deleting any account that had a photo.

**Finding friends from contacts (mobile only, October 2026)** — the section under the
search box in Social → *Find friends* while nothing is typed: a *Connect contacts* card,
then — once connected — a *Contacts* row that opens the list (straight away only on the
visit that connected). The reason Apple wants before any contact leaves the phone is
the iOS prompt's own text (`NSContactsUsageDescription`). It reads names and numbers through
`mobile/lib/contacts.ts` (`expo-contacts/legacy`; numbers without a country code read as
US), and sends only the numbers, as E.164, to `POST /users/me/contacts/match`. The server
hashes each under `PHONE_HASH_KEY` in memory, compares against **verified** numbers, and
keeps and logs nothing; it caps a request at `MAX_CONTACT_NUMBERS` (5000) so it can't serve
as a lookup for arbitrary numbers. **Phone only, never email** — a number is what people
agreed to be found by in the prompt; nobody was told that about their email. Matches come
back as search rows (`_with_relationship`, shared with `/users/search`) plus
`phone_index`, so the app can say which contact it was; everyone else gets *Invite*, an
`sms:` text carrying the caller's permanent invite link (`getInviteLink`). Web has no
address book to read, so this is a platform difference, not parity drift.

**First run (both platforms).** Mobile's `app/(tabs)/_layout.tsx` and web's `AppGate`
(`frontend/src/App.tsx`) send an account whose `tutorialSeen` is explicitly `false` to
`/tutorial`: five cards (`components/TutorialScenes.tsx` on each platform — swiped on
mobile; Next/Back, arrow keys and touch swipe on web), then `/welcome` for the
first-album pick. The copy and the scenes' fixed numbers are duplicated per platform;
change both. Finishing
and skipping both count as seen. The flag is `PressUser.tutorial_seen_at`, set once by
`PATCH /users/{id}` with `{"tutorial_seen": true}` and returned as `tutorial_seen` by
`auth_response` and `GET /users/me` (`deps.py`, `own_user`); dev-token sign-in reads
`/users/me`. Its migration stamps every account that existed when
the column arrived, so only new sign-ups see it. Because the flag is on the account, a
tutorial met on one platform is not shown again on the other. Mobile Settings → *How
Pressd works* and web's Edit Profile dialog replay it with `?replay=1`, which records
nothing. Web keeps the flag in `UserContext`, so every web sign-in site must pass
`tutorialSeen` through. The last card promises predictions after
10 rated albums, restating `MIN_RATED_ALBUMS` — change both.

**Profile location (November 2026).** `PressUser.location`: free text the person types
("Brooklyn, NY"), up to `LOCATION_MAX` (40) characters, whitespace folded, empty clears
it — set through `PATCH /users/{id}` (`location`) and returned on
`GET /users/{id}/profile`, never on `public_user`. Never read from the device: people
choose how specific to be. Edited on both platforms (mobile's Edit profile sheet;
web's `SettingsDialog`), both of which write the answer into the
`['profile', id]` cache. Shown beside the handle with a pin: mobile `ProfileBanner`
("@name | 📍 …", the location truncating first), web `FriendProfile`'s handle line.

**Usernames (October 2026).** `PressUser.name` is a username, not a display name: 3–20
characters of lowercase letters, numbers, `.` and `_`, unique regardless of case
(`backend/usernames.py`; the client copy is `USERNAME_RE` / `cleanUsername` in
`shared/src/types.ts` — change both). `PATCH /users/{id}` enforces it on every name
set from then on; names from before keep their spaces and capitals until changed. A new
account starts on a suggestion made from the Google name or email ("Jack Kalsched" →
`jackkalsched`), and meets a username page **before** the tutorial, prefilled with
it: `mobile/app/username.tsx` and web's `frontend/src/pages/Username.tsx` at
`/username`, gated by `(tabs)/_layout` and `AppGate`. Saving any name stamps `PressUser.username_chosen_at`, returned as
`username_chosen` by `own_user`; its migration stamps every existing account, as the
tutorial's did. Sign in with Apple no longer requests `FULL_NAME`. Every web sign-in site
passes `usernameChosen` through alongside `tutorialSeen`, and web's Edit Profile field
filters input through `cleanUsername`.

**Artist credits (`backend/credits.py`, October 2026).** `Album.artist` is the
**primary** artist alone; the other credited artists are in `Album.extra_artists`, a
JSON list filled by `/search/resolve` from the catalog's own structured credit —
Deezer's Main contributors (never Featured), MusicBrainz's artist-credit, and for
iTunes, whose credit is one joined string, the collection's `artistId` for the primary
and the same album on Deezer for the rest (`_itunes_credit`). A Deezer or iTunes
co-artist counts only when the other catalog's printed credit names them too
(`named_in`): Deezer lists a band's members as Main beside the band (Snocaps with
Waxahatchee), and an unconfirmed co-artist is dropped rather than guessed. A name
contained in the primary's is the same act (`Ye` beside `Kanye West`). Every identity key
(`subject_key`, `album_key`, the recording key, the thread) stays on the primary, which all
three sources agree on. For display and for every per-artist number — the artist page,
league tables, SAR, bang/skip, the scatter, "most rated artist", the profile's Artists
count — a record belongs to **each** credited artist in full (`album_artists`,
`song_artists`, which also reads a joined song credit naming one of them as theirs). The credit is **never** split on its punctuation: in the library that
would break AC/DC, Bob Marley & The Wailers, Catfish and the Bottlemen and Tyler, The
Creator. Until then an iTunes import stored "Anderson .Paak & Cordae" and a Deezer
import "Anderson .Paak", so *Heavy Is the Crown* was two records with two sets of
tracks and two threads; and `extra_artists` came from a text box on both rating screens
that people skipped or filled with song titles, which is gone. A one-off backfill
corrected the 18 stored copies that needed it (commit `b8c4d08`). `GROUP_MEMBERS` holds
the rare act that belongs to its members rather than being an artist: Silk Sonic is filed
as Bruno Mars with Anderson .Paak (`expand_groups`, applied in `/search/resolve`), and has
no page of its own. Add a name only by decision; Clipse and Rae Sremmurd stay artists.

**Genres (`backend/genres.py`, the tagger in `albums.py`).** An import keeps the
catalog's genre (iTunes `primaryGenreName`, Deezer's first genre) through
`canonical_genre`, then `_queue_genre_tagging` asks Claude Haiku for a genre and three
subgenres whenever the album lacks **either** (`_needs_genre_tagging`), filling only
what's empty; Last.fm (`generate_genres_lastfm.py`) is the fallback for both when
Claude returns nothing or fails. **"Alternative" is a qualifier, never a genre**
(`QUALIFIERS`, `genre_qualifier`): `canonical_genre("Alternative")` is None, the tagger
is told the catalog said it so it picks the genre it qualifies, and a bare
"Alternative" subgenre is tied to the album's genre ("Alternative Rock") by
`canonical_subgenre(raw, genre)`. Until October 2026 the tagger ran only when the genre
was missing, its Claude call raised past the Last.fm fallback, and from the moment
Render's unpinned `anthropic` reached 1.x every call failed on `temperature` — 152 of
the 154 albums added that month had no subgenres, and iTunes had filed 97 albums under
"Alternative" alone. A one-off backfill tagged the 421 stored albums that needed it
(commit `8a28b6f`).
**One set of genre tags per record** (`backend/genre_sync.py`, November 2026, Jack's rule):
every copy of a record (`subject_key`) carries the same `genre` and `sub_genre1–3`, and a change
on one copy is a change on all of them. Kept on the session (registered from `models.py`), not at
the writers: a new copy takes the record's tags whatever its catalog said (a record nobody holds
yet keeps the catalog's, and they become the record's); a copy whose tags change — the tagger,
a backfill, `PATCH /albums/{id}`, anything through the ORM — writes them to every other copy in
the same flush; a copy renamed onto another record takes that record's. So the tagger runs once
per record, not per copy. On 2026-11-12 a one-off pass brought the 137 records (198 copies) whose
copies disagreed onto one set each — the most complete, then the one most copies had.
**`anthropic` is pinned to 0.44.0** in both requirement files: 1.x removed
`temperature`, which the tagger and the theme measurements pass (§7). Moving to 1.x
means deleting it from all five call sites, a change to how reproducible the theme
axes are — decide that on purpose, not through a deploy.

**Taste overlap on the surfaces (`backend/routers/overlap.py`, November 2026)** — the
number on a profile and the people sheet after a first rating (spec §5; the nightly
computation is §4, "Journey: taste overlap"). Four endpoints, all behind
`current_user`; profiles are public, so anyone signed in may ask about anyone, and
people appear only as `public_user`.

- `GET /users/{id}/overlap` → `{percent, reason, connecting_album_id, connecting_album,
  shared_records, shared_count}` — the last two are the records you have both rated, as
  their copies newest first: the first `SHARED_SHOWN` (3) as album briefs, and how many in all.
  `percent` is a whole number, the stored pair or **50 when there is no row** (a missing
  row is 50, measured or not); null only for yourself; 404 for a user that doesn't
  exist. `reason` is the stored `reason_for` dict — `kind` (agree / split / mixed /
  artist / genre / shared), its structured fields (`subject_key`, `album`, `artist`,
  `genre`, and `agree_subject_key` / `agree_album` on mixed) and `text` — plus
  `album_id`, the **other user's** copy of the reason's record, for Compare.
  `connecting_album` (`{id, name, artist, art_url}`) is that copy, else their most
  recent rated copy of any record you both rated, else null.
- `GET /overlap/sheet` → null, or `{sheet_id, album {id, name, artist, art_url},
  fallback, raters, people: [{user, percent, top_song, bottom_song, from_album}]}`
  (`fallback` always false and `from_album` always null, kept for app builds that
  predate November 2026). `raters` is every other user with a rated copy of the record, friends and pending
  included — the heading's count, not the three shown. It serves the
  newest `owed` sheet under **48 hours** old (`SHEET_TTL`) and supersedes every other
  owed one, and an owed sheet whose album was deleted or is no longer rated; that is
  its only write to sheets. It is otherwise **read-only**: asking again, or from the
  other device, serves the same sheet, and nothing is marked shown. People are other
  users with a rated copy of the record (`subject_key`, any edition) — never yourself, a
  friend, or anyone with a request pending either way; `pick_people` takes two from the
  top quarter and one from the bottom. Songs come from their copy of the record
  (`scoring.top_bottom_songs`, the same pair For You's review previews show). Nobody
  left: null, and the sheet is superseded, so it can't turn up later once someone does
  rate the record. Until November 2026 an empty record fell back to every user with a
  rated album ("People who like what you like", songs from their nearest record), which
  put strangers who'd never heard the album under it.
- `POST /overlap/sheet/{id}/events` `{action, target_user_id}` → `{ok: true}`; 404 for a
  sheet that isn't yours. The client posts `shown` once the sheet is on screen — that is
  what clears it (`status` shown, `shown_at`), logged once however many devices show
  it — and `not_now` also clears it. `add`, `open_discussion` and `open_profile` are
  logged as they come.
- `GET /overlap/friends/{id}` → `[{user, percent, relationship}]`: that profile's accepted friends,
  each with the **viewer's** overlap with them (`friends_overlap`) — yours with each of
  theirs, or with each of yours on your own profile. 50 for a missing row; you, when
  you're in their list, first with `percent` null; the rest highest first, then by name.
  It runs the profile pill's live refresh (`mark_fresh=False`) over those friends, so the
  list and the pills agree. Behind the **Friends** figure on both platforms: mobile's
  `FriendsSheet` (a bottom sheet in `PeopleSheet`'s manner, opened from `ProfileBanner`'s
  figure, which takes an `onPress`) and web's `FriendsDialog` (from `FriendProfile`'s stat
  row). A row opens that person's profile and shows their bio, one line, under the name.
  `relationship` is where the viewer stands with each (`self` / `friends` / `sent` /
  `received` / `none`, from `Store.relationships`); on someone else's list each row but
  yours ends in the profile button's words — **Add** or **Accept** (both `addFriend`,
  which accepts a pending request), **Requested** or **Friends** — to the right of the
  overlap. Your own list has none.

**The live path** (`backend/taste_live.py`) keeps the sheet's numbers fresh: a caller
who rated since their `tasteuser` row recomputes, inside the request, against that
record's raters (the sheet) or the one person (a profile) — never everyone, which is the
nightly run's job. It is the nightly
computation on fewer users: same cells, the stored `tasteitem` album vectors and the
others' stored taste vectors, and every column discounted by the whole userbase's
raters, as the night does: the caller's songs, factors and album scores counted live,
and the artist, cluster, genre and subgenre counts read from the nightly's `raters`
row in `tasteitem` (a JSON object, column → count), falling back to the loaded users'
count only for a column new since the night. No smoothing (the caller rated since).
`tests/test_taste_live.py` pins that on the same data it reproduces the night's pairs;
a column the caller joined since the night is one rater short until the next nightly. Only the sheet marks the caller fresh; a profile writes
just its pair, so a profile opened first can't leave the sheet on last night's numbers.
The nightly writes a `tasteuser` row for every user with cells (`[]` when they have no
vector) so that freshness is defined for everyone.

**On web** (`components/TasteOverlap.tsx`, `components/PeopleSheet.tsx`, November
2026). `FriendProfile` asks `fetchOverlap` (`['overlap', viewer, id]`) on anyone's profile
but your own, and draws one `OverlapPill` under the bio for a friend and a stranger alike:
a small outlined pill, your own avatar then the percent in Playfair, coloured on the score
scale (below), with "taste overlap" — a figure to read, not a link; the reason is its tooltip. Until November 2026 it
was filled, with both avatars and the covers of the records you'd both rated, each a link
to compare. The endpoint still sends `shared_records` / `shared_count`, now unused by
both apps. Only the button beside it says which relationship it is: **Add friend** /
**Accept request** / **Friends** filled green, **Requested** tinted. Clicking **Friends**
(or *Remove friend* in the round "…" menu, beside Copy profile link) opens a prompt —
their avatar, "Remove {name} as a friend?", Cancel and Remove — so a stray click can't
undo a friendship. The handle line adds "Pressing since {Mon YYYY}" from
the profile's `created_at` (absent for accounts older than the column). 50% is drawn like
any other number. The reason's `text` is only ever plain text — the tooltip drops its
`<i>` tags and unescapes the entities the server put in the rest — never HTML. The sheet has one mount, `PeopleSheetHost` in
`Layout`, the only observer of `['people-sheet', userId]` (`lib/peopleSheet.ts`;
`staleTime: Infinity`), so it asks once per page load — a sheet owed from the other
device — and again when `RatingScreen` invalidates the key as its share card closes
(`closeFlow`). The rating flow is outside `Layout`, so the sheet opens over the album page
the flow lands on, never inside the flow; it also waits while the one-time phone prompt
is up. It is a dialog (`fade-in` + `pop-in`): the cover and "{raters} people rated *album*
too" ("1 person" at one), one card per person — avatar
and name opening `/u/{id}`, the percent, **Add** (then Requested), and Best/Worst songs
drawn as For You's review previews draw them — side by
side on desktop, then **Not now** and **Open the discussion** (`resolveThread`, then
`threadPath`). `shown` is posted from the dialog's first render, once per sheet per page
load (a module-level set, since `Layout` remounts between route trees); closing it any
way but a profile or the discussion posts `not_now`; Add, a profile and the discussion
post their own actions, with `target_user_id` where there is one. Closing clears the
cached sheet so a remount can't reopen it.

**On iPhone** (`mobile/components/TasteOverlap.tsx`, `mobile/components/PeopleSheet.tsx`,
November 2026) — the same features in mobile's layout. `app/friend/[id].tsx` asks
`fetchOverlap` (`['overlap', viewer, id]`) on anyone but you and draws the taste overlap
through `ProfileBanner`'s `overlap` slot — under the bio, as web's outlined pill: your own
avatar, then "80% taste overlap" with the number in Playfair on the score scale, not tappable. The
header above it: the banner nearly edge to edge, the avatar (80pt, ringed in the page colour)
riding up over its bottom edge with three figures beside it (Albums, Songs, and the
average in its score colour), then the name with a `stickers` slot to its right (empty
until stickers exist) and the friend button at the far end, the gray "@name" under
it (with "| 📍 {location}" when they've set one), then the bio — all three lined up with the picture's edge (`AVATAR_EDGE`). Your own
page has no button there: a pencil (Edit profile) and a gear (Settings) sit in the
banner's top-right corner (`bannerAction`). Both open `SettingsSheet`, in `mode`
`profile` — picture, banner, username, location, bio, the shelf — or `settings` —
notifications, preferences, sign-in methods, account (phone, sign out, delete), about.
Mobile edits the bio there, 240 characters as on web; before November 2026 it had no
way to, and your own profile didn't show it. Below that, as many genre and subgenre chips as fit one line whole,
at their own width — never shortened, and no "+N" for the rest. It is drawn
for friends and strangers alike. The header's
friend button says the relationship; the reason isn't drawn on iPhone. The sheet's one
mount is `PeopleSheetHost` in the root layout (`app/_layout.tsx`, beside the phone and
notifications prompts), the only observer of `['people-sheet', userId]` (`lib/peopleSheet.ts`,
`staleTime: Infinity`): it asks once at launch and again when `rate/[id].tsx`
invalidates the key as its share card closes (`closeFlow`). It is held — rendered with
the Modal hidden — until the username is chosen, the tutorial seen, the phone prompt
answered and the notifications ask settled (`phonePromptDone === true`), and while the current route
is the rating flow or a first-run screen (`HELD_ON`), so it opens over the album page the
flow lands on. A bottom sheet: dimmed backdrop, grab handle, dragged down or tapped
outside to close; the cover and the same heading as web; one row per person — avatar
and name through `useOpenProfile`, the percent, **Add** (then Requested), and the best
and worst song drawn as `ReviewCell` draws them (green up / `#e0492b` down `Triangle`,
`songScoreColor`, one decimal); then **Not now** and
**Open the discussion** (`/thread/[subject]`, as `AlbumThoughts` opens it). `shown` is
posted from the Modal's `onShow`, once per sheet per launch; the events are web's.

**`backend/routers/public.py`** — the **intended** only unauthenticated surface
(marketing charts). It deliberately duplicates rather than shares `discover.py`'s charts:
no auth, aggregates only, never who rated what. Nothing per-user may ever go there.
Seven other endpoints are deliberately open: account creation, invite lookup, avatar
bytes (served into an `<img>`, which cannot carry a header), and the four `/search/*`
proxies.

**`backend/routers/util.py`** (703) — backfills, bulk audio analysis, album colour,
artist images. Effectively a maintenance console, and it reads like one: these began
as scripts run from a laptop. The whole router now requires a signed-in caller
(`util.py:31-45`), declared once on the `APIRouter` rather than per-endpoint, because
the original gap was endpoints being added without the dependency. Three of its ten
routes are used by the apps in normal running: `album-color`, `artist-image` and
`backfill-covers`.

**`shared/src/albumSearch.ts`** — client-side multi-source ranker. Each source orders
results its own way and those orders aren't comparable (iTunes ranks *Blonde* as the
Netflix soundtrack, Deezer as Frank Ocean's), so everything is rescored against the
query (`:133-154`). The Last.fm popularity prior exists for one case: the band "Rumours"
beats Fleetwood Mac on pure text match (`:108-111`).

**`worker/artist_clusters.py`** — one global KMeans over every artist with analyzed
audio. The matrix holds audio centroid, genre one-hot and subgenre multi-hot and
**no scores, ratings or user ids** (`:5-7`). Membership can't depend on anyone having
rated the artist — that gate would exclude exactly the artists the feature exists for.

---

## 6. Scoring & the ML pipeline

There are **three distinct scoring frameworks** and conflating them is the easiest way
to break the app.

### 6.1 A rated album, on the user's own distribution

`compute_album_score` ([scoring.py:189](backend/scoring.py#L189)) = the song mean, plus
each of the four external factors **z-scored and weighted**:

- **theme, replay_value, production, distinctness** share a fixed **60-point budget**
  stored per user (defaults 25/15/15/5, each ≥5). Weight = points / **100**
  (`weights_from_points:35`) — so the four weights sum to 0.60, not 1.0. The song mean
  is the level; the factors are the adjustment. That is why the 1–10 clamp at `:217` is
  load-bearing.
- Each factor is z-scored against **that user's own distribution, shrunk toward the
  userbase prior** by empirical Bayes (`shrink_to_prior:148`, `SHRINKAGE_K = 5`
  album-equivalents). Variance components implied k≈3.2; 5 trades a little crowd bias
  for steadier scores (`:101-106`). This is what stops a two-album library producing a
  near-zero standard deviation whose z-scores pin every score to the clamp.

**EPs are ≤6 tracks** (`EP_MAX_TRACKS`): the flow skips the four factors and the score is
just the song mean. Duplicated as `isEP` in both rating screens — change one, change all.
**Singles are ≤2 tracks** (`is_single_release:88`): they score and count toward the
user's artist stats, but stay out of the library — `GET /albums/?exclude_singles=true`
(one or two songs; a copy with no tracklist yet isn't one), asked for by Library,
Rankings, the profile and genre pages on both platforms under their own cache key
(`['albums', status, id, 'library']`), so the screens that need every copy keep theirs,
and by every profile's **Albums** figure: `GET /stats/summary`'s `total_albums_rated`
counts by the same rule (November 2026; it had counted singles, so someone else's
profile on iPhone and web's Stats page read higher than their library) —
and off userbase-wide charts, where a one-track
release rated 10 would outrank every real album on one person's say-so.

### 6.2 The global Press'd rating, on the userbase distribution

The same album shows a **different number** to the userbase than in a user's library, by
design. [global_rating.py](backend/global_rating.py) pools the **raw inputs** across
every copy and runs `compute_album_score` once, as if the userbase were a single
listener — it does *not* average finished per-user scores, because each was z-scored
against its own owner's library and they aren't on a common scale.

Song scores are averaged **per track first** (via `track_id`), then across tracks, so a
16-track deluxe can't outvote the 15-track standard (`:112-120`). Factors are averaged
across copies carrying a complete set. Track count comes from the **longest** copy
(`:142`); a release is a single only if **all** copies look like one (`:143`).

### 6.3 Predicted scores

Governing rule, from `worker/nightly_predict.py:4-6`: **every stage that measures an
album is shared across the userbase and paid for once; every stage that decides what a
person thinks of it is fitted per user.**

1. **Song model** — `song_score_model.py`, LightGBM over Essentia audio features plus
   leave-one-out cluster taste features. `fit_for_user` (`:1004`) ramps between a
   personal model and the pooled userbase model *calibrated onto the user's scale*,
   rather than switching at a cliff: personal alone at ≥1300 rated-with-audio songs,
   pooled below 20, a weighted blend between. Three classes, one `predict_frame`
   interface, so callers never branch.
2. **Album analysis** — Claude measures each album **once, globally**, into
   `albumfactors`: five semantic theme axes plus a distinctness scalar. No album is sent
   twice; no user's name is in the prompt. §7.
3. **Per-user factors** — a **pure-stdlib ridge** over those axes fitted on the user's
   own theme ratings, blended with a pooled prior
   (`theme_predictor/personalize.py`, `RIDGE_LAMBDA = 25`, `THEME_BLEND_K = 25`), so two
   users reading the same measurements reach different scores. Stdlib is a hard
   constraint here — the **web service** imports this module and its requirements carry
   no numpy (`personalize.py:37-39`).
4. **Replay** — `0.5 × the user's own mean for the artist + 0.5 × their mean over that
   artist's cluster-mates`, from the global map. `replay_tier` records which tier
   answered (`mates`/`global`/`own`/`genre`); a global-tier value is a much weaker claim.
5. **Composite** — via `backend.scoring`, the same function that scores a *rated* album,
   so a prediction and its outcome sit on one formula.
6. **Catalog-wide** — `worker/catalog_predict.py` scores every album anyone has added,
   **and every bin record** (§5, Bins: `bin_records`, `catalog_frame`), into
   `albumprediction`, keyed `(user_id, album_key)` — not just the user's queue.
   That is what lets `/discover/picks` recommend a record the user has never heard of.
   A song bin's songs also get their own per-song prediction (`songprediction`,
   `(user_id, track_id)`), the mean of that recording's rows in the same frame — the
   frame carries `track_id` for it, never as a feature.

**No audio, no prediction.** The song model's features are the audio and three taste
features (the user's leave-one-out artist mean, their mean over the artist's cluster-mates
on the global map, and over the album's cluster — genre, subgenres, decade, audio); a
record joins the catalog only once one of its songs is analysed. Predicting from metadata
alone was considered for bin records and refused: the model never trained on a song
without audio, and imputing every song to the median sound makes every track identical,
so the "prediction" is the artist taste features dressed as a song score.

`MIN_RATED_ALBUMS = 10` gates all output, defined once in `backend/scoring.py` with its
rationale. It was 50 (one user in twenty got anything), then 1 (predictions for anyone).
Below 10 the blend is almost entirely pooled, and while the userbase is small the pool is
largely one person's taste — so the prediction reads as a stranger's opinion wearing the
user's name. The first-run tutorial quotes this number to new users, on both platforms,
and both For You screens count down to it ("3 more albums until picks unlock", ten
pips) from the user's rated list, using the copy in `shared/src/types.ts` — change both.

It is enforced where predictions are **made** — the nightly job, and the import-time
`_queue_predictions` thread in `albums.py` — and again where they are **served**, via
`predictions_unlocked`: `/discover/picks` returns `[]`, and album list, detail and the
community payload blank every `PREDICTION_FIELDS` column. The serving check exists
because rows written before the gate are still stored (users 14 and 29 hold predictions
from 2026-08-08); they are hidden, not deleted, and the nightly job overwrites them once
the user reaches 10. Both clients already render a missing prediction as absent.

Users whose rating counts haven't moved are skipped, but their album rows still sync so
a newly queued album picks up a prediction without refitting — **unless the catalog holds
records they have no prediction for** (`catalog_gap`: a bin record newly analysed, anyone's
new import, a song bin's song), in which case only the catalog stage runs (`catalog_only`,
logged as a `catalog_predict` run so the skip's counts are untouched). Before November 2026
the skip skipped the catalog too, so a record added after an inactive user's last rating
never reached their picks. Each user runs in its own
try/except and logs to `workerrun`. Before any of it, the job recomputes every stored
album score against the current userbase prior (`rescore_library_scores`, logged as
`rescore_scores`); a `--user` run rescores only that user.

**Taste overlap** is a stage of its own, not a per-user one: right after the artist map
persists, `worker/taste_nightly.run_nightly` computes every pair's percentage with the
layered baseline (`backend/taste_baseline.py`, Jack's choice at the checkpoint — spec
§3.7 in `docs/superpowers/specs/2026-11-03-taste-overlap-design.md`) and stores it
(§4, "Journey: taste overlap"). It runs in its own try/except with its own `workerrun`
row (`taste_overlap`), so a failure never stops the user stages, and a `--user` run
skips it. Nothing is fitted: the baseline compares cells directly, which is why it sits
in `backend/` (pure stdlib) where the live path can run it too. The factorization
(`worker/taste_factorize.py`) is kept only to be scored beside it (below). The reason under the
number is a fixed template (`taste_overlap.reason_for`), chosen by the number's band
and phrased by a stable hash of the pair — no LLM touches the number or its words.

**Taste overlap's health** (spec §6.1) is the `taste-health` job in
`nightly-predict.yml`, after `predict` whatever it did, needing only `DATABASE_URL`:
`worker/taste_health.py` scores the shipped baseline (default weights, `GAMMA`, no γ
search) against the checkpoint's factorization (rank 8, reg 5, bias reg 5, aggregates
0.25, album score off, measures 1) and plain pooling, on `taste_evaluate`'s hold-out,
and writes one `workerrun` row, job `taste_health`. Jack's morning brief reads its
`detail_json`, so its keys are a contract — `users`, `users_sharing_50`, `accuracy`
{baseline, factorization, pooling, held_out}, `spread` (the baseline's raw p10–p90 over
pairs with evidence, `in_band`, `pairs`, `pairs_off_50`), `user1` {highest, lowest,
most_shared}, `milestones_crossed`, `checkpoint_due`, `overlap_stage` (the latest
`taste_overlap` row's `status`, `finished_at` and `age_hours`, or null if the stage has
never run): add, never rename. The job goes red when that stage errored, has been
`running` over 6h, or last ran over 36h ago — the only alarm the stage has, since
`nightly_predict` just prints its failure. Milestones
(`users_1000/2500/5000/10000`; `sharing50_50/100`, users sharing ≥ 50 songs by
`track_id` with someone) fire once, the first night they are absent from every earlier
`ok` row; a due one puts `taste_evaluate`'s full report in the row as `report_md`,
which the morning brief reads (absent on nights with nothing due). The decision is
Jack's; nothing switches. On 2026-11-03: MAE (baseline / factorization / pooling)
0.8629 / 0.8680 / 0.8531, spread in band, 17 users sharing 50, ~15 s. **Plain pooling
is more accurate than both approaches**: weighting other raters by either overlap
predicts a held-out song worse than counting every other rater the same. The baseline
ships on believability — Jack judged its numbers and examples true to life, the
factorization's not — not on accuracy (spec §3.7). Nothing
per-user is published from the public repo's Actions: no artifact, no file, and the
log prints no names; they stay in the row.

⚠️ `song_score_model.ARTIST_K = 12` and `worker/artist_clusters.ARTIST_K = 18` are
**different constants with the same name** for different clusterings.
⚠️ `TrackAudio.source` — never mix `yt_full` and `preview_30s` between training and
prediction; 30s-preview features shift.

Audio ingest (phase A) runs on the Mac, nightly under launchd from a deploy clone of
`main` (`ops/launchd/`, §3), because yt-dlp is bot-blocked from datacenter IPs. It cannot be a self-hosted runner: **the repo
is public**, and a fork's pull request could run code on the machine holding `.env`.
Prediction (phase B) runs in
[.github/workflows/nightly-predict.yml](.github/workflows/nightly-predict.yml), **started by
the Mac** the moment its ingest succeeds (`audio_ingest.start_predictions`, a
`workflow_dispatch` with `GITHUB_DISPATCH_TOKEN`). GitHub's own cron ran 5–9 hours late
through October 2026 — the scheduler, not the Mac: the new-releases workflow, which
never touches the Mac, slipped as far — so the cron is now only the fallback for a night
the Mac doesn't run, and passes `--skip-if-ran-within 20` so it stands down when a full
run (a `rescore_scores` row for all users) already happened. The workflow's
independent `audio-health` job reads the ingest's `workerrun` row and goes red if the
last run errored, died mid-run, or is more than 36h old — the ingest's only channel into
GitHub. Every ingest run starts with a **canary** download through the real yt-dlp
invocation, because a broken toolchain and a track with no YouTube match look identical
per track, and about twenty albums have no match on any night. The work is a
first-in, first-out queue of **recordings**, not album copies (`tracks_needing_audio`,
November 2026): one row per `Track` without audio, however many people own the record,
so each is downloaded and analyzed once; until then a record two people owned was
downloaded twice a night. A track's place in line is `COALESCE(audio_failed_at,
created_at)`, so a failure sends it to the back, behind everything already waiting.
Behind all of it come the tracks only a bin holds (no copy has the song; `BinTrack`),
at most `BIN_TRACKS_PER_RUN` (700, about an hour) a night, in the bins' order so a record
finishes before the next starts; once anyone imports the record its songs link to those
tracks and move up. The first two bins added 2,770 such tracks on 2026-11-12: about four
nights at the cap, and a record enters the catalog with its first analysed song.
**Three downloads run at once** (`DOWNLOADERS`; measured 2026-11-09 at 4.2 tracks/min
for one, 9.4 for two, 11.9 for three, nothing refused), on threads; Essentia and the
writes stay on the main thread, one track at a time (`run_queue`). The first download
YouTube refuses as a rate limit or a bot check (`BLOCK_SIGNS`) drops the run to one
downloader for the rest of the night after a 60s pause — the old pipeline, never a stop
— and that track goes back to its place in line without a strike. A refusal at one
downloader is a failure like any other. The run's `workerrun` row says which happened
(`downloaders`, and `fell_back_at` / `block_reason` when it fell back).
A track that fails stops being retried every night: each failure is counted on its
`Track` (`audio_failures`, `audio_failed_at`, `audio_fail_reason`; at most one per 12
hours, so a crashed run and its catch-up are one bad night), and after `MAX_TRIES` (3) it waits `RETRY_AFTER_DAYS`
(7) between attempts; success resets it. Until October 2026 the same ~24 tracks —
age-gated explicit songs, classical movements no search matches — were retried nightly,
the worst for 30 nights. Four of them were titles Excel had turned into dates and times
on the spreadsheet import (`March 14` as `2024-03-14 00:00:00`); those were corrected and
re-keyed. `run_audio_ingest.sh`
puts `/usr/local/bin` (node, ffmpeg, ffprobe) on PATH; without it yt-dlp still searches
but produces nothing.

---

## 7. The Claude integration

**There is no vector RAG.** ChromaDB + Ollama was v1 and has been removed entirely —
`theme_predictor/{run,embedder}.py`, the `chroma_db/` store, `POST /util/predict-themes`
and `distinctness_predictor.run()` all went in the September 2026 cleanup. "RAG" here
means few-shot retrieval from the user's own ratings (`_anchor_examples`,
`global_factors.py:38`), not embedding search.

Four call sites, all `claude-haiku-4-5-20251001`:

| Where | Path | Cached |
|---|---|---|
| `theme_analysis.analyze_theme:141` | nightly worker | **yes** — `albumfactors`, once per album ever |
| `distinctness_predictor.predict_distinctness` | nightly worker | **yes** — same row |
| `albums.py:_classify_genre_claude` | web, background thread, on import | once per album row |
| `stats.py:analysis:1138` | **web, synchronous, unbounded** | **no** — §10 P10 |

**The design.** The old prompt asked *"what would Jack score this?"*, with Jack's
baseline and penalty table, for every user in the system — it lived in
`theme_predictor/predictor.py` and is now deleted. The replacement asks *"what is
actually true about this record?"* and returns five axes, each 1–10: `narrative_arc`,
`concept_unity`, `emotional_throughline`, `sequencing_intent`, `lyrical_depth`.

⚠️ **`THEME_AXES` is the feature vector's column order** (`theme_analysis.py:25-27`).
Append at the end; never reorder; never remove one without re-analysing every album and
refitting every model.

Why axes and not one number: a single theme score projects several independent things —
a tight concept with thin writing and a sprawling record with extraordinary writing land
on the same number for opposite reasons, and two users who disagree can't both be served
by it. The axis set is justified by leave-one-out MAE at `theme_analysis.py:33-47`; a
greedy pick fit better and was rejected for drifting toward "album quality."

**Posture.** `temperature=0.0` — a measurement should be reproducible. Prompt input is
bounded (corpus truncated to 1400 chars, RAG examples to 600). `ensure_global_factors`
is idempotent, so the second caller for an album pays nothing. Two cache layers:
`AlbumCorpus` in Postgres and `corpus/*.json` on disk.

**Connection discipline matters more than it looks.** `analyze_album`
(`global_factors.py:182`) exists so a bulk run holds a DB connection for the millisecond
of the write rather than the ten seconds of the API calls — **Supabase's session pooler
allows 15 clients across the whole project, web service included**, so a worker holding
connections across LLM calls starves the live app long before it saturates Anthropic.

**Failures.** `analyze_theme` **raises** rather than returning the error as a string
(`:141-149`): the previous version swallowed exceptions into the reasoning field, which
the caller discards, so an exhausted budget looked exactly like an album the model had
nothing to say about and a run could burn hundreds of albums reporting zero failures.
A **partial** axes block is rejected outright — an imputed axis is indistinguishable
from a measured one downstream. `store_global_factors` uses `COALESCE` throughout, so
nulls never overwrite stored values.

---

## 8. External data & fallback chains

| Source | Used for | Key | Cache |
|---|---|---|---|
| iTunes | search, tracklist, covers | none | in-proc 600s |
| **Deezer** | search, tracklist, covers, **artist photos**, release resolution | none | in-proc + `ArtistMeta` |
| MusicBrainz | search (release *groups*), tracklist, **upcoming** releases | none, UA | in-proc 600s |
| Cover Art Archive | covers for MB hits only — stored as the **500px thumbnail** on the Archive machine the stable address redirected to | none | via MB result |
| Last.fm | listener counts (search prior), genre tags, **per-album listeners that rank new releases** | `LASTFM_API_KEY` (web + GitHub secret) | in-proc 600s; the ranking is stored |
| ListenBrainz | new-release candidates: every album + EP of the last 7 days; **upcoming releases** (`future=true`, 90-day windows) | none, UA | via the stored lists |
| Wikipedia (MediaWiki API) | upcoming releases: the "List of {year} albums" pages, parsed from wikitext — what's notable | none, UA | via the stored list |
| Apple Music RSS | most-played albums released this week — candidates, and the quick fallback | none | via the stored list |
| albumoftheyear.org | new-release feed, still tried first — **blocked by a Cloudflare challenge since 2026-09**, so in practice unused | none | — |
| Discogs | artist discographies | `DISCOGS_TOKEN` | `ArtistMeta.albums_json` |

**Not integrated:** fanart.tv (mentioned once, in a comment explaining its *rejection*,
`util.py:592`). **Removed:** Spotify — the client-credentials app was 429ing with
`Retry-After: 86400`, and **zero of 819 albums ever carried a Spotify id**
(`search.py:16-20`). The `spotify_id` columns survive as dead fields.

**MBIDs are not a spine through the system**, contrary to what the structure suggests.
`mb_id` rides on a search result and is dropped at import; there is no `mb_id` column on
`Album`. Only `ArtistMeta.mb_artist_id` persists one. Cross-user dedup runs on
`trackkeys.py`'s string normalizers, not MBIDs. MB's real contribution is
`release_date` for announced-but-unreleased albums, flagged `upcoming`.

**Search is deliberately two-phase** (`search.py:1-20`): `/search/{itunes,deezer,mb}`
return **identity only**, one HTTP call per source, because they back the autocomplete.
`/search/resolve` fetches the tracklist for the one album picked. Before the split each
source fetched a tracklist for all 5–8 results *per keystroke*, which made Deezer ~2s and
MusicBrainz 10–18s. Resolving an iTunes album costs one more call (its `artistId`), and
three when the credit is a collaboration (Deezer search + album, for the co-artists).

**Artist photos are Deezer-only** — no fallback chain, because Deezer covers ~99% of the
library. The matching code at `util.py:589-689` guards four documented Deezer behaviours
that each silently return the wrong artist: imposter rows with the same name (take
`max(nb_fan)`), "no picture" served as a real URL whose md5 is that of the empty string,
rate limiting delivered as **HTTP 200 with an error body** (3 attempts with backoff,
because caching a miss would blank the artist for 30 days), and punctuation suppressing
hits ("J.I.D." finds nothing, "JID" finds them — strip it from the query, keep it for the
match).

---

## 9. Caching & hot paths

| Cache | Where | TTL | Scope |
|---|---|---|---|
| global ratings board | `global_rating.py:45` | 60s | **process** |
| search results | `search.py:34-37` | 600s, max 500 | **process** |
| new releases | built into a `CachedFeed` row by a GitHub worker; memory copy re-read every 30 min | rebuilt 6h, served up to 3 days | shared ✅ survives restarts |
| upcoming releases | `CachedFeed` row `upcoming_releases`, built daily by a GitHub worker; memory copy re-read every 30 min | rebuilt daily; past dates dropped on read | shared ✅ |
| Apple JWKS, FCM creds | `auth.py:21`, `push.py:48` | — | **process** |
| artist photos | `ArtistMeta` (Postgres) | 30d | shared ✅ |
| album LLM factors | `albumfactors` (Postgres) | forever | shared ✅ |
| taste overlap | `tasteoverlap` (pairs off 50%), `tasteuser`, `tasteitem` — `worker/taste_nightly.py` | rebuilt nightly; a fresh rater's pairs in the request (`taste_live.py`) | shared ✅ |

**Everything in-process is correct only because the backend is one process.** See §10 P5.

**The ratings board stays in memory on purpose.** It is thrown away whenever anyone rates
a song or finishes an album (`songs.py:154`, `albums.py:262`), so a stored copy would be
rebuilt as often as the in-memory one and every read would cost a database round trip.
It only needs moving once there is more than one process. New releases are the opposite
case: they change a few times a day and take minutes to rebuild, so a worker builds and stores them.
`CachedFeed` is keyed by feed name, so the next feed like that is a new key, not a table.

Hottest paths, in order: `/discover/charts`
(reads every rated album), `/social/compare` (reads every friend's library),
`/albums/{id}/report` (aggregates the whole song table). `/discover/new-releases` left
the list: it reads one stored row.

---

## 10. System-design notes

Full evidence in [docs/codebase-notes/10-performance.md](docs/codebase-notes/10-performance.md).
Current → risk → cheapest fix. Rows marked fixed have been implemented; the rest have not.

| # | Finding | Risk | Cheapest fix |
|---|---|---|---|
| **P1** | ~~Finishing a rating rescored every user's library inside the request.~~ **Fixed.** The request now rescores only the rater ([albums.py:260](backend/routers/albums.py#L260)); the nightly job makes everyone exact again (`nightly_predict.py:385`); the userbase prior reads four columns instead of whole rows (`scoring.py:113`). On a 30-user test database one rating went from 124 queries to 13, and the rater's scores matched the old path exactly | ~~HIGH~~ → LOW | residual: the prior is still one scan over every rated album per rating, now of four numbers. Since November 2026 the rater's own rescore (`recompute_user_scores`) is one aggregate query — each rated album's four factors and song-score mean — and one batched `UPDATE` of the scores that moved, not every album and song loaded as full rows (6,332 songs for a 472-album library); identical scores on all 1,118 rated albums when checked, ~1.3s → ~0.5s for that library over the Mac's 210ms link |
| **P2** | `/discover/charts` selects every rated album, then filters and groups twice in Python, uncached (`discover.py:189`) | **HIGH** — the Charts tab, both platforms | memoise the response on its filter tuple with the existing 60s TTL + invalidation hook |
| **P11** | ~~All 10 `/util/*` endpoints had no auth.~~ **Fixed.** The router now carries `dependencies=[Depends(current_user)]` (`util.py:31-45`) and the two web call sites that used a bare `fetch` were moved onto `fetchAlbumColor`. Verified: all ten answer 401 without a token. A signed-in user can still call `/backfill-genres?override=true` | ~~HIGH~~ → LOW | residual: move the seven maintenance routes out of HTTP entirely, beside `run_audio_ingest.sh` |
| **P8** | Engine allows 15 connections *per process* on Render; Supabase's session pooler allows 15 *per project* (`database.py`, `_build_engine`). **Partly fixed, November 2026:** a process run from `.env` (`PG_*`) now defaults to 2 + 2, after a local uvicorn for the simulator held 8 of the 15 and the pooler refused new clients (`EMAXCONNSESSION`) — 500s on the same Mac and less headroom for Render. `DB_POOL_SIZE` / `DB_MAX_OVERFLOW` override | **HIGH** at scale | Render's own 5 + 10 still equals the whole project limit: size it against the real limit ÷ instances, or move to the transaction pooler |
| **P5** | The ratings board and search cache are per-process. `invalidate_cache()` clears one process's board. New releases now persist in `CachedFeed` | **HIGH** the moment there's a 2nd instance | move the board to shared storage before scaling out, not before: at one process it would only be slower |
| **P3** | `/discover/picks` runs a `NOT EXISTS` on `lower(trim(…))` with no functional index (`discover.py:321-326`) | MEDIUM — `albumprediction` grows as users × catalog | functional index, or store `album_key` on `Album` |
| **P4** | `/albums/{id}/report` aggregates the **entire** song table, then filters in Python (`albums.py:578-581`) | MEDIUM | add `.where(Song.album_id.in_(...))` — one line |
| **P6** | ~~`/discover/new-releases` has no single-flight; N concurrent refills each made ~25 outbound calls.~~ **Moot.** The endpoint no longer fetches in normal running: a GitHub worker builds the list every 6h and the endpoint reads it | ~~LOW–MED~~ → LOW | residual: `quick_build` (~30 calls) has no single-flight, but runs only after the worker has failed for 3 days |
| **P7** | ~90 migration statements on every boot, incl. 3 `DELETE`s and 6 full-table `UPDATE`s, with `statement_timeout = 0` | LOW–MED | a `schema_version` table |
| **P12** | `JWT_SECRET` defaults to a literal that is public in this repo, with no startup assertion (`deps.py:18`) | MEDIUM — fails open, silently | raise at import when unset in production |
| **P10** | `GET /stats/analysis` is an uncached, untimed, unbounded Claude call in a blocking `def`, reachable for a **friend's** library (`stats.py:1070`) | MEDIUM, latent (no client calls it) | delete, or cap + cache |

**Client degradation.** `apiFetch` handles **401 only** (`shared/src/api.ts:36`);
everything else is per-call `if (!res.ok) throw`. No timeouts anywhere except sign-in —
browser `fetch` has no default, so a hung request hangs the query. Sign-in (`postAuth`)
skips `apiFetch` and aborts after 20s: there a 401 means a refused provider token, not a
stale session. React Query is `retry: 1` on both
platforms, which retries a 429 once, immediately. Cheapest fix: a `retry`/`retryDelay`
function in the two `QueryClient` configs that backs off and skips 4xx. Two files.

**Web page views** go to Vercel Web Analytics: `<Analytics />` from
`@vercel/analytics/react`, mounted once in `frontend/src/main.tsx` (October 2026). It
counts visits and routes only — no events, no user ids — and records nothing until Web
Analytics is enabled on the Vercel project. Mobile has none.

**If you add product analytics** (there is none today; `@react-native-firebase/analytics`
ships in the mobile bundle unused): the seams already exist. Invite→signup at
`users.py:209` with `Invite.accepted_at` already stored; recommend→rate at `albums.py:803`
with `recommended_by`/`recommended_at` already persisting the edge; rating-funnel
drop-off is the gap between `batch-rate` and `PATCH /albums`; discovery→library is
`/discover/picks` → `POST /albums/import`.

Signups and library adds are dated from October 2026: `PressUser.created_at` and
`Album.created_at` (`TIMESTAMPTZ`, set by the ORM, `DEFAULT NOW()` for raw SQL).
**Rows older than the column are null** — when they were made was never stored, and
the migration deliberately leaves them so (`database.py:190-201`) rather than stamping
the deploy time, which would read as every account signing up that day. Count signups
with `created_at > …`, never `created_at IS NULL OR …`. `create_album` stamps it
server-side because it takes an `Album` straight from the request body.

Since November 2026, for taste overlap's success measures
(`docs/superpowers/specs/2026-11-03-taste-overlap-design.md`), a friendship carries
`requested_at` and `accepted_at` (add, accept, a request sent back, and invite
acceptance all stamp them; declining or unfriending deletes the row, so churn isn't
kept), and an album copy carries `rated_at`: its **first** move to rated, set once by
`PATCH /albums/{id}` (`albums._first_rating` — a previous status other than rated
*and* a null `rated_at`, so neither editing a copy rated before the column nor
finishing one again counts). Use it, not `date_rated`, which every save that sends
`status: "rated"` rewrites. All three are `TIMESTAMPTZ`, null for rows that predate
them, by the same rule as `created_at`. That same first rating inserts an
`OverlapSheet` (status `owed`) in the same commit — unless the record is a single
(≤ 2 tracks) or the user already rated it in another edition (`albums._owes_sheet`).
The sheet's events (`shown`, `add`, `open_discussion`, `not_now`, `open_profile`) are
the pop-up attribution rows in `OverlapEvent`; `delete_own_account` clears the
four taste tables that carry a user id (`tasteitem` is keyed by album copy, and the
next nightly run drops a deleted account's rows).

The structural gap is the share card. It is rasterised entirely client-side
(`html2canvas` on web, `captureRef` on mobile) and produces a bare PNG — **no
server-rendered OG image, no deep link, no event**. The primary growth mechanic is
therefore both unmeasurable and unattributable. A `GET /share/{album_id}.png` plus an
`/a/{id}` landing route would fix measurement and attribution together.

---

## 11. Known issues, tech debt, open questions

**Fixed during this audit.** `google-auth` was missing from `requirements.txt` while
`backend/push.py:33` imports it at module level, reached by `main.py` through
`albums`/`users`/`discussions`. A clean install could not boot the backend; production
only survived on a cached Render build layer. Added `google-auth==2.48.0` and verified a
clean venv now imports the app. Also deleted three superseded scripts:
`genre_clustering.py`, root `normalize_genres.py` (SQLite-era; `backend/normalize_genres.py`
is the real one), and `analyze_missing_audio.py` (user-1-only, wrote the legacy
`songaudiofeatures` table the models no longer read, never called `sync_tracks`).

**Fixed, September 2026 — private fields exposed to other users.** `GET /users/`
returned every account's full row (email, Google/Apple subject ids, factor weights,
favourite ids) to any signed-in caller; `POST /users/` returned the full new row; and the
unauthenticated `GET /users/invite/{token}` returned the address an invite was emailed
to. All three now return `public_user` (`deps.py`) or less. Verified against a running
backend: `/users/` rows carry only `id`, `name`, `avatar_url`, `bio`.

### Confirmed defects

- **Three album-grouping keys disagree.** `trackkeys.py`'s header says every cross-user
  grouping must go through it; the charts don't. `album_key` (stored, folds nothing),
  `subject_key_album` (folds editions + diacritics), and `record_key`
  (`global_rating.py:54`, a bare `.strip().lower()`) — the last inlined again at
  `discover.py:109`, `:138`, `:240`, `public.py:91`, `social.py:359`. So **"Take Care"
  and "Take Care (Deluxe)" are one discussion thread and two chart rows**, each with a
  fraction of the raters, while `/discover/heated` groups correctly on `subject_key`.
  QUESTIONS Q8 — re-ranking the boards is Jack's call.
- **Three background threads in `albums.py` can't fully work on Render.**
  `song_score_model.py:29-38` imports `sklearn` and `scipy` unguarded, and neither is in
  `requirements.txt`. `_queue_song_repredictions` (`:375`) therefore always raises,
  caught and printed. `_queue_predictions` (`:277`) guards its import
  (`predict_single.py:148`), so its theme and distinctness stages still run and only the
  song-model stage no-ops. `_queue_genre_tagging` works. Probably intended after the
  worker split, but the code doesn't say so. QUESTIONS Q11.

- ~~**Audio ingest was silently dead from 2026-08-20 to 2026-09-29.**~~ **Fixed.** Runs
  761 and 833 analyzed 0 tracks of ~85 albums and recorded `status='ok'`; nothing ran
  after that, leaving 766 tracks across 113 albums without audio. Four causes, each
  silent: launchd's PATH lacked node and ffmpeg (yt-dlp still *searches*, then produces
  nothing); a broken toolchain was indistinguishable from "no YouTube match", which ~20
  albums hit on any night; status was always `ok`, and a killed run sat at `running`
  (run 547); and launchd cannot read `~/Desktop`. Now: a canary download opens every
  run, status is honest, the GitHub `audio-health` job reads `workerrun`, and the job
  runs nightly from a deploy clone (§3). The first run drains the backlog, ~3h.
- **`python song_score_model.py` crashes at HEAD.** `__main__` (`song_score_model.py:1179`)
  builds `TasteModel()` without `clusters=`, so `artist_clusters` is `[]` and
  `_ensemble_sim` fails on `np.vstack([])`. `fit_for_user` (`:572`) passes it, so the
  nightly worker is unaffected; only the standalone retrain command in §3 is broken.

### Product gaps (verified by call-graph, not assumed)

- **The 60-point factor budget has no UI.** `PUT /users/{id}/factor-weights` exists and
  recomputes scores; both rating screens *read* the weights via `fetchFactorWeights`;
  **nothing on either platform writes them**. Every user is on 25/15/15/5. The unused
  `updateFactorWeights` wrapper was removed in the cleanup; re-add it when the UI lands.
- **Discussion posts can't be edited or deleted from the apps.** `PATCH /posts/{id}`
  and `DELETE /posts/{id}` still exist server-side, and both thread screens render the
  deleted tombstone, but no client reaches them — the unused `deletePost`/`editPost`
  wrappers were removed in the cleanup, so wiring this up means re-adding two six-line
  functions. A moderation gap, given `PostReport` and the auto-hide rule. The web thread
  deliberately stayed at parity here rather than spending the `canDelete`/`canEdit` flags
  the payload already carries: doing it on one platform only is the drift §1 forbids.
- **A tracklist never re-syncs after import.** `POST /albums/import` returns an existing
  copy with `already_existed: True` and only backfills a missing cover (`albums.py:410`).
  There is no refresh endpoint, so when an upstream catalog corrects a tracklist the
  user's only recourse is delete-and-re-add, losing their ratings. Wanted, not intended.
  **By decision, November 2026, a tracklist is adjusted once after release and never again**
  (`Album.tracklist_settled_at`, §4 upcoming releases): a copy added before release is topped
  up as singles appear and gets one pull on or after release day — on open
  (`POST /albums/{id}/tracklist`) or by the daily `worker/fill_tracklists.py` — adding only the
  songs it lacks. Every other copy is settled from the moment it has songs. So a catalog's later
  correction still never reaches a copy; that is now the rule, not a gap.
  `backend/repair_missing_songs.py` is a one-off Excel-sourced script, not a fix.

### Parity — what web is still missing (audited 2026-09-23)

Counted by resolving every export in `shared/src/api.ts` against both clients:
**16 client functions are mobile-only, 11 web-only.** Every mobile-only function is
already backed by a shipped endpoint and already transformed by the shared client, so
**closing these gaps is UI work in `frontend/src/` only** — no router, no migration, no
`shared/` change. Ordered by how much of a feature is missing, not by effort.

**Discussions — closed, September 2026.** Ten functions (`resolveThread`,
`fetchThreadPosts`, `createThreadPost`, `replyToPost`, `fetchReplies`, `votePost`,
`reportPost`, `flagSpoiler`, `fetchDiscussionFeed`, `fetchHeated`) and four surfaces
now exist on web: [Thread.tsx](frontend/src/pages/Thread.tsx) at `/thread/:subject`,
`AlbumThoughts` on the album page, `HeatedDiscussions` on For You, and a Discussions tab
in Social. Sort, the summary, votes, replies, spoiler reveal, report and the lock state
all match mobile; §12's rule that a duplicated rule changes in every copy now covers
`LOCKED_COPY` and the vote-button semantics, which exist once per platform. Since then
both thread screens also carry author avatars, a *Full review* option per post and
reply (`FullReviewModal` / `FullReviewSheet`, over `fetchPostAuthorRating`), and every
track's room average under the summary (`ThreadSummary.tracks` from
`threads.thread_summary`). Web lays the thread out wide — conversation plus a sticky
record rail — where mobile is one column.
A thread you haven't rated (both platforms, November 2026) is no longer a bare lock: it
shows the room's top three reviews from `GET /threads/preview` (avatar, name, score, the
clipped body held to four lines; read-only — no votes, replies, report or Full review),
then the lock, `LOCKED_COPY` ("Rate this record to read every review and join the
conversation.") and one button: **Rate now** / **Continue rating** on your copy of the
record, else **Rate now** on a copy cloned from `source` as Listening
(`copyAlbumToLibrary`, the community page's path), or **Add to Library** (To Listen) when
the record has no songs or isn't out; nothing when Pressd holds no copy. Web sets the
three side by side at `xl`. The album pages carry the same preview (November 2026): before
you've rated the record, web's `ThreadPreview` (the community page's rail) and `AlbumThoughts`
(under a copy's tracks) show the three reviews read-only, clamped to three lines, each opening
the thread (`LockedPreviewPosts` in `ThreadPreview.tsx`, sharing the thread page's
`['threadPreview', …]` key), over a lock line that is itself a link into the room; iPhone's
`AlbumThoughts` does the same on the copy view and now on the community view too, where
there was no way into the discussion at all. The locked line is never a dead end.
⚠️ `frontend/src/components/CommentThread.tsx` is **not** this — it is review comments
(`fetchComments`/`postComment`), friend-scoped and about one copy of an album, sharing a
name with `mobile/components/CommentThread.tsx`.
Both rating flows now end in an optional review written with `publishThoughts` (after
the rating, never as part of it). The album page's `PUT /albums/{id}/review` still exists
for editing a review later, and both paths post into the thread through
`sync_review_post`.

**Whole features still absent from web.**

1. **The community album view.** Closed, October 2026:
   [CommunityAlbum.tsx](frontend/src/pages/CommunityAlbum.tsx) at `/album/:id/community`
   (from any copy's id) and `/album/community?name=&artist=&deezer=` (by name, for a
   record not in Pressd yet) — mobile's `CommunityAlbum`, over `fetchCommunityAlbum` /
   `fetchCommunityAlbumByName` / `copyAlbumToLibrary`. The Pressd average (`avg_score`,
   labelled PRESSD AVG as on mobile), averaged factors, pooled per-track scores, Rate
   now / Add to Library, and a Compare view that uses the `others_*` fields so you
   aren't counted on both sides. Unboxed; track rows pop up as they scroll into view.
   Charts, Trending, recommended suggestions, new-release titles and To Listen open it,
   and a rated album you own offers *Compare with Pressd* when someone else has rated
   it. Before this, web's Charts and Trending linked to whichever user's copy ranked —
   friends-only, so they failed for everyone else.
2. **Compare / taste overlap.** One record against one person closed, October 2026:
   web's `/album/:id?view=compare` ([albumCompare.tsx](frontend/src/components/albumCompare.tsx))
   is mobile's `FriendCompare`, both now open for any user and pairing tracks on
   `track_id`. On someone's copy of a record you don't own, both apps offer Rate it
   yourself and Add to Library. The Compare tab closed, October 2026: web Social's
   fourth tab draws `fetchCompare` (`/social/compare`) as
   [CompareCard.tsx](frontend/src/components/CompareCard.tsx) — mobile's card, every
   rater on one 5–10 line, then each score and review; the title opens your own copy.
   Still mobile-only: `fetchRankedSongs`. The split charts reached web in October 2026
   on the artist page's Compare view (item 6).
3. **Account management.** Mostly closed, November 2026: web's `SettingsDialog` now has
   `deleteOwnAccount`, `fetchLinkedProviders` / `unlinkProvider` (Google connect and disconnect),
   Blocked users and the About links (§5, "Settings, both platforms"). Still mobile-only:
   `signInWithApple` / `linkApple` (no Sign in with Apple on web) and `deleteAvatar`. On mobile, every Sign in with
   Apple attempt goes through `mobile/lib/appleSignIn.ts`. App Review rejected build 5
   (October 2026) because the button seemed to do nothing. On a device with no Apple
   Account, iOS sends the person to Settings and the original request returns error 1000;
   the next tap works. Every failure now shows a line saying what to do, and the module's
   error code doesn't reach JS in Release, so failures are classified by message. Mobile's `SettingsSheet`
   (808 LOC) has Account / Sign-in methods / Notifications / Danger zone; web's whole
   settings surface was the Edit Profile modal in `Layout.tsx` until the November 2026 parity.
   App Review rejected build 6 (October 2026, Guideline 5.1.1(v)) without finding the
   delete, then at the foot of Settings under About. It is now **Delete account**, directly
   under Sign out in Settings → Account, and ends on an "Account deleted" alert, since
   Apple wants the recording to reach a confirmation. `DELETE /users/me`
   (`users.delete_own_account`) is set-based SQL, a statement per table: it had loaded
   and deleted rows one by one (minutes for a large library), and it missed
   `albumprediction`, `post`, `postlike` and `postreport`, so any account that had posted
   or held predictions failed on a foreign key. Posts are tombstoned (author and body
   cleared, as `DELETE /posts/{id}` does) because replies hang off them; votes come off
   and the counters are recounted; recommendations sent stay with their recipients,
   unnamed. A table that gains a user foreign key must be added there.
   ⚠️ **Avatars diverge in mechanism, not just presence**: mobile posts bytes via
   `uploadAvatar`, web base64s the image into `updateUser` (`Layout.tsx:184`). Two
   storage shapes for one field — reconcile before adding a third caller.

**Surfaces that exist on both, where web is the thinner one.**

4. **Profile.** Mobile unifies library + stats + identity in `app/(tabs)/profile.tsx`
   (849) with `ProfileBanner` (617): a full-width banner with the avatar overlapping it, three headline figures beside it (the average among them), taste chips, and
   the shelf (`PressUser.shelf`). Web's profile page
   gained the shelf (then My Picks), the banner and Settings in October 2026 (§5), but still splits
   library and stats across `Library.tsx` and `Stats.tsx` tabs and draws no score ring —
   `Library.tsx` calls only `fetchAlbums`, where mobile also calls `fetchSummary`,
   `fetchScoreRange`, `fetchArtistStats`, `fetchScatterData`. Custom banners
   (`uploadBanner`/`deleteBanner`) reached web in October 2026, as the wash behind the
   profile and Library headers.
5. **Stats.** Closed, September 2026: web's Stats ranks genres and subgenres
   (`GenreBreakdown`, by count or by average), each row opening
   [TagBoard.tsx](frontend/src/pages/TagBoard.tsx) at `/stats/:kind/:tag?user=&owner=`
   over `fetchTagRecords` — mobile's `app/genre/[tag].tsx`, plus each record's rank in
   the whole library. Bang vs skip and most-rated artists came across with it.
6. **Artist page.** Closed but for the photo on the page itself (web calls `fetchArtistImage`
   only for search's artist rows), October
   2026. Web has mobile's three scopes, as pills and `?mode=` in the URL: *mine*, *Pressd
   avg* (`population=global`: every copy pooled, ranked site-wide, with the popularity
   ranks) and *Compare* (`both`: the two song averages side by side, then straight into
   both distributions as curves, and `fetchSimilarArtistComparisons`), drawn from
   [artistCompare.tsx](frontend/src/components/artistCompare.tsx). *Where you split* (the
   song-gap list) was removed from both apps in November 2026 (Jack's call); mobile's
   `app/splits/[name].tsx` and web's `SongGapChart` are now unreachable — kept, not deleted. Your own scope lists exactly your rated copies, one row each. In the
   Pressd scope an album row is one record rated by anyone,
   pooled across copies (`stats._artist_album_rows`, keyed on `_clean_album` of the title alone, scored as
   the plain mean of copies — the community page's own PRESSD AVG), so both clients
   open the record's community page from it, not one owner's copy. The *Pressd avg* scope's statistics — the league table, the song-score-against-external-factors
   scatter, ranks and percentiles — count only what the userbase has in common (November 2026,
   `backend/common_ratings.py`): a song only if 3+ different users scored it (`track_id`), a record's
   factors only if 3+ users rated a copy, and an artist on the board only with 15+ such songs. The
   "most rated" ranks still count every rating, and *mine* and *Compare* are untouched. Both pages list
   records newest first and nothing else: the discography grids (web's
   `DiscographyGrid`, mobile's `Discography.tsx`, deleted) and web's Discover list went,
   along with the releases nobody on Pressd had added. So `fetchAotyAlbums` and
   `refreshAotyArtist`, and the `/aoty` router behind them, have no caller left.
7. **For You.** Web lacks `RecommendationBanner`. ("Pass it on" closed, September 2026:
   `frontend/src/lib/passItOn.ts` + `PassItOnCell`, and web's `RecommendModal` gained
   the preselected friend and the recommendation note it had been missing.)
8. **Rating screen.** Closed, September 2026: web's
   [RatingScreen.tsx](frontend/src/pages/RatingScreen.tsx) is mobile's flow — one track
   at a time with the same `canJumpTo` unlock rule, then factors (a finish step for EPs),
   then the review, autosave, the `TopSongTiebreak` dialog and the share card. The
   desktop difference is a rail holding the running average and tracklist. Web's old
   "Clear all" button went with the form it belonged to; mobile never had it.
9. **Release notes.** Neither app has them: mobile's `WhatsNewSheet` (and `lib/whatsNew`,
   `lib/releaseNotes`) was removed in November 2026. (The five-card tutorial and
   `markTutorialSeen` closed, September 2026: `frontend/src/pages/Tutorial.tsx`. Web's
   `HowItWorks.tsx` is the signed-out marketing page, a different thing.)

**Not gaps.** `registerPushToken`/`unregisterPushToken` and
`fetchNotificationPrefs`/`updateNotificationPrefs` (FCM, no web push today), and
`fetchMe`/`fetchProfile`/`fetchUsers` (web reaches the same state through
`UserContext`). Mobile is behind on invites (`fetchInvite`, `acceptInvite`,
`getInviteLink`), public marketing charts, `fetchFriendReviews`, `fetchFriendRatings`
and `fetchGenreScores`.

**Dead on web:** `frontend/src/pages/Search.tsx` (199 LOC) is routed from nowhere and
imported by nothing — the same orphan shape as the deleted `RatingReport.tsx`. It holds
the only web call site of `backfillCovers`, so that wrapper is dead with it. Deleting a
finished-but-unmounted page is a product call (cf. Q15), so it is flagged, not removed.

### Dead code — removed, September 2026

The audit's dead-code list has been actioned. Removed: `theme_predictor/{predictor,run,
embedder}.py`, the 73 MB `chroma_db/` store, `POST /util/predict-themes`,
`distinctness_predictor.run()`/`normalize_to_jack()`, `replay_value_model.py`,
`run_predictions_bulk.py`, `repredict_song_means.py`, `analyze_missing_audio.py`,
`genre_clustering.py`, root `normalize_genres.py`, the empty `backend/reviews.py`, the
orphaned `frontend/src/components/RatingReport.tsx` (499 lines), and twelve unused
exports from `shared/src/api.ts` plus `setPopularityWeight` from `albumSearch.ts`
(~111 lines). `LLM_MODEL` was rehomed from the deleted `predictor.py` to
`theme_analysis.py`. Verified after: both clients typecheck, lint is unchanged at its
pre-existing 16 errors, and every backend and worker module imports.

One item knowingly left: `GET /albums/{id}/report` (`albums.py:536-743`), whose only
consumer was the deleted `RatingReport.tsx`. Removing a finished-but-unmounted feature
is a product call, not a cleanup — QUESTIONS Q15.

### Still open — see [QUESTIONS.md](QUESTIONS.md)

Q8 (three grouping keys disagree), Q9 (is `PATCH /songs/{id}` deliberate? the endpoint
was kept, its client wrapper deleted), Q11 (confirm web-side re-prediction is meant to
no-op), Q13 (is the duplicate `_artist_key` intentional?), Q15 (is `/albums/{id}/report`
shelved or superseded?).

Nothing in this document is marked `INFERRED — unverified`. Two claims rest on
environments I cannot see: that Render currently has `JWT_SECRET` and
`FIREBASE_CREDENTIALS_JSON` set. Both are labelled where they appear.

---

## 12. Conventions & extension points

- **Keep this file current. It is part of the change, not a follow-up.**
  Any agent or person who changes the codebase updates `CLAUDE.md` in the same commit
  whenever the change touches something it describes: a new or removed endpoint,
  module, table or column; a tuned constant or a scoring rule; a dependency,
  environment variable or run command; an external data source or fallback order; a
  deploy target; or anything that resolves, creates or invalidates an item in §10 or
  §11. Deleting code means deleting the lines that describe it rather than leaving them
  to rot — several docstrings in this tree had already drifted from their code before
  the audit, and a confidently wrong doc costs more than no doc. If a change makes a
  `file:line` citation wrong, fix the citation. If it settles an open question, move it
  out of [QUESTIONS.md](QUESTIONS.md) and record what was decided. If nothing here is
  affected, say so rather than assuming.
- **Comments explain why, not what.** Module docstrings here carry design rationale and
  the record of what was tried and rejected — `nightly_predict.py`, `global_rating.py`,
  `artist_clusters.py`, `trackkeys.py`, `public.py`, `search.py`, `personalize.py`,
  `push.py`, `models.py`. Match that register. When you change a tuned constant or a
  design decision, **update the prose that justifies it**.
- **Commit messages are declarative sentences** describing the behavior change, not the
  diff: "Pool an album's copies on the record, not the spelling", "Match a track title
  through apostrophes and medleys".
- **A record's artists come from the catalog, never the user, and never from
  splitting a string** (`credits.py`, §5). Group per artist with `album_artists` /
  `song_artists`, not `Album.artist`, or a collaboration vanishes from its co-artist.
- **Any grouping across users must go through `trackkeys.py`.** Matching raw names
  splits one album into three community albums with one rater each. Pick the right key:
  `album_key` when it must be byte-stable (it is a stored unique key on `albumfactors` /
  `albumprediction`), `subject_key_album` when copies must collapse into one thing, and
  for a song, its `track_id` — never a title match. Tracks are created only through
  `tracklink` (`recording_key`), and a remaster is the same recording while a live,
  demo, remix or session version is not (§5).
- **A song on a shared surface is one row per `track_id`, and its title is only a label.**
  Copies spell one recording differently (a spreadsheet import's "Dancing in the
  Courthouse" against the catalogs' "Dancing In The Courthouse"), so `GROUP BY title`,
  or title and track together, shows one song twice. `threads.thread_summary` did that
  on 29 records until November 2026, labelling each with the spelling most copies use
  now; the community page matched titles and so pooled demos into studio songs.
- **One-off backfills and migrations are deleted once applied** — the commit and this
  file record what they did; only scripts that run again (ingest, nightly, ops) stay.
  Never inline `(name.lower(), artist.lower())` — five places already did, and they now
  disagree with the threads (§11).
- **A taste-overlap reason's `text` is escaped, and rendered from its fields.**
  `reason_for` HTML-escapes every name it interpolates, and the only markup is a
  literal `<i>…</i>` around an album. Clients draw the line from the structured fields
  (`kind`, `album`, `artist`, `genre`, `agree_album`) or tokenise that one tag — never
  `dangerouslySetInnerHTML` / an HTML renderer. Below 40% a reason is a split or
  nothing: no agreement of any kind sits under a low number.
- **Auth is the invariant.** Identity comes from `current_user`, never a client-supplied
  `user_id`. Reads of another user go through `viewable_user_id` / `authorize_view`
  (any signed-in user — profiles are public); friends-only reads through
  `authorize_friend` (an **accepted** friendship). New endpoints get a guard at the
  point they are written, and anything private on a public row is blanked for non-owners.
- **The album pages share one kit** (web): `components/albumView.tsx` — `CoverWash`,
  `RevealRow`, `BangSkip`, `StatFigure`, `CompareScores`, `PILL`, `PILL_ACTIVE`, `SECTION_LABEL` — used by
  `AlbumDetail` (your or someone's rating, you vs them) and `CommunityAlbum` (Pressd
  average, Compare). Same layout on all three: sticky cover column, unboxed numbers, the three
  views as pills in the top-right. A change to one view's look goes through the kit.
  Under the title, Average rating previews the room's top three posts
  (`ThreadPreview`, sort `popular`) — until you've rated the record, as `thread_access`
  requires, the locked room's top three from `GET /threads/preview` over a lock line that
  still opens the thread — and someone else's rating shows their review there. With
  either in it the column isn't pinned, since it can outrun the window.
- **Domain-shaped code belongs in `shared/`; platform-shaped code stays in the app**
  (localStorage vs SecureStore, routing). The API speaks snake_case; the shared client
  transforms to camelCase at the boundary. Don't leak snake_case into UI code, and don't
  bypass `apiFetch` with a bare `fetch` — two web call sites already do, and they only
  work because `/util` is unauthenticated.
- **`PLAN_*.md` at the root are gitignored design docs, but code cites them by section**
  ("PLAN_ml_worker_split §4", "PLAN_global_artist_clusters.md §3.3",
  "PLAN_discussions.md §2.3"). Read the relevant one before touching the pipeline it
  describes.
- **Both apps set type in the same two families.** Playfair Display for page
  titles, album titles and scores (mobile `fonts.display*`, web `.font-display` —
  the name means the same on both); Plus Jakarta Sans for everything else (the web
  `body` face). A title that names an album keeps one face and sets the album in
  Playfair italic (web `<i>` inside `.font-display`; mobile `fonts.displayItalic`, a
  loaded face, because iOS can't slant a custom font with `fontStyle`). Clash Display is the wordmark only, and Unbounded Bold (mobile `fonts.wide`, web `.font-wide`) the shelf's heading only. Web used DM Sans until September
  2026, share card included; don't bring a third face back.
- **A taste overlap is coloured on the score scale**: `overlapScore(percent)`
  (`shared/src/types.ts`) puts 0% at a 1 (red) and 100% at a 10 (green), and each
  platform's own score colour draws it (web `songScoreColor`, mobile `scoreColor`), so
  it follows dark mode as scores do. The profile pill, the people sheet and the friends
  list all go through it; never a fixed green.
- **A final album score is always shown to two decimals** (`8.20`, never `8.2`) —
  rated, predicted or projected, on both platforms. Song scores and factor values are
  one decimal. The tutorial's demo numbers follow the same rule.
- **Album covers go through one sizing rule.** `shared/src/covers.ts`'s `coverUrl(url,
  displayPx)` asks each host for the size actually drawn (Deezer and Apple render any
  size; the Archive has 250/500/1200 thumbnails), and `coverFallbacks` lists the stable
  `coverartarchive.org` addresses to try when an Archive storage machine stops answering.
  Web draws covers with `CoverImg` (and `covers.tsx`'s `Cover`), mobile with
  `CoverImage`; a new cover goes through one of them, not a bare `<img>`/`Image`. The
  share card is the exception — it rasterises the stored full-size image. Stored
  A copy saved without a cover is looked for again (`backend/covers.py`, November 2026):
  another copy of the record, then Deezer, iTunes and MusicBrainz + the Archive, each hit
  checked with `same_album` — in the background right after the import, daily by
  `worker/fill_covers.py` (`.github/workflows/fill-covers.yml`, 03:40 PT, right after
  `worker/fill_tracklists.py` gives unsettled copies their songs, §4), and by `POST /albums/enrich-covers`
  on web's Library. A release-day import is the usual case: *Dream Fatigue* was on
  MusicBrainz with no art anywhere, and the Archive knew its cover before it could serve
  it (a 500 on the image), so the Archive check GETs the image and keeps only a real one.
  The group's image stands for one release's, and that one stayed broken for days while
  the record's other release served a cover, so the check falls back to each release's.
  What none of them has is set by hand with `worker/set_cover.py` (an image address, checked
  to be an image, written to every copy). A wrong stored name is better corrected: three of
  the last four coverless copies were misspellings, and the search found all three once fixed.
  Archive covers are the `_thumb500` copy: until October 2026 the backfill stored the
  uploaded original (643 albums, 0.3–11 MB each), rewritten once to the thumbnail,
  and both writers (`util.py` backfill,
  `search.py` resolve) now ask for `front-500`. A cold For You loaded 2.3 MB of
  covers after that rewrite and 1.4 MB with the sizing; Library 7.3 MB and 2.1 MB.
- **The public pages promote the iPhone app as a feature, not a footnote** — they
  inform web visitors rather than steer them off the web. The landing page opens with a
  "Now on the App Store!" pill over the headline, sets an App Store badge (`StoreBadge`,
  drawn in CSS) level with the Google sign-in, links it from the nav, and has a
  full-width band (`#iphone`) where nine screens from the app (`frontend/public/app/`,
  simulator screenshots at 720px wide) sit in a sideways carousel that wraps around
  (three copies, recentred when scrolling settles), stepped by left and right arrows on desktop and swiped on a phone, with the badge and, on
  desktop only, a QR code (`public/app/qr-code.png`, Apple's own: an `apple.co` short
  link to the listing, so App Store Connect counts the scans). The link is one constant,
  `IOS_APP_URL` in `frontend/src/lib/iosApp.ts`; `VITE_IOS_APP_URL` overrides it.
- **For You's single-record cards share `SpotlightCard`** (one per platform —
  `frontend/src/components/` and `mobile/components/`): Pass it on and Pick this back
  up. No border and no box button — the cover, blurred, is the card's
  colour; the whole card is the target. A new card of that kind goes through the same
  component rather than a fresh bordered row. Web sets the two side by side, mobile
  stacks them with a smaller cover and a two-line title. Rate this next is
  deliberately *not* one: on mobile it is a plain row, with no cell behind it.
- **Heated Discussions shows a verdict, not tags** (both platforms, since October 2026
  on mobile): *Divided*, *Loved*, *Liked*, *Lukewarm* or *Hated*, as a coloured badge
  with no text — crossed swords for *Divided*, otherwise a face by the room's mean:
  laughing ≥ 8, smiling ≥ 7.25, meh ≥ 6.5, angry below. The word is in the tooltip /
  accessibility label; a glow under the cover and a meter of where the room's scores
  fall complete it. Mobile has no blur, so its glow is coloured shadows, one per colour
  stop, side by side. The verdict is the server's `mood` (`discover.py`: `_mood`,
  `LOVED_MEAN`, `LIKED_MEAN`, `LUKEWARM_MEAN`, `CONTROVERSIAL_SPREAD`), never a client
  threshold, and *Divided* wins whatever the mean. The old `controversial`/`loved`/
  `hated` flags are still sent, on the same lines, for app builds that predate `mood`.
  The colours and icons are duplicated in the two `HeatedDiscussions.tsx` files; change
  both. Trending on Pressd stays a plain ranked list (`TrendingBoard`): no rank gets
  special treatment.
- **Every wait shows the spinning record** (November 2026): `VinylSpinner`, one per
  platform (`frontend/src/components/`, `mobile/components/`), drawn from
  the vinyl-loader design handoff of November 2026 (its numbers live in the code). Each spinner picks one of the
  handoff's 1b–1f at random when it appears — the record turning under a still light,
  a tonearm, a pressing plate, grooves filling, the record out of a Pressd sleeve — except
  at `SMALL_MAX` (28) or below, a button's or row's spinner, which is always 1b, and
  under reduced motion, which is 1b standing still. Each is drawn at the handoff's
  reference disc (120) and scaled into the `size` square, so a spinner's footprint never
  depends on its variant; `variant` fixes one. Web's keyframes are the handoff's, in
  `index.css` (`vl-*`); mobile runs each keyframe list as one `Animated` value
  (`useCycle`) with the same easing per segment. 1a, the old spinning light, is gone.
  Never `Loader2 animate-spin` on web or `ActivityIndicator` on mobile; mobile's
  takes `ActivityIndicator`'s props (`size` small/large/points, `color` ignored) and
  centres itself the same way. The drawing is duplicated across the two files; change both.
  Sized by what's waiting: 64 for a whole screen, 44–48 for a list or sheet, 32 for a
  section of a page, and a button's or row's own small size inside one.
  While a rating settles, both rating screens show it large over
  `useRecalibrationMessage` (`shared/src/hooks/useRecalibration.ts`): two status lines,
  then the nudges (`RECALIBRATION_NUDGES` — reviews, friends, recommending, the room,
  the charts, the shelf) shuffled and cycling every 3.6s, never "Almost there…", with no subtext under them.
- **A predicted score is drawn by `PredictedScore`** (both platforms, November 2026;
  `mobile/components/PredictedScore.tsx`, `frontend/src/components/PredictedScore.tsx`): the number in its caller's own font and size,
  filled with a gray → green → red → green → gray gradient that drifts on a 6s ease-in-out
  loop, and a small white four-point sparkle that flashes at its top-right every 3.4s.
  A settled score stays flat-coloured, so the two never read alike. The colours are
  per appearance in the component (`STOPS`; `scheme` forces one on a fixed background). It lays the number out as a plain
  Text and masks the gradient over it (`@react-native-masked-view/masked-view` +
  `expo-linear-gradient`, panned by `react-native-reanimated` on the UI thread), so
  swapping it in moves nothing; it pauses off screen, on an unfocused screen and in
  the background, and stands still with no sparkle under Reduce Motion. Used on For
  You's Rate this next, the album page's PREDICTED / FOR YOU figure (replacing the
  stroked `OutlineScore`) and a bin row's PREDICTED. The library's To Listen badge
  (`~7.26` on a cover) keeps its plain text, by Jack's choice. A new predicted number
  goes through it; a number inside a sentence ("We think
  you'll rate this about 7.26") stays text. Reanimated 4.5.1, worklets 0.10.2 and
  masked-view 0.3.2 are pinned exactly in `mobile/package.json`; all three were
  already in the native build through expo-router, so they need no rebuild.
  **Web's** is an inline-block span that inherits the caller's font: the text is cut
  out of the gradient with `background-clip: text`, three times its width, its
  `background-position` animated (`predicted-drift`, `predicted-sparkle` and the
  `--predicted-0/1/2` pairs under `:root` / `:root.dark`, in `index.css`); an
  IntersectionObserver and `visibilitychange` pause it off screen and in a hidden tab,
  and under `prefers-reduced-motion` the gradient stands still with no sparkle. It
  replaced the stroked hollow number on AlbumDetail's FOR YOU and CommunityAlbum's FOR
  YOU, and draws a bin row's PREDICTED (`Figure`'s `predicted`) and For You's Ready to
  rate `~7.59` under each card (no sparkle at that size). Web's Rate this next carries
  its prediction only in its sentence, so it stays text; the library card's `~` badge
  stays plain, as on iPhone.
- **Hover feedback stays small.** `COVER_LIFT` is a 4% lift and a 1° lean on an
  ease-out; it was 13% and 3° on a springy curve and made rows of covers jump. Keep
  new hover scales in that range. The one exception, by request, is the shelf
  (`.shelf-record` in `index.css`): a hovered record is lifted 22px out of the row on
  an overshooting curve, straightening as it rises — four covers, not a row of them.
- **Web motion has one vocabulary, in `frontend/src/index.css`** ("Interaction
  feedback"): every button presses in, `page-enter` on route change (keyed in
  `Layout`), `fade-in` + `pop-in` for dialogs, `menu-in` for dropdowns, `rise-in` /
  `grow-x` staggered by a `--i` custom property, `pop` for a state switched on, and
  `flash` for something the user just made. Use these rather than new keyframes;
  all of them stop under `prefers-reduced-motion`. A horizontal scroller clips
  vertically, so a rail of `COVER_LIFT` covers needs room inside it
  (`HeatedDiscussions` pads `py-5` and gives it back with `-my-5`).
- **Web has a dark mode too (November 2026).** Every colour class reads a variable named
  for its light value — `text-(--c-1c1917)`, never `text-[#1c1917]` — and every JS colour
  string is `'var(--c-…)'`; `index.css` defines each twice, the light value as written and
  under `:root.dark` a dark one computed by role (neutrals inverted keeping their warmth,
  pale tints sunk, deep brand colours lifted), with the page, cards, ink and green matching
  mobile's values. A new colour adds its pair there. Solid green fills use
  `--c-green-fill` (darker and softer in dark than green text). Score colours come from
  `types.ts`'s `songScoreColor` (hsl over `--score-s`/`--score-l`), and score cells lose
  their pale fill in dark (`--score-tint-a`), as on iPhone. `lib/appearance.ts` holds
  System / Light / Dark per browser (Settings → Appearance); `index.html` sets the class
  before first paint. Kept literal on purpose: the share card, the Google logo, dimmed
  backdrops and the black Google buttons. The landing and other public pages follow it too.
- **Mobile has a dark mode (November 2026).** `theme/tokens.ts` holds
  two palettes — the cream page and a very dark warm gray (`#171615`) that keeps the
  cream as its ink. It follows the phone, including iOS's automatic sunset switch,
  unless Settings → Preferences → Appearance holds Light or Dark (`lib/prefs.ts`
  calls `Appearance.setColorScheme`; `app.json` `userInterfaceStyle` is `automatic`).
  Three rules keep it whole:
  - **In a stylesheet or a `style` prop, use `colors.X`** — `DynamicColorIOS` values
    iOS resolves itself, so a view changes the instant the appearance does — and
    `scoreColor(n)` for a score, `pageAlpha(a)` for a veil of the page colour.
  - **Anything that draws once — every icon's `color`, SVG `fill`/`stroke`,
    `LinearGradient` colours — takes plain strings from `useColors()` (`tc.X`),
    `useScoreColor()` (`sc(n)`) or `usePageRgb()`**, which re-render on the change.
    react-native-svg resolves a dynamic colour when it's set and never again, so an
    icon handed `colors.X` keeps the old palette until it remounts; the compiler
    won't catch it, because icons accept any colour value.
  - **Borders take plain colours too: never `borderColor: colors.X` in a stylesheet.**
    iOS draws a `DynamicColorIOS` border wrongly — dark gray in light mode, on one side
    or all four — so a border's colour is set where the element is drawn, from the
    hook: `[styles.row, { borderColor: tc.border }]`. Fills and text are unaffected.
  - **Never write a page colour as a literal** (`'#ffffff'` for a card, a cream
    `rgba(249,248,246,…)`, a pale tint). White text on green or on a photo, shadows,
    and brand/score hues are fine as literals. The green is one value per palette for
    text and fills alike (`#2d6a4f` / `#4f9a77`).
  The share card stays light in both — it's a picture people post — so its card body
  keeps literal colours and the light score scale (`songScoreColor(n)`, whose second
  argument gives the dark one).
- **Every push names its kind, and the recipient can switch each kind off.**
  `push.tokens_for_user(session, user_id, kind)` returns no tokens when the
  recipient's `PressUser.notify_<kind>` column is off (`NOTIFY_KINDS`: recommendation,
  friend, reply, review, rating; all default on). Reply and review notifications say
  "Tap to see what they said.", never the text itself. `rating` goes to the rater's accepted
  friends with the record in their library, any shelf, on a first rating that isn't of an
  edition they'd rated before (`albums._notify_rating`), and opens their copy. `review` (November 2026) goes to the author's
  accepted friends who have rated the record, when a review is first published — never
  an edit (`threads.sync_review_post` returns True only then; `albums._notify_review`).
  Since then the app also asks at launch (`mobile/components/NotifyPromptSheet.tsx`):
  "Want to receive notifications?", after the username, tutorial and phone prompts and before the people sheet, only while iOS hasn't asked this device yet, once
  per device (`prefs.pushPromptAnswered`). No launch prompt or sheet opens over the first
  run or the rating flow: the phone prompt, this one and the people sheet all
  hold on `HELD_ON` screens (`mobile/lib/onboarding.ts`). Before it, the only way in was Settings →
  Notifications, and 2 of 110 accounts had a device registered. The switches are `GET`/`PUT /users/me/notifications`,
  shown in mobile Settings once iOS permission is granted. A new kind of push adds a
  column, a `NOTIFY_KINDS` entry and a Settings row — never a bare token lookup.
- **An Expo module's version must match the app's `expo-modules-core`, not just the
  SDK.** Expo ships modules precompiled (`EXPO_USE_PRECOMPILED_MODULES`), so a module
  built against a newer core links fine and then **crashes at launch** with
  `Symbol not found … ExpoModulesCore`. `npx expo install` picks a module's newest patch,
  which may be built against a newer core than this app's (Expo 57.0.4, core 57.0.3):
  `expo-contacts` 57.0.6 did exactly that in October 2026, and is pinned to `57.0.0`
  — exact, because `~` drifts back. Add a module at a version released no later than
  the installed core, and run the Release build before pushing. Don't add Firebase in
  Xcode as a Swift package either: React Native Firebase brings it through CocoaPods
  (`$RNFirebaseDisableSPM`), and two copies fail with `redefinition of module 'Firebase'`.
- **A page's title takes you back to the top** (iPhone, November 2026): `mobile/lib/scrollToTop.ts`.
  The big masthead title and the compact title in the bar that fades in both call
  `scrollToTop(ref)` on the page's scroll view (ScrollView, FlatList or SectionList, Animated
  or not) — For You, Charts, Social, Profile, someone's profile, a genre page, Upcoming, a
  thread, the artist page, artist splits and both album views. A compact bar that takes taps
  gets its `pointerEvents` from `useCompactBar(at)`, `at` being where its fade begins: a
  transparent bar still catches taps, and would block the masthead's own back and search
  controls under it. A new page with a title wires it the same way. **Tapping the tab you're
  already on does the same** for the four tab pages (`useTabScrollToTop(scrollRef)`, on the
  tab navigator's `tabPress` while focused), and on web clicking the sidebar or bottom-bar
  link of the page you're on scrolls `<main>` to the top (`Layout`'s `onNav`).
- **Mobile device preferences live in `mobile/lib/prefs.ts`** (Keychain, loaded before
  the app is ready): haptics on/off, which shelf Library opens on, and appearance
  (System / Light / Dark, Settings → Preferences). Every buzz goes
  through `mobile/lib/haptics.ts` (`selection` / `light` / `success`), which honours
  the switch; don't import `expo-haptics` in a component.
- **Changing a rule that is duplicated across platforms means changing every copy.**
  `EP_MAX_TRACKS` / `isEP` lives in `scoring.py` and both rating screens. The share
  card's geometry lives in both `ShareCard.tsx` files by the same rule — every mobile
  measurement is the web pixel value passed through `u()`.
- **Verification is the taste-overlap tests plus typecheck + lint + running it.** Tests:
  `PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 python3.13 -m pytest tests -q -p no:warnings` (196
  pass; none open a database connection, so they say nothing about production data —
  new taste-overlap code gets a test beside the others). Web:
  `cd frontend && npm run typecheck`. Mobile: `cd mobile && npm run typecheck`. Backend:
  import the app (`python -c "import backend.main"`). `cd frontend && npx eslint .`
  currently reports **14 problems — 10 errors and 4 warnings**, and mobile `eslint .`
  reports **126 errors
  and 6 warnings** (mostly `react-hooks/refs` on `useRef(...).current`; hold an
  `Animated.Value` in `useState(() => …)` instead) — if your change doesn't add to
  those counts, you haven't regressed them.

### Where the next feature goes

| Change | Start here |
|---|---|
| A new endpoint | a router in `backend/routers/`, then `shared/src/api.ts`, then **both** clients |
| A new column | a SQLModel field in `models.py` **and** an `ALTER TABLE` string in `init_db()` |
| A new scoring input | `backend/scoring.py` only — `global_rating.py` and both workers compose through it |
| A new ML stage | `worker/nightly_predict.run_user`; build anything userbase-wide in `main()` and pass it down |
| A new theme axis | append to `THEME_AXES`, then re-analyse every album and refit every model |
| Closing the web/mobile gap | `frontend/src/` only — every mobile-only function already has an endpoint and a shared-client wrapper (§11 lists what remains) |
