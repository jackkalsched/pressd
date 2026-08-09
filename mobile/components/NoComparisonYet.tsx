// Shown wherever a comparison has nothing to compare against.
//
// The honest reading of "nobody else has rated this" is not an empty chart or a
// zero gap — it's that the crowd doesn't exist yet, and the way to summon one
// is to send the record to someone. So the empty state is the ask.
//
// Shared by the artist Compare tab and the album community view so the two say
// the same thing in the same words.
import { StyleSheet, Text, View } from 'react-native'
import { Star } from 'lucide-react-native'
import { colors, fonts, radii, spacing } from '../theme/tokens'

const REC = '#f97316'

export default function NoComparisonYet({
  title,
  body,
}: {
  title: string
  body?: string
}) {
  return (
    <View style={styles.wrap}>
      <Star size={20} color={REC} fill={REC} />
      <Text style={styles.title}>{title}</Text>
      {body ? <Text style={styles.body}>{body}</Text> : null}
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    gap: spacing.sm,
    // Translucent rather than a solid fill: on the album page this sits over
    // the record's backdrop, and a flat panel punched a hole in it. A light
    // wash keeps the art readable underneath while still reading as a cell.
    backgroundColor: 'rgba(249,115,22,0.09)',
    borderWidth: 1,
    borderColor: 'rgba(249,115,22,0.24)',
    borderRadius: radii.lg,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xl,
  },
  title: {
    fontFamily: fonts.display,
    fontSize: 17,
    color: colors.ink,
    textAlign: 'center',
    lineHeight: 24,
  },
  body: {
    fontFamily: fonts.body,
    fontSize: 12.5,
    lineHeight: 18,
    color: colors.inkTertiary,
    textAlign: 'center',
  },
})
