"""
Claude-based distinctness score predictor.
Reuses the same corpus files and ChromaDB as the theme predictor.
"""

import math
import os
import re
import sqlite3
import time
from pathlib import Path

import anthropic

DB_PATH    = Path(__file__).parent.parent / "pressd.db"
LLM_MODEL  = os.environ.get("THEME_LLM_MODEL", "claude-haiku-4-5-20251001")

# Jack's actual distinctness stats for normalization
DIST_MEAN  = 5.60
DIST_STD   = 1.70


def build_distinctness_prompt(target_corpus: dict, examples: list[dict],
                               corpora_map: dict[int, dict]) -> str:
    lines = [
        'You are predicting a personal music score for Jack.\n',
        'Jack rates albums on "Distinctness" (1–10).',
        'Distinctness measures how ORIGINAL and SONICALLY UNIQUE an album sounds',
        'relative to its genre and era. It is NOT about quality — a bad album can be distinct.',
        '',
        'His average distinctness rating is 5.6. Use this as your baseline.',
        'Most albums score 4–7. Scores of 9–10 are genuinely rare.',
        '',
        'Scoring rubric:',
        '  9–10 = Genre-defining or genre-defying. Sounds like nothing else.',
        '         Examples: The Beatles pioneering new sounds, Kendrick fusing jazz/hip-hop,',
        '         Radiohead reinventing rock. Do NOT assign unless truly unprecedented.',
        '  7–8  = Clearly distinctive voice or sound. Immediately identifiable as this artist.',
        '         Takes risks, blends genres, or subverts expectations in a meaningful way.',
        '  5–6  = Competent and has some personality, but fits comfortably within genre norms.',
        '         This is the default for well-executed albums that do not break new ground.',
        '  3–4  = Derivative. Follows a well-worn template. Could be by many different artists.',
        '  1–2  = Completely indistinguishable from dozens of similar albums.',
        '',
        'STRICT PENALTIES — deduct points for:',
        '  • Following a genre formula note-for-note with no subversion → -2',
        '  • Sounds like a direct imitation of a more famous artist → -2',
        '  • Album could be by any artist in this genre → -1',
        '  • Re-using the exact same sonic palette as a prior album → -1',
        '',
        'BONUSES — add points for:',
        '  • Blending 2+ genres in an unexpected or innovative way → +2',
        '  • Introducing a new sound or production technique to mainstream → +2',
        '  • Instantly recognizable as THIS artist and no other → +1',
        '  • Critical praise specifically for originality or innovation → +1',
        '',
        'GENRE CONTEXT:',
        '  Hip-Hop: trap/drill/mumble rap following formulas scores 3–4.',
        '           Concept rap, genre fusion, unique sonic identity scores 7+.',
        '  Pop: generic radio pop scores 2–4. Art pop, auteur pop scores 7+.',
        '  Rock: derivative indie rock scores 3–5. Avant-garde or pioneering scores 7+.',
        '  R&B: smooth R&B clones score 3–4. Genre-bending R&B scores 6+.',
        '',
        'Here are albums Jack has already rated with their Distinctness scores:\n',
    ]

    for i, ex in enumerate(examples, 1):
        aid = ex["album_id"]
        ex_corpus = corpora_map.get(aid)
        analysis  = ex_corpus["llm_analysis"][:500] if ex_corpus else "(no analysis)"
        genre_str = f" [{ex_corpus.get('genre') or 'Unknown'}]" if ex_corpus else ""
        lines += [
            f"--- EXAMPLE {i} ---",
            f"Album: {ex['artist']} – {ex['album_name']}{genre_str}",
            f"Jack's Distinctness Score: {ex['theme_score']:.1f}/10",
            f"Analysis: {analysis}",
            "",
        ]

    target_analysis = target_corpus.get("llm_analysis", "")[:800]
    target_genre    = target_corpus.get("genre") or "Unknown"
    lines += [
        "--- TARGET ALBUM ---",
        f"Album: {target_corpus['artist']} – {target_corpus['album_name']} [{target_genre}]",
        f"Analysis: {target_analysis}",
        "",
        "Apply bonuses and penalties explicitly before settling on a score.",
        "Remember: 5.6 is average. Most albums score 4–7. Derivative albums score 2–4.",
        "Think step by step, then respond with exactly:",
        "SCORE: [number 1-10, one decimal allowed]",
        "REASONING: [1-2 sentences explaining the score and any bonuses/penalties applied]",
    ]
    return "\n".join(lines)


def parse_response(response: str) -> tuple[float | None, str | None]:
    score_m  = re.search(r'SCORE:\s*([0-9]+(?:\.[0-9]+)?)', response)
    reason_m = re.search(r'REASONING:\s*(.+)', response, re.DOTALL)
    score  = float(score_m.group(1)) if score_m else None
    reason = reason_m.group(1).strip()[:400] if reason_m else None
    if score is not None:
        score = round(max(1.0, min(10.0, score)), 1)
    return score, reason


def predict_distinctness(target_corpus: dict, examples: list[dict],
                          corpora_map: dict[int, dict]) -> tuple[float | None, str | None]:
    prompt = build_distinctness_prompt(target_corpus, examples, corpora_map)
    try:
        client = anthropic.Anthropic(api_key=os.environ.get("ANTHROPIC_API_KEY"))
        response = client.messages.create(
            model=LLM_MODEL,
            max_tokens=600,
            temperature=0.2,
            system="You are a music scoring assistant. After your analysis, you MUST end your response with exactly these two lines:\nSCORE: [a number 1-10, one decimal allowed]\nREASONING: [1-2 sentences]",
            messages=[{"role": "user", "content": prompt}],
        )
        return parse_response(response.content[0].text)
    except Exception as e:
        return None, f"[failed: {e}]"


def normalize_to_jack(raw_scores: list[tuple[int, float]]) -> list[tuple[int, float]]:
    """Z-score normalize raw LLM predictions to match Jack's distribution."""
    vals   = [s for _, s in raw_scores]
    mean   = sum(vals) / len(vals)
    std    = math.sqrt(sum((x - mean)**2 for x in vals) / len(vals)) or 1.0
    result = []
    for album_id, score in raw_scores:
        z         = (score - mean) / std
        new_score = round(max(1.0, min(10.0, z * DIST_STD + DIST_MEAN)), 0)
        result.append((album_id, new_score))
    return result


def run(status: str = "to_listen"):
    from .corpus import load_or_build_corpus, build_document
    from .embedder import get_collection, top_similar_albums

    con = sqlite3.connect(DB_PATH)

    rated = con.execute("""
        SELECT id, artist, album_name, year, genre, distinctness
        FROM album WHERE status='rated' AND distinctness IS NOT NULL
    """).fetchall()

    targets = con.execute(f"""
        SELECT id, artist, album_name, year, genre
        FROM album WHERE status='{status}' AND predicted_distinctness IS NULL
    """).fetchall()

    print(f"Building corpora map for {len(rated)} rated albums...")
    corpora_map: dict[int, dict] = {}
    for album_id, artist, album_name, year, genre, dist in rated:
        corpus = load_or_build_corpus(album_id, artist, album_name, year, None)
        corpus["genre"]       = genre
        corpus["theme_score"] = dist
        corpora_map[album_id] = corpus

    print("Loading ChromaDB...")
    collection = get_collection()

    print(f"Predicting distinctness for {len(targets)} albums...\n")
    raw_predictions: list[tuple[int, float]] = []

    for i, (album_id, artist, album_name, year, genre) in enumerate(targets, 1):
        corpus = load_or_build_corpus(album_id, artist, album_name, year, None)
        corpus["genre"] = genre
        doc      = build_document(corpus)
        examples = top_similar_albums(collection, doc, n_albums=3)

        example_dicts = []
        for ex in examples:
            aid = ex["album_id"]
            if aid in corpora_map:
                example_dicts.append({
                    "album_id":    aid,
                    "artist":      ex["artist"],
                    "album_name":  ex["album_name"],
                    "theme_score": corpora_map[aid]["theme_score"],
                })

        score, reasoning = predict_distinctness(corpus, example_dicts, corpora_map)
        if score is not None:
            raw_predictions.append((album_id, score))
            print(f"  [{i}/{len(targets)}] {artist} – {album_name}: {score}/10")
            if reasoning:
                print(f"    {reasoning[:100]}…")
        else:
            print(f"  [{i}/{len(targets)}] {artist} – {album_name}: FAILED")

        time.sleep(0.1)

    print(f"\nNormalizing {len(raw_predictions)} predictions to Jack's distribution (mean={DIST_MEAN}, std={DIST_STD})...")
    normalized = normalize_to_jack(raw_predictions)

    for album_id, norm_score in normalized:
        con.execute("UPDATE album SET predicted_distinctness = ? WHERE id = ?",
                    (norm_score, album_id))
    con.commit()

    dist_rows = con.execute("""
        SELECT predicted_distinctness, COUNT(*) FROM album
        WHERE predicted_distinctness IS NOT NULL AND status=?
        GROUP BY predicted_distinctness ORDER BY predicted_distinctness DESC
    """, (status,)).fetchall()
    print(f"\nDone — {len(normalized)} predictions written\n")
    print("Distribution:")
    for score, count in dist_rows:
        print(f"  {int(score)}: {'█'*min(count,40)} ({count})")

    con.close()


if __name__ == "__main__":
    run()
