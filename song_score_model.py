"""
Song Score Regression Model
============================
Predicts individual song scores from Essentia audio features plus
cluster-based taste features (artist / album K-means on anonymized
audio + genre metadata).

Requirements:
    pip install pandas numpy scikit-learn lightgbm xgboost shap matplotlib seaborn

Usage:
    python song_score_model.py
"""

import json
import re
import sys
import pathlib
import warnings

from sqlalchemy import text
warnings.filterwarnings("ignore")

import numpy as np
import pandas as pd
from sklearn.cluster import KMeans
from sklearn.ensemble import RandomForestRegressor
from sklearn.linear_model import Ridge, Lasso
from sklearn.model_selection import KFold, GroupKFold
from sklearn.preprocessing import StandardScaler
from sklearn.impute import SimpleImputer
from sklearn.pipeline import Pipeline
from sklearn.compose import ColumnTransformer
from sklearn.metrics import (
    mean_absolute_error, r2_score, mean_squared_error,
    explained_variance_score, silhouette_score, davies_bouldin_score,
)
from scipy.stats import pearsonr, spearmanr
try:
    import lightgbm as lgb
    _HAS_LGB = True
except Exception:
    lgb = None
    _HAS_LGB = False

try:
    import xgboost as xgb
    _HAS_XGB = True
except Exception:
    xgb = None
    _HAS_XGB = False

# ── 1. Load data ──────────────────────────────────────────────────────────────

_META_COLS = [
    "song_id", "title", "artist", "album_id", "album_name", "genre",
    "sub_genre1", "sub_genre2", "sub_genre3", "year",
    "theme", "replay_value", "production", "distinctness",
]
_AUDIO_COLS = [
    "bpm", "bpm_confidence", "key", "scale", "key_strength", "chords_changes_rate",
    "loudness_db", "dynamic_complexity", "danceability", "energy", "dissonance",
    "spectral_centroid", "onset_rate", "loudness_lufs", "mfcc",
]
_FEATURE_COLS = _META_COLS[:3] + ["score"] + _META_COLS[3:] + _AUDIO_COLS
_PREDICT_COLS = _META_COLS + _AUDIO_COLS

# Audio comes from the shared global track store (trackaudio via song.track_id):
# one analysis per unique recording, reused across every user's copy.
# Training is strictly per-user — each user's model sees only their ratings.
_AF_SELECT = """
           af.bpm, af.bpm_confidence, af.key, af.scale, af.key_strength,
           af.chords_changes_rate, af.loudness_db, af.dynamic_complexity,
           af.danceability, af.energy, af.dissonance, af.spectral_centroid,
           af.onset_rate, af.loudness_lufs, af.mfcc
"""

_TRAINING_SQL = text(f"""
    SELECT s.id AS song_id, s.title, s.artist, s.score,
           a.id AS album_id, a.album_name, a.genre,
           a.sub_genre1, a.sub_genre2, a.sub_genre3, a.year,
           a.theme, a.replay_value, a.production, a.distinctness,
           {_AF_SELECT}
    FROM song s
    JOIN album a ON a.id = s.album_id
    JOIN trackaudio af ON af.track_id = s.track_id
    WHERE s.score IS NOT NULL AND af.bpm IS NOT NULL AND a.user_id = :uid
""")

_ALBUM_SQL = text(f"""
    SELECT s.id AS song_id, s.title, s.artist,
           a.id AS album_id, a.album_name, a.genre,
           a.sub_genre1, a.sub_genre2, a.sub_genre3, a.year,
           a.theme, a.replay_value, a.production, a.distinctness,
           {_AF_SELECT}
    FROM song s
    JOIN album a ON a.id = s.album_id
    JOIN trackaudio af ON af.track_id = s.track_id
    WHERE s.album_id = :album_id AND af.bpm IS NOT NULL
""")


def load_data(con, user_id: int = 1) -> pd.DataFrame:
    result = con.execute(_TRAINING_SQL, {"uid": user_id})
    return pd.DataFrame(result.fetchall(), columns=_FEATURE_COLS)


def expand_mfcc(df: pd.DataFrame) -> pd.DataFrame:
    """Parse the MFCC JSON column into 13 separate float columns."""
    def parse(x):
        try:
            return json.loads(x) if x else [None] * 13
        except Exception:
            return [None] * 13

    mfcc_cols = pd.DataFrame(
        df["mfcc"].apply(parse).tolist(),
        columns=[f"mfcc_{i}" for i in range(13)],
        index=df.index,
    )
    return pd.concat([df.drop(columns=["mfcc"]), mfcc_cols], axis=1)


# ── 2. Feature engineering ────────────────────────────────────────────────────

def build_features(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()

    # Drop raw energy — scales with track length, not normalised
    df.drop(columns=["energy"], inplace=True, errors="ignore")

    # Binary: major=1, minor=0
    df["is_major"] = (df["scale"] == "major").astype(int)

    # Map musical key to chromatic semitone (0–11) for ordinal encoding
    KEY_MAP = {
        "C": 0, "C#": 1, "Db": 1, "D": 2, "D#": 3, "Eb": 3,
        "E": 4, "F": 5, "F#": 6, "Gb": 6, "G": 7, "G#": 8,
        "Ab": 8, "A": 9, "A#": 10, "Bb": 10, "B": 11,
    }
    df["key_semitone"] = df["key"].map(KEY_MAP)

    # Normalise loudness_lufs to reasonable range (mono→stereo duplication
    # inflates absolute LUFS, but relative differences are still valid)
    df["loudness_lufs"] = df["loudness_lufs"].fillna(df["loudness_db"])

    return df


def prepare_frame(df_raw: pd.DataFrame) -> pd.DataFrame:
    """Full raw→model-ready pipeline; positional indices align with iloc."""
    df = build_features(expand_mfcc(df_raw))
    if "score" in df.columns:
        df = df.dropna(subset=["bpm", "loudness_db", "danceability"])
    return df.reset_index(drop=True)


# ── 3. Column groups ──────────────────────────────────────────────────────────

# inharmonicity excluded: never populated by the analyzer (100% NaN in DB)
AUDIO_FEATURES = [
    "bpm", "bpm_confidence", "key_semitone", "key_strength",
    "chords_changes_rate", "loudness_db", "loudness_lufs",
    "dynamic_complexity", "danceability", "dissonance",
    "spectral_centroid", "onset_rate",
    "is_major",
    *[f"mfcc_{i}" for i in range(13)],
]

TASTE_FEATURES = ["loo_artist_mean", "similar_artist_mean", "similar_album_song_mean"]

FEATURES = AUDIO_FEATURES + TASTE_FEATURES

EXTERNAL_FACTORS = ["theme", "replay_value", "production", "distinctness"]

# Chosen via downstream GroupKFold(album) MAE grid, verified stable across
# KMeans base seeds: (12,55) → MAE 0.7155 ± 0.0028 vs 0.7382 audio-only baseline
ARTIST_K = 12
ALBUM_K = 55
N_CLUSTER_SEEDS = 10

_SUBGENRE_MIN_ARTISTS = 3   # tag must appear on ≥3 artists to enter artist vocab
_SUBGENRE_MIN_ALBUMS = 3    # …and on ≥3 albums for the album vocab

_DECADE_EDGES = [1980, 1990, 2000, 2010, 2020]   # buckets: <80s, 80s, 90s, 00s, 10s, 20s+


def _norm_tag(s):
    if not isinstance(s, str):
        return None
    t = re.sub(r"[^a-z0-9]+", " ", s.lower()).strip()
    return t or None


def _decade_onehot(year) -> np.ndarray:
    v = np.zeros(len(_DECADE_EDGES) + 1)
    if year is None or (isinstance(year, float) and np.isnan(year)):
        return v
    idx = int(np.searchsorted(_DECADE_EDGES, year, side="right"))
    v[idx] = 1.0
    return v


# ── 4. Cluster-based taste features ───────────────────────────────────────────

class TasteModel:
    """K-means clustering of artists and albums on anonymized metadata
    (audio centroids + genre/subgenre encodings; albums also get audio
    std-dev, external factor scores, and decade). Produces three
    score-derived features whose sums are always computed from a
    training subset only, so CV stays leak-free.
    """

    def __init__(self, artist_k: int = ARTIST_K, album_k: int = ALBUM_K,
                 random_state: int = 42, n_seeds: int = N_CLUSTER_SEEDS):
        self.artist_k = artist_k
        self.album_k = album_k
        self.random_state = random_state
        # Cluster-mean features are averaged over n_seeds independent KMeans
        # runs — single hard clusterings are noisy at cluster boundaries
        self.n_seeds = n_seeds

    # ---- matrix construction (no names, no scores) ----

    def prepare(self, df: pd.DataFrame):
        """Build the artist and album clustering matrices from the full frame."""
        self.genre_cats = sorted(df["genre"].dropna().unique().tolist())

        # ── artist matrix
        audio = df.groupby("artist")[AUDIO_FEATURES].mean()
        self._artist_audio_median = audio.median()
        audio = audio.fillna(self._artist_audio_median)
        self.artists = audio.index.tolist()
        self._artist_pos = {a: i for i, a in enumerate(self.artists)}

        links = df[["artist", "album_id"]].drop_duplicates()
        alb_meta = df.drop_duplicates("album_id").set_index("album_id")

        lg = links.join(alb_meta["genre"], on="album_id").dropna(subset=["genre"])
        gmode = lg.groupby("artist")["genre"].agg(lambda s: s.mode().iloc[0])

        tag_rows = []
        for c in ("sub_genre1", "sub_genre2", "sub_genre3"):
            t = links.join(alb_meta[c], on="album_id").rename(columns={c: "tag"})
            tag_rows.append(t[["artist", "tag"]])
        at = pd.concat(tag_rows)
        at["tag"] = at["tag"].map(_norm_tag)
        at = at.dropna().drop_duplicates()
        freq = at.groupby("tag")["artist"].nunique()
        self.artist_sub_vocab = sorted(freq[freq >= _SUBGENRE_MIN_ARTISTS].index)
        artist_tags = at.groupby("artist")["tag"].agg(set)

        self.artist_scaler = StandardScaler().fit(audio.values)
        Xa = self.artist_scaler.transform(audio.values)
        G = self._genre_block([gmode.get(a) for a in self.artists])
        S = self._tag_block([artist_tags.get(a, set()) for a in self.artists],
                            self.artist_sub_vocab)
        self._X_artist = np.hstack([Xa, G, S])

        # ── album matrix
        mean_ = df.groupby("album_id")[AUDIO_FEATURES].mean()
        std_ = df.groupby("album_id")[AUDIO_FEATURES].std()
        self._album_audio_median = mean_.median()
        mean_ = mean_.fillna(self._album_audio_median)
        std_ = std_.fillna(0.0)
        self.album_ids = mean_.index.tolist()
        meta = alb_meta.loc[self.album_ids]

        ext = meta[EXTERNAL_FACTORS].astype(float)
        self.ext_medians = ext.median()
        ext = ext.fillna(self.ext_medians)

        num = np.hstack([mean_.values, std_.values, ext.values])
        self.album_scaler = StandardScaler().fit(num)
        Xn = self.album_scaler.transform(num)

        alb_tag_sets = []
        for aid in self.album_ids:
            row = meta.loc[aid]
            tags = {_norm_tag(row[c]) for c in ("sub_genre1", "sub_genre2", "sub_genre3")}
            alb_tag_sets.append({t for t in tags if t})
        tag_counts: dict = {}
        for ts in alb_tag_sets:
            for t in ts:
                tag_counts[t] = tag_counts.get(t, 0) + 1
        self.album_sub_vocab = sorted(t for t, c in tag_counts.items()
                                      if c >= _SUBGENRE_MIN_ALBUMS)

        G2 = self._genre_block(meta["genre"].tolist())
        S2 = self._tag_block(alb_tag_sets, self.album_sub_vocab)
        D = np.vstack([_decade_onehot(y) for y in meta["year"].tolist()])
        self._X_album = np.hstack([Xn, G2, S2, D])
        return self

    def _genre_block(self, genres: list) -> np.ndarray:
        X = np.zeros((len(genres), len(self.genre_cats)))
        idx = {g: i for i, g in enumerate(self.genre_cats)}
        for i, g in enumerate(genres):
            if g in idx:
                X[i, idx[g]] = 1.0
        return X

    @staticmethod
    def _tag_block(tag_sets: list, vocab: list) -> np.ndarray:
        X = np.zeros((len(tag_sets), len(vocab)))
        idx = {t: i for i, t in enumerate(vocab)}
        for i, ts in enumerate(tag_sets):
            for t in ts:
                if t in idx:
                    X[i, idx[t]] = 1.0
        return X

    # ---- clustering ----

    def fit_clusters(self):
        self.artist_kms, self.album_kms = [], []
        self.artist_clusters, self.album_clusters = [], []
        for i in range(self.n_seeds):
            seed = self.random_state + i * 101
            akm = KMeans(n_clusters=self.artist_k, n_init=10,
                         random_state=seed).fit(self._X_artist)
            bkm = KMeans(n_clusters=self.album_k, n_init=10,
                         random_state=seed).fit(self._X_album)
            self.artist_kms.append(akm)
            self.album_kms.append(bkm)
            self.artist_clusters.append(dict(zip(self.artists, akm.labels_)))
            self.album_clusters.append(dict(zip(self.album_ids, bkm.labels_)))
        # First seed's labels kept for inspection / membership printouts
        self.artist_cluster = self.artist_clusters[0]
        self.album_cluster = self.album_clusters[0]
        return self

    # ---- score sums (train subset only — call per CV fold) ----

    def fit_scores(self, train_df: pd.DataFrame):
        self.train_ids = set(train_df["song_id"])
        self.a_sum = train_df.groupby("artist")["score"].sum()
        self.a_cnt = train_df.groupby("artist")["score"].size()

        self.ac_sums, self.ac_cnts = [], []
        for cmap in self.artist_clusters:
            acl = train_df["artist"].map(cmap)
            self.ac_sums.append(train_df.groupby(acl)["score"].sum())
            self.ac_cnts.append(train_df.groupby(acl)["score"].size())

        self.b_sum = train_df.groupby("album_id")["score"].sum()
        self.b_cnt = train_df.groupby("album_id")["score"].size()

        self.bc_sums, self.bc_cnts = [], []
        for cmap in self.album_clusters:
            bcl = train_df["album_id"].map(cmap)
            self.bc_sums.append(train_df.groupby(bcl)["score"].sum())
            self.bc_cnts.append(train_df.groupby(bcl)["score"].size())
        return self

    # ---- feature computation ----

    @staticmethod
    def _ensemble_sim(keys: pd.Series, cluster_maps: list, c_sums: list,
                      c_cnts: list, own_sum: np.ndarray,
                      own_cnt: np.ndarray) -> np.ndarray:
        """Cluster-mates' mean score (own entity excluded), averaged across
        the KMeans seed ensemble. NaN where no cluster-mates exist."""
        sims = []
        for cmap, cs, cc in zip(cluster_maps, c_sums, c_cnts):
            cl = keys.map(cmap)
            c_sum = cl.map(cs).fillna(0.0).values
            c_cnt = cl.map(cc).fillna(0.0).values
            den = c_cnt - own_cnt
            sims.append(np.divide(c_sum - own_sum, den,
                                  out=np.full(len(keys), np.nan), where=den > 0))
        return np.nanmean(np.vstack(sims), axis=0)

    def transform(self, df: pd.DataFrame) -> pd.DataFrame:
        score = df["score"] if "score" in df.columns else pd.Series(np.nan, index=df.index)
        in_train = df["song_id"].isin(self.train_ids) & score.notna()
        score_f = score.fillna(0.0).values
        it = in_train.values.astype(float)

        a_sum = df["artist"].map(self.a_sum).fillna(0.0).values
        a_cnt = df["artist"].map(self.a_cnt).fillna(0).astype(float).values
        loo_sum = a_sum - score_f * it
        loo_cnt = a_cnt - it
        loo_mean = np.divide(loo_sum, loo_cnt,
                             out=np.full(len(df), np.nan), where=loo_cnt > 0)

        # Averaged over the KMeans seed ensemble to smooth boundary noise
        sim_artist = self._ensemble_sim(
            df["artist"], self.artist_clusters, self.ac_sums, self.ac_cnts,
            a_sum, a_cnt)

        # Tiered artist mean: ≥15 songs → pure LOO; 8–14 → 0.4·LOO + 0.6·cluster;
        # ≤7 → not included (NaN)
        sim_fb = np.where(np.isnan(sim_artist), loo_mean, sim_artist)
        blend = 0.4 * loo_mean + 0.6 * sim_fb
        loo_feat = np.where(loo_cnt >= 15, loo_mean,
                            np.where(loo_cnt >= 8, blend, np.nan))

        b_sum = df["album_id"].map(self.b_sum).fillna(0.0).values
        b_cnt = df["album_id"].map(self.b_cnt).fillna(0).astype(float).values
        sim_album = self._ensemble_sim(
            df["album_id"], self.album_clusters, self.bc_sums, self.bc_cnts,
            b_sum, b_cnt)

        return pd.DataFrame({
            "loo_artist_mean": loo_feat,
            "similar_artist_mean": sim_artist,
            "similar_album_song_mean": sim_album,
        }, index=df.index)

    # ---- deployment: assign clusters for an unseen album / artist ----

    def extend(self, df_pred: pd.DataFrame):
        """Map a prediction album (and any unseen artists on it) to the
        nearest existing cluster so taste features stay available."""
        meta = df_pred.iloc[0]

        tags = {_norm_tag(meta.get(c)) for c in ("sub_genre1", "sub_genre2", "sub_genre3")}
        tags = {t for t in tags if t}

        for artist in df_pred["artist"].dropna().unique():
            if artist in self.artist_clusters[0]:
                continue
            songs = df_pred[df_pred["artist"] == artist]
            centroid = songs[AUDIO_FEATURES].mean().fillna(self._artist_audio_median)
            Xa = self.artist_scaler.transform(centroid.values.reshape(1, -1))
            G = self._genre_block([meta.get("genre")])
            S = self._tag_block([tags], self.artist_sub_vocab)
            X = np.hstack([Xa, G, S])
            for km, cmap in zip(self.artist_kms, self.artist_clusters):
                cmap[artist] = int(km.predict(X)[0])

        aid = meta["album_id"]
        if aid not in self.album_clusters[0]:
            mean_ = df_pred[AUDIO_FEATURES].mean().fillna(self._album_audio_median)
            std_ = df_pred[AUDIO_FEATURES].std().fillna(0.0)
            ext = pd.Series({f: meta.get(f) for f in EXTERNAL_FACTORS},
                            dtype=float).fillna(self.ext_medians)
            num = np.concatenate([mean_.values, std_.values, ext.values]).reshape(1, -1)
            Xn = self.album_scaler.transform(num)
            G2 = self._genre_block([meta.get("genre")])
            S2 = self._tag_block([tags], self.album_sub_vocab)
            D = _decade_onehot(meta.get("year")).reshape(1, -1)
            X = np.hstack([Xn, G2, S2, D])
            for km, cmap in zip(self.album_kms, self.album_clusters):
                cmap[aid] = int(km.predict(X)[0])
        return self


def fit_taste_full(df: pd.DataFrame, artist_k: int | None = None,
                   album_k: int | None = None) -> TasteModel:
    """k=None auto-scales cluster counts to the library: the tuned (12, 55)
    assumes a ~360-album library and would overfit a small user's data."""
    if artist_k is None:
        artist_k = int(np.clip(df["artist"].nunique() // 4, 2, ARTIST_K))
    if album_k is None:
        album_k = int(np.clip(df["album_id"].nunique() // 6, 2, ALBUM_K))
    return TasteModel(artist_k, album_k).prepare(df).fit_clusters().fit_scores(df)


def artist_cluster_replay_mean(df: pd.DataFrame, taste: TasteModel,
                               artist: str) -> float | None:
    """Mean replay_value of rated albums by the artist's cluster-mates,
    ensemble-averaged across the KMeans seeds. The artist's own albums are
    excluded so the 50/50 blend with their own mean stays independent.
    Works for unseen artists after taste.extend() has mapped them."""
    alb = (df.drop_duplicates("album_id")[["artist", "replay_value"]]
             .dropna(subset=["replay_value"]))
    if alb.empty:
        return None
    vals = []
    for cmap in taste.artist_clusters:
        c = cmap.get(artist)
        if c is None:
            continue
        mates = alb[(alb["artist"].map(cmap) == c) & (alb["artist"] != artist)]
        if len(mates):
            vals.append(float(mates["replay_value"].mean()))
    return float(np.mean(vals)) if vals else None


def fold_features(df: pd.DataFrame, taste: TasteModel) -> pd.DataFrame:
    return pd.concat([df[AUDIO_FEATURES], taste.transform(df)], axis=1)


# ── 5. Preprocessor & models ──────────────────────────────────────────────────

def build_preprocessor():
    numeric_pipe = Pipeline([
        ("imputer", SimpleImputer(strategy="median", add_indicator=True)),
        ("scaler", StandardScaler()),
    ])
    return ColumnTransformer([("num", numeric_pipe, FEATURES)], remainder="drop")


# Hyperparameters tuned via staged grid search on GroupKFold(album) OOF MAE
# with per-fold taste features (2026-07): RF 0.7046 ± 0.0008 MAE across KMeans
# seeds, LightGBM 0.708, XGBoost 0.710. Regularization beyond this hurt.
def get_models():
    models = {
        "Ridge":        Pipeline([("pre", build_preprocessor()), ("model", Ridge(alpha=1.0))]),
        "Lasso":        Pipeline([("pre", build_preprocessor()), ("model", Lasso(alpha=0.01))]),
        "RandomForest": Pipeline([("pre", build_preprocessor()), ("model", RandomForestRegressor(n_estimators=800, max_features="sqrt", min_samples_leaf=1, random_state=42, n_jobs=-1))]),
    }
    if _HAS_XGB:
        models["XGBoost"] = Pipeline([("pre", build_preprocessor()), ("model", xgb.XGBRegressor(n_estimators=400, learning_rate=0.02, max_depth=6, subsample=0.7, colsample_bytree=0.8, random_state=42, verbosity=0))])
    if _HAS_LGB:
        models["LightGBM"] = Pipeline([("pre", build_preprocessor()), ("model", lgb.LGBMRegressor(n_estimators=500, learning_rate=0.02, num_leaves=31, min_child_samples=5, subsample=0.6, subsample_freq=1, colsample_bytree=0.5, random_state=42, verbose=-1))])
    return models


# ── 6. Cross-validation ───────────────────────────────────────────────────────

def make_splits(df: pd.DataFrame) -> dict:
    """Three CV schemes: randomized KFold (legacy baseline), GroupKFold by
    album (matches deployment: predict a fresh album given the rest of the
    library), and GroupKFold by artist (new-artist stress test)."""
    return {
        "KFold (randomized)": list(KFold(5, shuffle=True, random_state=42).split(df)),
        "GroupKFold (album)": list(GroupKFold(5).split(df, groups=df["album_id"])),
        "GroupKFold (artist)": list(GroupKFold(5).split(df, groups=df["artist"])),
    }


def oof_predict(df: pd.DataFrame, target: pd.Series, taste: TasteModel,
                splits: list, pipe) -> np.ndarray:
    """Out-of-fold predictions with taste features recomputed per fold
    from the training split only (no target leakage)."""
    oof = np.full(len(target), np.nan)
    for tr, va in splits:
        taste.fit_scores(df.iloc[tr])
        feats = fold_features(df, taste)
        pipe.fit(feats.iloc[tr], target.iloc[tr])
        oof[va] = pipe.predict(feats.iloc[va])
    return oof


def _metrics(y: np.ndarray, yh: np.ndarray) -> dict:
    return dict(
        mae=mean_absolute_error(y, yh),
        rmse=np.sqrt(mean_squared_error(y, yh)),
        r2=r2_score(y, yh),
        evs=explained_variance_score(y, yh),
        pearson=pearsonr(y, yh).statistic,
        spearman=spearmanr(y, yh).statistic,
    )


def evaluate(df: pd.DataFrame, target: pd.Series, taste: TasteModel,
             splits: list, cv_label: str):
    models = get_models()
    results = {}

    header = f"{'Model':<16} {'MAE':>7} {'RMSE':>7} {'R²':>7} {'Expl.Var':>9} {'Pearson r':>10} {'Spearman ρ':>11}"
    print(f"\n{header}  ({cv_label})")
    print("─" * len(header))

    for name, pipe in models.items():
        oof = oof_predict(df, target, taste, splits, pipe)
        m = _metrics(target.values, oof)
        results[name] = {k: round(v, 4) for k, v in m.items()}
        print(f"{name:<16} {m['mae']:>7.4f} {m['rmse']:>7.4f} {m['r2']:>7.4f} "
              f"{m['evs']:>9.4f} {m['pearson']:>10.4f} {m['spearman']:>11.4f}")

    return results


# ── 7. Clustering diagnostics ─────────────────────────────────────────────────

def cluster_diagnostics(df: pd.DataFrame,
                        artist_ks=(8, 10, 12, 15, 18, 20, 25),
                        album_ks=(15, 20, 25, 30, 35, 40)):
    tm = TasteModel().prepare(df)
    print("\n── Clustering diagnostics (silhouette ↑ better, Davies-Bouldin ↓ better) ──")
    for label, X, ks in (("Artist", tm._X_artist, artist_ks),
                         ("Album", tm._X_album, album_ks)):
        print(f"\n{label} clusters ({X.shape[0]} entities × {X.shape[1]} dims):")
        print(f"  {'k':>4} {'silhouette':>11} {'davies-bouldin':>15}")
        for k in ks:
            km = KMeans(n_clusters=k, n_init=10, random_state=42).fit(X)
            sil = silhouette_score(X, km.labels_)
            db = davies_bouldin_score(X, km.labels_)
            print(f"  {k:>4} {sil:>11.4f} {db:>15.4f}")
    return tm


def print_cluster_members(df: pd.DataFrame, taste: TasteModel, max_clusters=None):
    """Sanity check: artist names per cluster with cluster mean song score."""
    a_mean = df.groupby("artist")["score"].mean()
    a_cnt = df.groupby("artist")["score"].size()
    rows = pd.DataFrame({
        "artist": taste.artists,
        "cluster": [taste.artist_cluster[a] for a in taste.artists],
    })
    rows["mean"] = rows["artist"].map(a_mean)
    rows["n"] = rows["artist"].map(a_cnt)

    print(f"\n── Artist cluster membership (k={taste.artist_k}) ──")
    for c, grp in rows.groupby("cluster"):
        if max_clusters is not None and c >= max_clusters:
            break
        grp = grp.sort_values("n", ascending=False)
        cluster_mean = (grp["mean"] * grp["n"]).sum() / grp["n"].sum()
        names = ", ".join(
            f"{r.artist} ({int(r.n)})" for r in grp.itertuples()
        )
        print(f"\n  Cluster {c} — {len(grp)} artists, song-weighted mean {cluster_mean:.2f}:")
        print(f"    {names}")


# ── 8. Random Forest deep-dive ────────────────────────────────────────────────

def rf_deep_dive(df: pd.DataFrame, target: pd.Series, taste: TasteModel,
                 splits: list):
    """Full OOF analysis for Random Forest: most accurate predictions,
    per-tree prediction variance, and built-in feature importances."""
    print("\n── Random Forest deep-dive (GroupKFold by album) ────────────────")

    rf_pipe = Pipeline([
        ("pre",   build_preprocessor()),
        ("model", RandomForestRegressor(
            n_estimators=800, max_features="sqrt", min_samples_leaf=1,
            oob_score=False, random_state=42, n_jobs=-1
        )),
    ])

    oof_preds = np.zeros(len(target))
    oof_std   = np.zeros(len(target))   # per-song prediction std across trees

    for train_idx, val_idx in splits:
        taste.fit_scores(df.iloc[train_idx])
        feats = fold_features(df, taste)
        rf_pipe.fit(feats.iloc[train_idx], target.iloc[train_idx])
        X_val = rf_pipe.named_steps["pre"].transform(feats.iloc[val_idx])
        # Collect each tree's prediction for uncertainty estimate
        tree_preds = np.array([t.predict(X_val) for t in rf_pipe.named_steps["model"].estimators_])
        oof_preds[val_idx] = tree_preds.mean(axis=0)
        oof_std[val_idx]   = tree_preds.std(axis=0)

    results = df[["song_id", "title", "artist", "album_name", "genre", "score"]].copy()
    results["predicted"]  = oof_preds.round(3)
    results["residual"]   = (results["score"] - results["predicted"]).round(3)
    results["abs_error"]  = results["residual"].abs()
    results["pred_std"]   = oof_std.round(3)   # model uncertainty

    # ── Most accurate predictions (lowest absolute error)
    print("\nMost accurate predictions (|error| ≤ 0.10):")
    accurate = results[results["abs_error"] <= 0.10].sort_values("abs_error")
    print(accurate[["title", "artist", "score", "predicted", "residual", "pred_std"]].head(20).to_string(index=False))

    # ── Accuracy buckets
    print("\nPrediction accuracy buckets (OOF):")
    for thresh, label in [(0.25, "within 0.25"), (0.5, "within 0.5"), (1.0, "within 1.0"), (1.5, "within 1.5")]:
        pct = (results["abs_error"] <= thresh).mean() * 100
        print(f"  {label}: {pct:.1f}% of songs")

    # ── Songs model is most confident about (low pred_std)
    print("\nPredictions model is most certain about (lowest tree std):")
    certain = results.sort_values("pred_std").head(15)
    print(certain[["title", "artist", "score", "predicted", "residual", "pred_std"]].to_string(index=False))

    # –– Highest predicted songs
    print("\nSongs model predicted highest scores for (OOF predictions):")
    max_results = results.sort_values("predicted", ascending=False).head(15)
    print(max_results[["title", "artist", "score", "predicted", "residual", "pred_std"]].to_string(index=False))

    # ── Built-in feature importances (train on full data for this)
    taste.fit_scores(df)
    feats = fold_features(df, taste)
    rf_pipe.fit(feats, target)
    pre   = rf_pipe.named_steps["pre"]
    model = rf_pipe.named_steps["model"]
    feat_names = list(pre.get_feature_names_out())
    importances = pd.Series(model.feature_importances_, index=feat_names).sort_values(ascending=False)

    print("\nTop 20 feature importances (Random Forest, trained on full data):")
    print(importances.head(20).round(4).to_string())

    return results


# ── 9. SHAP feature importance (best model) ───────────────────────────────────

def shap_analysis(pipe, features_df: pd.DataFrame, target: pd.Series, model_name: str):
    try:
        import shap
        import matplotlib.pyplot as plt

        pipe.fit(features_df, target)
        X_transformed = pipe.named_steps["pre"].transform(features_df)

        all_names = list(pipe.named_steps["pre"].get_feature_names_out())

        model = pipe.named_steps["model"]
        explainer = shap.TreeExplainer(model)
        shap_values = explainer.shap_values(X_transformed)

        mean_abs = np.abs(shap_values).mean(axis=0)
        shap_df = (
            pd.Series(mean_abs, index=all_names)
            .sort_values(ascending=False)
            .reset_index()
        )
        shap_df.columns = ["feature", "mean_|shap|"]
        print(f"\nSHAP feature importances — {model_name} (mean |SHAP value|):")
        print(f"{'Rank':<5} {'Feature':<40} {'Mean |SHAP|':>12}")
        print("─" * 60)
        for rank, (_, row) in enumerate(shap_df.iterrows(), 1):
            print(f"{rank:<5} {row['feature']:<40} {row['mean_|shap|']:>12.5f}")

        plt.figure(figsize=(10, 7))
        shap.summary_plot(shap_values, X_transformed, feature_names=all_names,
                          show=False, max_display=20)
        plt.title(f"SHAP Feature Importance — {model_name}")
        plt.tight_layout()
        plt.savefig("shap_importance.png", dpi=150)
        print(f"\nSHAP plot saved → shap_importance.png")
    except ImportError:
        print("\nshap not installed — run: pip install shap")
    except Exception as e:
        print(f"\nSHAP failed: {e}")


# ── 10. Prediction helper ─────────────────────────────────────────────────────

def train_and_predict(df: pd.DataFrame, target: pd.Series, taste: TasteModel):
    """Train the best model on all data and return a DataFrame with predictions."""
    taste.fit_scores(df)
    feats = fold_features(df, taste)
    pipe = get_models()["LightGBM"]
    pipe.fit(feats, target)

    df_out = df[["song_id", "title", "artist", "album_name", "genre", "score"]].copy()
    df_out["predicted_score"] = pipe.predict(feats).round(2)
    df_out["residual"] = (df_out["score"] - df_out["predicted_score"]).round(2)
    return df_out.sort_values("residual", key=abs, ascending=False)


# ── 11. Backend integration (train / predict for an album) ───────────────────
# No model cache: the nightly worker retrains per user per run (~1–2 min), so
# artifact management (per-user .pkl files, staleness keys) buys nothing.


class UserModel:
    """A user's fitted library: training frame, taste model, and pipeline.
    taste.extend() calls during prediction accumulate, so cluster-based
    features (and replay cluster means) stay available for unseen artists."""
    def __init__(self, user_id: int, df: pd.DataFrame, taste: TasteModel, pipe):
        self.user_id = user_id
        self.df = df
        self.taste = taste
        self.pipe = pipe


def fit_user_model(con, user_id: int = 1) -> UserModel | None:
    """Train the song score model on one user's rated+analyzed songs only."""
    df = prepare_frame(load_data(con, user_id))
    if len(df) < 20:
        print(f"[song_score_model] user {user_id}: only {len(df)} training songs — need ≥20")
        return None

    taste = fit_taste_full(df)
    feats = fold_features(df, taste)

    models = get_models()
    for model_name in ("LightGBM", "XGBoost", "RandomForest"):
        if model_name not in models:
            continue
        try:
            pipe = models[model_name]
            pipe.fit(feats, df["score"])
            print(f"[song_score_model] user {user_id}: trained {model_name} on {len(df)} songs")
            return UserModel(user_id, df, taste, pipe)
        except Exception as e:
            print(f"[song_score_model] {model_name} failed ({e}), trying next")
    return None


def train_model(con, user_id: int = 1):
    """Legacy-shaped wrapper: returns (pipeline, n_training_songs)."""
    um = fit_user_model(con, user_id)
    return (um.pipe if um else None), (len(um.df) if um else 0)


def _album_frame(con, album_id: int) -> pd.DataFrame | None:
    rows = con.execute(_ALBUM_SQL, {"album_id": album_id}).fetchall()
    if not rows:
        return None
    df_pred = prepare_frame(pd.DataFrame(rows, columns=_PREDICT_COLS))
    return None if df_pred.empty else df_pred


def predict_song_mean(con, um: UserModel, album_id: int) -> float | None:
    """Predict one album's mean song score with an already-fitted UserModel."""
    df_pred = _album_frame(con, album_id)
    if df_pred is None:
        return None
    um.taste.extend(df_pred)   # nearest-cluster assignment for unseen artist/album
    preds = um.pipe.predict(fold_features(df_pred, um.taste))
    return float(np.mean(preds))


def predict_for_album(con, album_id: int) -> float | None:
    """Self-contained single-album prediction (fits the album owner's model
    from scratch — prefer fit_user_model + predict_song_mean for batches)."""
    row = con.execute(text("SELECT user_id FROM album WHERE id = :id"),
                      {"id": album_id}).fetchone()
    if not row:
        return None
    um = fit_user_model(con, row[0] or 1)
    if um is None:
        return None
    avg = predict_song_mean(con, um, album_id)
    if avg is not None:
        print(f"[song_score_model] album {album_id}: avg={round(avg, 3)}")
    return avg


def repredict_all_song_means(con, user_id: int = 1, um: UserModel | None = None,
                             recompute_composites: bool = True) -> dict:
    """Refresh predicted_song_mean for every one of the user's unrated albums
    (to_listen + listening) that has analyzed audio.

    This is the post-rating pipeline: run it whenever the user rates an album
    so predictions absorb the new data. Pass a prefitted UserModel to reuse
    across pipeline stages (the nightly worker does); the worker also passes
    recompute_composites=False because it runs its own composite stage."""
    albums = con.execute(text(
        "SELECT id FROM album WHERE status IN ('to_listen', 'listening')"
        " AND user_id = :uid ORDER BY id"), {"uid": user_id}).fetchall()

    if um is None:
        um = fit_user_model(con, user_id)
    if um is None:
        return {"updated": 0, "skipped": len(albums)}

    updated, skipped = 0, 0
    for (album_id,) in albums:
        mean = predict_song_mean(con, um, album_id)
        if mean is None:
            skipped += 1
            continue
        con.execute(
            text("UPDATE album SET predicted_song_mean = :mean WHERE id = :id"),
            {"mean": round(mean, 4), "id": album_id},
        )
        updated += 1

    con.commit()
    print(f"[song_score_model] user {user_id}: repredicted {updated} unrated albums "
          f"({skipped} skipped, no analyzed audio)")

    if recompute_composites:
        try:
            from theme_predictor.predict_single import recompute_all_predictions
            recompute_all_predictions()
        except Exception as e:
            print(f"[song_score_model] composite recompute failed: {e}")

    return {"updated": updated, "skipped": skipped}


# ── 12. Main ──────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    sys.path.insert(0, str(pathlib.Path(__file__).parent))
    from backend.database import engine

    print("Loading data…")
    with engine.connect() as _con:
        df_raw = load_data(_con)
    print(f"  {len(df_raw):,} songs with scores and audio features")

    df = prepare_frame(df_raw)
    print(f"  {len(df):,} songs after dropping incomplete rows")
    target = df["score"]

    # ── Clustering diagnostics + sanity check
    cluster_diagnostics(df)
    taste = TasteModel().prepare(df).fit_clusters()
    print_cluster_members(df, taste)

    # ── Evaluate all models under each CV scheme
    splits = make_splits(df)
    for cv_label, cv_splits in splits.items():
        print(f"\nEvaluating models — {cv_label}…")
        evaluate(df, target, taste, cv_splits, cv_label)

    album_splits = splits["GroupKFold (album)"]

    # ── Random Forest deep-dive
    print("\nRunning Random Forest deep-dive…")
    rf_results = rf_deep_dive(df, target, taste, album_splits)

    # ── LightGBM full-data predictions (underrated / overrated)
    print("\nTraining LightGBM on full dataset for residual analysis…")
    predictions = train_and_predict(df, target, taste)

    print("\nSongs the model scored much higher than you did (possible underrates):")
    underrated = predictions[predictions["residual"] < -1.5].sort_values("residual")
    print(underrated[["title", "artist", "score", "predicted_score", "residual"]].head(15).to_string(index=False))

    print("\nSongs you scored much higher than the model expected (possible overrates):")
    overrated = predictions[predictions["residual"] > 1.5].sort_values("residual", ascending=False)
    print(overrated[["title", "artist", "score", "predicted_score", "residual"]].head(15).to_string(index=False))

    # ── SHAP analysis on LightGBM
    print("\nRunning SHAP analysis on LightGBM…")
    taste.fit_scores(df)
    shap_analysis(get_models()["LightGBM"], fold_features(df, taste), target, "LightGBM")

    print("\nDone.")
