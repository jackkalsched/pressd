"""
Claude-based distinctness score predictor.

One scalar per album on a shared reference scale, called once globally by
theme_predictor.global_factors. The v1 standalone runner that lived here read
SQLite directly and retrieved its RAG examples from ChromaDB; both are gone —
examples now come from global_factors._anchor_examples, which spans the score
range instead of the top five.
"""

import os
import re

import anthropic

LLM_MODEL  = os.environ.get("THEME_LLM_MODEL", "claude-haiku-4-5-20251001")

# The baseline the prompt anchors on. Kept as the default for `baseline` even
# though global_factors always passes GLOBAL_REF_MU explicitly.
DIST_MEAN  = 5.60


def build_distinctness_prompt(target_corpus: dict, examples: list[dict],
                               corpora_map: dict[int, dict],
                               subject: str = "Jack", baseline: float = DIST_MEAN) -> str:
    """Distinctness prompt. `subject`/`baseline` default to the original
    single-user framing; the global pass overrides them (see build_prompt)."""
    poss = f"{subject}'s"
    lines = [
        f'You are predicting a personal music score for {subject}.\n',
        f'{subject} rates albums on "Distinctness" (1–10).',
        'Distinctness measures how ORIGINAL and SONICALLY UNIQUE an album sounds',
        'relative to its genre and era. It is NOT about quality — a bad album can be distinct.',
        '',
        f'The average distinctness rating is {baseline:.1f}. Use this as your baseline.',
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
        f'Here are albums {subject} has already rated with their Distinctness scores:\n',
    ]

    for i, ex in enumerate(examples, 1):
        aid = ex["album_id"]
        ex_corpus = corpora_map.get(aid)
        analysis  = ex_corpus["llm_analysis"][:500] if ex_corpus else "(no analysis)"
        genre_str = f" [{ex_corpus.get('genre') or 'Unknown'}]" if ex_corpus else ""
        lines += [
            f"--- EXAMPLE {i} ---",
            f"Album: {ex['artist']} – {ex['album_name']}{genre_str}",
            f"{poss} Distinctness Score: {ex['theme_score']:.1f}/10",
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
        f"Remember: {baseline:.1f} is average. Most albums score 4–7. Derivative albums score 2–4.",
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
                          corpora_map: dict[int, dict],
                          subject: str = "Jack", baseline: float = DIST_MEAN) -> tuple[float | None, str | None]:
    """Raises on API failure — see theme_analysis.analyze_theme for why the
    previous string-swallowing behaviour hid an exhausted budget as silence."""
    prompt = build_distinctness_prompt(target_corpus, examples, corpora_map, subject, baseline)
    client = anthropic.Anthropic(api_key=os.environ.get("ANTHROPIC_API_KEY"))
    response = client.messages.create(
        model=LLM_MODEL,
        max_tokens=600,
        temperature=0.2,
        system="You are a music scoring assistant. After your analysis, you MUST end your response with exactly these two lines:\nSCORE: [a number 1-10, one decimal allowed]\nREASONING: [1-2 sentences]",
        messages=[{"role": "user", "content": prompt}],
    )
    return parse_response(response.content[0].text)
