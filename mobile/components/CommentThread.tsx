// Comment thread for an album, shared by the album detail screen. Anyone who
// can see the album can post; you can delete your own (server sets can_delete).
import { useState } from 'react'
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Image } from 'expo-image'
import { Send, Trash2 } from 'lucide-react-native'
import { fetchComments, postComment, deleteComment } from '../lib/api'
import { colors, fonts, radii, spacing, NUM_SCALE_CAP } from '../theme/tokens'

function timeAgo(iso: string | null): string {
  if (!iso) return ''
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m`
  if (s < 86400) return `${Math.floor(s / 3600)}h`
  return `${Math.floor(s / 86400)}d`
}

export default function CommentThread({ albumId }: { albumId: number }) {
  const queryClient = useQueryClient()
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)

  const { data: comments = [], isLoading } = useQuery({
    queryKey: ['comments', albumId],
    queryFn: () => fetchComments(albumId),
  })

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ['comments', albumId] })
  }

  async function submit() {
    const body = draft.trim()
    if (!body || busy) return
    setBusy(true)
    try {
      await postComment(albumId, body)
      setDraft('')
      invalidate()
    } finally {
      setBusy(false)
    }
  }

  async function remove(id: number) {
    await deleteComment(id)
    invalidate()
  }

  return (
    <View>
      <Text style={styles.sectionLabel}>COMMENTS{comments.length > 0 ? ` · ${comments.length}` : ''}</Text>

      <View style={styles.composer}>
        <TextInput
          style={styles.input}
          value={draft}
          onChangeText={setDraft}
          placeholder="Add a comment…"
          placeholderTextColor={colors.inkMuted}
          multiline
        />
        <Pressable
          style={[styles.sendBtn, (!draft.trim() || busy) && styles.sendDisabled]}
          onPress={submit}
          disabled={!draft.trim() || busy}
        >
          {busy ? <ActivityIndicator size="small" color="#fff" /> : <Send size={16} color="#fff" />}
        </Pressable>
      </View>

      {isLoading ? (
        <ActivityIndicator color={colors.green} style={{ marginTop: spacing.md }} />
      ) : comments.length === 0 ? (
        <Text style={styles.empty}>No comments yet. Start the conversation.</Text>
      ) : (
        comments.map((c) => (
          <View key={c.id} style={styles.comment}>
            {c.author.avatar_url ? (
              <Image source={{ uri: c.author.avatar_url }} style={styles.avatar} contentFit="cover" />
            ) : (
              <View style={[styles.avatar, styles.avatarFallback]}>
                <Text style={styles.avatarInitial} numberOfLines={1} adjustsFontSizeToFit maxFontSizeMultiplier={NUM_SCALE_CAP}>{c.author.name[0]?.toUpperCase()}</Text>
              </View>
            )}
            <View style={{ flex: 1, minWidth: 0 }}>
              <View style={styles.commentHead}>
                <Text style={styles.author}>{c.author.name}</Text>
                <Text style={styles.time}>{timeAgo(c.created_at)}</Text>
                {c.can_delete && (
                  <Pressable onPress={() => remove(c.id)} hitSlop={8}>
                    <Trash2 size={13} color={colors.inkMuted} />
                  </Pressable>
                )}
              </View>
              <Text style={styles.body}>{c.body}</Text>
            </View>
          </View>
        ))
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  sectionLabel: {
    fontFamily: fonts.bodyBold,
    fontSize: 11,
    letterSpacing: 1.2,
    color: colors.inkMuted,
    marginTop: spacing.xl,
    marginBottom: spacing.sm,
  },
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm },
  input: {
    flex: 1,
    minHeight: 42,
    maxHeight: 120,
    backgroundColor: colors.raised,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontFamily: fonts.body,
    fontSize: 14,
    color: colors.ink,
  },
  sendBtn: {
    width: 42,
    height: 42,
    borderRadius: radii.md,
    backgroundColor: colors.green,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendDisabled: { backgroundColor: colors.inkMuted },
  empty: { fontFamily: fonts.body, fontSize: 13, color: colors.inkTertiary, marginTop: spacing.md },
  comment: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
  avatar: { width: 30, height: 30, borderRadius: 15 },
  avatarFallback: { backgroundColor: colors.green, alignItems: 'center', justifyContent: 'center' },
  avatarInitial: { fontFamily: fonts.bodyBold, fontSize: 12, color: '#fff' },
  commentHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  author: { fontFamily: fonts.bodySemiBold, fontSize: 13, color: colors.ink },
  time: { fontFamily: fonts.body, fontSize: 11, color: colors.inkMuted, flex: 1 },
  body: { fontFamily: fonts.body, fontSize: 14, color: colors.inkSecondary, lineHeight: 19, marginTop: 2 },
})
