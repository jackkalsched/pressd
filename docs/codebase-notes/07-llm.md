# 07 — The Claude integration

There is **no vector RAG in the deployed pipeline.** The ChromaDB + Ollama
(`nomic-embed-text`) retrieval in `theme_predictor/embedder.py` was v1; that file and
`theme_predictor/run.py` are **untracked by git** and neither `chromadb` nor `ollama`
is in any requirements file. Confirmed with Jack: the Claude pipeline is canonical.

What "RAG" means here now is **few-shot retrieval from the user's own ratings**, not
embedding search — `_anchor_examples` picks rated albums spanning the score range.

## Four call sites

| # | Where | Model | Path | Cached? |
|---|---|---|---|---|
| 1 | `theme_analysis.analyze_theme:141` | `claude-haiku-4-5-20251001` | nightly worker | **yes** — `albumfactors`, once per album ever |
| 2 | `distinctness_predictor.predict_distinctness` | same | nightly worker | **yes** — same row |
| 3 | `albums.py:_classify_genre_claude:271` | hard-coded `claude-haiku-4-5-20251001` | **web**, background thread, on import | no, but once per album row |
| 4 | `stats.py:analysis:1138` | hard-coded `claude-haiku-4-5-20251001` | **web, synchronous** | **no** |

`LLM_MODEL` is `os.environ.get("THEME_LLM_MODEL", "claude-haiku-4-5-20251001")`, defined
**twice** — `theme_analysis.py:23` and `predictor.py:11`. Sites 3 and 4 ignore the env
var and hard-code the id.

## The design: measure the record once, fit the listener separately

`global_factors.py:1-22` and `theme_analysis.py:1-15` carry the rationale.

The old approach asked Claude *"what would Jack score this?"* — with Jack's baseline
and Jack's penalty table in the prompt, **for every user in the system**. That prompt
is still in the tree at `predictor.py:14-91` and is called from nowhere.

The replacement asks *"what is actually true about this record?"* and produces five
axes, each 1–10 (`theme_analysis.py:48-54`):

```
narrative_arc          tracklist moves through a story or progression
concept_unity          one unifying idea genuinely carried across tracks
emotional_throughline  coherent emotional register or journey
sequencing_intent      ordering, interludes, bookends as craft
lyrical_depth          substance of the writing being carried
```

⚠️ **This tuple is the feature vector's column order.** `personalize` depends on it
being stable. Append at the end; never reorder; never remove one without re-analysing
every album and refitting every model (`:25-27`).

The axis selection is empirically justified at `:33-47` — leave-one-out MAE over 47 of
user 1's rated albums:

| Feature set | MAE |
|---|---|
| predict-the-mean | 2.207 |
| the four cohesion axes | 2.107 |
| + `lyrical_depth` | **1.965** |
| greedy pick over all ten | 1.874 |
| all ten | 2.030 |

The greedy pick fits better but drifts toward writing quality and reach — things that
predict an album *score* rather than isolate a theme — and was chosen and scored on the
same 47 points. ~0.09 MAE was given up deliberately to keep the factor meaning what it
says.

Why axes and not one number (`:10-15`): a single 1–10 theme score is a projection of
several independent things. A tight concept with thin writing and a sprawling record
with extraordinary writing land on the same number for opposite reasons, and two users
who disagree about which they prefer cannot both be served by it.

## Cost and latency posture

- `temperature=0.0` for theme (`:155`) — "a measurement should be reproducible."
- `max_tokens=900` theme, `600` legacy theme, `120` genre, `500` insights.
- **One call per album, ever.** `ensure_global_factors` (`:119`) is idempotent and safe
  to call on every add; the second caller for a given album pays nothing (`:125-127`).
  `albums_missing_factors` (`:247`) collapses copies — that collapse is the saving.
- Prompt input is bounded: the corpus analysis is truncated to **1400 chars**
  (`theme_analysis.py:89`), RAG examples to **600 chars** each (`predictor.py:70`).
- Two-layer cache: `AlbumCorpus` (DB) and `corpus/*.json` on disk (709 files locally,
  gitignored).

### Connection discipline

`analyze_album` (`:182`) exists solely so a bulk run holds a DB connection for the
millisecond of the write instead of the ten seconds of the API calls. The docstring at
`:188-192` explains why this matters more than it looks: **Supabase's session-mode
pooler allows 15 clients across the whole project, the web service included**, so a
worker holding a connection across its LLM calls starves the live app long before it
saturates the model provider.

## Failure handling

`analyze_theme` **raises** rather than returning the error as a string (`:141-149`).
The previous version swallowed every exception into the reasoning field, which the
caller discards when there are no axes — so an exhausted API budget looked exactly like
an album the model had nothing to say about, and a run could burn through hundreds of
albums reporting zero failures.

Each factor is attempted independently so one failure doesn't discard the other
(`:126-127`), and `store_global_factors` uses `COALESCE(EXCLUDED.x, albumfactors.x)`
throughout (`:231-240`) so **nulls never overwrite stored values**.

`parse_analysis` (`:106`) is defensive in two documented ways:
- A **partial** axes block is rejected outright (`:119-123`): personalize would have to
  impute the gaps, and an imputed axis is indistinguishable from a measured one
  downstream.
- The `OVERALL` regex tolerates the model echoing the placeholder's punctuation —
  `"OVERALL: [3, a collection of...]"`, `"**OVERALL:** 3"` (`:127-132`). The comment is
  honest that asking for a bare number is the real fix.

## Where it is NOT well-handled

`GET /stats/analysis` (`stats.py:1070-1173`) is the outlier and breaks every rule above:

- **Synchronous** on the request path, in a blocking `def`, so it holds a threadpool
  slot for the whole call.
- **Unbounded prompt**: one line per rated album (`:1111-1113`), plus artist averages,
  recent ratings, 20 queue items and the top 10 songs. A 400-album library is a
  five-figure-token prompt.
- **No cache, no timeout, no retry, no error handling.** An API failure is a 500.
- Constructs a fresh `anthropic.Anthropic(...)` per request (`:1138`).
- Guarded by `viewable_user_id`, so a **friend** can trigger spend on your library.

Its client wrapper `fetchAnalysis` (`shared/src/api.ts:1587`) is called by nothing, so
no screen reaches it today. QUESTIONS Q10.

## The genre tagger

`_classify_genre_claude` (`albums.py:271`) → `_queue_genre_tagging` (`albums.py:302`),
a daemon thread spawned on import when the album has no genre. Unlike the other two
background threads in that file, **this one works on Render** — it needs only
`anthropic` and, on fallback, `generate_genres_lastfm` (pandas). Both are in
`requirements.txt`.

The prompt's vocabulary is `GENRES` from `backend/genres.py` (`albums.py:268-269`), so
the list Claude sees cannot drift from the one that normalizes what the scraper and
importers send. Results pass through `canonical_genre` / `canonical_subgenre` and a
genre outside the vocabulary is discarded (`:295-296`). Fallback on an invalid genre is
Last.fm tags (`:314-320`). Writes are **non-destructive** — only fills nulls (`:331-338`).
