import { useParams, useNavigate, useSearchParams, Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, Loader2 } from 'lucide-react'
import { fetchArtistDetail, fetchSimilarArtistComparisons } from '../api'
import type { ArtistPopulation } from '../api'
import { useUser } from '../context/UserContext'
import { ScoreDistribution } from '../components/histograms'
import {
  XAxis, YAxis, Tooltip, ResponsiveContainer,
  ScatterChart, Scatter, ZAxis,
} from 'recharts'
import CoverImg from '../components/CoverImg'
import { Cover, COVER_LIFT } from '../components/covers'
import { CoverWash, GREEN, PILL, RevealRow, SECTION_LABEL } from '../components/albumView'
import { ScoreKdeCompare, ScoreVersus, SimilarArtistComparisons, SongGapChart } from '../components/artistCompare'
import { songScoreColor } from '../types'
import { stagger } from '../lib/format'

const INK = '#1c1917'

/** Which rating set the page is showing — mobile's three scopes.
 *   mine    — this library's ratings, ranked among its own artists
 *   pressd  — every user's pooled, ranked globally
 *   compare — this library's, against the userbase's
 *  Kept in the URL (?mode=), so a comparison card can link straight to one. */
type Mode = 'mine' | 'pressd' | 'compare'
const POPULATION: Record<Mode, ArtistPopulation> = { mine: 'me', pressd: 'global', compare: 'both' }

// Mirrors SMALL_SAMPLE in backend/routers/stats.py — the song count at which an
// artist's percentiles and ranks start being published.
const SMALL_SAMPLE = 15

/** 1st, 2nd, 3rd, 4th — the teens take "th" whatever the last digit. */
function ordinal(n: number): string {
  const tens = n % 100
  if (tens >= 11 && tens <= 13) return `${n}th`
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`
}

function possessive(name: string): string {
  return name.endsWith('s') ? `${name}’` : `${name}’s`
}

// ── Percentile bar ────────────────────────────────────────────────────────────

// Continuous gradient, 0 = red to 100 = green, in the album pages' warmer register.
function barColor(pct: number) {
  const hue = Math.round(pct * 1.3) // 0 → hue 0 (red), 100 → hue 130 (green)
  return `hsl(${hue}, 48%, 36%)`
}

function PercentileBar({
  label, value, percentile, invert = false, smallSample = false, index = 0,
}: {
  label: string
  value: string
  percentile: number | null
  invert?: boolean
  smallSample?: boolean
  index?: number
}) {
  const display    = percentile !== null ? (invert ? 100 - percentile : percentile) : null
  const color      = display !== null ? barColor(display) : '#c8c0b4'
  const circlePct  = display !== null ? Math.max(3, Math.min(97, display)) : 50

  const fillStyle: React.CSSProperties = smallSample
    ? {
        width: `${display ?? 0}%`,
        backgroundImage: `repeating-linear-gradient(-45deg, ${color} 0px, ${color} 3px, transparent 3px, transparent 8px)`,
        opacity: 0.7,
      }
    : {
        width: `${display ?? 0}%`,
        backgroundColor: color,
        opacity: 0.85,
      }

  const badgeStyle: React.CSSProperties = {
    left: `${circlePct}%`,
    transform: 'translate(-50%, -50%)',
    backgroundColor: color,
    opacity: smallSample ? 0.65 : 1,
  }

  return (
    <div className="flex items-center gap-4 rounded-2xl px-4 py-3 transition-colors hover:bg-[#f2eee7] rise-in" style={stagger(index)}>
      <span className="text-[#57534e] text-[13.5px] w-32 text-right shrink-0 leading-tight">{label}</span>

      <div className="flex-1 relative h-2 bg-[#ebe5dc] rounded-full">
        {display !== null ? (
          <>
            <div className="grow-x absolute inset-y-0 left-0 rounded-full" style={{ ...fillStyle, ...stagger(index) }} />
            <div
              className="absolute top-1/2 w-[30px] h-[30px] rounded-full flex items-center justify-center text-[12.5px] font-extrabold tracking-tight leading-none text-white border-[2.5px] border-[#f9f8f6] shadow-[0_6px_14px_-8px_rgba(40,25,10,0.7)] z-10 tabular-nums"
              style={badgeStyle}
            >
              {Math.round(display)}
            </div>
          </>
        ) : (
          <span className="absolute inset-0 flex items-center justify-center text-[#c8c0b4] text-[11px]">—</span>
        )}
      </div>

      <span className={`font-display text-[15px] font-bold w-14 text-right shrink-0 tabular-nums ${smallSample ? 'text-[#a8998a]' : 'text-[#1c1917]'}`}>
        {value}
      </span>
    </div>
  )
}

function PercentilesSection({ data, smallSample }: { data: ReturnType<typeof buildStats>; smallSample: boolean }) {
  return (
    <div className="mb-12">
      <p className={`${SECTION_LABEL} mb-4`}>PERCENTILE RANKINGS</p>

      {/* POOR / AVERAGE / GREAT header */}
      <div className="flex items-end gap-4 mb-1 px-4">
        <span className="w-32 shrink-0" />
        <div className="flex-1 relative flex justify-between px-0.5">
          <span className="text-[10px] font-bold tracking-[0.12em] flex flex-col items-center gap-0.5" style={{ color: barColor(0) }}>
            <span>▲</span>POOR
          </span>
          <span className="text-[10px] font-bold tracking-[0.12em] flex flex-col items-center gap-0.5" style={{ color: barColor(50) }}>
            <span>▲</span>AVERAGE
          </span>
          <span className="text-[10px] font-bold tracking-[0.12em] flex flex-col items-center gap-0.5" style={{ color: barColor(100) }}>
            <span>▲</span>GREAT
          </span>
        </div>
        <span className="w-14 shrink-0" />
      </div>

      <div className="-mx-4">
        <PercentileBar label="Avg Song Score" value={data.avgSongScore} percentile={data.pct.avg_song_score} smallSample={smallSample} index={0} />
        <PercentileBar label="Song+"          value={data.songPlus}     percentile={data.pct.song_plus}      smallSample={smallSample} index={1} />
        <PercentileBar label="wSong+"         value={data.wSongPlus}    percentile={data.pct.w_song_plus}    smallSample={smallSample} index={2} />
        <PercentileBar label="Avg External"   value={data.avgExternal}  percentile={data.pct.avg_external}   smallSample={smallSample} index={3} />
        <PercentileBar label="Bang%"          value={data.bangPct}      percentile={data.pct.bang_pct}       smallSample={smallSample} index={4} />
        <PercentileBar label="Skip%"          value={data.skipPct}      percentile={data.pct.skip_pct}       smallSample={smallSample} invert index={5} />
        <PercentileBar label="Consistency+"   value={data.consistencyPlus} percentile={data.pct.consistency_plus} smallSample={smallSample} index={6} />
      </div>
    </div>
  )
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

// ── Page ──────────────────────────────────────────────────────────────────────

export default function ArtistPage() {
  const { name } = useParams<{ name: string }>()
  const navigate  = useNavigate()
  const { viewingUser, isViewingFriend } = useUser()
  const userId = viewingUser!.id
  const [params, setParams] = useSearchParams()
  const mode: Mode = params.get('mode') === 'compare' ? 'compare' : params.get('mode') === 'pressd' ? 'pressd' : 'mine'
  // Both controls toggle, so the button that opened a scope closes it.
  const toggle = (m: Mode) =>
    setParams((p) => {
      if (mode === m) p.delete('mode')
      else p.set('mode', m)
      return p
    }, { replace: true })

  const { data, isLoading, error } = useQuery({
    queryKey: ['artist', name, userId, mode],
    queryFn:  () => fetchArtistDetail(name!, userId, POPULATION[mode]),
    enabled:  !!name,
    // Keeps the previous scope's numbers up while the next loads.
    placeholderData: (prev) => prev,
  })

  // Only Compare reads this, so it's only fetched there.
  const { data: similar = [] } = useQuery({
    queryKey: ['artist-similar', name, userId],
    queryFn: () => fetchSimilarArtistComparisons(name!, userId),
    enabled: !!name && mode === 'compare',
    staleTime: 5 * 60_000,
  })

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64 text-[#8a7f72] gap-2">
        <Loader2 size={16} className="animate-spin" /> Loading…
      </div>
    )
  }
  if (error || !data) return <div className="p-8 text-[#8a7f72]">Artist not found.</div>

  const stats    = buildStats(data)
  const others   = data.all_artists.filter(
    (a) => a.artist !== data.artist && a.avg_song_score !== null && a.avg_external !== null,
  )
  const selfPoint = data.all_artists.find((a) => a.artist === data.artist) ?? null
  const owner = isViewingFriend ? viewingUser!.name : null
  // Pooled rows are one per record, so they open the record's community page;
  // a library's rows open that library's copy.
  const albumHref = (id: number) => (mode === 'pressd' ? `/album/${id}/community` : `/album/${id}`)

  // Scores in the score colour, rates in bang green / skip red, as on the album
  // page. The "100 = avg" notes went in October 2026 with the album pages' look.
  const inlineStats: { label: string; value: string | number; sub?: string; color?: string }[] = [
    { label: 'Avg Song Score', value: stats.avgSongScore,
      color: data.avg_song_score !== null ? songScoreColor(data.avg_song_score) : '#c8c0b4' },
    { label: 'Songs Rated',    value: data.song_count },
    { label: 'Song Score Rank',
      value: data.song_score_rank !== null ? `#${data.song_score_rank}` : '—',
      sub: data.song_score_rank !== null ? `of ${data.song_score_rank_of}` : undefined },
    { label: 'Ext. Factors Rank',
      value: data.external_rank !== null ? `#${data.external_rank}` : '—',
      sub: data.external_rank !== null ? `of ${data.external_rank_of}` : undefined },
    { label: 'Song+',   value: stats.songPlus },
    { label: 'wSong+',  value: stats.wSongPlus },
    { label: 'Bang%',         value: stats.bangPct, color: GREEN },
    { label: 'Skip%',         value: stats.skipPct, color: '#c0392b' },
    { label: 'Consistency+',  value: stats.consistencyPlus },
  ]

  return (
    <div className="relative min-h-screen overflow-x-hidden bg-[#f9f8f6]">
    {/* The best-scored record's colour, faintly, as on the album pages. */}
    <CoverWash url={[...data.albums].sort((a, b) => (b.score ?? -1) - (a.score ?? -1)).find(a => a.album_art_url)?.album_art_url} />
    <div className="relative p-4 md:p-8 md:pr-8 max-w-6xl">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <button
          onClick={() => navigate(-1)}
          className="flex items-center gap-1.5 text-[13px] font-medium text-[#57534e] hover:text-[#111] transition-colors"
        >
          <ArrowLeft size={16} /> Back
        </button>
        {/* Which rating set you're reading — the album pages' pills. */}
        <div className="flex items-center gap-2">
          {(['compare', 'pressd'] as const).map((m) => (
            <button
              key={m}
              onClick={() => toggle(m)}
              aria-pressed={mode === m}
              className={mode === m
                ? 'inline-flex items-center gap-1.5 rounded-full border border-[#2d6a4f] bg-[#2d6a4f] px-3.5 py-1.5 text-[13px] font-semibold text-white pop'
                : PILL}
            >
              {m === 'compare' ? 'Compare' : 'Pressd avg'}
            </button>
          ))}
        </div>
      </div>

      {/* Header */}
      <div className="flex items-start justify-between gap-4 mb-10">
        <div className="rise-in" style={stagger(0)}>
          <h1 className="font-display m-0 text-[40px] font-bold leading-tight text-[#1c1917]">{data.artist}</h1>
          {/* A library's page counts what it has rated; the pooled page leads
              with how much of Pressd's listening the artist accounts for. */}
          {mode === 'pressd' ? (
            <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-[14px] text-[#57534e]">
              {data.popularity_rank != null && (
                <span><span className="font-bold text-[#1c1917]">{ordinal(data.popularity_rank)}</span>/{data.popularity_of} most rated artist on Pressd</span>
              )}
              {data.genre_popularity_rank != null && data.popularity_genre && (
                <span><span className="font-bold text-[#1c1917]">{ordinal(data.genre_popularity_rank)}</span>/{data.genre_popularity_of} in {data.popularity_genre}</span>
              )}
            </div>
          ) : (
            <p className="m-0 text-[#57534e] text-[15px] mt-1.5">
              {data.album_count} rated {data.album_count === 1 ? 'album' : 'albums'}
            </p>
          )}
          {(data.genre || data.subgenres.length > 0) && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {data.genre && (
                <span className="rounded-full bg-[#2d6a4f]/10 px-2.5 py-1 text-[11.5px] font-semibold text-[#2d6a4f]">{data.genre}</span>
              )}
              {data.subgenres.map((s) => (
                <span key={s} className="rounded-full bg-[#efebe5] px-2.5 py-1 text-[11.5px] font-medium text-[#78716c]">{s}</span>
              ))}
            </div>
          )}
        </div>
        {(() => {
          const ratedAlbums = data.albums.filter(a => a.status === 'rated' && a.album_art_url)
          if (ratedAlbums.length === 0) return null
          const shown = ratedAlbums.slice(0, 6)
          return (
            <div className="flex shrink-0">
              {shown.map((a, i) => (
                <Link
                  key={a.id}
                  to={albumHref(a.id)}
                  title={a.album_name}
                  className="group relative block w-20 h-20 rounded-2xl overflow-hidden border-[2.5px] border-[#f9f8f6] shadow-[0_14px_28px_-16px_rgba(40,25,10,0.6)] hover:z-10 pop-in"
                  style={{ marginLeft: i === 0 ? 0 : '-12px', zIndex: shown.length - i, animationDelay: `${i * 45}ms` }}
                >
                  <CoverImg url={a.album_art_url} displayPx={80} alt={a.album_name} className={`w-full h-full object-cover ${COVER_LIFT}`} />
                </Link>
              ))}
            </div>
          )
        })()}
      </div>

      {data.small_sample && (
        <p className="m-0 mb-6 text-[13.5px] font-medium text-[#2d6a4f]">
          Rate at least {SMALL_SAMPLE} songs to see advanced stats!
        </p>
      )}

      {/* Compare holds the two averages against each other instead: a rank is
          a place in one league table, and yours against the userbase's would be
          two different tables. */}
      {mode === 'compare' ? (
        <ScoreVersus
          mine={data.avg_song_score}
          theirs={data.global?.avg_song_score ?? null}
          mineLabel={owner ? `${possessive(owner).toUpperCase()} AVG SONG` : 'MY AVG SONG'}
        />
      ) : (
      <div className="flex flex-wrap gap-x-12 gap-y-6 mb-12">
        {inlineStats.map(({ label, value, sub, color }, i) => (
          <div key={label} className="rise-in" style={stagger(i + 1)}>
            <p className="font-display m-0 text-[26px] font-bold leading-none tabular-nums" style={{ color: color ?? INK }}>
              {value}
              {sub && <span className="ml-1 font-sans text-[13px] font-medium text-[#a8998a]">{sub}</span>}
            </p>
            <p className="m-0 mt-1.5 text-[12px] font-medium text-[#8a7f72]">{label}</p>
          </div>
        ))}
      </div>
      )}

      {/* Compare answers one question — which songs do I hear differently — so
          the gap chart takes the percentile bars' place there. */}
      {mode === 'compare' ? (
        <div className="mb-12">
          <p className={`${SECTION_LABEL} mb-4`}>WHERE YOU SPLIT</p>
          <SongGapChart gaps={data.song_gaps ?? []} artist={data.artist} />
        </div>
      ) : (
        <PercentilesSection data={stats} smallSample={data.small_sample} />
      )}

      {/* Histogram — or, comparing, both distributions on one pair of axes. */}
      {data.song_scores.length > 0 && (
        <div className="mb-12">
          <p className={`${SECTION_LABEL} mb-4`}>SONG SCORE DISTRIBUTION</p>
          {mode === 'compare' ? (
            <ScoreKdeCompare
              mine={data.song_scores}
              theirs={data.global?.song_scores ?? []}
              mineLabel={owner ?? 'You'}
            />
          ) : (
            <ScoreDistribution scores={data.song_scores} caption="" />
          )}
        </div>
      )}

      {/* Scatterplot — not in Compare, which is about you against the userbase,
          not this artist against the rest of a library. */}
      {mode !== 'compare' && (
      <div className="mb-12">
        <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
          <p className={SECTION_LABEL}>SONG SCORE VS EXTERNAL FACTORS — ALL ARTISTS</p>
          <p className="m-0 flex items-center gap-3 text-[12px] text-[#8a7f72]">
            <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full" style={{ background: GREEN }} />{data.artist}</span>
            <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-[#d6cdc0]" />others</span>
          </p>
        </div>
        <ResponsiveContainer width="100%" height={420}>
          <ScatterChart margin={{ left: -10, right: 20, bottom: 20 }}>
            <XAxis
              type="number"
              dataKey="avg_song_score"
              name="Avg Song Score"
              domain={[1, 10]}
              tick={{ fill: '#a8998a', fontSize: 11 }}
              axisLine={false}
              tickLine={false}
              label={{ value: 'Avg Song Score', fill: '#a8998a', fontSize: 11, position: 'insideBottom', offset: -12 }}
            />
            <YAxis
              type="number"
              dataKey="avg_external"
              name="Avg External"
              domain={['auto', 'auto']}
              tick={{ fill: '#a8998a', fontSize: 11 }}
              axisLine={false}
              tickLine={false}
              label={{ value: 'Avg External', fill: '#a8998a', fontSize: 11, angle: -90, position: 'insideLeft', offset: 14 }}
            />
            <ZAxis range={[28, 28]} />
            {/* Recharts slides its tooltip between points, and on the first
                hover it slides in from the chart's top-left corner. So the
                slide is off, and each point's tag fades in where it lands,
                keyed by artist so moving to a neighbour fades rather than jumps. */}
            <Tooltip
              isAnimationActive={false}
              cursor={{ strokeDasharray: '3 3', stroke: '#e2dbd0' }}
              content={({ payload }) => {
                if (!payload?.length) return null
                const d = payload[0].payload as { artist: string; avg_song_score: number; avg_external: number }
                return (
                  <div key={d.artist} className="fade-in rounded-xl border border-[#e2dbd0] bg-white px-3 py-2 text-[12px] shadow-sm">
                    <p className="m-0 font-semibold text-[#1c1917]">{d.artist}</p>
                    <p className="m-0 mt-0.5 tabular-nums text-[#8a7f72]">Song {d.avg_song_score?.toFixed(2)} · Ext {d.avg_external?.toFixed(2)}</p>
                  </div>
                )
              }}
            />
            <Scatter data={others} fill="#d6cdc0" opacity={0.85} />
            {selfPoint && (
              <Scatter
                data={[selfPoint]}
                shape={(props: { cx?: number; cy?: number }) => (
                  <circle cx={props.cx} cy={props.cy} r={8} fill={GREEN} stroke="#fff" strokeWidth={2.5} />
                )}
              />
            )}
          </ScatterChart>
        </ResponsiveContainer>
      </div>
      )}


      {/* Album list */}
      {(() => {
        // Newest first; undated records last.
        const chronological = [...data.albums].sort(
          (a, b) => (b.year ?? -Infinity) - (a.year ?? -Infinity) || a.album_name.localeCompare(b.album_name),
        )
        const fullAlbums = chronological.filter((a) => !a.is_ep)
        const eps = chronological.filter((a) => a.is_ep)
        const AlbumCard = ({ album, ep = false }: { album: typeof data.albums[0]; ep?: boolean }) => (
          <Link
            to={albumHref(album.id)}
            className={`group flex items-center gap-4 rounded-2xl px-4 py-3 transition-colors hover:bg-[#f2eee7] ${ep ? 'opacity-80 hover:opacity-100' : ''}`}
          >
            <div className={`w-14 h-14 shrink-0 overflow-hidden rounded-xl shadow-[0_10px_22px_-14px_rgba(40,25,10,0.6)] ${COVER_LIFT}`}>
              {album.album_art_url
                ? <CoverImg url={album.album_art_url} displayPx={56} alt={album.album_name} className="w-full h-full object-cover" />
                : <Cover artUrl={null} seed={album.album_name} size={56} radius={0} fontSize={20} />}
            </div>
            <div className="flex-1 min-w-0">
              <p className={`m-0 text-[14.5px] font-semibold truncate ${ep ? 'text-[#57534e]' : 'text-[#1c1917]'}`}>{album.album_name}</p>
              <p className="m-0 text-[#8a7f72] text-[12.5px] mt-0.5">
                {album.year ?? '—'}
                {mode === 'pressd' && album.rater_count != null && ` · ${album.rater_count} ${album.rater_count === 1 ? 'rater' : 'raters'}`}
              </p>
            </div>
            <div className="text-right shrink-0">
              <p
                className="font-display m-0 text-[22px] font-bold leading-none tabular-nums"
                style={{ color: album.score != null ? songScoreColor(album.score) : '#c8c0b4' }}
              >
                {album.score?.toFixed(2) ?? '—'}
              </p>
              {album.avg_external !== null && (
                <p className="m-0 mt-1 text-[#8a7f72] text-[12px] tabular-nums">ext {album.avg_external.toFixed(2)}</p>
              )}
            </div>
          </Link>
        )
        return (
          <>
            {fullAlbums.length > 0 && (
              <>
                <p className={`${SECTION_LABEL} mb-2`}>ALBUMS</p>
                <ol className="m-0 -mx-4 mb-8 list-none p-0">
                  {fullAlbums.map((a, i) => <RevealRow key={a.id} index={i}><AlbumCard album={a} /></RevealRow>)}
                </ol>
              </>
            )}
            {eps.length > 0 && (
              <>
                <p className={`${SECTION_LABEL} mb-2`}>EPS</p>
                <ol className="m-0 -mx-4 list-none p-0">
                  {eps.map((a, i) => <RevealRow key={a.id} index={i}><AlbumCard album={a} ep /></RevealRow>)}
                </ol>
              </>
            )}
          </>
        )
      })()}

      {/* Neighbours worth comparing, only where a comparison exists. */}
      {mode === 'compare' && <SimilarArtistComparisons rows={similar} />}
    </div>
    </div>
  )
}
