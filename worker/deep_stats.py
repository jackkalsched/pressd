"""Export a "deeper stats" card for one rated album, as a 1080×1920 PNG.

For the end of a vertical album-review video: the record, its final score, every
track as a bar against the owner's overall song average (favourite and least
favourite marked with triangles), the album's percentile on a density curve
of the owner's library, and each of the four external factors as a histogram of
the owner's own values with this album's value drawn as a vertical line.

It lives outside both apps on purpose — a creator tool, not a feature. It reads
production and writes nothing to it. The card is drawn as HTML (the app's fonts
from Google Fonts, the share card's palette) and photographed by headless Chrome,
so it needs Chrome installed and a network connection for the fonts and cover.

    python -m worker.deep_stats 1241                    # by album copy id
    python -m worker.deep_stats "to pimp a butterfly"   # by name, in user 1's rated albums
    python -m worker.deep_stats "blonde" --user 12 --out ~/Desktop --html

A name that matches several rated copies lists them and exits 1; pass the id.
The library it compares against is the owner's rated albums without singles
(≤2 tracks), as the library and profile count them.
"""
import argparse
import html
import json
import math
import pathlib
import re
import subprocess
import sys
import tempfile

ROOT = pathlib.Path(__file__).parent.parent
sys.path.insert(0, str(ROOT))

from sqlalchemy import text  # noqa: E402

from backend.database import engine  # noqa: E402

CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
LOGO = ROOT / "frontend" / "public" / "logo.png"

# The share card's palette. Literal: the card is a picture.
INK, GREEN, WARM, WARM2 = "#1c1917", "#2d6a4f", "#8a7f72", "#a8998a"
# shared/src/types.ts BANG_THRESHOLD / SKIP_THRESHOLD — change both.
BANG, SKIP = 8.0, 6.5
RULE, PAGE, TRACK_BG = "#e6ded2", "#faf8f5", "rgba(120,100,80,.12)"

W, H, PAD_X = 1080, 1920, 64
INNER = W - 2 * PAD_X
# The bang/skip tag sits right against the score, in one right-aligned cell.
COL_NUM, COL_TITLE, COL_GAP, COL_SCORE = 44, 420, 16, 124
COL_BAR = INNER - COL_NUM - COL_TITLE - 2 * COL_GAP - COL_SCORE
# One bin per whole point, centred on it (the axis runs 0.5–10.5): factors are
# mostly given as whole numbers, and half-point bins left every other bar empty.
FACTOR_BINS = 10
PCT_H = 96

FACTORS = [("theme", "Theme"), ("replay_value", "Replay value"),
           ("production", "Production"), ("distinctness", "Distinctness")]


def score_color(s: float) -> str:
    """shared/src/types.ts songScoreColor, light scale."""
    return f"hsl({round((s - 1) / 9 * 130)}, 65%, 32%)"


def ordinal(n: int) -> str:
    if 11 <= n % 100 <= 13:
        return f"{n}th"
    return f"{n}{ {1: 'st', 2: 'nd', 3: 'rd'}.get(n % 10, 'th') }"


def percentile_of(v: float, others: list[float]) -> int:
    """Share of the others below v, ties counted half."""
    if not others:
        return 100
    below = sum(o < v for o in others)
    ties = sum(o == v for o in others)
    return round((below + ties / 2) / len(others) * 100)


def find_album(con, query: str, user_id: int) -> dict:
    cols = "id, user_id, album_name, artist, year, score, top_song_id, theme, replay_value, production, distinctness, album_art_url, extra_artists, status"
    if query.isdigit():
        row = con.execute(text(f"SELECT {cols} FROM album WHERE id = :id"), {"id": int(query)}).mappings().first()
        if not row:
            sys.exit(f"No album with id {query}.")
    else:
        rows = con.execute(text(
            f"SELECT {cols} FROM album WHERE user_id = :u AND status = 'rated' AND album_name ILIKE :q ORDER BY album_name"
        ), {"u": user_id, "q": f"%{query}%"}).mappings().all()
        if not rows:
            sys.exit(f"No rated album of user {user_id} matches {query!r}.")
        exact = [r for r in rows if r["album_name"].lower() == query.lower()]
        if len(rows) > 1 and len(exact) != 1:
            print(f"{len(rows)} rated albums match {query!r} — pass an id:", file=sys.stderr)
            for r in rows:
                print(f"  {r['id']:>6}  {r['album_name']} — {r['artist']}", file=sys.stderr)
            sys.exit(1)
        row = exact[0] if exact else rows[0]
    if row["status"] != "rated":
        sys.exit(f"{row['album_name']} isn't rated yet (status {row['status']}).")
    return dict(row)


def load(query: str, user_id: int):
    with engine.connect() as con:
        album = find_album(con, query, user_id)
        songs = con.execute(text(
            "SELECT id, title, track_number, score FROM song WHERE album_id = :a ORDER BY track_number NULLS LAST, id"
        ), {"a": album["id"]}).mappings().all()
        # The owner's library as it is shown: rated, singles (1–2 tracks) left out.
        library = con.execute(text("""
            SELECT a.id, a.score, a.theme, a.replay_value, a.production, a.distinctness
            FROM album a
            WHERE a.user_id = :u AND a.status = 'rated'
              AND (SELECT count(*) FROM song s WHERE s.album_id = a.id) NOT IN (1, 2)
        """), {"u": album["user_id"]}).mappings().all()
        # Their song average: every scored song on that same library.
        album["owner_song_avg"] = con.execute(text("""
            SELECT avg(s.score) FROM song s JOIN album a ON a.id = s.album_id
            WHERE a.user_id = :u AND a.status = 'rated' AND s.score IS NOT NULL
              AND (SELECT count(*) FROM song x WHERE x.album_id = a.id) NOT IN (1, 2)
        """), {"u": album["user_id"]}).scalar()
    return album, [dict(s) for s in songs], [dict(r) for r in library]


def label(txt: str, extra: str = "") -> str:
    return (f'<p style="margin:0;font:700 16px \'Plus Jakarta Sans\';letter-spacing:.22em;'
            f'text-transform:uppercase;color:{WARM};{extra}">{txt}</p>')


def build_html(album: dict, songs: list[dict], library: list[dict]) -> str:
    e = html.escape
    others = [r for r in library if r["id"] != album["id"]]
    score = album["score"]

    # ── header ──
    extra = json.loads(album["extra_artists"]) if album["extra_artists"] else []
    artists = ", ".join([album["artist"], *extra])
    byline = e(artists + (f" · {album['year']}" if album["year"] else ""))
    cover = (f'<img src="{e(album["album_art_url"])}" style="width:150px;height:150px;object-fit:cover;display:block">'
             if album["album_art_url"] else
             f'<div style="width:150px;height:150px;display:flex;align-items:center;justify-content:center;'
             f'color:{WARM2};font:700 56px \'Playfair Display\',serif">{e(album["album_name"][:1])}</div>')
    score_txt = f"{score:.2f}" if score is not None else "—"
    rated_songs = [s["score"] for s in songs if s["score"] is not None]
    bangs = sum(v >= BANG for v in rated_songs)
    skips = sum(v < SKIP for v in rated_songs)
    share = lambda k: round(k / len(rated_songs) * 100) if rated_songs else 0  # noqa: E731

    # frontend AlbumDetail's "Bang rate" / "Skip rate" StatFigures: the figure
    # in Playfair in green or red, its name under it in warm grey.
    def figure(value: str, name: str, col: str) -> str:
        return (f'<div><p style="margin:0;font:700 44px/1 \'Playfair Display\',serif;color:{col}">{value}</p>'
                f'<p style="margin:8px 0 0;font:500 18px \'Plus Jakarta Sans\';color:{WARM}">{name}</p></div>')
    tallies = (f'<div style="display:flex;gap:44px;margin-top:18px">'
               f'{figure(f"{share(bangs)}%", "Bang rate", GREEN)}'
               f'{figure(f"{share(skips)}%", "Skip rate", "#c0392b")}</div>') if rated_songs else ""
    score_col = score_color(score) if score is not None else GREEN

    # ── track by track ──
    mean = album["owner_song_avg"]
    # Favourite and least favourite, as the share card picks them
    # (shared pickTopSong): the rater's tie-break, else the first top score;
    # the least is the lowest, the later track among ties.
    scored_songs = [s for s in songs if s["score"] is not None]
    fav = next((s for s in scored_songs if s["id"] == album["top_song_id"]), None)
    if fav is None and scored_songs:
        fav = max(scored_songs, key=lambda s: s["score"])  # first of the ties
    least = sorted(scored_songs, key=lambda s: -s["score"])[-1] if len(scored_songs) > 1 else None
    if least is fav:
        least = None
    factor_vals = [album[k] for k, _ in FACTORS]
    show_factors = len(songs) > 6 and any(v is not None for v in factor_vals)
    area = 690 if show_factors else 960
    row_h = max(20, min(64, area // max(1, len(songs))))
    font = max(15, round(min(26, row_h * 0.55)))
    bar_h = max(10, round(min(row_h * 0.5, 22)))
    rows = []
    for i, s in enumerate(songs, 1):
        num = s["track_number"] or i
        sc = s["score"]
        fill = (f'<div style="width:{sc / 10 * 100:.2f}%;height:100%;background:{score_color(sc)};border-radius:4px"></div>'
                if sc is not None else "")
        tag = ""
        if sc is not None and (sc >= BANG or sc < SKIP):
            # frontend albumView BangSkip: bare bold capitals in the song's score colour.
            tag = (f'<span style="font:700 {max(12, round(font * 0.58))}px \'Plus Jakarta Sans\';letter-spacing:.08em;'
                   f'color:{score_color(sc)}">{"BANG" if sc >= BANG else "SKIP"}</span>')
        # FullReviewModal / ReviewCell: a green up triangle, a red down one.
        tri = ""
        tsz = max(12, round(font * 0.62))
        if s is fav:
            tri = (f'<svg width="{tsz}" height="{tsz}" viewBox="0 0 10 10" style="flex-shrink:0">'
                   f'<path d="M5 1 L9.5 9 L0.5 9 Z" fill="{GREEN}"/></svg>')
        elif s is least:
            tri = (f'<svg width="{tsz}" height="{tsz}" viewBox="0 0 10 10" style="flex-shrink:0">'
                   f'<path d="M0.5 1 L9.5 1 L5 9 Z" fill="#e0492b"/></svg>')
        rows.append(f'''
          <div style="display:flex;align-items:center;height:{row_h}px;gap:{COL_GAP}px">
            <span style="width:{COL_NUM - COL_GAP}px;flex-shrink:0;text-align:right;font:600 {font - 3}px 'Plus Jakarta Sans';color:{WARM2}">{num}</span>
            <span style="width:{COL_TITLE}px;flex-shrink:0;display:flex;align-items:center;gap:8px;min-width:0"><span style="font:600 {font}px 'Plus Jakarta Sans';color:{INK};overflow:hidden;text-overflow:ellipsis;white-space:nowrap">{e(s["title"])}</span>{tri}</span>
            <div style="width:{COL_BAR}px;flex-shrink:0;height:{bar_h}px;background:{TRACK_BG};border-radius:4px;overflow:hidden">{fill}</div>
            <span style="width:{COL_SCORE}px;flex-shrink:0;display:flex;align-items:baseline"><span style="width:58px;flex-shrink:0;font:800 {font + 9}px/1 'Playfair Display',serif;color:{score_color(sc) if sc is not None else WARM2}">{f"{sc:.1f}" if sc is not None else "—"}</span><span style="flex:1;text-align:right">{tag}</span></span>
          </div>''')
    mean_x = COL_NUM + COL_TITLE + COL_GAP + (mean or 0) / 10 * COL_BAR
    mean_line = (f'<div style="position:absolute;top:-6px;bottom:-6px;width:0;opacity:.55;'
                 f'left:{mean_x:.1f}px;border-left:2px dashed {INK}"></div>'
                 f'<span style="position:absolute;top:-34px;left:{mean_x:.1f}px;transform:translateX(-50%);white-space:nowrap;'
                 f'font:700 14px \'Plus Jakarta Sans\';letter-spacing:.14em;color:{WARM}">MY SONG AVG '
                 f'<span style="font:800 18px \'Playfair Display\',serif;letter-spacing:0;color:{INK}">{mean:.2f}</span></span>'
                 if mean is not None else "")

    # ── album percentile: the density of every rated album's score, this one
    # marked, and the share of albums below it shaded — that area is the percentile.
    pct_html = ""
    if score is not None:
        other_scores = [r["score"] for r in others if r["score"] is not None]
        ranked = sorted(other_scores + [score])
        n = len(ranked)
        pct = percentile_of(score, other_scores)
        curve = ""
        if n > 1:
            # The axis starts at the 1st percentile, not the minimum: a handful of
            # albums near 1 would otherwise squeeze the whole curve into a third.
            lo = math.floor(min(ranked[int(0.01 * (n - 1))], score))
            hi = math.ceil(max(ranked))
            hi = hi if hi > lo else lo + 1
            mean = sum(ranked) / n
            sd = (sum((v - mean) ** 2 for v in ranked) / (n - 1)) ** 0.5
            bw = max(0.12, 1.06 * sd * n ** -0.2)  # Silverman's rule
            steps = 240
            xs = [lo + (hi - lo) * i / steps for i in range(steps + 1)]
            dens = [sum(math.exp(-0.5 * ((x - v) / bw) ** 2) for v in ranked) for x in xs]
            top = max(dens)
            px = lambda v: (v - lo) / (hi - lo) * INNER  # noqa: E731
            py = lambda d: PCT_H - d / top * (PCT_H - 8)  # noqa: E731
            pts = [(px(x), py(d)) for x, d in zip(xs, dens)]
            line = " ".join(f"{'L' if i else 'M'}{a:.1f},{b:.1f}" for i, (a, b) in enumerate(pts))
            area = f"{line} L{INNER},{PCT_H} L0,{PCT_H} Z"
            mx = px(score)
            my = py(sum(math.exp(-0.5 * ((score - v) / bw) ** 2) for v in ranked))
            small = f"font:600 15px 'Plus Jakarta Sans';color:{WARM2};position:absolute;top:{PCT_H + 10}px"
            ticks = "".join(
                f'<span style="{small};left:{px(t):.1f}px;transform:translateX(-50%)">{t}</span>'
                for t in range(lo, hi + 1))
            curve = f'''
              <div style="position:relative;margin-top:26px;width:{INNER}px;height:{PCT_H + 34}px">
                <svg width="{INNER}" height="{PCT_H}" style="display:block;overflow:visible">
                  <defs><clipPath id="below"><rect x="0" y="0" width="{mx:.1f}" height="{PCT_H}"/></clipPath></defs>
                  <path d="{area}" fill="rgba(120,100,80,.10)"/>
                  <path d="{area}" fill="rgba(45,106,79,.20)" clip-path="url(#below)"/>
                  <path d="{line}" fill="none" stroke="{WARM2}" stroke-width="3" stroke-linejoin="round"/>
                  <line x1="0" y1="{PCT_H}" x2="{INNER}" y2="{PCT_H}" stroke="{RULE}" stroke-width="2"/>
                  <line x1="{mx:.1f}" y1="{my - 26:.1f}" x2="{mx:.1f}" y2="{PCT_H}" stroke="{INK}" stroke-width="3"/>
                  <circle cx="{mx:.1f}" cy="{my:.1f}" r="10" fill="{score_color(score)}" stroke="{PAGE}" stroke-width="4"/>
                </svg>
                {ticks}
              </div>'''
        pct_html = f'''
          <div style="margin-top:30px;border-top:1px solid {RULE};padding-top:26px">
            <div style="display:flex;justify-content:space-between;align-items:baseline">
              {label("Album percentile")}
            </div>
            <div style="display:flex;align-items:baseline;gap:16px;margin-top:12px">
              <span style="font:800 64px/1 'Playfair Display',serif;color:{INK}">{ordinal(pct)}</span>
              <span style="font:500 24px 'Plus Jakarta Sans';color:{WARM}">percentile</span>
            </div>
            {curve}
          </div>'''

    # ── external factors against the owner's own distribution ──
    factors_html = ""
    if show_factors:
        cells = []
        for key, name in FACTORS:
            v = album[key]
            dist = [r[key] for r in others if r[key] is not None]
            allv = dist + ([v] if v is not None else [])
            bins = [0] * FACTOR_BINS
            for d in allv:
                bins[min(FACTOR_BINS - 1, max(0, int(d + 0.5) - 1))] += 1
            top = max(1, *bins)
            bars = "".join(
                f'<div style="flex:1 1 0;height:{max(3, c / top * 50):.1f}px;background:rgba(120,100,80,.22);border-radius:3px 3px 0 0"></div>'
                for c in bins)
            marker = (f'<div style="position:absolute;top:0;bottom:0;width:3px;border-radius:2px;background:{INK};'
                      f'left:calc({(v - 0.5) / 10 * 100:.2f}% - 1.5px)"></div>' if v is not None else "")
            cells.append(f'''
              <div>
                <div style="display:flex;justify-content:space-between;align-items:baseline">
                  <span style="font:700 22px 'Plus Jakarta Sans';color:{INK}">{name}</span>
                  <span style="font:800 34px 'Playfair Display',serif;color:{score_color(v) if v is not None else WARM2}">{f"{v:.1f}" if v is not None else "—"}</span>
                </div>
                <div style="position:relative;margin-top:10px;height:56px;display:flex;align-items:flex-end;gap:8px">{bars}{marker}</div>
                <div style="height:2px;background:{RULE}"></div>
                <div style="display:flex;justify-content:space-between;margin-top:8px;font:600 15px 'Plus Jakarta Sans';color:{WARM2}">
                  <span style="width:{100 / FACTOR_BINS:.1f}%;text-align:center">1</span><span style="width:{100 / FACTOR_BINS:.1f}%;text-align:center">10</span>
                </div>
              </div>''')
        factors_html = f'''
          <div style="margin-top:{30 if pct_html else 36}px;border-top:1px solid {RULE};padding-top:26px">
            <div style="display:flex;justify-content:space-between;align-items:baseline">
              {label("External factors")}
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;column-gap:56px;row-gap:24px;margin-top:18px">{"".join(cells)}</div>
          </div>'''

    return f'''<!doctype html>
<html><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@500;600;700;800&family=Playfair+Display:wght@700;800&display=block" rel="stylesheet">
<style>html,body{{margin:0;background:{PAGE}}}*{{box-sizing:border-box}}</style>
</head><body>
<div style="position:relative;width:{W}px;height:{H}px;overflow:hidden;background:{PAGE};color:{INK};display:flex;flex-direction:column;padding:60px {PAD_X}px 44px;font-family:'Plus Jakarta Sans',system-ui,sans-serif">

  <div style="display:flex;align-items:center;gap:28px">
    <div style="width:150px;height:150px;flex-shrink:0;border-radius:16px;overflow:hidden;background:#ece6dc">{cover}</div>
    <div style="flex:1;min-width:0">
      {label("Deeper stats")}
      <h1 style="margin:10px 0 0;font:800 50px/1.05 'Playfair Display',serif;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">{e(album["album_name"])}</h1>
      <p style="margin:10px 0 0;font:500 24px 'Plus Jakarta Sans';color:{WARM};overflow:hidden;text-overflow:ellipsis;white-space:nowrap">{byline}</p>
      {tallies}
    </div>
    <div style="text-align:right;flex-shrink:0">
      <div style="font:800 96px/.9 'Playfair Display',serif;color:{score_col}">{score_txt}</div>
    </div>
  </div>

  <div style="margin-top:36px;border-top:1px solid {RULE};padding-top:26px">
    <div style="display:flex;justify-content:space-between;align-items:baseline">{label("Track by track")}</div>
    <div style="position:relative;margin-top:46px">{"".join(rows)}{mean_line}</div>
  </div>
  {pct_html}
  {factors_html}

  <div style="margin-top:auto;padding-top:26px;display:flex;align-items:center;justify-content:center;gap:11px;border-top:1px solid {RULE}">
    <img src="{LOGO.as_uri()}" style="height:34px;width:auto;display:block">
    <span style="font:800 24px 'Plus Jakarta Sans',sans-serif;letter-spacing:-.02em">Pressd</span>
    <span style="font:500 20px 'Plus Jakarta Sans';color:{WARM}">· pressdmusic.com</span>
  </div>
</div>
</body></html>'''


def render(page: str, png: pathlib.Path) -> None:
    with tempfile.TemporaryDirectory() as tmp:
        src = pathlib.Path(tmp) / "card.html"
        src.write_text(page, encoding="utf-8")
        # The virtual-time budget lets the fonts and the cover arrive before
        # the shot; without it Chrome photographs the fallback faces.
        subprocess.run([
            CHROME, "--headless=new", "--disable-gpu", "--hide-scrollbars",
            "--allow-file-access-from-files", "--force-device-scale-factor=1",
            f"--window-size={W},{H}", "--virtual-time-budget=10000",
            f"--user-data-dir={tmp}/profile", f"--screenshot={png}", src.as_uri(),
        ], check=True, capture_output=True)


def main() -> int:
    ap = argparse.ArgumentParser(description="Export a deeper-stats card for one rated album.")
    ap.add_argument("album", help="an album copy id, or part of a rated album's name")
    ap.add_argument("--user", type=int, default=1, help="whose rated albums a name is searched in (default 1)")
    ap.add_argument("--out", default=str(ROOT / "export" / "deep-stats"), help="folder for the PNG")
    ap.add_argument("--html", action="store_true", help="also keep the HTML beside the PNG")
    args = ap.parse_args()

    if not pathlib.Path(CHROME).exists():
        sys.exit(f"Chrome not found at {CHROME}.")
    album, songs, library = load(args.album, args.user)
    page = build_html(album, songs, library)

    out = pathlib.Path(args.out).expanduser()
    out.mkdir(parents=True, exist_ok=True)
    slug = re.sub(r"[^a-z0-9]+", "-", album["album_name"].lower()).strip("-") or str(album["id"])
    png = out / f"{slug}.png"
    render(page, png)
    if args.html:
        (out / f"{slug}.html").write_text(page, encoding="utf-8")
    print(png)
    return 0


if __name__ == "__main__":
    sys.exit(main())
