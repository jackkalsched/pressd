// The door into a record's discussion, sized to sit beside the rating CTA.
//
// It carries two jobs because they are the same job from the reader's side:
// with no review written it invites you to write one, and once you have it
// takes you to what everyone else said. Writing a review does not need the
// thread's gate — that is your own copy of the record — so only the second
// state can be locked. PLAN_discussions.md §10, §4.1.
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { useRouter } from 'expo-router'
import { useQuery } from '@tanstack/react-query'
import { Lock, MessageCircle, Pencil } from 'lucide-react-native'
import { resolveThread } from '../lib/api'
import { threadKey } from '../lib/refresh'
import { colors, fonts, radii, spacing } from '../theme/tokens'

export default function AlbumThoughts({
  album,
  artist,
  hasReview,
  onWriteReview,
}: {
  album: string
  artist: string
  hasReview: boolean
  onWriteReview: () => void
}) {
  const router = useRouter()
  const { data: meta } = useQuery({
    queryKey: threadKey('album', artist, album),
    queryFn: () => resolveThread({ subjectType: 'album', artist, album }),
    // A thread is a nicety on this page; a failure should leave the album
    // readable rather than retrying at it.
    retry: false,
  })

  const canRead = !!meta?.canRead
  const locked = hasReview && !canRead

  const label = !hasReview
    ? 'Write a review!'
    : locked
      ? 'Finish rating to discuss'
      : 'See what pressers are saying'

  return (
    <Pressable
      disabled={locked}
      onPress={() => {
        if (!hasReview) return onWriteReview()
        router.push({
          pathname: '/thread/[subject]',
          params: { subject: 'album', artist, album, title: album },
        })
      }}
      style={({ pressed }) => [styles.btn, locked && styles.locked, pressed && !locked && { opacity: 0.85 }]}
    >
      <View style={styles.row}>
        {locked ? (
          <Lock size={14} color={colors.inkMuted} />
        ) : hasReview ? (
          <MessageCircle size={15} color={colors.green} />
        ) : (
          <Pencil size={14} color={colors.green} />
        )}
        <Text style={[styles.label, locked && styles.labelLocked]} numberOfLines={2}>
          {label}
        </Text>
      </View>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  btn: {
    flex: 1,
    backgroundColor: colors.greenSoft,
    borderRadius: radii.md,
    paddingVertical: 12,
    paddingHorizontal: spacing.md,
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
  },
  locked: { backgroundColor: colors.inset },
  row: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  label: {
    flexShrink: 1,
    fontFamily: fonts.bodySemiBold,
    fontSize: 13,
    lineHeight: 17,
    color: colors.green,
  },
  labelLocked: { color: colors.inkMuted },
})
