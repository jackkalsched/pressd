"""
One-time backfill for the shared global track store (PLAN_ml_worker_split §2).

1. Creates the new tables (track, trackaudio, albumcorpus, workerrun) and
   song.track_id via init_db().
2. Builds track rows from every existing song, dedup-keyed on normalized
   (artist, title); links song.track_id.
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
from backend.trackkeys import track_key, album_key

# Duration disagreement beyond this means "different recording, same name"
_DUR_TOL_MS = 10_000

_FEATURE_COLS = (
    "bpm", "bpm_confidence", "key", "scale", "key_strength",
    "chords_changes_rate", "loudness_db", "dynamic_complexity",
    "danceability", "energy", "dissonance", "spectral_centroid",
    "onset_rate", "loudness_lufs", "mfcc",
)


def build_tracks(con) -> dict:
    """Create track rows for all unlinked songs; return {song_id: track_id}.
    Incremental: the nightly ingest reuses this to link newly imported songs.
    Bulk execute_values throughout — row-by-row round trips to Supabase take
    ~20 min for the initial 9.5k-song backfill; this takes seconds."""
    from psycopg2.extras import execute_values

    rows = con.execute(text("""
        SELECT s.id, COALESCE(NULLIF(s.artist, ''), a.artist), s.title, s.duration_ms
        FROM song s JOIN album a ON a.id = s.album_id
        WHERE s.track_id IS NULL
    """)).fetchall()
    if not rows:
        return {}

    existing = {r[0]: (r[1], r[2]) for r in con.execute(
        text("SELECT track_key, id, duration_ms FROM track")).fetchall()}

    song_key: dict[int, str] = {}
    new_tracks: dict[str, list] = {}   # key -> [artist_norm, title_norm, duration_ms]

    for song_id, artist, title, dur in rows:
        key = track_key(artist or "", title or "")
        hit = existing.get(key)
        if hit and dur and hit[1] and abs(dur - hit[1]) > _DUR_TOL_MS:
            key = f"{key}||d{dur // 1000}"   # same name, different recording
            hit = existing.get(key)
        song_key[song_id] = key
        if not hit and key not in new_tracks:
            parts = key.split("||")
            new_tracks[key] = [parts[0], parts[1], dur]

    raw = con.connection.driver_connection
    with raw.cursor() as cur:
        if new_tracks:
            execute_values(cur,
                "INSERT INTO track (track_key, artist_norm, title_norm, duration_ms, created_at)"
                " VALUES %s ON CONFLICT (track_key) DO NOTHING",
                [(k, a, t, d, datetime.utcnow())
                 for k, (a, t, d) in new_tracks.items()])

        cur.execute("SELECT track_key, id FROM track")
        key_id = dict(cur.fetchall())

        pairs = [(sid, key_id[k]) for sid, k in song_key.items() if k in key_id]
        execute_values(cur,
            "UPDATE song SET track_id = data.tid FROM (VALUES %s) AS data (sid, tid)"
            " WHERE song.id = data.sid",
            pairs)
    raw.commit()
    return dict(pairs)


def backfill_audio(con):
    """Copy each track's best songaudiofeatures row into trackaudio."""
    cols = ", ".join(f"af.{c}" for c in _FEATURE_COLS)
    rows = con.execute(text(f"""
        SELECT s.track_id, af.analyzed_at, {cols}
        FROM songaudiofeatures af
        JOIN song s ON s.id = af.song_id
        WHERE s.track_id IS NOT NULL AND af.bpm IS NOT NULL
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
