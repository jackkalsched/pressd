# Taste Overlap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A 0–100% taste overlap between any two Pressd users, computed by matrix factorization, shown on every profile and in a "people who rated this too" sheet after every album rating, on web and iPhone.

**Architecture:** One pure-stdlib module turns ratings into matrix cells (`backend/taste_matrix.py`) and one holds the overlap math (`backend/taste_overlap.py`); both are imported by the nightly worker and the web service. The worker fits a weighted ALS factorization nightly (`worker/taste_factorize.py`) and stores item vectors, user vectors and every pair's percentage. The web service folds a new rater into the stored item vectors on demand, in stdlib, and serves the profile number and the post-rating sheet. A layered baseline exists only to be compared against at a checkpoint where Jack decides before any UI is built.

**Tech Stack:** FastAPI + SQLModel on Postgres (Supabase); numpy in the worker only; React 19 + TanStack Query on web; Expo / React Native on mobile; `@pressd/shared` for the API client.

**Spec:** [docs/superpowers/specs/2026-11-03-taste-overlap-design.md](../specs/2026-11-03-taste-overlap-design.md) — read it before any task.

## Global Constraints

- The number: 0% opposite, 50% no evidence, 100% same taste; always a percentage for every pair; symmetric. Shown as a whole number with `%` (`72%`) **(plan's call)**.
- Every score is read relative to the user's own mean and spread **per column type** (z-scores).
- Cluster columns: all 10 seeds × 18 clusters, each column at **1/10** the cluster weight.
- Final album score column: **off** unless the checkpoint test shows it helps.
- **No LLM call anywhere in computing, choosing or wording the overlap (Jack).** The percentage is the model's output; the reason text is a fixed template. Claude-measured album values (`albumfactors` theme axes and distinctness) enter the factorization only as inputs — six per-user `m:` columns (Jack, at the checkpoint). Genre and subgenre labels are used only as groupings of a user's own scores.
- Pairs with evidence: target 10th percentile ≥ 25 and 90th percentile ≤ 85, interquartile range ≥ 15 points **(plan's numbers for the spec's 25–85 band)**.
- `backend/taste_matrix.py` and `backend/taste_overlap.py` are **pure stdlib** (+ `sqlalchemy.text` for loading): the web service has no numpy (`theme_predictor/personalize.py:37-39`).
- Any cross-user match goes through `track_id` / `subject_key` / `trackkeys.artist_key`; per-artist grouping through `credits.album_artists` / `credits.song_artists`.
- Every new table with a user id is added to `users.delete_own_account` (`backend/routers/users.py:590`).
- New columns: SQLModel field **and** an idempotent `ALTER TABLE … ADD COLUMN IF NOT EXISTS` in `init_db()`; old rows stay null.
- ⚠️ Local `.env` is production, and `uvicorn` runs migrations on start. **Do not start the backend locally without Jack's go-ahead.** Backend verification is `python3.13 -c "import backend.main"` plus the pytest suite.
- **No switch (Jack):** the feature ships on push — backend and web on deploy, iPhone with the next approved build. There is no `TASTE_OVERLAP_ENABLED`; ignore the switch wherever a task below still mentions it, and see **Amendments**.
- Copy uses "Pressd", no apostrophe; no grey helper captions under headings or at panel footers.
- Mobile UI is checked by Jack, not by simulator screenshots: verify with `npm run typecheck` and lint counts.
- Lint baselines: web 14 problems (10 errors, 4 warnings); mobile 126 errors, 7 warnings. Don't add to them.
- One-off scripts are deleted after use. CLAUDE.md is updated in the same commit as the code it describes. Commit messages are declarative sentences, ending with the `Co-Authored-By` line.
- Tests: `tests/` with pytest (installed locally, 7.0.1; dev-only, **not** added to either requirements file). Run `python3.13 -m pytest tests -q` from the repo root.

## Review Focus

1. **A user with no scores, or all identical scores** (e.g. every song 8.0) — expect 50% with everyone and no crash (no divide-by-zero in z-scoring). → Task 2 test `test_constant_scores_give_zero_z`, Task 3 test `test_no_evidence_is_fifty`.
2. **Rating a record nobody else has, when every other user is a friend or pending** — expect no sheet, not an empty one. → Task 7 test `test_no_candidates_no_sheet`.
3. **The sheet's album deleted before the user returns to For You** — expect no sheet and no 500. → Task 7 test `test_sheet_for_deleted_album_is_skipped`.
4. **Re-editing an already-rated album** (PATCH with `status: "rated"` again) — expect no new sheet and `rated_at` unchanged. → Task 1 test `test_first_rating_only`.
5. **Deleting an account that has overlaps, sheets and events** — expect the delete to succeed. → Task 1 step on `delete_own_account`, checked by `test_delete_covers_new_tables`.

---

## Amendments after review (2026-11-03)

These override the tasks below where they disagree. Spec §8 has the reasoning.

1. **Task order.** Task 1 splits:
   - **1a, first:** `Friendship.requested_at` / `accepted_at` — stamped on friend add,
     the reverse-pending auto-accept, the accept endpoint **and invite acceptance**
     (`users.py`, the invite route) — and `Album.rated_at`. No new tables, no sheet.
     Commit and push on its own. (Jack)
   - **Then Tasks 2–5** (pure code and read-only evaluation), then the checkpoint.
   - **1b, after the checkpoint:** the five taste tables and the owed sheet.
2. **First rating** (`_first_rating`, landed in 1a): `data["status"] == "rated"`, the
   previous status wasn't `rated`, and `rated_at` is null — both tests, because copies
   rated before the column have a null `rated_at` and are re-sent "rated" on every edit. Owe no sheet when the user already has another
   rated copy with the same `subject_key`, or the record has ≤ 2 tracks. Test both.
3. **No switch.** Drop `own_user["taste_overlap_enabled"]`, the env var and every
   "when the switch is off" branch; Task 11 step 4 becomes "push". (Jack)
4. **Sheet timing.** Both clients request the sheet when the share card closes (web
   `RatingScreen.tsx`, mobile `rate/[id].tsx`) and once on launch — not on For You. The
   sheet sits over the album page. (Jack)
5. **`GET /overlap/sheet` is read-only.** The client posts `action: "shown"` to the
   events endpoint once it renders; that marks the sheet shown. Owed sheets older than
   48 hours are skipped and marked `superseded`.
6. **Live path.** Fold the caller in, then compute only against the record's other
   raters (load their rows); never against every stored user on the web service.
7. **Storage and steadiness (Task 6).** Store pairs only off 50 (missing row = 50).
   Warm-start ALS from the stored item vectors. Stamp `tasteitem` with the cluster
   map's `computed_at`; fold-in drops `c:` columns on a mismatch; `--user` runs don't
   persist the map.
8. **Reasons by band.** `reason_for` takes the percent and picks agree / mixed / split
   by band, with a fixed phrasing chosen by a hash of the pair. No-evidence pairs show
   50% exactly like any other 50% (Jack); their reason may name a record to rate.
9. **Claude's album measurements stay** — as the `m:` columns of Task 5b and in the baseline's album-feature layer (Jack, at the checkpoint; the review's suggestion to cut them is withdrawn).
10. **Checkpoint report adds:** named pairs (`--pairs`), the distribution with user 1
    removed from bridge counts, and percentiles over pairs with evidence ≥ `EVIDENCE_K`/2.
11. **Tests** get a bogus `DATABASE_URL` from `conftest.py` instead of loading `.env`.
    CLAUDE.md §2's "There is no test suite" changes with them.
12. **Metric 3** counts `kind IN ('user','track_note')` posts and replies after `rated_at`.
13. **Open:** block / "Don't suggest this person". Not in scope until Jack decides.

## Amendments after the checkpoint (2026-11-03)

Jack chose the **baseline** (spec §3.7). These override Tasks 6–7 and 11 where they
disagree, and add Task 6b.

1. **Constants.** `backend/taste_overlap.py`: `GAMMA = 0.5`. `backend/taste_matrix.py`
   `COLUMN_WEIGHTS`: aggregates (`a`, `c`, `g`, `sg`) at 1.0 and the final album score
   (`A`) on, exactly as the checkpoint's winning baseline configuration in
   `worker/taste_evaluate.py` sets them. `EVIDENCE_K` stays 10.
2. **The baseline moves to `backend/`** (`backend/taste_baseline.py`, from
   `worker/taste_baseline.py`), so the web service can run it: it is already pure stdlib
   plus `statistics`. `worker/taste_evaluate.py` imports it from there. The
   factorization (`worker/taste_factorize.py`) stays in the worker, for the health check
   only.
3. **Storage (Task 6).** No item or user vectors are fitted. `tasteitem` holds each
   album's standardized feature vector (`column_key = "album:<album_id>"`,
   `vector_json`), so the live path never re-standardizes over a subset; `tasteuser`
   holds each user's album-feature taste vector and the record count behind it.
   `tasteoverlap` stores pairs off 50% only (a missing row reads as 50), with the
   evidence, reason and `updated_at`. Smoothing is unchanged.
4. **Nightly (Task 6).** `run_nightly` builds cells and album features for everyone,
   runs `baseline_similarity` over every pair, maps each with `to_percent`, smooths,
   attaches `reason_for` (by band, review amendment 8), and writes. It no longer calls
   the factorization. Logged as `workerrun` job `taste_overlap`.
5. **Live path (Task 7).** After a first rating: load the caller's and that record's
   other raters' rows, build their cells, take album features from `tasteitem` and the
   others' taste vectors from `tasteuser`, recompute the caller's taste vector, and run
   the baseline for the caller against those raters only.
6. **Scale.** Note in CLAUDE.md that all-pairs is ~5k pairs today and grows with
   users²; candidate-pair restriction is needed before a few thousand users. Not built
   now.
7. **Task 6b (new): the health check and re-checkpoints** — below, after Task 6.

## File Structure

| File | Responsibility |
|---|---|
| `backend/models.py` | +5 tables (`TasteItem`, `TasteUser`, `TasteOverlap`, `OverlapSheet`, `OverlapEvent`), +`Friendship.requested_at/accepted_at`, +`Album.rated_at` |
| `backend/database.py` | migrations for the above |
| `backend/taste_matrix.py` | **new**, stdlib: load ratings, build per-user cells by column |
| `backend/taste_overlap.py` | **new**, stdlib: fold-in, cosine, evidence, percent curve, smoothing, reasons, people picker |
| `worker/taste_factorize.py` | **new**, numpy: weighted ALS fit; nightly stage writing vectors and pairs |
| `worker/taste_baseline.py` | **new**, numpy: the layered baseline (evaluation only) |
| `worker/taste_evaluate.py` | **new**: hold-out test, tuning grid, checkpoint report |
| `worker/nightly_predict.py` | calls the nightly stage after the artist map is persisted |
| `backend/routers/overlap.py` | **new** router: profile overlap, the owed sheet, sheet events |
| `backend/routers/albums.py` | first move to `rated`: stamp `rated_at`, owe a sheet |
| `backend/routers/users.py` | friendship timestamps; account deletion covers new tables |
| `backend/scoring.py` | `top_bottom_songs` (shared by social.py and the sheet) |
| `backend/deps.py` | `own_user` carries `taste_overlap_enabled` |
| `backend/main.py` | registers the router (15 routers) |
| `shared/src/types.ts`, `shared/src/api.ts` | types + 3 client functions |
| `frontend/src/components/TasteOverlap.tsx` | **new**: `OverlapPanel`, `OverlapChip` |
| `frontend/src/components/PeopleSheet.tsx` | **new**: the post-rating dialog |
| `frontend/src/pages/FriendProfile.tsx`, `frontend/src/pages/ForYou.tsx` | mount them |
| `mobile/components/TasteOverlap.tsx`, `mobile/components/PeopleSheet.tsx` | **new**, mobile counterparts |
| `mobile/app/friend/[id].tsx`, `mobile/app/(tabs)/index.tsx` | mount them |
| `tests/` | **new**: pytest for the pure modules and the router helpers |

---

### Task 1: Schema, measurement timestamps and "first rating" stamp

**Files:**
- Modify: `backend/models.py` (Friendship `:90`, Album `:136-208`, new tables at end)
- Modify: `backend/database.py` (`init_db()` migration list)
- Modify: `backend/routers/albums.py:277` (PATCH), `backend/routers/users.py:1025-1060` (add friend), `:1102-1125` (accept), `:590-673` (delete)
- Create: `tests/conftest.py`, `tests/test_schema.py`
- Modify: `CLAUDE.md` §5 (`models.py` entry: 28 tables), §10 (signup/created_at paragraph: the new timestamps)

**Interfaces:**
- Produces tables (SQLModel, lower-case names):
  - `TasteItem(column_key: str PK, bias: float, vector_json: str, raters: int, fitted_at: datetime)`
  - `TasteUser(user_id: int PK FK pressuser, vector_json: str, cells_hash: str, updated_at: datetime)`
  - `TasteOverlap(user_id_a: int PK, user_id_b: int PK, percent: float, evidence: float, reason_json: str | None, updated_at: datetime)` — `user_id_a < user_id_b`, both FK pressuser
  - `OverlapSheet(id: int PK, user_id: int FK, album_id: int (plain int, not FK), status: str = "owed", created_at, shown_at | None)` — status `owed | shown | superseded`
  - `OverlapEvent(id: int PK, user_id: int FK, sheet_id: int | None, action: str, target_user_id: int | None, created_at)` — action `shown | add | open_discussion | not_now | open_profile`
  - `Friendship.requested_at: datetime | None`, `Friendship.accepted_at: datetime | None`
  - `Album.rated_at: datetime | None` (TIMESTAMPTZ; `date_rated` stays as it is)
- Produces helper in `albums.py`: `_first_rating(previous_status: str | None, data: dict) -> bool`

- [ ] **Step 1: Write the failing tests** in `tests/test_schema.py`

```python
from backend.routers.albums import _first_rating

def test_first_rating_only():
    assert _first_rating("listening", {"status": "rated"}) is True
    assert _first_rating("to_listen", {"status": "rated"}) is True
    assert _first_rating("rated", {"status": "rated"}) is False
    assert _first_rating("listening", {"theme": 7}) is False

def test_delete_covers_new_tables():
    import inspect
    from backend.routers.users import delete_own_account
    src = inspect.getsource(delete_own_account)
    for t in ("tasteoverlap", "tasteuser", "overlapsheet", "overlapevent"):
        assert f"DELETE FROM {t}" in src
```

`tests/conftest.py` puts the repo root on `sys.path` and loads `.env` (imports only; no test opens a connection).

- [ ] **Step 2: Run, expect FAIL** — `python3.13 -m pytest tests/test_schema.py -q` → ImportError on `_first_rating`.

- [ ] **Step 3: Implement.**
  - Models and migrations as listed. `tasteoverlap` deletion is `WHERE user_id_a = :u OR user_id_b = :u`; `overlapevent` also deletes rows whose `target_user_id = :u`. Delete these before `pressuser`.
  - `_first_rating`: true only when `data["status"] == "rated"` and the album's status before the write wasn't `"rated"`. Capture the previous status before the `setattr` loop. When true, set `album.rated_at = datetime.now(timezone.utc)` and insert `OverlapSheet(user_id=user.id, album_id=album.id)` in the same commit.
  - Friend add: new pending row gets `requested_at = now`; the branch that turns a reverse pending request into accepted (`users.py`, `existing.status = "accepted"`) and the accept endpoint set `accepted_at = now`.

- [ ] **Step 4: Run, expect PASS**, then `python3.13 -c "import backend.main"` → no output.

- [ ] **Step 5: Commit** — "Stamp when friendships are requested and accepted and when an album is first rated, and owe a people sheet for it".

---

### Task 2: Matrix cells (`backend/taste_matrix.py`)

**Files:**
- Create: `backend/taste_matrix.py`, `tests/test_taste_matrix.py`

**Interfaces:**
- Consumes: `credits.album_artists`, `credits.song_artists`, `trackkeys.artist_key`; the `artistcluster` table (`artist_key, seed, cluster_id`).
- Produces:

```python
COLUMN_WEIGHTS: dict[str, float] = {"s": 1.0, "f": 1.0, "a": 0.5, "c": 0.5, "g": 0.5, "sg": 0.5, "A": 0.0}
AGG_SHRINK_K: float = 3.0     # album-equivalents an aggregate needs to count fully

@dataclass
class SongRow:  user_id: int; album_id: int; track_id: int; score: float; song_artist: str | None
@dataclass
class AlbumRow: user_id: int; album_id: int; subject_key: str; artist: str; extra_artists: str | None
                genre: str | None; subgenres: tuple[str, ...]; status: str; score: float | None
                theme: float | None; replay_value: float | None; production: float | None; distinctness: float | None
@dataclass
class Rows: songs: list[SongRow]; albums: list[AlbumRow]; clusters: dict[str, list[tuple[int, int]]]  # artist_key -> [(seed, cluster_id)]

Cells = dict[str, tuple[float, float]]          # column_key -> (z value, weight)

def load_rows(con, user_ids: set[int] | None = None) -> Rows
def build_cells(rows: Rows, weights: dict[str, float] = COLUMN_WEIGHTS) -> dict[int, Cells]
def column_type(column_key: str) -> str        # the prefix before the first ":"
```

Column keys: `s:<track_id>`, `f:<subject_key>:<theme|replay_value|production|distinctness>`, `a:<artist_key>`, `c:<seed>:<cluster_id>`, `g:<genre>`, `sg:<subgenre>`, `A:<subject_key>`. Columns whose weight is 0 are omitted.

- [ ] **Step 1: Write the failing tests** — synthetic `Rows`, no database:
  - `test_relative_to_own_scale`: user 1 scores three songs 9/7/5, user 2 scores the same tracks 7/5/3. Their `s:` cells have equal z values.
  - `test_constant_scores_give_zero_z`: a user whose songs are all 8.0 gets `s:` cells of 0.0, with no exception.
  - `test_collab_counts_for_each_artist`: an album with `artist="Anderson .Paak"` and `extra_artists='["Cordae"]'` yields both `a:anderson paak` and `a:cordae`.
  - `test_cluster_weight_split_across_seeds`: an artist in 10 seeds yields 10 `c:` columns, each weighted `0.5 / 10`.
  - `test_single_album_aggregate_is_shrunk`: an artist aggregate from one album has `|z|` equal to the raw mean z × `1 / (1 + AGG_SHRINK_K)`.
  - `test_final_score_off_by_default`: no `A:` keys appear with the default weights; some appear with `{"A": 1.0}`.
  - `test_factors_only_from_rated`: a `listening` album contributes `s:` cells but no `f:` cells.

- [ ] **Step 2: Run, expect FAIL** — `python3.13 -m pytest tests/test_taste_matrix.py -q`.

- [ ] **Step 3: Implement.** Songs come from albums with status `rated` or `listening`, and scored songs with a `track_id`. A user scoring one track twice averages the two. z-scores are taken per user per type: songs over the user's song scores; each factor over the user's rated albums; `A` over their rated album scores; a population standard deviation of 0 gives z 0. Aggregates are means of the user's song z-scores over that artist's (`song_artists`), cluster's, genre's or subgenre's songs. Each is multiplied by `n / (n + AGG_SHRINK_K)`, where n is the number of distinct albums behind it. Cluster weight is `weights["c"] / number_of_seeds_for_that_artist`. `load_rows` runs three `SELECT`s and holds the connection only while it reads.

- [ ] **Step 4: Run, expect PASS.**

- [ ] **Step 5: Commit** — "Turn every user's ratings into taste-matrix cells relative to their own scale".

---

### Task 3: Overlap math (`backend/taste_overlap.py`)

**Files:**
- Create: `backend/taste_overlap.py`, `tests/test_taste_overlap.py`

**Interfaces:**
- Consumes: `Cells` from Task 2.
- Produces:

```python
@dataclass
class Item: bias: float; vector: list[float]

RANK: int = 4                 # replaced by the checkpoint's choice
REG: float = 5.0
EVIDENCE_K: float = 10.0      # shared weight at which r keeps half its strength
BRIDGE_WEIGHT: float = 0.5    # evidence per third user who shares a column with both
BRIDGE_CAP: int = 10
GAMMA: float = 1.0            # curve exponent, tuned at the checkpoint
SMOOTH_ALPHA: float = 0.3

def fold_in(cells: Cells, items: dict[str, Item], reg: float = REG) -> list[float]
def cosine(u: list[float], v: list[float]) -> float                 # 0.0 if either is all zeros
def evidence(a: Cells, b: Cells, raters: dict[str, int], bridges: int) -> float
def to_percent(r: float, ev: float, k: float = EVIDENCE_K, gamma: float = GAMMA) -> float
def smooth(previous: float | None, new: float, rated_since: bool, alpha: float = SMOOTH_ALPHA) -> float
def pick_people(candidates: list[tuple[int, float]], rng: random.Random) -> list[int]
```

- [ ] **Step 1: Write the failing tests:**

```python
def test_no_evidence_is_fifty():
    assert to_percent(0.9, 0.0) == 50.0
    assert to_percent(0.0, 100.0) == 50.0

def test_percent_is_monotone_and_bounded():
    ps = [to_percent(r / 10, 50.0) for r in range(-10, 11)]
    assert ps == sorted(ps) and 0.0 <= ps[0] and ps[-1] <= 100.0

def test_thin_evidence_moves_little():
    assert 50 < to_percent(1.0, 1.0) < 60
    assert to_percent(1.0, 1000.0) > 95

def test_fold_in_ignores_unknown_columns():
    items = {"s:1": Item(0.0, [1.0, 0.0])}
    assert fold_in({"s:1": (1.0, 1.0), "s:999": (2.0, 1.0)}, items) == fold_in({"s:1": (1.0, 1.0)}, items)

def test_fold_in_empty_is_zero_vector():
    assert fold_in({}, {"s:1": Item(0.0, [1.0, 0.0])}) == [0.0, 0.0]

def test_smooth_jumps_after_rating_and_eases_otherwise():
    assert smooth(40.0, 80.0, rated_since=True) == 80.0
    assert smooth(40.0, 80.0, rated_since=False) == 52.0
    assert smooth(None, 80.0, rated_since=False) == 80.0

def test_pick_people_small_groups_show_everyone():
    assert sorted(pick_people([(1, 90.0), (2, 10.0)], random.Random(0))) == [1, 2]

def test_pick_people_two_top_one_bottom():
    cands = [(i, float(i)) for i in range(1, 21)]            # percent = id
    for seed in range(50):
        picked = pick_people(cands, random.Random(seed))
        assert len(picked) == 3 and len(set(picked)) == 3
        assert sum(p >= 16 for p in picked) == 2 and sum(p <= 5 for p in picked) == 1
```

- [ ] **Step 2: Run, expect FAIL.**

- [ ] **Step 3: Implement.**
  - **`fold_in`:** solves `(Σ w·v·vᵀ + reg·I) u = Σ w·(z − bias)·v` over the columns present in `items`, by Gaussian elimination on a `RANK`×`RANK` system.
  - **`evidence`:** `Σ over shared columns of min(w_a, w_b) · 1/log2(1 + raters[col])`, plus `BRIDGE_WEIGHT · min(bridges, BRIDGE_CAP)`.
  - **`to_percent`:**
    ```python
    rs = r * ev / (ev + k)
    return 50.0 + 50.0 * math.copysign(abs(rs) ** gamma, rs)
    ```
  - **`pick_people`:**
    - n ≤ 3: everyone.
    - Otherwise, sort by percent. Let `q = ceil(n/4)`; top = the highest `q`, bottom = the lowest `q`. If the top has at least 2 people and the two groups don't overlap, pick 2 at random from the top and 1 from the bottom.
    - Else pick 3 distinct people at random, weighted by percent + 1.

- [ ] **Step 4: Run, expect PASS.**

- [ ] **Step 5: Commit** — "Measure taste overlap from user vectors, held near 50% until the evidence is there".

---

### Task 4: Weighted ALS fit (`worker/taste_factorize.py`, fit only)

**Files:**
- Create: `worker/taste_factorize.py`, `tests/test_taste_factorize.py`

**Interfaces:**
- Consumes: `build_cells` output, `Item`, `fold_in` (Task 3).
- Produces:

```python
@dataclass
class Model: items: dict[str, Item]; users: dict[int, list[float]]; rank: int; reg: float

def fit(cells: dict[int, Cells], rank: int = RANK, reg: float = REG, iters: int = 15, seed: int = 7) -> Model
```

- [ ] **Step 1: Write the failing tests** (synthetic: 6 users, 40 song columns built from two hidden taste groups):
  - `test_same_group_scores_higher`: users in the same hidden group have higher `cosine` than users across groups, on average.
  - `test_fold_in_matches_fit`: refitting a user's vector with `fold_in` against the fitted items lands within cosine 0.95 of their fitted vector.
  - `test_deterministic`: two fits with the same seed produce identical user vectors.

- [ ] **Step 2: Run, expect FAIL.**

- [ ] **Step 3: Implement** alternating weighted ridge solves with numpy, one row of normal equations per user and per item. Item bias is fitted inside the item step, as an extra constant feature that is not regularised. Use the same `reg` as `fold_in`, so the web service's fold-in agrees with the fit.

- [ ] **Step 4: Run, expect PASS.**

- [ ] **Step 5: Commit** — "Factorize the taste matrix with weighted alternating least squares".

---

### Task 5: Baseline, evaluation and the checkpoint

**Files:**
- Create: `worker/taste_baseline.py`, `worker/taste_evaluate.py`, `tests/test_taste_evaluate.py`

**Interfaces:**
- Consumes: Tasks 2–4.
- Produces:
  - `baseline_similarity(cells: dict[int, Cells]) -> dict[tuple[int, int], tuple[float, float]]`: (r, evidence) per pair, from the spec's three layers (direct, category, album features). The album-feature layer reads `albumfactors` axes and `trackaudio` means weighted by album z.
  - `holdout(rows: Rows, frac: float = 0.2, seed: int = 11) -> tuple[Rows, list[SongRow]]`
  - CLI: `python -m worker.taste_evaluate [--out PATH]`, which writes a markdown report.

- [ ] **Step 1: Write the failing test** `test_holdout_rebuilds_aggregates`: for a song held out, none of the training cells built from the remaining rows include its score. The test compares `build_cells` on the training rows against a hand-built expectation for one artist aggregate.

- [ ] **Step 2: Run, expect FAIL.**

- [ ] **Step 3: Implement.**
  - **Prediction for the test:** each held-out song score is predicted as the overlap-weighted mean of other users' z-scores on that track, against unweighted pooling.
  - **Metric:** mean absolute error on the z scale.
  - **Grid:** rank {2, 4, 8} × reg {1, 5, 20} × column weights {defaults, aggregates 0.25, aggregates 1.0} × final album score {off, on}. γ is chosen per configuration to meet the Global Constraints distribution targets.
  - **Report sections:**
    1. MAE for MF, the baseline and pooling.
    2. The chosen configuration.
    3. Percentile tables (5/10/25/50/75/90/95) for all pairs and for pairs with evidence.
    4. The share of pairs above 80% whose evidence comes mainly through user 1. The test: removing user 1 from the bridge count drops evidence below `EVIDENCE_K`.
    5. Twelve example pairs (usernames, shared records, both approaches' percentages), including the 3 highest, the 3 lowest and 6 at random.
  - **Database:** reads only.

- [ ] **Step 4: Run, expect PASS**, then run `python3.13 -m worker.taste_evaluate --out /tmp/taste-report.md` (read-only against production). Expect a finished report.

- [ ] **Step 5: Commit** — "Compare factorization against a layered baseline on held-out ratings".

- [ ] **Step 6: CHECKPOINT — stop and report to Jack.** Send the report's sections 1–5. Accuracy doesn't gate the feature; believability does. Jack decides:
  - (a) MF or baseline,
  - (b) whether the final album score stays off,
  - (c) whether the example numbers look right.

  **Do not start Task 6 until he answers.** Then set `RANK`, `REG`, `EVIDENCE_K`, `GAMMA` and `COLUMN_WEIGHTS` to the chosen values. If Jack picks the baseline, Tasks 6–7's fold-in path needs a plan amendment before continuing.

---

### Task 6: Nightly stage

**Files:**
- Modify: `worker/taste_factorize.py` (add the stage), `worker/nightly_predict.py:474-478`, `backend/taste_overlap.py` (add `reason_for`)
- Test: `tests/test_taste_overlap.py` (reasons)
- Modify: `CLAUDE.md` §4 (a "taste overlap" journey replacing the old `/social/compare`-only one), §6.3 (a new stage), §9 (the cache row)

**Interfaces:**
- Produces:
  - `run_nightly(con) -> dict`: fits, persists, and returns counts. Logged as `workerrun` job `taste_overlap`.
  - `reason_for(a_records: dict[str, float], b_records: dict[str, float], shared_artists: list[str], shared_genres: list[str], titles: dict[str, tuple[str, str]]) -> dict | None`. `*_records` map `subject_key` → that user's mean song z on the record; `titles` maps `subject_key` → (album name, artist).
  - The result is `{"kind": "agree"|"split"|"artist"|"genre", "subject_key"?, "album"?, "artist"?, "genre"?, "text": str}`.

- [ ] **Step 1: Write the failing tests:**
  - `test_reason_prefers_agreement`: with one record both rate +1.5 and one they split +1.5/−1.5, the kind is `"agree"`, and the text is `"You both put <i>Blonde</i> near the top. Say hi."` (the album wrapped in `<i>`; clients render it italic).
  - `test_reason_split`: with only the split record, the kind is `"split"` and the text is `"You gave <i>Blonde</i> opposite scores. Go settle it."`
  - `test_reason_genre_only`: the text is `"You both lean R&B."`
  - `test_reason_nothing`: returns None.

- [ ] **Step 2: Run, expect FAIL.**

- [ ] **Step 3: Implement.**
  - **`reason_for` order:** agree (both z ≥ 0.75, smallest gap), split (gap ≥ 2.0, largest gap), shared artist (`"You both rate <artist> highly."` when both artist z ≥ 0.5), shared genre, None. Middle-band wording from the spec is the builder's.
  - **`run_nightly`:** fit on all users, then write the `tasteitem` and `tasteuser` rows, replacing each table.
  - **Pair overlaps:** for every pair, `cosine`, `evidence` (bridges counted from users' column-key sets) and `to_percent`. Smooth against the stored row: `rated_since` is true when either user's latest `album.rated_at` or latest song-score change is after the stored `updated_at`; use `rated_at` alone if song edit times aren't stored. Then upsert `tasteoverlap` with `reason_for`.
  - **Connections:** writes go through one connection, opened after the fit, in bulk (`execute_values`).
  - **In `nightly_predict.main`:** call it right after `clusters.persist(con)`, in its own try/except, so a failure doesn't stop the user stages.

- [ ] **Step 4: Run, expect PASS**, then run `python3.13 -m worker.taste_factorize --dry-run`. That flag runs `run_nightly` without writing and prints the counts and percentile table. The table should match the checkpoint report within a point or two.

- [ ] **Step 5: Commit** — "Refit taste overlap nightly after the artist map and store every pair's percentage and reason".

---

### Task 6b: Nightly health check and re-checkpoints (spec §6.1)

**Files:**
- Create: `worker/taste_health.py`, `tests/test_taste_health.py`
- Modify: `worker/taste_evaluate.py` (expose what the health check reuses), `.github/workflows/nightly-predict.yml` (a `taste-health` job)
- Modify: `CLAUDE.md` §3 (run command), §6.3 or a taste-overlap entry (the health row and milestones), the `WorkerRun.job` comment in `models.py`

**Interfaces:**
- `python -m worker.taste_health [--report PATH] [--dry-run]`. Reads the database; writes exactly one `workerrun` row (`job = "taste_health"`, `status` `ok` or `error`) unless `--dry-run`.
- `detail_json` (the morning brief reads it; keep the keys stable):
  - `users` (count of `pressuser`), `users_sharing_50` (distinct users who share ≥ 50 songs, by `track_id`, with at least one other user)
  - `accuracy`: `{"baseline": mae, "factorization": mae, "pooling": mae, "held_out": n}` on the same hold-out as `taste_evaluate`
  - `spread`: the shipped baseline's p10 / p25 / p50 / p75 / p90 over pairs with evidence, `in_band` (p10 ≥ 25, p90 ≤ 85, IQR ≥ 15), `pairs`, `pairs_off_50`
  - `user1`: up to 3 highest, 3 lowest and the 5 most-shared pairs with user 1: `{"user_id", "name", "shared_songs", "shared_records", "baseline", "factorization"}`
  - `milestones_crossed`: every milestone reached so far; `checkpoint_due`: those crossed for the first time tonight (a milestone fires once — read the previous `taste_health` rows' `milestones_crossed` to know)
  - Milestones: `users_1000`, `users_2500`, `users_5000`, `users_10000`, `sharing50_50`, `sharing50_100`
- When `checkpoint_due` is non-empty, the full checkpoint report (`taste_evaluate`'s markdown) goes into `detail_json` as `report_md` (and to `--report PATH` when given, for local use). **Never an Actions artifact** — the repo is public and the report names users (ruling, Task 6b review).
- The factorization here is the checkpoint's configuration (rank 8, reg 5, bias reg 5, aggregates 0.25, album score off, measures 1); the baseline is the shipped one (amendment 1).

- [ ] **Step 1: Failing tests** (pure helpers, no database): milestone logic — a milestone already in a previous row is not due again; crossing two at once makes both due; `users_sharing_50` from a small synthetic song list (two users sharing 50 tracks count, sharing 49 don't).
- [ ] **Step 2: Implement**, reusing `taste_evaluate`'s load / hold-out / scoring functions; one read transaction closed before computing, one short write.
- [ ] **Step 3:** `python3.13 -m worker.taste_health --dry-run` prints the detail JSON (read-only against production).
- [ ] **Step 4: Workflow** — a `taste-health` job in `nightly-predict.yml`, after `predict` (`needs: predict`, but runs even if predict failed: `if: always()`), installing `requirements-worker.txt`, running `python -m worker.taste_health`. No artifact upload. Fails red only when the check itself errors.
- [ ] **Step 5: Commit** — "Check taste overlap's health nightly against the factorization and flag a checkpoint at each milestone".

---

### Task 7: API — profile overlap, the owed sheet, events, the switch

**Files:**
- Create: `backend/routers/overlap.py`, `tests/test_overlap_router.py`
- Modify: `backend/main.py` (register), `backend/deps.py` (`own_user`), `backend/scoring.py` (`top_bottom_songs`), `backend/routers/social.py:307-308` (use it)
- Modify: `CLAUDE.md` §2 (15 routers, endpoint count), §3 env vars (`TASTE_OVERLAP_ENABLED`), §5 (a new "Taste overlap" entry), §12 (the sheet's rules as a convention)

**Interfaces:**
- Consumes: Tasks 1–3, 6.
- Produces:
  - `top_bottom_songs(album, songs) -> tuple[Song | None, Song | None]`: `pick_top_song`, then the minimum score when there are ≥ 2 songs, exactly as `social.py:307-308` does today.
  - `own_user(...)["taste_overlap_enabled"]: bool`, which is `os.getenv("TASTE_OVERLAP_ENABLED") == "1"`.
  - `GET /users/{user_id}/overlap` → `{"percent": int | null, "reason": {kind, text, subject_key?, album_id?} | null, "connecting_album_id": int | null}`. `percent` is null for yourself or when the switch is off. `album_id` is the **other user's** copy of the reason's record, for Compare. Guard: `current_user`; 404 for a missing user. A pair with no row is `50` with a null reason.
  - `GET /overlap/sheet` → `null | {"sheet_id": int, "album": {"id", "name", "artist", "art_url"}, "fallback": bool, "people": [{"user": public_user, "percent": int, "top_song": {"title", "score"} | null, "bottom_song": {...} | null, "from_album": str | null}]}`
  - `POST /overlap/sheet/{sheet_id}/events` with body `{"action": "add"|"open_discussion"|"not_now"|"open_profile", "target_user_id": int | null}` → `{"ok": true}`. 404 when the sheet isn't the caller's.
  - Pure helpers in the router module, for tests: `_eligible(candidates: list[int], friends_or_pending: set[int], me: int) -> list[int]`.

- [ ] **Step 1: Write the failing tests** (pure helpers plus a fake session where needed):
  - `test_no_candidates_no_sheet`: when every other user is a friend or pending, `_eligible` returns `[]`, and the sheet builder returns None.
  - `test_sheet_for_deleted_album_is_skipped`: an owed sheet whose `album_id` has no album row is marked `superseded`, and the endpoint returns null.
  - `test_latest_owed_sheet_wins`: with two owed sheets, the newer one is served and the older is marked `superseded`.
  - `test_self_overlap_is_null`.

- [ ] **Step 2: Run, expect FAIL.**

- [ ] **Step 3: Implement `GET /overlap/sheet`.**
  - **Which sheet:** the newest `owed` sheet. Supersede the older ones.
  - **Refresh the caller's vector:** if their `tasteuser.updated_at` is older than the album's `rated_at`, fold the caller in, in stdlib. Use `load_rows({me})`, `build_cells`, the stored `tasteitem`s, then `fold_in`. Recompute the caller's pairs against every stored `tasteuser` with `rated_since=True`, and upsert them.
  - **Candidates:** other users with a **rated** copy of the record (`subject_key`, any edition), excluding friends and pending in either direction. With none, use the fallback: every user with at least one rated album, under the same exclusions.
  - **Pick:** `pick_people` with `random.Random()`.
  - **Songs for each person:** from their copy of the record; in the fallback, from their record closest to it. That's the most recent rated copy sharing an artist (`album_artists`), else the same genre, else none. Then `top_bottom_songs`.
  - **Finish:** mark the sheet `shown` (`shown_at`) and log an `OverlapEvent(action="shown")`. Return null when the switch is off or nobody qualifies.
  - **Connections:** load, then compute, then write. The connection isn't held while vectors are computed.

- [ ] **Step 4: Run, expect PASS**, then `python3.13 -c "import backend.main"` and `python3.13 -m pytest tests -q`.

- [ ] **Step 5: Live check (ask Jack first; this starts the backend against production and runs Task 1's migrations).**
  - Run `uvicorn backend.main:app --port 8000` with `TASTE_OVERLAP_ENABLED=1`, using a dev token for user 1.
  - Expect `GET /users/84/overlap` to return a whole-number percent and a reason.
  - Rate a test album on a test account, then call `GET /overlap/sheet`, and expect three people or fewer.
  - Stop the server.

- [ ] **Step 6: Commit** — "Serve taste overlap on profiles and a people sheet after every first rating, behind a switch".

---

### Task 8: Shared client

**Files:**
- Modify: `shared/src/types.ts`, `shared/src/api.ts`

**Interfaces:**
- Produces (camelCase at the boundary, as every other function does):

```ts
export interface OverlapReason { kind: 'agree' | 'split' | 'artist' | 'genre'; text: string; subjectKey?: string; albumId?: number }
export interface Overlap { percent: number | null; reason: OverlapReason | null; connectingAlbumId: number | null }
export interface SheetSong { title: string; score: number }
export interface SheetPerson { user: PublicUser; percent: number; topSong: SheetSong | null; bottomSong: SheetSong | null; fromAlbum: string | null }
export interface PeopleSheetData { sheetId: number; album: { id: number; name: string; artist: string; artUrl: string | null }; fallback: boolean; people: SheetPerson[] }
export type SheetAction = 'add' | 'open_discussion' | 'not_now' | 'open_profile'

export async function fetchOverlap(userId: number): Promise<Overlap>
export async function fetchPeopleSheet(): Promise<PeopleSheetData | null>
export async function logSheetEvent(sheetId: number, action: SheetAction, targetUserId?: number): Promise<void>
```

`UserInfo` gains `tasteOverlapEnabled: boolean`. (`PublicUser` is whatever type `public_user` already maps to in `types.ts`. Reuse it.)

- [ ] **Step 1:** Add the types and functions, using `apiFetch` (never a bare `fetch`).
- [ ] **Step 2:** `cd frontend && npm run typecheck` and `cd mobile && npm run typecheck` → no errors.
- [ ] **Step 3: Commit** — "Add taste overlap and the people sheet to the shared API client".

---

### Task 9: Web

**Files:**
- Create: `frontend/src/components/TasteOverlap.tsx`, `frontend/src/components/PeopleSheet.tsx`
- Modify: `frontend/src/pages/FriendProfile.tsx` (`isFriend` at `:71`), `frontend/src/pages/ForYou.tsx`
- Modify: `CLAUDE.md` §5 (the web profile paragraph)

**Interfaces:**
- Consumes: Task 8.
- Produces: `OverlapPanel({ overlap, person, onAdd, requested })`, `OverlapChip({ overlap })`, `PeopleSheet({ data, onClose })`.

- [ ] **Step 1: Profile.** On someone else's profile, when `tasteOverlapEnabled`, fetch with `useQuery(['overlap', fid], () => fetchOverlap(fid))`.
  - **Not friends:** `OverlapPanel` under the name. It has the heading "You & {name}", the percent in Playfair (`.font-display`, Pressd green `#2d6a4f`), a 0–100 meter with a marker, the reason text (`<i>` rendered as italic), and **Add friend** and **Compare** buttons.
    - **Add friend:** the page's existing add handler.
    - **Compare:** `/album/{reason.albumId}?view=compare`, or their library when `reason.albumId` is null.
  - **Friends:** `OverlapChip` under the name, showing the percent and "taste overlap", followed by the reason line.
  - Nothing on your own profile. Use `PILL` / `SECTION_LABEL` from `components/albumView.tsx` where they fit, and the motion classes from `index.css`.
- [ ] **Step 2: For You.** When `tasteOverlapEnabled`, `useQuery(['people-sheet'], fetchPeopleSheet, { staleTime: Infinity })` on mount. A non-null result opens `PeopleSheet` as a dialog (`fade-in` + `pop-in`).
  - **Heading:** the cover plus "{n} people rated <i>{album}</i> too", or "People who like what you like" when `fallback`.
  - **Each row:** avatar and name (opening `/u/{id}`, logging `open_profile`), the percent, an **Add** button (`addFriend(me, id)`, logging `add`, then "Requested"), and the song notes drawn exactly like the For You review previews on web (`ForYou.tsx:919-934`: "Best" in green and "Worst" in `#b1542f`, title, `· 9.6`). Show "from {fromAlbum}" when set.
  - **Footer:** **Not now** (logs `not_now` and closes), and **Open the discussion**, which logs `open_discussion`, calls `resolveThread({ subjectType: 'album', artist, album })`, and navigates to `/thread/{subject}` the way `AlbumThoughts.tsx` does.
- [ ] **Step 3:** `cd frontend && npm run typecheck && npx eslint .` → typecheck clean, still 14 problems.
- [ ] **Step 4:** With the dev server and a backend where the switch is on (Task 7 step 5's setup, with Jack's go-ahead), check a non-friend's profile, a friend's profile, and the sheet after rating an album.
- [ ] **Step 5: Commit** — "Show taste overlap on web profiles and suggest people on For You after a rating".

---

### Task 10: Mobile

**Files:**
- Create: `mobile/components/TasteOverlap.tsx`, `mobile/components/PeopleSheet.tsx`
- Modify: `mobile/app/friend/[id].tsx` (`isFriend` at `:149`), `mobile/app/(tabs)/index.tsx`
- Modify: `CLAUDE.md` §5 ("Other people's profiles on mobile")

**Interfaces:**
- Consumes: Task 8. Mirrors Task 9's component names and props.

- [ ] **Step 1: Profile.** Same rules as web, using `colors`, `fonts` and `radii` from `mobile/theme/tokens.ts`.
  - **Add friend:** the screen's existing friend handler.
  - **Compare:** opens `FriendCompare` for `reason.albumId`.
  - **Taps:** buzz through `lib/haptics.ts`.
- [ ] **Step 2: For You.** Fetch on focus (not just mount), so returning from the rating flow shows the sheet; use `staleTime: Infinity` and invalidate on focus.
  - **The sheet:** a bottom sheet over the screen (mockup A, v2), with a grab handle and a dimmed background.
  - **Song notes:** drawn exactly like `ReviewCell`'s (`(tabs)/index.tsx:661-680`): a green up `Triangle`, a red `#e0492b` down `Triangle`, `songScoreColor`, `toFixed(1)`.
  - **Names:** open profiles through `useOpenProfile`.
  - **Open the discussion:** navigates with `pathname: '/thread/[subject]'`, as `AlbumThoughts.tsx:54` does.
  - **Animation:** hold any `Animated.Value` in `useState(() => …)`, not `useRef(...).current` (the lint rule).
- [ ] **Step 3:** `cd mobile && npm run typecheck && npx eslint .` → typecheck clean, still 126 errors and 7 warnings.
- [ ] **Step 4:** Tell Jack the build is ready to check on his device. He checks mobile UI himself.
- [ ] **Step 5: Commit** — "Show taste overlap on iPhone profiles and suggest people on For You after a rating".

---

### Task 11: Launch readiness

**Files:**
- Modify: `CLAUDE.md` (a consistency pass), `QUESTIONS.md` only if something opened

- [ ] **Step 1:** `python3.13 -m pytest tests -q`, `python3.13 -c "import backend.main"`, and both typechecks and lint counts → all as above.
- [ ] **Step 2:** Re-run `python3.13 -m worker.taste_evaluate --out /tmp/taste-report.md` on the live data and send Jack the distribution and examples. That's the spec's "double-check before it ships fully".
- [ ] **Step 3:** Confirm that no one-off scripts were added, and that every new table, column, endpoint, env var and worker stage is described in CLAUDE.md.
- [ ] **Step 4: Hand off the switch.** When the iOS build carrying Task 10 is approved, Jack sets `TASTE_OVERLAP_ENABLED=1` on Render. That moment is launch.
- [ ] **Step 5: Commit** any CLAUDE.md fixes — "Describe taste overlap end to end".
