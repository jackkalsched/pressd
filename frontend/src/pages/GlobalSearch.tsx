// Search Pressd: people, records, artists and songs in one call (GET /search/all),
// then the catalogs' albums that Pressd doesn't have yet — mobile's app/search.tsx,
// laid out wide. Opened from the icon on For You; Esc or Cancel goes back.
//
// Before typing it shows this account's last few opened results, kept in
// localStorage under recentKey(user id) and removed at sign-out (UserContext).
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Music, Plus, Search, Star, X } from 'lucide-react'
import { pushRecent, recentKey, songTarget, type RecentItem } from '@pressd/shared/recentSearches'
import { fetchArtistImage, importAlbum, resolveAlbum, searchAll, searchKnown } from '../api'
import type { AlbumSearchResult } from '../api'
import type { SearchAlbum, SearchArtist, SearchGroup, SearchPerson, SearchResults, SearchSong } from '../types'
import { songScoreColor } from '../types'
import { useAlbumSearch } from '../hooks/useAlbumSearch'
import { useUser } from '../context/UserContext'
import { SECTION_LABEL } from '../components/albumView'
import Avatar from '../components/Avatar'
import CoverImg from '../components/CoverImg'
import TracklistLoader from '../components/TracklistLoader'
import VinylSpinner from '../components/VinylSpinner'
import { stagger } from '../lib/format'

const SHOWN = 4
const LEAD = 40

/** What a row opens. Stored with each recent search, so only plain values. */
type Target =
  | { kind: 'person'; id: number }
  | { kind: 'album'; albumId: number; community: boolean; track?: number }
  | { kind: 'artist'; name: string }
  | { kind: 'catalog'; album_name: string; artist: string; deezer: string | null }

const STATUS_LABEL = { listening: 'Listening', to_listen: 'To Listen' } as const

function useDebounced(value: string, ms: number): string {
  const [out, setOut] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setOut(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return out
}

function readRecents(userId: number | undefined): RecentItem[] {
  if (userId == null) return []
  try {
    const raw = localStorage.getItem(recentKey(userId))
    const list: unknown = raw ? JSON.parse(raw) : []
    return Array.isArray(list) ? (list as RecentItem[]) : []
  } catch {
    return []
  }
}

function writeRecents(userId: number | undefined, list: RecentItem[]) {
  if (userId == null) return
  try {
    if (list.length) localStorage.setItem(recentKey(userId), JSON.stringify(list))
    else localStorage.removeItem(recentKey(userId))
  } catch { /* best effort */ }
}

function hrefFor(t: Target): string {
  switch (t.kind) {
    case 'person':
      return `/u/${t.id}`
    case 'album': {
      const base = t.community ? `/album/${t.albumId}/community` : `/album/${t.albumId}`
      return t.track != null ? `${base}?track=${t.track}` : base
    }
    case 'artist':
      return `/artist/${encodeURIComponent(t.name)}?mode=pressd`
    case 'catalog': {
      // Look before you commit: the record's Pressd page by name, which may not
      // exist on Pressd yet — the Deezer id lets it resolve a tracklist.
      const p = new URLSearchParams({ name: t.album_name, artist: t.artist })
      if (t.deezer) p.set('deezer', t.deezer)
      return `/album/community?${p}`
    }
  }
}

function catalogKey(r: AlbumSearchResult): string {
  return `${r.source}:${r.source_id}`
}

function hitKey(r: { album_name: string; artist: string }): string {
  return `${r.album_name}|${r.artist}`
}

export default function GlobalSearch() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { activeUser } = useUser()
  const userId = activeUser?.id

  const [query, setQuery] = useState('')
  const q = useDebounced(query.trim(), 200)
  const active = q.length >= 2

  function leave() {
    if (window.history.state?.idx > 0) navigate(-1)
    else navigate('/for-you')
  }

  // ── Recent searches ──
  // Read synchronously, so nothing tapped before the read can be overwritten by it.
  const [recents, setRecents] = useState<RecentItem[]>(() => readRecents(userId))
  const [recentsFor, setRecentsFor] = useState(userId)
  if (recentsFor !== userId) {
    setRecentsFor(userId)
    setRecents(readRecents(userId))
  }
  function saveRecents(next: RecentItem[]) {
    setRecents(next)
    writeRecents(userId, next)
  }
  function open(item: RecentItem) {
    saveRecents(pushRecent(recents, item))
    navigate(hrefFor(item.target as Target))
  }

  // ── Pressd ──
  const { data: results, isLoading, isError, isPlaceholderData, isFetching } = useQuery({
    queryKey: ['search', userId, q],
    queryFn: () => searchAll(q),
    enabled: active && userId != null,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  })
  // See all: one group re-asked for its full list, shown in place of its four.
  const [expanded, setExpanded] = useState<SearchGroup | 'catalog' | null>(null)
  const [cursor, setCursor] = useState(-1)
  const [expandedFor, setExpandedFor] = useState(q)
  if (expandedFor !== q) {
    setExpandedFor(q)
    setExpanded(null)
    setCursor(-1)
  }
  const pressdGroup = expanded && expanded !== 'catalog' ? expanded : null
  const { data: full, isFetching: fullLoading } = useQuery({
    queryKey: ['search', userId, q, pressdGroup],
    queryFn: () => searchAll(q, pressdGroup!),
    enabled: active && pressdGroup != null && userId != null,
    staleTime: 30_000,
  })

  function rows<G extends SearchGroup>(g: G): { list: SearchResults[G]; more: boolean } {
    const base: SearchResults[G] = results?.[g] ?? ([] as SearchResults[G])
    if (expanded === g && full) return { list: full[g], more: false }
    return { list: base.slice(0, SHOWN) as SearchResults[G], more: base.length > SHOWN }
  }

  // ── The catalogs, minus what Pressd already has ──
  const { results: catalogHits, searching: catalogSearching } = useAlbumSearch(active ? query : '')
  // Whether Pressd has each catalog hit, by name and artist, kept for the page's
  // life. The hook answers twice per query (iTunes + Deezer, then MusicBrainz
  // merged in), so the check runs only for hits not yet asked about, and rows
  // already cleared stay put while it does.
  const [verdicts, setVerdicts] = useState<Map<string, boolean>>(() => new Map())
  const unchecked = useMemo(() => {
    const seen = new Set<string>()
    const out: { name: string; artist: string }[] = []
    for (const r of catalogHits) {
      const k = hitKey(r)
      if (verdicts.has(k) || seen.has(k)) continue
      seen.add(k)
      out.push({ name: r.album_name, artist: r.artist })
    }
    return out
  }, [catalogHits, verdicts])
  const { isError: knownFailed } = useQuery({
    queryKey: ['search-known', unchecked],
    queryFn: async () => {
      const known = await searchKnown(unchecked)
      const have = new Set(known.map((k) => k.index))
      setVerdicts((prev) => {
        const next = new Map(prev)
        unchecked.forEach((u, i) => next.set(`${u.name}|${u.artist}`, have.has(i)))
        return next
      })
      return known
    },
    enabled: active && unchecked.length > 0,
    retry: false,
  })
  // A hit not yet checked is held back, so a record Pressd has doesn't flash in
  // and out; if the check fails, it's shown.
  const fresh = useMemo(
    () =>
      catalogHits.filter((r) => {
        const v = verdicts.get(hitKey(r))
        return v === undefined ? knownFailed : !v
      }),
    [catalogHits, verdicts, knownFailed],
  )
  const catalogPending = active && (catalogSearching || (unchecked.length > 0 && !knownFailed))
  const catalogShown = expanded === 'catalog' ? fresh : fresh.slice(0, SHOWN)

  // ── Rate now / Add to library on a catalog row, as Add an album does ──
  const [picked, setPicked] = useState<AlbumSearchResult | null>(null)
  const [pickError, setPickError] = useState<string | null>(null)
  const [shelved, setShelved] = useState<string[]>([])
  async function pick(r: AlbumSearchResult, mode: 'rate' | 'shelve') {
    if (picked || userId == null) return
    saveRecents(pushRecent(recents, catalogItem(r)))
    setPicked(r)
    setPickError(null)
    try {
      const resolved = await resolveAlbum(r)
      const album = await importAlbum(resolved, mode === 'rate' ? 'listening' : 'to_listen', userId)
      queryClient.invalidateQueries({ queryKey: ['albums'] })
      if (mode === 'rate') {
        navigate(`/rate/${album.id}`, { replace: true })
        return
      }
      setShelved((s) => [...s, catalogKey(r)])
      setPicked(null)
    } catch {
      setPickError('Could not load that album. Try another result.')
      setPicked(null)
    }
  }

  // ── What's on screen, in reading order, for the arrow keys ──
  const people = rows('people')
  const albums = rows('albums')
  const artists = rows('artists')
  const songs = rows('songs')
  const answered = results != null && !isPlaceholderData
  const nothingOnPressd =
    answered &&
    results.people.length + results.albums.length + results.artists.length + results.songs.length === 0

  const navItems: RecentItem[] = !active
    ? recents
    : [
        ...people.list.map(personItem),
        ...albums.list.map(albumItem),
        ...artists.list.map(artistItem),
        ...songs.list.map(songItem),
        ...catalogShown.map(catalogItem),
      ]
  const navIndex = (item: RecentItem) => navItems.findIndex((n) => n.kind === item.kind && n.key === item.key)
  const lit = cursor >= 0 && cursor < navItems.length ? cursor : -1

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (navItems.length === 0) return
      e.preventDefault()
      const next = e.key === 'ArrowDown'
        ? Math.min(lit + 1, navItems.length - 1)
        : Math.max(lit - 1, -1)
      setCursor(next)
      if (next >= 0) {
        requestAnimationFrame(() => {
          document.querySelector(`[data-nav="${next}"]`)?.scrollIntoView({ block: 'nearest' })
        })
      }
    } else if (e.key === 'Enter' && lit >= 0 && !picked) {
      e.preventDefault()
      open(navItems[lit])
    }
  }

  // Esc leaves from anywhere on the page, not only the field — but not while a
  // catalog pick is importing.
  const leaveRef = useRef<() => void>(leave)
  useEffect(() => {
    leaveRef.current = picked ? () => {} : leave
  })
  useEffect(() => {
    function onKey(e: globalThis.KeyboardEvent) {
      if (e.key === 'Escape') leaveRef.current()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  function seeAll(g: SearchGroup | 'catalog') {
    setExpanded(expanded === g ? null : g)
    setCursor(-1)
  }

  function head(label: string, g: SearchGroup | 'catalog', more: boolean, pending = false) {
    const isOpen = expanded === g
    return (
      <div className="mb-1.5 flex min-h-6 items-center justify-between">
        <p className={SECTION_LABEL}>{label}</p>
        {pending ? (
          <VinylSpinner size={18} />
        ) : more || isOpen ? (
          <button
            type="button"
            onClick={() => seeAll(g)}
            className="text-[12.5px] font-semibold text-(--c-2d6a4f) hover:text-(--c-245c43)"
          >
            {isOpen ? 'Show less' : 'See all'}
          </button>
        ) : null}
      </div>
    )
  }

  const rowProps = (item: RecentItem) => {
    const i = navIndex(item)
    return { nav: i, highlighted: i === lit, onOpen: () => open(item), onHover: () => setCursor(i) }
  }

  return (
    <div className="min-h-screen bg-(--c-f9f8f6) text-(--c-1c1917)">
      <div className="mx-auto w-full max-w-[1600px] px-6 md:px-12 py-8 pb-24">
        <div className="flex items-center gap-4">
          <div className="relative flex-1">
            <Search size={17} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-(--c-a8998a)" />
            <input
              autoFocus
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="Search Pressd"
              autoComplete="off"
              spellCheck={false}
              aria-label="Search Pressd"
              className="h-12 w-full rounded-xl border border-(--c-e2dbd0) bg-(--c-fff) pl-11 pr-11 text-[15px] text-(--c-1c1917) transition-colors placeholder:text-(--c-a8998a) focus:border-(--c-2d6a4f) focus:outline-none"
            />
            <div className="absolute right-3.5 top-1/2 flex -translate-y-1/2 items-center">
              {active && isFetching ? (
                <VinylSpinner size={18} />
              ) : query.length > 0 ? (
                <button
                  type="button"
                  onClick={() => setQuery('')}
                  aria-label="Clear search"
                  className="p-1 text-(--c-a8998a) hover:text-(--c-57534e)"
                >
                  <X size={16} />
                </button>
              ) : null}
            </div>
          </div>
          <button
            type="button"
            onClick={leave}
            className="text-[14px] font-medium text-(--c-8a7f72) hover:text-(--c-1c1917)"
          >
            Cancel
          </button>
        </div>

        {!active ? (
          recents.length > 0 && (
            <section className="mt-8 max-w-xl">
              <div className="mb-1.5 flex min-h-6 items-center justify-between">
                <p className={SECTION_LABEL}>RECENT</p>
                <button
                  type="button"
                  onClick={() => { saveRecents([]); setCursor(-1) }}
                  className="text-[12.5px] font-semibold text-(--c-2d6a4f) hover:text-(--c-245c43)"
                >
                  Clear
                </button>
              </div>
              <ul className="m-0 -mx-3 list-none p-0">
                {recents.map((r, i) => (
                  <Row key={`${r.kind}:${r.key}`} index={i} {...rowProps(r)} lead={<RecentLead item={r} />} title={r.label} sub={r.sub} />
                ))}
              </ul>
            </section>
          )
        ) : (
          <>
            {isLoading && !results && (
              <div className="mt-16 flex justify-center">
                <VinylSpinner size={44} />
              </div>
            )}
            {isError && !isPlaceholderData && !results && (
              <p className="mt-10 text-center text-[14px] text-(--c-8a7f72)">Search isn&rsquo;t answering. Try again.</p>
            )}
            {nothingOnPressd && (
              <p className="mt-10 text-center text-[14px] text-(--c-8a7f72)">Nothing on Pressd matches &ldquo;{q}&rdquo;.</p>
            )}

            <div className="mt-8 grid grid-cols-1 gap-x-10 gap-y-8 md:grid-cols-2 lg:grid-cols-4">
              {people.list.length > 0 && (
                <section className="min-w-0">
                  {head('PEOPLE', 'people', people.more, expanded === 'people' && fullLoading)}
                  <ul className="m-0 -mx-3 list-none p-0">
                    {people.list.map((p, i) => (
                      <Row
                        key={p.id}
                        index={i}
                        {...rowProps(personItem(p))}
                        lead={<Avatar name={p.name} avatarUrl={p.avatar_url} size={LEAD} />}
                        title={p.name}
                        sub={p.already_friends ? 'Friends' : undefined}
                      />
                    ))}
                  </ul>
                </section>
              )}

              {albums.list.length > 0 && (
                <section className="min-w-0">
                  {head('ALBUMS', 'albums', albums.more, expanded === 'albums' && fullLoading)}
                  <ul className="m-0 -mx-3 list-none p-0">
                    {albums.list.map((a, i) => (
                      <Row
                        key={a.albumId}
                        index={i}
                        {...rowProps(albumItem(a))}
                        lead={<CoverLead url={a.artUrl} />}
                        title={a.name}
                        sub={
                          a.mine || a.raters === 0
                            ? a.artist
                            : `${a.artist} · ${a.raters} ${a.raters === 1 ? 'rater' : 'raters'}`
                        }
                        trailing={<AlbumScore album={a} />}
                      />
                    ))}
                  </ul>
                </section>
              )}

              {artists.list.length > 0 && (
                <section className="min-w-0">
                  {head('ARTISTS', 'artists', artists.more, expanded === 'artists' && fullLoading)}
                  <ul className="m-0 -mx-3 list-none p-0">
                    {artists.list.map((a, i) => (
                      <Row
                        key={a.name}
                        index={i}
                        {...rowProps(artistItem(a))}
                        lead={<ArtistLead name={a.name} />}
                        title={a.name}
                        sub={recordsLabel(a.records)}
                      />
                    ))}
                  </ul>
                </section>
              )}

              {songs.list.length > 0 && (
                <section className="min-w-0">
                  {head('SONGS', 'songs', songs.more, expanded === 'songs' && fullLoading)}
                  <ul className="m-0 -mx-3 list-none p-0">
                    {songs.list.map((s, i) => (
                      <Row
                        key={s.trackId}
                        index={i}
                        {...rowProps(songItem(s))}
                        lead={<CoverLead url={s.artUrl} />}
                        title={s.title}
                        sub={`${s.albumName} · ${s.artist}`}
                      />
                    ))}
                  </ul>
                </section>
              )}
            </div>

            {(catalogPending || fresh.length > 0) && (
              <section className="mt-10">
                {head('FROM THE CATALOGS', 'catalog', fresh.length > SHOWN, catalogPending)}
                {pickError && <p className="m-0 mb-1.5 text-[13px] text-(--c-c0392b)">{pickError}</p>}
                <ul className="m-0 -mx-3 grid list-none grid-cols-1 gap-x-10 p-0 md:grid-cols-2">
                  {catalogShown.map((r, i) => {
                    const done = shelved.includes(catalogKey(r))
                    return (
                      <Row
                        key={catalogKey(r)}
                        index={i}
                        {...rowProps(catalogItem(r))}
                        lead={<CoverLead url={r.cover_url} />}
                        title={r.album_name}
                        sub={`${r.artist}${r.year ? ` · ${r.year}` : ''}`}
                        trailing={
                          <div className="flex shrink-0 gap-2">
                            <button
                              type="button"
                              onClick={() => pick(r, 'rate')}
                              aria-label={`Rate ${r.album_name} now`}
                              className="flex h-8 items-center gap-1.5 rounded-lg bg-(--c-2d6a4f)/10 px-3 text-[12.5px] font-semibold text-(--c-2d6a4f) transition-colors hover:bg-(--c-2d6a4f)/[0.16]"
                            >
                              <Star size={13} strokeWidth={2.4} /> Rate now
                            </button>
                            <button
                              type="button"
                              onClick={() => pick(r, 'shelve')}
                              disabled={done}
                              aria-label={`Add ${r.album_name} to library`}
                              className={`flex h-8 items-center gap-1.5 rounded-lg px-3 text-[12.5px] font-semibold transition-colors ${
                                done
                                  ? 'bg-(--c-f2eee7) text-(--c-2d6a4f)'
                                  : 'bg-(--c-2d6a4f)/10 text-(--c-2d6a4f) hover:bg-(--c-2d6a4f)/[0.16]'
                              }`}
                            >
                              {done ? <Check size={13} strokeWidth={2.6} className="pop" /> : <Plus size={13} strokeWidth={2.6} />}
                              {done ? 'Added' : 'Add'}
                            </button>
                          </div>
                        }
                      />
                    )
                  })}
                </ul>
              </section>
            )}
          </>
        )}
      </div>

      {picked && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/30 backdrop-blur-sm fade-in" />
          <div className="relative mx-4 w-full max-w-sm rounded-2xl border border-(--c-e2e2e2) bg-(--c-fff) p-6 shadow-xl pop-in">
            <TracklistLoader albumName={picked.album_name} artist={picked.artist} coverUrl={picked.cover_url} />
          </div>
        </div>
      )}
    </div>
  )
}

// ── What each result stores as a recent search ──

function personItem(p: SearchPerson): RecentItem {
  return {
    kind: 'person',
    key: String(p.id),
    label: p.name,
    artUrl: p.avatar_url ?? null,
    target: { kind: 'person', id: p.id } satisfies Target,
  }
}

function albumItem(a: SearchAlbum): RecentItem {
  return {
    kind: 'album',
    key: String(a.albumId),
    label: a.name,
    sub: a.artist,
    artUrl: a.artUrl,
    target: { kind: 'album', albumId: a.albumId, community: !a.mine } satisfies Target,
  }
}

function artistItem(a: SearchArtist): RecentItem {
  return {
    kind: 'artist',
    key: a.name.toLowerCase(),
    label: a.name,
    sub: recordsLabel(a.records),
    target: { kind: 'artist', name: a.name } satisfies Target,
  }
}

function songItem(s: SearchSong): RecentItem {
  const t = songTarget(s)
  const target: Target = t.kind === 'community'
    ? { kind: 'album', albumId: t.albumId, community: true, track: t.highlight }
    : { kind: 'album', albumId: t.albumId, community: false, ...(t.highlight != null ? { track: t.highlight } : {}) }
  return {
    kind: 'song',
    key: String(s.trackId),
    label: s.title,
    sub: `${s.albumName} · ${s.artist}`,
    artUrl: s.artUrl,
    target,
  }
}

function catalogItem(r: AlbumSearchResult): RecentItem {
  return {
    kind: 'catalog',
    key: catalogKey(r),
    label: r.album_name,
    sub: r.artist,
    artUrl: r.cover_url,
    target: {
      kind: 'catalog',
      album_name: r.album_name,
      artist: r.artist,
      deezer: r.source === 'deezer' ? r.source_id : null,
    } satisfies Target,
  }
}

function recordsLabel(n: number): string {
  return `${n} ${n === 1 ? 'record' : 'records'}`
}

// ── Rows ──

function Row({
  index, nav, highlighted, onOpen, onHover, lead, title, sub, trailing,
}: {
  index: number
  nav: number
  highlighted: boolean
  onOpen: () => void
  onHover: () => void
  lead: ReactNode
  title: string
  sub?: string
  trailing?: ReactNode
}) {
  return (
    <li
      data-nav={nav}
      onMouseEnter={onHover}
      className={`rise-in flex min-w-0 items-center gap-3 rounded-xl px-3 py-2 transition-colors ${highlighted ? 'bg-(--c-f2eee7)' : ''}`}
      style={stagger(index)}
    >
      <button type="button" onClick={onOpen} className="flex min-w-0 flex-1 items-center gap-3 text-left">
        {lead}
        <div className="min-w-0 flex-1">
          {/* Add an album's result-row type, for every row here. */}
          <p className="m-0 truncate text-sm font-medium leading-snug text-(--c-111)">{title}</p>
          {sub ? <p className="m-0 truncate text-xs text-(--c-aaa)">{sub}</p> : null}
        </div>
      </button>
      {trailing}
    </li>
  )
}

function AlbumScore({ album }: { album: SearchAlbum }) {
  // Your own copy says where it is; everyone else's says what the room thinks.
  if (album.mine && album.status !== 'rated') {
    return (
      <span className="shrink-0 text-[12px] font-semibold text-(--c-2d6a4f)">
        {STATUS_LABEL[album.status as 'listening' | 'to_listen']}
      </span>
    )
  }
  const score = album.mine ? album.yourScore : album.pressdAvg
  if (score == null) return null
  return (
    <div className="flex shrink-0 flex-col items-end">
      <span className="font-display text-[17px] font-bold leading-none tabular-nums" style={{ color: songScoreColor(score) }}>
        {score.toFixed(2)}
      </span>
      <span className="mt-1 text-[9px] font-bold tracking-[0.08em] text-(--c-a8998a)">
        {album.mine ? 'YOURS' : 'PRESSD AVG'}
      </span>
    </div>
  )
}

function CoverLead({ url }: { url: string | null | undefined }) {
  if (url) {
    return <CoverImg url={url} displayPx={LEAD} alt="" className="h-10 w-10 shrink-0 rounded-md object-cover" />
  }
  return (
    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-(--c-e8e2d9)">
      <Music size={14} className="text-(--c-b0a090)" />
    </div>
  )
}

/** The artist's photo, from the same cache the artist page reads. */
function ArtistLead({ name }: { name: string }) {
  const { data: image } = useQuery({
    queryKey: ['artist-image', name],
    queryFn: () => fetchArtistImage(name),
    enabled: !!name,
    staleTime: Infinity,
  })
  if (image) {
    return <img src={image} alt="" className="h-10 w-10 shrink-0 rounded-full object-cover" />
  }
  return <Avatar name={name} size={LEAD} />
}

function RecentLead({ item }: { item: RecentItem }) {
  if (item.kind === 'person') return <Avatar name={item.label} avatarUrl={item.artUrl} size={LEAD} />
  if (item.kind === 'artist') return <ArtistLead name={item.label} />
  return <CoverLead url={item.artUrl} />
}
