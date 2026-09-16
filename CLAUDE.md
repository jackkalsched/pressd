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
**Social** (activity, reviews, friend comparison), and **threads** (one discussion room
per record, mobile only).

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
| `backend/database.py` | engine + **the entire migration system** (§3) | 190 |
| `backend/models.py` | 23 SQLModel tables | 580 |
| `backend/deps.py` | `current_user`, `viewable_user_id`, `thread_access` — the auth invariant | 148 |
| `backend/scoring.py` | framework 1: the user's own album score | 267 |
| `backend/global_rating.py` | framework 2: the userbase-pooled rating | 155 |
| `backend/trackkeys.py` | normalization keys; pure stdlib, imported everywhere | 163 |
| `backend/routers/` | 14 routers, **104 endpoints** | 5,529 |
| `worker/` | `nightly_predict`, `catalog_predict`, `artist_clusters`, `audio_ingest`, … | 1,786 |
| `theme_predictor/` | `predict_single`, `personalize`, `global_factors`, `corpus`, … | 1,896 |
| `shared/src/api.ts` | the single API client, 92 exported functions | 1,763 |
| `frontend/src/` | 14 pages, 14 components | 9,715 |
| `mobile/` | 20 routes, 34 components, 13 lib modules | 17,416 |

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

# Audio ingest — Mac-only, manual. yt-dlp is bot-blocked from datacenter IPs,
# which is why this cannot run in CI. This is the canonical audio job.
./run_audio_ingest.sh [--limit 20]
```

**Env vars.** Backend/worker: `DATABASE_URL` **or** `PG_HOST`/`PG_PORT`/`PG_DB`/`PG_USER`/
`PG_PASSWORD`; `JWT_SECRET`, `TOKEN_TTL_DAYS`, `APP_URL`, `ANTHROPIC_API_KEY`,
`LASTFM_API_KEY`, `DISCOGS_TOKEN`, `GENIUS_ACCESS_TOKEN`, `THEME_LLM_MODEL`,
`APPLE_BUNDLE_ID`, `FIREBASE_PROJECT_ID`, `FIREBASE_CREDENTIALS_JSON` (Render) |
`FIREBASE_CREDENTIALS_FILE` (local), `SMTP_*`.
Web: `VITE_API_URL`, `VITE_GOOGLE_CLIENT_ID`. Mobile: `EXPO_PUBLIC_API_URL`,
`EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID`, `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID`.
Files: `.env` at root, `frontend/.env.local`, `mobile/.env`.
`EXPO_PUBLIC_*` vars are **inlined into the shipped iOS bundle** — never secrets.

Local `.env` sets neither `JWT_SECRET` nor `DISCOGS_TOKEN`. The first falls back to a
public literal (§10, P12); the second means `/aoty/*` discographies degrade in dev.

**`render.yaml` is not authoritative.** It still says `plan: free` (production is on a
paid tier) and declares four env vars where the code reads about fifteen. Don't reason
about deploy config from it.

**Migrations are a list of idempotent SQL strings** in `init_db()`
([backend/database.py:66-186](backend/database.py#L66-L186)), run on **every startup**.
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
RatingScreen.tsx:191 / rate/[id].tsx:378
  POST /songs/batch-rate            songs.py:83   writes scores; NO recompute
  PATCH /albums/{id}                albums.py:197 status + 4 factors
    ├─ recompute_user_scores()      albums.py:243  the rater's library only
    ├─ invalidate_global_ratings()  global_rating.py:49  (this process only)
    └─ _queue_song_repredictions()  albums.py:351  ⚠️ dies on Render (§11)
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
GET /discover/new-releases        discover.py:298, 6h TTL
  a. in-memory dict               instant
  b. cachedfeed row in Postgres   one PK lookup; survives deploys and restarts,
                                  and a fresh process inherits its remaining lifetime
  c. live fetch, _fetch_releases  then written to both
     1. AOTY this-week scrape        discover.py:122   ranked by rater count
        └─ ~24 concurrent Deezer resolves (semaphore 10) for importable ids
     2. ListenBrainz fresh-releases  discover.py:56    sampled to 24, ranked by fan count
     3. Deezer /editorial/0/releases
     4. Deezer /chart/0/albums
     5. 502 — nothing empty is ever cached or stored
```
A live fetch is ≈ 25 outbound HTTP calls; measured at 4.5s and 9.9s on two runs. Before
the stored copy, every deploy and restart made the next For You visitor pay it. Reading
or writing the stored copy never raises: a database error costs a slow request, not a
failed one. From a Mac on 2026-09-15, AOTY answered **403**, so the list came from
ListenBrainz; whether Render is blocked too is unverified. See QUESTIONS Q16.

### Journey: the charts

```
GET /discover/charts              discover.py:418
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
live:    GET /discover/picks      discover.py:544  ORDER BY predicted_score DESC
         → excludes already_rated and anything already in the library
```

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
(`:82`); anything "global" must pool copies. `Song` carries `track_id` into the global
`Track`, so audio is analyzed once and shared (`:244-246`) — that split is what makes
the ML affordable. A mapper event keeps `Album.subject_key` in step with artist+name on
every write (`:158-172`), deliberately, because albums are constructed in four places
and `PATCH` writes arbitrary fields through `setattr`. `favorite_*_id` and `top_song_id`
are **plain ints, not FKs** (`:18-19`): a deleted album should blank the pick, not block
the delete.

**`backend/deps.py`** — every endpoint touching user data depends on `current_user`;
identity never comes from a client-supplied `user_id`. `authorize_view` /
`viewable_user_id` gate friend-viewing and require an **accepted** friendship — pending
grants nothing (`:83-89`). `thread_access` (`:121`) is stricter: you may read an album's
thread only if **you have rated that album**, because a thread on a record you're
halfway through is the most spoiler-prone surface in the app.

**`backend/trackkeys.py`** — pure stdlib, safe to import from web, worker and scripts.
Users' catalogs disagree about editions, feat-credits and apostrophes; these keys
collapse "Take Care", "Take Care (Deluxe)" and "Take Care (Deluxe Version)" into one
record. Read §12 before adding a grouping.

**`backend/routers/albums.py`** (1,301) — the largest router. `import_album` (`:373`)
dedups, inserts, then `_link_tracks` (`:473`) resolves global track ids; two recordings
sharing a name but differing >10s in duration get a `||d{sec}`-suffixed key (`:490-491`).
`recommend_album` (`:778`) refuses without a tracklist (`:808-812`) and fills in whatever
the recipient's shell copy is missing, but leaves anything they've engaged with alone.

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

`MIN_RATED_ALBUMS = 10` gates all output. It was 50 (one user in twenty got anything),
then 1 (predictions for anyone). Below 10 the blend is almost entirely pooled, and while
the userbase is small the pool is largely one person's taste — so the prediction reads
as a stranger's opinion wearing the user's name (`nightly_predict.py:52-65`).

Users whose rating counts haven't moved are skipped, but their album rows still sync so
a newly queued album picks up a prediction without refitting. Each user runs in its own
try/except and logs to `workerrun`. Before any of it, the job recomputes every stored
album score against the current userbase prior (`rescore_library_scores`, logged as
`rescore_scores`); a `--user` run rescores only that user.

⚠️ `song_score_model.ARTIST_K = 12` and `worker/artist_clusters.ARTIST_K = 18` are
**different constants with the same name** for different clusterings.
⚠️ `TrackAudio.source` — never mix `yt_full` and `preview_30s` between training and
prediction; 30s-preview features shift.

Audio ingest (phase A) is Mac-only and manual; only prediction (phase B) runs in
[.github/workflows/nightly-predict.yml](.github/workflows/nightly-predict.yml).

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
| `albums.py:_classify_genre_claude:278` | web, background thread, on import | once per album row |
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
| Last.fm | listener counts (search prior), genre tags | `LASTFM_API_KEY` | in-proc 600s |
| ListenBrainz | fresh-releases feed (2nd choice) | none, UA | 6h, stored in `cachedfeed` |
| albumoftheyear.org | **primary** new-release feed, scraped | none | 6h, stored in `cachedfeed` |
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
| new releases | memory, then `CachedFeed` row (Postgres), `discover.py:37-40` | 6h | shared ✅ survives restarts |
| Apple JWKS, FCM creds | `auth.py:21`, `push.py:48` | — | **process** |
| artist photos | `ArtistMeta` (Postgres) | 30d | shared ✅ |
| album LLM factors | `albumfactors` (Postgres) | forever | shared ✅ |

**Everything in-process is correct only because the backend is one process.** See §10 P5.

**The ratings board stays in memory on purpose.** It is thrown away whenever anyone rates
a song or finishes an album (`songs.py:154`, `albums.py:245`), so a stored copy would be
rebuilt as often as the in-memory one and every read would cost a database round trip.
It only needs moving once there is more than one process. New releases are the opposite
case: they change a few times a day and are expensive to rebuild, so they are stored.
`CachedFeed` is keyed by feed name, so the next feed like that is a new key, not a table.

Hottest paths, in order: `/discover/charts`
(reads every rated album), `/social/compare` (reads every friend's library),
`/albums/{id}/report` (aggregates the whole song table), `/discover/new-releases` on a
cold cache (~25 outbound calls).

---

## 10. System-design notes

Full evidence in [docs/codebase-notes/10-performance.md](docs/codebase-notes/10-performance.md).
Current → risk → cheapest fix. Rows marked fixed have been implemented; the rest have not.

| # | Finding | Risk | Cheapest fix |
|---|---|---|---|
| **P1** | ~~Finishing a rating rescored every user's library inside the request.~~ **Fixed.** The request now rescores only the rater ([albums.py:243](backend/routers/albums.py#L243)); the nightly job makes everyone exact again (`nightly_predict.py:385`); the userbase prior reads four columns instead of whole rows (`scoring.py:113`). On a 30-user test database one rating went from 124 queries to 13, and the rater's scores matched the old path exactly | ~~HIGH~~ → LOW | residual: the prior is still one scan over every rated album per rating, now of four numbers |
| **P2** | `/discover/charts` selects every rated album, then filters and groups twice in Python, uncached (`discover.py:438`) | **HIGH** — the Charts tab, both platforms | memoise the response on its filter tuple with the existing 60s TTL + invalidation hook |
| **P11** | ~~All 10 `/util/*` endpoints had no auth.~~ **Fixed.** The router now carries `dependencies=[Depends(current_user)]` (`util.py:31-45`) and the two web call sites that used a bare `fetch` were moved onto `fetchAlbumColor`. Verified: all ten answer 401 without a token. A signed-in user can still call `/backfill-genres?override=true` | ~~HIGH~~ → LOW | residual: move the seven maintenance routes out of HTTP entirely, beside `run_audio_ingest.sh` |
| **P8** | Engine allows 15 connections *per process*; Supabase's session pooler allows 15 *per project* (`database.py:28` vs `backfill_factors.py:35`) | **HIGH** at scale | confirm pooler mode; size `pool_size` against the real limit ÷ instances |
| **P5** | The ratings board and search cache are per-process. `invalidate_cache()` clears one process's board. New releases now persist in `CachedFeed` | **HIGH** the moment there's a 2nd instance | move the board to shared storage before scaling out, not before: at one process it would only be slower |
| **P3** | `/discover/picks` runs a `NOT EXISTS` on `lower(trim(…))` with no functional index (`discover.py:570-575`) | MEDIUM — `albumprediction` grows as users × catalog | functional index, or store `album_key` on `Album` |
| **P4** | `/albums/{id}/report` aggregates the **entire** song table, then filters in Python (`albums.py:554-557`) | MEDIUM | add `.where(Song.album_id.in_(...))` — one line |
| **P6** | `/discover/new-releases` has no single-flight; when both the memory and the stored copy have expired, N concurrent requests each do ~25 outbound calls, and failure prevents caching. The stored copy narrows this to the moment of expiry rather than every restart | LOW–MED | `asyncio.Lock` around the refill |
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
`users.py:209` with `Invite.accepted_at` already stored; recommend→rate at `albums.py:778`
with `recommended_by`/`recommended_at` already persisting the edge; rating-funnel
drop-off is the gap between `batch-rate` and `PATCH /albums`; discovery→library is
`/discover/picks` → `POST /albums/import`.

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

### Confirmed defects

- **Three album-grouping keys disagree.** `trackkeys.py`'s header says every cross-user
  grouping must go through it; the charts don't. `album_key` (stored, folds nothing),
  `subject_key_album` (folds editions + diacritics), and `record_key`
  (`global_rating.py:54`, a bare `.strip().lower()`) — the last inlined again at
  `discover.py:358`, `:387`, `:489`, `public.py:91`, `social.py:359`. So **"Take Care"
  and "Take Care (Deluxe)" are one discussion thread and two chart rows**, each with a
  fraction of the raters, while `/discover/heated` groups correctly on `subject_key`.
  QUESTIONS Q8 — re-ranking the boards is Jack's call.
- **Three background threads in `albums.py` can't fully work on Render.**
  `song_score_model.py:29-38` imports `sklearn` and `scipy` unguarded, and neither is in
  `requirements.txt`. `_queue_song_repredictions` (`:351`) therefore always raises,
  caught and printed. `_queue_predictions` (`:260`) guards its import
  (`predict_single.py:148`), so its theme and distinctness stages still run and only the
  song-model stage no-ops. `_queue_genre_tagging` works. Probably intended after the
  worker split, but the code doesn't say so. QUESTIONS Q11.

### Product gaps (verified by call-graph, not assumed)

- **The 60-point factor budget has no UI.** `PUT /users/{id}/factor-weights` exists and
  recomputes scores; both rating screens *read* the weights via `fetchFactorWeights`;
  **nothing on either platform writes them**. Every user is on 25/15/15/5. The unused
  `updateFactorWeights` wrapper was removed in the cleanup; re-add it when the UI lands.
- **Discussion posts can't be edited or deleted from the apps.** `PATCH /posts/{id}`
  and `DELETE /posts/{id}` still exist server-side and the thread screen renders deleted
  states, but no client reaches them — the unused `deletePost`/`editPost` wrappers were
  removed in the cleanup, so wiring this up means re-adding two six-line functions. A
  moderation gap, given `PostReport` and the auto-hide rule.
- **A tracklist never re-syncs after import.** `POST /albums/import` returns an existing
  copy with `already_existed: True` and only backfills a missing cover (`albums.py:381`).
  There is no refresh endpoint, so when an upstream catalog corrects a tracklist the
  user's only recourse is delete-and-re-add, losing their ratings. Wanted, not intended.
  `backend/repair_missing_songs.py` is a one-off Excel-sourced script, not a fix.

### Parity — **the old `CLAUDE.md`'s "web is behind on For You" note is out of date**

Both gaps it named are closed: `frontend/src/pages/ForYou.tsx:101-110` calls
`fetchPredictedPicks` and `fetchTopReviews`. The real gap runs much wider in the same
direction — **32 client functions are mobile-only, 8 web-only**. Most significantly,
**the entire discussions feature is mobile-only** (threads, replies, votes, reports,
spoilers, the community album view, `publishThoughts`), as is account management
(avatar upload, delete account, Apple sign-in, provider unlinking) and push.

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

One item knowingly left: `GET /albums/{id}/report` (`albums.py:512-777`), whose only
consumer was the deleted `RatingReport.tsx`. Removing a finished-but-unmounted feature
is a product call, not a cleanup — QUESTIONS Q15.

### Still open — see [QUESTIONS.md](QUESTIONS.md)

Q8 (three grouping keys disagree), Q9 (is `PATCH /songs/{id}` deliberate? the endpoint
was kept, its client wrapper deleted), Q11 (confirm web-side re-prediction is meant to
no-op), Q13 (is the duplicate `_artist_key` intentional?), Q15 (is `/albums/{id}/report`
shelved or superseded?), Q16 (is AOTY blocking the production server?).

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
- **Changing a rule that is duplicated across platforms means changing every copy.**
  `EP_MAX_TRACKS` / `isEP` lives in `scoring.py` and both rating screens. The share
  card's geometry lives in both `ShareCard.tsx` files by the same rule — every mobile
  measurement is the web pixel value passed through `u()`.
- **There is no test suite, so verification is typecheck + lint + running it.** Web:
  `cd frontend && npm run typecheck`. Mobile: `cd mobile && npm run typecheck`. Backend:
  import the app (`python -c "import backend.main"`). Lint currently has **16
  pre-existing errors in 10 frontend files** — if your change doesn't add to that count,
  you haven't regressed it.

### Where the next feature goes

| Change | Start here |
|---|---|
| A new endpoint | a router in `backend/routers/`, then `shared/src/api.ts`, then **both** clients |
| A new column | a SQLModel field in `models.py` **and** an `ALTER TABLE` string in `init_db()` |
| A new scoring input | `backend/scoring.py` only — `global_rating.py` and both workers compose through it |
| A new ML stage | `worker/nightly_predict.run_user`; build anything userbase-wide in `main()` and pass it down |
| A new theme axis | append to `THEME_AXES`, then re-analyse every album and refit every model |
| Closing the web/mobile gap | `frontend/src/` — the API and the shared client already carry discussions in full |
