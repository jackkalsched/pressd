import statistics as _statistics
from collections import defaultdict

WEIGHTS = {
    "song":         1.00,
    "theme":        0.25,
    "replay_value": 0.15,
    "production":   0.15,
    "distinctness": 0.05,
}

BANG_THRESHOLD = 8.0
SKIP_THRESHOLD = 6.5

# Albums in a genre needed for 50% genre weight (credibility constant)
GENRE_K = 10


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


def get_genre_factor_stats(session, user_id: int) -> dict:
    """Return {genre: {field: (mean, std, n)}} for genres with ≥2 rated albums."""
    from sqlmodel import select
    from .models import Album

    albums = session.exec(
        select(Album).where(
            Album.status == "rated",
            Album.user_id == user_id,
            Album.theme.is_not(None),
            Album.replay_value.is_not(None),
            Album.production.is_not(None),
            Album.distinctness.is_not(None),
            Album.genre.is_not(None),
        )
    ).all()

    by_genre: dict[str, list] = defaultdict(list)
    for a in albums:
        by_genre[a.genre].append(a)

    result = {}
    for genre, ga in by_genre.items():
        n = len(ga)
        if n < 2:
            continue
        def _s(vals, _n=n):
            return (_statistics.mean(vals), max(_statistics.stdev(vals), 0.001), _n)
        result[genre] = {
            "theme":        _s([a.theme        for a in ga]),
            "replay_value": _s([a.replay_value for a in ga]),
            "production":   _s([a.production   for a in ga]),
            "distinctness": _s([a.distinctness for a in ga]),
        }
    return result


def blended_z(val: float, key: str, global_stats: dict,
               genre: str | None, genre_stats: dict) -> float:
    """Credibility-weighted blend of genre and global z-scores.
    α = n / (n + GENRE_K) so genre weight grows with sample size."""
    g_mu, g_sd = global_stats[key]
    z_global = (val - g_mu) / g_sd

    if genre and genre in genre_stats and key in genre_stats[genre]:
        gn_mu, gn_sd, n = genre_stats[genre][key]
        z_genre = (val - gn_mu) / gn_sd
        alpha = n / (n + GENRE_K)
        return alpha * z_genre + (1 - alpha) * z_global

    return z_global


def compute_album_score(
    song_scores: list[float],
    theme: float,
    replay_value: float,
    production: float,
    distinctness: float,
    factor_stats: dict,
    genre: str | None = None,
    genre_factor_stats: dict | None = None,
) -> float:
    if not song_scores:
        return 0.0
    avg_song = sum(song_scores) / len(song_scores)

    gfs = genre_factor_stats or {}

    def z(val, key):
        return blended_z(val, key, factor_stats, genre, gfs)

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

    user_ids = list(session.exec(select(PressUser.id)).all())

    for user_id in user_ids:
        factor_stats = get_factor_stats(session, user_id=user_id)
        genre_factor_stats = get_genre_factor_stats(session, user_id=user_id)

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
                    genre=album.genre,
                    genre_factor_stats=genre_factor_stats,
                )
                session.add(album)

    session.commit()
