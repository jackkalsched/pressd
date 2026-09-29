// A discussion thread on one subject — a record, an artist, or a track.
// Userbase-wide, unlike the rest of the social surface: this is where people
// who have heard the same thing argue about it. Reading and posting need the
// same thing (you finished it), so a locked thread shows the lock instead of
// its contents. PLAN_discussions.md §4, §5, §6.
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  Keyboard,
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
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Image } from 'expo-image'
import * as Clipboard from 'expo-clipboard'
import * as Haptics from 'expo-haptics'
import { ArrowLeft, ChevronDown, ChevronUp, FileText, Lock, Send, Triangle } from 'lucide-react-native'
import {
  createThreadPost,
  fetchThreadPosts,
  flagSpoiler,
  reportPost,
  replyToPost,
  resolveThread,
  fetchReplies,
} from '../../lib/api'
import {
  songScoreColor,
  type DiscussionPost,
  type SubjectRef,
  type SubjectType,
  type ThreadSort,
  type ThreadSummary,
} from '@pressd/shared/types'
import AnchoredMenu from '../../components/AnchoredMenu'
import Avatar from '../../components/Avatar'
import FullReviewSheet from '../../components/FullReviewSheet'
import VoteButtons from '../../components/VoteButtons'
import { threadKey } from '../../lib/refresh'
import { colors, fonts, radii, spacing, NUM_SCALE_CAP } from '../../theme/tokens'

// Matches the red For You uses for a worst track.
const DOWN = '#e0492b'

const SORTS: { key: ThreadSort; label: string }[] = [
  { key: 'popular', label: 'Popular' },
  { key: 'newest', label: 'Newest' },
  { key: 'all', label: 'All time' },
]

// What each locked state should say. The gate exists to make the room worth
// entering, so the copy has to read as an invitation rather than a refusal.
const LOCKED_COPY: Record<string, string> = {
  rate_album: 'Finish rating this record to read what people are saying about it.',
}

export default function ThreadScreen() {
  const { subject, artist, album, title } = useLocalSearchParams<{
    subject: string
    artist?: string
    album?: string
    title?: string
  }>()
  const router = useRouter()
  const queryClient = useQueryClient()
  const insets = useSafeAreaInsets()
  // The composer has to clear the home indicator, but only while the keyboard
  // is down — KeyboardAvoidingView already lifts the bar by the keyboard's
  // height, and the inset on top of that leaves a strip of background floating
  // above the keys.
  const [keyboardUp, setKeyboardUp] = useState(false)
  useEffect(() => {
    const show = Keyboard.addListener('keyboardWillShow', () => setKeyboardUp(true))
    const hide = Keyboard.addListener('keyboardWillHide', () => setKeyboardUp(false))
    return () => { show.remove(); hide.remove() }
  }, [])
  const composerPad = keyboardUp ? spacing.md : Math.max(insets.bottom, spacing.md)
  const [sort, setSort] = useState<ThreadSort>('popular')
  const [draft, setDraft] = useState('')
  const [replyTo, setReplyTo] = useState<DiscussionPost | null>(null)

  const ref: SubjectRef = {
    subjectType: (subject as SubjectType) ?? 'album',
    artist: artist || undefined,
    album: album || undefined,
  }
  const key = threadKey(ref.subjectType, ref.artist, ref.album)

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
  }, [queryClient, subject, artist, album])

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
              <View style={styles.sortChips}>
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
              {/* Sits out here rather than in the summary card: it describes the
                  room, not the record, and the card is for the record. */}
              {!!page?.summary && (
                <Text style={styles.raterCount} maxFontSizeMultiplier={NUM_SCALE_CAP}>
                  {page.summary.raters} {page.summary.raters === 1 ? 'rater' : 'raters'}
                </Text>
              )}
            </View>

            <ScrollView
              contentContainerStyle={styles.list}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              {page?.summary && <Summary summary={page.summary} />}

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
              <View style={[styles.composer, { paddingBottom: composerPad }]}>
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

/** The record's numbers, above the conversation.
 *
 *  Three facts and no sentence: what the room scored it, and the tracks it
 *  most and least agreed on. This used to be a seeded Press'd post writing the
 *  same thing out in prose, which went stale the moment anyone rated the album
 *  and had to be regenerated by hand. Read fresh every time now.
 */
function Summary({ summary }: { summary: ThreadSummary }) {
  // Every track's room average, behind a toggle: fifteen rows above the
  // conversation would push the room off the screen.
  const [open, setOpen] = useState(false)
  const best = summary.topTrack?.title
  const worst = summary.bottomTrack?.title

  return (
    <View style={styles.summaryWrap}>
      <View style={styles.summary}>
        <Text
          style={[styles.summaryValue, { color: songScoreColor(summary.meanScore) }]}
          maxFontSizeMultiplier={NUM_SCALE_CAP}
        >
          {summary.meanScore.toFixed(2)}
        </Text>

        <View style={styles.summaryTracks}>
          {summary.topTrack && <SummaryTrack best track={summary.topTrack} />}
          {summary.bottomTrack && <SummaryTrack best={false} track={summary.bottomTrack} />}
        </View>
      </View>

      {summary.tracks.length > 1 && (
        <>
          <Pressable onPress={() => setOpen((o) => !o)} hitSlop={8} style={[styles.disclosure, styles.everyToggle]}>
            <Text style={styles.replyToggle}>{open ? 'Hide tracks' : 'Every track'}</Text>
            {open ? <ChevronUp size={13} color={colors.green} /> : <ChevronDown size={13} color={colors.green} />}
          </Pressable>
          {open && (
            <View style={styles.everyList}>
              {summary.tracks.map((t, i) => {
                const mark = t.title === best ? 'best' : t.title === worst ? 'worst' : null
                const color = songScoreColor(t.score)
                return (
                  <View key={`${t.trackNumber ?? 'x'}-${t.title}`} style={styles.everyRow}>
                    <Text style={styles.everyNum} maxFontSizeMultiplier={NUM_SCALE_CAP}>{t.trackNumber ?? i + 1}</Text>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <View style={styles.everyTop}>
                        <Text style={[styles.everyTitle, mark && styles.everyTitleMarked]} numberOfLines={1}>
                          {t.title}
                        </Text>
                        {mark && (
                          <View style={mark === 'best' ? undefined : { transform: [{ rotate: '180deg' }] }}>
                            <Triangle size={9} color={mark === 'best' ? colors.green : DOWN} />
                          </View>
                        )}
                        {/* Only when it differs from the album's count: a song
                            some raters skipped has fewer voices behind it. */}
                        {t.raters < summary.raters && (
                          <Text style={styles.everyRaters} maxFontSizeMultiplier={NUM_SCALE_CAP}>
                            {t.raters} {t.raters === 1 ? 'rater' : 'raters'}
                          </Text>
                        )}
                      </View>
                      <View style={styles.everyBar}>
                        <View style={[styles.everyBarFill, { width: `${t.score * 10}%`, backgroundColor: color }]} />
                      </View>
                    </View>
                    <Text style={[styles.everyScore, { color }]} maxFontSizeMultiplier={NUM_SCALE_CAP}>
                      {t.score.toFixed(1)}
                    </Text>
                  </View>
                )
              })}
            </View>
          )}
        </>
      )}
    </View>
  )
}

/** The app already marks a best and worst track with a green triangle up and a
 *  red one down (For You's review cells do it). Same shapes and colours here so
 *  the mark means one thing everywhere — outlined rather than filled, since
 *  these are the room's picks and not the reader's own. */
function SummaryTrack({ best, track }: { best: boolean; track: { title: string; score: number } }) {
  return (
    <View style={styles.summaryTrack}>
      <View style={best ? undefined : { transform: [{ rotate: '180deg' }] }}>
        <Triangle size={11} color={best ? colors.green : DOWN} />
      </View>
      <Text style={styles.summaryTrackTitle} numberOfLines={1}>{track.title}</Text>
      <Text
        style={[styles.summaryTrackScore, { color: songScoreColor(track.score) }]}
        maxFontSizeMultiplier={NUM_SCALE_CAP}
      >
        {track.score.toFixed(1)}
      </Text>
    </View>
  )
}

/** Run `fn` once an AnchoredMenu has finished closing. The menu is a native
 *  modal that stays mounted through its ~110ms fade, and on iOS dismissing a
 *  modal takes down anything presented over it — so a sheet opened straight
 *  from the menu's select would flash and vanish. */
function afterMenu(fn: () => void) {
  setTimeout(fn, 180)
}

/** Someone's full rating of the record — beside the score on a post, and on a
 *  reply. An icon that drops down one named action, so the icon can stay quiet
 *  while what it opens is still spelled out, with whose it is. */
function FullReviewPill({
  name,
  onOpen,
  compact = false,
}: {
  name: string
  onOpen: () => void
  compact?: boolean
}) {
  const anchor = useRef<RNView | null>(null)
  const [open, setOpen] = useState(false)
  return (
    <>
      <Pressable
        ref={anchor}
        onPress={() => setOpen(true)}
        hitSlop={10}
        accessibilityRole="button"
        accessibilityLabel={`${name}'s full review`}
        style={({ pressed }) => pressed && { opacity: 0.5 }}
      >
        <FileText size={compact ? 14 : 16} color={open ? colors.green : colors.inkMuted} />
      </Pressable>
      <AnchoredMenu
        visible={open}
        anchorRef={anchor}
        onClose={() => setOpen(false)}
        onSelect={() => afterMenu(onOpen)}
        options={[{ key: 'review', value: 'review', label: `Access ${name}'s full review`, selected: false }]}
        align="right"
      />
    </>
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
  // Whose full rating is open: this post's, or one of its replies'.
  const [reviewOf, setReviewOf] = useState<number | null>(null)
  // A blurred spoiler is revealed per reader and stays revealed only for this
  // screen — the flag protects everyone else's first read, not this one's.
  const [revealed, setRevealed] = useState(false)
  // Replies are fetched only when someone asks to see them: most posts have
  // none, and a thread of thirty would otherwise issue thirty requests on mount.
  const [open, setOpen] = useState(false)
  const { data: replies = [], isLoading: repliesLoading } = useQuery({
    queryKey: ['replies', post.id],
    queryFn: () => fetchReplies(post.id),
    enabled: open,
  })

  const system = post.kind === 'system'
  const hidden = post.isSpoiler && !revealed && !system

  async function onSelect(value: string | number) {
    setMenu(false)
    if (value === 'reply') return onReply(post)
    if (value === 'review') return afterMenu(() => setReviewOf(post.id))
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

  if (post.deleted) {
    return <Text style={styles.tombstone}>This post was removed.</Text>
  }

  return (
    <View ref={anchor} style={[styles.post, system && styles.postSystem]}>
      {system ? (
        <Text style={styles.systemLabel}>PRESS&rsquo;D</Text>
      ) : (
        <View style={styles.postHead}>
          {/* The person first and largest. Whose opinion this is matters more
              than what they scored it — and the "REVIEW" tag it used to lead
              with said nothing, since almost every post here is one. */}
          <Avatar name={post.author?.name ?? '?'} avatarUrl={post.author?.avatarUrl} size={28} />
          <Text style={styles.postAuthor} numberOfLines={1}>{post.author?.name ?? 'Unknown'}</Text>
          {post.author?.score != null && (
            <Text
              style={[styles.postScore, { color: songScoreColor(post.author.score) }]}
              maxFontSizeMultiplier={NUM_SCALE_CAP}
            >
              {post.author.score.toFixed(2)}
            </Text>
          )}
          {/* A score means a rated copy stands behind the post, so there is a
              full rating to open. Also in the long-press menu; out here too
              because it's something to read, not an action to tuck away. */}
          {post.author?.score != null && <FullReviewPill name={post.author?.name ?? 'their'} onOpen={() => setReviewOf(post.id)} />}
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
          <VoteButtons
            postId={post.id}
            likes={post.likeCount}
            dislikes={post.dislikeCount}
            myVote={post.myVote}
          />
          <Pressable onPress={() => onReply(post)} hitSlop={8}>
            <Text style={styles.replyText}>Reply</Text>
          </Pressable>
          {post.replyCount > 0 && (
            <Pressable onPress={() => setOpen((v) => !v)} hitSlop={8} style={styles.disclosure}>
              <Text style={styles.replyToggle}>
                {post.replyCount} {post.replyCount === 1 ? 'reply' : 'replies'}
              </Text>
              {open
                ? <ChevronUp size={13} color={colors.green} />
                : <ChevronDown size={13} color={colors.green} />}
            </Pressable>
          )}
        </View>
      )}

      {open && (
        <View style={styles.replies}>
          {repliesLoading ? (
            <ActivityIndicator color={colors.green} style={{ marginVertical: spacing.sm }} />
          ) : (
            replies.map((r) => (
              <View key={r.id} style={styles.reply}>
                {r.deleted ? (
                  <Text style={styles.tombstone}>This reply was removed.</Text>
                ) : (
                  <>
                    <View style={styles.postHead}>
                      <Avatar name={r.author?.name ?? '?'} avatarUrl={r.author?.avatarUrl} size={22} />
                      <Text style={styles.replyAuthor} numberOfLines={1}>
                        {r.author?.name ?? 'Unknown'}
                      </Text>
                      {r.author?.score != null && (
                        <Text
                          style={[styles.replyScore, { color: songScoreColor(r.author.score) }]}
                          maxFontSizeMultiplier={NUM_SCALE_CAP}
                        >
                          {r.author.score.toFixed(2)}
                        </Text>
                      )}
                      {r.author?.score != null && <FullReviewPill compact name={r.author?.name ?? 'their'} onOpen={() => setReviewOf(r.id)} />}
                    </View>
                    <Text style={styles.replyBody}>{r.body}</Text>
                    <View style={styles.replyActions}>
                      <VoteButtons
                        postId={r.id}
                        likes={r.likeCount}
                        dislikes={r.dislikeCount}
                        myVote={r.myVote}
                        compact
                      />
                    </View>
                  </>
                )}
              </View>
            ))
          )}
        </View>
      )}

      <FullReviewSheet postId={reviewOf} onClose={() => setReviewOf(null)} />

      <AnchoredMenu
        visible={menu}
        anchorRef={anchor}
        onClose={() => setMenu(false)}
        onSelect={onSelect}
        options={[
          { key: 'reply', value: 'reply', label: 'Reply', selected: false },
          ...(post.author?.score != null
            ? [{ key: 'review', value: 'review', label: `Access ${post.author?.name ?? 'their'}'s full review`, selected: false }]
            : []),
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

  sortRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    gap: spacing.sm, paddingHorizontal: spacing.lg, paddingBottom: spacing.md,
  },
  sortChips: { flexDirection: 'row', gap: spacing.sm, flexShrink: 1 },
  raterCount: { fontFamily: fonts.body, fontSize: 12, color: colors.inkTertiary },
  sortChip: { paddingHorizontal: spacing.md, paddingVertical: 6, borderRadius: radii.pill, backgroundColor: colors.inset },
  sortChipOn: { backgroundColor: colors.ink },
  sortText: { fontFamily: fonts.bodyMedium, fontSize: 12, color: colors.inkSecondary },
  sortTextOn: { color: '#fff' },

  list: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl },
  empty: { fontFamily: fonts.body, fontSize: 14, color: colors.inkTertiary, textAlign: 'center', marginTop: spacing.xxl },

  // A rule instead of a filled card: these are the record's numbers, not
  // another voice in the room, and a green panel made them read as one. The
  // line still has to be there — without it the average runs straight into
  // the first post and looks like somebody's score.
  summaryWrap: {
    paddingTop: spacing.sm, paddingBottom: spacing.lg, marginBottom: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  summary: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg },
  everyToggle: { marginTop: spacing.md, alignSelf: 'flex-start' },
  everyList: { marginTop: spacing.sm },
  everyRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 5 },
  everyNum: { width: 20, textAlign: 'right', fontFamily: fonts.body, fontSize: 11.5, color: colors.inkMuted },
  everyTop: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  everyTitle: { flexShrink: 1, fontFamily: fonts.body, fontSize: 13, color: colors.inkSecondary },
  everyTitleMarked: { fontFamily: fonts.bodySemiBold, color: colors.ink },
  everyRaters: { fontFamily: fonts.body, fontSize: 10.5, color: colors.inkMuted },
  everyBar: { height: 3, borderRadius: 2, backgroundColor: colors.inset, overflow: 'hidden', marginTop: 4 },
  everyBarFill: { height: '100%', borderRadius: 2 },
  everyScore: { width: 32, textAlign: 'right', fontFamily: fonts.display, fontSize: 14 },
  summaryValue: { fontFamily: fonts.display, fontSize: 30 },
  summaryTracks: { flex: 1, minWidth: 0, gap: 6 },
  summaryTrack: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  summaryTrackTitle: { flex: 1, minWidth: 0, fontFamily: fonts.bodyMedium, fontSize: 13, color: colors.ink },
  summaryTrackScore: { fontFamily: fonts.display, fontSize: 15 },
  post: { paddingVertical: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  postSystem: {
    backgroundColor: colors.greenSoft, borderRadius: radii.md, borderBottomWidth: 0,
    paddingHorizontal: spacing.md, marginTop: spacing.sm, marginBottom: spacing.sm,
  },
  systemLabel: { fontFamily: fonts.bodyBold, fontSize: 10, letterSpacing: 1, color: colors.green, marginBottom: 4 },
  systemBody: { fontFamily: fonts.displayRegular, fontSize: 15, color: colors.ink },
  postHead: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: 6,
    justifyContent: 'space-between',
  },
  replyAuthor: { flex: 1, minWidth: 0, fontFamily: fonts.bodySemiBold, fontSize: 14.5, color: colors.ink },
  // Smaller than the name it sits beside, deliberately.
  postScore: { fontFamily: fonts.display, fontSize: 15 },
  postAuthor: { flex: 1, minWidth: 0, fontFamily: fonts.bodySemiBold, fontSize: 17, color: colors.ink },
  postBody: { fontFamily: fonts.body, fontSize: 15, color: colors.ink, lineHeight: 22 },
  postHidden: { color: colors.inkMuted, fontStyle: 'italic' },
  postActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg, marginTop: spacing.sm },
  replyText: { fontFamily: fonts.bodyMedium, fontSize: 12, color: colors.inkTertiary },
  disclosure: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  replyToggle: { fontFamily: fonts.bodySemiBold, fontSize: 12, color: colors.green },
  // Indented and ruled on the left so a reply reads as hanging off the post
  // above it rather than as another post in the thread.
  replies: {
    marginTop: spacing.sm, marginLeft: spacing.md, paddingLeft: spacing.md,
    borderLeftWidth: 2, borderLeftColor: colors.border,
  },
  reply: { paddingVertical: spacing.sm },
  replyScore: { fontFamily: fonts.display, fontSize: 13 },
  replyBody: { fontFamily: fonts.body, fontSize: 14, color: colors.ink, lineHeight: 20 },
  replyActions: { flexDirection: 'row', alignItems: 'center', marginTop: 6 },
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
