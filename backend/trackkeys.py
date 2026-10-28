"""
Normalized dedup keys for the global track / album-corpus stores.

`recording_key` identifies "the same recording" across different users'
imports, whose titles differ only by feat-credits, remaster/edition suffixes,
or punctuation — and keeps apart the live takes, demos and remixes that share
a studio title. `album_key` and `subject_key_album` do the same job for
records. Pure stdlib — safe to import from the web service, the worker, and
one-off scripts alike.
"""
import re
import unicodedata

# Parenthetical/bracket segments that only carry credits: "(feat. X)", "[with Y]"
_FEAT_PAREN = re.compile(
    r"[(\[][^)\]]*\b(feat\.?|featuring|ft\.?|with)\b[^)\]]*[)\]]", re.I)
# Trailing dash qualifiers: "- 2011 Remaster", "- Deluxe Edition", "- Live at ..."
_TRAIL_QUAL = re.compile(
    r"\s-\s[^-]*\b(remaster(ed)?|deluxe|live|bonus|edition|version|remix|"
    r"mix|mono|stereo|single|demo|acoustic|extended|anniversary)\b.*$", re.I)
# Bare trailing feat-credit without parens: "Song feat. X"
_FEAT_TAIL = re.compile(r"\s\b(feat\.?|featuring|ft\.?)\b\s.*$", re.I)


def _clean(s: str) -> str:
    raw = s or ""
    s = raw.lower().replace("&", "and")
    s = _FEAT_PAREN.sub(" ", s)
    s = _TRAIL_QUAL.sub(" ", s)
    s = _FEAT_TAIL.sub(" ", s)
    s = re.sub(r"[^a-z0-9]+", " ", s).strip()
    if not s:  # title was nothing but stripped qualifiers — fall back to raw
        s = re.sub(r"[^a-z0-9]+", " ", raw.lower()).strip()
    return s


def artist_key(s: str) -> str:
    """Canonical identity for an artist credit — the unit artist clustering
    groups on.

    `_clean` alone is not enough here. It strips anything outside [a-z0-9] after
    lowercasing, so a diacritic is deleted rather than folded: "Cafuné" becomes
    "cafun" while "Cafune" becomes "cafune", and the two stay separate artists.
    Decomposing to NFKD first and dropping the combining marks turns "é" into
    "e" before that substitution ever runs.

    Deliberately no "the"-prefix stripping: it would merge The Cure with Cure,
    and there is no evidence of that particular disagreement in the data.

    Not a stored key — this is a grouping key, computed on read, so it can be
    tightened later without a migration.
    """
    raw = s or ""
    folded = unicodedata.normalize("NFKD", raw.casefold())
    folded = "".join(c for c in folded if not unicodedata.combining(c))
    return _clean(folded)


def track_key(artist: str, title: str) -> str:
    """The track key as it was built until October 2026: `_clean` on the
    song's own artist string and on the title. Superseded by `recording_key`
    for everything that links a song to a Track; kept because `_clean` is
    still what `album_key` is made of, and old keys are what the re-key
    (backend/rekey_tracks.py) compares against."""
    return f"{_clean(artist)}||{_clean(title)}"


def album_key(artist: str, album_name: str) -> str:
    return f"{_clean(artist)}||{_clean(album_name)}"


# Edition qualifiers in parentheses/brackets: "(Deluxe)", "[2010 Remaster]".
# _TRAIL_QUAL above only covers the dash form, which is enough for track titles
# but not for album names — catalogs disagree on edition far more than on the
# record itself, and "Ctrl (Deluxe)" has to match "Ctrl". Deliberately excludes
# soundtrack/live: those are genuinely different releases.
# `medley` earns its place the same way: one copy of Take Care spells a track
# "Cameras / Good Ones Go Interlude" and another "… (Medley)". Safe because the
# only other use of the word in the catalog is a prefix ("Medley: Pick A Bale
# Of Cotton"), which no parenthetical rule touches. Deliberately not added to
# _TRAIL_QUAL, which feeds _clean and therefore the stored album_key.
_EDITION_PAREN = re.compile(
    r"[(\[][^)\]]*\b(deluxe|remaster(ed)?|expanded|edition|version|anniversary|"
    r"explicit|bonus|mono|stereo|reissue|remix|mix|medley)\b[^)\]]*[)\]]", re.I)


# Straight and curly. Deleted rather than spaced, so "Marvin's" meets "Marvins".
_APOSTROPHE = re.compile(r"['\u2019]")

# The dash form of the qualifiers _TRAIL_QUAL misses. That regex feeds _clean
# and therefore the stored album_key, so it cannot grow; this one is applied in
# match_title alone. Take Care carries the same interlude three ways \u2014 bare,
# "(Medley)", and "- Medley" \u2014 and only the middle one is a parenthetical.
_TRAIL_QUAL_CMP = re.compile(r"\s-\s[^-]*\bmedley\b.*$", re.I)


def match_title(title: str) -> str:
    """Same-recording key for a *track* title.

    Copies of one album disagree about titles in two ways at once: whether the
    feat-credit is spelled out ("From Time" vs "From Time (feat. Jhene Aiko)")
    and whether an edition qualifier is appended ("(Album Version)"). `_clean`
    alone only handles the first, so a bare `re.sub` on punctuation — or
    `_clean` on its own — splits one track into two rows on the community view.

    There is a third disagreement: whether the apostrophe is typed at all.
    `_clean` turns every non-alphanumeric run into a space, so "Marvin's Room"
    becomes "marvin s room" and "Marvins Room" becomes "marvins room" — one
    track, two rows. Deleting apostrophes before that substitution closes it,
    and generalises to "Don't"/"Dont".

    Comparison only, and deliberately looser than `recording_key`: it folds
    "(Remix)" and "(Taylor's Version)" into the original title, because the
    community view lines up rows of one record's tracklist rather than
    recordings. `_clean` feeds the stored `album_key` and must not change,
    which is why the apostrophe handling lives here rather than in `_clean`.
    """
    raw = title or ""
    stripped = _TRAIL_QUAL_CMP.sub(" ", _EDITION_PAREN.sub(" ", raw))
    stripped = _APOSTROPHE.sub("", stripped)
    return _clean(stripped) or _clean(_APOSTROPHE.sub("", raw))


def _clean_album(s: str) -> str:
    """_clean plus parenthesized edition qualifiers — for comparing album names
    across catalogs. Kept separate from `album_key`, whose output is a stored
    unique key that must stay stable."""
    raw = s or ""
    stripped = _EDITION_PAREN.sub(" ", raw)
    return _clean(stripped) or _clean(raw)


def artist_matches(want: str, got: str) -> bool:
    """True when two artist credits name the same act.

    Compared as a substring in either direction so a combined credit
    ("Bruno Mars, Anderson .Paak & Silk Sonic") still matches one of its
    members, which is how catalogs disagree in practice.
    """
    a, b = _clean(want).replace(" ", ""), _clean(got).replace(" ", "")
    return bool(a and b and (a in b or b in a))


def same_album(want_name: str, want_artist: str, got_name: str, got_artist: str) -> bool:
    """True when a catalog hit is the album that was asked for.

    Used to gate every lookup that resolves a name+artist to an external record
    (cover art, genre, discography imports). A same-titled album by a different
    artist is worse than no result at all, so callers must never fall back to
    the first hit without this check.
    """
    return _clean_album(want_name) == _clean_album(got_name) and artist_matches(
        want_artist, got_artist
    )


# ── Discussion subject keys (PLAN_discussions.md §2.2) ───────────────────────
# One thread per record, per artist, per recording. The grouping question here
# is the opposite of `album_key`'s: that one is a *stored* unique key on
# albumfactors/albumprediction and must stay byte-stable, so it cannot strip
# edition qualifiers. A thread has to do the reverse — every copy of a record
# has to land in one room, or "Take Care", "(Deluxe)" and "(Deluxe Version)"
# become three rooms with one poster each.

def subject_key_album(artist: str, album_name: str) -> str:
    """Grouping key for a discussion thread about a record.

    `artist_key` rather than `_clean` on the artist side so diacritics fold
    (Cafuné/Cafune), and `_clean_album` on the name side so editions collapse.
    Computed on read, never stored on the factors tables — it can be tightened
    later without a migration, which is exactly what `album_key` cannot do.
    """
    return f"{artist_key(artist)}||{_clean_album(album_name)}"


# ── Recording identity (October 2026) ────────────────────────────────────────

def recording_key(title: str, song_artist: str | None, album_artists: list[str],
                  album_name: str = "") -> str:
    """The stored `track.track_key`: which recording a song is, across every
    user's copy of every record it appears on.

    A Track carries the audio, analysed once and shared, so this key decides
    whose audio a song is scored with. It has to fail in neither direction:
    two spellings of one recording must meet, or the same song is downloaded
    twice and its ratings split; two recordings must not, or a live take is
    scored with the studio cut's audio. Until October 2026 it was
    `track_key(song.artist, title)`, and an audit of the library found both:

      Same recording, different ids (58 redundant tracks). Parenthetical
      edition qualifiers — "(2012 Remaster)", "(Remastered 2009)", "(Bonus
      Track)", "(Explicit Version)", "(Album Version)" — were not folded, only
      their dash forms were. And the artist side was the song's own credit
      string, so "Monster" credited "Kanye West, JAY-Z, Rick Ross, Nicki Minaj
      & Bon Iver" on one copy of MBDTF and "Kanye West" on another were two
      tracks.

      Different recordings, one id. `_clean`'s dash rule stripped "- Live",
      "- Demo", "- Remix", "- Acoustic" and "- X Version" into the studio key,
      and its credit rule ate any bracket containing "with" or "feat", so
      "(Afrojack Remix ft. Pitbull)" became the original and "(Basic Track
      With Guitar Overdubs)" vanished. 21 album copies held two songs on one
      track — "Karma" and "Karma (feat. Ice Spice)" on Midnights Til Dawn,
      Coloring Book's two "Blessings" — so the ingest analysed one and
      overwrote it with the other.

      Titles with no Latin letters cleaned to nothing: JPEGMAFIA's Japanese
      titles, Billie Eilish's "!!!!!!!" and Bon Iver's "..." each shared one
      track per artist with every other such title.

    The rule:

    Artist — the album's primary artist (`Album.artist`, which is the primary
    alone since backend/credits.py), through `artist_key` so diacritics fold.
    The song's own credit is used only when it names none of the album's
    credited artists: a soundtrack or compilation, where the album artist
    ("Various Artists") says nothing about who recorded the song. It is never
    split on its punctuation (credits.py says why).

    Title — NFKD-folded with combining marks dropped, apostrophes deleted
    ("Marvin's"/"Marvins"), "&" read as "and", then every run of non-letters
    and non-digits is a space. Letters and digits are Unicode, so a Japanese
    title is its own title. A title with neither (punctuation alone) falls
    back to its code points, so "!!!!!!!" and "..." stay two songs.

    Qualifiers — each "(...)" / "[...]" group and the " - ..." tail is read as
    a whole (`_classify_qualifier`) and is one of:
      fold     removed; same recording. Remaster(ed) with or without a year,
               deluxe, expanded, anniversary, edition, bonus (track), reissue,
               explicit, clean, album/original/LP version.
      credit   removed; a group that *starts* with feat/ft/featuring/with.
      variant  removed from the title and appended as a tag, `||v:<tags>`:
               live, demo, voice memo, acoustic, unplugged, stripped, piano,
               orchestral, instrumental, a cappella, session, rehearsal, alt,
               take N, outtake, basic track, sped up, slowed, reverb, edit,
               mono, stereo — and three that keep their words because the
               words name the recording: "<remixer> remix", "<x> mix" (2017,
               club, extended) and "<x> version" (Taylor's, single, Jamaican).
               Several tags are sorted and joined with "+".
      unknown  kept as title text: "(Interlude)", "(Reprise)", "(From The
               Vault)" are part of the song's name.
    A variant beats a credit ("(Afrojack Remix ft. Pitbull)" is a remix) and
    beats a fold ("(Remastered Live 1979)" is live).

    Album — a record can say "these are all demos" once, in its name:
    "Loveworm (Bedroom Sessions)". Only a *trailing* bracket group or dash
    tail of the album name is read, never a word search, because "Dark Lane
    Demo Tapes", "LONG.LIVE.A$AP" and "Steve Lacy's Demo" are records of
    original songs. Its tags apply only when the track title carries none of
    its own.

    Not handled here, because they need the whole album copy or the Track
    table: two songs on one copy that still meet (`backend/tracklink.py` adds
    `||alt<n>`), and same-name recordings told apart by duration (`||d<sec>`).

    `_clean`, `album_key` and `match_title` are untouched by this: the first
    two are a stored key on albumfactors/albumprediction, the third a looser
    comparison for the community view.
    """
    tags: set[str] = set()
    raw = title or ""

    def bracket(m: re.Match) -> str:
        kind = _classify_qualifier(m.group(1))
        if kind is None:
            return f" {m.group(1)} "
        if isinstance(kind, set):
            tags.update(kind)
        return " "

    base = _QUAL_GROUP.sub(bracket, raw)
    base = _strip_dash_tail(base, tags)
    base = _RK_FEAT_TAIL.sub(" ", base)

    text = " ".join(_rk_words(base))
    if not text:  # nothing but qualifiers, e.g. "(Bonus Track)" — keep them
        text = " ".join(_rk_words(raw))
    if not text:  # punctuation alone: its code points, so "..." ≠ "!!!!!!!"
        squeezed = re.sub(r"\s+", " ", raw.strip())
        text = "sym:" + "-".join(f"{ord(c):x}" for c in squeezed) if squeezed else ""

    if not tags:
        tags = _album_variant(album_name)

    key = f"{_recording_artist(song_artist, album_artists)}||{text}"
    if tags:
        key += "||v:" + "+".join(sorted(tags))
    return key


def key_parts(key: str) -> tuple[str, str]:
    """(artist_norm, title_norm) of a recording key, for the Track row."""
    parts = key.split("||")
    return parts[0], parts[1] if len(parts) > 1 else ""


_QUAL_GROUP = re.compile(r"[(\[]([^)\]]*)[)\]]")
# `_FEAT_TAIL` wants a word boundary after "feat.", which a period never has,
# so "Song feat. X" survives it. Its own copy because `_clean` uses the old one.
_RK_FEAT_TAIL = re.compile(r"\s(feat\.?|featuring|ft\.?)\s.*$", re.I)
_DASH_SPLIT = re.compile(r"\s[-–—]\s")
_CREDIT_WORDS = {"feat", "featuring", "ft", "with"}

# Variants named by a category alone. Matched against the qualifier's words
# joined by single spaces. `live` must open or close the qualifier — "(Live a
# Little Longer)" and "(I Wanna Live in a Dream in My…)" are song titles.
_VARIANT_PATTERNS = [
    ("live", re.compile(
        r"^live\b(?! (a|and|it|life|forever|your|my|like|to|or|without|for|"
        r"again|die|laugh|love|long|through|by|this|that)\b)|\blive$")),
    ("demo", re.compile(r"\bdemos?\b")),
    ("voice memo", re.compile(r"\bvoice memos?\b")),
    ("acoustic", re.compile(r"\bacoustic\b")),
    ("unplugged", re.compile(r"\bunplugged\b")),
    ("stripped", re.compile(r"\bstripped\b")),
    ("piano", re.compile(r"\bpiano (version|mix)\b")),
    ("orchestral", re.compile(r"\borchestral\b")),
    ("instrumental", re.compile(r"\binstrumentals?\b")),
    ("a cappella", re.compile(r"\ba ?cappella\b|\bacapella\b")),
    ("session", re.compile(r"\bsessions?\b")),
    ("rehearsal", re.compile(r"\brehearsals?\b")),
    ("alt", re.compile(r"\balt(ernate|ernative)?\b")),
    ("outtake", re.compile(r"\bouttakes?\b")),
    ("basic track", re.compile(r"\bbasic track\b")),
    ("sped up", re.compile(r"\bspee?d up\b")),
    ("slowed", re.compile(r"\bslowed\b")),
    ("reverb", re.compile(r"\breverb\b")),
    ("edit", re.compile(r"\bedit\b")),
    ("mono", re.compile(r"\bmono\b")),
    ("stereo", re.compile(r"\bstereo\b")),
]
_TAKE = re.compile(r"\btake (\d+)\b")
_REMIX = re.compile(r"\b(remix|remixes|rmx)\b")
# Words that, before "mix"/"version", mean the plain album cut.
_FOLD_BEFORE = {"album", "original", "explicit", "clean", "remaster", "remastered",
                "lp", "deluxe", "bonus", "track", "edition", "expanded", "dirty"}
_STRONG_FOLD = re.compile(
    r"\b(remaster|remastered|deluxe|expanded|anniversary|bonus|reissue|edition)\b")
# A qualifier made only of these is a fold: "(Explicit)", "[Clean Version]".
_WEAK_FOLD = {"explicit", "clean", "version", "ver", "dirty", "special", "limited",
              "super", "digital", "the"}


def _rk_words(s: str) -> list[str]:
    """Words of a title as recording_key compares them."""
    folded = unicodedata.normalize("NFKD", (s or "").casefold())
    folded = "".join(c for c in folded if not unicodedata.combining(c))
    folded = _APOSTROPHE.sub("", folded).replace("&", " and ")
    return re.findall(r"[^\W_]+", folded)


def _phrase(words: list[str], at: int) -> list[str]:
    """The words naming a remix/mix/version: those before the keyword, back to
    the start or a credit ("afrojack remix ft pitbull" → afrojack)."""
    before: list[str] = []
    for w in reversed(words[:at]):
        if w in _CREDIT_WORDS:
            break
        before.insert(0, w)
    return before


def _classify_qualifier(inner: str):
    """A set of variant tags, "fold", "credit", or None (part of the title)."""
    words = _rk_words(inner)
    s = " ".join(words)
    if not s:
        return None

    tags: set[str] = set()
    for tag, pat in _VARIANT_PATTERNS:
        if pat.search(s):
            tags.add(tag)
    if m := _TAKE.search(s):
        tags.add(f"take {m.group(1)}")
    if _REMIX.search(s):
        at = next(i for i, w in enumerate(words) if w in ("remix", "remixes", "rmx"))
        tags.add(" ".join([*_phrase(words, at), "remix"]))

    if not tags:
        for noun in ("mix", "version", "ver"):
            if noun not in words:
                continue
            at = words.index(noun)
            before = _phrase(words, at)
            if set(before) & _FOLD_BEFORE or (not before and noun == "version"
                                               and len(words) == 1):
                return "fold"
            if not before:
                before, after = [], words[at + 1:]
                tags.add(" ".join(["version" if noun == "ver" else noun, *after]))
            else:
                tags.add(" ".join([*before, "version" if noun == "ver" else noun]))
            break

    if tags:
        return tags
    if _STRONG_FOLD.search(s) or set(words) <= _WEAK_FOLD:
        return "fold"
    if words[0] in _CREDIT_WORDS:
        return "credit"
    return None


def _strip_dash_tail(base: str, tags: set[str]) -> str:
    """Remove qualifying " - ..." tails, the whole tail first ("- Live at
    Wembley - 1979"), else piece by piece from the right."""
    parts = _DASH_SPLIT.split(base)
    if len(parts) < 2:
        return base
    kind = _classify_qualifier(" ".join(parts[1:]))
    if kind is not None:
        if isinstance(kind, set):
            tags.update(kind)
        return parts[0]
    while len(parts) > 1:
        kind = _classify_qualifier(parts[-1])
        if kind is None:
            break
        if isinstance(kind, set):
            tags.update(kind)
        parts.pop()
    return " - ".join(parts)


def _album_variant(album_name: str) -> set[str]:
    m = re.search(r"[(\[]([^)\]]*)[)\]]\s*$", album_name or "")
    inner = m.group(1) if m else None
    if inner is None:
        parts = _DASH_SPLIT.split(album_name or "")
        inner = parts[-1] if len(parts) > 1 else None
    kind = _classify_qualifier(inner) if inner else None
    return kind if isinstance(kind, set) else set()


def _recording_artist(song_artist: str | None, album_artists: list[str]) -> str:
    credited = [artist_key(a).replace(" ", "") for a in album_artists if a]
    credited = [c for c in credited if c]
    if song_artist and song_artist.strip():
        mine = artist_key(song_artist).replace(" ", "")
        if mine and not any(c in mine or mine in c for c in credited):
            return artist_key(song_artist)
    return artist_key(album_artists[0] if album_artists else (song_artist or ""))
