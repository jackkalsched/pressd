# 02 — The three scoring frameworks

Everything numeric routes through `backend/scoring.py` (267 lines) or
`backend/global_rating.py` (155). Conflating them is the documented way to break
the app, and the three use **three different album-grouping keys** (§4).

## Framework 1 — a user's own album score

`compute_album_score` (`scoring.py:182`):

```
composite = 1.00 * mean(song_scores)
          + w_theme        * z(theme)
          + w_replay       * z(replay_value)
          + w_production   * z(production)
          + w_distinctness * z(distinctness)
score     = round(clamp(composite, 1, 10), 4)
```

The song mean carries weight 1.00 and is on the 1–10 scale; the four factors enter as
**z-scores**, so they are bonuses and penalties around the mean, not levels. That is
why the clamp at `:210` exists and why it is load-bearing.

### Weights: a 60-point budget

`FACTOR_KEYS` / `DEFAULT_FACTOR_POINTS` / `TOTAL_FACTOR_POINTS=60` / `MIN_FACTOR_POINTS=5`
(`scoring.py:14-17`). Stored per user as four int columns (`models.py:31-34`).
`weights_from_points` (`:35`) divides by **100, not by 60** — so the defaults
25/15/15/5 reproduce the historical global `WEIGHTS` dict at `:3-9`, and the four
weights sum to 0.60 rather than 1.0. Intentional; the song mean is the level and the
factors are the adjustment.

### Shrinkage — the part that makes thin libraries work

`SHRINKAGE_K = 5` (`:107`), in album-equivalents. `shrink_to_prior` (`:141`):

```
mu  = (n*mu_user + k*mu_global) / (n + k)
var = (n*var_user + k*var_global) / (n + k)
```

At n=0 you get the userbase prior outright; at n=5 an even blend; by n≫5 the user's own
stats. The docstring at `:101-106` records the derivation: variance components implied
k≈3.2, and 5 was chosen to trade a little crowd bias for steadier scores.

Without it, a two-album library has a near-zero standard deviation and every z-score
explodes into the clamp.

`_COLD_PRIOR` (`:110`) is `(5.0, 1.0)` per factor, used only when the **userbase** has
fewer than two complete albums (`:135`).

### Release-length rules

- `EP_MAX_TRACKS = 6` (`:50`) — EPs skip the four factors; score is the raw song mean
  (`:245-247`). Duplicated as `isEP` in both rating screens; the comment says so.
- `SINGLE_MAX_TRACKS = 2` (`:56`), `is_single_release` (`:88`) — track count is the
  test, the `"- Single"` suffix only a supplement. Singles score and count toward the
  user's library, but are kept off userbase-wide boards.
- `BANG_THRESHOLD = 8.0`, `SKIP_THRESHOLD = 6.5` (`:45-46`) — the baseball-style
  per-song stats.
- `compute_a_score` (`:97`) = `(15*score - 14) / 13`, stored on `Song.a_score`.
  A linear rescale; no comment explains the constants. Maps 1→0.077, 10→10.46.

## Framework 2 — the global Press'd rating

`global_rating.compute_global_ratings` (`:59`). Pools **raw inputs**, not finished
scores, because each finished score was z-scored against its own owner's library
(module docstring `:1-19`).

- Songs: mean **per track first** via shared `track_id`, then across tracks (`:112-120`).
  Falls back to `"t:" + lowercased title` when `track_id` is null (`:116`). This is what
  stops a 16-track deluxe outvoting the 15-track standard.
- Factors: mean across copies carrying a **complete** set (`:123-127`).
- Z-scored against `get_global_factor_stats` with the **default** `WEIGHTS` (`:128-133`).
- No complete copy → fall back to the song mean (`:134-138`), mirroring the EP rule.
- `track_count` = the **longest** copy (`:142`); `is_single` requires **all** copies to
  look like singles (`:143-145`).

### Caching

`_CACHE_TTL_S = 60.0`, a module-level dict `_cache` (`:45-46`). `invalidate_cache()`
(`:49`) is called from `songs.py:154`, `albums.py` (several places), and elsewhere.

**Gotcha:** this is **per-process in-memory**. With more than one uvicorn worker or
more than one Render instance, `invalidate_cache()` clears one process's copy and the
others keep serving a stale board for up to 60s. Fine today; it is a correctness cliff
the moment the service scales horizontally.

## Framework 3 — predictions

Lives in the worker, not here, but composes through `compute_album_score` so a
prediction and its outcome sit on one formula (`worker/catalog_predict.py:167`,
`worker/nightly_predict.py:351`). See `docs/codebase-notes/06-ml-pipeline.md`.

## §4 — Three album-grouping keys, and they disagree

This is the most consequential inconsistency I found.

| Key | Defined | Folds editions? | Folds diacritics? | Used by |
|---|---|---|---|---|
| `album_key(artist, name)` | `trackkeys.py:61` | **no** | no | `AlbumCorpus`, `AlbumFactors`, `AlbumPrediction` — stored, must stay byte-stable |
| `subject_key_album(...)` | `trackkeys.py:155` | **yes** (`_clean_album`) | **yes** (`artist_key`) | `Album.subject_key`, all discussion threads |
| `record_key(name, artist)` | `global_rating.py:54` | **no** — bare `.strip().lower()` | no | the global rating, and every chart |

`trackkeys.py`'s own header says "Any grouping across users must go through them", and
the root `CLAUDE.md` repeats it. `record_key` does not: it is
`(album_name.strip().lower(), artist.strip().lower())`.

The same raw-tuple grouping is inlined, not imported, in four more places:

- `discover.py:292`, `:321`, `:423` (trending, charts)
- `public.py:91` (marketing charts)
- `discover.py:68`, `:161` (new releases, on external titles)

**Consequence:** "Take Care" and "Take Care (Deluxe)" are **one** discussion thread and
**two** chart entries, each with a fraction of the raters. "Cafuné" and "Cafune" split
the same way. `/discover/heated` (`discover.py:611-631`) correctly groups on
`subject_key`, so the divisive rail and the charts disagree with each other.

QUESTIONS Q8.

## §5 — `recompute_all_scores` is on the rating hot path

`albums.py:237`:

```python
if any(k in data for k in ("theme","replay_value","production","distinctness","status")):
    recompute_all_scores(session)
```

`recompute_all_scores` (`scoring.py:256`) loops **every `PressUser` in the database**
and calls `recompute_user_scores`, which per user runs:

1. `_fetch_factor_values(session, user_id)` — `SELECT *` over that user's rated albums
   (`scoring.py:118-128`, full ORM rows including the `review` and
   `predicted_theme_reasoning` TEXT columns, to read four floats).
2. a second query for that user's rated albums with `selectinload(Album.songs)`
   (`:225-230`).

Plus one full-table `get_global_factor_stats` scan up front (`:262`), which is itself a
`SELECT *` over every rated album in the userbase.

So **finishing one album rating rescores the entire userbase's library**: roughly
`2N + 1` queries for N users, and it loads every rated album and every song row into
Python. It then `session.commit()`s all of it inside the request.

Current behavior is correct — a change to the global prior genuinely does move
everyone's scores. But the cost is O(total corpus) per rating, paid synchronously by
the person who just finished listening to a record. This is the single clearest
scaling wall in the codebase. See `docs/codebase-notes/10-performance.md`.

## §6 — Two rating write paths, only one of which scores

| Path | Recomputes album score? | Invalidates global cache? |
|---|---|---|
| `PATCH /songs/{song_id}` (`songs.py:106`) | yes, for that album (`:130-151`) | yes (`:154`) |
| `POST /songs/batch-rate` (`songs.py:83`) | **no** | **no** |

Every client uses `batch-rate` then `PATCH /albums/{id}`, so the album score does get
written — by `recompute_all_scores`. The single-song path is reachable from
`shared/src/api.ts:231` (`rateSong`) but **no client calls it**; grep across
`frontend/` and `mobile/` returns only the definition. Likely dead. QUESTIONS Q9.
