// A discussion thread on one subject — a record, an artist, or a track.
// Userbase-wide, unlike the rest of the social surface: this is where people
// who have heard the same thing argue about it. Reading and posting need the
// same thing (you finished it), so a locked thread shows the lock instead of
// its contents. PLAN_discussions.md §4, §5, §6.
import { useCallback, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type View as RNView,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Image } from 'expo-image'
import * as Clipboard from 'expo-clipboard'
import * as Haptics from 'expo-haptics'
import { ArrowLeft, Lock, Send } from 'lucide-react-native'
import {
  createThreadPost,
  fetchThreadPosts,
  flagSpoiler,
  reportPost,
  replyToPost,
  resolveThread,
  togglePostLike,
} from '../../lib/api'
import {
  songScoreColor,
  type DiscussionPost,
  type SubjectRef,
  type SubjectType,
  type ThreadSort,
} from '@pressd/shared/types'
import AnchoredMenu from '../../components/AnchoredMenu'
import LikeButton from '../../components/LikeButton'
import { threadKey } from '../../lib/refresh'
import { colors, fonts, radii, spacing, NUM_SCALE_CAP } from '../../theme/tokens'

const SORTS: { key: ThreadSort; label: string }[] = [
  { key: 'popular', label: 'Popular' },
  { key: 'newest', label: 'Newest' },
  { key: 'all', label: 'All time' },
]

// What each locked state should say. The gate exists to make the room worth
// entering, so the copy has to read as an invitation rather than a refusal.
const LOCKED_COPY: Record<string, string> = {
  rate_album: 'Finish rating this record to read what people are saying about it.',
  rate_track: 'Rate this track to open its notes.',
  rate_artist: 'Rate an album by this artist to join the conversation.',
}

export default function ThreadScreen() {
  const { subject, artist, album, trackId, title } = useLocalSearchParams<{
    subject: string
    artist?: string
    album?: string
    trackId?: string
    title?: string
  }>()
  const router = useRouter()
  const queryClient = useQueryClient()
  const [sort, setSort] = useState<ThreadSort>('popular')
  const [draft, setDraft] = useState('')
  const [replyTo, setReplyTo] = useState<DiscussionPost | null>(null)

  const ref: SubjectRef = {
    subjectType: (subject as SubjectType) ?? 'album',
    artist: artist || undefined,
    album: album || undefined,
    trackId: trackId ? Number(trackId) : undefined,
  }
  const key = threadKey(ref.subjectType, ref.artist, ref.album, ref.trackId)

  const { data: meta, isLoading: metaLoading } = useQuery({
    queryKey: key,
    queryFn: () => resolveThread(ref),
  })

  const threadId = meta?.threadId ?? null
  const { data: page, isLoading: postsLoading } = useQuery({
    queryKey: ['threadPosts', threadId, sort],
    queryFn: () => fetchThreadPosts(threadId!, sort),
    // Only once there is a thread and this viewer has earned it — asking for a
    // locked thread's posts would 403, and there is nothing to show anyway.
    enabled: !!threadId && !!meta?.canRead,
  })

  const invalidate = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['thread'] })
    queryClient.invalidateQueries({ queryKey: ['threadPosts'] })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryClient, subject, artist, album, trackId])

  const send = useMutation({
    mutationFn: async () => {
      const body = draft.trim()
      if (!body) return
      if (replyTo) await replyToPost(replyTo.id, body)
      else await createThreadPost(ref, body)
    },
    onSuccess: () => {
      setDraft('')
      setReplyTo(null)
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {})
      invalidate()
    },
    onError: (e: Error) => Alert.alert('Could not post', e.message),
  })

  const posts = page?.posts ?? []
  const locked = meta && !meta.canRead

  return (
    <View style={styles.root}>
      <SafeAreaView style={styles.screen} edges={['top']}>
        <View style={styles.topBar}>
          <Pressable onPress={() => router.back()} hitSlop={10} style={styles.backBtn}>
            <ArrowLeft size={18} color={colors.inkSecondary} />
          </Pressable>
          {meta?.artUrl ? (
            <Image source={{ uri: meta.artUrl }} style={styles.art} contentFit="cover" />
          ) : null}
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.topTitle} numberOfLines={1}>
              {meta?.title || title || 'Discussion'}
            </Text>
            {!!meta?.subtitle && (
              <Text style={styles.topSub} numberOfLines={1}>{meta.subtitle}</Text>
            )}
          </View>
        </View>

        {metaLoading ? (
          <View style={styles.center}><ActivityIndicator color={colors.green} /></View>
        ) : locked ? (
          <View style={styles.center}>
            <Lock size={28} color={colors.inkMuted} />
            <Text style={styles.lockedTitle}>Not yet</Text>
            <Text style={styles.lockedBody}>
              {LOCKED_COPY[meta?.lockedReason ?? ''] ?? 'This thread is not open to you yet.'}
            </Text>
          </View>
        ) : (
          <KeyboardAvoidingView
            style={{ flex: 1 }}
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            keyboardVerticalOffset={8}
          >
            <View style={styles.sortRow}>
              {SORTS.map((s) => (
                <Pressable
                  key={s.key}
                  onPress={() => setSort(s.key)}
                  style={[styles.sortChip, sort === s.key && styles.sortChipOn]}
                >
                  <Text style={[styles.sortText, sort === s.key && styles.sortTextOn]}>
                    {s.label}
                  </Text>
                </Pressable>
              ))}
            </View>

            <ScrollView
              contentContainerStyle={styles.list}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              {postsLoading && threadId ? (
                <ActivityIndicator color={colors.green} style={{ marginTop: spacing.xl }} />
              ) : posts.length === 0 ? (
                <Text style={styles.empty}>
                  Nobody has said anything yet. Be the first.
                </Text>
              ) : (
                posts.map((p) => (
                  <PostRow key={p.id} post={p} onChanged={invalidate} onReply={setReplyTo} />
                ))
              )}
            </ScrollView>

            {meta?.canPost && (
              <View style={styles.composer}>
                {replyTo && (
                  <View style={styles.replyBanner}>
                    <Text style={styles.replyBannerText} numberOfLines={1}>
                      Replying to {replyTo.author?.name ?? 'a post'}
                    </Text>
                    <Pressable onPress={() => setReplyTo(null)} hitSlop={10}>
                      <Text style={styles.replyCancel}>Cancel</Text>
                    </Pressable>
                  </View>
                )}
                <View style={styles.composerRow}>
                  <TextInput
                    style={styles.input}
                    value={draft}
                    onChangeText={setDraft}
                    placeholder={replyTo ? 'Write a reply…' : 'Say something about this record…'}
                    placeholderTextColor={colors.inkMuted}
                    multiline
                    maxLength={4000}
                  />
                  <Pressable
                    onPress={() => send.mutate()}
                    disabled={!draft.trim() || send.isPending}
                    style={[styles.sendBtn, (!draft.trim() || send.isPending) && styles.sendOff]}
                    hitSlop={8}
                  >
                    <Send size={17} color={draft.trim() ? '#fff' : colors.inkMuted} />
                  </Pressable>
                </View>
              </View>
            )}
          </KeyboardAvoidingView>
        )}
      </SafeAreaView>
    </View>
  )
}

/** One post. Long-press opens the actions from the design review:
 *  Reply, Copy text, Flag as spoiler, Report — deliberately no Block. */
function PostRow({
  post,
  onChanged,
  onReply,
}: {
  post: DiscussionPost
  onChanged: () => void
  onReply: (p: DiscussionPost) => void
}) {
  const anchor = useRef<RNView | null>(null)
  const [menu, setMenu] = useState(false)
  // A blurred spoiler is revealed per reader and stays revealed only for this
  // screen — the flag protects everyone else's first read, not this one's.
  const [revealed, setRevealed] = useState(false)
  const [liked, setLiked] = useState(post.likedByMe)
  const [likes, setLikes] = useState(post.likeCount)

  const system = post.kind === 'system'
  const hidden = post.isSpoiler && !revealed && !system

  async function onSelect(value: string | number) {
    setMenu(false)
    if (value === 'reply') return onReply(post)
    if (value === 'copy') {
      await Clipboard.setStringAsync(post.body)
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {})
      return
    }
    if (value === 'spoiler') {
      await flagSpoiler(post.id).catch(() => {})
      return onChanged()
    }
    if (value === 'report') {
      Alert.alert('Report this post?', 'A few reports hide it while it is looked at.', [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Report',
          style: 'destructive',
          onPress: async () => {
            await reportPost(post.id, 'abuse').catch(() => {})
            onChanged()
          },
        },
      ])
    }
  }

  async function toggleLike() {
    const next = !liked
    setLiked(next)
    setLikes((n) => n + (next ? 1 : -1))
    try {
      const r = await togglePostLike(post.id, liked)
      setLiked(r.liked)
      setLikes(r.likeCount)
    } catch {
      setLiked(!next)
      setLikes((n) => n + (next ? -1 : 1))
    }
  }

  if (post.deleted) {
    return <Text style={styles.tombstone}>This post was removed.</Text>
  }

  return (
    <View ref={anchor} style={[styles.post, system && styles.postSystem]}>
      {system ? (
        <Text style={styles.systemLabel}>PRESS&rsquo;D</Text>
      ) : (
        <View style={styles.postHead}>
          {post.kind === 'review' && <Text style={styles.reviewTag}>REVIEW</Text>}
          {post.author?.score != null && (
            <Text
              style={[styles.postScore, { color: songScoreColor(post.author.score) }]}
              maxFontSizeMultiplier={NUM_SCALE_CAP}
            >
              {post.author.score.toFixed(1)}
            </Text>
          )}
          <Text style={styles.postAuthor} numberOfLines={1}>{post.author?.name ?? 'Unknown'}</Text>
        </View>
      )}

      <Pressable
        onLongPress={system ? undefined : () => { Haptics.selectionAsync().catch(() => {}); setMenu(true) }}
        onPress={hidden ? () => setRevealed(true) : undefined}
        delayLongPress={300}
      >
        <Text style={[styles.postBody, system && styles.systemBody, hidden && styles.postHidden]}>
          {hidden ? 'Spoiler — tap to read' : post.body}
        </Text>
      </Pressable>

      {!system && (
        <View style={styles.postActions}>
          <LikeButton liked={liked} count={likes} onToggle={toggleLike} />
          <Pressable onPress={() => onReply(post)} hitSlop={8}>
            <Text style={styles.replyText}>
              {post.replyCount > 0 ? `${post.replyCount} ${post.replyCount === 1 ? 'reply' : 'replies'}` : 'Reply'}
            </Text>
          </Pressable>
        </View>
      )}

      <AnchoredMenu
        visible={menu}
        anchorRef={anchor}
        onClose={() => setMenu(false)}
        onSelect={onSelect}
        options={[
          { key: 'reply', value: 'reply', label: 'Reply', selected: false },
          { key: 'copy', value: 'copy', label: 'Copy text', selected: false },
          { key: 'spoiler', value: 'spoiler', label: 'Flag as spoiler', selected: false },
          { key: 'report', value: 'report', label: 'Report post', selected: false },
        ]}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  screen: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl, gap: spacing.md },

  topBar: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    paddingHorizontal: spacing.lg, paddingBottom: spacing.md,
  },
  backBtn: { paddingVertical: 4 },
  art: { width: 34, height: 34, borderRadius: radii.sm, backgroundColor: colors.inset },
  topTitle: { fontFamily: fonts.display, fontSize: 17, color: colors.ink },
  topSub: { fontFamily: fonts.body, fontSize: 12, color: colors.inkTertiary },

  lockedTitle: { fontFamily: fonts.display, fontSize: 20, color: colors.ink },
  lockedBody: { fontFamily: fonts.body, fontSize: 14, color: colors.inkTertiary, textAlign: 'center', lineHeight: 21 },

  sortRow: { flexDirection: 'row', gap: spacing.sm, paddingHorizontal: spacing.lg, paddingBottom: spacing.md },
  sortChip: { paddingHorizontal: spacing.md, paddingVertical: 6, borderRadius: radii.pill, backgroundColor: colors.inset },
  sortChipOn: { backgroundColor: colors.ink },
  sortText: { fontFamily: fonts.bodyMedium, fontSize: 12, color: colors.inkSecondary },
  sortTextOn: { color: '#fff' },

  list: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl },
  empty: { fontFamily: fonts.body, fontSize: 14, color: colors.inkTertiary, textAlign: 'center', marginTop: spacing.xxl },

  post: { paddingVertical: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  postSystem: {
    backgroundColor: colors.greenSoft, borderRadius: radii.md, borderBottomWidth: 0,
    paddingHorizontal: spacing.md, marginTop: spacing.sm, marginBottom: spacing.sm,
  },
  systemLabel: { fontFamily: fonts.bodyBold, fontSize: 10, letterSpacing: 1, color: colors.green, marginBottom: 4 },
  systemBody: { fontFamily: fonts.displayRegular, fontSize: 15, color: colors.ink },
  postHead: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.sm, marginBottom: 4 },
  postScore: { fontFamily: fonts.display, fontSize: 19 },
  postAuthor: { fontFamily: fonts.bodySemiBold, fontSize: 13, color: colors.inkSecondary, flexShrink: 1 },
  reviewTag: { fontFamily: fonts.bodyBold, fontSize: 9, letterSpacing: 0.9, color: colors.green },
  postBody: { fontFamily: fonts.body, fontSize: 15, color: colors.ink, lineHeight: 22 },
  postHidden: { color: colors.inkMuted, fontStyle: 'italic' },
  postActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg, marginTop: spacing.sm },
  replyText: { fontFamily: fonts.bodyMedium, fontSize: 12, color: colors.inkTertiary },
  tombstone: {
    fontFamily: fonts.body, fontSize: 13, color: colors.inkMuted, fontStyle: 'italic',
    paddingVertical: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border,
  },

  composer: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, padding: spacing.md, gap: spacing.sm },
  replyBanner: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md },
  replyBannerText: { fontFamily: fonts.body, fontSize: 12, color: colors.inkTertiary, flexShrink: 1 },
  replyCancel: { fontFamily: fonts.bodySemiBold, fontSize: 12, color: colors.green },
  composerRow: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm },
  input: {
    flex: 1, minHeight: 40, maxHeight: 120, borderRadius: radii.lg, backgroundColor: colors.inset,
    paddingHorizontal: spacing.md, paddingTop: 10, paddingBottom: 10,
    fontFamily: fonts.body, fontSize: 15, color: colors.ink,
  },
  sendBtn: {
    width: 40, height: 40, borderRadius: 20, backgroundColor: colors.green,
    alignItems: 'center', justifyContent: 'center',
  },
  sendOff: { backgroundColor: colors.inset },
})
