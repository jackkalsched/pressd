"""The live path: a fresh rater's overlap with a few people, computed in the request
(spec §3.6, §8). The nightly run (`worker/taste_nightly.py`) computes every pair; this
recomputes only the caller, and only against the people the request is about — a
record's other raters for the people sheet, one person for a profile — so the web
service never compares anyone against the whole userbase.

It runs only when the caller is **stale**: they rated a record (`album.rated_at`) after
their stored taste vector (`tasteuser.updated_at`) was written, or have no row yet. The
sheet's recompute writes their `tasteuser` row, which makes them fresh. A profile's
recompute, against one person, writes only that pair: marking the caller fresh there
would leave the sheet that follows reading last night's numbers for every rater of the
record just rated, so a stale caller recomputes each profile they open until the sheet
or the night catches them up — one pair each time.

It is the nightly computation on fewer users, built so the numbers agree:

- cells come from the same `build_cells` over just these users' rows, and Claude's
  measurements are standardized over the whole catalog (`load_rows` with `user_ids`);
- album feature vectors come from `tasteitem`, standardized nightly across the catalog,
  never re-standardized here over a handful of albums. The caller's taste vector is
  rebuilt from them; everyone else's is read from `tasteuser`. A record rated since the
  night has no stored vector yet, so it reaches the feature layer the next night;
- a column is discounted by everyone who rated it, not by the few users loaded: the
  catalog-wide rater counts of the caller's songs, factors and album scores (the direct
  layer) are read in two grouped counts, and the artist, cluster, genre and subgenre
  counts (the category layer) are the nightly's own, stored as one `tasteitem` row
  (`raters`). A category column new since the night (an artist nobody had then) falls
  back to the loaded users' count; a column the caller joined since the night is short
  by them alone;
- no smoothing: the caller rated something since, which is exactly when the nightly
  `smooth` jumps to the new value instead of easing toward it.

A pair at 50 deletes its row, since a missing row reads as 50. A user with no taste
vector still gets a `tasteuser` row (`[]`, 0 records), which only marks them fresh; the
nightly run deletes it and writes a real row when there is one.

Connections: one read transaction, ended before computing; one write transaction. Each
commit returns the connection to SQLAlchemy's pool, where the process's other requests
can use it while this one computes. The caller's session is reused, so a request never
checks out a second connection.
"""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from datetime import datetime, timezone

from .taste_baseline import CATEGORY_TYPES, TasteVector, baseline_similarity, raters_per_column, taste_vectors
from .taste_matrix import FACTORS, Cells, Rows, build_cells, column_type, load_rows
from .taste_overlap import to_percent
from .taste_pairs import PairReasons, worth_storing

LIVE_STATUSES = "('rated', 'listening')"
RATERS_KEY = "raters"        # the tasteitem row holding the nightly's category rater counts


def category_json(cells: dict[int, Cells]) -> str:
    """The nightly's rater count of every category column (artist, cluster, genre,
    subgenre), as stored in the `raters` tasteitem row."""
    return json.dumps({k: n for k, n in sorted(raters_per_column(cells).items())
                       if column_type(k) in CATEGORY_TYPES})


def category_raters(stored: str | None) -> dict[str, int]:
    """The `raters` row read back; empty when the night hasn't written one."""
    try:
        value = json.loads(stored) if stored else {}
    except ValueError:
        return {}
    return {k: n for k, n in value.items() if isinstance(n, int)} if isinstance(value, dict) else {}


@dataclass
class LiveData:
    me: int
    rows: Rows                                  # the caller's and the others' ratings
    album_names: dict[int, str]
    features: dict[int, list[float]]            # the caller's album copies, from tasteitem
    vectors: dict[int, TasteVector]             # the others' taste vectors, from tasteuser
    raters: dict[str, int]                      # catalog-wide raters: direct columns counted, category stored


@dataclass
class LiveResult:
    vector: TasteVector | None
    pairs: list[tuple[int, int, float, float, dict | None]] = field(default_factory=list)


def _utc(t: datetime | None) -> datetime | None:
    return t.replace(tzinfo=timezone.utc) if t is not None and t.tzinfo is None else t


def is_stale(latest_rated: datetime | None, updated_at: datetime | None) -> bool:
    """Whether the caller rated a record after their stored vector was written. A user
    whose copies all predate `rated_at` has nothing newer than the nightly run."""
    if latest_rated is None:
        return False
    return updated_at is None or _utc(latest_rated) > _utc(updated_at)


def compute_live(data: LiveData) -> LiveResult:
    """The caller's taste vector and their (r -> percent, evidence, reason) against
    every other user in `data.rows`, pairs keyed (a, b) with a < b like the stored
    rows. Pure."""
    me, rows = data.me, data.rows
    cells = build_cells(rows)
    mine = Rows(songs=[s for s in rows.songs if s.user_id == me],
                albums=[a for a in rows.albums if a.user_id == me])
    vector = taste_vectors(mine, data.features).get(me)
    vectors = {u: v for u, v in data.vectors.items() if u != me}
    if vector is not None:
        vectors[me] = vector
    out = LiveResult(vector)
    if me not in cells:
        return out
    reasons = PairReasons(rows, cells, data.album_names)
    for (a, b), (r, ev) in sorted(baseline_similarity(cells, vectors, only=me, raters=data.raters).items()):
        percent = to_percent(r, ev)
        out.pairs.append((a, b, percent, ev, reasons(a, b, percent) if worth_storing(percent) else None))
    return out


# ---------------------------------------------------------------- database

def caller_state(con, me: int) -> tuple[datetime | None, datetime | None]:
    """(latest rated_at, tasteuser.updated_at) for the caller."""
    from sqlalchemy import text

    latest = con.execute(text("SELECT MAX(rated_at) FROM album WHERE user_id = :u"), {"u": me}).scalar()
    updated = con.execute(text("SELECT updated_at FROM tasteuser WHERE user_id = :u"), {"u": me}).scalar()
    return latest, updated


def load_live(con, me: int, others: set[int]) -> LiveData:
    """Everything `compute_live` reads, for the caller and `others`. The caller owns
    the connection and ends the transaction."""
    from sqlalchemy import text

    users = sorted({me} | set(others))
    rows = load_rows(con, set(users))
    names = {r.id: r.album_name or "" for r in con.execute(text(
        f"SELECT id, album_name FROM album WHERE user_id = ANY(:users) AND status IN {LIVE_STATUSES}"),
        {"users": users})}
    mine = [a for a in rows.albums if a.user_id == me]
    features: dict[int, list[float]] = {}
    keys = [f"album:{a.album_id}" for a in mine]
    if keys:
        for r in con.execute(text("SELECT column_key, vector_json FROM tasteitem WHERE column_key = ANY(:k)"),
                             {"k": keys}):
            features[int(r.column_key.split(":", 1)[1])] = json.loads(r.vector_json)
    vectors: dict[int, TasteVector] = {}
    others_list = [u for u in users if u != me]
    if others_list:
        for r in con.execute(text("SELECT user_id, vector_json, records FROM tasteuser WHERE user_id = ANY(:u)"),
                             {"u": others_list}):
            v = json.loads(r.vector_json) if r.vector_json else []
            if v:
                vectors[r.user_id] = (v, r.records)

    raters = category_raters(con.execute(text(
        "SELECT vector_json FROM tasteitem WHERE column_key = :k"), {"k": RATERS_KEY}).scalar())
    tracks = sorted({s.track_id for s in rows.songs if s.user_id == me})
    if tracks:
        for r in con.execute(text(
            "SELECT s.track_id, COUNT(DISTINCT a.user_id) AS n FROM song s JOIN album a ON a.id = s.album_id"
            f" WHERE a.status IN {LIVE_STATUSES} AND s.score IS NOT NULL AND s.track_id = ANY(:t)"
            " GROUP BY s.track_id"), {"t": tracks}):
            raters[f"s:{r.track_id}"] = r.n
    subjects = sorted({a.subject_key for a in mine if a.status == "rated" and a.subject_key})
    if subjects:
        counts = ", ".join(f"COUNT(DISTINCT user_id) FILTER (WHERE {f} IS NOT NULL) AS {f}" for f in FACTORS)
        for r in con.execute(text(
            f"SELECT subject_key, COUNT(DISTINCT user_id) FILTER (WHERE score IS NOT NULL) AS score, {counts}"
            " FROM album WHERE status = 'rated' AND subject_key = ANY(:s) GROUP BY subject_key"), {"s": subjects}):
            raters[f"A:{r.subject_key}"] = r.score
            for f in FACTORS:
                raters[f"f:{r.subject_key}:{f}"] = getattr(r, f)
    raters = {k: n for k, n in raters.items() if n}
    return LiveData(me, rows, names, features, vectors, raters)


def write_live(con, me: int, result: LiveResult, mark_fresh: bool = True) -> None:
    """Upsert every computed pair and, with `mark_fresh`, the caller's vector, in one
    transaction."""
    from sqlalchemy import text

    if mark_fresh:
        vector, records = result.vector if result.vector else ([], 0)
        con.execute(text(
            "INSERT INTO tasteuser (user_id, vector_json, records, updated_at) VALUES (:u, :v, :n, NOW())"
            " ON CONFLICT (user_id) DO UPDATE SET vector_json = EXCLUDED.vector_json,"
            " records = EXCLUDED.records, updated_at = EXCLUDED.updated_at"),
            {"u": me, "v": json.dumps([round(x, 6) for x in vector]), "n": records})
    keep = [{"a": a, "b": b, "p": round(p, 3), "ev": round(ev, 4), "r": json.dumps(reason) if reason else None}
            for a, b, p, ev, reason in result.pairs if worth_storing(p)]
    drop = [{"a": a, "b": b} for a, b, p, _ev, _r in result.pairs if not worth_storing(p)]
    if keep:
        con.execute(text(
            "INSERT INTO tasteoverlap (user_id_a, user_id_b, percent, evidence, reason_json, updated_at)"
            " VALUES (:a, :b, :p, :ev, :r, NOW())"
            " ON CONFLICT (user_id_a, user_id_b) DO UPDATE SET percent = EXCLUDED.percent,"
            " evidence = EXCLUDED.evidence, reason_json = EXCLUDED.reason_json, updated_at = EXCLUDED.updated_at"),
            keep)
    if drop:
        con.execute(text("DELETE FROM tasteoverlap WHERE user_id_a = :a AND user_id_b = :b"), drop)
    con.commit()


def refresh(con, me: int, others: set[int], mark_fresh: bool = True) -> bool:
    """Recompute the caller against `others` when the caller is stale. `con` is a
    connection or session whose `commit()` ends a transaction (a session's then
    returns its connection to SQLAlchemy's pool). Returns whether anything was
    recomputed."""
    latest, updated = caller_state(con, me)
    if not is_stale(latest, updated):
        con.commit()
        return False
    data = load_live(con, me, others)
    con.commit()            # the read ends here: no connection is held while computing
    write_live(con, me, compute_live(data), mark_fresh)
    return True
