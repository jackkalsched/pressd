"""
Song Score Regression Model
============================
Predicts individual song scores from Essentia audio features.

Requirements:
    pip install pandas numpy scikit-learn lightgbm xgboost shap matplotlib seaborn

Usage:
    python song_score_model.py
"""

import json
import pickle
import sys
import pathlib
import warnings

from sqlalchemy import text
warnings.filterwarnings("ignore")

import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestRegressor, GradientBoostingRegressor
from sklearn.linear_model import Ridge, Lasso
from sklearn.model_selection import KFold, cross_val_score
from sklearn.preprocessing import StandardScaler, OneHotEncoder
from sklearn.impute import SimpleImputer
from sklearn.pipeline import Pipeline
from sklearn.compose import ColumnTransformer
from sklearn.metrics import mean_absolute_error, r2_score, mean_squared_error, explained_variance_score
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

_FEATURE_COLS = [
    "song_id", "title", "score", "artist", "album_name", "genre", "sub_genre1", "year",
    "bpm", "bpm_confidence", "key", "scale", "key_strength", "chords_changes_rate",
    "loudness_db", "dynamic_complexity", "danceability", "energy", "dissonance",
    "spectral_centroid", "inharmonicity", "onset_rate", "loudness_lufs", "mfcc",
]

_PREDICT_COLS = [
    "song_id", "title", "artist", "album_name", "genre", "sub_genre1", "year",
    "bpm", "bpm_confidence", "key", "scale", "key_strength", "chords_changes_rate",
    "loudness_db", "dynamic_complexity", "danceability", "energy", "dissonance",
    "spectral_centroid", "inharmonicity", "onset_rate", "loudness_lufs", "mfcc",
]

_TRAINING_SQL = text("""
    SELECT s.id AS song_id, s.title, s.score, s.artist,
           a.album_name, a.genre, a.sub_genre1, a.year,
           af.bpm, af.bpm_confidence, af.key, af.scale, af.key_strength,
           af.chords_changes_rate, af.loudness_db, af.dynamic_complexity,
           af.danceability, af.energy, af.dissonance, af.spectral_centroid,
           af.inharmonicity, af.onset_rate, af.loudness_lufs, af.mfcc
    FROM song s
    JOIN album a ON a.id = s.album_id
    JOIN songaudiofeatures af ON af.song_id = s.id
    WHERE s.score IS NOT NULL AND af.bpm IS NOT NULL
""")

_ALBUM_SQL = text("""
    SELECT s.id AS song_id, s.title, s.artist,
           a.album_name, a.genre, a.sub_genre1, a.year,
           af.bpm, af.bpm_confidence, af.key, af.scale, af.key_strength,
           af.chords_changes_rate, af.loudness_db, af.dynamic_complexity,
           af.danceability, af.energy, af.dissonance, af.spectral_centroid,
           af.inharmonicity, af.onset_rate, af.loudness_lufs, af.mfcc
    FROM song s
    JOIN album a ON a.id = s.album_id
    JOIN songaudiofeatures af ON af.song_id = s.id
    WHERE s.album_id = :album_id AND af.bpm IS NOT NULL
""")


def load_data(con) -> pd.DataFrame:
    result = con.execute(_TRAINING_SQL)
    return pd.DataFrame(result.fetchall(), columns=_FEATURE_COLS)


_MODEL_PATH = pathlib.Path(__file__).parent / "song_score_model.pkl"
_META_PATH  = pathlib.Path(__file__).parent / "song_score_model_meta.json"


def _load_cached_model(n_songs: int):
    """Return cached pipeline if it was trained on exactly n_songs, else None."""
    try:
        if not _MODEL_PATH.exists() or not _META_PATH.exists():
            return None
        with open(_META_PATH) as f:
            meta = json.load(f)
        if meta.get("n_songs") != n_songs:
            return None
        with open(_MODEL_PATH, "rb") as f:
            pipe = pickle.load(f)
        print(f"[song_score_model] loaded cached model ({n_songs} training songs)")
        return pipe
    except Exception as e:
        print(f"[song_score_model] cache load failed: {e}")
        return None


def _save_model(pipe, n_songs: int, model_name: str):
    try:
        with open(_MODEL_PATH, "wb") as f:
            pickle.dump(pipe, f)
        with open(_META_PATH, "w") as f:
            json.dump({"n_songs": n_songs, "model": model_name}, f)
        print(f"[song_score_model] saved model → {_MODEL_PATH.name}  ({n_songs} songs, {model_name})")
    except Exception as e:
        print(f"[song_score_model] save failed: {e}")


def train_model(con):
    """Train on all rated songs with audio features, save .pkl, return pipeline."""
    df_raw = load_data(con)
    n = len(df_raw)
    if n < 20:
        print(f"[song_score_model] only {n} training songs — need ≥20")
        return None, n

    df = expand_mfcc(df_raw)
    df = build_features(df)
    df.dropna(subset=["bpm", "loudness_db", "danceability"], inplace=True)
    if len(df) < 20:
        return None, n

    feat_cols = NUMERIC_FEATURES + CATEGORICAL_FEATURES
    models = get_models()
    pipe = None
    chosen = None
    for model_name in ("LightGBM", "XGBoost", "RandomForest"):
        if model_name not in models:
            continue
        try:
            p = models[model_name]
            p.fit(df[feat_cols], df["score"])
            pipe = p
            chosen = model_name
            print(f"[song_score_model] trained {model_name} on {len(df)} songs")
            break
        except Exception as e:
            print(f"[song_score_model] {model_name} failed ({e}), trying next")

    if pipe:
        _save_model(pipe, n, chosen)
    return pipe, n


def predict_for_album(con, album_id: int) -> float | None:
    """Load or train model, predict song scores for album_id. Returns mean predicted score."""
    df_raw = load_data(con)
    n = len(df_raw)
    if n < 20:
        return None

    result = con.execute(_ALBUM_SQL, {"album_id": album_id})
    rows = result.fetchall()
    if not rows:
        return None
    df_pred_raw = pd.DataFrame(rows, columns=_PREDICT_COLS)
    df_pred = build_features(expand_mfcc(df_pred_raw))

    # Use cached model if training data unchanged, otherwise retrain
    pipe = _load_cached_model(n)
    if pipe is None:
        pipe, _ = train_model(con)
    if pipe is None:
        return None

    feat_cols = NUMERIC_FEATURES + CATEGORICAL_FEATURES
    preds = pipe.predict(df_pred[feat_cols])
    avg = float(np.mean(preds))
    print(f"[song_score_model] album {album_id}: {len(preds)} songs → avg={round(avg, 3)}")
    return avg


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


# ── 3. Column groups ──────────────────────────────────────────────────────────

NUMERIC_FEATURES = [
    "bpm", "bpm_confidence", "key_semitone", "key_strength",
    "chords_changes_rate", "loudness_db", "loudness_lufs",
    "dynamic_complexity", "danceability", "dissonance",
    "spectral_centroid", "inharmonicity", "onset_rate",
    "is_major",
    *[f"mfcc_{i}" for i in range(13)],
]

CATEGORICAL_FEATURES = ["scale"]   # scale kept for OHE alongside is_major


# ── 4. Build preprocessor ─────────────────────────────────────────────────────

def build_preprocessor():
    numeric_pipe = Pipeline([
        ("imputer", SimpleImputer(strategy="median")),
        ("scaler",  StandardScaler()),
    ])
    cat_pipe = Pipeline([
        ("imputer", SimpleImputer(strategy="constant", fill_value="missing")),
        ("ohe",     OneHotEncoder(handle_unknown="ignore", sparse_output=False)),
    ])
    return ColumnTransformer([
        ("num", numeric_pipe, NUMERIC_FEATURES),
        ("cat", cat_pipe,     CATEGORICAL_FEATURES),
    ], remainder="drop")


# ── 5. Models ─────────────────────────────────────────────────────────────────

def get_models():
    models = {
        "Ridge":        Pipeline([("pre", build_preprocessor()), ("model", Ridge(alpha=1.0))]),
        "Lasso":        Pipeline([("pre", build_preprocessor()), ("model", Lasso(alpha=0.01))]),
        "RandomForest": Pipeline([("pre", build_preprocessor()), ("model", RandomForestRegressor(n_estimators=300, max_features="sqrt", random_state=42, n_jobs=-1))]),
    }
    if _HAS_XGB:
        models["XGBoost"] = Pipeline([("pre", build_preprocessor()), ("model", xgb.XGBRegressor(n_estimators=400, learning_rate=0.05, max_depth=5, subsample=0.8, colsample_bytree=0.8, random_state=42, verbosity=0))])
    if _HAS_LGB:
        models["LightGBM"] = Pipeline([("pre", build_preprocessor()), ("model", lgb.LGBMRegressor(n_estimators=500, learning_rate=0.03, num_leaves=31, subsample=0.8, colsample_bytree=0.8, random_state=42, verbose=-1))])
    return models


# ── 6. Cross-validation (grouped by artist) ───────────────────────────────────

def evaluate(df: pd.DataFrame, features_df: pd.DataFrame, target: pd.Series):
    cv = KFold(n_splits=5, shuffle=True, random_state=42)
    models = get_models()
    results = {}

    header = f"{'Model':<16} {'MAE':>7} {'RMSE':>7} {'R²':>7} {'Expl.Var':>9} {'Pearson r':>10} {'Spearman ρ':>11}"
    print(f"\n{header}  (5-fold KFold randomized)")
    print("─" * len(header))

    for name, pipe in models.items():
        # Collect out-of-fold predictions manually for richer metrics
        oof_preds = np.zeros(len(target))
        for train_idx, val_idx in cv.split(features_df, target):
            pipe.fit(features_df.iloc[train_idx], target.iloc[train_idx])
            oof_preds[val_idx] = pipe.predict(features_df.iloc[val_idx])

        y   = target.values
        yh  = oof_preds
        mae  = mean_absolute_error(y, yh)
        rmse = np.sqrt(mean_squared_error(y, yh))
        r2   = r2_score(y, yh)
        evs  = explained_variance_score(y, yh)
        pr   = pearsonr(y, yh).statistic
        sr   = spearmanr(y, yh).statistic

        results[name] = dict(mae=round(mae,4), rmse=round(rmse,4), r2=round(r2,4),
                             evs=round(evs,4), pearson=round(pr,4), spearman=round(sr,4))
        print(f"{name:<16} {mae:>7.4f} {rmse:>7.4f} {r2:>7.4f} {evs:>9.4f} {pr:>10.4f} {sr:>11.4f}")

    return results


# ── 7. Random Forest deep-dive ────────────────────────────────────────────────

def rf_deep_dive(df: pd.DataFrame, features_df: pd.DataFrame, target: pd.Series):
    """Full OOF analysis for Random Forest: most accurate predictions,
    per-tree prediction variance, and built-in feature importances."""
    print("\n── Random Forest deep-dive ──────────────────────────────────────")

    cv  = KFold(n_splits=5, shuffle=True, random_state=42)
    rf_pipe = Pipeline([
        ("pre",   build_preprocessor()),
        ("model", RandomForestRegressor(
            n_estimators=400, max_features="sqrt",
            oob_score=False, random_state=42, n_jobs=-1
        )),
    ])

    oof_preds = np.zeros(len(target))
    oof_std   = np.zeros(len(target))   # per-song prediction std across trees

    for train_idx, val_idx in cv.split(features_df, target):
        rf_pipe.fit(features_df.iloc[train_idx], target.iloc[train_idx])
        X_val = rf_pipe.named_steps["pre"].transform(features_df.iloc[val_idx])
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
    rf_pipe.fit(features_df, target)
    pre   = rf_pipe.named_steps["pre"]
    model = rf_pipe.named_steps["model"]
    cat_names = list(pre.named_transformers_["cat"].named_steps["ohe"]
                     .get_feature_names_out(CATEGORICAL_FEATURES))
    feat_names = NUMERIC_FEATURES + cat_names
    importances = pd.Series(model.feature_importances_, index=feat_names).sort_values(ascending=False)

    print("\nTop 20 feature importances (Random Forest, trained on full data):")
    print(importances.head(20).round(4).to_string())

    return results


# ── 7. SHAP feature importance (best model) ───────────────────────────────────

def shap_analysis(pipe, features_df: pd.DataFrame, target: pd.Series, model_name: str):
    try:
        import shap
        import matplotlib.pyplot as plt

        pipe.fit(features_df, target)
        X_transformed = pipe.named_steps["pre"].transform(features_df)

        # Get feature names after OHE
        num_names = NUMERIC_FEATURES
        cat_names = list(pipe.named_steps["pre"].named_transformers_["cat"]
                         .named_steps["ohe"].get_feature_names_out(CATEGORICAL_FEATURES))
        all_names = num_names + cat_names

        model = pipe.named_steps["model"]
        if hasattr(model, "get_booster"):           # XGBoost
            explainer = shap.TreeExplainer(model)
        elif hasattr(model, "booster_"):             # LightGBM
            explainer = shap.TreeExplainer(model)
        else:                                        # RF
            explainer = shap.TreeExplainer(model)

        shap_values = explainer.shap_values(X_transformed)

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


# ── 8. Prediction helper ──────────────────────────────────────────────────────

def train_and_predict(df_raw: pd.DataFrame, features_df: pd.DataFrame, target: pd.Series):
    """Train the best model on all data and return a DataFrame with predictions."""
    models = get_models()
    pipe = models["LightGBM"]
    pipe.fit(features_df, target)

    df_out = df_raw[["song_id", "title", "artist", "album_name", "genre", "score"]].copy()
    df_out["predicted_score"] = pipe.predict(features_df).round(2)
    df_out["residual"] = (df_out["score"] - df_out["predicted_score"]).round(2)
    return df_out.sort_values("residual", key=abs, ascending=False)


# ── 9. Main ───────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    sys.path.insert(0, str(pathlib.Path(__file__).parent))
    from backend.database import engine

    print("Loading data…")
    with engine.connect() as _con:
        df_raw = load_data(_con)
    print(f"  {len(df_raw):,} songs with scores and audio features")

    df = expand_mfcc(df_raw)
    df = build_features(df)

    # Drop rows with too many NaNs in audio features
    df.dropna(subset=["bpm", "loudness_db", "danceability"], inplace=True)
    print(f"  {len(df):,} songs after dropping incomplete rows")

    features_df = df[NUMERIC_FEATURES + CATEGORICAL_FEATURES].copy()
    target      = df["score"]
    groups      = df["artist"]   # group CV folds by artist

    # ── Evaluate all models
    print("\nEvaluating models (cross-validated by artist)…")
    results = evaluate(df, features_df, target)

    # ── Random Forest deep-dive
    print("\nRunning Random Forest deep-dive…")
    rf_results = rf_deep_dive(df, features_df, target)

    # ── LightGBM full-data predictions (underrated / overrated)
    print("\nTraining LightGBM on full dataset for residual analysis…")
    predictions = train_and_predict(df, features_df, target)

    print("\nSongs the model scored much higher than you did (possible underrates):")
    underrated = predictions[predictions["residual"] < -1.5].sort_values("residual")
    print(underrated[["title", "artist", "score", "predicted_score", "residual"]].head(15).to_string(index=False))

    print("\nSongs you scored much higher than the model expected (possible overrates):")
    overrated = predictions[predictions["residual"] > 1.5].sort_values("residual", ascending=False)
    print(overrated[["title", "artist", "score", "predicted_score", "residual"]].head(15).to_string(index=False))

    # ── SHAP analysis on LightGBM
    print("\nRunning SHAP analysis on LightGBM…")
    models = get_models()
    shap_analysis(models["LightGBM"], features_df, target, "LightGBM")

    print("\nDone.")

    print("\nDone.")
