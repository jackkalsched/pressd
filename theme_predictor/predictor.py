"""
Build the RAG prompt and call Claude to predict a theme score.
"""

import os
import re

import anthropic


LLM_MODEL = os.environ.get("THEME_LLM_MODEL", "claude-haiku-4-5-20251001")


def build_prompt(target_corpus: dict, examples: list[dict], corpora_map: dict[int, dict]) -> str:
    lines = [
        'You are predicting a personal music score for Jack.\n',
        'Jack rates albums on "Theme" (1–10). His average rating is 5.0 — use this as your baseline.',
        'Most albums land between 3 and 6. Scores of 8+ are genuinely rare and reserved for exceptional work.',
        '',
        'Scoring rubric:',
        '  9–10 = A rare masterwork: every track serves a singular, deeply realized concept.',
        '         Reserved for albums like Dark Side of the Moon or To Pimp a Butterfly.',
        '         Do NOT assign this unless the concept is both ambitious and flawlessly executed.',
        '  7–8  = Intentional and coherent, but not transcendent. Clear theme with minor execution gaps.',
        '  5–6  = Average. A theme is nominally present but loosely applied, generic, or inconsistent.',
        '         This is the default for most competent pop/rap/rock albums.',
        '  3–4  = Weak. Topics are scattered or repetitive without purposeful arc.',
        '  1–2  = No discernible theme, concept, or narrative whatsoever.',
        '',
        'STRICT PENALTIES — automatically deduct points for:',
        '  • Repetitive subject matter: braggadocio, money, women, flexing with no deeper angle → -2',
        '  • Generic "love/heartbreak" without a specific narrative arc → -1',
        '  • Tracklists that feel like singles dumps with no sequencing intent → -2',
        '  • Stating a theme in the title/rollout but failing to execute it across tracks → -1',
        '  • Re-using the same concept as a prior album without meaningful evolution → -1',
        '',
        'GENRE-SPECIFIC EXPECTATIONS:',
        '  Hip-Hop/Rap:',
        '    • Braggadocio, street life, and flexing are the DEFAULT — they do NOT constitute a theme.',
        '      Learn to identify when these topics are used as surface-level tropes vs. deeper explorations of identity, culture, or social issues. Do NOT give the benefit of the doubt in terms of thematic cohesion.',
        '    • Reward: social commentary, personal vulnerability, concept albums, narrative arcs.',
        '    • Penalize: trap albums with interchangeable content, mixtape energy, no arc.',
        '  Pop:',
        '    • Generic love/breakup collections are the DEFAULT.',
        '    • Reward: era-defining self-portraits, clear emotional journeys, artistic identity.',
        '  Rock/Alternative:',
        '    • Expect stronger thematic intent from rock albums — penalize if it falls short.',
        '    • Reward: concept albums, political/social commentary, genre deconstruction.',
        '  R&B/Soul:',
        '    • Mood cohesion alone is NOT enough for a high score — needs narrative or concept.',
        '  Electronic/Experimental:',
        '    • Sonic world-building can substitute for lyrical concept — reward distinctive vision.',
        '  If GENRE IS UNKNOWN:'
        '    • Use context clues and internet knowledge and sentiment to help with your genre-specific analysis.'
        '',
        'IMPORTANT: When in doubt, score lower. Most albums do not have a strong concept.',
        'A score of 5 means the album is average — not bad. Default to 3–5 for mainstream pop/rap/trap.',
        '',
        'Here are albums Jack has already rated with their Theme scores:\n',
    ]

    for i, ex in enumerate(examples, 1):
        aid = ex["album_id"]
        ex_corpus = corpora_map.get(aid)
        analysis = ex_corpus["llm_analysis"][:600] if ex_corpus else "(no analysis)"
        lines += [
            f"--- EXAMPLE {i} ---",
            f"Album: {ex['artist']} – {ex['album_name']}",
            f"Jack's Theme Score: {ex['theme_score']:.1f}/10",
            f"Analysis: {analysis}",
            "",
        ]

    target_analysis = target_corpus.get("llm_analysis", "")[:800]
    lines += [
        "--- TARGET ALBUM ---",
        f"Album: {target_corpus['artist']} – {target_corpus['album_name']}",
        f"Analysis: {target_analysis}",
        "",
        "Apply the penalties above explicitly before settling on a score.",
        "Remember: the average is 5. Most mainstream albums score 4–6.",
        "Think step by step, then respond with exactly:",
        "SCORE: [number 1-10, one decimal allowed]",
        "REASONING: [1-2 sentences explaining the score and any penalties applied]",
    ]
    return "\n".join(lines)


def parse_response(response: str) -> tuple[float | None, str | None]:
    score_m  = re.search(r'SCORE:\s*([0-9]+(?:\.[0-9]+)?)', response)
    reason_m = re.search(r'REASONING:\s*(.+)', response, re.DOTALL)
    score  = float(score_m.group(1)) if score_m else None
    reason = reason_m.group(1).strip()[:500] if reason_m else None
    if score is not None:
        score = round(max(1.0, min(10.0, score)), 1)
    return score, reason


def predict_theme(target_corpus: dict, examples: list[dict],
                  corpora_map: dict[int, dict]) -> tuple[float | None, str | None]:
    prompt = build_prompt(target_corpus, examples, corpora_map)
    try:
        client = anthropic.Anthropic(api_key=os.environ.get("ANTHROPIC_API_KEY"))
        response = client.messages.create(
            model=LLM_MODEL,
            max_tokens=600,
            temperature=0.2,
            system="You are a music scoring assistant. After your analysis, you MUST end your response with exactly these two lines:\nSCORE: [a number 1-10, one decimal allowed]\nREASONING: [1-2 sentences]",
            messages=[{"role": "user", "content": prompt}],
        )
        text = response.content[0].text
        return parse_response(text)
    except Exception as e:
        return None, f"[prediction failed: {e}]"
