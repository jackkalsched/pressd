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


def get_factor_stats(session, user_id: int | None = None) -> dict:
    """Return {field: (mean, std)} from rated albums with complete factors, scoped to a user."""
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

    if len(albums) < 2:
        return {k: (5.0, 1.0) for k in ["theme", "replay_value", "production", "distinctness"]}

    def _s(vals):
        return (_statistics.mean(vals), max(_statistics.stdev(vals), 0.001))

    return {
        "theme":        _s([a.theme        for a in albums]),
        "replay_value": _s([a.replay_value for a in albums]),
        "production":   _s([a.production   for a in albums]),
        "distinctness": _s([a.distinctness for a in albums]),
    }


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


def recompute_user_scores(session, user) -> int:
    """Recompute (but don't commit) every rated album for one user, using their
    own factor stats and weights. Returns the number of albums re-scored."""
    from sqlmodel import select
    from sqlalchemy.orm import selectinload
    from .models import Album

    factor_stats = get_factor_stats(session, user_id=user.id)
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
    """Recompute and persist scores for every rated album, using each user's own factor stats and weights."""
    from sqlmodel import select
    from .models import PressUser

    users = session.exec(select(PressUser)).all()
    for user in users:
        recompute_user_scores(session, user)

    session.commit()
