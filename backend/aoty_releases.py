"""
This week's popular releases, scraped from albumoftheyear.org.

AOTY has no public API, so this parses the one listing page at
/releases/this-week/. That page is not disallowed by their robots.txt (which
blocks search, user, tag and ?sort= paths), the request identifies itself
honestly as Pressd, and callers cache the result for hours — one page fetch
per refresh.

Why AOTY over a metadata feed: it carries a real popularity signal per
*release* — the number of users who have rated it — where ListenBrainz has
none and Deezer only exposes an artist's total fan count, which measures how
famous the act is rather than whether this record landed.

Being HTML, this is inherently fragile: `parse_releases` returns [] on any
markup it doesn't recognise so a layout change degrades to the fallback feed
rather than breaking the endpoint.
"""
import html as _html
import re

AOTY_THIS_WEEK = "https://www.albumoftheyear.org/releases/this-week/"
AOTY_UA = "Pressd/1.0 (+https://www.pressdmusic.com)"

# One <div class="albumBlock ..."> per release; non-greedy up to the next block.
_BLOCK = re.compile(r'<div class="albumBlock[^"]*"[^>]*>(.*?)(?=<div class="albumBlock|\Z)', re.S)
_ALBUM_HREF = re.compile(r'href="(/album/(\d+)-[^"]*)"')
_COVER = re.compile(r'<img src="([^"]+)"')
_ARTIST = re.compile(r'<div class="artistTitle">(.*?)</div>', re.S)
_TITLE = re.compile(r'<div class="albumTitle">(.*?)</div>', re.S)
# Each ratingRow is a score plus its label and sample size:
#   <div class="rating">70</div> ... user score ... (10.4K)
_RATING_ROW = re.compile(
    r'<div class="rating">(\d+)</div>.*?<div class="ratingText">([^<]*?)</div>\s*'
    r'<div class="ratingText">\((.*?)\)</div>',
    re.S,
)


def _text(raw: str) -> str:
    """Strip tags and decode entities. Accented titles ("Memórias Póstumas")
    arrive as named entities, so this uses the stdlib table rather than a
    hand-rolled one."""
    return _html.unescape(re.sub(r"<[^>]+>", "", raw)).strip()


def _count(raw: str) -> int:
    """'10.4K' -> 10400, '1.2M' -> 1200000, '31' -> 31, anything else -> 0."""
    s = _text(raw).replace(",", "").strip().upper()
    m = re.match(r"^([\d.]+)([KM]?)$", s)
    if not m:
        return 0
    n = float(m.group(1))
    return int(n * {"": 1, "K": 1_000, "M": 1_000_000}[m.group(2)])


def parse_releases(html: str) -> list[dict]:
    """Releases from a this-week listing page, most-rated first."""
    out: list[dict] = []
    seen: set[tuple[str, str]] = set()

    for raw in _BLOCK.findall(html):
        href = _ALBUM_HREF.search(raw)
        artist = _ARTIST.search(raw)
        title = _TITLE.search(raw)
        if not (href and artist and title):
            continue
        artist_name, album_name = _text(artist.group(1)), _text(title.group(1))
        if not artist_name or not album_name:
            continue
        key = (album_name.lower(), artist_name.lower())
        if key in seen:
            continue
        seen.add(key)

        critic_score = critic_n = user_score = user_n = None
        for score, label, count in _RATING_ROW.findall(raw):
            label = _text(label).lower()
            if "critic" in label:
                critic_score, critic_n = int(score), _count(count)
            elif "user" in label:
                user_score, user_n = int(score), _count(count)

        cover = _COVER.search(raw)
        out.append({
            "aoty_id": int(href.group(2)),
            "aoty_url": f"https://www.albumoftheyear.org{href.group(1)}",
            "album_name": album_name,
            "artist": artist_name,
            # Ask the CDN for a larger crop than the 200px thumbnail in the page.
            "cover_url": cover.group(1).replace("/200x0/", "/400x0/") if cover else None,
            "critic_score": critic_score,
            "critic_count": critic_n,
            "user_score": user_score,
            "user_count": user_n or 0,
        })

    # Popularity = how many people bothered to rate this release this week.
    out.sort(key=lambda r: (r["user_count"], r["critic_count"] or 0), reverse=True)
    return out
