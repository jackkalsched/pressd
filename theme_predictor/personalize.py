"""
Per-user theme and distinctness, from one LLM pass per album.

The two factors are handled deliberately differently, because they carry very
different weight in a score.

THEME — the LLM measures the *record*, once, into a vector of album-intrinsic
semantic axes (narrative arc, concept unity, sequencing intent, …; see
theme_predictor.theme_analysis). Each user then gets a ridge regression fitted
over those axes against their own theme ratings, so the rubric is learned from
what they actually do rather than written into a prompt as one person's taste.
Two users who disagree about whether a tight concept beats great writing end up
with genuinely different coefficients over the same measurements.

    prediction = w · personal_ridge(axes) + (1 − w) · pooled_ridge(axes) → user scale
    w = n / (n + THEME_BLEND_K)

The pooled ridge is fitted across every user's ratings on per-user z-scores, so
a listener with three ratings still gets album-to-album variation instead of
their own mean repeated. As their library grows, w carries them onto their own
coefficients with no cliff. If an album has no axes yet (nothing has been
analysed), theme falls back to the Layer 1 path below.

DISTINCTNESS — a single global scalar, rescaled onto the user's own mean and
spread ("Layer 1"), and nothing more. It correlates with the album score at
0.36 where theme reaches 0.69, and carries a 0.05 weight against theme's 0.25,
so a fitted per-user model over it would move a composite by hundredths. The
axis breakdown and the second fit are not worth their cost here.

Layer 1 (affine recalibration) remains the shared foundation of both: z-score
against the global distribution, then map onto the user's (mu, sd). It is what
recovers the bulk of between-user variance, since one user averages 4.98 on
theme and another 8.35.

Pure stdlib on purpose — including the ridge solver. The web service imports
this via predict_single, and its requirements.txt carries no numpy or
scikit-learn.
"""
import json
import math

from sqlalchemy import text

# The global raw scale is arbitrary — Layer 1 z-scores it away before anything
# downstream sees it, so only the ordering and relative spread of the stored
# values carry meaning. These constants just keep the LLM anchored somewhere
# stable across runs.
GLOBAL_REF_MU = 5.0
GLOBAL_REF_SD = 1.7

# Layer 1 needs a mean and a spread; two ratings is the arithmetic minimum and
# a degenerate sd is caught separately below.
MIN_ALBUMS_FOR_RECAL = 2

# Ridge penalty. With standardised features, (X'X + λI)⁻¹X'y shrinks the fit by
# roughly n/(n+λ), so λ is readable as "how many albums of evidence it takes
# before the user's own coefficients outweigh the assumption that they are
# zero". Deliberately the same scale as THEME_BLEND_K.
RIDGE_LAMBDA = 25.0

# Rated albums at which a user's personal ridge carries half the prediction.
THEME_BLEND_K = 25.0

# Below this a personal ridge isn't fitted at all — the pooled one is used
# outright. Fewer points than axes cannot identify coefficients no matter how
# hard they are penalised.
MIN_ALBUMS_FOR_THEME_RIDGE = 12

# album.<column> for each factor, and the albumfactors column it derives from.
FACTORS = {
    "theme": "theme_raw",
    "distinctness": "distinctness_raw",
}


def _cols(factor: str) -> tuple[str, str]:
    """(album column, albumfactors column) for a factor name.

    Both are interpolated into SQL — a column name can't be a bind parameter —
    so the name is checked against the known set here rather than trusted.
    Every caller passes a literal today; this keeps that true if one ever
    starts passing something through from elsewhere.
    """
    if factor not in FACTORS:
        raise ValueError(f"unknown factor {factor!r}; expected one of {sorted(FACTORS)}")
    return factor, FACTORS[factor]


def _mean_sd(xs: list[float]) -> tuple[float, float]:
    """Population mean and sd. sd of 0 (or a single point) returns 1.0 so
    callers can divide unconditionally."""
    if not xs:
        return 0.0, 1.0
    mu = sum(xs) / len(xs)
    var = sum((x - mu) ** 2 for x in xs) / len(xs)
    sd = math.sqrt(var)
    return mu, (sd if sd > 1e-9 else 1.0)


def _decade(year) -> int | None:
    return (int(year) // 10) * 10 if year else None


def _norm_genre(genre) -> str:
    return (genre or "").strip().lower() or "unknown"


# ── Layer 1: affine recalibration ────────────────────────────────────────────

def global_stats(con, factor: str) -> tuple[float, float]:
    """(mu, sd) of the stored global raw values for one factor.

    Measured rather than assumed: the LLM's realised spread drifts from
    GLOBAL_REF_SD, and it's the realised one that has to be divided out.
    """
    _, col = _cols(factor)
    rows = con.execute(text(
        f"SELECT {col} FROM albumfactors WHERE {col} IS NOT NULL")).fetchall()
    vals = [float(r[0]) for r in rows]
    if len(vals) < 2:
        return GLOBAL_REF_MU, GLOBAL_REF_SD
    return _mean_sd(vals)


def user_stats(con, factor: str, user_id: int) -> tuple[float, float] | None:
    """(mu, sd) of one user's own ratings for a factor, or None below the
    Layer 1 gate."""
    factor, _ = _cols(factor)
    rows = con.execute(text(
        f"SELECT {factor} FROM album"
        f" WHERE status = 'rated' AND user_id = :uid AND {factor} IS NOT NULL"),
        {"uid": user_id}).fetchall()
    vals = [float(r[0]) for r in rows]
    if len(vals) < MIN_ALBUMS_FOR_RECAL:
        return None
    return _mean_sd(vals)


def recalibrate(raw: float, gstats: tuple[float, float],
                ustats: tuple[float, float]) -> float:
    """Global raw → the user's scale. Rank order within the user is preserved
    exactly; only the location and spread change."""
    g_mu, g_sd = gstats
    u_mu, u_sd = ustats
    z = (raw - g_mu) / g_sd
    return z * u_sd + u_mu


def _raw_by_key(con, factor: str) -> dict[str, float]:
    """album_key → global raw value for one factor.

    Loaded whole and joined in Python because album_key is the output of
    trackkeys.album_key (feat-credits and punctuation stripped, "&"→"and") —
    a SQL concat of artist and album_name would silently miss most rows. The
    table is one row per distinct album, so this stays small.
    """
    _, col = _cols(factor)
    return {
        r[0]: float(r[1])
        for r in con.execute(text(
            f"SELECT album_key, {col} FROM albumfactors WHERE {col} IS NOT NULL")
        ).fetchall()
    }


def _features_by_key(con) -> dict[str, dict]:
    """album_key → {axis: value} for every analysed album."""
    out = {}
    for key, blob in con.execute(text(
        "SELECT album_key, theme_features FROM albumfactors"
        " WHERE theme_features IS NOT NULL")).fetchall():
        try:
            feats = json.loads(blob)
        except (ValueError, TypeError):
            continue
        if isinstance(feats, dict) and feats:
            out[key] = feats
    return out


# ── Ridge regression, pure stdlib ────────────────────────────────────────────

def _solve(A: list[list[float]], b: list[float]) -> list[float] | None:
    """Gaussian elimination with partial pivoting. None if singular.

    The systems here are (number of axes)² — currently 11×11 — so a dense
    textbook solve is the right tool and keeps numpy out of the web service's
    dependency set.
    """
    n = len(b)
    M = [row[:] + [b[i]] for i, row in enumerate(A)]
    for col in range(n):
        pivot = max(range(col, n), key=lambda r: abs(M[r][col]))
        if abs(M[pivot][col]) < 1e-12:
            return None
        M[col], M[pivot] = M[pivot], M[col]
        pv = M[col][col]
        for r in range(col + 1, n):
            f = M[r][col] / pv
            if f:
                for c in range(col, n + 1):
                    M[r][c] -= f * M[col][c]
    x = [0.0] * n
    for r in range(n - 1, -1, -1):
        s = M[r][n] - sum(M[r][c] * x[c] for c in range(r + 1, n))
        x[r] = s / M[r][r]
    return x


class ThemeRidge:
    """A fitted mapping from an album's semantic axes to a theme score.

    Features are standardised and the target centred at fit time, so a fully
    penalised model predicts the training mean rather than zero — the sensible
    thing to say when a user's ratings reveal no preference.
    """

    def __init__(self, axes: tuple, coef: list[float], intercept: float,
                 mu: list[float], sd: list[float], n: int):
        self.axes = axes
        self.coef = coef
        self.intercept = intercept
        self.mu = mu
        self.sd = sd
        self.n = n

    def predict(self, feats: dict) -> float | None:
        if not feats:
            return None
        total = self.intercept
        for j, axis in enumerate(self.axes):
            v = feats.get(axis)
            if v is None:
                continue  # unmeasured axis contributes nothing
            total += self.coef[j] * ((float(v) - self.mu[j]) / self.sd[j])
        return total

    def describe(self, top: int = 4) -> str:
        """The axes this user weights most, for the run log."""
        ranked = sorted(zip(self.axes, self.coef), key=lambda kv: abs(kv[1]), reverse=True)
        return ", ".join(f"{a}{c:+.2f}" for a, c in ranked[:top]) or "(flat)"


def fit_theme_ridge(samples: list[tuple[dict, float]], axes: tuple,
                    lam: float = RIDGE_LAMBDA) -> ThemeRidge | None:
    """Fit axes → score. `samples` is [(features, target)]."""
    rows = [(f, y) for f, y in samples if f and y is not None]
    if len(rows) < 3:
        return None

    k = len(axes)
    X = [[float(f.get(a, math.nan)) for a in axes] for f, _ in rows]
    y = [float(t) for _, t in rows]

    # Column stats over measured values only; an unmeasured axis falls back to
    # its own mean, which standardises to 0 and drops out of the prediction.
    mu, sd = [], []
    for j in range(k):
        vals = [r[j] for r in X if not math.isnan(r[j])]
        m, s = _mean_sd(vals) if vals else (0.0, 1.0)
        mu.append(m)
        sd.append(s)
    Z = [[0.0 if math.isnan(r[j]) else (r[j] - mu[j]) / sd[j] for j in range(k)]
         for r in X]

    y_mean = sum(y) / len(y)
    yc = [v - y_mean for v in y]

    # Normal equations with the ridge penalty on the diagonal.
    A = [[sum(Z[i][a] * Z[i][b] for i in range(len(Z))) + (lam if a == b else 0.0)
          for b in range(k)] for a in range(k)]
    rhs = [sum(Z[i][a] * yc[i] for i in range(len(Z))) for a in range(k)]

    coef = _solve(A, rhs)
    if coef is None:
        return None
    return ThemeRidge(axes, coef, y_mean, mu, sd, len(rows))


# ── Per-user theme model ─────────────────────────────────────────────────────

def _theme_samples(con, user_id: int | None, features: dict[str, dict]
                   ) -> list[tuple[dict, float]]:
    """[(axes, theme)] from rated albums. user_id=None pools every user, with
    each one's ratings z-scored within their own distribution first so the
    pooled target means the same thing across listeners."""
    from backend.trackkeys import album_key

    where = "AND user_id = :uid" if user_id is not None else ""
    params = {"uid": user_id} if user_id is not None else {}
    rows = con.execute(text(
        f"SELECT artist, album_name, theme, user_id FROM album"
        f" WHERE status = 'rated' AND theme IS NOT NULL {where}"), params).fetchall()

    if user_id is None:
        by_user: dict[int, list[float]] = {}
        for _, _, theme, uid in rows:
            by_user.setdefault(uid, []).append(float(theme))
        stats = {uid: _mean_sd(v) for uid, v in by_user.items() if len(v) >= 2}
        out = []
        for artist, name, theme, uid in rows:
            st = stats.get(uid)
            feats = features.get(album_key(artist, name))
            if st is None or feats is None:
                continue
            out.append((feats, (float(theme) - st[0]) / st[1]))
        return out

    return [(features[k], float(theme))
            for artist, name, theme, _ in rows
            if (k := album_key(artist, name)) in features]


class UserThemeModel:
    """Blended personal + pooled ridge over the album's semantic axes, with the
    Layer 1 scalar path as the fallback for albums that were never analysed."""

    def __init__(self, user_id: int, personal, pooled, ustats, gstats, weight: float):
        self.user_id = user_id
        self.personal = personal
        self.pooled = pooled
        self.ustats = ustats
        self.gstats = gstats
        self.weight = weight

    @property
    def source(self) -> str:
        if self.personal is None and self.pooled is None:
            return "layer1"
        if self.personal is None:
            return "pooled"
        return f"blend({self.weight:.2f} personal, n={self.personal.n})"

    def predict(self, feats: dict | None, raw: float | None = None,
                genre=None, year=None) -> float | None:
        vals, weights = [], []

        if feats:
            if self.personal is not None:
                p = self.personal.predict(feats)
                if p is not None:
                    vals.append(p)
                    weights.append(self.weight)
            if self.pooled is not None:
                z = self.pooled.predict(feats)
                if z is not None:
                    # Pooled ridge is fitted on z-scores; Layer 1 puts it on
                    # this user's scale.
                    mu, sd = self.ustats or (GLOBAL_REF_MU, GLOBAL_REF_SD)
                    vals.append(z * sd + mu)
                    weights.append(1.0 - self.weight if self.personal else 1.0)

        if not vals:
            # Never analysed — fall back to the single global scalar.
            if raw is None:
                return None
            value = float(raw)
            if self.ustats is not None:
                value = recalibrate(value, self.gstats, self.ustats)
            return round(max(1.0, min(10.0, value)), 1)

        total_w = sum(weights) or 1.0
        blended = sum(v * w for v, w in zip(vals, weights)) / total_w
        return round(max(1.0, min(10.0, blended)), 1)


def fit_user_theme_model(con, user_id: int, features=None, pooled=None) -> UserThemeModel:
    """Both ridges for one user, plus the Layer 1 stats behind the fallback.

    Pass `features` and `pooled` when looping over users — they are identical
    for everyone and refitting the pooled ridge per user is pure waste.
    """
    from .theme_analysis import THEME_AXES

    if features is None:
        features = _features_by_key(con)
    if pooled is None:
        pooled = fit_pooled_theme_model(con, features)

    gstats = global_stats(con, "theme")
    ustats = user_stats(con, "theme", user_id)

    own = _theme_samples(con, user_id, features)
    personal = (fit_theme_ridge(own, THEME_AXES)
                if len(own) >= MIN_ALBUMS_FOR_THEME_RIDGE else None)
    n = personal.n if personal else 0
    weight = n / (n + THEME_BLEND_K) if personal else 0.0
    return UserThemeModel(user_id, personal, pooled, ustats, gstats, weight)


def fit_pooled_theme_model(con, features=None):
    """One ridge over every user's theme ratings, on per-user z-scores. The
    cold-start prior: it supplies album-to-album variation to a user who has
    rated far too little to have coefficients of their own."""
    from .theme_analysis import THEME_AXES

    if features is None:
        features = _features_by_key(con)
    samples = _theme_samples(con, None, features)
    model = fit_theme_ridge(samples, THEME_AXES)
    if model is not None:
        print(f"[personalize] pooled theme ridge: {model.n} ratings — {model.describe()}")
    return model


# ── One object per user, covering both factors ───────────────────────────────

class FactorPredictor:
    """Theme and distinctness for any album, by key.

    Holds the fitted models *and* the album_key lookups, so callers ask one
    question — "what does this user think of this album?" — without knowing
    that theme is a ridge over semantic axes while distinctness is a rescaled
    scalar. Built once per user; every `predict` after that is arithmetic.
    """

    def __init__(self, con, user_id: int, features=None, pooled_theme=None):
        self.user_id = user_id
        self.features = features if features is not None else _features_by_key(con)
        self.theme = fit_user_theme_model(con, user_id, self.features, pooled_theme)
        self.theme_raw = _raw_by_key(con, "theme")
        self.dist_raw = _raw_by_key(con, "distinctness")
        self.dist_gstats = global_stats(con, "distinctness")
        self.dist_ustats = user_stats(con, "distinctness", user_id)

    def predict(self, album_key: str, genre=None, year=None
                ) -> tuple[float | None, float | None]:
        theme = self.theme.predict(
            self.features.get(album_key), self.theme_raw.get(album_key), genre, year)

        raw = self.dist_raw.get(album_key)
        if raw is None:
            dist = None
        else:
            v = float(raw)
            if self.dist_ustats is not None:
                v = recalibrate(v, self.dist_gstats, self.dist_ustats)
            dist = round(max(1.0, min(10.0, v)), 1)
        return theme, dist

    @property
    def summary(self) -> str:
        return (f"theme={self.theme.source}"
                + (f" [{self.theme.personal.describe()}]" if self.theme.personal else "")
                + f", distinctness={'rescaled' if self.dist_ustats else 'global'}")


def apply_user_factors(con, user_id: int, predictor: "FactorPredictor" = None) -> dict:
    """Write predicted_theme + predicted_distinctness for the user's unrated albums.

    Replaces both the per-copy LLM call and normalize_predicted_themes: the
    values already land on the user's own scale, so a second normalisation pass
    would only add drift.
    """
    from backend.trackkeys import album_key

    if predictor is None:
        predictor = FactorPredictor(con, user_id)

    rows = con.execute(text("""
        SELECT id, genre, year, artist, album_name FROM album
        WHERE status IN ('to_listen', 'listening') AND user_id = :uid
    """), {"uid": user_id}).fetchall()

    updated, missing = 0, 0
    for album_id, genre, year, artist, album_name in rows:
        theme, dist = predictor.predict(album_key(artist, album_name), genre, year)
        if theme is None and dist is None:
            missing += 1
            continue
        con.execute(text(
            "UPDATE album SET predicted_theme = COALESCE(:t, predicted_theme),"
            " predicted_distinctness = COALESCE(:d, predicted_distinctness)"
            " WHERE id = :id"),
            {"t": theme, "d": dist, "id": album_id})
        updated += 1
    con.commit()

    print(f"[personalize] user {user_id}: {updated}/{len(rows)} albums "
          f"({missing} unanalysed) — {predictor.summary}")
    return {
        "albums": updated,
        "unanalysed": missing,
        "theme_model": predictor.theme.source,
    }
