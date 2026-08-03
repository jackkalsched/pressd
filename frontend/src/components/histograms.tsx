// Song-score histograms, drawn to match the mobile app.
//
// Two shapes, mirroring mobile/components/ScoreHistogram.tsx and
// mobile/components/ArtistChart.tsx: whole-point buckets for a quick read of
// someone's distribution, and 0.1-wide bins with a KDE overlay for an artist's
// full spread. Both tint bars along the app's red→green score gradient
// (songScoreColor), the same ramp the score pills use.
//
// Drawn by hand rather than with recharts so the web and the app agree down to
// the baseline rule and the axis labels — and so there's no chart library
// between the data and what's on screen.
import { useEffect, useRef, useState } from 'react'
import { songScoreColor } from '../types'

const MUTED = '#a8998a'
const RULE = '#e6ded2'

/** Bar colours run off the 1–10 ramp, so anything outside it (an empty
 *  low bin, a rounded-up 10) has to be pulled back in or the hue goes
 *  negative and the bar renders an unrelated colour. */
function barColor(score: number): string {
  return songScoreColor(Math.max(1, Math.min(10, score)))
}

// ── Whole-point buckets ───────────────────────────────────────────────────────

const BUCKETS = 9

/** Nine buckets — [1,2), [2,3) … [9,10]. Labels sit on the bucket *edges*, so a
 *  bar's range is read off the two numbers bracketing it (a perfect 10 folds
 *  into the last bucket, the usual closed-top-edge treatment). */
export function ScoreHistogram({ scores, height = 120 }: { scores: number[]; height?: number }) {
  const bins = Array.from({ length: BUCKETS }, () => 0)
  for (const s of scores) {
    bins[Math.max(0, Math.min(BUCKETS - 1, Math.floor(s) - 1))] += 1
  }
  const maxBin = Math.max(1, ...bins)

  return (
    <div>
      <div className="flex items-end gap-1" style={{ height }}>
        {bins.map((count, i) => (
          <div key={i} className="flex-1 flex items-end justify-center h-full">
            <div
              className="w-full"
              style={{
                height: Math.max(count > 0 ? 6 : 2, (count / maxBin) * height),
                background: barColor(i + 1),
                borderRadius: 3,
                opacity: 0.9,
              }}
            />
          </div>
        ))}
      </div>
      {/* space-between lands each label on a bar boundary — first at the left
          edge, last at the right — matching the app's axis treatment. */}
      <div className="flex justify-between" style={{ marginTop: 5 }}>
        {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
          <span key={n} style={{ fontSize: 10, color: MUTED }}>{n}</span>
        ))}
      </div>
    </div>
  )
}

// ── Fine bins with a KDE overlay ──────────────────────────────────────────────

// Below this the curve is mostly bandwidth artifact, not shape.
const KDE_MIN_SONGS = 30

function buildBins(scores: number[]): { score: number; count: number }[] {
  const counts = new Map<string, number>()
  for (const s of scores) {
    const key = (Math.round(s * 10) / 10).toFixed(1)
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  const bins: { score: number; count: number }[] = []
  for (let v = 10; v <= 100; v++) {
    bins.push({ score: v / 10, count: counts.get((v / 10).toFixed(1)) ?? 0 })
  }
  return bins
}

/** Gaussian KDE at each bin center, scaled to count units (density × n ×
 *  binWidth) so it shares the histogram's y-scale — never a second axis. */
function kdeOverlay(scores: number[], bins: { score: number }[]): number[] {
  const n = scores.length
  const mean = scores.reduce((a, b) => a + b, 0) / n
  const sd = Math.sqrt(scores.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1))
  const sorted = [...scores].sort((a, b) => a - b)
  const q = (p: number) => sorted[Math.min(n - 1, Math.floor(p * n))]
  const iqr = q(0.75) - q(0.25)
  const spread = Math.min(sd || Infinity, iqr / 1.34) || sd || 0.3
  // Silverman's rule, floored at 0.15: scores are quantized to 0.1, and a
  // narrower bandwidth just draws spikes on the quantization grid.
  const h = Math.max(0.9 * spread * Math.pow(n, -0.2), 0.15)
  const K = (u: number) => Math.exp(-0.5 * u * u) / Math.sqrt(2 * Math.PI)
  const binWidth = 0.1
  return bins.map(
    (b) => (scores.reduce((acc, s) => acc + K((b.score - s) / h), 0) / (n * h)) * n * binWidth,
  )
}

/** Element width, tracked so the SVG lays out in real pixels. Stretching a
 *  fixed viewBox instead would distort the KDE stroke and the axis labels. */
function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [w, setW] = useState(0)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    setW(el.getBoundingClientRect().width)
    const ro = new ResizeObserver(([entry]) => setW(entry.contentRect.width))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, w] as const
}

/** An artist's full spread: 1.0–10.0 in 0.1 bins, with a smoothed density
 *  curve once there are enough songs for it to mean anything. */
export function ScoreDistribution({
  scores,
  height = 200,
  caption = 'Song-score distribution',
}: {
  scores: number[]
  height?: number
  caption?: string
}) {
  const [ref, width] = useWidth<HTMLDivElement>()

  const bins = buildBins(scores)
  const showKde = scores.length >= KDE_MIN_SONGS
  const kde = showKde ? kdeOverlay(scores, bins) : []

  const padTop = 10
  const padBottom = 22
  const plotH = height - padTop - padBottom
  const maxCount = Math.max(1, ...bins.map((b) => b.count), ...kde)
  const barW = width / bins.length
  const y = (v: number) => padTop + plotH - (v / maxCount) * plotH
  const x = (i: number) => i * barW

  let kdePath = ''
  if (showKde && width > 0) {
    kde.forEach((v, i) => {
      kdePath += `${i === 0 ? 'M' : 'L'}${(x(i) + barW / 2).toFixed(1)},${y(v).toFixed(1)} `
    })
  }

  return (
    <div ref={ref}>
      {width > 0 && (
        <svg width={width} height={height} style={{ display: 'block' }}>
          {bins.map((b, i) =>
            b.count > 0 ? (
              <rect
                key={i}
                x={x(i) + 0.5}
                y={y(b.count)}
                width={Math.max(1, barW - 1)}
                height={padTop + plotH - y(b.count)}
                fill={barColor(b.score)}
                opacity={0.85}
                rx={0.5}
              />
            ) : null,
          )}
          {showKde && kdePath && (
            <path d={kdePath.trim()} stroke="#57534e" strokeWidth={2} strokeOpacity={0.75} fill="none" />
          )}
          <line x1={0} y1={padTop + plotH} x2={width} y2={padTop + plotH} stroke={RULE} strokeWidth={1} />
          {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
            <text
              key={n}
              x={x((n - 1) * 10) + barW / 2}
              y={height - 6}
              fontSize={9}
              fill={MUTED}
              textAnchor="middle"
            >
              {n}
            </text>
          ))}
        </svg>
      )}
      <p className="text-center" style={{ fontSize: 11, color: MUTED, marginTop: 4 }}>
        {caption}{showKde ? ' — curve: smoothed density (KDE)' : ''}
      </p>
    </div>
  )
}
