// Song-score distribution for an artist: a fine-grained histogram (1.0–10.0 in
// 0.1 bins) with a Gaussian KDE overlay once there are enough songs for the
// curve to mean something. Ported from the web ArtistPage; drawn with SVG so it
// stays light (no charting dep). The KDE is scaled to the histogram's count
// axis, so both share one y-scale (never a dual axis).
import { View, Text, StyleSheet } from 'react-native'
import Svg, { Rect, Path, Line, Text as SvgText } from 'react-native-svg'
import { colors, fonts, spacing } from '../theme/tokens'

const KDE_MIN_SONGS = 30

function histColor(score: number): string {
  if (score >= 8.0) return '#1a7a3c' // bang — forest green
  if (score < 6.5) return '#c0392b' // skip — dark red
  return '#7a9e78' // middle — muted sage
}

function buildBins(scores: number[]): { score: number; count: number }[] {
  const counts = new Map<string, number>()
  for (const s of scores) {
    const label = s.toFixed(1)
    counts.set(label, (counts.get(label) ?? 0) + 1)
  }
  const bins: { score: number; count: number }[] = []
  for (let v = 10; v <= 100; v++) {
    bins.push({ score: v / 10, count: counts.get((v / 10).toFixed(1)) ?? 0 })
  }
  return bins
}

/** Gaussian KDE at each bin center, scaled to count units (density × n × binWidth). */
function kdeOverlay(scores: number[], bins: { score: number }[]): number[] {
  const n = scores.length
  const mean = scores.reduce((a, b) => a + b, 0) / n
  const sd = Math.sqrt(scores.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1))
  const sorted = [...scores].sort((a, b) => a - b)
  const q = (p: number) => sorted[Math.min(n - 1, Math.floor(p * n))]
  const iqr = q(0.75) - q(0.25)
  const spread = Math.min(sd || Infinity, iqr / 1.34) || sd || 0.3
  const h = Math.max(0.9 * spread * Math.pow(n, -0.2), 0.15)
  const K = (u: number) => Math.exp(-0.5 * u * u) / Math.sqrt(2 * Math.PI)
  const binWidth = 0.1
  return bins.map(
    (b) => (scores.reduce((acc, s) => acc + K((b.score - s) / h), 0) / (n * h)) * n * binWidth,
  )
}

export default function ArtistChart({ scores, width }: { scores: number[]; width: number }) {
  if (scores.length === 0) return null

  const height = 170
  const padBottom = 22
  const padTop = 10
  const plotH = height - padBottom - padTop
  const bins = buildBins(scores)
  const showKde = scores.length >= KDE_MIN_SONGS
  const kde = showKde ? kdeOverlay(scores, bins) : []

  const maxCount = Math.max(1, ...bins.map((b) => b.count), ...kde)
  const barW = width / bins.length
  const y = (v: number) => padTop + plotH - (v / maxCount) * plotH
  const x = (i: number) => i * barW

  // KDE path
  let kdePath = ''
  if (showKde) {
    kde.forEach((v, i) => {
      const px = x(i) + barW / 2
      const py = y(v)
      kdePath += `${i === 0 ? 'M' : 'L'}${px.toFixed(1)},${py.toFixed(1)} `
    })
  }

  return (
    <View>
      <Svg width={width} height={height}>
        {/* Bars */}
        {bins.map((b, i) =>
          b.count > 0 ? (
            <Rect
              key={i}
              x={x(i) + 0.5}
              y={y(b.count)}
              width={Math.max(1, barW - 1)}
              height={padTop + plotH - y(b.count)}
              fill={histColor(b.score)}
              opacity={0.85}
              rx={0.5}
            />
          ) : null,
        )}
        {/* KDE curve */}
        {showKde && kdePath ? (
          <Path d={kdePath.trim()} stroke="#57534e" strokeWidth={2} strokeOpacity={0.75} fill="none" />
        ) : null}
        {/* Baseline */}
        <Line x1={0} y1={padTop + plotH} x2={width} y2={padTop + plotH} stroke={colors.border} strokeWidth={1} />
        {/* X labels at integers 1..10 */}
        {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => {
          const i = (n - 1) * 10 // bin index for integer score
          return (
            <SvgText
              key={n}
              x={x(i) + barW / 2}
              y={height - 6}
              fontSize={9}
              fill={colors.inkMuted}
              textAnchor="middle"
            >
              {n}
            </SvgText>
          )
        })}
      </Svg>
      <Text style={styles.caption}>
        Song-score distribution{showKde ? ' — curve: smoothed density (KDE)' : ''}
      </Text>
    </View>
  )
}

const styles = StyleSheet.create({
  caption: {
    fontFamily: fonts.body,
    fontSize: 11,
    color: colors.inkMuted,
    textAlign: 'center',
    marginTop: spacing.xs,
  },
})
