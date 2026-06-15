import statistics as _statistics

WEIGHTS = {
    "song":         1.00,
    "theme":        0.25,
    "replay_value": 0.15,
    "production":   0.15,
    "distinctness": 0.05,
}

BANG_THRESHOLD = 8.0
SKIP_THRESHOLD = 6.5


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
) -> float:
    if not song_scores:
        return 0.0
    avg_song = sum(song_scores) / len(song_scores)

    def z(val, key):
        mu, sd = factor_stats[key]
        return (val - mu) / sd

    return round(
        WEIGHTS["song"]         * avg_song
        + WEIGHTS["theme"]        * z(theme,        "theme")
        + WEIGHTS["replay_value"] * z(replay_value, "replay_value")
        + WEIGHTS["production"]   * z(production,   "production")
        + WEIGHTS["distinctness"] * z(distinctness, "distinctness"),
        4,
    )


def recompute_all_scores(session) -> None:
    """Recompute and persist scores for every rated album, using each user's own factor stats."""
    from sqlmodel import select
    from sqlalchemy.orm import selectinload
    from .models import Album, PressUser

    user_ids = [uid for (uid,) in session.exec(select(PressUser.id)).all()]

    for user_id in user_ids:
        factor_stats = get_factor_stats(session, user_id=user_id)

        albums = session.exec(
            select(Album).where(
                Album.status == "rated",
                Album.user_id == user_id,
                Album.theme.is_not(None),
                Album.replay_value.is_not(None),
                Album.production.is_not(None),
                Album.distinctness.is_not(None),
            ).options(selectinload(Album.songs))
        ).all()

        for album in albums:
            song_scores = [s.score for s in album.songs if s.score is not None]
            if song_scores:
                album.score = compute_album_score(
                    song_scores,
                    album.theme, album.replay_value,
                    album.production, album.distinctness,
                    factor_stats,
                )
                session.add(album)

    session.commit()
