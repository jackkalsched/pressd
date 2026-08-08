// Asked once, at the end of rating an album, when more than one track shares
// the album's highest score.
//
// Everything downstream that names a "top song" — the review feed, the share
// card — has to pick one, and until now it took whichever tied track happened
// to sort first. That is a coin toss the person who did the rating is far
// better placed to call, so we call it here, while the record is still fresh in
// their head, rather than silently.
//
// Skipping is a real answer: it leaves the pick unset and everything falls back
// to the old highest-score behaviour.
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { Star } from 'lucide-react-native'
import { songScoreColor } from '@pressd/shared/types'
import type { Song } from '@pressd/shared/types'
import { colors, fonts, radii, screenHeight, spacing } from '../theme/tokens'

/** "both these songs" reads wrong the moment a third track ties. */
function countPhrase(n: number): string {
  if (n === 2) return 'both these songs'
  return `all ${n} of these songs`
}

export default function TopSongTiebreak({
  visible,
  songs,
  score,
  busy,
  onPick,
  onSkip,
}: {
  visible: boolean
  songs: Song[]
  score: number
  busy: boolean
  onPick: (songId: number) => void
  onSkip: () => void
}) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onSkip}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <View style={styles.badge}>
            <Star size={16} color={colors.green} fill={colors.green} strokeWidth={0} />
          </View>

          <Text style={styles.title}>It&rsquo;s a tie</Text>
          <Text style={styles.body}>
            You rated {countPhrase(songs.length)} a{' '}
            <Text style={[styles.bodyScore, { color: songScoreColor(score) }]}>{score.toFixed(1)}</Text>.
            Which one was your favorite?
          </Text>

          {/* Scrolls rather than grows: a record can tie four or five tracks at
              the top, and the card still has to fit a short screen. */}
          <ScrollView style={{ maxHeight: Math.round(screenHeight * 0.34) }} bounces={false}>
            {songs.map((s) => (
              <Pressable
                key={s.id}
                style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
                onPress={() => onPick(s.id)}
                disabled={busy}
                accessibilityRole="button"
                accessibilityLabel={`Pick ${s.title} as your favorite`}
              >
                <Text style={styles.trackNum} numberOfLines={1} maxFontSizeMultiplier={1.3}>
                  {s.trackNumber}
                </Text>
                <Text style={styles.trackName} numberOfLines={2}>{s.title}</Text>
              </Pressable>
            ))}
          </ScrollView>

          {/* Not a cancel: it's the honest answer when they genuinely rate the
              tracks the same, so it says so rather than "Cancel". */}
          <Pressable onPress={onSkip} disabled={busy} style={styles.skip} hitSlop={8}>
            <Text style={styles.skipText}>I can&rsquo;t choose</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(28,25,23,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
  },
  card: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: colors.bg,
    borderRadius: radii.xl,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.md,
  },
  badge: {
    width: 34,
    height: 34,
    borderRadius: radii.pill,
    backgroundColor: colors.greenSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontFamily: fonts.display,
    fontSize: 24,
    color: colors.ink,
    marginTop: spacing.md,
  },
  body: {
    fontFamily: fonts.body,
    fontSize: 14.5,
    lineHeight: 21,
    color: colors.inkTertiary,
    marginTop: spacing.xs,
    marginBottom: spacing.md,
  },
  bodyScore: { fontFamily: fonts.bodyBold },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.raised,
    marginBottom: spacing.sm,
  },
  rowPressed: { borderColor: colors.green, backgroundColor: colors.greenSoft },
  // minWidth, not width — a double-digit track number has somewhere to go.
  trackNum: {
    fontFamily: fonts.display,
    fontSize: 16,
    color: colors.inkMuted,
    minWidth: 22,
    textAlign: 'center',
  },
  trackName: { flex: 1, minWidth: 0, fontFamily: fonts.bodySemiBold, fontSize: 15, color: colors.ink },
  skip: { alignItems: 'center', paddingVertical: spacing.md },
  skipText: { fontFamily: fonts.bodyMedium, fontSize: 14, color: colors.inkTertiary },
})
