// A bin as a card — For You's BINS section and the Bins page. Its cover is a
// 2×2 of the bin's first four records, never the source's artwork — on a bin
// Pressd made, with the full-colour Pressd mark on a cream chip in its
// lower-right corner — then the title, the source, and how far through it you
// are, as a bar and "22 / 100".
import { Pressable, StyleSheet, Text, View } from 'react-native'
import type { BinCard as Bin } from '../lib/api'
import { colors, fonts, NUM_SCALE_CAP, radii, spacing, useColors } from '../theme/tokens'
import CoverImage from './CoverImage'
import PressdBinBadge from './PressdBinBadge'

const MOSAIC = 84

/** The 2×2 of a bin's first four covers. `pressd` adds the official chip: the
 *  full-colour Pressd mark on cream in the lower-right corner. */
export function BinMosaic({ covers, size, pressd = false }: { covers: string[]; size: number; pressd?: boolean }) {
  const cell = size / 2
  const chip = Math.max(28, size * 0.38)
  return (
    <View style={{ width: size, height: size }}>
      <View style={[styles.mosaic, { width: size, height: size }]}>
        {[0, 1, 2, 3].map((i) =>
          covers[i] ? (
            <CoverImage key={i} url={covers[i]} displayPx={Math.ceil(cell)} style={{ width: cell, height: cell }} />
          ) : (
            <View key={i} style={{ width: cell, height: cell, backgroundColor: colors.inset }} />
          ),
        )}
      </View>
      {pressd && <PressdBinBadge width={chip} style={styles.chip} />}
    </View>
  )
}

export function BinProgressBar({ done, total }: { done: number; total: number }) {
  const tc = useColors()
  const pct = total ? Math.min(100, (done / total) * 100) : 0
  return (
    <View style={[styles.track, { backgroundColor: tc.inset }]}>
      <View style={[styles.fill, { width: `${pct}%`, backgroundColor: tc.green }]} />
    </View>
  )
}

export default function BinCard({ bin, onPress }: { bin: Bin; onPress: () => void }) {
  const done = bin.progress.rated
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.card, pressed && { opacity: 0.7 }]}
      accessibilityRole="button"
      accessibilityLabel={`${bin.title}: ${done} of ${bin.progress.total} rated`}
    >
      <BinMosaic covers={bin.covers} size={MOSAIC} pressd={bin.kind === 'curated'} />
      <View style={styles.text}>
        <Text style={styles.title} numberOfLines={2}>{bin.title}</Text>
        {bin.sourceName && (
          <Text style={styles.source} numberOfLines={1}>
            {bin.sourceName}{bin.sourceYear ? ` · ${bin.sourceYear}` : ''}
          </Text>
        )}
        <View style={styles.progressRow}>
          <BinProgressBar done={done} total={bin.progress.total} />
          <Text style={styles.count} maxFontSizeMultiplier={NUM_SCALE_CAP}>
            {done} / {bin.progress.total}
          </Text>
        </View>
      </View>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  card: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  mosaic: { flexDirection: 'row', flexWrap: 'wrap', borderRadius: radii.md, overflow: 'hidden' },
  text: { flex: 1, minWidth: 0 },
  chip: { position: 'absolute', right: 4, bottom: 4 },
  title: { fontFamily: fonts.display, fontSize: 18, lineHeight: 23, color: colors.ink },
  source: { marginTop: 2, fontFamily: fonts.bodyMedium, fontSize: 13, color: colors.inkSecondary },
  progressRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.sm },
  track: { flex: 1, height: 5, borderRadius: 3, overflow: 'hidden' },
  fill: { height: 5, borderRadius: 3 },
  count: { fontFamily: fonts.bodySemiBold, fontSize: 12, color: colors.inkSecondary, fontVariant: ['tabular-nums'] },
})
