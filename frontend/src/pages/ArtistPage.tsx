import { useState } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Loader2, RefreshCw, Plus, Check } from 'lucide-react'
import { fetchArtistDetail, fetchAotyAlbums, refreshAotyArtist, searchSpotify, importAlbum, createAlbum } from '../api'
import { useUser } from '../context/UserContext'
import type { AotyAlbum } from '../api'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
  ScatterChart, Scatter, ZAxis,
} from 'recharts'

// ── Percentile bar ────────────────────────────────────────────────────────────

// Continuous gradient: 0 = dark rich red, 100 = dark rich forest green
function barColor(pct: number) {
  const hue = Math.round(pct * 1.3) // 0 → hue 0 (red), 100 → hue 130 (green)
  return `hsl(${hue}, 65%, 28%)`
}

function PercentileBar({
  label, value, percentile, invert = false, smallSample = false,
}: {
  label: string
  value: string
  percentile: number | null
  invert?: boolean
  smallSample?: boolean
}) {
  const display    = percentile !== null ? (invert ? 100 - percentile : percentile) : null
  const color      = display !== null ? barColor(display) : '#ccc'
  const circlePct  = display !== null ? Math.max(3, Math.min(97, display)) : 50

  const fillStyle: React.CSSProperties = smallSample
    ? {
        width: `${display ?? 0}%`,
        backgroundImage: `repeating-linear-gradient(-45deg, ${color} 0px, ${color} 3px, transparent 3px, transparent 8px)`,
        opacity: 0.55,
      }
    : {
        width: `${display ?? 0}%`,
        backgroundColor: color,
        opacity: 0.75,
      }

  const badgeStyle: React.CSSProperties = {
    left: `${circlePct}%`,
    transform: 'translate(-50%, -50%)',
    backgroundColor: color,
    opacity: smallSample ? 0.65 : 1,
  }

  return (
    <div className="flex items-center gap-4 py-2.5 border-b border-dashed border-[#e5e5e5] last:border-0">
      <span className="text-[#999] text-xs w-32 text-right shrink-0 leading-tight">{label}</span>

      <div className="flex-1 relative h-3.5 bg-[#eaeaea] rounded-full">
        {display !== null ? (
          <>
            <div className="absolute inset-y-0 left-0 rounded-full transition-all" style={fillStyle} />
            <div
              className="absolute top-1/2 w-[26px] h-[26px] rounded-full flex items-center justify-center text-[10px] font-bold text-white border-2 border-white z-10"
              style={badgeStyle}
            >
              {Math.round(display)}
            </div>
          </>
        ) : (
          <span className="absolute inset-0 flex items-center justify-center text-[#ccc] text-[10px]">—</span>
        )}
      </div>

      <span className={`text-xs w-14 text-right shrink-0 tabular-nums ${smallSample ? 'text-[#aaa]' : 'text-[#111]'}`}>
        {value}
      </span>
    </div>
  )
}

function PercentilesSection({ data, smallSample }: { data: ReturnType<typeof buildStats>; smallSample: boolean }) {
  return (
    <div className="mb-10">
      <h2 className="text-xs font-semibold text-[#999] uppercase tracking-widest mb-4">
        Percentile Rankings
      </h2>

      {/* POOR / AVERAGE / GREAT header */}
      <div className="flex items-end gap-4 mb-1">
        <span className="w-32 shrink-0" />
        <div className="flex-1 relative flex justify-between px-0.5">
          <span className="text-[9px] font-bold flex flex-col items-center gap-0.5" style={{ color: barColor(0) }}>
            <span>▲</span>POOR
          </span>
          <span className="text-[9px] font-bold flex flex-col items-center gap-0.5" style={{ color: barColor(50) }}>
            <span>▲</span>AVERAGE
          </span>
          <span className="text-[9px] font-bold flex flex-col items-center gap-0.5" style={{ color: barColor(100) }}>
            <span>▲</span>GREAT
          </span>
        </div>
        <span className="w-14 shrink-0" />
      </div>

      <PercentileBar label="Avg Song Score" value={data.avgSongScore} percentile={data.pct.avg_song_score} smallSample={smallSample} />
      <PercentileBar label="Song+"          value={data.songPlus}     percentile={data.pct.song_plus}      smallSample={smallSample} />
      <PercentileBar label="wSong+"         value={data.wSongPlus}    percentile={data.pct.w_song_plus}    smallSample={smallSample} />
      <PercentileBar label="Avg External"   value={data.avgExternal}  percentile={data.pct.avg_external}   smallSample={smallSample} />
      <PercentileBar label="Bang%"          value={data.bangPct}      percentile={data.pct.bang_pct}       smallSample={smallSample} />
      <PercentileBar label="Skip%"          value={data.skipPct}      percentile={data.pct.skip_pct}       smallSample={smallSample} invert />
      <PercentileBar label="Consistency+"   value={data.consistencyPlus} percentile={data.pct.consistency_plus} smallSample={smallSample} />
    </div>
  )
}

// ── Histogram ─────────────────────────────────────────────────────────────────

function buildHistogram(scores: number[]) {
  const counts = new Map<string, number>()
  for (const s of scores) {
    const key = (Math.round(s * 10) / 10).toFixed(1)
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  const bins = []
  for (let v = 10; v <= 100; v++) {
    const label = (v / 10).toFixed(1)
    bins.push({ label, score: v / 10, count: counts.get(label) ?? 0 })
  }
  return bins
}

function histColor(score: number) {
  if (score >= 8.0) return '#1a7a3c'  // bang — forest green
  if (score < 6.5)  return '#c0392b'  // skip — dark red
  return '#7a9e78'                     // middle — muted sage
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(v: number | null, decimals = 2) {
  return v !== null ? v.toFixed(decimals) : '—'
}
function fmtPct(v: number | null) {
  return v !== null ? `${(v * 100).toFixed(1)}%` : '—'
}
function fmtPlus(v: number | null) {
  return v !== null ? String(Math.round(v)) : '—'
}

function buildStats(data: Awaited<ReturnType<typeof fetchArtistDetail>>) {
  return {
    avgSongScore:   fmt(data.avg_song_score),
    songPlus:       fmtPlus(data.song_plus),
    wSongPlus:      fmtPlus(data.w_song_plus),
    avgExternal:    fmt(data.avg_external),
    bangPct:        fmtPct(data.bang_pct),
    skipPct:        fmtPct(data.skip_pct),
    consistencyIdx:  data.consistency_idx  !== null ? String(data.consistency_idx) : '—',
    consistencyPlus: fmtPlus(data.consistency_plus),
    pct:             data.percentiles,
  }
}

// ── AOTY Discover ─────────────────────────────────────────────────────────────

type AddState = 'idle' | 'loading' | 'done' | 'error'

function DiscoverRow({ album, artistName }: { album: AotyAlbum; artistName: string }) {
  const [toListenState, setToListenState] = useState<AddState>('idle')
  const [rateNowState, setRateNowState]   = useState<'idle' | 'loading' | 'error'>('idle')
  const queryClient = useQueryClient()
  const navigate    = useNavigate()

  const busy = toListenState === 'loading' || rateNowState === 'loading'
  const used = toListenState === 'done'

  async function handleToListen() {
    setToListenState('loading')
    try {
      const results = await searchSpotify(`album:${album.title} artist:${artistName}`)
      if (results.length) {
        await importAlbum(results[0], 'to_listen')
      } else {
        await createAlbum({
          albumName: album.title,
          artist: artistName,
          year: album.year ?? undefined,
          status: 'to_listen',
        })
      }
      queryClient.invalidateQueries({ queryKey: ['albums'] })
      setToListenState('done')
    } catch {
      setToListenState('error')
    }
  }

  async function handleRateNow() {
    setRateNowState('loading')
    try {
      const results = await searchSpotify(`album:${album.title} artist:${artistName}`)
      if (!results.length) { setRateNowState('error'); return }
      const imported = await importAlbum(results[0], 'listening')
      queryClient.invalidateQueries({ queryKey: ['albums'] })
      navigate(`/rate/${imported.id}`)
    } catch {
      setRateNowState('error')
    }
  }

  return (
    <div className="flex items-center gap-3 py-2.5 border-b border-[#f0f0f0] last:border-0">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-[#111] text-sm font-medium truncate">{album.title}</span>
          <span className="text-[10px] font-medium text-[#999] bg-[#f0f0f0] px-1.5 py-0.5 rounded shrink-0">
            {album.type}
          </span>
        </div>
        <span className="text-[#aaa] text-xs">{album.year ?? '—'}</span>
      </div>

      <div className="flex gap-2 shrink-0">
        {/* + To Listen */}
        <button
          onClick={handleToListen}
          disabled={busy || used}
          className={`flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-lg transition-colors ${
            used
              ? 'bg-[#2d6a4f]/10 text-[#2d6a4f] cursor-default'
              : toListenState === 'error'
              ? 'bg-red-50 text-[#c0392b] hover:bg-red-100'
              : 'bg-[#f0f0f0] hover:bg-[#e8e8e8] text-[#555] disabled:opacity-40'
          }`}
        >
          {toListenState === 'loading' ? <Loader2 size={11} className="animate-spin" /> :
           used                         ? <Check size={11} /> :
                                          <Plus size={11} />}
          {used ? 'Added' : toListenState === 'error' ? 'Error' : 'To Listen'}
        </button>

        {/* + Rate Now */}
        <button
          onClick={handleRateNow}
          disabled={busy || used}
          className={`flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-lg transition-colors ${
            rateNowState === 'error'
              ? 'bg-red-50 text-[#c0392b] hover:bg-red-100'
              : 'bg-[#2d6a4f] hover:bg-[#245a42] text-white disabled:opacity-40'
          }`}
        >
          {rateNowState === 'loading' ? <Loader2 size={11} className="animate-spin" /> : <Plus size={11} />}
          {rateNowState === 'error' ? 'Error' : 'Rate Now'}
        </button>
      </div>
    </div>
  )
}

function DiscoverSection({ artistName }: { artistName: string }) {
  const [refreshKey, setRefreshKey] = useState(0)
  const [refreshing, setRefreshing] = useState(false)
  const queryClient = useQueryClient()

  const { data, isLoading, error } = useQuery({
    queryKey: ['aoty', artistName, refreshKey],
    queryFn: () => fetchAotyAlbums(artistName),
    retry: false,
    staleTime: 1000 * 60 * 60, // 1 hour — backend caches for 7 days anyway
  })

  async function handleRefresh() {
    setRefreshing(true)
    await refreshAotyArtist(artistName)
    queryClient.invalidateQueries({ queryKey: ['aoty', artistName] })
    setRefreshKey(k => k + 1)
    setRefreshing(false)
  }

  return (
    <div className="mt-10">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h2 className="text-xs font-semibold text-[#999] uppercase tracking-widest">
            Discover — Not Yet in Library
          </h2>
          {data && (
            <p className="text-[#bbb] text-[10px] mt-0.5">
              {data.unrated.length} of {data.total_on_mb} releases not in library
            </p>
          )}
        </div>
        <button
          onClick={handleRefresh}
          disabled={refreshing}
          className="text-[#bbb] hover:text-[#555] transition-colors disabled:opacity-40"
          title="Refresh from AOTY"
        >
          <RefreshCw size={13} className={refreshing ? 'animate-spin' : ''} />
        </button>
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 text-[#aaa] text-sm py-4">
          <Loader2 size={14} className="animate-spin" /> Fetching discography from MusicBrainz…
        </div>
      ) : error ? (
        <p className="text-[#bbb] text-sm py-2">Artist not found on MusicBrainz.</p>
      ) : data?.unrated.length === 0 ? (
        <p className="text-[#bbb] text-sm py-2">All releases are already in your library.</p>
      ) : (
        <div>
          {data!.unrated.map((album) => (
            <DiscoverRow key={album.mb_id} album={album} artistName={artistName} />
          ))}
        </div>
      )}
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function ArtistPage() {
  const { name } = useParams<{ name: string }>()
  const navigate  = useNavigate()
  const { viewingUser } = useUser()
  const userId = viewingUser.id

  const { data, isLoading, error } = useQuery({
    queryKey: ['artist', name, userId],
    queryFn:  () => fetchArtistDetail(name!, userId),
    enabled:  !!name,
  })

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64 text-[#aaa] gap-2">
        <Loader2 size={16} className="animate-spin" /> Loading…
      </div>
    )
  }
  if (error || !data) return <div className="p-8 text-[#aaa]">Artist not found.</div>

  const stats    = buildStats(data)
  const histData = buildHistogram(data.song_scores)
  const others   = data.all_artists.filter(
    (a) => a.artist !== data.artist && a.avg_song_score !== null && a.avg_external !== null,
  )
  const selfPoint = data.all_artists.find((a) => a.artist === data.artist) ?? null

  const inlineStats = [
    { label: 'Avg Song Score', value: stats.avgSongScore },
    { label: 'Songs Rated',    value: data.song_count },
    { label: 'Song Score Rank',
      value: data.song_score_rank !== null ? `#${data.song_score_rank}` : '—',
      sub: `of ${data.song_score_rank_of}` },
    { label: 'Ext. Factors Rank',
      value: data.external_rank !== null ? `#${data.external_rank}` : '—',
      sub: `of ${data.external_rank_of}` },
    { label: 'Song+',   value: stats.songPlus,  sub: '100 = avg' },
    { label: 'wSong+',  value: stats.wSongPlus, sub: '100 = avg' },
    { label: 'Bang%',         value: stats.bangPct },
    { label: 'Skip%',         value: stats.skipPct },
    { label: 'Consistency+',  value: stats.consistencyPlus, sub: '100 = avg' },
  ]

  return (
    <div className="p-4 md:p-8 md:pr-16 max-w-5xl">
      <button
        onClick={() => navigate(-1)}
        className="flex items-center gap-2 text-[#777] hover:text-[#111] text-sm mb-6 transition-colors"
      >
        <ArrowLeft size={15} /> Back
      </button>

      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-[#111]">{data.artist}</h1>
        <p className="text-[#aaa] text-sm mt-1">
          {data.album_count} rated {data.album_count === 1 ? 'album' : 'albums'}
        </p>
      </div>

      {/* Inline stat row */}
      <div className="flex flex-wrap gap-x-10 gap-y-5 mb-10">
        {inlineStats.map(({ label, value, sub }) => (
          <div key={label}>
            <p className="text-[#999] text-xs uppercase tracking-widest mb-0.5">{label}</p>
            <p className="text-[#111] font-semibold text-xl tabular-nums">{value}</p>
            {sub && <p className="text-[#aaa] text-[10px] mt-0.5">{sub}</p>}
          </div>
        ))}
      </div>

      {/* Percentile bars */}
      <PercentilesSection data={stats} smallSample={data.small_sample} />

      {/* Histogram */}
      <div className="mb-10">
        <h2 className="text-xs font-semibold text-[#999] uppercase tracking-widest mb-4">
          Song Score Distribution
        </h2>
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={histData} barSize={10} margin={{ left: -20, right: 10 }}>
            <XAxis
              dataKey="label"
              tick={{ fill: '#aaa', fontSize: 10 }}
              axisLine={false}
              tickLine={false}
              interval={9}
            />
            <YAxis
              tick={{ fill: '#aaa', fontSize: 10 }}
              axisLine={false}
              tickLine={false}
              allowDecimals={false}
            />
            <Tooltip
              contentStyle={{ background: '#fff', border: '1px solid #e2e2e2', borderRadius: 8, color: '#111', fontSize: 12 }}
              cursor={{ fill: '#00000008' }}
              formatter={(val: number) => [val, 'Songs']}
              labelFormatter={(label) => `Score ${label}`}
            />
            <Bar dataKey="count" radius={[2, 2, 0, 0]}>
              {histData.map((entry) => (
                <Cell key={entry.label} fill={histColor(entry.score)} opacity={0.85} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Scatterplot */}
      <div className="mb-10">
        <h2 className="text-xs font-semibold text-[#999] uppercase tracking-widest mb-1">
          Song Score vs External Factors — All Artists
        </h2>
        <p className="text-[#aaa] text-xs mb-4">
          <span className="text-[#2d6a4f]">●</span> {data.artist}
          &nbsp;·&nbsp;
          <span style={{ color: '#ccc' }}>●</span> others
        </p>
        <ResponsiveContainer width="100%" height={420}>
          <ScatterChart margin={{ left: -10, right: 20, bottom: 20 }}>
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
              domain={['auto', 'auto']}
              tick={{ fill: '#aaa', fontSize: 11 }}
              axisLine={false}
              tickLine={false}
              label={{ value: 'Avg External', fill: '#bbb', fontSize: 10, angle: -90, position: 'insideLeft', offset: 14 }}
            />
            <ZAxis range={[25, 25]} />
            <Tooltip
              contentStyle={{ background: '#fff', border: '1px solid #e2e2e2', borderRadius: 8, color: '#111', fontSize: 12 }}
              cursor={{ strokeDasharray: '3 3', stroke: '#e2e2e2' }}
              content={({ payload }) => {
                if (!payload?.length) return null
                const d = payload[0].payload as { artist: string; avg_song_score: number; avg_external: number }
                return (
                  <div className="text-xs p-2 space-y-0.5">
                    <p className="font-medium text-[#111]">{d.artist}</p>
                    <p className="text-[#777]">Song: {d.avg_song_score?.toFixed(2)}</p>
                    <p className="text-[#777]">Ext: {d.avg_external?.toFixed(2)}</p>
                  </div>
                )
              }}
            />
            <Scatter data={others} fill="#ccc" opacity={0.7} />
            {selfPoint && (
              <Scatter
                data={[selfPoint]}
                shape={(props: { cx: number; cy: number }) => (
                  <circle cx={props.cx} cy={props.cy} r={7} fill="#2d6a4f" />
                )}
              />
            )}
          </ScatterChart>
        </ResponsiveContainer>
      </div>

      {/* Album list */}
      {(() => {
        const fullAlbums = data.albums.filter((a) => !a.is_ep)
        const eps = data.albums.filter((a) => a.is_ep)
        const AlbumCard = ({ album, ep = false }: { album: typeof data.albums[0]; ep?: boolean }) => (
          <Link
            key={album.id}
            to={`/album/${album.id}`}
            className={`flex items-center gap-4 rounded-xl p-4 transition-colors border ${
              ep
                ? 'bg-transparent border-dashed border-[#e2e2e2] hover:border-[#bbb] opacity-70 hover:opacity-100'
                : 'bg-[#f5f5f5] border-[#e2e2e2] hover:border-[#c8c8c8]'
            }`}
          >
            <div className="w-12 h-12 shrink-0 bg-[#e8e8e8] rounded-lg overflow-hidden flex items-center justify-center text-[#aaa] text-lg font-bold">
              {album.album_art_url
                ? <img src={album.album_art_url} alt={album.album_name} className="w-full h-full object-cover" />
                : album.album_name[0]}
            </div>
            <div className="flex-1 min-w-0">
              <p className={`text-sm font-medium truncate ${ep ? 'text-[#777]' : 'text-[#111]'}`}>{album.album_name}</p>
              <p className="text-[#aaa] text-xs mt-0.5">{album.year ?? '—'}</p>
            </div>
            <div className="text-right shrink-0">
              <p className={`font-semibold text-sm tabular-nums ${ep ? 'text-[#aaa]' : 'text-[#2d6a4f]'}`}>
                {album.score?.toFixed(2) ?? '—'}
              </p>
              {album.avg_external !== null && (
                <p className="text-[#aaa] text-xs">ext {album.avg_external.toFixed(2)}</p>
              )}
            </div>
          </Link>
        )
        return (
          <>
            <h2 className="text-xs font-semibold text-[#999] uppercase tracking-widest mb-3">Albums</h2>
            <div className="flex flex-col gap-2 mb-6">
              {fullAlbums.map((a) => <AlbumCard key={a.id} album={a} />)}
            </div>
            {eps.length > 0 && (
              <>
                <h2 className="text-xs font-semibold text-[#999] uppercase tracking-widest mb-3">EPs</h2>
                <div className="flex flex-col gap-2">
                  {eps.map((a) => <AlbumCard key={a.id} album={a} ep />)}
                </div>
              </>
            )}
          </>
        )
      })()}

      {/* AOTY Discover */}
      <DiscoverSection artistName={data.artist} />
    </div>
  )
}
