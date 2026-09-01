// The line under the rating button that leads into a record's discussion.
//
// Two jobs, because from the reader's side they are one: with no review written
// it invites you to write one, and once you have it takes you to what everyone
// else said. Writing a review does not need the thread's gate — that is your
// own copy of the record — so only the second state can lock.
// PLAN_discussions.md §10, §4.1.
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { useRouter } from 'expo-router'
import { useQuery } from '@tanstack/react-query'
import { ChevronRight, Lock, MessageCircle, MessageCirclePlus } from 'lucide-react-native'
import { resolveThread } from '../lib/api'
import { threadKey } from '../lib/refresh'
import { colors, fonts, spacing } from '../theme/tokens'

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
  const people = meta?.participantCount ?? 0
  const locked = hasReview && !canRead

  const label = !hasReview
    ? 'Write a review!'
    : locked
      ? 'Finish rating to discuss'
      : people > 0
        ? `${people} ${people === 1 ? 'presser' : 'pressers'} weighed in`
        : 'Be the first to weigh in'

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
      style={({ pressed }) => [styles.row, pressed && !locked && { opacity: 0.6 }]}
    >
      {locked ? (
        <Lock size={16} color={colors.inkMuted} />
      ) : hasReview ? (
        <MessageCircle size={17} color={colors.green} />
      ) : (
        // Not a pencil: the rating button directly above already uses one, and
        // two identical icons stacked read as the same action twice. This row
        // is always about the conversation, so it keeps to that family.
        <MessageCirclePlus size={17} color={colors.green} />
      )}
      <Text style={[styles.label, locked && styles.labelLocked]} numberOfLines={1}>
        {label}
      </Text>
      <View style={{ flex: 1 }} />
      {!locked && <ChevronRight size={18} color={colors.green} />}
    </Pressable>
  )
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    marginTop: spacing.sm,
    // Closes the block off from TRACKS below, the way the tracklist rows are
    // separated from each other.
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  label: { fontFamily: fonts.bodySemiBold, fontSize: 16, color: colors.green },
  labelLocked: { color: colors.inkMuted },
})
