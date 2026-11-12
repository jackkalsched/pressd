// The line under the rating button that leads into a record's discussion.
//
// Two jobs, because from the reader's side they are one: on your own rated copy
// with no review written it invites you to write one, and otherwise it takes
// you to what everyone else said — locked until you've rated the record, as the
// thread requires. Someone else's copy never offers a review: theirs isn't
// yours to write, and you can't review a record you haven't finished.
// Locked, it is still a way in: the room's top three reviews sit above it,
// clipped on the server and read-only (discussions.thread_preview), and the row
// opens the thread, whose locked page shows them again over Rate now.
// PLAN_discussions.md §10, §4.1.
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { useRouter } from 'expo-router'
import { useQuery } from '@tanstack/react-query'
import { ChevronRight, Lock, MessageCircle, MessageCirclePlus } from 'lucide-react-native'
import { fetchThreadPreview, resolveThread } from '../lib/api'
import { threadKey } from '../lib/refresh'
import { colors, fonts, spacing, NUM_SCALE_CAP, scoreColor, useColors } from '../theme/tokens'
import Avatar from './Avatar'

export default function AlbumThoughts({
  album,
  artist,
  hasReview,
  canWriteReview,
  onWriteReview,
}: {
  album: string
  artist: string
  hasReview: boolean
  /** Your own copy, rated: the one place a review can be written from here. */
  canWriteReview: boolean
  onWriteReview: () => void
}) {
  const tc = useColors()
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
  const offerReview = canWriteReview && !hasReview
  const locked = !offerReview && !canRead

  // Shares the thread page's key, so opening the room after this is instant.
  const { data: preview } = useQuery({
    queryKey: ['threadPreview', 'album', artist, album],
    queryFn: () => fetchThreadPreview({ subjectType: 'album', artist, album }),
    enabled: !!meta && locked,
    retry: false,
  })
  const previews = locked ? (preview?.posts ?? []).slice(0, 3) : []
  const openThread = () =>
    router.push({
      pathname: '/thread/[subject]',
      params: { subject: 'album', artist, album, title: album },
    })

  const label = offerReview
    ? 'Write a review!'
    : locked
      ? 'Finish rating to discuss'
      : people > 0
        ? `${people} ${people === 1 ? 'presser' : 'pressers'} weighed in`
        : 'Be the first to weigh in'

  return (
    <>
      {previews.map((p) => (
        <Pressable
          key={p.id}
          onPress={openThread}
          style={({ pressed }) => [styles.preview, { borderColor: tc.border }, pressed && { opacity: 0.6 }]}
        >
          <View style={styles.previewHead}>
            <Avatar name={p.author.name} avatarUrl={p.author.avatarUrl} size={22} />
            <Text style={styles.previewAuthor} numberOfLines={1}>{p.author.name}</Text>
            {p.author.score != null && (
              <Text style={[styles.previewScore, { color: scoreColor(p.author.score) }]} maxFontSizeMultiplier={NUM_SCALE_CAP}>
                {p.author.score.toFixed(2)}
              </Text>
            )}
          </View>
          <Text style={styles.previewBody} numberOfLines={3}>{p.body}</Text>
        </Pressable>
      ))}
      <Pressable
        onPress={() => {
          if (offerReview) return onWriteReview()
          openThread()
        }}
        style={({ pressed }) => [styles.row, pressed && { opacity: 0.6 }]}
      >
        {locked ? (
          <Lock size={16} color={tc.inkMuted} />
        ) : !offerReview ? (
          <MessageCircle size={17} color={tc.green} />
        ) : (
          // Not a pencil: the rating button directly above already uses one, and
          // two identical icons stacked read as the same action twice. This row
          // is always about the conversation, so it keeps to that family.
          <MessageCirclePlus size={17} color={tc.green} />
        )}
        <Text style={[styles.label, locked && styles.labelLocked]} numberOfLines={1}>
          {label}
        </Text>
        <View style={{ flex: 1 }} />
        <ChevronRight size={18} color={locked ? tc.inkMuted : tc.green} />
      </Pressable>
    </>
  )
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    marginTop: spacing.sm,
  },
  label: { fontFamily: fonts.bodySemiBold, fontSize: 16, color: colors.green },
  labelLocked: { color: colors.inkMuted },
  preview: { paddingVertical: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth },
  previewHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: 6 },
  previewAuthor: { flex: 1, minWidth: 0, fontFamily: fonts.bodySemiBold, fontSize: 14, color: colors.ink },
  previewScore: { fontFamily: fonts.display, fontSize: 15 },
  previewBody: { fontFamily: fonts.body, fontSize: 14, color: colors.inkSecondary, lineHeight: 20 },
})
