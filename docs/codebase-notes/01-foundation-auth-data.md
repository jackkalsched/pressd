# 01 — Data model, auth, migrations

## `backend/models.py` — 22 tables

Grouped by what they are for:

**Identity / social** — `PressUser` (`:9`), `Invite` (`:39`), `Friendship` (`:49`),
`UserAvatar` (`:61`), `PushToken` (`:436`).
**Library** — `Album` (`:78`), `Song` (`:175`), `Like` (`:234`), `Comment` (`:410`).
**Global (user-agnostic) layer** — `Track` (`:243`), `TrackAudio` (`:255`),
`AlbumCorpus` (`:280`), `AlbumFactors` (`:289`), `ArtistCluster` (`:376`), `ArtistMeta` (`:422`).
**Per-user derived** — `AlbumPrediction` (`:327`), `SongAudioFeatures` (`:199`).
**Discussions** — `Thread` (`:460`), `Post` (`:491`), `PostLike` (`:523`), `PostReport` (`:544`).
**Ops** — `WorkerRun` (`:399`).

### The shape that matters

`Album` is a **per-user copy**, not a record. `user_id` (`models.py:82`) makes every
row somebody's. Two users who rate the same album have two `Album` rows with two
scores. Everything "global" therefore has to pool copies, and the key it pools on is
where the bugs live (see §3 below).

`Song` hangs off `Album` but carries `track_id` (`models.py:194`) pointing at the
global `Track`. Audio is analyzed once per `Track` and shared
(`models.py:244-246`). That split is the whole reason the ML worker is affordable.

### Mapper event: `subject_key` is maintained automatically

`models.py:158-172` — a `before_insert`/`before_update` listener recomputes
`Album.subject_key` from artist + name on every write. Deliberate, and the docstring
says why: albums are built in four places and `PATCH /albums/{id}` writes arbitrary
fields through `setattr`, so any explicit call site would rot.

**Gotcha:** this fires on *every* album update, including bulk rescores. It is pure
string work so it is cheap, but it means you cannot set `subject_key` by hand.

### Deliberate non-foreign-keys

`favorite_album_id`, `favorite_song_id` (`:20-21`) and `top_song_id` (`:134`) are plain
ints, validated on read. The rationale is stated at `:18-19`: a deleted album should
blank the pick, not block the delete. `pick_top_song` (`scoring.py:70`) implements the
read-side validation.

## `backend/database.py` — engine + the migration system

- `_build_engine` (`:10`): `DATABASE_URL` wins; otherwise assembled from `PG_*`.
  Pool is `pool_size=5, max_overflow=10, pool_pre_ping=True` (`:28`). **15 connections
  max per process** — and `worker/backfill_factors.py:35` notes Supabase's session
  pooler allows 15 across the whole project.
- `init_db` (`:47`): `create_all`, then seeds user id 1 ("Jack"), then runs
  **~90 idempotent DDL/DML statements** (`:66-186`) on every boot.
- `_exec_migration` (`:33`): swallows "already exists" / "duplicate column", prints
  anything else. Drift is logged, not raised.

**Gotchas:**
1. There is no Alembic and no version table. Adding a column = a SQLModel field **and**
   an `ALTER TABLE` string appended to that list.
2. Several statements are one-shot `UPDATE`s that re-run every boot
   (`:84` `UPDATE album SET user_id = 1 WHERE user_id IS NULL`,
   `:116-119` factor-point backfills, `:181` `UPDATE postlike SET value = 1 ...`).
   Harmless on small data, but they are full-table writes on every cold start.
3. Three `DELETE` statements run on every boot (`:88-91`), including
   `DELETE FROM "like" WHERE album_id NOT IN (SELECT id FROM album)`.
4. ~90 sequential round trips to a remote pooler is a measurable cold-start cost.

## `backend/deps.py` — the auth invariant

| Function | Line | What it guarantees |
|---|---|---|
| `create_access_token` | `:25` | HS256 JWT, `sub` = user id, `exp` = now + `TOKEN_TTL_DAYS` (default 7) |
| `current_user` | `:44` | 401 unless a valid bearer token resolves to a live `PressUser` |
| `optional_user` | `:62` | same, returns `None` instead of raising |
| `are_friends` | `:79` | **accepted** friendships only; pending grants nothing (`:83-89`) |
| `authorize_view` | `:93` | 403 unless target is self or an accepted friend |
| `viewable_user_id` | `:99` | resolves `?user_id=` into a target, running `authorize_view` |
| `thread_access` | `:121` | non-raising: you may read an album thread only if **you have rated that album** (`:133-136`) |
| `authorize_thread` | `:141` | raising form |

`thread_access` returns `(False, "unknown_subject")` for `artist` and `track` subject
types (`:138`) — only album threads are reachable today, consistent with the commits
that removed artist and track threads (`d761fa1`, `06a06b8`).

### `JWT_SECRET` has an insecure default

`deps.py:18`: `os.getenv("JWT_SECRET", "dev-insecure-secret-change-me")`.

There is no startup assertion. If the Render service is ever missing the var, the
service boots happily and signs tokens with a secret that is public in this repo —
anyone could mint a token for `sub: 1`. `render.yaml:14` declares
`generateValue: true`, so production is probably fine, but the failure is silent
either way. See QUESTIONS Q2/Q7.

## `backend/routers/auth.py` — Google + Apple sign-in

Both providers follow the same four-step ladder:
1. `link=true` → `_link_provider` (`:24`), which takes the caller from the **bearer
   token**, never the body (`:31-37`), and 409s if that identity belongs elsewhere.
2. Existing account by provider sub.
3. Match by email — **only if verified** (`:112`, `:176`). Google: `email_verified`.
   Apple: the string `"true"` (`:161`, Apple sends a string not a bool) and **not** a
   Hide-My-Email relay (`:164`).
4. Create, with `_unique_name` (`:57`) resolving name collisions by suffix.

Apple tokens are verified against Apple's JWKS with audience `APPLE_BUNDLE_ID`
(`:20-21`, `:147-154`). Google's access token is exchanged at the userinfo endpoint
(`:65`) — a network call on the sign-in path with a 10s timeout.

`unlink_provider` (`:207`) refuses to remove the last provider (`:219-224`) — there is
no password fallback.

**Gotcha:** `_apple_jwks = PyJWKClient(...)` is a module-level singleton (`:21`). It
caches Apple's keys in-process, which is what you want, but it is constructed at import
time so a network failure there is deferred to first use.

## Auth coverage audit — 18 unauthenticated endpoints

Generated by parsing every `@router.*` decorator and its signature + body for a guard.
No router is registered with router-level `dependencies=` (`main.py:27-40`,
and every `APIRouter(...)` call takes only `prefix`/`tags`), so the per-endpoint
picture is the whole picture.

| Endpoint | Why it is probably fine | Why it might not be |
|---|---|---|
| `GET /public/charts` | by design; aggregates only | — |
| `POST /users/` | account creation | no rate limit, no invite requirement |
| `GET /users/invite/{token}` | token *is* the credential | — |
| `GET /users/{user_id}/avatar` | served into `<img src>`, can't set headers | leaks avatar bytes by enumerating ids |
| `GET /search/{itunes,deezer,mb}`, `POST /search/popularity`, `GET /search/resolve` | needed before sign-up? | **open proxy** onto four upstreams under Press'd's IP and keys |
| `GET /aoty/artist/{name}`, `POST .../refresh` | — | Discogs proxy + **mutating** force-refresh, unauthenticated |
| **all 11 `/util/*`** | — | see below |

### `/util/*` is an unauthenticated admin console

This is the finding with the sharpest edge. `backend/routers/util.py` registers 11
routes and **not one takes `current_user`**:

- `POST /util/analyze-song?song_id=&youtube_url=` (`util.py:519`) hands a caller-supplied
  URL straight to `yt-dlp` as argv (`:534-538`), then **writes audio features onto any
  `song_id`** (`:546-559`). Unauthenticated SSRF plus arbitrary row mutation. No shell,
  so not direct RCE, but yt-dlp accepts many URL schemes.
- `POST /util/analyze-all` (`:471`) kicks off a bulk background job over every album with
  a given status; `.../abort` and `.../status` are equally open.
- `POST /util/backfill-genres` (`:118`) and `/backfill-genres-mb` (`:215`) mutate genre
  columns across the catalog and call the Anthropic API — **billable, by anyone**.
- `POST /util/download-models` (`:265`) triggers a multi-megabyte download.
- `GET /util/album-color` (`:591`) and `/util/artist-image` (`:682`) proxy image fetches.

The root `CLAUDE.md` asserts "`routers/public.py` is the only unauthenticated surface."
That is not true of this tree. QUESTIONS Q7.
