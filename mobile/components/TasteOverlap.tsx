// How alike your taste and someone else's is, on their profile (spec §5.1). The
// mobile twin of frontend/src/components/TasteOverlap.tsx.
//
// A small outlined pill under the bio, the same for a friend and a stranger:
// your own face, then the number with "taste overlap" — theirs is already at the
// top of the page. A figure to read, not a control. Until November 2026 it was a
// filled pill with both faces and the shared records' covers, which made the
// header look crowded. 50% is drawn like any other number: a
// pair with no evidence and a pair measured at the middle look the same on purpose.
import { StyleSheet, Text, View } from 'react-native'
import Avatar from './Avatar'
import type { Overlap } from '@pressd/shared/types'
import { colors, fonts, radii, spacing, NUM_SCALE_CAP, useColors } from '../theme/tokens'

export function OverlapPill({ overlap, me }: {
  overlap: Overlap
  /** You, whose face leads the pill. */
  me: { name: string; avatarUrl?: string | null }
}) {
  const tc = useColors()
  if (overlap.percent == null) return null
  return (
    <View
      // The outline's colour is set here, not in the stylesheet: iOS draws a
      // light-and-dark border colour wrongly (CLAUDE.md, dark mode).
      style={[styles.stat, { borderColor: tc.border }]}
      accessible
      accessibilityLabel={`${overlap.percent}% taste overlap`}
    >
      <Avatar name={me.name} avatarUrl={me.avatarUrl} size={26} />
      <Text style={styles.percent} maxFontSizeMultiplier={NUM_SCALE_CAP}>{overlap.percent}%</Text>
      <Text style={styles.label} numberOfLines={1} maxFontSizeMultiplier={NUM_SCALE_CAP}>taste overlap</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  stat: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: spacing.md,
    marginLeft: 8,
    paddingVertical: 5,
    paddingLeft: 5,
    paddingRight: 14,
    borderRadius: radii.pill,
    borderWidth: 1,
  },
  percent: { fontFamily: fonts.display, fontSize: 22, lineHeight: 27, color: colors.green, fontVariant: ['tabular-nums'] },
  label: { fontFamily: fonts.bodyMedium, fontSize: 13, color: colors.inkTertiary },
})
