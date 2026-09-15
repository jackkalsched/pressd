# Open questions for Jack

Running log from the codebase audit. Resolved items are kept with what you decided
and what was verified, because the reasoning is the useful part. Open ones are at
the bottom.

---

## Resolved

### U1. `google-auth` missing from `requirements.txt` — **FIXED**
A clean venv installed from `requirements.txt` could not import the app:
`backend/push.py:33` imports `google.auth.transport.requests` at module level, and
`main.py` reaches `push` through `albums`/`users`/`discussions`. Production was only
surviving on a cached Render build layer; the next clean build would have failed.

`push.py`'s docstring claimed google-auth was "already installed, for other Google
APIs" — not true of this tree: `auth.py:66` uses raw `httpx`, and `anthropic` declares
google-auth only under its `vertex` extra.

Added `google-auth==2.48.0` with a comment explaining why it is load-bearing.
Verified: a fresh venv now imports the app.

### Q1. ChromaDB/Ollama theme pipeline — **REMOVED**
You confirmed the Claude pipeline is canonical and the ChromaDB/Ollama RAG was v1.
Verified nothing tracked depended on it, then removed:
- `theme_predictor/run.py`, `theme_predictor/embedder.py` (both were untracked)
- `chroma_db/` (73 MB)
- `POST /util/predict-themes` — the only tracked reference, and it could never have
  executed in production
- `theme_predictor/predictor.py` — the old "predicting a personal music score for
  Jack" prompt. `LLM_MODEL` was rehomed to `theme_analysis.py`, which already defined
  it identically; the two importers were updated.
- `distinctness_predictor.run()` + `normalize_to_jack()` + its `__main__` block — the
  v1 standalone runner that read SQLite directly and pulled RAG examples from
  ChromaDB. `predict_distinctness`, the live function, is untouched.

### Q2. `JWT_SECRET` — **answered from the code, no action taken**
`deps.py:18` is `os.getenv("JWT_SECRET", "dev-insecure-secret-change-me")`. Locally
you get that literal, which is why sign-in works unset. `render.yaml:14` declares
`generateValue: true`, so Render almost certainly has a real one. The risk is that the
failure is **silent** — a missing var in production would boot fine and sign forgeable
tokens. Filed as a §10 note (P12), not a change.

### Q3. Product analytics — **documented as a gap**
Confirmed absent: zero PostHog, Sentry or UptimeRobot. `@react-native-firebase/analytics`
is in `mobile/package.json` but imported nowhere, so it ships unused. `CLAUDE.md` §10
now carries a short "if you add analytics, here are the seams" section.

### Q4. `render.yaml` is stale — **labelled non-authoritative in `CLAUDE.md` §3**

### Q5. Root scripts — **all resolved, all deleted**
- `replay_value_model.py` — you remembered right. Superseded by the artist-cluster
  averaging in `nightly_predict.predict_replay_all`. It also read SQLite against
  `pressd.db`, so it could not write to Postgres at all. **Deleted.**
- `genre_clustering.py` — **deleted.** One stale prose reference survives at
  `backend/routers/stats.py:790`; see Q14.
- root `normalize_genres.py` — **deleted.** `backend/normalize_genres.py` is the real
  one (Postgres engine, canonical maps from `backend/genres.py`); the root copy was
  `sqlite3` with a hand-maintained literal.
- `analyze_missing_audio.py` — **deleted.** The name misled; it was not the audio job.
  `./run_audio_ingest.sh` → `worker/audio_ingest.py` is. The old script covered only
  user 1's `to_listen` albums, wrote the legacy `songaudiofeatures` table rather than
  `trackaudio`, and never called `sync_tracks()` — so its output never reached the
  models. It also ended with `repredict_all_song_means(con)`, defaulting to user 1.
- `run_predictions_bulk.py`, `repredict_song_means.py` — unimported one-offs. **Deleted.**

### Q14. Stale comment in `stats.py` — **FIXED**
`backend/routers/stats.py:790` described `genre_clustering.py` as existing. I deleted
that file, so I fixed the comment: it now says the script was removed, and points at
`worker/artist_clusters.py` as the real global map for anyone who comes looking.

### Q6. Genre classifier weights — **confirmed**
`POST /util/download-models` fetches them at runtime into the gitignored
`backend/models/`. Documented that way.

### Q10. `GET /stats/analysis` — **client wrapper deleted, endpoint kept**
`fetchAnalysis` was called by nothing and is gone. The **backend endpoint remains**,
because removing a route is a product decision rather than a cleanup. It is still an
uncached, untimed, unbounded Claude call in a blocking `def`, reachable for a friend's
library via `viewable_user_id`. See Q15.

### Dead client exports — **removed from `shared/src/api.ts`**
`analyzeAudio`, `deletePost`, `editPost`, `fetchAlbumReport`, `fetchAnalysis`,
`fetchYearByYear`, `rateSong`, `updateFactorWeights`, plus the orphaned types
`AlbumReportSong`, `ArtistStatsSnapshot`, `AlbumReportData`, `YearEntry` (~111 lines).
`setPopularityWeight` removed from `albumSearch.ts` and `POPULARITY_WEIGHT` made `const`.
`backend/reviews.py` (0 bytes, imported by nothing) deleted.

**`frontend/src/components/RatingReport.tsx` (499 lines) deleted** — found during the
double-check. Nothing imported it and it took `AlbumReportData` as a prop, so it died
with its fetcher. See Q15: its backend endpoint is still there.

---

## Open

### Q7. `/util/*` has no auth — 10 endpoints
No router uses `dependencies=`, and no `/util/*` endpoint takes `current_user`.
Sharpest: `POST /util/analyze-song?song_id=&youtube_url=` (`util.py:519`) passes a
caller-supplied URL to `yt-dlp` as argv and writes audio features onto **any**
`song_id`. Also open: `/util/backfill-genres` and `/backfill-genres-mb` (mutate genre
columns catalog-wide from iTunes and MusicBrainz respectively), `/util/analyze-all`,
`/util/download-models`, and the two image proxies. Plus
`POST /aoty/artist/{name}/refresh`, a mutating force-refresh.

Cheapest fix is `dependencies=[Depends(current_user)]` on `util.py:23`. **One caveat:**
three `/util` endpoints are called by clients — `album-color`, `artist-image`,
`backfill-covers` — and two of those call sites use a bare `fetch` with no token
(`frontend/src/components/ShareCard.tsx:35`, `frontend/src/pages/AlbumDetail.tsx:33`).
They must move to `fetchAlbumColor` (which already exists and uses `apiFetch`) in the
same change. **Want me to do that?**

### Q8. Three album-grouping keys disagree
`trackkeys.py`'s header says every cross-user grouping must go through it; the charts
don't.

| Key | Where | Folds "(Deluxe)"? | Folds "Cafuné"→"Cafune"? |
|---|---|---|---|
| `album_key` | `trackkeys.py:61` | no (stored key, must stay stable) | no |
| `subject_key_album` | `trackkeys.py:155` | **yes** | **yes** |
| `record_key` | `global_rating.py:54` | **no** — bare `.strip().lower()` | no |

The raw tuple is inlined again at `discover.py:292`, `:321`, `:423`, `public.py:91`,
`social.py:359`. So **"Take Care" and "Take Care (Deluxe)" are one discussion thread
and two chart rows**, each with a fraction of the raters, while `/discover/heated`
groups correctly on `subject_key`.

**My guess:** the charts predate `subject_key`. Changing `record_key` to
`subject_key_album` would re-rank the boards, so it is your call.

### Q9. Is `PATCH /songs/{song_id}` deliberate?
Its client wrapper `rateSong` was unused and is now deleted, but **I left the endpoint
in place**. It is the only rating path that recomputes an album score inline
(`songs.py:130-151`) and invalidates the global cache (`:154`). `POST /songs/batch-rate`
does neither — safe today only because `updateAlbum` always follows it.

Keep the endpoint for an editing path you plan to wire up, or remove it?

### Q11. Confirm the web service is *meant* not to re-predict
`albums.py:241` fires `_queue_song_repredictions` on every rating. It spawns a thread
that imports `song_score_model`, which imports `sklearn` and `scipy` unguarded at
module level — neither is in `requirements.txt`. So it always raises, and the bare
`except` prints and drops it. `_queue_predictions` guards its import, so its theme and
distinctness stages still run and only the song-model stage no-ops.

**My guess:** intended after the worker split, and the web copy is a leftover. Confirm
and I will document it as designed rather than as a bug — or remove the dead call.

### Q12. Fix the stale `discover.py` docstring?
`discover.py:1-9` says new releases come from ListenBrainz with a Deezer fallback. The
real chain is **AOTY scrape → ListenBrainz → Deezer editorial → Deezer chart → 502**.
One-line fix, but it is application code.

### Q13. Duplicate artist normalizer
`util.py:613` defines a local `_artist_key` doing what `trackkeys.artist_key` does —
strip diacritics, lowercase, `&`→`and` — differing only in also deleting spaces.
Probably deliberate for exact-matching Deezer hits, but undocumented. Intentional?

### Q15. `/albums/{id}/report` is now a dead endpoint
Its only consumer was `RatingReport.tsx`, which I deleted as unreachable. The endpoint
(`albums.py:505-770`, ~265 lines) is substantial and does real work — per-song bang/skip
rates, album rank, a distribution against the owner's library, artist snapshots.

I did **not** delete it, because a finished feature that was simply never mounted is
different from dead code. Was the rating report shelved, or did it get replaced by the
share card? If shelved, say so and I will leave it; if replaced, I will remove the
endpoint too.
