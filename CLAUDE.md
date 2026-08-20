# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## The product

Press'd is a **social** music rating app — Letterboxd for albums. A user rates every song on a
record, then rates the record itself on four external factors, and gets a composite score. They
follow friends, recommend albums, and see what everyone is rating. Live at pressdmusic.com.

The rating flow is the opinionated part: **songs unlock one at a time, in track order**, because the
app is meant to make people listen to an album front to back the way records were meant to be heard.
Don't add jump-ahead affordances without a deliberate decision — the constraint is the product.

The constraint applies to the *first pass only*. Once an album is rated, the user can go back and
edit any song score or any external factor freely (`PATCH /songs/{id}`, `PATCH /albums/{id}`), which
recomputes the album score. Listening in order is the intended first experience, not a lock.

The core loop and its vocabulary:

- **To Listen** — the wishlist/queue of records the user intends to hear. Sorted best-predicted-first.
- **Listening** — mid-album, partially rated.
- **Rated** — finished; carries a score, four factors, and optionally a written review.
- **Recommending** an album to a friend drops it into *their* To Listen, tagged with who sent it
  (`recommended_by`, `recommendation_note`).

Pages: **Library/profile** (the three-bucket collection plus stats — how they rate by genre, by
artist, by year), **Ratings** (rankings of their albums and artists by various metrics, including
baseball-style artist stats: SAR, consistency+, bang %, skip %), **Charts** (userbase-wide top albums
this week and all time), **For You** (the home feed), **Social** (activity + reviews).

**For You** is a holistic editorial column, not one list: resume-where-you-left-off, a daily
"rate this next" pick, New & Popular (new releases scraped from an external source), Pressd Trending
(what the userbase is rating), and reviews from across Press'd. Each recommendation carries that
user's *predicted score*.

**Web and mobile stay in lockstep on features.** A new capability should land on both. Layout and
visual design differ per platform and are expected to — the shared thing is the feature and the API,
not the UI.

**Known gap: web's For You is behind mobile's.** Mobile has two sections the web app is missing, and
they are meant to be added there:
- *"What are pressers talking about"* — `/social/top-reviews`, userbase-wide reviews for the day.
  Web currently shows "Fresh reviews from friends" (`/social/reviews`), which is friends-scoped only.
- The daily *"rate this next"* pick — `/discover/picks` (`fetchPredictedPicks`), drawn from
  catalog-wide predictions. Web's "Ready to rate" doesn't call it.

Both endpoints already exist in `shared/src/api.ts`, so this is UI work in
[frontend/src/pages/ForYou.tsx](frontend/src/pages/ForYou.tsx), not API work.

## Commands

Python 3.13. **There is no test suite** — no pytest, no vitest. Verification is typecheck + lint +
running it.

```bash
# Backend (from repo root — backend/database.py's load_dotenv() expects it)
pip install -r requirements.txt
uvicorn backend.main:app --reload            # http://localhost:8000

# Web
npm install                                  # root: npm workspaces (shared, frontend, mobile)
cd frontend && npm run dev                   # http://localhost:5173
npm run typecheck                            # tsc -b
npm run lint

# Mobile (Expo)
cd mobile && npx expo start
npm run typecheck && npm run lint
# Never run `npx expo prebuild --clean` casually — it wipes native config. See mobile/TESTFLIGHT.md.

# ML worker (requirements-worker.txt is deliberately NOT installed on the web service)
pip install -r requirements-worker.txt
python -m worker.nightly_predict             # all eligible users
python -m worker.nightly_predict --user 1 --skip-llm
python -m worker.catalog_predict --dry-run
python song_score_model.py                   # retrain → song_score_model.pkl

# Audio ingest — Mac-only, manual. yt-dlp is bot-blocked from datacenter IPs,
# which is why this can't run in CI.
./run_audio_ingest.sh [--limit 20]
```

## Scoring — read this before touching any number

There are **three distinct scoring frameworks**, and conflating them is the easiest way to break the
app. All of them live in or route through [backend/scoring.py](backend/scoring.py).

### 1. A rated album, on the user's own distribution

`compute_album_score` = the song mean, plus each of the four external factors **z-scored and
weighted**:

- **theme, replay_value, production, distinctness** share a fixed 60-point budget stored per user on
  `PressUser` (defaults 25/15/15/5, each ≥5). Weight = points / 100 (`get_user_weights`).
- Each factor is z-scored against **that user's own factor distribution, shrunk toward the userbase
  prior** by empirical Bayes (`shrink_to_prior`, `SHRINKAGE_K = 5` album-equivalents). This is what
  stops a two-album library from producing a near-zero standard deviation whose z-scores pin every
  score to the clamp.
- Result is clamped to 1–10.

**EPs are ≤6 tracks** (`EP_MAX_TRACKS`): the rating flow skips the four factors entirely and the
score is just the user's song mean. This rule is duplicated as `isEP` in the rating screens — change
one, change all of them.

**Singles are ≤2 tracks** (`is_single_release`): they still score and still count toward the user's
library and artist stats, but they're kept off userbase-wide charts, where a one-track release rated
10 would outrank every real album on one person's say-so.

### 2. The global Press'd rating, on the userbase distribution

The same album shows a **different number** in a user's library than it does to the userbase — by
design. [backend/global_rating.py](backend/global_rating.py) pools the **raw inputs** across every
user's copy of a record and runs `compute_album_score` once, as if the userbase were a single
listener — it does *not* average finished per-user scores, because each of those was z-scored
against its own owner's library and they aren't on a common scale.

Song scores are averaged **per track first** (via the shared `track_id`), then across tracks, so a
16-track deluxe edition can't outvote the 15-track standard. Factors are averaged across copies
carrying a complete set. The result is z-scored against the userbase-wide distribution with the
default weights, not any one person's.

### 3. Predicted scores, for albums nobody has rated yet

Every album should carry a predicted score for every user. The hard case is the **cold start**: a
user with few ratings has a history too noisy to fit on, so the pipeline degrades toward the global
distribution rather than failing — see the pipeline section below. `MIN_RATED_ALBUMS = 10` is where
enough of a user's own signal survives the blend to be worth showing at all; below that they get
nothing, because the pooled fallback would read as a stranger's opinion wearing their name.

## Architecture

### One repo, four deployables

FastAPI backend (Render) · React 19 + Vite web app (Vercel) · Expo iOS app · nightly ML worker
(GitHub Actions).

`shared/` is a TS workspace package (`@pressd/shared`) consumed **as source**, not built — Vite and
Metro each transpile it. It holds domain types, the platform-agnostic API client, and album search.
`frontend/src/api.ts` and `mobile/lib/api.ts` each call `configureApi()` to inject base URL, token
storage, and the 401 handler, then re-export. Domain-shaped code belongs in `shared/`; platform-shaped
code (localStorage vs SecureStore, routing) stays in the app.

The API speaks snake_case; the shared client transforms to camelCase at the boundary. Don't leak
snake_case into UI code.

### Backend

FastAPI + SQLModel on Postgres (Supabase). One router per domain under `backend/routers/`. Local
`pressd.db` files are vestigial — Postgres is the real database.

**Migrations are a list of idempotent SQL strings** in `init_db()` in
[backend/database.py](backend/database.py), run on every startup. There is no Alembic. Adding a
column means adding a SQLModel field *and* appending an `ALTER TABLE ... ADD COLUMN` line to that
list. `_exec_migration` swallows "already exists" and logs everything else, so drift isn't silent.

**Auth is the invariant to not break.** Every endpoint touching user data depends on `current_user`
(JWT-derived) — identity never comes from a client-supplied `user_id`. Read endpoints that support
viewing a friend go through `viewable_user_id` / `authorize_view`, which require an **accepted**
friendship; pending requests grant nothing. See [backend/deps.py](backend/deps.py).

`routers/public.py` is the only unauthenticated surface (marketing-site charts). It deliberately
duplicates rather than shares `discover.py`'s charts: no auth, aggregates only, never who rated what.
Nothing per-user may ever be returned there.

**Normalized keys, not raw strings.** [backend/trackkeys.py](backend/trackkeys.py) (pure stdlib —
safe to import from web, worker, and scripts alike) defines `artist_key`, `_clean_album`,
`match_title`, `same_album`. Users' catalogs disagree about editions and feat-credits; these keys
collapse "Take Care", "Take Care (Deluxe)" and "Take Care (Deluxe Version)" into one record. **Any
grouping across users must go through them** — matching raw names splits one album into three
community albums with one rater each.

**External data sources**: ListenBrainz fresh-releases → resolved to Deezer for new releases
(`discover.py`, 6h cache, Deezer editorial as fallback); Discogs for artist discographies
(`aoty.py`, needs `DISCOGS_TOKEN`); Last.fm for genre tags; Deezer for artist photos.

### The ML pipeline

The governing rule, from `worker/nightly_predict.py`: **every stage that measures an album is shared
across the userbase and paid for once; every stage that decides what a person thinks of it is fitted
per user.**

1. **Song model** — `song_score_model.py` (LightGBM/sklearn over Essentia audio features + KMeans
   taste clusters) → `predicted_song_mean`. `fit_for_user` ramps between a personal model and the
   pooled userbase model calibrated onto the user's scale, rather than switching at a cliff.
2. **Album analysis** — Claude analyzes each album **once, globally** into `albumfactors`: semantic
   theme axes plus a distinctness scalar. No album is sent twice; no user's name is in the prompt.
   Lives in `theme_predictor/`, with a retrieval corpus in `corpus/` and ChromaDB embeddings.
3. **Per-user factors** — ridge regression over those axes fitted on the user's own theme ratings,
   blended with a pooled prior (`theme_predictor/personalize.py`), so two users reading the same
   measurements reach different scores.
4. **Replay** — the user's own mean for the artist blended with their mean over that artist's
   cluster-mates. `worker/artist_clusters.py` fits one global KMeans over the whole artist dataset;
   the matrix holds audio centroid, genre one-hot and subgenre multi-hot — **no scores, ratings, or
   user ids**. Membership can't depend on anyone having rated the artist, since that would exclude
   exactly the artists the feature exists for. `replay_tier` records which tier answered.
5. **Composite** — via `backend.scoring`, the same function that scores a *rated* album, so a
   prediction and its eventual outcome are on one formula.
6. **Catalog-wide** — `worker/catalog_predict.py` scores every album anyone has added into
   `albumprediction`, keyed `(user_id, album_key)` — not just the user's queue. This is what lets
   `/discover/picks` recommend a record the user has never heard of.

Users whose rating counts haven't moved are skipped, but their album rows still sync so a newly
queued album picks up a prediction without refitting. Each user runs in its own try/except and logs
to the `workerrun` table via `worker/runlog.py`.

Audio ingest (phase A) is Mac-only and manual; only prediction (phase B) runs in
[.github/workflows/nightly-predict.yml](.github/workflows/nightly-predict.yml), 2:30am PT.

## Conventions

- **Comments explain why, not what.** Module docstrings here carry design rationale and the record of
  what was tried and rejected (`nightly_predict.py`, `global_rating.py`, `artist_clusters.py`,
  `trackkeys.py`, `public.py`). Match that register — when you change a tuned constant or a design
  decision, update the prose that justifies it.
- **Commit messages are declarative sentences** describing the behavior change, not the diff:
  "Pool an album's copies on the record, not the spelling", "Match a track title through apostrophes
  and medleys".
- `PLAN_*.md` at the root are gitignored design docs, but code cites them by section
  ("PLAN_ml_worker_split §4", "PLAN_global_artist_clusters.md §3.3"). Read the relevant one before
  touching the pipeline it describes.
- Env: `.env` at root (backend + worker), `frontend/.env.local`, `mobile/.env`. Expo's
  `EXPO_PUBLIC_*` vars are inlined into the shipped bundle — never secrets.
- `render.yaml` still says `plan: free`; production is no longer on a free tier. Don't reason about
  free-tier cold starts or connection limits from that file.

## Known limitations worth fixing

- **A tracklist never re-syncs after import.** `POST /albums/import` returns any existing copy with
  `already_existed: True` and only backfills a missing cover — it never reconciles tracks. There is
  no refresh endpoint, so when an upstream catalog corrects a tracklist the user's only recourse is
  to delete the album and re-add it, losing their ratings. This is a wanted change, not intended
  behavior. `backend/repair_missing_songs.py` is a one-off Excel-sourced repair script, not a fix
  for this.
