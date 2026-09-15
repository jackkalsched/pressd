# Phase 0 — Repo map & audit order

Snapshot: git `d8a76fc`, 331 commits, last commit 2026-09-06. All line refs are
`path:line` against that tree.

## Stack, as verified (not as assumed)

| Layer | Reality | Evidence |
|---|---|---|
| Backend | FastAPI 0.103.2 + SQLModel 0.0.38 on SQLAlchemy 2.0.36, Python 3.13 | `requirements.txt`, `runtime.txt`, `backend/main.py:8` |
| Database | **Postgres only** (Supabase-hosted). Supabase is a Postgres host, not an SDK — no `supabase-py`, no Supabase auth, no RLS. | `backend/database.py:11-29`; `supabase` appears only in comments/migration scripts |
| Firebase | **FCM push only** (`firebase-admin` REST via service account) + `@react-native-firebase/{app,auth,messaging,analytics}` on iOS. Not a datastore. | `backend/push.py`, `mobile/package.json` |
| Web | React 19 + Vite 8 + react-router-dom 7 + TanStack Query 5 + Tailwind 4, on Vercel | `frontend/package.json`, `frontend/vercel.json` |
| Mobile | Expo SDK 57 / React Native 0.86 / expo-router, iOS (TestFlight) | `mobile/package.json`, `mobile/app.json` |
| Shared | `@pressd/shared` npm workspace, consumed **as TS source** (no build step) | `shared/package.json` exports map |
| Transport | Plain REST, JSON, snake_case on the wire → camelCase at the client boundary | `shared/src/api.ts` |
| ML | LightGBM + scikit-learn + Essentia (audio), run in a **separate deployable** | `requirements-worker.txt`, `.github/workflows/nightly-predict.yml` |
| LLM | Anthropic SDK, `claude-haiku-4-5-20251001` by default | `theme_predictor/corpus.py:17` |
| Tests | **None.** No pytest, no vitest, no test dir anywhere. Verification = typecheck + lint + run. | repo-wide |

### Assumptions in the brief that the code does NOT support

- **No PostHog, no Sentry, no UptimeRobot.** Zero occurrences repo-wide. The only
  analytics surface is `@react-native-firebase/analytics` in the mobile bundle.
  There is no "instrumentation subsystem" to audit; whether one is wanted is a
  question, not a finding.
- **No Surprise, no Cornac.** Recommendation is LightGBM + ridge + KMeans, hand-rolled.
- **fanart.tv is not integrated** — it appears once, in a comment explaining why it
  was *rejected* (`backend/routers/util.py:592`).
- **Cover Art Archive is marginal** (4 hits); Deezer (136) and iTunes (52) are the
  real artwork/metadata sources. MusicBrainz (34) is one of three search backends.
- **ChromaDB/Ollama RAG is not in the deployed pipeline.** `theme_predictor/embedder.py`
  and `theme_predictor/run.py` are **untracked by git** (`git ls-files theme_predictor`
  returns 7 of 9 files) and neither `chromadb` nor `ollama` is in any requirements
  file. See QUESTIONS.md Q1.

## Four deployables, one repo

```
repo root
├── backend/          FastAPI web service  ──────────► Render (uvicorn backend.main:app)
├── frontend/         React SPA            ──────────► Vercel
├── mobile/           Expo iOS app         ──────────► TestFlight
├── worker/           nightly ML pipeline  ──────────► GitHub Actions, 02:30 PT
├── shared/           TS source shared by frontend + mobile
├── theme_predictor/  LLM album analysis, imported by worker AND backend
├── corpus/           709 cached per-album LLM analyses (gitignored, local only)
├── chroma_db/        ChromaDB store (gitignored; no live code reads it)
└── *.py at root      song_score_model.py + one-off scripts (see below)
```

## Top-level areas, one line each

| Path | Role | LOC |
|---|---|---|
| `backend/main.py` | App factory: CORS, 14 routers, `init_db()` on startup, `/health` | 45 |
| `backend/database.py` | Engine build (DATABASE_URL or PG_* parts) + **the entire migration system**: a list of idempotent DDL strings run every boot | 190 |
| `backend/models.py` | 22 SQLModel tables | 554 |
| `backend/deps.py` | `current_user`, `viewable_user_id`, `authorize_view`, `are_friends` — the auth invariant | 148 |
| `backend/scoring.py` | Framework 1: per-user album score, z-scored + empirical-Bayes shrunk | 267 |
| `backend/global_rating.py` | Framework 2: userbase-pooled "Press'd rating" | 155 |
| `backend/trackkeys.py` | Normalization keys (`artist_key`, `match_title`, `same_album`) — pure stdlib, imported by web+worker+scripts | 163 |
| `backend/threads.py` | Discussion thread/post plumbing | 267 |
| `backend/push.py` | FCM v1 send via service account | 151 |
| `backend/carryover.py` | Score carryover between album copies | 149 |
| `backend/genres.py`, `genre_classifier.py`, `scraper.py` | Genre taxonomy, Essentia-effnet genre model, HTML scraping | 512 |
| `backend/routers/` | 14 routers, **105 routes** | 5,553 |
| `worker/` | `nightly_predict`, `catalog_predict`, `artist_clusters`, `audio_ingest`, `migrate_tracks`, `backfill_factors`, `runlog` | 1,786 |
| `theme_predictor/` | `predict_single`, `personalize`, `global_factors`, `distinctness_predictor`, `corpus`, `predictor`, `theme_analysis` (+2 untracked) | 2,331 |
| `song_score_model.py` | LightGBM per-song score model, training + inference + `fit_for_user` | 1,211 |
| `shared/src/api.ts` | The single API client. ~170 exported symbols. | 1,880 |
| `frontend/src/` | 14 pages, 15 components | 10,214 |
| `mobile/` | 20 routes, 34 components, 13 lib modules | 17,416 |

## Route surface (105 endpoints)

| Router | Prefix | N | Notes |
|---|---|---|---|
| `albums.py` | `/albums` | 16 | Largest router; import, report, recommend, review, copy |
| `users.py` | `/users` | 23 | Friends, invites, avatars, factor weights, push tokens |
| `stats.py` | `/stats` | 13 | Summary, artist detail, genre/year breakdowns, scatter |
| `discussions.py` | `/threads`,`/posts`,`/discussions` | 11 | Newest subsystem (commit `d8a76fc` era) |
| `util.py` | `/util` | 11 | Backfills, audio analysis, album color, artist image |
| `discover.py` | `/discover` | 6 | New releases, trending, charts, picks, heated |
| `search.py` | `/search` | 5 | iTunes, Deezer, MusicBrainz, popularity, resolve |
| `social.py` | `/social` | 5 | Feed, reviews, top-reviews, compare, like |
| `auth.py` | `/auth` | 4 | Google, Apple, provider link/unlink |
| `songs.py` | `/songs` | 4 | List, ranked, batch-rate, rate |
| `comments.py` | `/albums/{id}/comments` | 3 | |
| `aoty.py` | `/aoty` | 2 | Discogs-backed discography |
| `audio.py` | `/albums/{id}/analyze-audio` | 1 | |
| `public.py` | `/public` | 1 | **The only unauthenticated surface** |

## Python import graph (internal edges only)

Hubs, by in-degree:

```
backend.database    ← 20 modules
backend.models      ← 17
backend.trackkeys   ← 13   (web + worker + theme_predictor + scripts)
backend.scoring     ← 8
song_score_model    ← 6    (incl. backend/routers/albums.py, deferred)
theme_predictor.*   ← 6
```

Two edges that cross the deployable boundary and need scrutiny in Phase 1/3:

```
backend/routers/albums.py:259  →  theme_predictor.predict_single   (deferred, in a thread)
backend/routers/albums.py:357  →  song_score_model                 (deferred, in a thread)
backend/routers/albums.py:316  →  generate_genres_lastfm           (deferred, in a thread)
```

None of these packages is in `requirements.txt`. Each import sits inside a function
body, so the service boots — but the code paths behind them are suspect on Render.

## Frontend route map (`frontend/src/App.tsx`)

```
/                 PublicHome → LandingPage, or redirect to /for-you when signed in
/rate/:id         RatingScreen        (RequireUser, outside the onboarding gate)
/welcome          Onboarding          (RequireUser)
/join             Join                (public, invite acceptance)
/privacy          Privacy             (public — App Store review requires it)
/charts           ChartsRoute → PublicCharts (signed out) | Charts (signed in)
/how-it-works     HowItWorks          (public)
/*                ProtectedRoutes ─ AppGate ─ Layout
                    /for-you /library /ratings /stats /social
                    /u/:userId /album/:id /artist/:name
```

`AppGate` (`App.tsx:44`) blocks the app until the user has ≥1 rated album, skippable
per session via `sessionStorage`.

## Mobile route map (expo-router, `mobile/app/`)

```
_layout.tsx                 root: fonts, auth hydrate, push registration
(tabs)/  index social charts profile
add.tsx  welcome.tsx  sign-in.tsx  first-album.tsx
album/[id]  artist/[name]  friend/[id]  genre/[tag]
rate/[id]   thread/[subject]  splits/[name]
favorite/{album,artist,song}
```

## Environment variables

Backend / worker (`os.getenv`): `DATABASE_URL` *or* `PG_HOST`/`PG_PORT`/`PG_DB`/`PG_USER`/`PG_PASSWORD`,
`JWT_SECRET`, `TOKEN_TTL_DAYS`, `APP_URL`, `ANTHROPIC_API_KEY`, `LASTFM_API_KEY`,
`DISCOGS_TOKEN`, `GENIUS_ACCESS_TOKEN`, `THEME_LLM_MODEL`, `APPLE_BUNDLE_ID`,
`FIREBASE_PROJECT_ID`, `FIREBASE_CREDENTIALS_JSON` | `FIREBASE_CREDENTIALS_FILE`,
`SMTP_HOST/PORT/USER/PASS`, thread caps (`OMP_NUM_THREADS` et al).

Web: `VITE_API_URL`, `VITE_GOOGLE_CLIENT_ID`.
Mobile: `EXPO_PUBLIC_API_URL`, `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID`,
`EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID`, `EXPO_PUBLIC_DEV_TOKEN`.

Local `.env` sets neither `DATABASE_URL` nor `JWT_SECRET` nor `DISCOGS_TOKEN` —
see QUESTIONS.md Q2.

## Audit order (load-bearing first)

1. **Data model + auth + migrations** — `models.py`, `database.py`, `deps.py`, `auth.py`.
   Everything else is downstream of these.
2. **Scoring core** — `scoring.py`, `global_rating.py`, `carryover.py`, `trackkeys.py`.
   The three frameworks; highest blast radius per line.
3. **Rating capture** — `songs.py`, `albums.py` (PATCH/create/import), web `RatingScreen.tsx`,
   mobile `rate/[id].tsx`. The core loop.
4. **Album import + external data** — `search.py`, `albums.py::import_album`, `util.py`
   (album-color, artist-image), `aoty.py`, `discover.py` upstream fetches, `shared/albumSearch.ts`.
5. **Discover / feed / charts** — `discover.py`, `public.py`, `social.py`.
6. **ML pipeline** — `song_score_model.py`, `worker/*`, `theme_predictor/*`.
7. **Claude/LLM path** — `theme_predictor/corpus.py`, `global_factors.py`, `albums.py` LLM calls.
8. **Discussions** — `discussions.py`, `threads.py`, `comments.py`.
9. **Stats** — `stats.py` (1,173 lines, heaviest single router).
10. **Clients** — shared client, web pages, mobile screens, share cards, push.
11. **Cross-cutting**: caching, performance, scale (Phase 3).
