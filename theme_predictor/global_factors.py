"""
The global pass: one LLM call per album, ever, for the whole userbase.

Results land in `albumfactors`, keyed by normalized artist+album (the same key
`AlbumCorpus` uses), so no user ever triggers a second call for an album
someone else already added.

The two factors are gathered differently, on purpose:

  * THEME is *measured*, not scored — a vector of album-intrinsic semantic axes
    (theme_predictor.theme_analysis) describing the record itself, with no
    listener in the prompt at all. Each user's theme prediction is then a ridge
    fitted over those axes against their own ratings. This replaced a prompt
    that opened "You are predicting a personal music score for Jack" — with
    Jack's baseline and Jack's penalty table — for every user in the system.

  * DISTINCTNESS stays a single scalar on a shared reference scale, because it
    is worth 0.05 in a composite and a per-user model over it would move a
    score by hundredths. Its RAG examples span the score range rather than
    being the top five: the old query ordered by `distinctness DESC`, anchoring
    the model at the high end of a scale it was then asked to use the middle of.
"""
import json

from sqlalchemy import text

from .personalize import GLOBAL_REF_MU, GLOBAL_REF_SD

# The example set is pooled across users, so it has to be put on one scale
# first: each user's ratings are z-scored within their own distribution and
# mapped onto the arbitrary global reference. Without this, one user's 8.4
# average and another's 4.98 would be presented to the LLM as if comparable.
_MIN_RATINGS_TO_ANCHOR = 8

GLOBAL_SUBJECT = "the reference listener"


def _anchor_examples(con, factor: str, genre: str | None, k: int = 6) -> list[dict]:
    """Rated albums spanning the score range, on the shared reference scale.

    Prefers same-genre albums inside each band so the anchor is comparable to
    the target, but never at the cost of covering the range.
    """
    rows = con.execute(text(f"""
        SELECT id, artist, album_name, genre, {factor}, user_id
        FROM album
        WHERE status = 'rated' AND {factor} IS NOT NULL AND user_id IS NOT NULL
    """)).fetchall()
    if not rows:
        return []

    # Per-user (mu, sd) so each rating can be expressed as a z-score.
    by_user: dict[int, list[float]] = {}
    for r in rows:
        by_user.setdefault(r[5], []).append(float(r[4]))

    stats: dict[int, tuple[float, float]] = {}
    for uid, vals in by_user.items():
        if len(vals) < _MIN_RATINGS_TO_ANCHOR:
            continue  # too few to locate their scale — they can't anchor anyone
        mu = sum(vals) / len(vals)
        var = sum((v - mu) ** 2 for v in vals) / len(vals)
        sd = var ** 0.5
        stats[uid] = (mu, sd if sd > 1e-9 else 1.0)

    scaled = []
    for aid, artist, album_name, g, val, uid in rows:
        st = stats.get(uid)
        if st is None:
            continue
        z = (float(val) - st[0]) / st[1]
        ref = max(1.0, min(10.0, z * GLOBAL_REF_SD + GLOBAL_REF_MU))
        scaled.append({"album_id": aid, "artist": artist, "album_name": album_name,
                       "genre": g, "theme_score": round(ref, 1)})
    if not scaled:
        return []

    # One example per score band, so the anchor covers the scale end to end.
    bands = [(1.0, 3.5), (3.5, 5.0), (5.0, 6.5), (6.5, 8.0), (8.0, 10.01)]
    want_genre = (genre or "").strip().lower()
    picked: list[dict] = []
    for lo, hi in bands:
        band = [s for s in scaled if lo <= s["theme_score"] < hi]
        if not band:
            continue
        same = [s for s in band if (s["genre"] or "").strip().lower() == want_genre]
        picked.append((same or band)[0])

    # Backfill toward k with whatever is left, nearest the middle of the scale.
    if len(picked) < k:
        chosen = {s["album_id"] for s in picked}
        rest = sorted((s for s in scaled if s["album_id"] not in chosen),
                      key=lambda s: abs(s["theme_score"] - GLOBAL_REF_MU))
        picked.extend(rest[:k - len(picked)])
    return picked[:k]


def _corpora_for(examples: list[dict]) -> dict[int, dict]:
    from .predict_single import _rag_corpus
    return {e["album_id"]: _rag_corpus(e["artist"], e["album_name"], e.get("genre"))
            for e in examples}


def get_global_factors(con, artist: str, album_name: str) -> dict | None:
    """Stored global row for an album, or None if it has never been scored."""
    from backend.trackkeys import album_key

    row = con.execute(text(
        "SELECT theme_raw, theme_reasoning, distinctness_raw, distinctness_reasoning,"
        " theme_features FROM albumfactors WHERE album_key = :k"),
        {"k": album_key(artist, album_name)}).fetchone()
    if not row:
        return None
    return {"theme_raw": row[0], "theme_reasoning": row[1],
            "distinctness_raw": row[2], "distinctness_reasoning": row[3],
            "theme_features": row[4]}


def ensure_global_factors(con, artist: str, album_name: str,
                          year: int | None = None, genre: str | None = None,
                          album_id: int | None = None,
                          force: bool = False) -> dict | None:
    """Score an album globally if it hasn't been scored yet; return its factors.

    Idempotent and safe to call on every add — the whole point is that the
    second caller for a given album pays nothing. Each factor is attempted
    independently so one failure doesn't discard the other.
    """
    from backend.trackkeys import album_key

    key = album_key(artist, album_name)
    existing = get_global_factors(con, artist, album_name)
    if (existing and not force
            and existing.get("theme_features") is not None
            and existing["distinctness_raw"] is not None):
        return existing

    from .corpus import load_or_build_corpus
    from .predictor import LLM_MODEL
    from .distinctness_predictor import predict_distinctness

    corpus = load_or_build_corpus(album_id or 0, artist, album_name, year, None)
    corpus["genre"] = genre

    # Theme: measure the record along its semantic axes. No RAG examples and no
    # listener in the prompt — the axes are properties of the album, and every
    # user's weighting of them is fitted from their own ratings downstream.
    theme_features = theme_raw = theme_reason = None
    if force or not existing or existing.get("theme_features") is None:
        try:
            from .theme_analysis import analyze_theme
            axes, overall, reason = analyze_theme(corpus)
            if axes:
                theme_features = json.dumps(axes)
            theme_raw, theme_reason = overall, reason
        except Exception as e:
            print(f"[global_factors] theme analysis failed for {artist} – {album_name}: {e}")
    else:
        theme_features = existing.get("theme_features")
        theme_raw, theme_reason = existing["theme_raw"], existing["theme_reasoning"]

    dist_raw = dist_reason = None
    if force or not existing or existing["distinctness_raw"] is None:
        try:
            examples = _anchor_examples(con, "distinctness", genre)
            dist_raw, dist_reason = predict_distinctness(
                corpus, examples, _corpora_for(examples),
                subject=GLOBAL_SUBJECT, baseline=GLOBAL_REF_MU)
        except Exception as e:
            print(f"[global_factors] distinctness failed for {artist} – {album_name}: {e}")
    else:
        dist_raw, dist_reason = existing["distinctness_raw"], existing["distinctness_reasoning"]

    if theme_features is None and theme_raw is None and dist_raw is None:
        return existing

    store_global_factors(con, key, artist, album_name, genre, year, theme_features,
                         theme_raw, theme_reason, dist_raw, dist_reason, LLM_MODEL)
    return get_global_factors(con, artist, album_name)


def analyze_album(artist: str, album_name: str, year: int | None, genre: str | None,
                  album_id: int | None = None, anchors: list[dict] | None = None,
                  anchor_corpora: dict | None = None) -> dict:
    """Everything an album's scoring needs from the LLM, holding no connection.

    Split out from ensure_global_factors so a bulk run can hold a database
    connection for the millisecond of the write instead of the ten seconds of
    the API calls. Supabase's session-mode pooler allows 15 clients across the
    *whole project* — the web service included — so a worker that keeps a
    connection open across its LLM calls will starve the live app long before
    it saturates the model provider.
    """
    from .corpus import load_or_build_corpus
    from .theme_analysis import analyze_theme
    from .distinctness_predictor import predict_distinctness

    corpus = load_or_build_corpus(album_id or 0, artist, album_name, year, None)
    corpus["genre"] = genre

    out = {"theme_features": None, "theme_raw": None, "theme_reasoning": None,
           "distinctness_raw": None, "distinctness_reasoning": None, "error": None}
    try:
        axes, overall, reason = analyze_theme(corpus)
        if axes:
            out["theme_features"] = json.dumps(axes)
        out["theme_raw"], out["theme_reasoning"] = overall, reason
    except Exception as e:
        out["error"] = f"theme: {type(e).__name__}: {e}"
        print(f"[global_factors] {artist} – {album_name} — {out['error']}", flush=True)

    try:
        out["distinctness_raw"], out["distinctness_reasoning"] = predict_distinctness(
            corpus, anchors or [], anchor_corpora or {},
            subject=GLOBAL_SUBJECT, baseline=GLOBAL_REF_MU)
    except Exception as e:
        err = f"distinctness: {type(e).__name__}: {e}"
        out["error"] = f"{out['error']}; {err}" if out["error"] else err
        print(f"[global_factors] {artist} – {album_name} — {err}", flush=True)
    return out


def store_global_factors(con, key, artist, album_name, genre, year, theme_features,
                         theme_raw, theme_reason, dist_raw, dist_reason, model):
    """Persist one album's global factors. Nulls never overwrite stored values."""
    con.execute(text("""
        INSERT INTO albumfactors
            (album_key, artist, album_name, genre, year, theme_features, theme_raw,
             theme_reasoning, distinctness_raw, distinctness_reasoning, model, computed_at)
        VALUES (:k, :ar, :al, :g, :y, :tf, :t, :tr, :d, :dr, :m, NOW())
        ON CONFLICT (album_key) DO UPDATE SET
            theme_features = COALESCE(EXCLUDED.theme_features, albumfactors.theme_features),
            theme_raw = COALESCE(EXCLUDED.theme_raw, albumfactors.theme_raw),
            theme_reasoning = COALESCE(EXCLUDED.theme_reasoning, albumfactors.theme_reasoning),
            distinctness_raw = COALESCE(EXCLUDED.distinctness_raw, albumfactors.distinctness_raw),
            distinctness_reasoning = COALESCE(EXCLUDED.distinctness_reasoning, albumfactors.distinctness_reasoning),
            genre = COALESCE(EXCLUDED.genre, albumfactors.genre),
            year = COALESCE(EXCLUDED.year, albumfactors.year),
            model = EXCLUDED.model,
            computed_at = NOW()
    """), {"k": key, "ar": artist, "al": album_name, "g": genre, "y": year,
           "tf": theme_features, "t": theme_raw, "tr": theme_reason,
           "d": dist_raw, "dr": dist_reason, "m": model})
    con.commit()


def albums_missing_factors(con, limit: int | None = None) -> list[tuple]:
    """One representative album row per distinct album that has no complete
    global scoring yet. Copies collapse — that's the saving."""
    from backend.trackkeys import album_key

    rows = con.execute(text("""
        SELECT id, artist, album_name, year, genre FROM album ORDER BY id
    """)).fetchall()
    have = {
        r[0] for r in con.execute(text(
            "SELECT album_key FROM albumfactors"
            " WHERE theme_features IS NOT NULL AND distinctness_raw IS NOT NULL")).fetchall()
    }

    seen, out = set(), []
    for aid, artist, album_name, year, genre in rows:
        key = album_key(artist, album_name)
        if key in have or key in seen:
            continue
        seen.add(key)
        out.append((aid, artist, album_name, year, genre))
    return out[:limit] if limit else out
