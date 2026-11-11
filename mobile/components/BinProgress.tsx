// A bin's progress on its page: "22 of 100 rated" and a strip of one cell per record in the list's order — green where you've
// rated it, a pale tint where it's in your library, empty otherwise — so the
// fills sit where your records sit in the list. Fifty to a row. Web's
// components/BinProgress.tsx; the cells come from shared/src/binSort.ts.
import { StyleSheet, Text, View, useWindowDimensions } from 'react-native'
import type { BinEntry } from '../lib/api'
import { binCells } from '@pressd/shared/binSort'
import { colors, fonts, NUM_SCALE_CAP, spacing, useColors } from '../theme/tokens'

const PER_ROW = 50
const GAP = 2

export default function BinProgress({ entries }: { entries: BinEntry[] }) {
  const tc = useColors()
  const { width } = useWindowDimensions()
  const cells = binCells(entries)
  const rated = cells.filter((c) => c === 'rated').length
  const cell = (width - spacing.lg * 2 - GAP * (PER_ROW - 1)) / PER_ROW

  return (
    <View>
      <View style={styles.top}>
        <Text style={styles.count} maxFontSizeMultiplier={NUM_SCALE_CAP}>
          <Text style={styles.countStrong}>{rated}</Text> of {cells.length} rated
        </Text>
      </View>
      <View style={styles.grid} accessibilityLabel={`${rated} of ${cells.length} rated`}>
        {cells.map((c, i) => (
          <View
            key={i}
            style={{
              width: cell,
              height: 9,
              borderRadius: 1.5,
              backgroundColor: c === 'empty' ? tc.inset : tc.green,
              opacity: c === 'saved' ? 0.3 : 1,
            }}
          />
        ))}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  top: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: spacing.sm },
  count: { fontFamily: fonts.bodyMedium, fontSize: 15, color: colors.inkSecondary },
  countStrong: { fontFamily: fonts.bodyBold, color: colors.ink },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: GAP },
})
