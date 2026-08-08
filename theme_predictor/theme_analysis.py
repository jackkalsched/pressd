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
# never remove one without re-analysing every album and refitting every model.
#
# Four axes asking one question from different angles — does this record hold
# together as a structured work — plus lyrical_depth, which asks whether there
# is anything worth holding together.
#
# Measured over 47 of user 1's rated albums (scratch: axis_probe.json), by
# leave-one-out MAE against his own theme ratings:
#
#     predict-the-mean                      2.207
#     the four cohesion axes                2.107
#     + lyrical_depth                       1.965
#     greedy pick over all ten              1.874
#     all ten                               2.030
#
# The greedy pick (lyrical_depth, sequencing_intent, ambition_scale) still fits
# him best, but it drifts toward writing quality and reach — things that predict
# an album *score* rather than isolate a theme. This set keeps the factor
# meaning what it says and gives up ~0.09 MAE against one user for it. The
# greedy number is also optimistic: it was chosen and scored on the same 47
# points.
THEME_AXES = (
    "narrative_arc",        # tracklist moves through a story or progression
    "concept_unity",        # one unifying idea genuinely carried across tracks
    "emotional_throughline",# coherent emotional register or journey
    "sequencing_intent",    # ordering, interludes, bookends as craft
    "lyrical_depth",        # substance of the writing being carried
)

_AXIS_DOC = {
    "narrative_arc": "Does the tracklist move through a story, or a before/after? 10 = a genuine narrative with a beginning and an end. 1 = an unordered collection.",
    "concept_unity": "Is there one idea the record actually carries across its length? 10 = every track serves it. 1 = no unifying idea at all.",
    "emotional_throughline": "A coherent emotional register or journey. 10 = a sustained, deliberate mood arc. 1 = emotionally scattered.",
    "sequencing_intent": "Evidence of deliberate ordering — interludes, bookends, transitions, escalation. 10 = clearly composed as a sequence. 1 = a playlist order.",
    "lyrical_depth": "Specificity and substance of the writing itself. 10 = precise, particular, revealing. 1 = generic filler or interchangeable clichés. Judge the writing, not how well it serves the concept — a tightly themed record can still be written thinly.",
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
        "high on concept_unity. A brilliant album can score low on narrative_arc.",
        "Use the full range: 5 is genuinely average for that axis, and both extremes",
        "should be reachable for the right record.",
        "Rate each axis on its own — a record can have a single clear idea with no",
        "story progression, or a flawless running order written in clichés.",
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
        "Think briefly, then end with exactly these three lines and nothing after them.",
        "Substitute a value for each placeholder — do not reproduce the brackets:",
        "AXES: {" + ", ".join(f'"{a}": <number>' for a in THEME_AXES) + "}",
        "OVERALL: <a single number 1-10, your overall read of thematic coherence>",
        "REASONING: <one sentence>",
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

    # Tolerate the model echoing the placeholder's punctuation around the value
    # ("OVERALL: [3, a collection of...]", "**OVERALL:** 3"). Asking for a bare
    # number is the real fix; this is here so a formatting habit can never
    # silently null out the column again.
    overall = None
    m = re.search(r"OVERALL\**:?\**\s*[\[\(<]?\s*([0-9]+(?:\.[0-9]+)?)", response, re.I)
    if m:
        overall = round(max(1.0, min(10.0, float(m.group(1)))), 1)

    m = re.search(r"REASONING\**:?\**\s*[\[\(<]?\s*(.+)", response, re.I | re.DOTALL)
    reasoning = m.group(1).strip().rstrip("])>").strip()[:500] if m else None
    return axes, overall, reasoning


def analyze_theme(corpus: dict) -> tuple[dict | None, float | None, str | None]:
    """One call. Returns (axes, overall, reasoning).

    Raises on API failure rather than returning it as a string. The previous
    version swallowed every exception into the reasoning field, which the
    caller discards when there are no axes — so an exhausted API budget looked
    exactly like an album the model had nothing to say about, and a run could
    burn through hundreds of albums reporting zero failures. Callers decide
    what a failure means; this function's job is to be honest about it.
    """
    client = anthropic.Anthropic(api_key=os.environ.get("ANTHROPIC_API_KEY"))
    resp = client.messages.create(
        model=LLM_MODEL,
        max_tokens=900,
        temperature=0.0,   # a measurement should be reproducible
        system=_SYSTEM,
        messages=[{"role": "user", "content": build_analysis_prompt(corpus)}],
    )
    return parse_analysis(resp.content[0].text)
