# 03 — External data, search, and fallback chains

## Sources actually integrated

| Source | Used for | Where | Key? | Cache |
|---|---|---|---|---|
| **iTunes** | album search, tracklist resolve, cover art | `search.py:69`, `:411` | none | in-proc 600s |
| **Deezer** | album search, tracklist resolve, cover art, **artist photos**, new-release resolution, editorial fallback | `search.py:135`, `:329`; `util.py:620`; `discover.py` | none | in-proc + `ArtistMeta` |
| **MusicBrainz** | album search (release *groups*), tracklist resolve, upcoming releases | `search.py:172`, `:329` | none, UA required | in-proc 600s |
| **Cover Art Archive** | covers for MusicBrainz hits only | `search.py:66`, `:213`, `:373` | none | via MB result |
| **Last.fm** | album listener counts → search popularity prior; genre tags | `search.py:400`; `generate_genres_lastfm.py` | `LASTFM_API_KEY` | in-proc 600s |
| **ListenBrainz** | fresh-releases feed (2nd choice) | `discover.py:30`, `:49` | none, UA required | 6h in-proc |
| **albumoftheyear.org** | **primary** new-release feed, scraped | `aoty_releases.py`, `discover.py:113` | none | 6h in-proc |
| **Discogs** | artist discographies | `routers/aoty.py` | `DISCOGS_TOKEN` | `ArtistMeta.albums_json` |
| **Anthropic** | theme axes, distinctness, genre tagging | see `07-llm.md` | `ANTHROPIC_API_KEY` | `albumfactors`, `corpus/` |
| **Google / Apple** | sign-in verification | `auth.py:65`, `:147` | client ids | Apple JWKS in-proc |
| **Firebase FCM** | push | `push.py` | service account | credentials cached |

**Not integrated, contrary to the brief:** fanart.tv (mentioned once, in a comment
explaining its *rejection*, `util.py:592`), Spotify (deliberately removed — see the
`search.py:16-20` postmortem: the client-credentials app was 429ing with
`Retry-After: 86400`, and **zero of 819 albums ever carried a Spotify id**, yet the
model columns `Album.spotify_id` / `Song.spotify_id` survive as dead fields).

## Search: the two-phase split

`search.py`'s module docstring (`:1-20`) records the design and the reason. Phase 1
(`/search/{itunes,deezer,mb}`) returns **identity only** — one HTTP call per source.
Phase 2 (`/search/resolve`) fetches the tracklist for the one album picked.

Before the split, each source fetched a tracklist for all 5–8 of its results *per
keystroke* — ~7 sequential calls per source — which made Deezer ~2s and MusicBrainz
10–18s in production.

Two exceptions that still cost per-result calls:
- `_deezer_fill_dates` (`search.py:102`): Deezer's search payload has no release date,
  so one `GET /album/{id}` per result, **concurrently**, memoized per album id.
- MusicBrainz covers (`:213`): one concurrent CAA `HEAD` per result. Different host,
  so MB's ~1 req/s courtesy limit doesn't apply.

`_resolve_mb` sleeps `0.25s` (`:355`) before its second MB call, explicitly to respect
that limit.

## The ranker — `shared/src/albumSearch.ts`

Runs **client-side**. Each source orders results its own way and the orders aren't
comparable, so everything is rescored against the query (`:133-154`):

```
score = 3.0 * titleScore
      + 2.0 * artistScore
      + 2.0 * popularityScore(log10(listeners+1)/7)
      + SOURCE_TRUST[source] / (1 + rank)     deezer 1.4, itunes 0.9, mb 0.7
      + 0.15  if it has a cover
      + 0.35  if the normalized title matches exactly
      + 0.25 * (cross-source agreement - 1)
      - 0.60  if "- Single"/"- EP" and the query didn't ask
      - 0.40  if the artist is "Various Artists"
```

The popularity prior exists for one failure case, documented at `:108-111`: the band
"Rumours" scores a perfect title *and* artist match against the query *Rumours*,
beating Fleetwood Mac's. Listener counts separate them by four orders of magnitude.

`mergeAndRankWithPopularity` (`:228`) ranks once on text, fetches Last.fm counts only
for the survivors (bounded, `MAX_POPULARITY_ITEMS = 12` server-side at
`search.py:402`), then re-ranks. A failed lookup returns the text-only ranking.

**Dead export:** `setPopularityWeight` (`:115`) is documented as "a test seam for
tuning the weight against recorded search fixtures." There are no tests and no
fixtures.

## New releases — a four-deep fallback chain

`GET /discover/new-releases` (`discover.py:173`). **The module docstring at `:1-9` is
stale** — it describes ListenBrainz as primary. The real order:

```
1. AOTY this-week scrape        discover.py:113 → aoty_releases.parse_releases
   └─ ranked by how many people rated each release (a per-record popularity
      signal neither other source has). Deezer is then called once per candidate
      (limit+12, concurrent, semaphore 10) purely to resolve an importable id.
2. ListenBrainz fresh-releases  discover.py:49, days=7
   └─ sampled evenly down to POOL=24 to stay under Deezer's ~50-per-5s quota,
      resolved through Deezer, ranked by the artist's total Deezer fan count.
3. Deezer /editorial/0/releases discover.py:148
4. Deezer /chart/0/albums       discover.py:152
5. HTTP 502
```

Anything that won't resolve to a Deezer id is **dropped**, not shown — a release with
no tracklist is a dead end (`:207-209`).

**Cold-cache cost:** roughly 25 outbound HTTP calls inside a single user request, under
a 20s client timeout. TTL is `6 * 3600` (`:32`), in-process, and empty results are
never cached (`:254`). **There is no lock**, so N concurrent requests on an expired
cache each do the full cold fetch.

## Artist photos — Deezer only, and why

`util.py:589-689`. The comment block at `:589-603` is worth reading in full: it names
four Deezer behaviours that each silently return the wrong artist.

1. Imposter rows share the exact name with few fans and no photo → pick `max(nb_fan)`
   among exact key matches (`:673`).
2. "No picture" is served as a real URL whose md5 segment is that of the empty string
   → `DEEZER_NO_IMAGE = "d41d8cd98f00b204e9800998ecf8427e"` (`:632`, checked `:675`).
3. Rate limiting is **HTTP 200 with an error body** → 3 attempts with 1.5s/3s/4.5s
   backoff (`:648-662`), because treating it as a miss would cache an empty result for
   a month.
4. Punctuation suppresses hits ("J.I.D." finds nothing, "JID" finds them) → the query
   is stripped of punctuation but the **match** keeps it (`:646`).

Cached on `ArtistMeta.image_url` with `ARTIST_IMAGE_TTL = 30 days` (`:634`), re-checked
only on a miss. A network exception leaves the cache untouched so the next request
retries (`:702-705`).

**There is no fallback chain** — no fanart.tv, no Wikidata, no MusicBrainz. The
rationale (`:616-617`): Deezer covers ~99% of the library's artists.

**Duplicate normalizer:** `util.py:613` defines a local `_artist_key` that does what
`trackkeys.artist_key` (`trackkeys.py:35`) does, differing only in also deleting
spaces. Undocumented. QUESTIONS Q13.

## Album import

`POST /albums/import` (`albums.py:366`).

1. Dedup: by `spotify_id` if present (always null in practice), else
   `_find_users_copy` on name+artist scoped to the user.
2. If found → `_return_existing` (`:373`), which **only backfills a missing cover**
   and returns `already_existed: True`. **It never reconciles the tracklist.** This is
   the known limitation: when an upstream catalog corrects a tracklist, the user's only
   recourse is delete-and-re-add, losing their ratings.
3. Else insert `Album` + `Song` rows, then `_link_tracks` (`:468`).

`_link_tracks` resolves each song to a global `Track` by `track_key`. Notable: when two
recordings share a normalized name but differ in duration by **>10s**, the key gets a
`||d{seconds}` suffix (`:481-485`) — that is how covers and remakes stay distinct.

**N+1:** the loop does 2–3 queries *per song* (`:477-493`). A 15-track import is ~35
sequential round trips to Supabase. Never fails the import — the worker's
`sync_tracks()` is the backstop (`:470`).

## MBID normalization

Contrary to the brief, MBIDs are **not** a spine through the system. `mb_id` is carried
on a MusicBrainz search result and dropped at import — there is no `mb_id` column on
`Album`. Only `ArtistMeta.mb_artist_id` persists one. Dedup across users runs on the
string normalizers in `trackkeys.py`, not on MBIDs. `Album.release_date` is the one
field MB genuinely contributes that the others don't (announced-but-unreleased albums,
flagged `upcoming`, `search.py:183-186`).
