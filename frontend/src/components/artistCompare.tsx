// The artist page's Compare view, on web — mobile's SongGapChart,
// ScoreKdeCompare, SimilarArtistComparisons and the score-versus row, drawn in
// the album pages' register (components/albumView.tsx). Mobile's full splits
// page is the "See all" expansion here: the same rows in the same order, in
// place rather than on a screen of their own.
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronDown, Star } from 'lucide-react'
import type { SimilarArtistComparison, SongGap } from '../api'
import { songScoreColor } from '../types'
import { stagger } from '../lib/format'
import { GREEN, RECOMMEND, SECTION_LABEL } from './albumView'

const UP = GREEN       // you rate it higher
const DOWN = '#b5432f' // you rate it lower
const EVEN = '#8a8079' // neither of you is higher
// Anything under this rounds to 0.0 at one decimal, so it is drawn as agreement.
const ZERO_EPS = 0.05
// Below this a bar can't hold its own label, so the pill sets the floor.
const MIN_PILL = 52

function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null)
  const [w, setW] = useState(0)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setW(e.contentRect.width))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, w]
}

/** Shown wherever a comparison has nothing to compare against: the crowd
 *  doesn't exist yet, and the way to summon one is to send someone the record. */
export function NoComparisonYet({ title, body }: { title: string; body?: string }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-2xl border border-[#f97316]/25 bg-[#f97316]/[0.07] px-6 py-6 text-center">
      <Star size={20} color={RECOMMEND} fill={RECOMMEND} />
      <p className="m-0 max-w-md text-[14.5px] font-semibold text-[#1c1917]">{title}</p>
      {body && <p className="m-0 max-w-md text-[13px] text-[#8a7f72]">{body}</p>}
    </div>
  )
}

// ── Your average against Pressd's ─────────────────────────────────────────────

export function ScoreVersus({ mine, theirs, mineLabel }: { mine: number | null; theirs: number | null; mineLabel: string }) {
  const diff = mine != null && theirs != null ? mine - theirs : null
  const figure = (v: number | null) => (
    <p className="font-display m-0 text-[52px] font-bold leading-none tabular-nums" style={{ color: v != null ? songScoreColor(v) : '#c8c0b4' }}>
      {v != null ? v.toFixed(2) : '—'}
    </p>
  )
  return (
    <div className="mb-12 flex flex-wrap items-end gap-x-10 gap-y-4 rise-in" style={stagger(1)}>
      <div>
        {figure(mine)}
        <p className="m-0 mt-2 text-[11px] font-bold tracking-[0.16em] text-[#44403c]">{mineLabel}</p>
      </div>
      <div className="pb-6 text-center">
        <p className="font-display m-0 text-[18px] text-[#a8998a]">vs.</p>
        {diff != null && (
          <p className="m-0 text-[13px] font-bold tabular-nums" style={{ color: diff >= 0 ? UP : '#c0392b' }}>
            {diff >= 0 ? '+' : ''}{diff.toFixed(2)}
          </p>
        )}
      </div>
      <div>
        {figure(theirs)}
        <p className="m-0 mt-2 text-[11px] font-bold tracking-[0.16em] text-[#44403c]">PRESSD AVG SONG</p>
      </div>
    </div>
  )
}

// ── Where you split ───────────────────────────────────────────────────────────

/** The extremes of each side: the five you rate furthest above the crowd and
 *  the five furthest below. Ten or fewer, show them all. */
function selectGaps(gaps: SongGap[], perEnd = 5): SongGap[] {
  const signed = [...gaps].sort((a, b) => b.diff - a.diff)
  if (signed.length <= perEnd * 2) return signed
  return [...signed.slice(0, perEnd), ...signed.slice(-perEnd)]
}

/** Every shared track, most-rated first — mobile's splits page. Ties fall back
 *  to the loudest disagreement. */
function allGaps(gaps: SongGap[]): SongGap[] {
  return [...gaps].sort((a, b) => b.raters - a.raters || Math.abs(b.diff) - Math.abs(a.diff))
}

function GapRows({ rows }: { rows: SongGap[] }) {
  const [ref, plotW] = useWidth<HTMLDivElement>()
  const maxAbs = Math.max(...rows.map((r) => Math.abs(r.diff)), 0.1)
  const half = plotW / 2
  return (
    <ol className="m-0 -mx-4 list-none p-0">
      {rows.map((r, i) => {
        const zero = Math.abs(r.diff) < ZERO_EPS
        const up = r.diff >= 0
        const width = Math.max(MIN_PILL, Math.min((Math.abs(r.diff) / maxAbs) * half, half))
        const left = zero ? half - width / 2 : up ? half : half - width
        return (
          <li key={`${r.title}-${i}`} className="rise-in" style={stagger(i)}>
            <div className="flex items-center gap-4 rounded-2xl px-4 py-2 transition-colors hover:bg-[#f2eee7]">
              <span className="w-[38%] min-w-0 shrink-0 truncate text-[14px] text-[#1c1917]" title={r.title}>{r.title}</span>
              <div ref={i === 0 ? ref : undefined} className="relative h-7 flex-1">
                <span className="absolute inset-y-[-8px] left-1/2 w-px bg-[#e6ded2]" />
                {plotW > 0 && (
                  <span
                    className={`grow-x absolute top-0.5 flex h-6 items-center rounded-full px-2.5 text-[12px] font-bold tabular-nums text-white ${zero ? 'justify-center' : up ? 'justify-end' : 'justify-start'}`}
                    style={{
                      ...stagger(i),
                      left,
                      width,
                      background: zero ? EVEN : up ? UP : DOWN,
                      transformOrigin: zero ? 'center' : up ? 'left center' : 'right center',
                    }}
                  >
                    {zero ? '' : up ? '+' : '−'}{Math.abs(r.diff).toFixed(1)}
                  </span>
                )}
              </div>
              <span className="hidden w-24 shrink-0 text-right text-[12px] tabular-nums text-[#8a7f72] sm:block">
                {r.mine.toFixed(1)} · {r.theirs.toFixed(1)}
              </span>
            </div>
          </li>
        )
      })}
    </ol>
  )
}

export function SongGapChart({ gaps, artist }: { gaps: SongGap[]; artist: string }) {
  const [showAll, setShowAll] = useState(false)
  const preview = useMemo(() => selectGaps(gaps), [gaps])
  const summary = useMemo(() => {
    if (gaps.length === 0) return null
    const mean = gaps.reduce((s, g) => s + g.diff, 0) / gaps.length
    const hottest = gaps.reduce((m, g) => (Math.abs(g.diff) > Math.abs(m.diff) ? g : m), gaps[0])
    return { mean, hottest }
  }, [gaps])

  if (preview.length === 0 || !summary) {
    return (
      <NoComparisonYet
        title={`No one else has rated ${artist} yet — recommend an album to a friend to see a comparison!`}
        body={`Once a friend scores one of ${artist}’s songs, your splits show up here.`}
      />
    )
  }

  const rows = showAll ? allGaps(gaps) : preview
  return (
    <div>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-6">
        <div className="rise-in" style={stagger(0)}>
          <p className="font-display m-0 text-[30px] font-bold leading-none tabular-nums" style={{ color: summary.mean >= 0 ? UP : DOWN }}>
            {summary.mean >= 0 ? '+' : ''}{summary.mean.toFixed(2)}
          </p>
          <p className="m-0 mt-1.5 text-[12px] font-medium text-[#8a7f72]">Average gap vs Pressd</p>
        </div>
        <div className="max-w-[60%] text-right rise-in" style={stagger(1)}>
          <p className="font-display m-0 text-[30px] font-bold leading-tight" style={{ color: summary.hottest.diff >= 0 ? UP : DOWN }}>
            {summary.hottest.title}
          </p>
          <p className="m-0 mt-1.5 text-[12px] font-medium text-[#8a7f72]">Hottest take</p>
        </div>
      </div>

      {/* Laid out like a row, so the two labels sit over the plot column. */}
      <div className="mb-1 flex gap-4 text-[10px] font-bold tracking-[0.12em]">
        <span className="w-[38%] shrink-0" />
        <div className="flex flex-1 justify-between">
          <span style={{ color: DOWN }}>◀ YOU RATE LOWER</span>
          <span style={{ color: UP }}>YOU RATE HIGHER ▶</span>
        </div>
        <span className="hidden w-24 shrink-0 sm:block" />
      </div>
      <GapRows key={showAll ? 'all' : 'preview'} rows={rows} />

      {gaps.length > preview.length && (
        <button
          onClick={() => setShowAll((v) => !v)}
          className="mt-2 flex items-center gap-1 text-[13.5px] font-semibold text-[#2d6a4f] hover:underline underline-offset-2"
        >
          {showAll ? 'Show the extremes' : `See all ${gaps.length} shared tracks`}
          <ChevronDown size={15} className={`transition-transform ${showAll ? 'rotate-180' : ''}`} />
        </button>
      )}
    </div>
  )
}

// ── Your distribution over everyone else's ────────────────────────────────────

const YOU = '#f97316'
const THEM = GREEN
const LO = 1
const HI = 10
const STEPS = 96
const KDE_H = 180

/** Gaussian KDE on a fixed grid. Silverman's bandwidth, floored, so a handful
 *  of ratings doesn't turn into spikes that read as structure. Normalised per
 *  sample, so 30 ratings and 3,000 compare in shape rather than height. */
function density(values: number[]): number[] {
  if (values.length === 0) return new Array(STEPS).fill(0)
  const n = values.length
  const mean = values.reduce((a, b) => a + b, 0) / n
  const sd = n > 1 ? Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1)) : 0
  const bw = Math.max(0.35, 1.06 * sd * Math.pow(n, -1 / 5))
  const out: number[] = []
  for (let i = 0; i < STEPS; i++) {
    const x = LO + ((HI - LO) * i) / (STEPS - 1)
    let sum = 0
    for (const v of values) {
      const z = (x - v) / bw
      sum += Math.exp(-0.5 * z * z)
    }
    out.push(sum / (n * bw * Math.sqrt(2 * Math.PI)))
  }
  return out
}

function areaPath(d: number[], w: number, h: number, peak: number): string {
  if (peak <= 0) return ''
  let p = `M 0 ${h}`
  d.forEach((v, i) => { p += ` L ${((i / (STEPS - 1)) * w).toFixed(2)} ${(h - (v / peak) * h).toFixed(2)}` })
  return `${p} L ${w} ${h} Z`
}

export function ScoreKdeCompare({ mine, theirs, mineLabel }: { mine: number[]; theirs: number[]; mineLabel: string }) {
  const [ref, w] = useWidth<HTMLDivElement>()
  const { a, b, peak } = useMemo(() => {
    const a = density(mine)
    const b = density(theirs)
    // One shared scale, so a flat curve and a sharp one don't look equally concentrated.
    return { a, b, peak: Math.max(...a, ...b, 0.0001) }
  }, [mine, theirs])
  const avg = (v: number[]) => (v.length ? v.reduce((s, x) => s + x, 0) / v.length : null)
  const myAvg = avg(mine)
  const theirAvg = avg(theirs)
  const xAt = (s: number) => ((s - LO) / (HI - LO)) * w
  if (mine.length === 0) return null

  return (
    <div>
      <div className="mb-3 flex gap-5 text-[12px] text-[#8a7f72]">
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full" style={{ background: YOU }} />{mineLabel}</span>
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full" style={{ background: THEM }} />Everyone else</span>
      </div>
      <div ref={ref} className="fade-in" style={{ height: KDE_H }}>
        {w > 0 && (
          <svg width={w} height={KDE_H} className="block">
            {theirs.length > 0 && <path d={areaPath(b, w, KDE_H, peak)} fill={THEM} fillOpacity={0.22} stroke={THEM} strokeWidth={1.5} />}
            <path d={areaPath(a, w, KDE_H, peak)} fill={YOU} fillOpacity={0.22} stroke={YOU} strokeWidth={1.5} />
            {theirAvg != null && <line x1={xAt(theirAvg)} y1={0} x2={xAt(theirAvg)} y2={KDE_H} stroke={THEM} strokeDasharray="3 3" />}
            {myAvg != null && <line x1={xAt(myAvg)} y1={0} x2={xAt(myAvg)} y2={KDE_H} stroke={YOU} strokeDasharray="3 3" />}
          </svg>
        )}
      </div>
      <div className="mt-1.5 flex justify-between text-[11px] text-[#a8998a]">
        {[1, 4, 7, 10].map((t) => <span key={t}>{t}</span>)}
      </div>
    </div>
  )
}

// ── Neighbours worth comparing ────────────────────────────────────────────────

export function SimilarArtistComparisons({ rows }: { rows: SimilarArtistComparison[] }) {
  if (rows.length === 0) return null
  return (
    <section className="mt-12">
      <p className={`${SECTION_LABEL} mb-4`}>SEE MORE ARTIST COMPARISONS</p>
      {/* A scroller clips vertically, so the lift gets room inside it. */}
      <ul className="m-0 -my-3 flex list-none gap-5 overflow-x-auto p-0 py-3">
        {rows.map((r, i) => {
          const higher = r.top_gap.diff >= 0
          return (
            <li key={r.artist} className="w-40 shrink-0 rise-in" style={stagger(i)}>
              <Link to={`/artist/${encodeURIComponent(r.artist)}?mode=compare`} className="group block">
                <div className="relative aspect-square overflow-hidden rounded-2xl bg-[#ebe5dc] shadow-[0_14px_30px_-20px_rgba(40,25,10,0.55)] transition-transform duration-[250ms] ease-out group-hover:scale-[1.04] group-hover:-rotate-1">
                  <span className="font-display absolute inset-0 flex items-center justify-center text-[44px] text-[#a8998a]">{r.artist[0]?.toUpperCase()}</span>
                  {r.image_url && <img src={r.image_url} alt="" loading="lazy" className="absolute inset-0 h-full w-full object-cover" />}
                </div>
                <p className="m-0 mt-2.5 truncate text-[14px] font-semibold text-[#1c1917]">{r.artist}</p>
                <p className="m-0 mt-0.5 text-[12px] leading-snug text-[#8a7f72]">
                  You rate <span className="font-medium text-[#57534e]">{r.top_gap.title}</span>{' '}
                  <span className="font-bold" style={{ color: higher ? UP : DOWN }}>
                    {Math.abs(r.top_gap.diff).toFixed(1)} {higher ? 'higher' : 'lower'}
                  </span>{' '}
                  than Pressd
                </p>
              </Link>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
