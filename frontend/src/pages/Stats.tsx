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
  QUALIFIED,
  navigate,
}: {
  scatter: ReturnType<typeof import('../api').fetchScatterData> extends Promise<infer T> ? T : never
  artistStats: Awaited<ReturnType<typeof import('../api').fetchArtistStats>>
  QUALIFIED: number
  navigate: (path: string) => void
}) {
  const [sortKey, setSortKey] = useState<SortKey>('song_score')

  const rows = useMemo<RankingRow[]>(() => {
    const artistMap = new Map(artistStats.map(a => [a.artist, a]))
    const qualified = scatter.points.filter(p => p.song_count >= QUALIFIED)
    return qualified.map(p => {
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
  }, [scatter, artistStats, QUALIFIED])

  const sorted = useMemo(() => {
    const get = (r: RankingRow): number => {
      if (sortKey === 'song_score') return r.songScore ?? -Infinity
      if (sortKey === 'external') return r.external ?? -Infinity
      if (sortKey === 'w_song_plus') return r.wSongPlus ?? -Infinity
      if (sortKey === 'consistency_plus') return r.consistencyPlus ?? -Infinity
      if (sortKey === 'bang_pct') return r.bangPct ?? -Infinity
      if (sortKey === 'skip_pct') return -(r.skipPct ?? Infinity)
      return 0
    }
    return [...rows].sort((a, b) => get(b) - get(a))
  }, [rows, sortKey])

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
    <div className="mt-8">
      <h2 className="text-sm font-semibold text-[#777] mb-4">
        Artist Rankings <span className="text-[#bbb] font-normal">(≥{QUALIFIED} songs)</span>
      </h2>
      <div className="border border-[#e2e2e2] rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="border-b border-[#e2e2e2] bg-[#fafafa]">
                <th className="text-left text-[#aaa] text-xs font-semibold px-4 py-3 w-10">Rk.</th>
                <th className="text-left text-[#aaa] text-xs font-semibold px-4 py-3">Artist</th>
                <th className="text-right text-[#aaa] text-xs font-semibold px-4 py-3 w-14">Songs</th>
                {cols.map(c => (
                  <th
                    key={c.key}
                    onClick={() => setSortKey(c.key)}
                    className={`text-right text-xs font-semibold px-4 py-3 w-24 cursor-pointer select-none transition-colors ${
                      sortKey === c.key
                        ? 'text-[#111] bg-[#f0f0f0]'
                        : 'text-[#aaa] hover:text-[#555]'
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
                  className="border-b border-[#f0f0f0] last:border-0 hover:bg-[#fafafa] transition-colors"
                >
                  <td className="text-[#ccc] text-xs tabular-nums px-4 py-2.5">{i + 1}</td>
                  <td className="px-4 py-2.5">
                    <button
                      onClick={() => navigate(`/artist/${encodeURIComponent(row.artist)}`)}
                      className="text-[#111] font-medium hover:text-[#2d6a4f] transition-colors text-left"
                    >
                      {row.artist}
                    </button>
                  </td>
                  <td className="text-right text-[#aaa] tabular-nums px-4 py-2.5 text-xs">{row.songs}</td>
                  {cols.map(c => (
                    <td
                      key={c.key}
                      className={`text-right tabular-nums px-4 py-2.5 text-xs font-semibold ${
                        sortKey === c.key ? 'bg-[#f8f8f8] text-[#2d6a4f]' : 'text-[#333]'
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
  const userId = viewingUser.id
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
      <div className="flex items-center justify-center h-64 text-[#aaa] gap-2">
        <Loader2 size={16} className="animate-spin" /> Loading…
      </div>
    )
  }

  if (!summary) {
    return (
      <div className="flex items-center justify-center h-64 text-[#aaa] text-sm">
        Failed to load stats — check that the backend is running.
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

  return (
    <div className="p-4 md:p-8">
      <h1 className="text-2xl font-semibold text-[#111] mb-8">
        {isViewingFriend ? `${viewingUser.name}'s Stats` : 'Stats'}
      </h1>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-10">
        {[
          { label: 'Albums Rated', value: summary?.total_albums_rated ?? '—' },
          { label: 'Songs Rated', value: summary?.total_songs_rated ?? '—' },
          { label: 'Avg Album Score', value: summary?.avg_album_score?.toFixed(2) ?? '—' },
          { label: 'Avg Song Score', value: summary?.avg_song_score?.toFixed(2) ?? '—' },
          { label: 'Top Album', value: summary?.top_album?.name ?? '—', small: true },
        ].map(({ label, value, small }) => (
          <div key={label} className="bg-[#f5f5f5] border border-[#e2e2e2] rounded-xl p-5">
            <p className="text-[#999] text-xs uppercase tracking-widest mb-2">{label}</p>
            <p className={`text-[#111] font-semibold ${small ? 'text-base truncate' : 'text-3xl tabular-nums'}`}>{value}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        {/* Genre breakdown */}
        <div className="bg-[#f5f5f5] border border-[#e2e2e2] rounded-xl p-6">
          <h2 className="text-sm font-semibold text-[#777] mb-5">Albums by Genre</h2>
          {loadingGenres ? (
            <div className="flex items-center justify-center h-48 text-[#aaa] gap-2">
              <Loader2 size={14} className="animate-spin" />
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={Math.max(200, genres.length * 28)}>
              <BarChart data={genres} layout="vertical" barSize={16}>
                <XAxis type="number" tick={{ fill: '#aaa', fontSize: 12 }} axisLine={false} tickLine={false} />
                <YAxis
                  type="category"
                  dataKey="genre"
                  tick={{ fill: '#777', fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                  width={100}
                />
                <Tooltip
                  contentStyle={{ background: '#fff', border: '1px solid #e2e2e2', borderRadius: 8, color: '#111' }}
                  cursor={{ fill: '#00000008' }}
                />
                <Bar dataKey="count" fill="#2d6a4f" radius={[0, 4, 4, 0]} opacity={0.85} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Top song + top album */}
        <div className="flex flex-col gap-4">
          {summary?.top_album && (
            <div className="bg-[#f5f5f5] border border-[#e2e2e2] rounded-xl p-5">
              <p className="text-[#999] text-xs uppercase tracking-widest mb-1">Top Album</p>
              <p className="text-[#111] font-semibold">{summary.top_album.name}</p>
              <p className="text-[#777] text-sm mt-0.5">
                {summary.top_album.artist} ·{' '}
                <span className="text-[#2d6a4f] font-medium">{summary.top_album.score?.toFixed(2)}</span>
              </p>
            </div>
          )}
          {summary?.top_song && (
            <div className="bg-[#f5f5f5] border border-[#e2e2e2] rounded-xl p-5">
              <p className="text-[#999] text-xs uppercase tracking-widest mb-1">Top Song</p>
              <p className="text-[#111] font-semibold">{summary.top_song.title}</p>
              <p className="text-[#777] text-sm mt-0.5">
                {summary.top_song.artist} ·{' '}
                <span className="text-[#2d6a4f] font-medium">{summary.top_song.score}</span>
              </p>
            </div>
          )}
          <div className="grid grid-cols-2 gap-4">
            <div className="bg-[#f5f5f5] border border-[#e2e2e2] rounded-xl p-5">
              <p className="text-[#999] text-xs uppercase tracking-widest mb-2">Albums Rated</p>
              <p className="text-[#111] font-semibold text-3xl tabular-nums">{summary?.total_albums_rated}</p>
            </div>
            <div className="bg-[#f5f5f5] border border-[#e2e2e2] rounded-xl p-5">
              <p className="text-[#999] text-xs uppercase tracking-widest mb-2">Songs Rated</p>
              <p className="text-[#111] font-semibold text-3xl tabular-nums">{summary?.total_songs_rated}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Genre KDE */}
      {kdeData.length > 0 && (
        <div className="mt-8 bg-[#f5f5f5] border border-[#e2e2e2] rounded-xl p-6">
          <h2 className="text-sm font-semibold text-[#777] mb-1">Score Distribution by Genre</h2>
          <p className="text-[#bbb] text-xs mb-5">Kernel density estimate of average song scores per album</p>
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={kdeData} margin={{ left: -20, right: 16, top: 8, bottom: 8 }}>
              <XAxis
                dataKey="x"
                type="number"
                domain={[1, 10]}
                tickCount={10}
                tick={{ fill: '#aaa', fontSize: 11 }}
                axisLine={false}
                tickLine={false}
                label={{ value: 'Avg Song Score', fill: '#bbb', fontSize: 10, position: 'insideBottom', offset: -4 }}
              />
              <YAxis hide />
              <Tooltip
                contentStyle={{ background: '#fff', border: '1px solid #e2e2e2', borderRadius: 8, fontSize: 11 }}
                formatter={(val: number, name: string) => [val.toFixed(4), name]}
                labelFormatter={(x: number) => `Score: ${Number(x).toFixed(2)}`}
              />
              <Legend
                iconType="plainline"
                iconSize={16}
                wrapperStyle={{ fontSize: 11, paddingTop: 12 }}
              />
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

      {/* Artist scatterplot */}
      <div className="mt-8 bg-[#f5f5f5] border border-[#e2e2e2] rounded-xl p-6">
        <div className="flex items-center justify-between mb-5">
          <div>
            <h2 className="text-sm font-semibold text-[#777]">Song Score vs External Factors — All Artists</h2>
            <p className="text-[#bbb] text-xs mt-0.5">Click an artist to view their page</p>
          </div>
          <select
            value={genreFilter}
            onChange={(e) => setGenreFilter(e.target.value)}
            className="text-xs border border-[#e2e2e2] rounded-lg px-2.5 py-1.5 bg-white text-[#555] focus:outline-none focus:border-[#2d6a4f]"
          >
            <option value="all">All Genres</option>
            {allGenres.map((g) => (
              <option key={g} value={g}>{g}</option>
            ))}
          </select>
        </div>

        {!scatter ? (
          <div className="flex items-center justify-center h-64 text-[#aaa] gap-2">
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
                tick={{ fill: '#aaa', fontSize: 11 }}
                axisLine={false}
                tickLine={false}
                label={{ value: 'Avg Song Score', fill: '#bbb', fontSize: 10, position: 'insideBottom', offset: -12 }}
              />
              <YAxis
                type="number"
                dataKey="avg_external"
                name="Avg External"
                domain={[1, 10]}
                tick={{ fill: '#aaa', fontSize: 11 }}
                axisLine={false}
                tickLine={false}
                label={{ value: 'Avg External', fill: '#bbb', fontSize: 10, angle: -90, position: 'insideLeft', offset: 14 }}
              />
              <ZAxis range={[28, 28]} />
              {meanSong !== null && (
                <ReferenceLine
                  x={meanSong}
                  stroke="#d0d0d0"
                  strokeDasharray="4 3"
                  label={{ value: `avg ${meanSong.toFixed(2)}`, fill: '#bbb', fontSize: 9, position: 'top' }}
                />
              )}
              {meanExt !== null && (
                <ReferenceLine
                  y={meanExt}
                  stroke="#d0d0d0"
                  strokeDasharray="4 3"
                  label={{ value: `avg ${meanExt.toFixed(2)}`, fill: '#bbb', fontSize: 9, position: 'right' }}
                />
              )}
              <Tooltip
                contentStyle={{ background: '#fff', border: '1px solid #e2e2e2', borderRadius: 8, color: '#111', fontSize: 12 }}
                cursor={{ strokeDasharray: '3 3', stroke: '#e2e2e2' }}
                content={({ payload }) => {
                  if (!payload?.length) return null
                  const d = payload[0].payload as { artist: string; avg_song_score: number; avg_external: number; genre: string | null }
                  return (
                    <div className="text-xs p-2 space-y-0.5">
                      <p className="font-medium text-[#111]">{d.artist}</p>
                      {d.genre && <p className="text-[#aaa]">{d.genre}</p>}
                      <p className="text-[#777]">Song: {d.avg_song_score?.toFixed(2)}</p>
                      <p className="text-[#777]">Ext: {d.avg_external?.toFixed(2)}</p>
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

        {/* Genre color legend */}
        {scatter && genreFilter === 'all' && allGenres.length > 0 && (
          <div className="flex flex-wrap gap-x-4 gap-y-2 mt-4 pt-4 border-t border-[#e8e8e8]">
            {allGenres.map((g) => (
              <button
                key={g}
                onClick={() => setGenreFilter(g)}
                className="flex items-center gap-1.5 text-xs text-[#777] hover:text-[#111] transition-colors"
              >
                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: genreColor(g) }} />
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
          QUALIFIED={QUALIFIED}
          navigate={navigate}
        />
      )}
    </div>
  )
}
