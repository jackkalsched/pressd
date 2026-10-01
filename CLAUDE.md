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

Vocabulary of the core loop:

- **To Listen** — the queue of records the user intends to hear, sorted best-predicted-first.
- **Listening** — mid-album, partially rated.
- **Rated** — finished; carries a score, four factors, optionally a written review.
- **Recommending** an album drops it into a friend's To Listen, tagged with who sent it
  (`recommended_by`, `recommendation_note`).

Surfaces: **Library/profile** (three buckets plus stats), **Ratings** (rankings by
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
shared/           @pressd/shared — TS source consumed by frontend + mobile, no build
theme_predictor/  LLM album analysis; imported by the worker AND the web service
song_score_model.py  LightGBM per-song model (1,211 lines) — train + inference
corpus/           709 cached per-album LLM analyses (gitignored, local only)
docs/codebase-notes/  this audit's working notes
PLAN_*.md         gitignored design docs; code cites them by section
```

| Area | Role | LOC |
|---|---|---|
| `backend/main.py` | CORS, 14 routers, `init_db()` on startup, `/health` | 45 |
| `backend/database.py` | engine + **the entire migration system** (§3) | 208 |
| `backend/models.py` | 23 SQLModel tables | 595 |
| `backend/deps.py` | `current_user`, `viewable_user_id`, `thread_access` — the auth invariant | 148 |
| `backend/scoring.py` | framework 1: the user's own album score | 267 |
| `backend/global_rating.py` | framework 2: the userbase-pooled rating | 155 |
| `backend/trackkeys.py` | normalization keys; pure stdlib, imported everywhere | 163 |
| `backend/routers/` | 14 routers, **107 endpoints** | 7,502 |
| `worker/` | `nightly_predict`, `catalog_predict`, `artist_clusters`, `audio_ingest`, `refresh_new_releases`, … | 2,149 |
| `theme_predictor/` | `predict_single`, `personalize`, `global_factors`, `corpus`, … | 1,896 |
| `shared/src/api.ts` | the single API client, 92 exported functions | 1,763 |
| `frontend/src/` | 18 pages, 16 components, 2 lib modules | 10,355 |
| `mobile/` | 19 routes, 32 components, 14 lib modules | 17,416 |

**Stack, as verified.** FastAPI 0.103 + SQLModel on **Postgres only** — Supabase is a
Postgres *host*, no SDK, no Supabase auth, no RLS (`database.py:11-29`). Firebase is
**FCM push only**, not a datastore (`push.py`). React 19 / Vite 8 / TanStack Query 5 /
Tailwind 4 on web; Expo 57 / RN 0.86 / expo-router on mobile. Plain REST, JSON,
snake_case on the wire, camelCase at the client boundary.

**There is no test suite.** No pytest, no vitest, nothing. Verification is typecheck +
lint + running it.

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

# ML worker — requirements-worker.txt is deliberately NOT installed on the web service
pip install -r requirements-worker.txt
python -m worker.nightly_predict             # all eligible users
python -m worker.nightly_predict --user 1 --skip-llm --force
python -m worker.catalog_predict --dry-run
python song_score_model.py                   # retrain → song_score_model.pkl

# Audio ingest — the Mac only: yt-dlp is bot-blocked from datacenter IPs.
./run_audio_ingest.sh [--limit 20]           # by hand
./run_audio_ingest.sh --preflight            # tools, canary download + analysis, DB; writes nothing
ops/launchd/install.sh [--ref B] [--uninstall]  # 00:30 local + at login; preflights *under launchd* first
python -m worker.audio_health                # the check GitHub runs: exit 1 if stale or failed
```

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

**When it runs — in practice, when the laptop is opened.** Two agents, neither needing
VS Code or Claude open, both needing you logged in. `com.pressd.audio-ingest` fires at
00:30 local, or on the next wake if the Mac was asleep then (`man launchd.plist`:
missed runs coalesce into one). `com.pressd.audio-ingest.login` runs at login with
`--catch-up`, covering a Mac that was shut down rather than asleep, which launchd's wake
catch-up does not; it does nothing if a run succeeded in the last 20h (a `last_success`
stamp beside the clone, written only by a finished real run). A wake-triggered run
starts before Wi-Fi is back and the ingest's first act is a database connection, so
`nightly.sh` waits up to 3 min for the network; and a `lockf` lock stops the two agents
running at once.

**Env vars.** Backend/worker: `DATABASE_URL` **or** `PG_HOST`/`PG_PORT`/`PG_DB`/`PG_USER`/
`PG_PASSWORD`; `JWT_SECRET`, `TOKEN_TTL_DAYS`, `APP_URL`, `ANTHROPIC_API_KEY`,
`LASTFM_API_KEY`, `DISCOGS_TOKEN`, `GENIUS_ACCESS_TOKEN`, `THEME_LLM_MODEL`,
`APPLE_BUNDLE_ID`, `FIREBASE_PROJECT_ID`, `FIREBASE_CREDENTIALS_JSON` (Render) |
`FIREBASE_CREDENTIALS_FILE` (local), `SMTP_*`.
Web: `VITE_API_URL`, `VITE_GOOGLE_CLIENT_ID`, `VITE_IOS_APP_URL` (the TestFlight or App
Store link the public pages' iPhone buttons open; unset, they say it is coming to iOS soon —
`frontend/src/lib/iosApp.ts`). Mobile: `EXPO_PUBLIC_API_URL`,
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
   routers/ (14)           scoring.py                trackkeys.py
   105 endpoints           global_rating.py          (normalization —
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
     fails (exit 1, workerrun 'error') rather than store a thin list; the last one stays
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

### Journey: the charts

```
GET /discover/charts              discover.py:169
  → SELECT every rated album (no filter)
  → facets + filter + group in Python, TWICE (today + yesterday, for movement)
  → ranked by compute_global_ratings()   global_rating.py:59, 60s memo
```

### Journey: taste overlap

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

**`backend/models.py`** — 23 tables. `Album` is a **per-user copy**, not a record
(`:89`); anything "global" must pool copies. `Song` carries `track_id` into the global
`Track`, so audio is analyzed once and shared (`:258-260`) — that split is what makes
the ML affordable. A mapper event keeps `Album.subject_key` in step with artist+name on
every write (`:173-187`), deliberately, because albums are constructed in four places
and `PATCH` writes arbitrary fields through `setattr`. `favorite_*_id` and `top_song_id`
are **plain ints, not FKs** (`:18-19`): a deleted album should blank the pick, not block
the delete.

**`backend/deps.py`** — every endpoint touching user data depends on `current_user`;
identity never comes from a client-supplied `user_id`. `authorize_view` /
`viewable_user_id` gate friend-viewing and require an **accepted** friendship — pending
grants nothing (`:83-89`). `thread_access` (`:121`) is stricter: you may read an album's
thread only if **you have rated that album**, because a thread on a record you're
halfway through is the most spoiler-prone surface in the app. It is also the one gate
under which a **non-friend's per-song scores** are visible: `GET /posts/{id}/rating`
(`discussions.post_author_rating`) returns a post author's full rating of the thread's
record — score, factors, every song, review — to anyone past `thread_access`. It is
keyed on a post, not a user id, so only people who have spoken in the room can be
looked up, and only for that record, never their library. `public_user` is the only
shape one user may see of another (id, name, avatar, bio); `own_user` adds the caller's
private state and backs `auth_response` and `GET /users/me`. Returning a `PressUser`
row directly hands every column to the caller — email and provider ids included — which
is how `GET /users/` leaked them until September 2026.

**`backend/trackkeys.py`** — pure stdlib, safe to import from web, worker and scripts.
Users' catalogs disagree about editions, feat-credits and apostrophes; these keys
collapse "Take Care", "Take Care (Deluxe)" and "Take Care (Deluxe Version)" into one
record. Read §12 before adding a grouping.

**`backend/routers/albums.py`** (1,335) — the largest router. `import_album` (`:398`)
dedups, inserts, then `_link_tracks` (`:497`) resolves global track ids; two recordings
sharing a name but differing >10s in duration get a `||d{sec}`-suffixed key (`:514-515`).
`recommend_album` (`:803`) refuses without a tracklist (`:831-836`) and fills in whatever
the recipient's shell copy is missing, but leaves anything they've engaged with alone.
⚠️ **`GET /albums/` (the list) returns albums without their songs**; only
`GET /albums/{id}` carries them. Anything that needs per-song state for a listed album —
how many tracks are scored, say — must fetch the album itself. Both For You screens do
this for the "Pick up where you left off" card; web counted songs on the list row until
September 2026 and so always read 0.

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
user's library and artist stats, but stay off userbase-wide charts, where a one-track
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
6. **Catalog-wide** — `worker/catalog_predict.py` scores every album anyone has added
   into `albumprediction`, keyed `(user_id, album_key)` — not just the user's queue.
   That is what lets `/discover/picks` recommend a record the user has never heard of.

`MIN_RATED_ALBUMS = 10` gates all output, defined once in `backend/scoring.py` with its
rationale. It was 50 (one user in twenty got anything), then 1 (predictions for anyone).
Below 10 the blend is almost entirely pooled, and while the userbase is small the pool is
largely one person's taste — so the prediction reads as a stranger's opinion wearing the
user's name. The first-run tutorial quotes this number to new users, on both platforms.

It is enforced where predictions are **made** — the nightly job, and the import-time
`_queue_predictions` thread in `albums.py` — and again where they are **served**, via
`predictions_unlocked`: `/discover/picks` returns `[]`, and album list, detail and the
community payload blank every `PREDICTION_FIELDS` column. The serving check exists
because rows written before the gate are still stored (users 14 and 29 hold predictions
from 2026-08-08); they are hidden, not deleted, and the nightly job overwrites them once
the user reaches 10. Both clients already render a missing prediction as absent.

Users whose rating counts haven't moved are skipped, but their album rows still sync so
a newly queued album picks up a prediction without refitting. Each user runs in its own
try/except and logs to `workerrun`. Before any of it, the job recomputes every stored
album score against the current userbase prior (`rescore_library_scores`, logged as
`rescore_scores`); a `--user` run rescores only that user.

⚠️ `song_score_model.ARTIST_K = 12` and `worker/artist_clusters.ARTIST_K = 18` are
**different constants with the same name** for different clusterings.
⚠️ `TrackAudio.source` — never mix `yt_full` and `preview_30s` between training and
prediction; 30s-preview features shift.

Audio ingest (phase A) runs on the Mac, nightly under launchd from a deploy clone of
`main` (`ops/launchd/`, §3), because yt-dlp is bot-blocked from datacenter IPs. It cannot be a self-hosted runner: **the repo
is public**, and a fork's pull request could run code on the machine holding `.env`.
Prediction (phase B) runs in
[.github/workflows/nightly-predict.yml](.github/workflows/nightly-predict.yml), whose
independent `audio-health` job reads the ingest's `workerrun` row and goes red if the
last run errored, died mid-run, or is more than 36h old — the ingest's only channel into
GitHub. Every ingest run starts with a **canary** download through the real yt-dlp
invocation, because a broken toolchain and a track with no YouTube match look identical
per track, and about twenty albums have no match on any night. `run_audio_ingest.sh`
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
| `albums.py:_classify_genre_claude:302` | web, background thread, on import | once per album row |
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
| Cover Art Archive | covers for MB hits only | none | via MB result |
| Last.fm | listener counts (search prior), genre tags, **per-album listeners that rank new releases** | `LASTFM_API_KEY` (web + GitHub secret) | in-proc 600s; the ranking is stored |
| ListenBrainz | new-release candidates: every album + EP of the last 7 days | none, UA | via the stored list |
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
MusicBrainz 10–18s.

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
| Apple JWKS, FCM creds | `auth.py:21`, `push.py:48` | — | **process** |
| artist photos | `ArtistMeta` (Postgres) | 30d | shared ✅ |
| album LLM factors | `albumfactors` (Postgres) | forever | shared ✅ |

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
| **P1** | ~~Finishing a rating rescored every user's library inside the request.~~ **Fixed.** The request now rescores only the rater ([albums.py:260](backend/routers/albums.py#L260)); the nightly job makes everyone exact again (`nightly_predict.py:385`); the userbase prior reads four columns instead of whole rows (`scoring.py:113`). On a 30-user test database one rating went from 124 queries to 13, and the rater's scores matched the old path exactly | ~~HIGH~~ → LOW | residual: the prior is still one scan over every rated album per rating, now of four numbers |
| **P2** | `/discover/charts` selects every rated album, then filters and groups twice in Python, uncached (`discover.py:189`) | **HIGH** — the Charts tab, both platforms | memoise the response on its filter tuple with the existing 60s TTL + invalidation hook |
| **P11** | ~~All 10 `/util/*` endpoints had no auth.~~ **Fixed.** The router now carries `dependencies=[Depends(current_user)]` (`util.py:31-45`) and the two web call sites that used a bare `fetch` were moved onto `fetchAlbumColor`. Verified: all ten answer 401 without a token. A signed-in user can still call `/backfill-genres?override=true` | ~~HIGH~~ → LOW | residual: move the seven maintenance routes out of HTTP entirely, beside `run_audio_ingest.sh` |
| **P8** | Engine allows 15 connections *per process*; Supabase's session pooler allows 15 *per project* (`database.py:28` vs `backfill_factors.py:35`) | **HIGH** at scale | confirm pooler mode; size `pool_size` against the real limit ÷ instances |
| **P5** | The ratings board and search cache are per-process. `invalidate_cache()` clears one process's board. New releases now persist in `CachedFeed` | **HIGH** the moment there's a 2nd instance | move the board to shared storage before scaling out, not before: at one process it would only be slower |
| **P3** | `/discover/picks` runs a `NOT EXISTS` on `lower(trim(…))` with no functional index (`discover.py:321-326`) | MEDIUM — `albumprediction` grows as users × catalog | functional index, or store `album_key` on `Album` |
| **P4** | `/albums/{id}/report` aggregates the **entire** song table, then filters in Python (`albums.py:578-581`) | MEDIUM | add `.where(Song.album_id.in_(...))` — one line |
| **P6** | ~~`/discover/new-releases` has no single-flight; N concurrent refills each made ~25 outbound calls.~~ **Moot.** The endpoint no longer fetches in normal running: a GitHub worker builds the list every 6h and the endpoint reads it | ~~LOW–MED~~ → LOW | residual: `quick_build` (~30 calls) has no single-flight, but runs only after the worker has failed for 3 days |
| **P7** | ~90 migration statements on every boot, incl. 3 `DELETE`s and 6 full-table `UPDATE`s, with `statement_timeout = 0` | LOW–MED | a `schema_version` table |
| **P12** | `JWT_SECRET` defaults to a literal that is public in this repo, with no startup assertion (`deps.py:18`) | MEDIUM — fails open, silently | raise at import when unset in production |
| **P10** | `GET /stats/analysis` is an uncached, untimed, unbounded Claude call in a blocking `def`, reachable for a **friend's** library (`stats.py:1070`) | MEDIUM, latent (no client calls it) | delete, or cap + cache |

**Client degradation.** `apiFetch` handles **401 only** (`shared/src/api.ts:36`);
everything else is per-call `if (!res.ok) throw`. No timeouts anywhere — browser `fetch`
has no default, so a hung request hangs the query. React Query is `retry: 1` on both
platforms, which retries a 429 once, immediately. Cheapest fix: a `retry`/`retryDelay`
function in the two `QueryClient` configs that backs off and skips 4xx. Two files.

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
2. **Compare / taste overlap.** `fetchCompare` (`/social/compare`), `fetchRankedSongs`,
   and the board behind it (`SongGapChart`, `ScoreKdeCompare`, `app/splits/[name].tsx`).
   Web Social has Activity, Reviews and Discussions, but no Compare tab.
3. **Account management.** `deleteOwnAccount`, `signInWithApple`/`linkApple`,
   `fetchLinkedProviders`/`unlinkProvider`, `deleteAvatar`. Mobile's `SettingsSheet`
   (808 LOC) has Account / Sign-in methods / Notifications / Danger zone; web's whole
   settings surface is the Edit Profile modal in `Layout.tsx`. Account deletion being
   mobile-only is the one with a compliance edge to it.
   ⚠️ **Avatars diverge in mechanism, not just presence**: mobile posts bytes via
   `uploadAvatar`, web base64s the image into `updateUser` (`Layout.tsx:184`). Two
   storage shapes for one field — reconcile before adding a third caller.

**Surfaces that exist on both, where web is the thinner one.**

4. **Profile.** Mobile unifies library + stats + identity in `app/(tabs)/profile.tsx`
   (849) with `ProfileBanner` (578): score ring, headline stats, taste chips, and
   **My Picks** (`favorite_album/artist/song_id`, `setTopSong`). Web splits this across
   `Library.tsx` (168) and `Stats.tsx` (498) and has **no picks UI and no banner** —
   `Library.tsx` calls only `fetchAlbums`, where mobile also calls `fetchSummary`,
   `fetchScoreRange`, `fetchArtistStats`, `fetchScatterData`.
5. **Stats.** Closed, September 2026: web's Stats ranks genres and subgenres
   (`GenreBreakdown`, by count or by average), each row opening
   [TagBoard.tsx](frontend/src/pages/TagBoard.tsx) at `/stats/:kind/:tag?user=&owner=`
   over `fetchTagRecords` — mobile's `app/genre/[tag].tsx`, plus each record's rank in
   the whole library. Bang vs skip and most-rated artists came across with it.
6. **Artist page.** Web lacks `fetchSimilarArtistComparisons` and `fetchArtistImage`, so
   no artist photo and no neighbour comparisons. (Web *is* ahead here on `fetchAotyAlbums`
   and `refreshAotyArtist`.)
7. **For You.** Web lacks `RecommendationBanner`. ("Pass it on" closed, September 2026:
   `frontend/src/lib/passItOn.ts` + `PassItOnCell`, and web's `RecommendModal` gained
   the preselected friend and the recommendation note it had been missing.)
8. **Rating screen.** Closed, September 2026: web's
   [RatingScreen.tsx](frontend/src/pages/RatingScreen.tsx) is mobile's flow — one track
   at a time with the same `canJumpTo` unlock rule, then factors (a finish step for EPs),
   then the review, autosave, the `TopSongTiebreak` dialog and the share card. The
   desktop difference is a rail holding the running average and tracklist. Web's old
   "Clear all" button went with the form it belonged to; mobile never had it.
9. **Release notes.** `WhatsNewSheet` is mobile-only. (The five-card tutorial and
   `markTutorialSeen` closed, September 2026: `frontend/src/pages/Tutorial.tsx`. Web's
   `HowItWorks.tsx` is the signed-out marketing page, a different thing.)

**Not gaps.** `registerPushToken`/`unregisterPushToken` (FCM, no web push today) and
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
- **Any grouping across users must go through `trackkeys.py`.** Matching raw names
  splits one album into three community albums with one rater each. Pick the right key:
  `album_key` when it must be byte-stable (it is a stored unique key on `albumfactors` /
  `albumprediction`), `subject_key_album` when copies must collapse into one thing.
  Never inline `(name.lower(), artist.lower())` — five places already did, and they now
  disagree with the threads (§11).
- **Auth is the invariant.** Identity comes from `current_user`, never a client-supplied
  `user_id`. Friend reads go through `viewable_user_id` / `authorize_view`, which require
  an **accepted** friendship. New endpoints get a guard at the point they are written.
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
  `body` face). Clash Display is the wordmark only. Web used DM Sans until September
  2026, share card included; don't bring a third face back.
- **A final album score is always shown to two decimals** (`8.20`, never `8.2`) —
  rated, predicted or projected, on both platforms. Song scores and factor values are
  one decimal. The tutorial's demo numbers follow the same rule.
- **The public pages promote the iPhone app as a feature, not a footnote.** The
  landing page carries an iPhone button beside the Google sign-in, a nav link, and a
  full-width band (`#iphone`) fanning the five App Store preview slides
  (`frontend/public/app/`, resized from the design exports). Where the buttons go is
  one setting, `VITE_IOS_APP_URL` (`frontend/src/lib/iosApp.ts`): unset, they scroll
  to the band and the page says "Coming to iOS soon" rather than offering a download
  that isn't there.
- **For You's single-record cards share `SpotlightCard`** (web): Pass it on and Pick
  up where you left off. No border and no box button — the cover, blurred, is the
  card's colour; the whole card is the target. A new card of that kind goes through
  the same component rather than a fresh bordered row.
- **Heated Discussions shows a verdict, not tags** (web): *Divided*, *Loved*, *Hated* or
  *Lukewarm*, as a coloured badge, a glow under the cover and a meter of where the
  room's scores fall. The verdict is the server's flags (`discover.py`: `LOVED_MEAN`,
  `HATED_MEAN`, `CONTROVERSIAL_SPREAD`), never a client threshold, and *Divided* wins
  when a record is also loved or hated. Trending on Pressd stays a plain ranked list
  (`TrendingBoard`): no rank gets special treatment.
- **Hover feedback stays small.** `COVER_LIFT` is a 4% lift and a 1° lean on an
  ease-out; it was 13% and 3° on a springy curve and made rows of covers jump. Keep
  new hover scales in that range.
- **Web motion has one vocabulary, in `frontend/src/index.css`** ("Interaction
  feedback"): every button presses in, `page-enter` on route change (keyed in
  `Layout`), `fade-in` + `pop-in` for dialogs, `menu-in` for dropdowns, `rise-in` /
  `grow-x` staggered by a `--i` custom property, `pop` for a state switched on, and
  `flash` for something the user just made. Use these rather than new keyframes;
  all of them stop under `prefers-reduced-motion`. A horizontal scroller clips
  vertically, so a rail of `COVER_LIFT` covers needs room inside it
  (`HeatedDiscussions` pads `py-5` and gives it back with `-my-5`).
- **Changing a rule that is duplicated across platforms means changing every copy.**
  `EP_MAX_TRACKS` / `isEP` lives in `scoring.py` and both rating screens. The share
  card's geometry lives in both `ShareCard.tsx` files by the same rule — every mobile
  measurement is the web pixel value passed through `u()`.
- **There is no test suite, so verification is typecheck + lint + running it.** Web:
  `cd frontend && npm run typecheck`. Mobile: `cd mobile && npm run typecheck`. Backend:
  import the app (`python -c "import backend.main"`). `cd frontend && npx eslint .`
  currently reports **15 problems — 11 errors and 4 warnings**, and mobile `eslint .`
  reports **130 errors
  and 7 warnings** (mostly `react-hooks/refs` on `useRef(...).current`; hold an
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
| Closing the web/mobile gap | `frontend/src/` only — every mobile-only function already has an endpoint and a shared-client wrapper (§11 lists the remaining 16) |
