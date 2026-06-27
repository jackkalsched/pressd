"""
Corpus generation for each album.
Combines Ollama LLM analysis + Wikipedia + Last.fm + Genius (optional).
Results are cached as JSON in corpus/ so they're only generated once.
"""

import json
import os
import time
from pathlib import Path

import anthropic

CACHE_DIR = Path(__file__).parent.parent / "corpus"
CACHE_DIR.mkdir(exist_ok=True)

LLM_MODEL = os.environ.get("THEME_LLM_MODEL", "claude-haiku-4-5-20251001")
LASTFM_KEY = os.environ.get("LASTFM_API_KEY", "b8ffd9dd0b8ecab355b4dd4ed7b57987")
GENIUS_TOKEN = os.environ.get("GENIUS_ACCESS_TOKEN", "CtIqNw8ogjNwFn8QOGXvt2FotAlKUtgtacCZEofFjDNQdtnFLx4IxxPmi_FQdVTx")


def _safe_filename(artist: str, album: str) -> str:
    slug = f"{artist}_{album}".replace("/", "-").replace("\\", "-").replace(" ", "_")
    return "".join(c for c in slug if c.isalnum() or c in "-_")[:120]


def generate_llm_analysis(artist: str, album_name: str, year: int | None) -> str:
    year_str = f" ({year})" if year else ""
    prompt = (
        f'Analyze the album "{album_name}" by {artist}{year_str}.\n\n'
        "Focus specifically on:\n"
        "1. Thematic cohesion — does the album have a unified concept or narrative arc?\n"
        "2. Conceptual intentionality — is the theme deliberate and well-executed?\n"
        "3. Mood and tonal consistency across the record\n"
        "4. Recurring lyrical motifs, imagery, or ideas\n"
        "5. Do the songs tell a story and is it unique?\n\n"
        "Be specific. Do not summarize the tracklist. Keep the response under 300 words."
    )
    try:
        client = anthropic.Anthropic(api_key=os.environ.get("ANTHROPIC_API_KEY"))
        response = client.messages.create(
            model=LLM_MODEL,
            max_tokens=400,
            temperature=0.3,
            messages=[{"role": "user", "content": prompt}],
        )
        return response.content[0].text.strip()
    except Exception as e:
        return f"[LLM analysis failed: {e}]"


def fetch_wikipedia(artist: str, album_name: str) -> str | None:
    try:
        import wikipediaapi
        wiki = wikipediaapi.Wikipedia(language="en", user_agent="PressdApp/1.0")
        for query in [f"{album_name} ({artist} album)", f"{album_name} album", f"{album_name} {artist}"]:
            page = wiki.page(query)
            if page.exists() and len(page.summary) > 100:
                return page.summary[:2000]
    except Exception:
        pass
    return None


def fetch_lastfm(artist: str, album_name: str) -> dict:
    if not LASTFM_KEY:
        return {"summary": None, "tags": []}
    try:
        import pylast
        network = pylast.LastFMNetwork(api_key=LASTFM_KEY)
        album = network.get_album(artist, album_name)
        summary = album.get_wiki_summary() or None
        tags = [t.item.name for t in (album.get_top_tags(limit=10) or [])]
        return {"summary": summary[:1500] if summary else None, "tags": tags}
    except Exception:
        return {"summary": None, "tags": []}


def fetch_genius(artist: str, album_name: str) -> str | None:
    if not GENIUS_TOKEN:
        return None
    try:
        import requests, lyricsgenius
        # Step 1: find album ID via lyricsgenius search_albums (public endpoint)
        genius = lyricsgenius.Genius(access_token=GENIUS_TOKEN, timeout=8, per_page=5)
        results = genius.search_albums(f"{artist} {album_name}")
        hits = (results or {}).get("sections", [{}])[0].get("hits", [])
        album_id = hits[0]["result"]["id"] if hits else None
        if not album_id:
            return None
        # Step 2: fetch full album description via direct API call
        headers = {"Authorization": f"Bearer {GENIUS_TOKEN}"}
        resp = requests.get(
            f"https://api.genius.com/albums/{album_id}",
            params={"text_format": "plain"},
            headers=headers, timeout=8,
        )
        ann = resp.json().get("response", {}).get("album", {}).get("description_annotation", {})
        body = ann.get("annotations", [{}])[0].get("body", {}).get("plain", "")
        return body[:1000] if body and len(body) > 30 else None
    except Exception:
        pass
    return None


def build_corpus(album_id: int, artist: str, album_name: str,
                 year: int | None, theme_score: float | None) -> dict:
    print(f"  Generating corpus: {artist} – {album_name}")
    llm_text  = generate_llm_analysis(artist, album_name, year)
    wiki_text = fetch_wikipedia(artist, album_name)
    lfm_data  = fetch_lastfm(artist, album_name)
    genius_text = fetch_genius(artist, album_name)

    return {
        "album_id":           album_id,
        "artist":             artist,
        "album_name":         album_name,
        "year":               year,
        "theme_score":        theme_score,
        "llm_analysis":       llm_text,
        "wikipedia_summary":  wiki_text,
        "lastfm_summary":     lfm_data["summary"],
        "lastfm_tags":        lfm_data["tags"],
        "genius_annotation":  genius_text,
    }


def load_or_build_corpus(album_id: int, artist: str, album_name: str,
                          year: int | None, theme_score: float | None,
                          force: bool = False) -> dict:
    path = CACHE_DIR / f"{_safe_filename(artist, album_name)}.json"
    if path.exists() and not force:
        data = json.loads(path.read_text())
        # Update theme_score in case it was added since caching
        data["theme_score"] = theme_score
        return data
    corpus = build_corpus(album_id, artist, album_name, year, theme_score)
    path.write_text(json.dumps(corpus, indent=2, ensure_ascii=False))
    return corpus


def build_document(corpus: dict) -> str:
    """Combine all text sources into one document for embedding."""
    parts = [
        f"Album: {corpus['artist']} – {corpus['album_name']}",
    ]
    if corpus.get("llm_analysis"):
        parts.append(corpus["llm_analysis"])
    if corpus.get("wikipedia_summary"):
        parts.append("Wikipedia:\n" + corpus["wikipedia_summary"])
    if corpus.get("lastfm_summary"):
        parts.append("Last.fm:\n" + corpus["lastfm_summary"])
    if corpus.get("lastfm_tags"):
        parts.append("Tags: " + ", ".join(corpus["lastfm_tags"]))
    if corpus.get("genius_annotation"):
        parts.append("Genius:\n" + corpus["genius_annotation"])
    return "\n\n".join(p for p in parts if p.strip())
