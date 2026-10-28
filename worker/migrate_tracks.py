"""
One-time backfill for the shared global track store (PLAN_ml_worker_split §2).

1. Creates the new tables (track, trackaudio, albumcorpus, workerrun) and
   song.track_id via init_db().
2. Builds track rows from every existing song, keyed by recording
   (backend/tracklink.py, trackkeys.recording_key); links song.track_id.
3. Copies each track's best songaudiofeatures row into trackaudio
   (most non-null feature columns wins, tie-break latest analyzed_at),
   tagged source='yt_full'.
4. Uploads local corpus/*.json files into albumcorpus keyed by normalized
   (artist, album_name).
5. Prints verification counts.

Idempotent: safe to re-run (existing tracks/audio/corpus rows are kept).

Usage:
    python -m worker.migrate_tracks
"""
import json
import sys
import pathlib
from datetime import datetime

sys.path.insert(0, str(pathlib.Path(__file__).parent.parent))

from sqlalchemy import text
import backend.models  # noqa: F401 — registers tables in SQLModel.metadata
from backend.database import engine, init_db
from backend.trackkeys import album_key
from backend.tracklink import link_unlinked

_FEATURE_COLS = (
    "bpm", "bpm_confidence", "key", "scale", "key_strength",
    "chords_changes_rate", "loudness_db", "dynamic_complexity",
    "danceability", "energy", "dissonance", "spectral_centroid",
    "onset_rate", "loudness_lufs", "mfcc",
)


def build_tracks(con) -> dict:
    """Create track rows for all unlinked songs; return {song_id: track_id}.
    Incremental: the nightly ingest reuses this to link newly imported songs.
    The rule is backend/tracklink.py's, shared with the import path."""
    return link_unlinked(con)


def backfill_audio(con):
    """Copy each track's best songaudiofeatures row into trackaudio.

    Only a legacy analysis made after the track row existed counts. The re-key
    of October 2026 (backend/rekey_tracks.py) split live takes, remixes and
    duet versions off the studio track they had been sharing, into new rows
    with no audio so the ingest fetches the right version. Their songs' legacy
    rows predate the split, and which recording a legacy search actually
    downloaded can't be told after the fact; the ingest searches for the
    version by its full title. The initial backfill, the one time older rows
    were wanted, has long since run: no track lacking audio had an eligible
    row when this was added."""
    cols = ", ".join(f"af.{c}" for c in _FEATURE_COLS)
    rows = con.execute(text(f"""
        SELECT s.track_id, af.analyzed_at, {cols}
        FROM songaudiofeatures af
        JOIN song s ON s.id = af.song_id
        JOIN track t ON t.id = s.track_id
        WHERE af.bpm IS NOT NULL AND af.analyzed_at >= t.created_at
    """)).fetchall()

    done = {r[0] for r in con.execute(text("SELECT track_id FROM trackaudio")).fetchall()}

    best: dict[int, tuple] = {}
    for row in rows:
        tid, analyzed_at, *feats = row
        if tid in done:
            continue
        richness = sum(v is not None for v in feats)
        cur = best.get(tid)
        if cur is None or (richness, analyzed_at or "") > (cur[0], cur[1] or ""):
            best[tid] = (richness, analyzed_at, feats)

    if best:
        from psycopg2.extras import execute_values
        col_names = ", ".join(_FEATURE_COLS)
        raw = con.connection.driver_connection
        with raw.cursor() as cur:
            execute_values(cur,
                f"INSERT INTO trackaudio (track_id, analyzed_at, source, {col_names})"
                f" VALUES %s ON CONFLICT (track_id) DO NOTHING",
                [(tid, analyzed_at or datetime.utcnow(), "yt_full", *feats)
                 for tid, (_, analyzed_at, feats) in best.items()])
        raw.commit()
    return len(best)


def backfill_corpus(con):
    """Upload local corpus/*.json into albumcorpus, keyed per rated/known album."""
    from theme_predictor.corpus import CACHE_DIR, _safe_filename

    albums = con.execute(text(
        "SELECT DISTINCT artist, album_name, year FROM album")).fetchall()
    have = {r[0] for r in con.execute(text("SELECT album_key FROM albumcorpus")).fetchall()}

    inserted = 0
    for artist, album_name, year in albums:
        key = album_key(artist or "", album_name or "")
        if key in have:
            continue
        path = CACHE_DIR / f"{_safe_filename(artist, album_name)}.json"
        if not path.exists():
            continue
        try:
            corpus_json = json.dumps(json.loads(path.read_text()))
        except Exception:
            continue
        con.execute(text(
            "INSERT INTO albumcorpus (album_key, corpus_json, built_at) "
            "VALUES (:k, :c, NOW()) ON CONFLICT (album_key) DO NOTHING"),
            {"k": key, "c": corpus_json})
        have.add(key)
        inserted += 1
    con.commit()
    return inserted


def sync_tracks(con) -> int:
    """Incremental link + audio copy for songs added since the last run.
    Returns the number of newly linked songs. Used by the nightly ingest and,
    until cutover, by the legacy add-album path so freshly analyzed audio in
    songaudiofeatures is immediately visible through trackaudio."""
    linked = build_tracks(con)
    if linked:
        backfill_audio(con)
    return len(linked)


def verify(con):
    q = lambda sql: con.execute(text(sql)).scalar()
    n_songs = q("SELECT COUNT(*) FROM song")
    n_linked = q("SELECT COUNT(*) FROM song WHERE track_id IS NOT NULL")
    n_tracks = q("SELECT COUNT(*) FROM track")
    n_audio_songs = q(
        "SELECT COUNT(DISTINCT s.track_id) FROM songaudiofeatures af"
        " JOIN song s ON s.id = af.song_id WHERE af.bpm IS NOT NULL")
    n_track_audio = q("SELECT COUNT(*) FROM trackaudio")
    n_corpus = q("SELECT COUNT(*) FROM albumcorpus")
    # songs sharing a track = dedup wins
    n_dedup = q("SELECT COUNT(*) FROM (SELECT track_id FROM song WHERE track_id"
                " IS NOT NULL GROUP BY track_id HAVING COUNT(*) > 1) t")

    print(f"songs linked:        {n_linked}/{n_songs}")
    print(f"unique tracks:       {n_tracks} ({n_dedup} shared by >1 song)")
    print(f"tracks with audio:   {n_track_audio} (expected ≈ {n_audio_songs})")
    print(f"album corpora in DB: {n_corpus}")
    assert n_linked == n_songs, "some songs have no track_id"
    assert n_track_audio >= n_audio_songs * 0.99, "trackaudio backfill incomplete"


def main():
    init_db()
    with engine.connect() as con:
        song_track = build_tracks(con)
        print(f"linked {len(song_track)} songs to tracks")
        n_audio = backfill_audio(con)
        print(f"backfilled {n_audio} trackaudio rows")
        n_corpus = backfill_corpus(con)
        print(f"uploaded {n_corpus} album corpora")
        verify(con)


if __name__ == "__main__":
    main()
