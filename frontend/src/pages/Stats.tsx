import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { fetchSummary, fetchGenreStats, fetchScatterData, fetchGenreScores, fetchAnalysis } from '../api'
import { useUser } from '../context/UserContext'
import { Loader2, Disc3, ListMusic, Star, Trophy, Heart, Layers, CalendarDays, Flame, Music } from 'lucide-react'
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

  const { data: analysisData, isFetching: fetchingAnalysis, isError: analysisError, refetch: refetchAnalysis } = useQuery({
    queryKey: ['stats', 'analysis', userId],
    queryFn: () => fetchAnalysis(userId),
    staleTime: 30 * 60 * 1000,
    retry: false,
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

  const panelCls = 'border border-[#e8e2d9] rounded-2xl p-6'
  const cardCls = 'border border-[#e8e2d9] rounded-2xl p-5'
  const labelCls = 'text-[10px] font-semibold text-[#a8998a] uppercase tracking-[0.12em] mb-2'
  const tooltipStyle = { background: '#faf8f5', border: '1px solid #e8e2d9', borderRadius: 12, color: '#1c1917', fontSize: 12 }

  return (
    <div className="min-h-screen bg-[#faf8f5]">
      <div className="p-4 md:p-8">
        <h1 className="text-2xl font-bold text-[#1c1917] mb-8">
          {isViewingFriend ? `${viewingUser?.name}'s Stats` : 'Stats'}
        </h1>

        {/* ── Primary stats ── */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">

          <div className={cardCls}>
            <div className="flex items-start justify-between mb-3">
              <p className={labelCls}>Albums Rated</p>
              <Disc3 size={15} className="text-[#c2b8ad] shrink-0 mt-0.5" strokeWidth={1.5} />
            </div>
            <p className="text-[#1c1917] font-bold text-4xl tabular-nums leading-none">{summary?.total_albums_rated ?? '—'}</p>
            {summary?.albums_this_year != null && (
              <p className="text-[#a8998a] text-xs mt-2">{summary.albums_this_year} this year</p>
            )}
          </div>

          <div className={cardCls}>
            <div className="flex items-start justify-between mb-3">
              <p className={labelCls}>Songs Rated</p>
              <ListMusic size={15} className="text-[#c2b8ad] shrink-0 mt-0.5" strokeWidth={1.5} />
            </div>
            <p className="text-[#1c1917] font-bold text-4xl tabular-nums leading-none">{summary?.total_songs_rated ?? '—'}</p>
            {summary?.total_10s != null && (
              <p className="text-[#a8998a] text-xs mt-2">{summary.total_10s} perfect 10s</p>
            )}
          </div>

          <div className={cardCls}>
            <div className="flex items-start justify-between mb-3">
              <p className={labelCls}>Avg Score</p>
              <Star size={15} className="text-[#c2b8ad] shrink-0 mt-0.5" strokeWidth={1.5} />
            </div>
            <p className="text-[#1c1917] font-bold text-4xl tabular-nums leading-none">
              {summary?.avg_album_score?.toFixed(2) ?? '—'}
            </p>
            {summary?.avg_song_score != null && (
              <p className="text-[#a8998a] text-xs mt-2">{summary.avg_song_score.toFixed(2)} avg song</p>
            )}
          </div>

          <div className={cardCls}>
            <div className="flex items-start justify-between mb-3">
              <p className={labelCls}>Top Album</p>
              <Trophy size={15} className="text-[#c2b8ad] shrink-0 mt-0.5" strokeWidth={1.5} />
            </div>
            <p className="text-[#1c1917] font-semibold text-sm leading-snug line-clamp-2">
              {summary?.top_album?.name ?? '—'}
            </p>
            {summary?.top_album && (
              <p className="text-[#a8998a] text-xs mt-2 truncate">
                {summary.top_album.artist} · <span className="text-[#2d6a4f] font-semibold">{summary.top_album.score?.toFixed(2)}</span>
              </p>
            )}
          </div>
        </div>

        {/* ── Character stats ── */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-10">

          <div className={cardCls}>
            <div className="flex items-start justify-between mb-3">
              <p className={labelCls}>Most Loyal Artist</p>
              <Heart size={15} className="text-[#c2b8ad] shrink-0 mt-0.5" strokeWidth={1.5} />
            </div>
            <p className="text-[#1c1917] font-semibold text-sm leading-snug line-clamp-2">
              {summary?.most_rated_artist?.name ?? '—'}
            </p>
            {summary?.most_rated_artist && (
              <p className="text-[#a8998a] text-xs mt-2">{summary.most_rated_artist.count} albums rated</p>
            )}
          </div>

          <div className={cardCls}>
            <div className="flex items-start justify-between mb-3">
              <p className={labelCls}>Best Genre</p>
              <Layers size={15} className="text-[#c2b8ad] shrink-0 mt-0.5" strokeWidth={1.5} />
            </div>
            <p className="text-[#1c1917] font-semibold text-sm leading-snug">
              {summary?.best_genre?.genre ?? '—'}
            </p>
            {summary?.best_genre && (
              <p className="text-[#a8998a] text-xs mt-2">
                {summary.best_genre.avg_score.toFixed(2)} avg · {summary.best_genre.count} albums
              </p>
            )}
          </div>

          <div className={cardCls}>
            <div className="flex items-start justify-between mb-3">
              <p className={labelCls}>Avg Release Year</p>
              <CalendarDays size={15} className="text-[#c2b8ad] shrink-0 mt-0.5" strokeWidth={1.5} />
            </div>
            <p className="text-[#1c1917] font-bold text-4xl tabular-nums leading-none">
              {summary?.avg_release_year ?? '—'}
            </p>
            <p className="text-[#a8998a] text-xs mt-2">center of your taste</p>
          </div>

          <div className={cardCls}>
            <div className="flex items-start justify-between mb-3">
              <p className={labelCls}>Top Song</p>
              <Music size={15} className="text-[#c2b8ad] shrink-0 mt-0.5" strokeWidth={1.5} />
            </div>
            <p className="text-[#1c1917] font-semibold text-sm leading-snug line-clamp-2">
              {summary?.top_song?.title ?? '—'}
            </p>
            {summary?.top_song && (
              <p className="text-[#a8998a] text-xs mt-2 truncate">
                {summary.top_song.artist} · <span className="text-[#2d6a4f] font-semibold">{summary.top_song.score}</span>
              </p>
            )}
          </div>
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

          {/* Streak + external factor avgs */}
          <div className="flex flex-col gap-3">
            <div className={cardCls}>
              <div className="flex items-start justify-between mb-3">
                <p className={labelCls}>Longest Rating Streak</p>
                <Flame size={15} className="text-[#c2b8ad] shrink-0 mt-0.5" strokeWidth={1.5} />
              </div>
              <p className="text-[#1c1917] font-bold text-4xl tabular-nums leading-none">
                {summary?.longest_streak ?? '—'}
              </p>
              <p className="text-[#a8998a] text-xs mt-2">consecutive days rated</p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {[
                { label: 'Avg Theme',       value: summary?.avg_theme },
                { label: 'Avg Replay',      value: summary?.avg_replay },
                { label: 'Avg Production',  value: summary?.avg_production },
                { label: 'Avg Distinctness',value: summary?.avg_distinctness },
              ].map(({ label, value }) => (
                <div key={label} className={cardCls}>
                  <p className={labelCls}>{label}</p>
                  <p className="text-[#1c1917] font-bold text-2xl tabular-nums">{value?.toFixed(1) ?? '—'}</p>
                </div>
              ))}
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

        {/* Analysis */}
        <div className={`mt-6 ${panelCls}`}>
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-sm font-semibold text-[#78716c]">Analysis</h2>
              <p className="text-[#c2b8ad] text-xs mt-0.5">3 patterns found in your listening data</p>
            </div>
            {!fetchingAnalysis && (
              <button
                onClick={() => refetchAnalysis()}
                className="text-xs text-[#a8998a] hover:text-[#78716c] transition-colors px-3 py-1.5 rounded-lg border border-[#e8e2d9] hover:border-[#c2b8ad]"
              >
                Refresh
              </button>
            )}
          </div>

          {fetchingAnalysis && (
            <div className="flex items-center gap-2 text-[#a8998a] py-6">
              <Loader2 size={14} className="animate-spin" />
              <span className="text-sm">Analyzing your library…</span>
            </div>
          )}

          {analysisError && (
            <p className="text-sm text-[#a8998a] py-4">
              Could not load analysis — make sure <code className="text-xs bg-[#f0ebe3] px-1 py-0.5 rounded">ANTHROPIC_API_KEY</code> is set on the server.
            </p>
          )}

          {analysisData && (
            <ul className="space-y-3">
              {analysisData.insights.map((insight, i) => (
                <li key={i} className="flex gap-3 text-sm text-[#1c1917] leading-snug">
                  <span className="mt-0.5 shrink-0 w-5 h-5 rounded-full bg-[#f0ebe3] flex items-center justify-center text-[10px] font-bold text-[#78716c]">
                    {i + 1}
                  </span>
                  {insight}
                </li>
              ))}
            </ul>
          )}
        </div>

      </div>
    </div>
  )
}
