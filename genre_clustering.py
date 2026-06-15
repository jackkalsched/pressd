"""
Genre clustering and visualization using UMAP and HDBSCAN.
=========================
Defines individual song genre cluster based on Essentia metadata.

Requirements:
    pip install pandas umap-learn hdbscan matplotlib seaborn

Usage:
    python genre_clustering.py
"""

import os
os.environ["OMP_NUM_THREADS"] = "1"
os.environ["OPENBLAS_NUM_THREADS"] = "1"
os.environ["MKL_NUM_THREADS"] = "1"
os.environ["NUMBA_NUM_THREADS"] = "1"

import json
import sqlite3
import warnings
warnings.filterwarnings("ignore")

import numpy as np
import pandas as pd
from sklearn.preprocessing import StandardScaler, OneHotEncoder
from sklearn.impute import SimpleImputer
from sklearn.pipeline import Pipeline
from sklearn.compose import ColumnTransformer

DB_PATH = "pressd.db"

def load_data(db_path: str) -> pd.DataFrame:
    con = sqlite3.connect(db_path)
    df = pd.read_sql_query("""
        SELECT
            s.id            AS song_id,
            s.title,
            s.score,
            s.artist,
            a.album_name,
            a.genre,
            a.sub_genre1,
            a.year,
            af.bpm,
            af.bpm_confidence,
            af.key,
            af.scale,
            af.key_strength,
            af.chords_changes_rate,
            af.loudness_db,
            af.dynamic_complexity,
            af.danceability,
            af.energy,
            af.dissonance,
            af.spectral_centroid,
            af.inharmonicity,
            af.onset_rate,
            af.loudness_lufs,
            af.mfcc
        FROM song s
        JOIN album a ON a.id = s.album_id
        JOIN songaudiofeatures af ON af.song_id = s.id
        WHERE af.bpm IS NOT NULL
    """, con)
    con.close()
    return df


def expand_mfcc(df: pd.DataFrame) -> pd.DataFrame:
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


def build_features(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    df.drop(columns=["energy"], inplace=True, errors="ignore")
    df["is_major"] = (df["scale"] == "major").astype(int)
    KEY_MAP = {
        "C": 0, "C#": 1, "Db": 1, "D": 2, "D#": 3, "Eb": 3,
        "E": 4, "F": 5, "F#": 6, "Gb": 6, "G": 7, "G#": 8,
        "Ab": 8, "A": 9, "A#": 10, "Bb": 10, "B": 11,
    }
    df["key_semitone"] = df["key"].map(KEY_MAP)
    df["loudness_lufs"] = df["loudness_lufs"].fillna(df["loudness_db"])
    return df


NUMERIC_FEATURES = [
    "bpm", "bpm_confidence", "key_semitone", "key_strength",
    "chords_changes_rate", "loudness_db", "loudness_lufs",
    "dynamic_complexity", "danceability", "dissonance",
    "spectral_centroid", "inharmonicity", "onset_rate",
    "is_major",
    *[f"mfcc_{i}" for i in range(13)],
]
CATEGORICAL_FEATURES = ["scale"]


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


GENRE_COLORS = {
    "Hip-Hop":           "#e07b39",
    "Pop":               "#9b59b6",
    "Rock":              "#e74c3c",
    "R&B":               "#e91e8c",
    "Electronic":        "#3498db",
    "Country":           "#f39c12",
    "Folk":              "#27ae60",
    "Jazz":              "#1abc9c",
    "Latin":             "#e67e22",
    "Classical":         "#7f8c8d",
    "Afrobeats":         "#2ecc71",
    "Funk":              "#d35400",
    "Disco":             "#8e44ad",
    "Singer-Songwriter": "#16a085",
    "Blues":             "#2980b9",
    "Gospel":            "#c0392b",
}


def genre_clustering(df: pd.DataFrame, X: np.ndarray):
    import umap
    import hdbscan
    import matplotlib.pyplot as plt
    import matplotlib.patches as mpatches

    # ── UMAP
    print("Running UMAP…")
    reducer = umap.UMAP(n_neighbors=15, min_dist=0.1, n_components=2, random_state=42, low_memory=False)
    embedding = reducer.fit_transform(X)

    # ── HDBSCAN
    print("Clustering with HDBSCAN…")
    clusterer = hdbscan.HDBSCAN(min_cluster_size=10, min_samples=5)
    cluster_labels = clusterer.fit_predict(embedding)
    n_clusters = len(set(cluster_labels)) - (1 if -1 in cluster_labels else 0)
    print(f"  Found {n_clusters} clusters ({(cluster_labels == -1).sum()} noise points)")

    fig, axes = plt.subplots(1, 2, figsize=(18, 7))
    fig.patch.set_facecolor("#f8f8f8")

    # ── Left: coloured by actual genre
    ax = axes[0]
    ax.set_facecolor("#f0f0f0")
    genres = df["genre"].fillna("Unknown").values
    unique_genres = sorted(set(genres))
    for g in unique_genres:
        mask = genres == g
        color = GENRE_COLORS.get(g, "#cccccc")
        ax.scatter(embedding[mask, 0], embedding[mask, 1],
                   c=color, s=6, alpha=0.6, label=g, linewidths=0)
    ax.set_title("Colored by Genre Label", fontsize=13, fontweight="bold", pad=10)
    ax.set_xlabel("UMAP 1", fontsize=10)
    ax.set_ylabel("UMAP 2", fontsize=10)
    ax.tick_params(labelsize=8)
    patches = [mpatches.Patch(color=GENRE_COLORS.get(g, "#cccccc"), label=g) for g in unique_genres]
    ax.legend(handles=patches, fontsize=7, loc="lower left",
              framealpha=0.8, ncol=2, markerscale=1.5)

    # ── Right: coloured by HDBSCAN cluster
    ax = axes[1]
    ax.set_facecolor("#f0f0f0")
    cmap = plt.cm.get_cmap("tab20", max(n_clusters, 1))
    noise_mask = cluster_labels == -1
    ax.scatter(embedding[noise_mask, 0], embedding[noise_mask, 1],
               c="#cccccc", s=4, alpha=0.3, linewidths=0, label="noise")
    for c in range(n_clusters):
        mask = cluster_labels == c
        ax.scatter(embedding[mask, 0], embedding[mask, 1],
                   c=[cmap(c)], s=6, alpha=0.7, linewidths=0, label=f"C{c}")
    ax.set_title("HDBSCAN Audio Clusters", fontsize=13, fontweight="bold", pad=10)
    ax.set_xlabel("UMAP 1", fontsize=10)
    ax.set_ylabel("UMAP 2", fontsize=10)
    ax.tick_params(labelsize=8)
    ax.legend(fontsize=7, loc="lower left", framealpha=0.8,
              ncol=3, markerscale=1.5)

    plt.suptitle("Song Audio Feature Space — UMAP Projection", fontsize=15, fontweight="bold", y=1.01)
    plt.tight_layout()
    plt.savefig("genre_clustering.png", dpi=150, bbox_inches="tight")
    print("Saved → genre_clustering.png")

    # ── Cluster composition summary
    df2 = df.copy()
    df2["cluster"] = cluster_labels
    print("\nCluster genre composition (top 3 genres per cluster):")
    for c in range(n_clusters):
        top = df2[df2["cluster"] == c]["genre"].value_counts().head(3)
        print(f"  C{c} ({(cluster_labels==c).sum()} songs): {', '.join(f'{g}({n})' for g, n in top.items())}")


if __name__ == "__main__":
    print("Loading data…")
    df_raw = load_data(DB_PATH)
    print(f"  {len(df_raw):,} songs with audio features")

    df = expand_mfcc(df_raw)
    df = build_features(df)
    df.dropna(subset=["bpm", "loudness_db", "danceability"], inplace=True)
    print(f"  {len(df):,} songs after cleaning")

    features_df = df[NUMERIC_FEATURES + CATEGORICAL_FEATURES].copy()
    pre = build_preprocessor()
    X = pre.fit_transform(features_df)

    genre_clustering(df, X)
