"""Find a cover for an album copy that has none, and keep looking until one exists.

An import saves whatever cover the picked search result carried, and some carry
none: a record out today is often on MusicBrainz before Deezer or iTunes list
it, and its art reaches the Cover Art Archive hours later. *Dream Fatigue* (Rex
Orange County, November 2026) was imported that way: no cover anywhere at the
time, the Archive's front-500 answering a few hours later. Before this module
nothing ever looked again: the album stayed blank until someone re-imported it
or called a maintenance route by hand. Web's Library asked iTunes alone, and
mobile never asked at all.

So the search runs in three places, all through `fill`:
  - right after an import with no cover (`albums._queue_cover_fill`), in the
    background;
  - daily, for every copy still without one (`worker/fill_covers.py`, in
    .github/workflows/fill-covers.yml), which is what catches art published after
    the import;
  - on web's Library mount (`POST /albums/enrich-covers`), for the caller's own.

Sources, cheapest and most certain first: another user's copy of the same record
(`subject_key`), then Deezer, iTunes, and MusicBrainz + Cover Art Archive. Every
catalog hit is checked with `trackkeys.same_album`, because hanging the wrong
cover on an album is worse than leaving it blank. A cover found for one copy is
written to every coverless copy of the record.
"""
import json
import time

import httpx
from sqlmodel import Session, select

from .models import Album
from .trackkeys import same_album

UA = {"User-Agent": "Pressd/1.0 (music-rating-app)"}
# md5(""): Deezer's "no picture", served as if it were one.
DEEZER_NO_IMAGE = "d41d8cd98f00b204e9800998ecf8427e"
CAA = "https://coverartarchive.org"


def _artists(album: Album) -> list[str]:
    names = [album.artist or ""]
    if album.extra_artists:
        try:
            names += [a for a in json.loads(album.extra_artists) if isinstance(a, str)]
        except (json.JSONDecodeError, TypeError):
            pass
    return [n for n in names if n]


def _matches(album: Album, got_name: str, got_artist: str) -> bool:
    return any(same_album(album.album_name, a, got_name or "", got_artist or "") for a in _artists(album))


def _from_copies(session: Session, album: Album) -> str | None:
    if not album.subject_key:
        return None
    return session.exec(
        select(Album.album_art_url)
        .where(Album.subject_key == album.subject_key)
        .where(Album.id != album.id)
        .where(Album.album_art_url.is_not(None))
        .where(Album.album_art_url != "")
        .limit(1)
    ).first()


def _deezer(client: httpx.Client, album: Album) -> str | None:
    r = client.get(
        "https://api.deezer.com/search/album",
        params={"q": f'artist:"{album.artist}" album:"{album.album_name}"', "limit": 10},
    )
    # Deezer rate-limits with a 200 and an error body; that is a miss here, and
    # the next pass tries again.
    for a in (r.json().get("data") or []) if r.is_success else []:
        url = a.get("cover_xl") or a.get("cover_big")
        if url and DEEZER_NO_IMAGE not in url and _matches(album, a.get("title"), (a.get("artist") or {}).get("name")):
            return url
    return None


def _itunes(client: httpx.Client, album: Album) -> str | None:
    # Album and artist first; the album alone catches a joined credit that
    # breaks the search term, which the match below still has to accept.
    for term in (f"{album.album_name} {album.artist}", album.album_name):
        r = client.get("https://itunes.apple.com/search", params={"term": term, "entity": "album", "limit": 10})
        for a in (r.json().get("results") or []) if r.is_success else []:
            raw = a.get("artworkUrl100") or ""
            if raw and _matches(album, a.get("collectionName"), a.get("artistName")):
                return raw.replace("100x100bb", "1000x1000bb")
    return None


def _musicbrainz(client: httpx.Client, album: Album) -> str | None:
    r = client.get(
        "https://musicbrainz.org/ws/2/release-group/",
        params={"query": f'releasegroup:"{album.album_name}" AND artist:"{album.artist}"', "fmt": "json", "limit": 3},
    )
    if not r.is_success:
        return None
    for g in r.json().get("release-groups") or []:
        credit = (g.get("artist-credit") or [{}])[0].get("name", "")
        if not g.get("id") or not _matches(album, g.get("title"), credit):
            continue
        time.sleep(1)  # MusicBrainz asks for one request a second
        # The 500px thumbnail, stored at the Archive machine it redirects to,
        # as search.py's resolve stores it (CLAUDE.md, covers).
        # A GET for the image itself, not a HEAD: on the day a cover is uploaded
        # the Archive knows it (a redirect) before its machine can serve it (a
        # 500 there), and only a real image is worth storing — the next pass
        # tries again.
        with client.stream("GET", f"{CAA}/release-group/{g['id']}/front-500", follow_redirects=True, timeout=15) as art:
            if art.status_code == 200 and art.headers.get("content-type", "").startswith("image/"):
                return str(art.url)
    return None


def find(session: Session, client: httpx.Client, album: Album) -> str | None:
    """The first cover any source has for this copy, or None."""
    url = _from_copies(session, album)
    if url:
        return url
    for source in (_deezer, _itunes, _musicbrainz):
        try:
            url = source(client, album)
        except Exception as e:  # one source down mustn't stop the next
            print(f"[covers] {source.__name__} failed for album {album.id}: {type(e).__name__}: {e}")
            continue
        if url:
            return url
    return None


def fill(session: Session, albums: list[Album]) -> dict:
    """Look for a cover for each coverless album and store what's found.

    Commits after each find, so a long run keeps what it has if it dies, and a
    find is written to every other coverless copy of the record too.
    """
    updated = missing = 0
    done: set[int] = set()
    with httpx.Client(timeout=10, headers=UA) as client:
        for album in albums:
            if album.id in done or album.album_art_url:
                continue
            url = find(session, client, album)
            if not url:
                missing += 1
                continue
            same = [album]
            if album.subject_key:
                same = session.exec(
                    select(Album)
                    .where(Album.subject_key == album.subject_key)
                    .where((Album.album_art_url.is_(None)) | (Album.album_art_url == ""))
                ).all() or [album]
            for copy in same:
                copy.album_art_url = url
                session.add(copy)
                done.add(copy.id)
                updated += 1
            session.commit()
    return {"updated": updated, "missing": missing}


def coverless(session: Session, user_id: int | None = None) -> list[Album]:
    """Copies with no cover, newest first: a new release is the likeliest to
    have gained art since the last look."""
    q = select(Album).where((Album.album_art_url.is_(None)) | (Album.album_art_url == ""))
    if user_id is not None:
        q = q.where(Album.user_id == user_id)
    return list(session.exec(q.order_by(Album.created_at.desc().nulls_last(), Album.id.desc())).all())
