import asyncio
import colorsys
import glob
import os
import re
import subprocess
import tempfile
import threading
from difflib import SequenceMatcher
from io import BytesIO

import httpx
from fastapi import APIRouter, BackgroundTasks, Depends
from PIL import Image
from sqlmodel import Session, select

from ..database import engine, get_session
from ..models import Album, Song, SongAudioFeatures

router = APIRouter(prefix="/util", tags=["util"])

MB_HEADERS = {"User-Agent": "Pressd/1.0 (music-rating-app)"}


def _extract_two_colors(image_bytes: bytes) -> tuple[str | None, str | None]:
    img = Image.open(BytesIO(image_bytes)).convert("RGB").resize((48, 48), Image.LANCZOS)
    pixels = list(img.getdata())

    scored: list[tuple[float, float, float, float]] = []
    for r, g, b in pixels:
        h, s, v = colorsys.rgb_to_hsv(r / 255, g / 255, b / 255)
        if s < 0.2 or v < 0.1 or v > 0.95:
            continue
        score = s * (1 - abs(v - 0.5))
        scored.append((score, h, s, v))

    if not scored:
        return None, None

    scored.sort(reverse=True)
    _, h1, s1, _ = scored[0]
    color1 = f"hsl({round(h1 * 360)}, {round(s1 * 80)}%, 33%)"

    color2: str | None = None
    for _, h, s, _ in scored:
        hue_diff = abs(h - h1) * 360
        hue_diff = min(hue_diff, 360 - hue_diff)
        if hue_diff > 90:
            color2 = f"hsl({round(h * 360)}, {round(s * 80)}%, 33%)"
            break

    if not color2:
        h2 = (h1 + 0.5) % 1.0
        color2 = f"hsl({round(h2 * 360)}, {round(s1 * 80)}%, 33%)"

    return color1, color2


async def _fetch_cover_url(client: httpx.AsyncClient, album: str, artist: str) -> str | None:
    """Return a Cover Art Archive URL for the best-matching MB release, or None."""
    mb_resp = await client.get(
        "https://musicbrainz.org/ws/2/release/",
        params={
            "query": f'release:"{album}" AND artist:"{artist}"',
            "fmt": "json",
            "limit": 3,
        },
    )
    if not mb_resp.is_success:
        return None
    releases = mb_resp.json().get("releases", [])
    if not releases:
        return None

    for release in releases:
        mbid = release.get("id")
        if not mbid:
            continue
        art_resp = await client.head(
            f"https://coverartarchive.org/release/{mbid}/front",
            follow_redirects=True,
            timeout=4,
        )
        if art_resp.status_code == 200:
            return str(art_resp.url)

    # Fall back to release-group
    rg_id = releases[0].get("release-group", {}).get("id")
    if rg_id:
        art_resp = await client.head(
            f"https://coverartarchive.org/release-group/{rg_id}/front",
            follow_redirects=True,
            timeout=4,
        )
        if art_resp.status_code == 200:
            return str(art_resp.url)

    return None


@router.post("/backfill-genres")
async def backfill_genres(
    override: bool = False,
    session: Session = Depends(get_session),
):
    """Fill album genre from iTunes. override=true replaces existing values too."""
    albums = session.exec(select(Album)).all()
    targets = albums if override else [a for a in albums if not a.genre]
    updated = 0
    failed = 0
    rate_limited = 0

    itunes_headers = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"}
    async with httpx.AsyncClient(timeout=10, headers=itunes_headers) as client:
        for album in targets:
            try:
                await asyncio.sleep(0.8)
                resp = await client.get(
                    "https://itunes.apple.com/search",
                    params={"term": f"{album.artist} {album.album_name}", "entity": "album", "limit": 5},
                )
                if resp.status_code == 429:
                    rate_limited += 1
                    await asyncio.sleep(5)
                    continue
                if not resp.is_success:
                    failed += 1
                    continue
                results = resp.json().get("results", [])
                genre = None
                for r in results:
                    artist_match = album.artist.lower() in (r.get("artistName") or "").lower()
                    if artist_match:
                        genre = r.get("primaryGenreName")
                        if genre:
                            break
                if not genre and results:
                    genre = results[0].get("primaryGenreName")
                if genre:
                    album.genre = genre
                    session.add(album)
                    updated += 1
                else:
                    failed += 1
            except Exception:
                failed += 1

    session.commit()
    return {"updated": updated, "failed": failed, "rate_limited": rate_limited, "total": len(targets)}


async def _fetch_mb_genre(client: httpx.AsyncClient, album: str, artist: str) -> str | None:
    """Return the top genre tag from MusicBrainz release-group, or None."""
    mb_resp = await client.get(
        "https://musicbrainz.org/ws/2/release/",
        params={
            "query": f'release:"{album}" AND artist:"{artist}"',
            "fmt": "json",
            "limit": 3,
        },
    )
    if not mb_resp.is_success:
        return None
    releases = mb_resp.json().get("releases", [])
    if not releases:
        return None

    rg_id = releases[0].get("release-group", {}).get("id")
    if not rg_id:
        return None

    await asyncio.sleep(1.1)
    rg_resp = await client.get(
        f"https://musicbrainz.org/ws/2/release-group/{rg_id}",
        params={"inc": "tags+genres", "fmt": "json"},
    )
    if not rg_resp.is_success:
        return None

    data = rg_resp.json()
    genres = data.get("genres", [])
    if genres:
        return max(genres, key=lambda g: g.get("count", 0)).get("name")
    tags = data.get("tags", [])
    if tags:
        return max(tags, key=lambda t: t.get("count", 0)).get("name")
    return None


@router.post("/backfill-genres-mb")
async def backfill_genres_mb(
    override: bool = False,
    limit: int = 0,
    session: Session = Depends(get_session),
):
    """Fill album genre from MusicBrainz tags. override=true replaces existing. limit=N for testing."""
    albums = session.exec(select(Album)).all()
    targets = albums if override else [a for a in albums if not a.genre]
    if limit > 0:
        targets = list(targets)[:limit]

    updated = 0
    failed = 0
    results = []

    async with httpx.AsyncClient(timeout=10, headers=MB_HEADERS) as client:
        for album in targets:
            try:
                await asyncio.sleep(1.1)
                genre = await _fetch_mb_genre(client, album.album_name, album.artist)
                if genre:
                    album.genre = genre
                    session.add(album)
                    session.commit()
                    session.refresh(album)
                    updated += 1
                else:
                    failed += 1
                results.append({
                    "album": album.album_name,
                    "artist": album.artist,
                    "genre": genre,
                })
            except Exception as e:
                failed += 1
                results.append({
                    "album": album.album_name,
                    "artist": album.artist,
                    "genre": None,
                    "error": str(e),
                })
    return {
        "updated": updated,
        "failed": failed,
        "total": len(targets),
        "results": results,
    }


@router.post("/download-models")
def download_models():
    """Download Essentia Discogs genre models to backend/models/. Safe to call repeatedly."""
    from ..genre_classifier import download_models as _dl
    return _dl()


@router.post("/backfill-covers")
async def backfill_covers(session: Session = Depends(get_session)):
    """Fetch missing album art from MusicBrainz Cover Art Archive for all albums."""
    albums = session.exec(select(Album)).all()
    updated = 0
    skipped = 0
    failed = 0

    async with httpx.AsyncClient(timeout=10, headers=MB_HEADERS) as client:
        for album in albums:
            if album.album_art_url:
                skipped += 1
                continue
            try:
                await asyncio.sleep(0.35)  # respect MB rate limit
                url = await _fetch_cover_url(client, album.album_name, album.artist)
                if url:
                    album.album_art_url = url
                    session.add(album)
                    session.commit()
                    session.refresh(album)
                    updated += 1
                else:
                    failed += 1
            except Exception:
                failed += 1
    return {"updated": updated, "skipped": skipped, "failed": failed}


# ── Bulk audio analysis ───────────────────────────────────────────────────────

_analyze_job: dict = {"status": "idle"}
_analyze_lock = threading.Lock()


def _analyze_with_timeout(path: str, timeout_s: int = 90) -> dict:
    """Run _analyze_file in a thread; raise TimeoutError if it exceeds timeout_s."""
    from concurrent.futures import ThreadPoolExecutor, TimeoutError as FuturesTimeout
    from .audio import _analyze_file
    with ThreadPoolExecutor(max_workers=1) as ex:
        future = ex.submit(_analyze_file, path)
        try:
            return future.result(timeout=timeout_s)
        except FuturesTimeout:
            raise TimeoutError(f"_analyze_file timed out after {timeout_s}s on {path}")



def _norm_title(s: str) -> str:
    s = s.lower()
    s = re.sub(r'[^\w\s]', ' ', s)
    return re.sub(r'\s+', ' ', s).strip()


def _match_files_to_songs(songs: list, audio_files: list[str], use_track_prefix: bool) -> dict[int, str]:
    """Return {song_id: audio_file_path}.

    use_track_prefix=True  → yt-dlp files named {track_number:03d}_<title>.mp3
    use_track_prefix=False → spotdl files named {artist} - {title}.mp3; match by title similarity
    """
    matched: dict[int, str] = {}

    if use_track_prefix:
        file_by_track: dict[int, str] = {}
        for f in audio_files:
            m = re.match(r'^(\d+)_', os.path.basename(f))
            if m:
                file_by_track[int(m.group(1))] = f
        for song in songs:
            track = song.track_number or 0
            if track in file_by_track:
                matched[song.id] = file_by_track[track]
    else:
        # Extract the title portion from "Artist - Title.mp3" spotdl filenames
        file_titles: list[tuple[str, str]] = []
        for f in audio_files:
            base = os.path.splitext(os.path.basename(f))[0]
            parts = base.split(' - ', 1)
            title = parts[1] if len(parts) > 1 else base
            file_titles.append((f, _norm_title(title)))

        used: set[str] = set()
        for song in songs:
            norm_song = _norm_title(song.title)
            best_f, best_score = None, 0.0
            for f, norm_file_title in file_titles:
                if f in used:
                    continue
                score = SequenceMatcher(None, norm_song, norm_file_title).ratio()
                if score > best_score:
                    best_score, best_f = score, f
            if best_f and best_score >= 0.4:
                matched[song.id] = best_f
                used.add(best_f)

    return matched


def _bulk_analyze_worker(album_ids: list[int], override: bool):
    global _analyze_job
    from sqlmodel import Session as _Session

    with _analyze_lock:
        _analyze_job.update({"status": "running", "processed_albums": 0,
                              "processed_songs": 0, "failed_songs": 0, "current_album": None})

    for album_id in album_ids:
        if _analyze_job.get("abort"):
            break
        with _Session(engine) as session:
            album = session.get(Album, album_id)
            if not album:
                continue

            with _analyze_lock:
                _analyze_job["current_album"] = f"{album.artist} – {album.album_name}"

            songs = sorted(album.songs, key=lambda s: s.track_number or 0)

            if not override:
                analyzed_ids = {
                    row.song_id for row in session.exec(
                        select(SongAudioFeatures).where(
                            SongAudioFeatures.song_id.in_([s.id for s in songs])
                        )
                    ).all()
                }
                songs = [s for s in songs if s.id not in analyzed_ids]

            if not songs:
                with _analyze_lock:
                    _analyze_job["processed_albums"] += 1
                continue

            with tempfile.TemporaryDirectory() as tmpdir:
                def _dl(args):
                    i, song = args
                    threading.Event().wait(i * 2)  # stagger starts by 2s each
                    search = f"ytsearch1:{song.title} {album.artist} {album.album_name}"
                    out_tmpl = os.path.join(tmpdir, f"{song.track_number or 0:03d}_%(title)s.%(ext)s")
                    subprocess.run(
                        ["yt-dlp", "--default-search", "ytsearch", "--no-playlist",
                         "-x", "--audio-format", "mp3", "--audio-quality", "0",
                         "--sleep-requests", "1",
                         "-o", out_tmpl, search],
                        capture_output=True, text=True, timeout=90,
                    )

                from concurrent.futures import ThreadPoolExecutor as _TPE
                with _TPE(max_workers=2) as dl_pool:
                    list(dl_pool.map(_dl, enumerate(songs)))

                audio_files = sorted(glob.glob(os.path.join(tmpdir, "*.mp3")))

                file_map = _match_files_to_songs(songs, audio_files, use_track_prefix=True)

                for song in songs:
                    audio_path = file_map.get(song.id)
                    if not audio_path:
                        with _analyze_lock:
                            _analyze_job["failed_songs"] += 1
                        continue
                    try:
                        features = _analyze_with_timeout(audio_path, timeout_s=90)
                        song.bpm = features["bpm"]
                        song.musical_key = features["musical_key"]
                        song.loudness_db = features["loudness_db"]
                        session.add(song)

                        af = session.exec(
                            select(SongAudioFeatures).where(SongAudioFeatures.song_id == song.id)
                        ).first()
                        if af is None:
                            af = SongAudioFeatures(song_id=song.id)
                        af.title = song.title
                        for col in ("bpm", "bpm_confidence", "key", "scale", "key_strength",
                                    "chords_changes_rate", "loudness_db", "dynamic_complexity",
                                    "danceability", "energy", "dissonance", "spectral_centroid",
                                    "inharmonicity", "onset_rate", "loudness_lufs", "mfcc"):
                            setattr(af, col, features.get(col))
                        session.add(af)
                        session.commit()

                        with _analyze_lock:
                            _analyze_job["processed_songs"] += 1
                    except Exception:
                        with _analyze_lock:
                            _analyze_job["failed_songs"] += 1

            with _analyze_lock:
                _analyze_job["processed_albums"] += 1

        threading.Event().wait(10)  # 10s between albums

    with _analyze_lock:
        _analyze_job["status"] = "done" if not _analyze_job.get("abort") else "aborted"
        _analyze_job["current_album"] = None


@router.post("/analyze-all")
def start_analyze_all(
    override: bool = False,
    status_filter: str = "rated",
    background_tasks: BackgroundTasks = None,
    session: Session = Depends(get_session),
):
    """Bulk audio analysis for all albums matching status_filter. Runs in background."""
    with _analyze_lock:
        if _analyze_job.get("status") == "running":
            return {"status": "already_running", "job": _analyze_job}

    albums = session.exec(select(Album).where(Album.status == status_filter)).all()
    album_ids = [a.id for a in albums]

    with _analyze_lock:
        _analyze_job.update({
            "status": "starting",
            "total_albums": len(album_ids),
            "total_songs": sum(len(a.songs) for a in albums),
            "processed_albums": 0,
            "processed_songs": 0,
            "failed_songs": 0,
            "current_album": None,
            "abort": False,
        })

    thread = threading.Thread(target=_bulk_analyze_worker, args=(album_ids, override), daemon=True)
    thread.start()
    return {"status": "started", "queued_albums": len(album_ids)}


@router.get("/analyze-all/status")
def analyze_all_status():
    """Poll progress of a running bulk audio analysis job."""
    return _analyze_job


@router.post("/analyze-all/abort")
def abort_analyze_all():
    """Signal the running bulk analysis to stop after the current album."""
    with _analyze_lock:
        if _analyze_job.get("status") == "running":
            _analyze_job["abort"] = True
            return {"status": "aborting"}
    return {"status": "not_running"}


@router.post("/analyze-song")
def analyze_song_url(
    song_id: int,
    youtube_url: str,
    session: Session = Depends(get_session),
):
    """Download a specific YouTube URL, analyze it, and save features for song_id."""
    from .audio import _analyze_file

    song = session.get(Song, song_id)
    if not song:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="Song not found")

    with tempfile.TemporaryDirectory() as tmpdir:
        out_tmpl = os.path.join(tmpdir, "track.%(ext)s")
        result = subprocess.run(
            ["yt-dlp", "--no-playlist", "-x", "--audio-format", "mp3",
             "--audio-quality", "0", "-o", out_tmpl, youtube_url],
            capture_output=True, text=True, timeout=120,
        )
        import glob as _glob
        files = _glob.glob(os.path.join(tmpdir, "*.mp3"))
        if not files:
            return {"ok": False, "error": "yt-dlp produced no audio file", "stderr": result.stderr[-500:]}

        features = _analyze_file(files[0])
        song.bpm = features["bpm"]
        song.musical_key = features["musical_key"]
        song.loudness_db = features["loudness_db"]
        session.add(song)

        af = session.exec(select(SongAudioFeatures).where(SongAudioFeatures.song_id == song.id)).first()
        if af is None:
            af = SongAudioFeatures(song_id=song.id)
        af.title = song.title
        for col in ("bpm", "bpm_confidence", "key", "scale", "key_strength",
                    "chords_changes_rate", "loudness_db", "dynamic_complexity",
                    "danceability", "energy", "dissonance", "spectral_centroid",
                    "inharmonicity", "onset_rate", "loudness_lufs", "mfcc"):
            setattr(af, col, features.get(col))
        session.add(af)
        session.commit()

    return {"ok": True, "song_id": song_id, "title": song.title, "bpm": features["bpm"], "key": features["musical_key"]}


@router.post("/predict-themes")
def predict_themes(
    status: str = "to_listen",
    album_id: int | None = None,
    build_only: bool = False,
    force: bool = False,
    background_tasks: BackgroundTasks = None,
):
    """Run the RAG theme predictor pipeline in the background."""
    import sys, pathlib
    sys.path.insert(0, str(pathlib.Path(__file__).parent.parent.parent))
    from theme_predictor.run import run_pipeline

    def _run():
        run_pipeline(target_status=status, album_id=album_id,
                     build_only=build_only, force_rebuild=force)

    if background_tasks:
        background_tasks.add_task(_run)
        return {"status": "started", "target_status": status}
    else:
        _run()
        return {"status": "done"}


@router.get("/album-color")
async def album_color(album: str, artist: str, session: Session = Depends(get_session)):
    """Return dominant color from stored album art URL, falling back to MusicBrainz lookup."""
    try:
        db_album = session.exec(
            select(Album).where(Album.album_name == album).where(Album.artist == artist)
        ).first()
        cover_url = db_album.album_art_url if db_album else None

        async with httpx.AsyncClient(timeout=8, headers=MB_HEADERS) as client:
            if not cover_url:
                cover_url = await _fetch_cover_url(client, album, artist)
            if not cover_url:
                return {"color": None}
            art_resp = await client.get(cover_url, follow_redirects=True)
            if art_resp.status_code == 200:
                color, color2 = _extract_two_colors(art_resp.content)
                return {"color": color, "color2": color2}
        return {"color": None, "color2": None}
    except Exception:
        return {"color": None, "color2": None}
