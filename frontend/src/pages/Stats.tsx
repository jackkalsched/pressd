import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { fetchSummary, fetchGenreStats, fetchScatterData, fetchGenreScores, fetchArtistStats } from '../api'
import { useUser } from '../context/UserContext'
import { Loader2 } from 'lucide-react'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  ScatterChart, Scatter, ZAxis, ReferenceLine,
  LineChart, Line, Legend,
} from 'recharts'
import { useNavigate } from 'react-router-dom'

function gaussianKDE(scores: number[], h: number, xs: number[]): number[] {
  const n = scores.length
  if (n === 0) return xs.map(() => 0)
  const bw = h > 0 ? h : 1.06 * Math.sqrt(scores.reduce((s, x) => s + (x - scores.reduce((a, b) => a + b) / n) ** 2, 0) / n) * Math.pow(n, -0.2)
  return xs.map(x => scores.reduce((s, xi) => {
    const u = (x - xi) / bw
    return s + Math.exp(-0.5 * u * u) / Math.sqrt(2 * Math.PI)
  }, 0) / (n * bw))
}

const GENRE_COLORS: Record<string, string> = {
  'Hip-Hop':            '#e07b39',
  'Pop':                '#9b59b6',
  'Rock':               '#e74c3c',
  'R&B':                '#e91e8c',
  'Electronic':         '#3498db',
  'Country':            '#f39c12',
  'Folk':               '#27ae60',
  'Jazz':               '#1abc9c',
  'Latin':              '#e67e22',
  'Classical':          '#7f8c8d',
  'Afrobeats':          '#2ecc71',
  'Funk':               '#d35400',
  'Disco':              '#8e44ad',
  'Singer-Songwriter':  '#16a085',
  'Blues':              '#2980b9',
  'Gospel':             '#c0392b',
}

function genreColor(genre: string | null | undefined): string {
  if (!genre) return '#bbb'
  return GENRE_COLORS[genre] ?? '#bbb'
}

type SortKey = 'song_score' | 'external' | 'w_song_plus' | 'consistency_plus' | 'bang_pct' | 'skip_pct'

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

function ArtistRankingsTable({
  scatter,
  artistStats,
  scatterPrev,
  artistStatsPrev,
  QUALIFIED,
  navigate,
}: {
  scatter: ReturnType<typeof import('../api').fetchScatterData> extends Promise<infer T> ? T : never
  artistStats: Awaited<ReturnType<typeof import('../api').fetchArtistStats>>
  scatterPrev?: ReturnType<typeof import('../api').fetchScatterData> extends Promise<infer T> ? T : never
  artistStatsPrev?: Awaited<ReturnType<typeof import('../api').fetchArtistStats>>
  QUALIFIED: number
  navigate: (path: string) => void
}) {
  const [sortKey, setSortKey] = useState<SortKey>('song_score')

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

  const rows = useMemo<RankingRow[]>(() => buildRows(scatter, artistStats), [scatter, artistStats, QUALIFIED])
  const rowsPrev = useMemo<RankingRow[]>(() => scatterPrev && artistStatsPrev ? buildRows(scatterPrev, artistStatsPrev) : [], [scatterPrev, artistStatsPrev, QUALIFIED])

  const getSortVal = (r: RankingRow, key: SortKey): number => {
    if (key === 'song_score') return r.songScore ?? -Infinity
    if (key === 'external') return r.external ?? -Infinity
    if (key === 'w_song_plus') return r.wSongPlus ?? -Infinity
    if (key === 'consistency_plus') return r.consistencyPlus ?? -Infinity
    if (key === 'bang_pct') return r.bangPct ?? -Infinity
    if (key === 'skip_pct') return -(r.skipPct ?? Infinity)
    return 0
  }

  const sorted = useMemo(() => {
    return [...rows].sort((a, b) => getSortVal(b, sortKey) - getSortVal(a, sortKey))
  }, [rows, sortKey])

  const prevRankMap = useMemo<Map<string, number>>(() => {
    const m = new Map<string, number>()
    const sortedPrev = [...rowsPrev].sort((a, b) => getSortVal(b, sortKey) - getSortVal(a, sortKey))
    sortedPrev.forEach((r, i) => m.set(r.artist, i + 1))
    return m
  }, [rowsPrev, sortKey])

  // Artists with activity in the last 7 days (more songs now than 7 days ago, or brand new)
  const recentlyActive = useMemo<Set<string>>(() => {
    const prevSongs = new Map(rowsPrev.map(r => [r.artist, r.songs]))
    return new Set(rows.filter(r => {
      const prev = prevSongs.get(r.artist)
      return prev === undefined || r.songs > prev
    }).map(r => r.artist))
  }, [rows, rowsPrev])

  if (sorted.length === 0) return null

  const cols: { key: SortKey; label: string; fmt: (r: RankingRow) => string }[] = [
    { key: 'song_score',      label: 'Song Score',    fmt: r => r.songScore?.toFixed(2) ?? '—' },
    { key: 'external',        label: 'External',      fmt: r => r.external?.toFixed(2) ?? '—' },
    { key: 'w_song_plus',     label: 'wSong+',        fmt: r => r.wSongPlus?.toFixed(1) ?? '—' },
    { key: 'consistency_plus',label: 'Consist+',      fmt: r => r.consistencyPlus?.toFixed(1) ?? '—' },
    { key: 'bang_pct',        label: 'Bang%',         fmt: r => r.bangPct != null ? `${Math.round(r.bangPct * 100)}%` : '—' },
    { key: 'skip_pct',        label: 'Skip%',         fmt: r => r.skipPct != null ? `${Math.round(r.skipPct * 100)}%` : '—' },
  ]

  return (
    <div className="mt-6">
      <h2 className="text-sm font-semibold text-[#78716c] mb-4">
        Artist Rankings <span className="text-[#c2b8ad] font-normal">(≥{QUALIFIED} songs)</span>
      </h2>
      <div className="border border-[#e8e2d9] rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
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
                      sortKey === c.key ? 'text-[#1c1917] bg-[#f0ebe3]' : 'text-[#a8998a] hover:text-[#78716c]'
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
                <tr
                  key={row.artist}
                  className="border-b border-[#f0ebe3] last:border-0 hover:bg-[#f7f3ee] transition-colors"
                >
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
                        sortKey === c.key ? 'bg-[#f0ebe3] text-[#2d6a4f]' : 'text-[#57534e]'
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
      </div>
    </div>
  )
}

export default function Stats() {
  const navigate = useNavigate()
  const { viewingUser, isViewingFriend } = useUser()
  const userId = viewingUser?.id ?? 1
  const [genreFilter, setGenreFilter] = useState<string>('all')

  const { data: summary, isLoading: loadingSummary } = useQuery({
    queryKey: ['stats', 'summary', userId],
    queryFn: () => fetchSummary(userId),
  })

  const { data: genres = [], isLoading: loadingGenres } = useQuery({
    queryKey: ['stats', 'genres', userId],
    queryFn: () => fetchGenreStats(userId),
  })

  const { data: scatter } = useQuery({
    queryKey: ['stats', 'scatter', userId],
    queryFn: () => fetchScatterData(userId),
    staleTime: 5 * 60 * 1000,
  })

  const { data: genreScores = [] } = useQuery({
    queryKey: ['stats', 'genre-scores', userId],
    queryFn: () => fetchGenreScores(userId),
    staleTime: 5 * 60 * 1000,
  })

  const { data: artistStats = [] } = useQuery({
    queryKey: ['stats', 'artists', userId],
    queryFn: () => fetchArtistStats(userId),
    staleTime: 5 * 60 * 1000,
  })

  const sevenDaysAgo = useMemo(() => {
    const d = new Date()
    d.setDate(d.getDate() - 7)
    return d.toISOString().slice(0, 10)
  }, [])

  const { data: scatterPrev } = useQuery({
    queryKey: ['stats', 'scatter', userId, sevenDaysAgo],
    queryFn: () => fetchScatterData(userId, sevenDaysAgo),
    staleTime: 60 * 60 * 1000,
  })

  const { data: artistStatsPrev = [] } = useQuery({
    queryKey: ['stats', 'artists', userId, sevenDaysAgo],
    queryFn: () => fetchArtistStats(userId, sevenDaysAgo),
    staleTime: 60 * 60 * 1000,
  })

  const kdeData = useMemo(() => {
    const xs = Array.from({ length: 80 }, (_, i) => parseFloat((1 + i * (9 / 79)).toFixed(2)))
    const curves = genreScores
      .filter(g => g.scores.length >= 3)
      .map(g => {
        const std = Math.sqrt(g.scores.reduce((s, x) => s + (x - g.scores.reduce((a, b) => a + b) / g.scores.length) ** 2, 0) / g.scores.length)
        const bw = 1.06 * (std || 0.5) * Math.pow(g.scores.length, -0.2)
        const ys = gaussianKDE(g.scores, bw, xs)
        return { genre: g.genre, xs, ys }
      })
    return xs.map((x, i) => {
      const pt: Record<string, number> = { x }
      curves.forEach(c => { pt[c.genre] = parseFloat(c.ys[i].toFixed(5)) })
      return pt
    })
  }, [genreScores])

  const QUALIFIED = 15


  if (loadingSummary) {
    return (
      <div className="min-h-screen bg-[#faf8f5] flex items-center justify-center">
        <div className="flex items-center gap-2 text-[#a8998a]">
          <Loader2 size={16} className="animate-spin" />
          <span className="text-sm">Loading…</span>
        </div>
      </div>
    )
  }

  if (!summary) {
    return (
      <div className="min-h-screen bg-[#faf8f5] flex items-center justify-center">
        <p className="text-[#a8998a] text-sm">Failed to load stats — check that the backend is running.</p>
      </div>
    )
  }

  const allGenres = scatter
    ? [...new Set(scatter.points.map((p) => p.genre).filter(Boolean) as string[])].sort()
    : []

  const scatterPoints = scatter
    ? scatter.points.filter(
        (p) => p.avg_external !== null && (genreFilter === 'all' || p.genre === genreFilter),
      )
    : []

  // Recompute means for active filter so quadrant lines shift with genre
  const meanSong = scatterPoints.length
    ? scatterPoints.reduce((s, p) => s + p.avg_song_score, 0) / scatterPoints.length
    : scatter?.mean_song ?? null
  const meanExt = scatterPoints.length
    ? scatterPoints.reduce((s, p) => s + (p.avg_external ?? 0), 0) / scatterPoints.length
    : scatter?.mean_external ?? null

  const panelCls = 'bg-[#f0ebe3] border border-[#e8e2d9] rounded-2xl p-6'
  const cardCls = 'bg-[#f0ebe3] border border-[#e8e2d9] rounded-2xl p-5'
  const labelCls = 'text-[10px] font-semibold text-[#a8998a] uppercase tracking-[0.12em] mb-2'
  const tooltipStyle = { background: '#faf8f5', border: '1px solid #e8e2d9', borderRadius: 12, color: '#1c1917', fontSize: 12 }

  return (
    <div className="min-h-screen bg-[#faf8f5]">
      <div className="p-4 md:p-8">
        <h1 className="text-2xl font-bold text-[#1c1917] mb-8">
          {isViewingFriend ? `${viewingUser?.name}'s Stats` : 'Stats'}
        </h1>

        {/* Summary strip */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-10">
          {[
            { label: 'Albums Rated',   value: summary?.total_albums_rated ?? '—' },
            { label: 'Songs Rated',    value: summary?.total_songs_rated ?? '—' },
            { label: 'Avg Album',      value: summary?.avg_album_score?.toFixed(2) ?? '—' },
            { label: 'Avg Song',       value: summary?.avg_song_score?.toFixed(2) ?? '—' },
            { label: 'Top Album',      value: summary?.top_album?.name ?? '—', small: true },
          ].map(({ label, value, small }) => (
            <div key={label} className={cardCls}>
              <p className={labelCls}>{label}</p>
              <p className={`text-[#1c1917] font-bold ${small ? 'text-base truncate' : 'text-3xl tabular-nums'}`}>{value}</p>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Genre bar chart */}
          <div className={panelCls}>
            <h2 className="text-sm font-semibold text-[#78716c] mb-5">Albums by Genre</h2>
            {loadingGenres ? (
              <div className="flex items-center justify-center h-48 text-[#a8998a]">
                <Loader2 size={14} className="animate-spin" />
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={Math.max(200, genres.length * 28)}>
                <BarChart data={genres} layout="vertical" barSize={14}>
                  <XAxis type="number" tick={{ fill: '#c2b8ad', fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis
                    type="category"
                    dataKey="genre"
                    tick={{ fill: '#78716c', fontSize: 11 }}
                    axisLine={false}
                    tickLine={false}
                    width={100}
                  />
                  <Tooltip contentStyle={tooltipStyle} cursor={{ fill: '#00000006' }} />
                  <Bar dataKey="count" fill="#2d6a4f" radius={[0, 4, 4, 0]} opacity={0.8} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* Top album / top song highlights */}
          <div className="flex flex-col gap-3">
            {summary?.top_album && (
              <div className={cardCls}>
                <p className={labelCls}>Top Album</p>
                <p className="text-[#1c1917] font-semibold text-sm">{summary.top_album.name}</p>
                <p className="text-[#78716c] text-xs mt-0.5">
                  {summary.top_album.artist} · <span className="text-[#2d6a4f] font-semibold">{summary.top_album.score?.toFixed(2)}</span>
                </p>
              </div>
            )}
            {summary?.top_song && (
              <div className={cardCls}>
                <p className={labelCls}>Top Song</p>
                <p className="text-[#1c1917] font-semibold text-sm">{summary.top_song.title}</p>
                <p className="text-[#78716c] text-xs mt-0.5">
                  {summary.top_song.artist} · <span className="text-[#2d6a4f] font-semibold">{summary.top_song.score}</span>
                </p>
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div className={cardCls}>
                <p className={labelCls}>Albums</p>
                <p className="text-[#1c1917] font-bold text-3xl tabular-nums">{summary?.total_albums_rated}</p>
              </div>
              <div className={cardCls}>
                <p className={labelCls}>Songs</p>
                <p className="text-[#1c1917] font-bold text-3xl tabular-nums">{summary?.total_songs_rated}</p>
              </div>
            </div>
          </div>
        </div>

        {/* Genre KDE */}
        {kdeData.length > 0 && (
          <div className={`mt-6 ${panelCls}`}>
            <h2 className="text-sm font-semibold text-[#78716c] mb-1">Score Distribution by Genre</h2>
            <p className="text-[#c2b8ad] text-xs mb-5">Kernel density estimate of average song scores per album</p>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={kdeData} margin={{ left: -20, right: 16, top: 8, bottom: 8 }}>
                <XAxis
                  dataKey="x"
                  type="number"
                  domain={[1, 10]}
                  tickCount={10}
                  tick={{ fill: '#c2b8ad', fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                  label={{ value: 'Avg Song Score', fill: '#c2b8ad', fontSize: 10, position: 'insideBottom', offset: -4 }}
                />
                <YAxis hide />
                <Tooltip
                  contentStyle={tooltipStyle}
                  formatter={(val, name) => [typeof val === 'number' ? val.toFixed(4) : val, name as string]}
                  labelFormatter={(x) => `Score: ${Number(x).toFixed(2)}`}
                />
                <Legend iconType="plainline" iconSize={16} wrapperStyle={{ fontSize: 11, paddingTop: 12 }} />
                {genreScores.filter(g => g.scores.length >= 3).map(g => (
                  <Line
                    key={g.genre}
                    type="monotone"
                    dataKey={g.genre}
                    stroke={genreColor(g.genre)}
                    strokeWidth={2}
                    dot={false}
                    activeDot={{ r: 3 }}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* Scatter */}
        <div className={`mt-6 ${panelCls}`}>
          <div className="flex items-center justify-between mb-5">
            <div>
              <h2 className="text-sm font-semibold text-[#78716c]">Song Score vs External Factors — All Artists</h2>
              <p className="text-[#c2b8ad] text-xs mt-0.5">Click an artist to view their page</p>
            </div>
            <select
              value={genreFilter}
              onChange={(e) => setGenreFilter(e.target.value)}
              className="text-xs border border-[#e8e2d9] rounded-xl px-2.5 py-1.5 bg-[#faf8f5] text-[#78716c] focus:outline-none focus:border-[#2d6a4f] transition-colors"
            >
              <option value="all">All Genres</option>
              {allGenres.map((g) => (
                <option key={g} value={g}>{g}</option>
              ))}
            </select>
          </div>

          {!scatter ? (
            <div className="flex items-center justify-center h-64 text-[#a8998a]">
              <Loader2 size={14} className="animate-spin" />
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={480}>
              <ScatterChart margin={{ left: -10, right: 20, top: 10, bottom: 20 }}>
                <XAxis
                  type="number"
                  dataKey="avg_song_score"
                  name="Avg Song Score"
                  domain={[1, 10]}
                  tick={{ fill: '#c2b8ad', fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                  label={{ value: 'Avg Song Score', fill: '#c2b8ad', fontSize: 10, position: 'insideBottom', offset: -12 }}
                />
                <YAxis
                  type="number"
                  dataKey="avg_external"
                  name="Avg External"
                  domain={[1, 10]}
                  tick={{ fill: '#c2b8ad', fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                  label={{ value: 'Avg External', fill: '#c2b8ad', fontSize: 10, angle: -90, position: 'insideLeft', offset: 14 }}
                />
                <ZAxis range={[28, 28]} />
                {meanSong !== null && (
                  <ReferenceLine
                    x={meanSong}
                    stroke="#e8e2d9"
                    strokeDasharray="4 3"
                    label={{ value: `avg ${meanSong.toFixed(2)}`, fill: '#c2b8ad', fontSize: 9, position: 'top' }}
                  />
                )}
                {meanExt !== null && (
                  <ReferenceLine
                    y={meanExt}
                    stroke="#e8e2d9"
                    strokeDasharray="4 3"
                    label={{ value: `avg ${meanExt.toFixed(2)}`, fill: '#c2b8ad', fontSize: 9, position: 'right' }}
                  />
                )}
                <Tooltip
                  contentStyle={tooltipStyle}
                  cursor={{ strokeDasharray: '3 3', stroke: '#e8e2d9' }}
                  content={({ payload }) => {
                    if (!payload?.length) return null
                    const d = payload[0].payload as { artist: string; avg_song_score: number; avg_external: number; genre: string | null }
                    return (
                      <div className="text-xs p-3 space-y-0.5 bg-[#faf8f5] border border-[#e8e2d9] rounded-xl shadow-sm">
                        <p className="font-semibold text-[#1c1917]">{d.artist}</p>
                        {d.genre && <p className="text-[#a8998a]">{d.genre}</p>}
                        <p className="text-[#78716c]">Song: {d.avg_song_score?.toFixed(2)}</p>
                        <p className="text-[#78716c]">Ext: {d.avg_external?.toFixed(2)}</p>
                      </div>
                    )
                  }}
                />
                {Object.entries(
                  scatterPoints.reduce((acc, p) => {
                    const key = p.genre ?? 'Other'
                    if (!acc[key]) acc[key] = []
                    acc[key].push(p)
                    return acc
                  }, {} as Record<string, typeof scatterPoints>)
                ).map(([genre, points]) => (
                  <Scatter
                    key={genre}
                    name={genre}
                    data={points}
                    fill={genreColor(genre === 'Other' ? null : genre)}
                    opacity={0.75}
                    onClick={(d) => navigate(`/artist/${encodeURIComponent((d as unknown as { artist: string }).artist)}`)}
                    style={{ cursor: 'pointer' }}
                  />
                ))}
              </ScatterChart>
            </ResponsiveContainer>
          )}

          {scatter && genreFilter === 'all' && allGenres.length > 0 && (
            <div className="flex flex-wrap gap-x-4 gap-y-2 mt-4 pt-4 border-t border-[#e8e2d9]">
              {allGenres.map((g) => (
                <button
                  key={g}
                  onClick={() => setGenreFilter(g)}
                  className="flex items-center gap-1.5 text-xs text-[#78716c] hover:text-[#1c1917] transition-colors"
                >
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ background: genreColor(g) }} />
                  {g}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Artist Rankings */}
        {scatter && (
          <ArtistRankingsTable
            scatter={scatter}
            artistStats={artistStats}
            scatterPrev={scatterPrev}
            artistStatsPrev={artistStatsPrev}
            QUALIFIED={QUALIFIED}
            navigate={navigate}
          />
        )}
      </div>
    </div>
  )
}
