// Song-score distribution: nine whole-point buckets — [1,2), [2,3) … [9,10] —
// each bar tinted along the app's red→green score gradient. Labels sit on the
// bucket *edges*, so a bar's range is read off the two numbers bracketing it
// (a perfect 10 folds into the last bucket, the usual closed-top-edge
// treatment). Shared by Profile → Stats and the artist pages.
import { StyleSheet, Text, View } from 'react-native'
import { songScoreColor } from '@pressd/shared/types'
import { colors, fonts } from '../theme/tokens'

const BUCKETS = 9

export default function ScoreHistogram({ scores, height = 120 }: { scores: number[]; height?: number }) {
  const bins = Array.from({ length: BUCKETS }, () => 0)
  for (const s of scores) {
    bins[Math.max(0, Math.min(BUCKETS - 1, Math.floor(s) - 1))] += 1
  }
  const maxBin = Math.max(1, ...bins)

  return (
    <View>
      <View style={[styles.chart, { height }]}>
        {bins.map((count, i) => (
          <View key={i} style={styles.col}>
            <View
              style={[
                styles.bar,
                {
                  height: Math.max(count > 0 ? 6 : 2, (count / maxBin) * height),
                  backgroundColor: songScoreColor(i + 1),
                },
              ]}
            />
          </View>
        ))}
      </View>
      <View style={styles.axis}>
        {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
          <Text key={n} style={styles.axisLabel}>{n}</Text>
        ))}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  chart: { flexDirection: 'row', alignItems: 'flex-end', gap: 4 },
  col: { flex: 1, alignItems: 'center', justifyContent: 'flex-end' },
  bar: { width: '100%', borderRadius: 3, opacity: 0.9 },
  // space-between lands each label on a bar boundary (first at the left edge,
  // last at the right), matching the comparison rail's axis treatment.
  axis: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 5 },
  axisLabel: { fontFamily: fonts.body, fontSize: 10, color: colors.inkMuted },
})
