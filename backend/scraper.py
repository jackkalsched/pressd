"""
AOTY scraper — artist page discovery and album list extraction.

Discovery flow:
  1. DuckDuckGo HTML search for  site:albumoftheyear.org/artist/ "{artist_name}"
  2. Parse results for the first URL matching /artist/{id}-{slug}/
  3. Fetch that artist page and extract all album blocks

robots.txt allows crawling of /artist/* and /album/* pages.
/search/* is disallowed, so we use DuckDuckGo for discovery.
"""

import re
import time
import httpx
from bs4 import BeautifulSoup

AOTY_BASE = "https://www.albumoftheyear.org"
DDG_URL = "https://html.duckduckgo.com/html/"

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0 Safari/537.36"
    ),
    "Accept-Language": "en-US,en;q=0.9",
}

ARTIST_URL_RE = re.compile(
    r"https?://(?:www\.)?albumoftheyear\.org/artist/(\d+)-([a-z0-9-]+)/?"
)

# Section headings we care about (maps to a normalised type label)
SECTION_TYPES = {
    "album":    "Album",
    "albums":   "Album",
    "ep":       "EP",
    "eps":      "EP",
    "mixtape":  "Mixtape",
    "mixtapes": "Mixtape",
    "single":   "Single",
    "singles":  "Single",
    "live":     "Live",
    "compilation": "Compilation",
    "compilations": "Compilation",
}


# ── DuckDuckGo artist discovery ───────────────────────────────────────────────

def find_artist_url(artist_name: str) -> str | None:
    """
    Use DuckDuckGo HTML search to discover the AOTY artist page URL.
    Returns the first matching URL or None.
    """
    query = f'site:albumoftheyear.org/artist/ "{artist_name}"'
    try:
        resp = httpx.post(
            DDG_URL,
            data={"q": query, "kl": "us-en"},
            headers=HEADERS,
            follow_redirects=True,
            timeout=12,
        )
        resp.raise_for_status()
    except httpx.HTTPError:
        return None

    soup = BeautifulSoup(resp.text, "lxml")

    for a in soup.find_all("a", href=True):
        href = a["href"]
        m = ARTIST_URL_RE.search(href)
        if m:
            return f"{AOTY_BASE}/artist/{m.group(1)}-{m.group(2)}/"

    # fallback: look inside result text blocks
    for tag in soup.find_all(string=ARTIST_URL_RE):
        m = ARTIST_URL_RE.search(str(tag))
        if m:
            return f"{AOTY_BASE}/artist/{m.group(1)}-{m.group(2)}/"

    return None


# ── AOTY artist page scraper ─────────────────────────────────────────────────

def scrape_artist_page(artist_url: str) -> list[dict]:
    """
    Fetch an AOTY artist page and return a list of album dicts:
      { title, year, type, aoty_url, score }
    Score is the critic average (0-100) or None.
    """
    try:
        resp = httpx.get(artist_url, headers=HEADERS, follow_redirects=True, timeout=12)
        resp.raise_for_status()
    except httpx.HTTPError:
        return []

    soup = BeautifulSoup(resp.text, "lxml")
    albums: list[dict] = []
    current_type = "Album"

    # Walk top-level content area for section headers and album blocks
    content = soup.select_one("#artistContent, #centerContent, .artistContent, main") or soup.body

    if content is None:
        return []

    for el in content.descendants:
        if not hasattr(el, "name"):
            continue

        # Detect section headings (h2/h3 like "Albums", "EPs", "Mixtapes")
        if el.name in ("h2", "h3"):
            heading = el.get_text(strip=True).lower().rstrip("s")
            for key, label in SECTION_TYPES.items():
                if key in heading:
                    current_type = label
                    break

        # Album block — AOTY uses .albumBlock or .albumListItem
        if el.name == "div" and any(
            c in el.get("class", [])
            for c in ("albumBlock", "albumListItem", "albumGridItem")
        ):
            album = _parse_album_block(el, current_type)
            if album:
                albums.append(album)

    # De-duplicate by URL
    seen: set[str] = set()
    unique = []
    for a in albums:
        if a["aoty_url"] not in seen:
            seen.add(a["aoty_url"])
            unique.append(a)

    return unique


def _parse_album_block(el: BeautifulSoup, release_type: str) -> dict | None:
    """Extract title, year, score and URL from one album block element."""
    # Find the primary link (title link)
    link = None
    for a in el.find_all("a", href=True):
        if re.match(r"^/album/", a["href"]):
            link = a
            break

    if not link:
        return None

    aoty_url = AOTY_BASE + link["href"].rstrip("/") + "/"
    title = link.get_text(strip=True)

    if not title:
        # title might be in a sibling element
        title_el = el.select_one(".albumTitle, .albumBlockTitle, .title")
        title = title_el.get_text(strip=True) if title_el else ""

    if not title:
        return None

    # Year
    year: int | None = None
    date_el = el.select_one(".date, .albumBlockDate, .albumListDate, .year")
    if date_el:
        m = re.search(r"\b(19|20)\d{2}\b", date_el.get_text())
        if m:
            year = int(m.group())

    # Score (critic average displayed as 0-100)
    score: float | None = None
    score_el = el.select_one(".albumBlockScore, .score, .rating, .albumListScore, .scoreValue")
    if score_el:
        try:
            score = float(score_el.get_text(strip=True))
        except ValueError:
            pass

    return {
        "title": title,
        "year": year,
        "type": release_type,
        "aoty_url": aoty_url,
        "score": score,
    }


# ── Genre scraper (single album page) ────────────────────────────────────────

def scrape_album_genres(album_url: str) -> dict | None:
    """
    Scrape genre tags from a single AOTY album page.
    Returns { genre, sub_genre1, sub_genre2 } or None on failure.
    Polite: callers should space out requests.
    """
    try:
        time.sleep(0.5)
        resp = httpx.get(album_url, headers=HEADERS, follow_redirects=True, timeout=12)
        resp.raise_for_status()
    except httpx.HTTPError:
        return None

    soup = BeautifulSoup(resp.text, "lxml")

    genres: list[str] = []
    for tag in soup.select(".albumTopBox .genreBox a, .genre a, .tag a"):
        text = tag.get_text(strip=True)
        if text:
            genres.append(text)

    if not genres:
        return None

    return {
        "genre": genres[0] if len(genres) > 0 else None,
        "sub_genre1": genres[1] if len(genres) > 1 else None,
        "sub_genre2": genres[2] if len(genres) > 2 else None,
    }
