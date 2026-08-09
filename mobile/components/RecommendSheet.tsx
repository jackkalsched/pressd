// Sending an album to a friend's shelf.
//
// Mirrors the desktop RecommendModal — pick one friend, send — with the note
// the web version doesn't have yet: a recommendation with a reason attached is
// the difference between a shelf item and someone telling you to hear this.
//
// Deliberately one friend at a time. The endpoint takes a single recipient, and
// a multi-select would turn "here's why you'll like it" into a broadcast, which
// is a different thing and reads like one.
import { useMemo, useState } from 'react'
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import { Image } from 'expo-image'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Star, X } from 'lucide-react-native'
import { fetchFriends, recommendAlbum, RECOMMENDATION_NOTE_MAX } from '../lib/api'
import { useAuth } from '../lib/auth'
import type { Album } from '@pressd/shared/types'
import { colors, fonts, radii, spacing } from '../theme/tokens'

// The recommendation accent, matching the star the recipient sees on the cover.
const REC = '#f97316'

export default function RecommendSheet({
  album,
  visible,
  onClose,
}: {
  album: Album
  visible: boolean
  onClose: () => void
}) {
  const { user } = useAuth()
  const qc = useQueryClient()
  const [selected, setSelected] = useState<number | null>(null)
  const [note, setNote] = useState('')
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const { data: friends = [] } = useQuery({
    queryKey: ['friends', user?.id],
    queryFn: () => fetchFriends(user!.id),
    enabled: !!user && visible,
    staleTime: 60_000,
  })

  const friendName = useMemo(
    () => friends.find((f) => f.id === selected)?.name ?? null,
    [friends, selected],
  )

  function reset() {
    setSelected(null)
    setNote('')
    setSent(null)
    setError(null)
  }

  function close() {
    reset()
    onClose()
  }

  async function send() {
    if (!user || selected == null || sending) return
    setSending(true)
    setError(null)
    try {
      const { alreadyExisted } = await recommendAlbum(album.id, selected, user.id, note.trim() || undefined)
      setSent(
        alreadyExisted
          ? `${friendName ?? 'They'} already had this — marked it as your recommendation.`
          : `Sent to ${friendName ?? 'them'}.`,
      )
      // Their shelf changed, and the feed carries the recommendation as an event.
      qc.invalidateQueries({ queryKey: ['albums'] })
      qc.invalidateQueries({ queryKey: ['feed'] })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not send that recommendation')
    } finally {
      setSending(false)
    }
  }

  const remaining = RECOMMENDATION_NOTE_MAX - note.length

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={close}>
      <Pressable style={styles.backdrop} onPress={close}>
        {/* The note field sits low in the sheet, so the keyboard would cover it. */}
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <Pressable style={styles.sheet}>
            <View style={styles.head}>
              <View style={styles.headTitle}>
                <Star size={16} color={REC} fill={REC} />
                <Text style={styles.title}>Recommend</Text>
              </View>
              <Pressable onPress={close} hitSlop={12} accessibilityLabel="Close">
                <X size={20} color={colors.inkTertiary} />
              </Pressable>
            </View>

            <Text style={styles.subtitle} numberOfLines={2}>
              Send <Text style={styles.subtitleStrong}>{album.albumName}</Text> by{' '}
              <Text style={styles.subtitleStrong}>{album.artist}</Text> to a friend&apos;s To Listen list.
            </Text>

            {sent ? (
              <View style={styles.sentBox}>
                <Check size={16} color={colors.green} />
                <Text style={styles.sentText}>{sent}</Text>
              </View>
            ) : friends.length === 0 ? (
              <Text style={styles.empty}>You don&apos;t have any friends yet.</Text>
            ) : (
              <>
                <ScrollView style={styles.friendList} keyboardShouldPersistTaps="handled">
                  {friends.map((f) => {
                    const on = f.id === selected
                    return (
                      <Pressable
                        key={f.id}
                        style={[styles.friendRow, on && styles.friendRowOn]}
                        onPress={() => setSelected(on ? null : f.id)}
                      >
                        <View style={styles.avatar}>
                          {f.avatarUrl ? (
                            <Image
                              source={{ uri: f.avatarUrl }}
                              style={styles.avatarImg}
                              contentFit="cover"
                              cachePolicy="memory-disk"
                            />
                          ) : (
                            <Text style={styles.avatarInitial}>{f.name[0]?.toUpperCase()}</Text>
                          )}
                        </View>
                        <Text style={[styles.friendName, on && styles.friendNameOn]} numberOfLines={1}>
                          {f.name}
                        </Text>
                        {on && <Check size={15} color={REC} strokeWidth={2.6} />}
                      </Pressable>
                    )
                  })}
                </ScrollView>

                {/* Only once there's someone to address — "tell them why" has no
                    meaning before a name is attached to "them". */}
                {selected != null && (
                  <View style={styles.noteWrap}>
                    <TextInput
                      style={styles.noteInput}
                      value={note}
                      onChangeText={setNote}
                      placeholder={`Tell ${friendName ?? 'them'} why you think they'd like this!`}
                      placeholderTextColor={colors.inkTertiary}
                      multiline
                      maxLength={RECOMMENDATION_NOTE_MAX}
                      textAlignVertical="top"
                    />
                    {/* Only near the ceiling — a counter on an empty optional
                        field reads as a requirement. */}
                    {remaining <= 60 && <Text style={styles.counter}>{remaining}</Text>}
                  </View>
                )}

                {error ? <Text style={styles.error}>{error}</Text> : null}

                <Pressable
                  style={[styles.sendBtn, (selected == null || sending) && styles.sendBtnOff]}
                  onPress={send}
                  disabled={selected == null || sending}
                >
                  {sending ? (
                    <ActivityIndicator color="#ffffff" />
                  ) : (
                    <>
                      <Star size={14} color="#ffffff" fill="#ffffff" />
                      <Text style={styles.sendText}>Recommend</Text>
                    </>
                  )}
                </Pressable>
              </>
            )}
          </Pressable>
        </KeyboardAvoidingView>
      </Pressable>
    </Modal>
  )
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(28,25,23,0.35)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.bg,
    borderTopLeftRadius: radii.xl,
    borderTopRightRadius: radii.xl,
    padding: spacing.xl,
    paddingBottom: spacing.xxl + spacing.lg,
  },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  headTitle: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  title: { fontFamily: fonts.display, fontSize: 22, color: colors.ink },
  subtitle: {
    fontFamily: fonts.body,
    fontSize: 13,
    lineHeight: 19,
    color: colors.inkTertiary,
    marginTop: spacing.sm,
    marginBottom: spacing.md,
  },
  subtitleStrong: { fontFamily: fonts.bodySemiBold, color: colors.ink },

  friendList: { maxHeight: 220 },
  friendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: spacing.md,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.raised,
    marginBottom: spacing.sm,
  },
  friendRowOn: { borderColor: REC, backgroundColor: '#fff7ed' },
  avatar: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: colors.green,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  avatarImg: { width: '100%', height: '100%' },
  avatarInitial: { fontFamily: fonts.bodyBold, fontSize: 13, color: '#ffffff' },
  friendName: { flex: 1, minWidth: 0, fontFamily: fonts.bodyMedium, fontSize: 15, color: colors.ink },
  friendNameOn: { fontFamily: fonts.bodySemiBold, color: '#c2410c' },

  noteWrap: { marginTop: spacing.xs, marginBottom: spacing.md },
  noteInput: {
    minHeight: 76,
    fontFamily: fonts.body,
    fontSize: 14,
    lineHeight: 20,
    color: colors.ink,
    backgroundColor: colors.raised,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
  },
  counter: {
    alignSelf: 'flex-end',
    fontFamily: fonts.body,
    fontSize: 11,
    color: colors.inkMuted,
    marginTop: 4,
  },

  sendBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: REC,
    borderRadius: radii.md,
    paddingVertical: 14,
  },
  sendBtnOff: { opacity: 0.4 },
  sendText: { fontFamily: fonts.bodySemiBold, fontSize: 15, color: '#ffffff' },

  sentBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: '#f0faf5',
    borderWidth: 1,
    borderColor: '#c3e6d8',
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  sentText: { flex: 1, fontFamily: fonts.bodyMedium, fontSize: 13.5, color: colors.green },
  empty: {
    fontFamily: fonts.body,
    fontSize: 14,
    color: colors.inkTertiary,
    textAlign: 'center',
    paddingVertical: spacing.xl,
  },
  error: { fontFamily: fonts.bodyMedium, fontSize: 13, color: '#b91c1c', marginBottom: spacing.sm },
})
