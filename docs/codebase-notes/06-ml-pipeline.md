# 06 — The ML pipeline

Governing rule, from `worker/nightly_predict.py:4-6`:

> Every stage that **measures an album** is shared across the userbase and paid for
> once; every stage that **decides what a person thinks of it** is fitted per user.

Runs on GitHub Actions at 09:30 UTC / 02:30 PT (`nightly-predict.yml:10`), Python 3.12,
120-minute timeout, with `DATABASE_URL`, `ANTHROPIC_API_KEY`, `LASTFM_API_KEY`.

## Eligibility gates

| Constant | Value | Where | Meaning |
|---|---|---|---|
| `MIN_RATED_ALBUMS` | 10 | `nightly_predict.py:62` | below this a user gets **nothing** |
| `MIN_RATED_SONGS_FOR_ML` | 1300 | `:64` | reporting only now |
| `FULL_PERSONAL_SONGS` | 1300 | `song_score_model.py:1001` | personal model stands alone |
| `MIN_SONGS_TO_POOL` | 20 | `song_score_model.py:133` | |
| `MIN_ALBUMS_FOR_THEME_RIDGE` | 12 | `personalize.py:67` | |
| `MIN_ALBUMS_FOR_RECAL` | 2 | `personalize.py:53` | |

The comment at `nightly_predict.py:44-61` records the history: the gate was 50 (one user
in twenty got a prediction), then 1 (predictions for anyone). 10 is where "enough of
their own signal survives the blend to be worth showing" — below it the blend is almost
entirely pooled, and while the userbase is small the pool is largely one person's taste,
so the output reads as "a stranger's opinion wearing the user's name."

## Run structure

`main()` (`:377`) builds everything userbase-wide **once**, then loops users:

```
ArtistClusters.fit(con) ──► persist(con)
fit_pooled_model(con, clusters)
catalog_albums(con)
album_frames(con, ...)
_features_by_key(con)          # the semantic theme axes
fit_pooled_theme_model(con, features)
        │
        └─► for each user: run_user(...)
```

`run_user` (`:249`) opens a **fresh connection per stage** — deliberate, because a
nightly run outlasts the Supabase pooler's idle timeout (`:250-251`).

### Skip logic
1. `rated_albums < 10` → `below_threshold`, **returns before syncing**. The comment at
   `:388-391` flags this: a sub-threshold user gets nothing at all, including a sync of
   predictions the catalog may already hold for them.
2. `sync_predictions_to_albums` (`:98`) copies catalog predictions onto the user's
   album rows. Runs even on a skipped night, which is what lets a newly queued album
   show a prediction without refitting.
3. Counts unchanged since the last `ok` run (read back out of `workerrun.detail_json`,
   `:78`) → skip. `--force` overrides.

## Stage 1 — the song model (`song_score_model.py`, 1,211 lines)

Features (`:261-272`):
- `AUDIO_FEATURES` — Essentia: bpm, key strength, chord change rate, loudness,
  dynamic complexity, danceability, energy, dissonance, spectral centroid, onset
  rate, LUFS, and 13 mean MFCCs expanded to columns (`expand_mfcc:200`).
- `TASTE_FEATURES` — `loo_artist_mean`, `similar_artist_mean`,
  `similar_album_song_mean`. **Leave-one-out** by construction, which is what stops
  the target leaking into its own feature.

Clustering inside the model: `ARTIST_K = 12`, `ALBUM_K = 55`, `N_CLUSTER_SEEDS = 10`
(`:278-280`). ⚠️ **Not the same `ARTIST_K` as `worker/artist_clusters.ARTIST_K = 18`** —
two constants, same name, different clusterings, different purposes.

Model selection is a fallback ladder, not a search: LightGBM → XGBoost → RandomForest,
first one that fits wins (`:958-967`).

### `fit_for_user` — the cold-start ramp (`:1004`)

```
n = rated songs with analyzed audio
n >= 20    → fit a personal model
n >= 1300  → return it alone                                 source "personal"
n < 20     → CalibratedModel(pooled, mu, sd)                  source "pooled"
otherwise  → BlendedModel(personal, calibrated, n/1300)       source "blend(0.42 personal)"
```

Three classes (`:837`, `:878`, `:910`) all answer `predict_frame`, so callers never
branch. The pooled model trains on **per-user z-scores** (`load_pooled_data:141`), so
`CalibratedModel.predict_frame` maps back with `* sd + mu` (`:901`).

**The `scale` trap** (`:843-849`): a model fit on one user holds raw 1–10 ratings; the
pooled model holds z-scores. `raw_frame` returns `None` for the pooled and calibrated
variants so nothing reads `replay_value` or `theme` off a z-scored frame. The docstring
says a z-scored replay read as a 1–10 value "lands near the bottom of the clamp for
almost every album."

**Ordering hazard, already fixed** (`:858-861`): albums are placed per-model but artists
are placed once on the shared map, because otherwise re-running with the user list
reversed produced different predictions.

No model cache on disk (`:833-835`): the worker retrains per user per run (~1–2 min),
so per-user `.pkl` files and staleness keys buy nothing. The committed
`song_score_model.pkl` at the repo root is gitignored and not loaded by the worker.

## Stage 2 — global album analysis (LLM). See `07-llm.md`.

## Stage 3 — per-user factors (`theme_predictor/personalize.py`, 485 lines)

**Pure stdlib, including the ridge solver** (`:37-39`) — because the *web service*
imports this via `predict_single`, and its `requirements.txt` carries no numpy or
scikit-learn. That constraint is load-bearing; don't add numpy here.

```
theme = w * personal_ridge(axes) + (1 - w) * pooled_ridge(axes) → user scale
w     = n / (n + THEME_BLEND_K),  THEME_BLEND_K = 25.0     (:62)
RIDGE_LAMBDA = 25.0                                        (:59)
```

`RIDGE_LAMBDA`'s docstring (`:55-58`) is the clearest statement of intent in the repo:
with standardised features, `(X'X + λI)⁻¹X'y` shrinks by roughly `n/(n+λ)`, so λ reads
as "how many albums of evidence before the user's own coefficients outweigh the
assumption that they are zero." Deliberately the same scale as `THEME_BLEND_K`.

**Layer 1** (`recalibrate:139`) is the shared foundation: z-score against the global
distribution, map onto the user's `(mu, sd)`. It recovers the bulk of between-user
variance — one user averages 4.98 on theme and another 8.35.

**Distinctness gets Layer 1 and nothing else** (`:25-30`): it correlates with the album
score at 0.36 where theme reaches 0.69, and carries weight 0.05 against theme's 0.25,
so a fitted per-user model would move a composite by hundredths.

`GLOBAL_REF_MU = 5.0`, `GLOBAL_REF_SD = 1.7` (`:48-49`) are an **arbitrary internal
reference scale**. Layer 1 z-scores them away immediately, so only relative ordering
and spread carry meaning. Don't read a stored `theme_raw` as a 1–10 score.

## Stage 4 — replay via the global artist map (`worker/artist_clusters.py`)

```
replay = 0.5 * (user's own mean for that artist)
       + 0.5 * (user's mean over that artist's cluster-mates)
```
`nightly_predict.py:181-247`. Fallback chain: own alone → cluster alone → their genre
mean → their overall mean.

`ARTIST_K = 18`, ~20 artists per cluster over a 372-artist universe (`:42`).
`MATE_PRIOR = 3.0` (`:47`) — rated cluster-mates needed before the user's own mean
outweighs the calibrated global figure; the handover is a **shrink, not a cliff**,
because one mate is a single album's opinion.

**The matrix contains no scores, no ratings, no user ids** (`:5-7`) — audio centroid,
genre one-hot, subgenre multi-hot. Membership cannot depend on anyone having rated the
artist, since that gate would exclude exactly the artists the feature exists for.

`replay_tier` on `AlbumPrediction` records which tier answered: `mates` | `global` |
`own` | `genre`. A `global`-tier value is a much weaker claim and the UI should be able
to tell them apart (`models.py:364-369`).

`ArtistCluster` the table is **write-only** (`models.py:378-382`): the map is refit in
memory every run and never loaded from there. It exists so the clustering can be
inspected and diffed without a 1–2 minute refit.

## Stage 5 — composite

Via `backend.scoring.compute_album_score` — the same function that scores a *rated*
album, so a prediction and its eventual outcome sit on one formula
(`catalog_predict.py:167`, `nightly_predict.py:351`).

## Stage 6 — catalog-wide (`worker/catalog_predict.py`)

Scores **every album anyone has added** into `albumprediction`, keyed
`(user_id, album_key)`. This is what lets `/discover/picks` recommend a record the user
has never heard of. `already_rated` is kept rather than skipped so predictions can be
scored against outcomes (`models.py:370-372`).

Deliberately **not** a fourth `album.status` (`models.py:337-341`): charts, trending,
stats and the global rating all filter on status, several with `status IN (...)` lists
that would silently absorb prediction rows.

## Audio ingest — phase A, Mac-only

`worker/audio_ingest.py`, run by `./run_audio_ingest.sh`. yt-dlp is bot-blocked from
datacenter IPs, so it cannot run in CI (`nightly-predict.yml:4-6`). Writes `TrackAudio`
keyed on the global `Track`, `source='yt_full'`.

⚠️ `TrackAudio.source` (`models.py:261`): **never mix `yt_full` and `preview_30s` between
training and prediction** — 30s-preview features shift relative to full tracks.

`analyze_missing_audio.py` at the repo root is the superseded predecessor: user 1 only,
`to_listen` only, writes the legacy per-copy `songaudiofeatures` table rather than
`trackaudio`, and never calls `sync_tracks()`, so its output does not reach the models.

## Complexity

| Stage | Cost | Batch or live |
|---|---|---|
| `ArtistClusters.fit` | KMeans × 10 seeds over ~372 artists | nightly, once |
| `fit_pooled_model` | one LightGBM over all users' songs | nightly, once |
| `fit_user_model` | one LightGBM per user, ~1–2 min | nightly, per user |
| theme ridge | closed-form, pure Python, 5 axes | nightly, per user |
| `catalog_predict` | frame predict over the whole catalog | nightly, per user |
| taste overlap (`/social/compare`) | **live**, O(friends × their rated albums) | per request, uncached |

The taste-overlap computation the brief worried about is **not** O(n²) across the
userbase — it is scoped to the caller's accepted friends (`social.py:339-356`). But it
is recomputed live on every Social tab open, loading full `Album` ORM rows including
`review` TEXT.
