"""One global artist clustering, fit per nightly run, read by every user.

The map exists to answer "what else sounds like this?" for a record nobody has
heard. Membership therefore cannot depend on anyone having rated the artist —
that gate excluded exactly the artists the feature is for. Nothing in this
matrix is a score, a rating, or a user id: it is audio centroid, genre one-hot
and subgenre multi-hot, and it is identical for every user.

What *is* per-user is the number read out of a cluster once it exists. See
`cluster_value` and the tier table in PLAN_global_artist_clusters.md §3.3 — the
user's own values wherever their library reaches, and a scale-corrected global
figure where it doesn't.

Lives outside song_score_model.py because it needs a DB connection and that
module is already 1,200 lines of pure frame-in/frame-out.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone

import numpy as np
import pandas as pd
from sklearn.cluster import KMeans
from sklearn.preprocessing import StandardScaler
from sqlalchemy import text

from backend.trackkeys import album_key, artist_key
from song_score_model import (
    AUDIO_FEATURES,
    N_CLUSTER_SEEDS,
    _SUBGENRE_MIN_ARTISTS,
    _norm_tag,
    build_features,
    expand_mfcc,
)

# ~20 artists per cluster over a 372-artist universe. Coverage does not
# constrain this — a cluster holding none of the user's rated artists is still
# a good answer, it just gets answered from the global tier — so k is free to be
# tuned on separation alone. Validate with `diagnostics()` before moving it.
ARTIST_K = 18

# Rated cluster-mates needed before the user's own mean outweighs the global
# figure. One mate is a single album's opinion — noisier than the calibrated
# global value it would be replacing — so the handover is a shrink, not a cliff.
MATE_PRIOR = 3.0

# Every analyzed track, with the album meta the matrix needs. No score filter
# and no minimum-rater filter: both belong to the pooled training target, not to
# who exists in the space.
_UNIVERSE_SQL = text("""
    SELECT a.artist AS album_artist, a.album_name, a.genre,
           a.sub_genre1, a.sub_genre2, a.sub_genre3,
           af.bpm, af.bpm_confidence, af.key, af.scale, af.key_strength,
           af.chords_changes_rate, af.loudness_db, af.dynamic_complexity,
           af.danceability, af.energy, af.dissonance, af.spectral_centroid,
           af.onset_rate, af.loudness_lufs, af.mfcc
    FROM song s
    JOIN album a ON a.id = s.album_id
    JOIN trackaudio af ON af.track_id = s.track_id
    WHERE af.bpm IS NOT NULL AND a.artist IS NOT NULL
""")

# Album-level replay, per user, for the tier-3 table. Keyed on the album artist
# for the same reason everything else is.
_REPLAY_SQL = text("""
    SELECT a.user_id, a.artist, a.replay_value
    FROM album a
    WHERE a.status = 'rated' AND a.replay_value IS NOT NULL
      AND a.user_id IS NOT NULL AND a.artist IS NOT NULL
""")


def user_replay_scale(con, user_id: int, prior_n: float = 8.0) -> tuple[float, float]:
    """(mu, sd) of one user's *replay* ratings, shrunk toward the userbase's.

    Deliberately not `user_score_scale`. That returns the user's song-score
    distribution, and tier-3 de-normalizes replay z-scores — different
    quantities with different centres. Measured on production: user 1 averages
    5.92 replay against 7.20 song score, user 36 averages 8.42 against 7.18. So
    a cluster of perfectly average replay would have been predicted at the
    user's song mean, wrong by up to 1.3 points in either direction, with the
    spread halved on top (user 1: replay sd 1.92, score sd 1.01).

    `prior_n` is 8 rather than 30 because replay is rated per album, not per
    song, so the counts are an order of magnitude smaller — 422 for the heaviest
    rater against 5,639 songs. A 30-album prior would hold a 26-album user at
    less than half their own mean.
    """
    row = con.execute(text(
        "SELECT AVG(replay_value), STDDEV(replay_value), COUNT(*) FROM album"
        " WHERE user_id = :uid AND status = 'rated' AND replay_value IS NOT NULL"),
        {"uid": user_id}).fetchone()
    # The prior is the mean of per-user means, not the mean observation. One
    # user owns ~85% of all replay ratings, so an observation-weighted prior
    # *is* that user — shrinking an 8.8-average rater toward it moved them
    # further from their own mean than using the wrong scale had. Averaging
    # users instead gives each one vote, which is what "typical" should mean
    # here. Users with a single rating carry no spread and are excluded.
    pooled = con.execute(text(
        "SELECT AVG(u_mu), AVG(u_sd) FROM ("
        "  SELECT AVG(replay_value) AS u_mu, STDDEV(replay_value) AS u_sd"
        "  FROM album WHERE status = 'rated' AND replay_value IS NOT NULL"
        "    AND user_id IS NOT NULL GROUP BY user_id HAVING COUNT(*) > 1) t")
    ).fetchone()

    p_mu = float(pooled[0]) if pooled and pooled[0] is not None else 7.0
    p_sd = float(pooled[1]) if pooled and pooled[1] else 1.5
    if not row or not row[2] or row[0] is None:
        return p_mu, p_sd

    n = float(row[2])
    u_mu = float(row[0])
    u_sd = float(row[1]) if row[1] else p_sd
    w = n / (n + prior_n)
    return (w * u_mu + (1 - w) * p_mu), (w * u_sd + (1 - w) * p_sd)


def _l2_rows(X: np.ndarray) -> np.ndarray:
    """Scale each row to unit length, leaving all-zero rows at the origin.

    Without this an artist carrying no subgenre tags is not "unknown" — an
    all-zero tag block is a *position*, and every tag-less artist occupies the
    same one, so they attract each other and can form a cluster that means
    "untagged" rather than "similar". 57% of never-rated artists have no
    subgenre against 93% of rated ones, so that cluster would have been mostly
    the newly included cohort: exactly the artists this map exists to place.
    """
    n = np.linalg.norm(X, axis=1, keepdims=True)
    return np.divide(X, n, out=np.zeros_like(X), where=n > 0)


@dataclass
class ArtistClusters:
    """Global artist neighbourhoods. Fit once per run, read by every model."""

    artists: list[str]
    display: dict[str, str]
    scaler: StandardScaler
    genre_cats: list[str]
    sub_vocab: list[str]
    audio_median: pd.Series
    kms: list[KMeans]
    maps: list[dict[str, int]]
    global_z: list[dict[int, float]]
    k: int
    fitted_at: datetime
    # Artists placed by nearest-centroid after the fit rather than being in it.
    assigned: set[str] = field(default_factory=set)

    # ---- construction ----

    @classmethod
    def fit(cls, con, k: int = ARTIST_K, n_seeds: int = N_CLUSTER_SEEDS) -> "ArtistClusters":
        rows = con.execute(_UNIVERSE_SQL).fetchall()
        raw = pd.DataFrame(rows, columns=[
            "album_artist", "album_name", "genre",
            "sub_genre1", "sub_genre2", "sub_genre3",
            "bpm", "bpm_confidence", "key", "scale", "key_strength",
            "chords_changes_rate", "loudness_db", "dynamic_complexity",
            "danceability", "energy", "dissonance", "spectral_centroid",
            "onset_rate", "loudness_lufs", "mfcc",
        ])
        if raw.empty:
            raise RuntimeError("no analyzed audio — cannot fit artist clusters")

        df = build_features(expand_mfcc(raw))
        df["artist_key"] = df["album_artist"].map(artist_key)
        df["album_key"] = [album_key(a, n) for a, n in
                           zip(df["album_artist"], df["album_name"])]

        # Centroid over every analyzed track, not just rated ones — roughly a
        # third of the available audio was being discarded here.
        audio = df.groupby("artist_key")[AUDIO_FEATURES].mean()
        audio_median = audio.median()
        audio = audio.fillna(audio_median)
        artists = audio.index.tolist()

        # One vote per record. The same album owned by six users appeared six
        # times in the old frame and dragged the genre mode with it.
        albums = df.drop_duplicates("album_key")

        gmode = (albums.dropna(subset=["genre"])
                 .groupby("artist_key")["genre"]
                 .agg(lambda s: s.mode().iloc[0]))
        genre_cats = sorted(albums["genre"].dropna().unique().tolist())

        tag_rows = []
        for c in ("sub_genre1", "sub_genre2", "sub_genre3"):
            tag_rows.append(albums[["artist_key", c]].rename(columns={c: "tag"}))
        at = pd.concat(tag_rows)
        at["tag"] = at["tag"].map(_norm_tag)
        at = at.dropna().drop_duplicates()
        freq = at.groupby("tag")["artist_key"].nunique()
        # Thresholded over the whole universe now, so the vocabulary — and
        # therefore the matrix width — stops changing shape per user.
        sub_vocab = sorted(freq[freq >= _SUBGENRE_MIN_ARTISTS].index)
        artist_tags = at.groupby("artist_key")["tag"].agg(set)

        display = (df.groupby("artist_key")["album_artist"]
                   .agg(lambda s: s.mode().iloc[0]).to_dict())

        scaler = StandardScaler().fit(audio.values)
        X = cls._matrix(scaler, genre_cats, sub_vocab,
                        audio.values,
                        [gmode.get(a) for a in artists],
                        [artist_tags.get(a, set()) for a in artists])

        kms, maps = [], []
        for i in range(n_seeds):
            km = KMeans(n_clusters=k, n_init=10, random_state=42 + i * 101).fit(X)
            kms.append(km)
            maps.append(dict(zip(artists, (int(c) for c in km.labels_))))

        self = cls(
            artists=artists, display=display, scaler=scaler,
            genre_cats=genre_cats, sub_vocab=sub_vocab, audio_median=audio_median,
            kms=kms, maps=maps, global_z=[], k=k,
            fitted_at=datetime.now(timezone.utc),
        )
        self.global_z = self._fit_global_z(con)
        return self

    @staticmethod
    def _matrix(scaler, genre_cats, sub_vocab, audio_vals, genres, tag_sets) -> np.ndarray:
        Xa = scaler.transform(audio_vals)
        G = np.zeros((len(genres), len(genre_cats)))
        gidx = {g: i for i, g in enumerate(genre_cats)}
        for i, g in enumerate(genres):
            if g in gidx:
                G[i, gidx[g]] = 1.0
        S = np.zeros((len(tag_sets), len(sub_vocab)))
        sidx = {t: i for i, t in enumerate(sub_vocab)}
        for i, ts in enumerate(tag_sets):
            for t in ts:
                if t in sidx:
                    S[i, sidx[t]] = 1.0
        return np.hstack([Xa, G, _l2_rows(S)])

    def _fit_global_z(self, con) -> list[dict[int, float]]:
        """Tier-3 table: each cluster's mean replay in z-space, across all users.

        Held in z-space rather than as raw replay because per-user replay means
        span 5.9 to 8.8, and one user owns ~85% of the ratings in existence.
        A raw global mean handed to a light rater is a stranger's scale wearing
        their name; z-scoring per user first, then mapping back onto the target
        user's own (mu, sd), is the only form of this number that is safe to
        show anybody.
        """
        rows = con.execute(_REPLAY_SQL).fetchall()
        if not rows:
            return [{} for _ in self.maps]
        rp = pd.DataFrame(rows, columns=["user_id", "artist", "replay_value"])
        rp["artist_key"] = rp["artist"].map(artist_key)
        rp["replay_value"] = rp["replay_value"].astype(float)

        # One value per (user, artist) before z-scoring, so a user with four
        # albums by one artist doesn't get four votes on their own mean.
        per = rp.groupby(["user_id", "artist_key"])["replay_value"].mean().reset_index()
        mu = per.groupby("user_id")["replay_value"].transform("mean")
        sd = per.groupby("user_id")["replay_value"].transform("std")
        # A user with one rated artist, or no spread, contributes no z signal.
        per["z"] = (per["replay_value"] - mu) / sd.where(sd > 1e-9)
        per = per.dropna(subset=["z"])

        out = []
        for cmap in self.maps:
            cl = per["artist_key"].map(cmap)
            out.append({int(c): float(v) for c, v in
                        per.assign(c=cl).dropna(subset=["c"])
                           .groupby("c")["z"].mean().items()})
        return out

    # ---- deployment ----

    def assign(self, key: str, centroid: pd.Series, genre, tags: set) -> None:
        """Place an artist analyzed since the last fit, by nearest centroid.

        Idempotent. Called with *that artist's own* genre and tags — the bug
        this replaces read them off whichever album happened to sort first, so
        two of the three blocks were wrong for every artist it placed.
        """
        if not key or key in self.maps[0]:
            return
        vals = centroid.reindex(AUDIO_FEATURES).fillna(self.audio_median)
        X = self._matrix(self.scaler, self.genre_cats, self.sub_vocab,
                         vals.values.reshape(1, -1), [genre], [tags or set()])
        for km, cmap in zip(self.kms, self.maps):
            cmap[key] = int(km.predict(X)[0])
        self.assigned.add(key)

    # ---- reading a value out of a cluster ----

    def cluster_value(self, key: str, values: dict[str, float],
                      mu: float, sd: float) -> tuple[float, str] | None:
        """One artist's neighbourhood value for one user, ensemble-averaged.

        `values` is that user's own artist_key -> value map (replay today); the
        artist's own entry is always excluded so the caller can blend this with
        their own mean without double-counting.

        Returns (value, tier) where tier is 'mates' when the user's own ratings
        carried most of the weight, 'global' when the calibrated userbase figure
        did, and 'user_mean' when neither existed — recorded so a weak claim can
        be told from a strong one after the fact.

        A cluster can legitimately hold no globally-rated artist: Joe Hisaishi
        and the London Symphony Orchestra form a tight, correct orchestral
        neighbourhood that nobody in the userbase has rated. That is the
        clustering working, not failing, so the answer there is the user's own
        mean replay rather than a coarser k that would dissolve the cluster to
        avoid the question.
        """
        if not key:
            return None
        # Always available when the user has rated anything at all, and already
        # on their scale — no calibration needed, it *is* their distribution.
        own_mean = float(np.mean(list(values.values()))) if values else None
        vals, weights = [], []
        # Which source filled the non-mates half, for the tier label only.
        calibrated_seeds = 0
        for cmap, gz in zip(self.maps, self.global_z):
            c = cmap.get(key)
            if c is None:
                continue
            mates = [v for a, v in values.items() if a != key and cmap.get(a) == c]
            if c in gz:
                tier3 = mu + gz[c] * sd
                calibrated_seeds += 1
            else:
                tier3 = own_mean
            if mates:
                m = len(mates)
                own = float(np.mean(mates))
                if tier3 is None:
                    vals.append(own)
                    weights.append(1.0)
                    continue
                # Continuous handover: 1 mate -> 25% own, 4 -> 57%, 12 -> 80%.
                w = m / (m + MATE_PRIOR)
                vals.append(w * own + (1 - w) * tier3)
                weights.append(w)
            elif tier3 is not None:
                vals.append(tier3)
                weights.append(0.0)
        if not vals:
            return None
        if np.mean(weights) >= 0.5:
            tier = "mates"
        else:
            tier = "global" if calibrated_seeds >= len(vals) / 2 else "user_mean"
        return float(np.mean(vals)), tier

    # ---- persistence ----

    def persist(self, con) -> int:
        """Record the map. Not read back — the nightly fit stays authoritative —
        but it turns 'what is the clustering, and over how many artists?' into a
        query instead of a code-reading exercise."""
        con.execute(text("DELETE FROM artistcluster"))
        payload = []
        for seed, (cmap, gz) in enumerate(zip(self.maps, self.global_z)):
            for key, cid in cmap.items():
                payload.append({
                    "artist_key": key, "seed": seed, "cluster_id": int(cid),
                    "k": self.k, "display_name": self.display.get(key),
                    "in_universe": key not in self.assigned,
                    "global_z": gz.get(int(cid)),
                    "computed_at": self.fitted_at,
                })
        if payload:
            con.execute(text(
                "INSERT INTO artistcluster (artist_key, seed, cluster_id, k,"
                " display_name, in_universe, global_z, computed_at)"
                " VALUES (:artist_key, :seed, :cluster_id, :k, :display_name,"
                " :in_universe, :global_z, :computed_at)"), payload)
        con.commit()
        return len(payload)

    # ---- inspection ----

    def diagnostics(self, con, ks=(8, 12, 15, 18, 20, 25)) -> pd.DataFrame:
        """Silhouette across candidate k. The only criterion for k now that
        coverage has been decoupled from it (§3.2)."""
        from sklearn.metrics import silhouette_score
        X = self._universe_matrix(con)
        out = []
        for k in ks:
            km = KMeans(n_clusters=k, n_init=10, random_state=42).fit(X)
            sizes = np.bincount(km.labels_, minlength=k)
            out.append({
                "k": k,
                "silhouette": round(float(silhouette_score(X, km.labels_)), 4),
                "inertia": round(float(km.inertia_), 1),
                "min_size": int(sizes.min()), "max_size": int(sizes.max()),
            })
        return pd.DataFrame(out)

    def _universe_matrix(self, con) -> np.ndarray:
        """Rebuild the fit matrix — diagnostics only."""
        rows = con.execute(_UNIVERSE_SQL).fetchall()
        raw = pd.DataFrame(rows, columns=[
            "album_artist", "album_name", "genre",
            "sub_genre1", "sub_genre2", "sub_genre3",
            "bpm", "bpm_confidence", "key", "scale", "key_strength",
            "chords_changes_rate", "loudness_db", "dynamic_complexity",
            "danceability", "energy", "dissonance", "spectral_centroid",
            "onset_rate", "loudness_lufs", "mfcc",
        ])
        df = build_features(expand_mfcc(raw))
        df["artist_key"] = df["album_artist"].map(artist_key)
        df["album_key"] = [album_key(a, n) for a, n in
                           zip(df["album_artist"], df["album_name"])]
        audio = df.groupby("artist_key")[AUDIO_FEATURES].mean().fillna(self.audio_median)
        audio = audio.loc[self.artists]
        albums = df.drop_duplicates("album_key")
        gmode = (albums.dropna(subset=["genre"]).groupby("artist_key")["genre"]
                 .agg(lambda s: s.mode().iloc[0]))
        tag_rows = [albums[["artist_key", c]].rename(columns={c: "tag"})
                    for c in ("sub_genre1", "sub_genre2", "sub_genre3")]
        at = pd.concat(tag_rows)
        at["tag"] = at["tag"].map(_norm_tag)
        at = at.dropna().drop_duplicates()
        artist_tags = at.groupby("artist_key")["tag"].agg(set)
        return self._matrix(self.scaler, self.genre_cats, self.sub_vocab,
                            audio.values,
                            [gmode.get(a) for a in self.artists],
                            [artist_tags.get(a, set()) for a in self.artists])

    def members(self, seed: int = 0, limit: int = 12) -> dict[int, list[str]]:
        """cluster_id -> display names, for the eyeball test."""
        out: dict[int, list[str]] = {}
        for key, cid in self.maps[seed].items():
            out.setdefault(int(cid), []).append(self.display.get(key, key))
        return {c: sorted(v)[:limit] for c, v in sorted(out.items())}
