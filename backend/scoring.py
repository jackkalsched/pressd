import statistics as _statistics

WEIGHTS = {
    "song":         1.00,
    "theme":        0.25,
    "replay_value": 0.15,
    "production":   0.15,
    "distinctness": 0.05,
}

# The four external factors share a fixed 60-point budget (each ≥ 5). A user's
# allocation is stored on PressUser and converted to weights here (weight =
# points / 100). Defaults mirror the historical global WEIGHTS above.
FACTOR_KEYS = ("theme", "replay_value", "production", "distinctness")
DEFAULT_FACTOR_POINTS = {"theme": 25, "replay_value": 15, "production": 15, "distinctness": 5}
TOTAL_FACTOR_POINTS = 60
MIN_FACTOR_POINTS = 5
# Maps a factor key to its PressUser column
_POINT_COLS = {
    "theme":        "theme_pts",
    "replay_value": "replay_pts",
    "production":   "production_pts",
    "distinctness": "distinctness_pts",
}


def get_user_points(user) -> dict:
    """A user's factor point allocation, falling back to defaults for any unset column."""
    return {
        key: (getattr(user, col) if getattr(user, col, None) is not None else DEFAULT_FACTOR_POINTS[key])
        for key, col in _POINT_COLS.items()
    }


def weights_from_points(points: dict) -> dict:
    """Convert a factor point allocation to a scoring weights dict (weight = points / 100)."""
    return {"song": 1.00, **{key: points.get(key, DEFAULT_FACTOR_POINTS[key]) / 100 for key in FACTOR_KEYS}}


def get_user_weights(user) -> dict:
    """Scoring weights for a PressUser, derived from their factor points."""
    return weights_from_points(get_user_points(user))


BANG_THRESHOLD = 8.0
SKIP_THRESHOLD = 6.5

# Albums this short are EPs: the rating flow skips the four factor ratings,
# and the album score is just the song mean (mirrors isEP in RatingScreen.tsx)
EP_MAX_TRACKS = 6


def compute_a_score(score: float) -> float:
    return (15 * score - 14) / 13


# Weight of the global prior when shrinking a thin library's factor stats,
# expressed in album-equivalents: at SHRINKAGE_K rated albums a user's own
# baseline carries equal weight with the userbase's. Derived from the variance
# components of the corpus (k = within-user variance / between-user variance),
# which implied ~3.2; 5 sits just above that, trading a little crowd bias for
# steadier scores. Worth recomputing as the userbase grows.
SHRINKAGE_K = 5

# Used only when the userbase itself has too little data to form a prior.
_COLD_PRIOR = {k: (5.0, 1.0) for k in FACTOR_KEYS}


def _fetch_factor_values(session, user_id: int | None = None) -> dict:
    """{field: [values]} over rated albums carrying a complete set of factors."""
    from sqlmodel import select
    from .models import Album

    q = select(Album).where(
        Album.status == "rated",
        Album.theme.is_not(None),
        Album.replay_value.is_not(None),
        Album.production.is_not(None),
        Album.distinctness.is_not(None),
    )
    if user_id is not None:
        q = q.where(Album.user_id == user_id)
    albums = session.exec(q).all()
    return {key: [getattr(a, key) for a in albums] for key in FACTOR_KEYS}


def get_global_factor_stats(session) -> dict:
    """{field: (mean, std)} across the whole userbase — the shrinkage prior, and
    the scale the global Pressd rating is computed on."""
    values = _fetch_factor_values(session)
    if len(next(iter(values.values()), [])) < 2:
        return dict(_COLD_PRIOR)
    return {key: (_statistics.mean(v), max(_statistics.stdev(v), 0.001))
            for key, v in values.items()}


def shrink_to_prior(values: dict, prior: dict, k: float = SHRINKAGE_K) -> dict:
    """Empirical-Bayes: pull a user's factor mean and variance toward the global
    prior, weighted by how much of their own data there is.

        mu  = (n*mu_user + k*mu_global) / (n + k)
        var = (n*var_user + k*var_global) / (n + k)

    At n=0 this is the prior outright; at n=k it is an even blend; by n>>k it
    converges on the user's own stats, so a settled library scores as it does
    today. This is what stops a 2-album library from producing a near-zero
    standard deviation, whose z-scores would otherwise pin scores to the clamp.
    """
    out = {}
    for key in FACTOR_KEYS:
        mu_g, sd_g = prior[key]
        vals = values.get(key) or []
        n = len(vals)
        if n == 0:
            out[key] = (mu_g, sd_g)
            continue
        var_u = _statistics.variance(vals) if n > 1 else 0.0
        mu = (n * _statistics.mean(vals) + k * mu_g) / (n + k)
        var = (n * var_u + k * sd_g ** 2) / (n + k)
        out[key] = (mu, max(var ** 0.5, 0.001))
    return out


def get_factor_stats(session, user_id: int | None = None, prior: dict | None = None) -> dict:
    """{field: (mean, std)} used to z-score an album's external factors.

    Without a `user_id` this is the userbase-wide distribution. With one, it is
    that user's own distribution shrunk toward the global prior, so a new user's
    scores don't swing wildly as their first few albums land. Pass `prior` to
    reuse an already-fetched global stat block instead of re-querying.
    """
    if user_id is None:
        return prior or get_global_factor_stats(session)
    prior = prior or get_global_factor_stats(session)
    return shrink_to_prior(_fetch_factor_values(session, user_id=user_id), prior)


def compute_album_score(
    song_scores: list[float],
    theme: float,
    replay_value: float,
    production: float,
    distinctness: float,
    factor_stats: dict,
    weights: dict | None = None,
) -> float:
    if not song_scores:
        return 0.0
    w = weights or WEIGHTS
    avg_song = sum(song_scores) / len(song_scores)

    def z(val, key):
        mu, sd = factor_stats[key]
        return (val - mu) / sd

    composite = (
        w["song"]         * avg_song
        + w["theme"]        * z(theme,        "theme")
        + w["replay_value"] * z(replay_value, "replay_value")
        + w["production"]   * z(production,   "production")
        + w["distinctness"] * z(distinctness, "distinctness")
    )
    # Clamp to the 1–10 display scale: above-average factors add z-score
    # bonuses on top of the song mean, which can otherwise push a standout
    # album past 10 (or a weak one below 1).
    return round(max(1.0, min(10.0, composite)), 4)


def recompute_user_scores(session, user, prior: dict | None = None) -> int:
    """Recompute (but don't commit) every rated album for one user, using their
    own factor stats (shrunk toward the global prior) and weights. Returns the
    number of albums re-scored. Pass `prior` when looping over users, so the
    global stat block is fetched once rather than per user."""
    from sqlmodel import select
    from sqlalchemy.orm import selectinload
    from .models import Album

    factor_stats = get_factor_stats(session, user_id=user.id, prior=prior)
    weights = get_user_weights(user)

    albums = session.exec(
        select(Album).where(
            Album.status == "rated",
            Album.user_id == user.id,
        ).options(selectinload(Album.songs))
    ).all()

    count = 0
    for album in albums:
        song_scores = [s.score for s in album.songs if s.score is not None]
        if not song_scores:
            continue
        has_factors = all(getattr(album, f) is not None for f in FACTOR_KEYS)
        if has_factors:
            album.score = compute_album_score(
                song_scores,
                album.theme, album.replay_value,
                album.production, album.distinctness,
                factor_stats, weights,
            )
        elif len(album.songs) <= EP_MAX_TRACKS:
            # EP: no factor ratings by design — score is the song mean
            album.score = round(sum(song_scores) / len(song_scores), 2)
        else:
            continue  # full album still awaiting factor ratings
        session.add(album)
        count += 1

    return count


def recompute_all_scores(session) -> None:
    """Recompute and persist scores for every rated album, using each user's own
    factor stats and weights. The global prior is read once and shared."""
    from sqlmodel import select
    from .models import PressUser

    prior = get_global_factor_stats(session)
    users = session.exec(select(PressUser)).all()
    for user in users:
        recompute_user_scores(session, user, prior=prior)

    session.commit()
