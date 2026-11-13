// A bin as a card — For You's BINS section and the Bins page. Its cover is the
// owner's own picture when a user bin has one, else a 2×2 of the bin's first
// four records, never the source's artwork — on a bin Pressd made, with the
// full-colour Pressd mark on a cream chip in its lower-right corner — then the
// title, the source or its maker, and how far through it you are, as a bar
// and "22 / 100".
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { Lock } from 'lucide-react-native'
import type { BinCard as Bin } from '../lib/api'
import { binByline } from '../lib/bins'
import { colors, fonts, NUM_SCALE_CAP, radii, spacing, useColors } from '../theme/tokens'
import CoverImage from './CoverImage'
import PressdBinBadge from './PressdBinBadge'

const MOSAIC = 84

/** The 2×2 of a bin's first four covers, or the owner's own picture
 *  (`coverUrl`) in its place. `pressd` adds the official chip: the full-colour
 *  Pressd mark on cream in the lower-right corner. */
export function BinMosaic({ covers, size, pressd = false, coverUrl = null, radius = radii.md }: {
  covers: string[]
  size: number
  pressd?: boolean
  coverUrl?: string | null
  radius?: number
}) {
  const cell = size / 2
  const chip = Math.max(28, size * 0.38)
  if (coverUrl) {
    return (
      <CoverImage url={coverUrl} displayPx={size} style={{ width: size, height: size, borderRadius: radius, backgroundColor: colors.inset }} />
    )
  }
  return (
    <View style={{ width: size, height: size }}>
      <View style={[styles.mosaic, { width: size, height: size, borderRadius: radius }]}>
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
  const tc = useColors()
  const done = bin.progress.rated
  const byline = binByline(bin)
  // Only ever your own: nobody else is shown a private bin.
  const isPrivate = bin.kind === 'user' && bin.visibility === 'private'
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.card, pressed && { opacity: 0.7 }]}
      accessibilityRole="button"
      accessibilityLabel={`${bin.title}: ${done} of ${bin.progress.total} rated`}
    >
      <BinMosaic covers={bin.covers} size={MOSAIC} pressd={bin.kind === 'curated'} coverUrl={bin.coverUrl} />
      <View style={styles.text}>
        <Text style={styles.title} numberOfLines={2}>{bin.title}</Text>
        {(byline || isPrivate) && (
          <View style={styles.bylineRow}>
            {byline && <Text style={styles.source} numberOfLines={1}>{byline}</Text>}
            {isPrivate && (
              <View style={styles.private}>
                <Lock size={10} color={tc.inkSecondary} strokeWidth={2.6} />
                <Text style={styles.privateText}>Private</Text>
              </View>
            )}
          </View>
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
  mosaic: { flexDirection: 'row', flexWrap: 'wrap', overflow: 'hidden' },
  text: { flex: 1, minWidth: 0 },
  chip: { position: 'absolute', right: 4, bottom: 4 },
  title: { fontFamily: fonts.display, fontSize: 18, lineHeight: 23, color: colors.ink },
  bylineRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: 2 },
  source: { flexShrink: 1, fontFamily: fonts.bodyMedium, fontSize: 13, color: colors.inkSecondary },
  private: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    paddingHorizontal: 7, paddingVertical: 2, borderRadius: radii.pill, backgroundColor: colors.inset,
  },
  privateText: { fontFamily: fonts.bodySemiBold, fontSize: 11, color: colors.inkSecondary },
  progressRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.sm },
  track: { flex: 1, height: 5, borderRadius: 3, overflow: 'hidden' },
  fill: { height: 5, borderRadius: 3 },
  count: { fontFamily: fonts.bodySemiBold, fontSize: 12, color: colors.inkSecondary, fontVariant: ['tabular-nums'] },
})
