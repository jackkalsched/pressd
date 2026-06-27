import { useState, useMemo } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { fetchAlbums, fetchScatterData, fetchArtistStats } from '../api'
import { useUser } from '../context/UserContext'
import { Loader2, Music } from 'lucide-react'

// ── Album table ───────────────────────────────────────────────────────────────

type AlbumSortKey = 'score' | 'year' | 'artist' | 'albumName' | 'theme' | 'replayValue' | 'production' | 'distinctness'

// ── Artist rankings table (moved from Stats) ──────────────────────────────────

type ArtistSortKey = 'song_score' | 'external' | 'w_song_plus' | 'consistency_plus' | 'bang_pct' | 'skip_pct'

interface RankingRow {
  artist: string
  songs: number
  songScore: number | null
  external: number | null
  wSongPlus: number | null
  consistencyPlus: number | null
  bangPct: number | null
  skipPct: number | null
}

const QUALIFIED = 15

function ArtistRankingsTable({
  scatter,
  artistStats,
  scatterPrev,
  artistStatsPrev,
  navigate,
}: {
  scatter: Awaited<ReturnType<typeof fetchScatterData>>
  artistStats: Awaited<ReturnType<typeof fetchArtistStats>>
  scatterPrev?: Awaited<ReturnType<typeof fetchScatterData>>
  artistStatsPrev?: Awaited<ReturnType<typeof fetchArtistStats>>
  navigate: (path: string) => void
}) {
  const [sortKey, setSortKey] = useState<ArtistSortKey>('song_score')

  const buildRows = (sc: typeof scatter, stats: typeof artistStats): RankingRow[] => {
    const artistMap = new Map(stats.map(a => [a.artist, a]))
    return sc.points
      .filter(p => p.song_count >= QUALIFIED)
      .map(p => {
        const a = artistMap.get(p.artist)
        return {
          artist: p.artist,
          songs: p.song_count,
          songScore: p.avg_song_score,
          external: p.avg_external ?? null,
          wSongPlus: p.w_song_plus ?? null,
          consistencyPlus: p.consistency_plus ?? null,
          bangPct: a ? a.bangPct : null,
          skipPct: a ? a.skipPct : null,
        }
      })
  }

  const rows = useMemo<RankingRow[]>(() => buildRows(scatter, artistStats), [scatter, artistStats])
  const rowsPrev = useMemo<RankingRow[]>(
    () => scatterPrev && artistStatsPrev ? buildRows(scatterPrev, artistStatsPrev) : [],
    [scatterPrev, artistStatsPrev],
  )

  const getSortVal = (r: RankingRow, key: ArtistSortKey): number => {
    if (key === 'song_score')       return r.songScore ?? -Infinity
    if (key === 'external')         return r.external ?? -Infinity
    if (key === 'w_song_plus')      return r.wSongPlus ?? -Infinity
    if (key === 'consistency_plus') return r.consistencyPlus ?? -Infinity
    if (key === 'bang_pct')         return r.bangPct ?? -Infinity
    if (key === 'skip_pct')         return -(r.skipPct ?? Infinity)
    return 0
  }

  const sorted = useMemo(
    () => [...rows].sort((a, b) => getSortVal(b, sortKey) - getSortVal(a, sortKey)),
    [rows, sortKey],
  )

  const prevRankMap = useMemo<Map<string, number>>(() => {
    const m = new Map<string, number>()
    const sortedPrev = [...rowsPrev].sort((a, b) => getSortVal(b, sortKey) - getSortVal(a, sortKey))
    sortedPrev.forEach((r, i) => m.set(r.artist, i + 1))
    return m
  }, [rowsPrev, sortKey])

  const recentlyActive = useMemo<Set<string>>(() => {
    const prevSongs = new Map(rowsPrev.map(r => [r.artist, r.songs]))
    return new Set(rows.filter(r => {
      const prev = prevSongs.get(r.artist)
      return prev === undefined || r.songs > prev
    }).map(r => r.artist))
  }, [rows, rowsPrev])

  if (sorted.length === 0) return (
    <div className="flex items-center justify-center py-24 text-[#a8998a] text-sm">
      No artists with {QUALIFIED}+ rated songs yet.
    </div>
  )

  const cols: { key: ArtistSortKey; label: string; fmt: (r: RankingRow) => string }[] = [
    { key: 'song_score',       label: 'Song Score', fmt: r => r.songScore?.toFixed(2) ?? '—' },
    { key: 'external',         label: 'External',   fmt: r => r.external?.toFixed(2) ?? '—' },
    { key: 'w_song_plus',      label: 'wSong+',     fmt: r => r.wSongPlus?.toFixed(1) ?? '—' },
    { key: 'consistency_plus', label: 'Consist+',   fmt: r => r.consistencyPlus?.toFixed(1) ?? '—' },
    { key: 'bang_pct',         label: 'Bang%',      fmt: r => r.bangPct != null ? `${Math.round(r.bangPct * 100)}%` : '—' },
    { key: 'skip_pct',         label: 'Skip%',      fmt: r => r.skipPct != null ? `${Math.round(r.skipPct * 100)}%` : '—' },
  ]

  return (
    <div className="overflow-x-auto rounded-2xl border border-[#e8e2d9]">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="border-b border-[#e8e2d9] bg-[#f7f3ee]">
            <th className="text-left text-[10px] font-semibold text-[#a8998a] uppercase tracking-[0.1em] px-4 py-3 w-10">Rk.</th>
            <th className="text-left text-[10px] font-semibold text-[#a8998a] uppercase tracking-[0.1em] px-4 py-3">Artist</th>
            <th className="text-right text-[10px] font-semibold text-[#a8998a] uppercase tracking-[0.1em] px-4 py-3 w-14">Songs</th>
            {cols.map(c => (
              <th
                key={c.key}
                onClick={() => setSortKey(c.key)}
                className={`text-right text-[10px] font-semibold uppercase tracking-[0.1em] px-4 py-3 w-24 cursor-pointer select-none transition-colors ${
                  sortKey === c.key ? 'text-[#1c1917]' : 'text-[#a8998a] hover:text-[#78716c]'
                }`}
              >
                {c.label}
                {sortKey === c.key && <span className="ml-1 text-[#2d6a4f]">↓</span>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((row, i) => (
            <tr key={row.artist} className="border-b border-[#f0ebe3] last:border-0 hover:bg-[#f7f3ee] transition-colors">
              <td className="text-[#c2b8ad] text-xs tabular-nums px-4 py-2.5">
                <div className="flex items-center gap-1.5">
                  <span>{i + 1}</span>
                  {(() => {
                    const prev = prevRankMap.get(row.artist)
                    if (!recentlyActive.has(row.artist)) return null
                    if (prev === undefined) return <span className="text-[10px] font-bold text-[#3b82f6] bg-blue-50 px-1 py-0.5 rounded">NEW</span>
                    const delta = prev - (i + 1)
                    if (delta > 0) return <span className="text-[10px] font-bold text-[#2d6a4f]">+{delta}</span>
                    if (delta < 0) return <span className="text-[10px] font-bold text-red-400">{delta}</span>
                    return null
                  })()}
                </div>
              </td>
              <td className="px-4 py-2.5">
                <button
                  onClick={() => navigate(`/artist/${encodeURIComponent(row.artist)}`)}
                  className="text-[#1c1917] font-medium hover:text-[#2d6a4f] transition-colors text-left"
                >
                  {row.artist}
                </button>
              </td>
              <td className="text-right text-[#a8998a] tabular-nums px-4 py-2.5 text-xs">{row.songs}</td>
              {cols.map(c => (
                <td
                  key={c.key}
                  className={`text-right tabular-nums px-4 py-2.5 text-xs font-semibold ${
                    sortKey === c.key ? 'text-[#2d6a4f]' : 'text-[#57534e]'
                  }`}
                >
                  {c.fmt(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

type Tab = 'albums' | 'artists'

export default function Ratings() {
  const navigate = useNavigate()
  const { viewingUser } = useUser()
  const userId = viewingUser.id
  const [tab, setTab] = useState<Tab>('albums')
  const [sortKey, setSortKey] = useState<AlbumSortKey>('score')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [search, setSearch] = useState('')

  const sevenDaysAgo = useMemo(() => {
    const d = new Date()
    d.setDate(d.getDate() - 7)
    return d.toISOString().slice(0, 10)
  }, [])

  // Albums tab data
  const { data: albums = [], isLoading: loadingAlbums } = useQuery({
    queryKey: ['albums', 'rated', userId],
    queryFn: () => fetchAlbums({ status: 'rated', userId }),
  })

  // Artists tab data
  const { data: scatter } = useQuery({
    queryKey: ['stats', 'scatter', userId],
    queryFn: () => fetchScatterData(userId),
    staleTime: 5 * 60 * 1000,
    enabled: tab === 'artists',
  })
  const { data: artistStats = [] } = useQuery({
    queryKey: ['stats', 'artists', userId],
    queryFn: () => fetchArtistStats(userId),
    staleTime: 5 * 60 * 1000,
    enabled: tab === 'artists',
  })
  const { data: scatterPrev } = useQuery({
    queryKey: ['stats', 'scatter', userId, sevenDaysAgo],
    queryFn: () => fetchScatterData(userId, sevenDaysAgo),
    staleTime: 60 * 60 * 1000,
    enabled: tab === 'artists',
  })
  const { data: artistStatsPrev = [] } = useQuery({
    queryKey: ['stats', 'artists', userId, sevenDaysAgo],
    queryFn: () => fetchArtistStats(userId, sevenDaysAgo),
    staleTime: 60 * 60 * 1000,
    enabled: tab === 'artists',
  })

  // Album sorting/filtering
  const filtered = albums.filter(
    (a) =>
      a.theme !== null && a.replayValue !== null && a.production !== null && a.distinctness !== null &&
      (a.albumName.toLowerCase().includes(search.toLowerCase()) ||
       a.artist.toLowerCase().includes(search.toLowerCase())),
  )
  const sorted = [...filtered].sort((a, b) => {
    const av = a[sortKey] ?? ''
    const bv = b[sortKey] ?? ''
    if (av < bv) return sortDir === 'asc' ? -1 : 1
    if (av > bv) return sortDir === 'asc' ? 1 : -1
    return 0
  })
  function toggleSort(key: AlbumSortKey) {
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    else { setSortKey(key); setSortDir('desc') }
  }
  const thCls = (key: AlbumSortKey) =>
    `text-left text-[10px] font-semibold uppercase tracking-[0.1em] py-3 px-4 cursor-pointer select-none transition-colors ${
      sortKey === key ? 'text-[#1c1917]' : 'text-[#a8998a] hover:text-[#78716c]'
    }`

  return (
    <div className="min-h-screen bg-[#faf8f5]">
      <div className="p-4 md:p-8">

        {/* Header */}
        <div className="flex items-center justify-between mb-5">
          <h1 className="text-2xl font-bold text-[#1c1917]">Ratings</h1>
          {tab === 'albums' && (
            <span className="text-[#a8998a] text-sm">{sorted.length} albums</span>
          )}
          {tab === 'artists' && (
            <span className="text-[#a8998a] text-sm">≥{QUALIFIED} songs</span>
          )}
        </div>

        {/* Tab bar */}
        <div className="flex border-b border-[#e8e2d9] mb-6">
          {(['albums', 'artists'] as Tab[]).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-4 py-2 text-sm font-medium capitalize transition-colors border-b-2 -mb-px ${
                tab === t
                  ? 'border-[#2d6a4f] text-[#1c1917]'
                  : 'border-transparent text-[#a8998a] hover:text-[#78716c]'
              }`}
            >
              {t === 'albums' ? 'Albums' : 'Artists'}
            </button>
          ))}
        </div>

        {/* Albums tab */}
        {tab === 'albums' && (
          <>
            <input
              type="text"
              placeholder="Search albums or artists…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full max-w-sm bg-[#f0ebe3] border border-[#e8e2d9] text-[#1c1917] text-sm px-4 py-2 rounded-xl focus:outline-none focus:border-[#2d6a4f] transition-colors placeholder:text-[#c2b8ad] mb-6"
            />
            {loadingAlbums ? (
              <div className="flex items-center justify-center py-24 text-[#a8998a] gap-2">
                <Loader2 size={16} className="animate-spin" /> Loading…
              </div>
            ) : (
              <div className="overflow-x-auto rounded-2xl border border-[#e8e2d9]">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-[#e8e2d9] bg-[#f7f3ee]">
                      <th className="text-left text-[10px] font-semibold text-[#a8998a] uppercase tracking-[0.1em] py-3 px-4 w-8">#</th>
                      <th className={thCls('albumName')} onClick={() => toggleSort('albumName')}>
                        Album {sortKey === 'albumName' && <span className="text-[#2d6a4f]">{sortDir === 'desc' ? '↓' : '↑'}</span>}
                      </th>
                      <th className={thCls('artist')} onClick={() => toggleSort('artist')}>
                        Artist {sortKey === 'artist' && <span className="text-[#2d6a4f]">{sortDir === 'desc' ? '↓' : '↑'}</span>}
                      </th>
                      <th className={`${thCls('year')} w-16`} onClick={() => toggleSort('year')}>
                        Year {sortKey === 'year' && <span className="text-[#2d6a4f]">{sortDir === 'desc' ? '↓' : '↑'}</span>}
                      </th>
                      <th
                        className={`text-right text-[10px] font-semibold uppercase tracking-[0.1em] py-3 px-4 w-20 cursor-pointer select-none transition-colors ${sortKey === 'score' ? 'text-[#1c1917]' : 'text-[#a8998a] hover:text-[#78716c]'}`}
                        onClick={() => toggleSort('score')}
                      >
                        Score {sortKey === 'score' && <span className="text-[#2d6a4f]">{sortDir === 'desc' ? '↓' : '↑'}</span>}
                      </th>
                      {(['theme', 'replayValue', 'production', 'distinctness'] as AlbumSortKey[]).map((key, i) => (
                        <th
                          key={key}
                          onClick={() => toggleSort(key)}
                          className={`text-right text-[10px] font-semibold uppercase tracking-[0.1em] py-3 px-4 w-20 cursor-pointer select-none transition-colors ${
                            sortKey === key ? 'text-[#1c1917]' : 'text-[#a8998a] hover:text-[#78716c]'
                          }`}
                        >
                          {['Theme', 'Replay', 'Prod.', 'Dist.'][i]}
                          {sortKey === key && <span className="ml-1 text-[#2d6a4f]">{sortDir === 'desc' ? '↓' : '↑'}</span>}
                        </th>
                      ))}
                      <th className="text-left text-[10px] font-semibold text-[#a8998a] uppercase tracking-[0.1em] py-3 px-4">Genre</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sorted.map((album, i) => (
                      <tr
                        key={album.id}
                        className="border-b border-[#f0ebe3] last:border-0 hover:bg-[#f7f3ee] cursor-pointer transition-colors"
                        onClick={() => navigate(`/album/${album.id}`)}
                      >
                        <td className="py-3 px-4 text-[#c2b8ad] text-sm tabular-nums">{i + 1}</td>
                        <td className="py-3 px-4">
                          <div className="flex items-center gap-3">
                            <div className="w-9 h-9 shrink-0 rounded-lg overflow-hidden bg-gradient-to-br from-[#e8dfd2] to-[#cfc3b0] flex items-center justify-center">
                              {album.albumArtUrl
                                ? <img src={album.albumArtUrl} alt="" className="w-full h-full object-cover" />
                                : <Music size={14} className="text-[#b0a090]" strokeWidth={1.5} />}
                            </div>
                            <span className="text-[#1c1917] text-sm font-medium">{album.albumName}</span>
                          </div>
                        </td>
                        <td className="py-3 px-4 text-sm">
                          {[album.artist, ...album.extraArtists].map((name, j, arr) => (
                            <span key={name}>
                              <Link
                                to={`/artist/${encodeURIComponent(name)}`}
                                onClick={(e) => e.stopPropagation()}
                                className="text-[#78716c] hover:text-[#2d6a4f] transition-colors"
                              >
                                {name}
                              </Link>
                              {j < arr.length - 1 ? ', ' : ''}
                            </span>
                          ))}
                        </td>
                        <td className="py-3 px-4 text-[#78716c] text-sm tabular-nums">{album.year}</td>
                        <td className="py-3 px-4 text-right">
                          <span className="text-[#2d6a4f] font-semibold text-sm tabular-nums">{album.score?.toFixed(2)}</span>
                        </td>
                        <td className="py-3 px-4 text-right text-[#78716c] text-sm tabular-nums">{album.theme ?? '—'}</td>
                        <td className="py-3 px-4 text-right text-[#78716c] text-sm tabular-nums">{album.replayValue ?? '—'}</td>
                        <td className="py-3 px-4 text-right text-[#78716c] text-sm tabular-nums">{album.production ?? '—'}</td>
                        <td className="py-3 px-4 text-right text-[#78716c] text-sm tabular-nums">{album.distinctness ?? '—'}</td>
                        <td className="py-3 px-4 text-[#a8998a] text-xs">{album.genre ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}

        {/* Artists tab */}
        {tab === 'artists' && (
          !scatter ? (
            <div className="flex items-center justify-center py-24 text-[#a8998a] gap-2">
              <Loader2 size={16} className="animate-spin" /> Loading…
            </div>
          ) : (
            <ArtistRankingsTable
              scatter={scatter}
              artistStats={artistStats}
              scatterPrev={scatterPrev}
              artistStatsPrev={artistStatsPrev}
              navigate={navigate}
            />
          )
        )}

      </div>
    </div>
  )
}
