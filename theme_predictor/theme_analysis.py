"""
The album-intrinsic thematic analysis: one LLM call per album, for everyone.

This replaces asking the model "what would Jack score this?" with "what is
actually true about this record?" — a set of measurable semantic axes that
different listeners weight differently. The weighting is then *learned* from
each user's own theme ratings (theme_predictor.personalize), rather than
written into the prompt as one person's penalty table.

Why the axes and not a score: a single 1–10 theme number is a projection of
several independent things — a tight concept album with thin writing and a
sprawling record with extraordinary writing can land on the same number for
opposite reasons, and two users who disagree about which they prefer cannot
both be served by it. Keeping the axes separate lets each user's model
discover its own trade-off.
"""
import os
import json
import re

import anthropic

LLM_MODEL = os.environ.get("THEME_LLM_MODEL", "claude-haiku-4-5-20251001")

# Ordered — this tuple is the feature vector's column order, and personalize
# relies on it being stable. Append new axes at the end; never reorder, and
# never remove one without refitting every stored model.
THEME_AXES = (
    "narrative_arc",        # tracklist moves through a story or progression
    "concept_unity",        # one unifying idea genuinely carried across tracks
    "lyrical_depth",        # specificity and substance of the writing
    "emotional_throughline",# coherent emotional register or journey
    "sonic_cohesion",       # production palette as deliberate world-building
    "sequencing_intent",    # ordering, interludes, bookends as craft
    "subject_breadth",      # range of subject matter vs repetition
    "social_engagement",    # reaches past the personal into ideas or politics
    "autobiography",        # confessional/personal specificity
    "ambition_scale",       # sheer reach of what the record attempts
)

_AXIS_DOC = {
    "narrative_arc": "Does the tracklist move through a story, or a before/after? 10 = a genuine narrative with a beginning and an end. 1 = an unordered collection.",
    "concept_unity": "Is there one idea the record actually carries across its length? 10 = every track serves it. 1 = no unifying idea at all.",
    "lyrical_depth": "Specificity and substance of the writing. 10 = precise, particular, revealing. 1 = generic filler or interchangeable clichés.",
    "emotional_throughline": "A coherent emotional register or journey. 10 = a sustained, deliberate mood arc. 1 = emotionally scattered.",
    "sonic_cohesion": "Production and palette used as world-building. 10 = an unmistakable, consistent sonic world. 1 = tracks that could be from different records.",
    "sequencing_intent": "Evidence of deliberate ordering — interludes, bookends, transitions, escalation. 10 = clearly composed as a sequence. 1 = a playlist order.",
    "subject_breadth": "Range of subject matter. 10 = many distinct subjects handled well. 1 = the same one or two topics repeated throughout.",
    "social_engagement": "Reach beyond the personal into social, political, or cultural ideas. 10 = substantially engaged. 1 = entirely inward or absent.",
    "autobiography": "Confessional or personal specificity about the artist's own life. 10 = deeply autobiographical. 1 = no personal disclosure.",
    "ambition_scale": "How much the record is reaching for, independent of whether it succeeds. 10 = a huge swing. 1 = a modest, contained project.",
}

_SYSTEM = (
    "You are a music analyst producing structured, factual descriptions of albums. "
    "You are NOT scoring quality and NOT predicting anyone's taste — you are measuring "
    "properties of the record that different listeners would weight differently. "
    "Two analysts reading the same album should produce nearly the same numbers. "
    "End your response with the AXES block and OVERALL line exactly as instructed."
)


def build_analysis_prompt(corpus: dict) -> str:
    lines = [
        "Describe this album along ten independent thematic axes, each 1-10.",
        "",
        "These are measurements, not judgements of quality. A derivative album can score",
        "high on concept_unity. An excellent album can score low on social_engagement.",
        "Rate each axis on its own — do not let one pull the others along.",
        "Use the full range: 5 is genuinely average for that axis, and both extremes",
        "should be reachable for the right record.",
        "",
        "AXES:",
    ]
    for axis in THEME_AXES:
        lines.append(f"  {axis}: {_AXIS_DOC[axis]}")

    analysis = (corpus.get("llm_analysis") or "")[:1400]
    lines += [
        "",
        "--- ALBUM ---",
        f"Album: {corpus.get('artist', '')} – {corpus.get('album_name', '')}",
        f"Genre: {corpus.get('genre') or 'Unknown'}",
        f"Analysis: {analysis}",
        "",
        "Think briefly, then end with exactly these lines and nothing after them:",
        "AXES: {" + ", ".join(f'"{a}": <1-10>' for a in THEME_AXES) + "}",
        "OVERALL: [1-10, your single overall read of the album's thematic coherence]",
        "REASONING: [one sentence]",
    ]
    return "\n".join(lines)


def parse_analysis(response: str) -> tuple[dict | None, float | None, str | None]:
    """(axes, overall, reasoning). Any part may be None if the model drifted."""
    axes = None
    m = re.search(r"AXES:\s*(\{.*?\})", response, re.DOTALL)
    if m:
        try:
            raw = json.loads(m.group(1))
            axes = {}
            for a in THEME_AXES:
                v = raw.get(a)
                if v is None:
                    continue
                axes[a] = round(max(1.0, min(10.0, float(v))), 1)
            # A partial block is worse than none: personalize would have to
            # impute the gaps, and an imputed axis is indistinguishable from a
            # measured one downstream.
            if len(axes) < len(THEME_AXES):
                axes = None
        except (ValueError, TypeError):
            axes = None

    overall = None
    m = re.search(r"OVERALL:\s*([0-9]+(?:\.[0-9]+)?)", response)
    if m:
        overall = round(max(1.0, min(10.0, float(m.group(1)))), 1)

    m = re.search(r"REASONING:\s*(.+)", response, re.DOTALL)
    reasoning = m.group(1).strip()[:500] if m else None
    return axes, overall, reasoning


def analyze_theme(corpus: dict) -> tuple[dict | None, float | None, str | None]:
    """One call. Returns (axes, overall, reasoning); (None, None, msg) on failure."""
    try:
        client = anthropic.Anthropic(api_key=os.environ.get("ANTHROPIC_API_KEY"))
        resp = client.messages.create(
            model=LLM_MODEL,
            max_tokens=900,
            temperature=0.0,   # a measurement should be reproducible
            system=_SYSTEM,
            messages=[{"role": "user", "content": build_analysis_prompt(corpus)}],
        )
        return parse_analysis(resp.content[0].text)
    except Exception as e:
        return None, None, f"[analysis failed: {e}]"
