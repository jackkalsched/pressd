"""
Replay Value ANOVA Analysis & LightGBM Prediction Model
=========================================================
1. ANOVA — which audio/contextual features correlate with replay value
2. LightGBM — predict replay value for to_listen albums
3. Writes predicted_replay to the DB

Usage:
    cd Press'd
    python replay_value_model.py            # full run: ANOVA + train + predict
    python replay_value_model.py --anova    # ANOVA analysis only
    python replay_value_model.py --predict  # predict only (skip ANOVA)
"""

import argparse
import json
import math
import sqlite3
import warnings
warnings.filterwarnings("ignore")

import numpy as np
import pandas as pd
from scipy.stats import f_oneway, pearsonr, spearmanr
from sklearn.ensemble import RandomForestRegressor
from sklearn.impute import SimpleImputer
from sklearn.metrics import mean_absolute_error, r2_score, mean_squared_error
from sklearn.model_selection import KFold
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler, OneHotEncoder
from sklearn.compose import ColumnTransformer
import xgboost as xgb
from sklearn.model_selection import RandomizedSearchCV

DB_PATH = "pressd.db"

AUDIO_COLS = [
    "bpm", "bpm_confidence", "key_strength", "chords_changes_rate",
    "loudness_db", "loudness_lufs", "dynamic_complexity", "danceability",
    "dissonance", "spectral_centroid", "inharmonicity", "onset_rate",
]
KEY_MAP = {
    "C":0,"C#":1,"Db":1,"D":2,"D#":3,"Eb":3,"E":4,"F":5,
    "F#":6,"Gb":6,"G":7,"G#":8,"Ab":8,"A":9,"A#":10,"Bb":10,"B":11,
}


# ── 1. Data Loading ───────────────────────────────────────────────────────────

def load_album_features(con, status: str | None = None, load_con=None) -> pd.DataFrame:
    """Load per-album feature matrix with aggregated audio features."""
    q = """
        SELECT a.id as album_id, a.artist, a.album_name, a.genre, a.year,
               a.total_tracks, a.replay_value, a.sub_genre1,
               s.id as song_id, s.score as song_score,
               af.bpm, af.bpm_confidence, af.key, af.scale, af.key_strength,
               af.chords_changes_rate, af.loudness_db, af.loudness_lufs,
               af.dynamic_complexity, af.danceability, af.dissonance,
               af.spectral_centroid, af.inharmonicity, af.onset_rate, af.mfcc
        FROM album a
        JOIN song s ON s.album_id = a.id
        LEFT JOIN songaudiofeatures af ON af.song_id = s.id
        WHERE af.bpm IS NOT NULL
    """
    if status:
        q += f" AND a.status = '{status}'"

    df = pd.read_sql_query(q, con)

    # Parse MFCC
    def parse_mfcc(x):
        try: return json.loads(x) if x else [None]*13
        except: return [None]*13
    mfcc_df = pd.DataFrame(df["mfcc"].apply(parse_mfcc).tolist(),
                           columns=[f"mfcc_{i}" for i in range(13)], index=df.index)
    df = pd.concat([df.drop(columns=["mfcc"]), mfcc_df], axis=1)

    # Song-level aggregations → album-level
    agg_cols = AUDIO_COLS + [f"mfcc_{i}" for i in range(13)]
    agg = df.groupby("album_id").agg(
        **{f"{c}_mean": (c, "mean") for c in agg_cols},
        **{f"{c}_std":  (c, "std")  for c in AUDIO_COLS},
        avg_song_score=("song_score", "mean"),
        song_score_std=("song_score", "std"),
        bang_pct=("song_score", lambda x: (x >= 8.0).mean()),
        skip_pct=("song_score", lambda x: (x < 5.0).mean()),
        rated_songs=("song_score", lambda x: x.notna().sum()),
    ).reset_index()

    # Album-level metadata (one row per album)
    meta = df.groupby("album_id").first()[
        ["artist", "album_name", "genre", "sub_genre1", "year", "total_tracks", "replay_value"]
    ].reset_index()

    result = meta.merge(agg, on="album_id")

    # Derived features
    result["is_major_pct"] = df.groupby("album_id")["scale"].apply(
        lambda x: (x == "major").mean()
    ).values
    result["key_semitone_mode"] = df.groupby("album_id")["key"].apply(
        lambda x: x.map(KEY_MAP).mode()[0] if len(x.map(KEY_MAP).dropna()) > 0 else np.nan
    ).values
    result["bpm_cv"] = result["bpm_std"] / result["bpm_mean"].replace(0, np.nan)

    # ── Artist-level historical features ────────────────────────────────────
    # Use load_con (full DB connection) if provided, else fall back to con
    _con = load_con if load_con is not None else con
    artist_stats = pd.read_sql_query("""
        SELECT artist,
               AVG(replay_value)         as artist_replay_mean,
               AVG(score)                as artist_score_mean,
               COUNT(*)                  as artist_album_count,
               AVG(theme)                as artist_theme_mean,
               AVG(production)           as artist_prod_mean
        FROM album
        WHERE status = 'rated'
          AND replay_value IS NOT NULL
        GROUP BY artist
    """, _con)
    genre_stats = pd.read_sql_query("""
        SELECT genre,
               AVG(replay_value) as genre_replay_mean,
               COUNT(*)          as genre_album_count
        FROM album
        WHERE status = 'rated' AND replay_value IS NOT NULL AND genre IS NOT NULL
        GROUP BY genre
    """, _con)
    global_replay_mean = pd.read_sql_query(
        "SELECT AVG(replay_value) FROM album WHERE status='rated' AND replay_value IS NOT NULL", _con
    ).iloc[0, 0]

    result = result.merge(artist_stats, on="artist", how="left")
    result = result.merge(genre_stats,  on="genre",  how="left")

    # ── Subgenre-level replay means (finer fallback than broad genre) ─────────
    subgenre_stats = pd.read_sql_query("""
        SELECT sub_genre1 as subgenre,
               AVG(replay_value) as subgenre_replay_mean,
               COUNT(*)          as subgenre_count
        FROM album
        WHERE status='rated' AND replay_value IS NOT NULL AND sub_genre1 IS NOT NULL
        GROUP BY sub_genre1
    """, _con)

    result = result.merge(subgenre_stats.rename(columns={"subgenre": "sub_genre1"}),
                          on="sub_genre1", how="left") if "sub_genre1" in result.columns else result

    # ── Last.fm artist tags for NEW artists (no rated history) ────────────────
    new_artists = result[result["artist_replay_mean"].isna()]["artist"].unique()
    if len(new_artists) > 0:
        print(f"  Fetching Last.fm tags for {len(new_artists)} new artists...")
        from generate_genres_lastfm import infer_genres, normalize, is_noise, TAG_TO_GENRE

        try:
            from theme_predictor.corpus import LASTFM_KEY
            import pylast
            network = pylast.LastFMNetwork(api_key=LASTFM_KEY)

            artist_genre_fallback = {}
            for artist_name in new_artists:
                try:
                    tags = [t.item.name for t in network.get_artist(artist_name).get_top_tags(limit=10)]
                    inferred_genre, _ = infer_genres(tags)
                    artist_genre_fallback[artist_name] = inferred_genre
                except Exception:
                    artist_genre_fallback[artist_name] = None

            # For new artists, replace artist_replay_mean with subgenre or genre mean
            genre_mean_map = genre_stats.set_index("genre")["genre_replay_mean"].to_dict()
            for artist_name, inferred_genre in artist_genre_fallback.items():
                mask = (result["artist"] == artist_name) & result["artist_replay_mean"].isna()
                fallback = genre_mean_map.get(inferred_genre, global_replay_mean)
                result.loc[mask, "artist_replay_mean"] = fallback
                result.loc[mask, "lastfm_inferred_genre"] = inferred_genre or "Unknown"
        except Exception as e:
            print(f"  Last.fm fetch failed: {e}")

    # Fill remaining unknowns with global mean
    result["artist_replay_mean"]  = result["artist_replay_mean"].fillna(global_replay_mean)
    result["artist_score_mean"]   = result["artist_score_mean"].fillna(result["artist_score_mean"].median())
    result["artist_album_count"]  = result["artist_album_count"].fillna(0)
    result["artist_theme_mean"]   = result["artist_theme_mean"].fillna(result["artist_theme_mean"].median())
    result["artist_prod_mean"]    = result["artist_prod_mean"].fillna(result["artist_prod_mean"].median())
    result["genre_replay_mean"]   = result["genre_replay_mean"].fillna(global_replay_mean)
    result["genre_album_count"]   = result["genre_album_count"].fillna(0)
    if "subgenre_replay_mean" in result.columns:
        result["subgenre_replay_mean"] = result["subgenre_replay_mean"].fillna(result["genre_replay_mean"])
        result["subgenre_count"]       = result["subgenre_count"].fillna(0)

    return result


# ── 2. ANOVA Analysis ─────────────────────────────────────────────────────────

def run_anova(df: pd.DataFrame):
    rated = df[df["replay_value"].notna()].copy()
    target = rated["replay_value"]
    print(f"\n── ANOVA Analysis (n={len(rated)} rated albums) ──────────────────────")

    numeric_features = (
        [f"{c}_mean" for c in AUDIO_COLS] +
        [f"{c}_std" for c in AUDIO_COLS[:6]] +
        [f"mfcc_{i}_mean" for i in range(13)] +
        ["total_tracks", "year", "bpm_cv", "is_major_pct"]
    )

    results = []
    for feat in numeric_features:
        if feat not in rated.columns:
            continue
        vals = rated[[feat, "replay_value"]].dropna()
        if len(vals) < 10:
            continue
        pr, pp = pearsonr(vals[feat], vals["replay_value"])
        sr, sp = spearmanr(vals[feat], vals["replay_value"])
        # ANOVA by quartile
        q = pd.qcut(vals[feat], q=4, duplicates="drop")
        groups = [vals["replay_value"][q == lbl].values for lbl in q.cat.categories]
        groups = [g for g in groups if len(g) > 1]
        if len(groups) >= 2:
            f_stat, p_val = f_oneway(*groups)
        else:
            f_stat, p_val = np.nan, np.nan
        results.append({"feature": feat, "pearson_r": pr, "pearson_p": pp,
                        "spearman_r": sr, "f_stat": f_stat, "anova_p": p_val})

    res_df = pd.DataFrame(results).sort_values("pearson_r", key=abs, ascending=False)

    print(f"\n{'Feature':<35} {'Pearson r':>10} {'Spearman ρ':>11} {'F-stat':>8} {'ANOVA p':>9}")
    print("─" * 78)
    for _, row in res_df.head(20).iterrows():
        sig = "***" if row["anova_p"] < 0.001 else "**" if row["anova_p"] < 0.01 else "*" if row["anova_p"] < 0.05 else ""
        print(f"{row['feature']:<35} {row['pearson_r']:>10.4f} {row['spearman_r']:>11.4f} "
              f"{row['f_stat']:>8.2f} {row['anova_p']:>9.4f} {sig}")

    # Genre ANOVA
    print(f"\n── Genre one-way ANOVA ──")
    genre_groups = [target[rated["genre"] == g].dropna().values
                    for g in rated["genre"].dropna().unique()
                    if (rated["genre"] == g).sum() >= 5]
    if len(genre_groups) >= 2:
        f_g, p_g = f_oneway(*genre_groups)
        print(f"  F={f_g:.3f}, p={p_g:.4f}")
        print("  Genre means:")
        for g in rated.groupby("genre")["replay_value"].mean().sort_values(ascending=False).items():
            print(f"    {g[0]:<20} {g[1]:.2f}")

    return res_df


# ── 3. Feature Sets & Preprocessor ───────────────────────────────────────────

NUMERIC_FEATURES = (
    [f"{c}_mean" for c in AUDIO_COLS] +
    [f"{c}_std" for c in AUDIO_COLS[:6]] +
    [f"mfcc_{i}_mean" for i in range(13)] +
    ["total_tracks", "bpm_cv", "is_major_pct", "key_semitone_mode",
     "artist_replay_mean", "artist_score_mean", "artist_album_count",
     "artist_theme_mean", "artist_prod_mean",
     "genre_replay_mean", "genre_album_count",
     "subgenre_replay_mean", "subgenre_count"]
)
CATEGORICAL_FEATURES = ["genre"]


def build_preprocessor():
    return ColumnTransformer([
        ("num", Pipeline([("imp", SimpleImputer(strategy="median")),
                          ("sc",  StandardScaler())]), NUMERIC_FEATURES),
        ("cat", Pipeline([("imp", SimpleImputer(strategy="constant", fill_value="missing")),
                          ("ohe", OneHotEncoder(handle_unknown="ignore", sparse_output=False))]),
         CATEGORICAL_FEATURES),
    ], remainder="drop")


# ── 4. LightGBM Model ─────────────────────────────────────────────────────────

def train_and_evaluate(df: pd.DataFrame):
    rated = df[df["replay_value"].notna()].copy()
    avail_numeric = [f for f in NUMERIC_FEATURES if f in rated.columns]
    avail_cat     = [f for f in CATEGORICAL_FEATURES if f in rated.columns]

    X = rated[avail_numeric + avail_cat].copy()
    y = rated["replay_value"].values

    pipe = Pipeline([
        ("pre", ColumnTransformer([
            ("num", Pipeline([("imp", SimpleImputer(strategy="median")),
                              ("sc",  StandardScaler())]), avail_numeric),
            ("cat", Pipeline([("imp", SimpleImputer(strategy="constant", fill_value="missing")),
                              ("ohe", OneHotEncoder(handle_unknown="ignore", sparse_output=False))]),
             avail_cat),
        ], remainder="drop")),
        ("model", xgb.XGBRegressor(
            n_estimators=500,
            learning_rate=0.03,
            max_depth=4,
            subsample=0.8,
            colsample_bytree=0.8,
            reg_alpha=0.1,
            reg_lambda=1.0,
            min_child_weight=5,
            gamma=0.1,
            random_state=42,
            verbosity=0,
        )),
    ])

    # ── Hyperparameter search ────────────────────────────────────────────────
    param_dist = {
        "model__n_estimators":       [300, 500, 800],
        "model__learning_rate":      [0.01, 0.03, 0.05, 0.1],
        "model__max_depth":          [3, 4, 5, 6],
        "model__subsample":          [0.6, 0.7, 0.8, 1.0],
        "model__colsample_bytree":   [0.6, 0.7, 0.8, 1.0],
        "model__reg_alpha":          [0, 0.01, 0.1, 1.0],
        "model__reg_lambda":         [0.5, 1.0, 2.0, 5.0],
        "model__min_child_weight":   [1, 3, 5, 10],
        "model__gamma":              [0, 0.05, 0.1, 0.3],
    }
    search = RandomizedSearchCV(pipe, param_dist, n_iter=40, cv=5,
                                scoring="neg_mean_absolute_error",
                                random_state=42, n_jobs=-1, verbose=0)
    search.fit(X, y)
    pipe = search.best_estimator_
    print(f"\nBest hyperparameters:")
    for k, v in sorted(search.best_params_.items()):
        print(f"  {k.replace('model__',''):<25} {v}")
    print(f"  Best CV MAE: {-search.best_score_:.4f}")

    cv = KFold(n_splits=5, shuffle=True, random_state=42)
    oof = np.zeros(len(y))
    for train_idx, val_idx in cv.split(X, y):
        pipe.fit(X.iloc[train_idx], y[train_idx])
        oof[val_idx] = pipe.predict(X.iloc[val_idx])

    mae  = mean_absolute_error(y, oof)
    rmse = np.sqrt(mean_squared_error(y, oof))
    r2   = r2_score(y, oof)
    pr   = pearsonr(y, oof).statistic
    sr   = spearmanr(y, oof).statistic
    w1   = (np.abs(y - oof) <= 1).mean()

    print(f"\n── LightGBM CV Results (5-fold) ─────────────────────────────────")
    print(f"  MAE:          {mae:.4f}")
    print(f"  RMSE:         {rmse:.4f}")
    print(f"  R²:           {r2:.4f}")
    print(f"  Pearson r:    {pr:.4f}")
    print(f"  Spearman ρ:   {sr:.4f}")
    print(f"  Within 1pt:   {w1:.1%}")

    # Feature importance
    pipe.fit(X, y)
    try:
        pre_fitted = pipe.named_steps["pre"]
        cat_names = list(pre_fitted.named_transformers_["cat"].named_steps["ohe"]
                         .get_feature_names_out(avail_cat))
        feat_names = avail_numeric + cat_names
        imps = pipe.named_steps["model"].feature_importances_
        if len(imps) == len(feat_names):
            importances = pd.Series(imps, index=feat_names).sort_values(ascending=False)
            print(f"\nTop 15 feature importances:")
            for feat, imp in importances.head(15).items():
                print(f"  {feat:<40} {imp:.4f}")
    except Exception:
        pass

    return pipe, avail_numeric, avail_cat


# ── 5. Predict & Write ────────────────────────────────────────────────────────

def predict_and_write(pipe, df: pd.DataFrame, avail_numeric, avail_cat, con):
    to_listen = df[df["replay_value"].isna()].copy()
    if to_listen.empty:
        print("No albums to predict.")
        return

    X = to_listen[avail_numeric + avail_cat].copy()
    preds = pipe.predict(X)

    # Clamp and round to 1 decimal
    preds = np.clip(preds, 1.0, 10.0).round(1)

    written = 0
    for album_id, pred in zip(to_listen["album_id"], preds):
        con.execute("UPDATE album SET predicted_replay = ? WHERE id = ?", (float(pred), int(album_id)))
        written += 1
    con.commit()

    print(f"\n── Predictions written: {written} albums ──────────────────────────")
    print(f"  Mean: {preds.mean():.2f}  Std: {preds.std():.2f}")
    print(f"  Min:  {preds.min():.1f}   Max: {preds.max():.1f}")

    # Distribution
    bins = {str(i): int(((preds >= i - 0.5) & (preds < i + 0.5)).sum()) for i in range(1, 11)}
    print(f"\n  Distribution:")
    for score, count in bins.items():
        if count > 0:
            print(f"    {score}: {'█' * min(count, 40)} ({count})")


# ── 6. Main ───────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--anova",   action="store_true", help="Run ANOVA analysis only")
    parser.add_argument("--predict", action="store_true", help="Predict only, skip ANOVA")
    args = parser.parse_args()

    con = sqlite3.connect(DB_PATH)
    print("Loading album features...")
    df = load_album_features(con)
    print(f"  {df['replay_value'].notna().sum()} rated albums, "
          f"{df['replay_value'].isna().sum()} unrated albums with audio data")

    if not args.predict:
        run_anova(df)

    if not args.anova:
        print("\nTraining LightGBM model...")
        pipe, avail_numeric, avail_cat = train_and_evaluate(df)

        print("\nPredicting replay values for to_listen albums...")
        predict_and_write(pipe, df, avail_numeric, avail_cat, con)

        # Show top predictions
        top = con.execute("""
            SELECT artist, album_name, genre, predicted_replay
            FROM album WHERE predicted_replay IS NOT NULL AND status='to_listen'
            ORDER BY predicted_replay DESC LIMIT 20
        """).fetchall()
        print("\nTop 20 predicted replay value albums:")
        for artist, album, genre, score in top:
            print(f"  {score:.1f}  {artist} – {album} [{genre or '?'}]")

    con.close()
