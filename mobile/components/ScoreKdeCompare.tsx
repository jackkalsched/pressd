// Your score distribution laid over everyone else's.
//
// Two smoothed curves rather than the binned histogram Compare used to show:
// bins force a shared bucket width on two sets of very different size, and the
// shape you actually want to read — where your mass sits against theirs — is
// the thing bin edges destroy. Filled translucently so the overlap is visible
// as overlap rather than one curve hiding behind the other.
import { useMemo, useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import Svg, { Path, Line } from 'react-native-svg'
import { colors, fonts, spacing } from '../theme/tokens'

const YOU = '#f97316'    // orange — you
const THEM = '#2d6a4f'   // green  — everyone else
const FILL = 0.28        // low enough that the overlap reads as a third tone

const LO = 1
const HI = 10
const STEPS = 96
const HEIGHT = 150

/** Gaussian KDE sampled on a fixed grid.
 *
 *  Silverman's rule for the bandwidth, floored: a handful of ratings gives a
 *  tiny spread and an unfloored bandwidth turns each one into a spike, which
 *  reads as structure that isn't there.
 */
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
    // Normalised per-sample, so a curve built from 30 ratings and one built
    // from 3,000 are comparable in shape rather than in raw height.
    out.push(sum / (n * bw * Math.sqrt(2 * Math.PI)))
  }
  return out
}

function areaPath(d: number[], w: number, h: number, peak: number): string {
  if (peak <= 0) return ''
  const x = (i: number) => (i / (STEPS - 1)) * w
  const y = (v: number) => h - (v / peak) * h
  let p = `M 0 ${h}`
  for (let i = 0; i < d.length; i++) p += ` L ${x(i).toFixed(2)} ${y(d[i]).toFixed(2)}`
  return `${p} L ${w} ${h} Z`
}

export default function ScoreKdeCompare({
  mine,
  theirs,
}: {
  mine: number[]
  theirs: number[]
}) {
  const [w, setW] = useState(0)

  const { mineD, theirsD, peak } = useMemo(() => {
    const a = density(mine)
    const b = density(theirs)
    // One shared vertical scale — scaling each curve to its own maximum would
    // make a flat distribution and a sharp one look equally concentrated.
    return { mineD: a, theirsD: b, peak: Math.max(...a, ...b, 0.0001) }
  }, [mine, theirs])

  const avg = (v: number[]) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : null)
  const myAvg = avg(mine)
  const theirAvg = avg(theirs)
  const xAt = (score: number) => ((score - LO) / (HI - LO)) * w

  if (mine.length === 0) return null

  return (
    <View>
      <View style={styles.legend}>
        <View style={styles.legendItem}>
          <View style={[styles.swatch, { backgroundColor: YOU }]} />
          <Text style={styles.legendText}>You</Text>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.swatch, { backgroundColor: THEM }]} />
          <Text style={styles.legendText}>Everyone else</Text>
        </View>
      </View>

      <View style={styles.plot} onLayout={(e) => setW(e.nativeEvent.layout.width)}>
        {w > 0 && (
          <Svg width={w} height={HEIGHT}>
            {/* Theirs underneath: it's the reference your curve is read against. */}
            {theirs.length > 0 && (
              <Path d={areaPath(theirsD, w, HEIGHT, peak)} fill={THEM} fillOpacity={FILL} stroke={THEM} strokeWidth={1.5} />
            )}
            <Path d={areaPath(mineD, w, HEIGHT, peak)} fill={YOU} fillOpacity={FILL} stroke={YOU} strokeWidth={1.5} />
            {/* Mean lines — where each curve's centre of mass actually sits. */}
            {theirAvg != null && (
              <Line x1={xAt(theirAvg)} y1={0} x2={xAt(theirAvg)} y2={HEIGHT} stroke={THEM} strokeWidth={1} strokeDasharray="3 3" />
            )}
            {myAvg != null && (
              <Line x1={xAt(myAvg)} y1={0} x2={xAt(myAvg)} y2={HEIGHT} stroke={YOU} strokeWidth={1} strokeDasharray="3 3" />
            )}
          </Svg>
        )}
      </View>

      <View style={styles.axis}>
        {[1, 4, 7, 10].map((t) => (
          <Text key={t} style={styles.tick}>{t}</Text>
        ))}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  legend: { flexDirection: 'row', gap: spacing.lg, marginBottom: spacing.sm },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  swatch: { width: 10, height: 10, borderRadius: 2 },
  legendText: { fontFamily: fonts.bodyMedium, fontSize: 11.5, color: colors.inkTertiary },
  plot: { height: HEIGHT, width: '100%' },
  axis: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 },
  tick: { fontFamily: fonts.body, fontSize: 10, color: colors.inkMuted },
})
