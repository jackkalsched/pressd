"""
Essentia Discogs-400 genre classification pipeline.

Two-stage model:
  1. discogs-effnet-bs64-1.pb          → audio embeddings (needs 16kHz mono)
  2. genre_discogs400-discogs-effnet-1.pb → 400-class genre activations

Labels format: "StyleGroup---Subgenre"  (e.g. "Hip Hop---Trap")
"""

from __future__ import annotations

import json
import urllib.request
from collections import Counter
from pathlib import Path
from typing import Optional

MODEL_DIR = Path(__file__).parent / "models"

_DOWNLOADS = {
    "discogs-effnet-bs64-1.pb": (
        "https://essentia.upf.edu/models/feature-extractors/discogs-effnet/"
        "discogs-effnet-bs64-1.pb"
    ),
    "genre_discogs400-discogs-effnet-1.pb": (
        "https://essentia.upf.edu/models/classification-heads/genre_discogs400/"
        "genre_discogs400-discogs-effnet-1.pb"
    ),
    "genre_discogs400-discogs-effnet-1.json": (
        "https://essentia.upf.edu/models/classification-heads/genre_discogs400/"
        "genre_discogs400-discogs-effnet-1.json"
    ),
}

# Module-level cache so models are only loaded once per process
_cache: dict = {}


def download_models(model_dir: Path = MODEL_DIR) -> dict:
    model_dir.mkdir(parents=True, exist_ok=True)
    results = {}
    for filename, url in _DOWNLOADS.items():
        dest = model_dir / filename
        if dest.exists():
            results[filename] = {"status": "already_present", "size_mb": round(dest.stat().st_size / 1e6, 1)}
        else:
            urllib.request.urlretrieve(url, dest)
            results[filename] = {"status": "downloaded", "size_mb": round(dest.stat().st_size / 1e6, 1)}
    return results


def load_models(model_dir: Path = MODEL_DIR):
    """Return (embedding_model, genre_model, labels). Cached after first call."""
    if _cache:
        return _cache["emb"], _cache["genre"], _cache["labels"]

    import essentia.standard as es

    emb_path = str(model_dir / "discogs-effnet-bs64-1.pb")
    genre_pb  = str(model_dir / "genre_discogs400-discogs-effnet-1.pb")
    labels_path = model_dir / "genre_discogs400-discogs-effnet-1.json"

    emb_model = es.TensorflowPredictEffnetDiscogs(
        graphFilename=emb_path,
        output="PartitionedCall:1",
    )
    genre_model = es.TensorflowPredict2D(
        graphFilename=genre_pb,
        input="serving_default_model_Placeholder",
        output="PartitionedCall:0",
    )
    with open(labels_path) as f:
        meta = json.load(f)
    labels: list[str] = meta["classes"]

    _cache["emb"]    = emb_model
    _cache["genre"]  = genre_model
    _cache["labels"] = labels
    return emb_model, genre_model, labels


def classify_file(
    path: str,
    emb_model,
    genre_model,
    labels: list[str],
    top_n: int = 5,
) -> list[tuple[str, float]]:
    """Return top_n (label, confidence) pairs for one audio file."""
    import essentia.standard as es
    import numpy as np

    audio = es.MonoLoader(filename=path, sampleRate=16000, resampleQuality=4)()
    embeddings = emb_model(audio)
    activations = genre_model(embeddings)          # shape: (frames, 400)
    avg = np.mean(activations, axis=0)             # (400,)

    top_idx = np.argsort(avg)[::-1][:top_n]
    return [(labels[i], float(avg[i])) for i in top_idx]


def aggregate_predictions(
    per_song: list[list[tuple[str, float]]],
) -> dict[str, Optional[str]]:
    """
    Given per-song top predictions, return dict with genre / sub_genre1 / sub_genre2.

    Label format: "StyleGroup---Subgenre"
    - genre      = most common top-level StyleGroup across songs
    - sub_genre1 = highest avg-confidence Subgenre tag
    - sub_genre2 = second-highest avg-confidence Subgenre tag
    """
    if not per_song:
        return {"genre": None, "sub_genre1": None, "sub_genre2": None}

    top_groups: list[str] = []
    subgenre_scores: dict[str, list[float]] = {}

    for song_preds in per_song:
        if not song_preds:
            continue
        # Top prediction for this song drives the group vote
        top_label = song_preds[0][0]
        group = top_label.split("---")[0] if "---" in top_label else top_label
        top_groups.append(group)

        for label, conf in song_preds:
            sub = label.split("---")[1] if "---" in label else label
            subgenre_scores.setdefault(sub, []).append(conf)

    genre = Counter(top_groups).most_common(1)[0][0] if top_groups else None

    # Rank subgenres by mean confidence
    ranked = sorted(
        subgenre_scores.items(),
        key=lambda kv: sum(kv[1]) / len(kv[1]),
        reverse=True,
    )
    sub_genre1 = ranked[0][0] if len(ranked) > 0 else None
    sub_genre2 = ranked[1][0] if len(ranked) > 1 else None

    return {"genre": genre, "sub_genre1": sub_genre1, "sub_genre2": sub_genre2}
