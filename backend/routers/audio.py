import json
import os
import tempfile
import subprocess
import glob

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select

from ..database import get_session
from ..models import Album, SongAudioFeatures

router = APIRouter(prefix="/albums", tags=["audio"])


def _analyze_file(path: str) -> dict:
    import essentia.standard as es
    import numpy as np

    audio = es.MonoLoader(filename=path)()

    # Rhythm
    bpm, _, bpm_confidence, _, _ = es.RhythmExtractor2013(method="multifeature")(audio)

    # Tonal
    key, scale, key_strength = es.KeyExtractor()(audio)
    tonal = es.TonalExtractor()(audio)
    chords_changes_rate = float(tonal[0])  # first output is chords_changes_rate

    # Loudness / dynamics
    dynamic_complexity, loudness_db = es.DynamicComplexity()(audio)

    # Danceability
    danceability, _ = es.Danceability()(audio)

    # Energy
    energy = float(es.Energy()(audio))

    # Frame-level spectral analysis (shared loop for efficiency)
    audio_eq = es.EqualLoudness()(audio)
    w = es.Windowing(type="blackmanharris62")
    spec = es.Spectrum()
    peaks_algo = es.SpectralPeaks()
    dissonance_algo = es.Dissonance()
    centroid_algo = es.SpectralCentroidTime()
    inharmonicity_algo = es.Inharmonicity()
    harmonic_peaks_algo = es.HarmonicPeaks()
    mfcc_algo = es.MFCC(numberCoefficients=13)

    dissonance_vals, centroid_vals, inharmonicity_vals, mfcc_vals = [], [], [], []
    for frame in es.FrameGenerator(audio_eq, frameSize=2048, hopSize=1024):
        s = spec(w(frame))
        freqs, mags = peaks_algo(s)
        if len(freqs) >= 2:
            dissonance_vals.append(float(dissonance_algo(freqs, mags)))
            try:
                h_freqs, h_mags = harmonic_peaks_algo(freqs, mags)
                if len(h_freqs) > 0 and h_freqs[0] > 0:
                    inharmonicity_vals.append(float(inharmonicity_algo(h_freqs, h_mags)))
            except Exception:
                pass
        centroid_vals.append(float(centroid_algo(s)))
        _, mfcc_coeffs = mfcc_algo(s)
        mfcc_vals.append(mfcc_coeffs)

    dissonance = float(np.mean(dissonance_vals)) if dissonance_vals else None
    spectral_centroid = float(np.mean(centroid_vals)) if centroid_vals else None
    inharmonicity = float(np.mean(inharmonicity_vals)) if inharmonicity_vals else None
    mfcc_mean = [round(float(v), 4) for v in np.mean(mfcc_vals, axis=0)] if mfcc_vals else None

    # Onset rate
    onset_rate = float(es.OnsetRate()(audio)[1])

    # EBU R128 integrated loudness (LUFS)
    loudness_lufs = None
    try:
        ebur = es.LoudnessEBUR128(sampleRate=44100)
        audio_stereo = np.vstack([audio, audio]).T  # mono → stereo
        _, _, loudness_lufs_val, _ = ebur(audio_stereo)
        loudness_lufs = round(float(loudness_lufs_val), 2)
    except Exception:
        pass

    return {
        "bpm": round(float(bpm), 1),
        "bpm_confidence": round(float(bpm_confidence), 4),
        "musical_key": f"{key} {scale}",
        "key": key,
        "scale": scale,
        "key_strength": round(float(key_strength), 4),
        "chords_changes_rate": round(chords_changes_rate, 4),
        "loudness_db": round(float(loudness_db), 2),
        "dynamic_complexity": round(float(dynamic_complexity), 4),
        "danceability": round(float(danceability), 4),
        "energy": round(energy, 4),
        "dissonance": round(dissonance, 4) if dissonance is not None else None,
        "spectral_centroid": round(spectral_centroid, 4) if spectral_centroid is not None else None,
        "inharmonicity": round(inharmonicity, 4) if inharmonicity is not None else None,
        "onset_rate": round(onset_rate, 4),
        "loudness_lufs": loudness_lufs,
        "mfcc": json.dumps(mfcc_mean) if mfcc_mean is not None else None,
    }


@router.post("/{album_id}/analyze-audio")
def analyze_audio(album_id: int, session: Session = Depends(get_session)):
    album = session.get(Album, album_id)
    if not album:
        raise HTTPException(status_code=404, detail="Album not found")
    with tempfile.TemporaryDirectory() as tmpdir:
        songs = sorted(album.songs, key=lambda s: s.track_number or 0)

        for song in songs:
            search = f"ytsearch1:{song.title} {album.artist} {album.album_name}"
            out_tmpl = os.path.join(tmpdir, f"{song.track_number or 0:03d}_%(title)s.%(ext)s")
            subprocess.run(
                ["yt-dlp", "--default-search", "ytsearch", "--no-playlist",
                 "-x", "--audio-format", "mp3", "--audio-quality", "0",
                 "-o", out_tmpl, search],
                capture_output=True, text=True, timeout=60,
            )

        audio_files = sorted(glob.glob(os.path.join(tmpdir, "*.mp3")))
        if not audio_files:
            raise HTTPException(status_code=502, detail="No audio files downloaded")

        # Match by {track_number:03d}_ prefix in filename
        import re as _re
        file_by_track: dict[int, str] = {}
        for f in audio_files:
            m = _re.match(r'^(\d+)_', os.path.basename(f))
            if m:
                file_by_track[int(m.group(1))] = f

        updated = []
        for song in songs:
            audio_path = file_by_track.get(song.track_number or 0)
            if not audio_path:
                updated.append({"id": song.id, "error": "no audio downloaded"})
                continue
            try:
                features = _analyze_file(audio_path)
                song.bpm = features["bpm"]
                song.musical_key = features["musical_key"]
                song.loudness_db = features["loudness_db"]
                session.add(song)

                # Upsert into SongAudioFeatures
                from sqlmodel import select as sel
                af = session.exec(sel(SongAudioFeatures).where(SongAudioFeatures.song_id == song.id)).first()
                if af is None:
                    af = SongAudioFeatures(song_id=song.id)
                af.title = song.title
                for col in ("bpm", "bpm_confidence", "key", "scale", "key_strength",
                            "chords_changes_rate", "loudness_db", "dynamic_complexity",
                            "danceability", "energy", "dissonance", "spectral_centroid",
                            "inharmonicity", "onset_rate", "loudness_lufs", "mfcc"):
                    setattr(af, col, features.get(col))
                session.add(af)

                updated.append({"id": song.id, "path": audio_path, **features})
            except Exception as e:
                updated.append({"id": song.id, "error": str(e)})

        # Genre classification — runs on the same downloaded files
        try:
            from ..genre_classifier import load_models, classify_file, aggregate_predictions
            emb_model, genre_model, labels = load_models()
            per_song_preds = []
            for entry in updated:
                path = entry.get("path")
                if path and "error" not in entry:
                    try:
                        preds = classify_file(path, emb_model, genre_model, labels)
                        entry["genre_tags"] = [{"label": l, "confidence": round(c, 4)} for l, c in preds]
                        per_song_preds.append(preds)
                    except Exception as e:
                        entry["genre_error"] = str(e)

            if per_song_preds:
                agg = aggregate_predictions(per_song_preds)
                # Only fill fields that are currently null
                if album.genre is None and agg["genre"]:
                    album.genre = agg["genre"]
                if album.sub_genre1 is None and agg["sub_genre1"]:
                    album.sub_genre1 = agg["sub_genre1"]
                if album.sub_genre2 is None and agg["sub_genre2"]:
                    album.sub_genre2 = agg["sub_genre2"]
                session.add(album)
        except Exception as e:
            for entry in updated:
                entry.setdefault("genre_error", str(e))

        # Strip internal path key before returning
        for entry in updated:
            entry.pop("path", None)

        session.commit()

    return {"analyzed": len(updated), "tracks": updated}
