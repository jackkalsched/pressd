// For You — the home feed as one fluid editorial column: resume, a daily "rate
// this next" pick, new releases (with add actions), Press'd Trending, and "what
// are pressers talking about" (userbase-wide top reviews for the day). No boxed
// cards — sections are separated by whitespace and hairline rules.
import { useMemo, useState } from 'react'
import {
  ActivityIndicator,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Image } from 'expo-image'
import { useRouter } from 'expo-router'
import { ArrowRight, Check, ChevronDown, Heart, MessageCircle, Play, Plus, Star, ThumbsDown } from 'lucide-react-native'
import {
  fetchAlbum,
  fetchAlbums,
  fetchNewReleases,
  fetchTrending,
  fetchTopReviews,
  toggleLike,
  resolveDeezerAlbum,
  importAlbum,
  type NewRelease,
  type TopReview,
} from '../../lib/api'
import { songScoreColor } from '@pressd/shared/types'
import { useAuth } from '../../lib/auth'
import { colors, fonts, radii, spacing } from '../../theme/tokens'

function greeting(): string {
  const h = new Date().getHours()
  if (h < 12) return 'Good morning.'
  if (h < 18) return 'Good afternoon.'
  return 'Good evening.'
}

// Light tint of a score's own hue (dark-red → dark-green), matching the web
// ScorePill background; paired with songScoreColor() for the text.
function scoreTint(s: number): string {
  const hue = Math.round(((s - 1) / 9) * 130)
  return `hsl(${hue}, 46%, 94%)`
}

function dayLabel(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso + 'T00:00:00')
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const diff = Math.round((today.getTime() - d.getTime()) / 86_400_000)
  if (diff <= 0) return 'Today'
  if (diff === 1) return 'Yesterday'
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })
}

function SectionHead({ label, meta, onMetaPress }: { label: string; meta?: string; onMetaPress?: () => void }) {
  return (
    <View style={styles.sectionHead}>
      <Text style={styles.sectionLabel}>{label}</Text>
      {meta == null ? null : onMetaPress ? (
        <Pressable style={styles.sectionMetaBtn} onPress={onMetaPress} hitSlop={8}>
          <Text style={styles.sectionMetaBtnText}>{meta}</Text>
          <ChevronDown size={12} color={colors.green} />
        </Pressable>
      ) : (
        <Text style={styles.sectionMeta}>{meta}</Text>
      )}
    </View>
  )
}

export default function ForYou() {
  const router = useRouter()
  const queryClient = useQueryClient()
  const { user } = useAuth()
  const userId = user?.id ?? 0
  const [refreshing, setRefreshing] = useState(false)
  const [trendMode, setTrendMode] = useState<'week' | 'top'>('week')
  const [trendPickerOpen, setTrendPickerOpen] = useState(false)

  const { data: listening = [], refetch: refetchListening } = useQuery({
    queryKey: ['albums', 'listening', userId],
    queryFn: () => fetchAlbums({ status: 'listening', userId }),
    enabled: userId > 0,
  })
  const { data: toListen = [], refetch: refetchToListen } = useQuery({
    queryKey: ['albums', 'to_listen', userId],
    queryFn: () => fetchAlbums({ status: 'to_listen', userId }),
    enabled: userId > 0,
  })
  const { data: newReleases = [], refetch: refetchNew } = useQuery({
    queryKey: ['new-releases'],
    queryFn: () => fetchNewReleases(12),
  })
  const { data: trending = [], refetch: refetchTrending } = useQuery({
    queryKey: ['discover', 'trending', trendMode],
    queryFn: () => fetchTrending(trendMode, trendMode === 'top' ? 10 : 8),
  })
  const { data: topReviews, refetch: refetchTopReviews } = useQuery({
    queryKey: ['top-reviews'],
    queryFn: () => fetchTopReviews(8),
    enabled: userId > 0,
  })

  // Resume: most recently touched in-progress album. The list endpoint omits
  // songs, so fetch the full album for an accurate rated-track count.
  const continueAlbum = useMemo(() => {
    if (listening.length === 0) return null
    return [...listening].sort((a, b) => (b.dateAdded ?? '').localeCompare(a.dateAdded ?? ''))[0]
  }, [listening])
  const { data: continueFull } = useQuery({
    queryKey: ['album', continueAlbum?.id],
    queryFn: () => fetchAlbum(continueAlbum!.id),
    enabled: !!continueAlbum,
  })
  const resumeDone = continueFull?.songs.filter((s) => s.score != null).length ?? 0
  const resumeTotal = continueFull?.songs.length ?? continueAlbum?.totalTracks ?? 0

  // Rate this next: rotates once per day through the queue (recommended albums
  // first when any exist), stable within the day.
  const suggestion = useMemo(() => {
    if (toListen.length === 0) return null
    const recs = toListen.filter((a) => a.recommendedByName)
    const pool = [...(recs.length ? recs : toListen)].sort((a, b) => a.id - b.id)
    const dayIndex = Math.floor(Date.now() / 86_400_000)
    return pool[dayIndex % pool.length]
  }, [toListen])

  async function onRefresh() {
    setRefreshing(true)
    await Promise.all([refetchListening(), refetchToListen(), refetchNew(), refetchTrending(), refetchTopReviews()])
    setRefreshing(false)
  }

  function openAlbum(id: number) {
    router.push({ pathname: '/album/[id]', params: { id: String(id) } })
  }
  function openRate(id: number) {
    router.push({ pathname: '/rate/[id]', params: { id: String(id) } })
  }
  async function likeReview(albumId: number) {
    if (!user) return
    try {
      await toggleLike(user.id, albumId)
      queryClient.invalidateQueries({ queryKey: ['top-reviews'] })
    } catch { /* ignore */ }
  }

  const today = new Date()
    .toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
    .toUpperCase()
  const firstName = user?.name?.split(' ')[0] ?? ''
  const reviews = topReviews?.reviews ?? []

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.green} />}
      >
        <Text style={styles.date}>{today}</Text>
        <Text style={styles.title}>For You</Text>
        <Text style={styles.sub}>
          {greeting()}{firstName ? ` ${firstName},` : ''} here's what's moving this week.
        </Text>

        {/* Pick up where you left off */}
        {continueAlbum && (
          <View style={styles.block}>
            <SectionHead label="PICK UP WHERE YOU LEFT OFF" />
            <Pressable style={styles.mediaRow} onPress={() => openRate(continueAlbum.id)}>
              <Cover uri={continueAlbum.albumArtUrl} seed={continueAlbum.albumName} size={64} />
              <View style={styles.mediaText}>
                <Text style={styles.rowTitle} numberOfLines={1}>{continueAlbum.albumName}</Text>
                <Text style={styles.rowSub} numberOfLines={1}>
                  {continueAlbum.artist}{continueAlbum.year ? ` · ${continueAlbum.year}` : ''}
                </Text>
                <View style={styles.progressRow}>
                  <View style={styles.progressTrack}>
                    <View style={[styles.progressFill, { width: `${resumeTotal ? (resumeDone / resumeTotal) * 100 : 0}%` }]} />
                  </View>
                  <Text style={styles.progressText}>{resumeDone}/{resumeTotal}</Text>
                </View>
              </View>
              <ArrowRight size={18} color={colors.green} />
            </Pressable>
          </View>
        )}

        {/* Rate this next — held in a subtle cell so the CTA stands apart */}
        {suggestion && (
          <View style={styles.block}>
            <SectionHead label="RATE THIS NEXT" />
            <Pressable style={styles.suggestCell} onPress={() => openRate(suggestion.id)}>
              <View style={styles.mediaRow}>
                <Cover uri={suggestion.albumArtUrl} seed={suggestion.albumName} size={64} />
                <View style={styles.mediaText}>
                  <Text style={styles.rowTitle} numberOfLines={1}>{suggestion.albumName}</Text>
                  <Text style={styles.rowSub} numberOfLines={1}>{suggestion.artist}</Text>
                  <Text style={styles.suggestWhy} numberOfLines={1}>
                    {suggestion.recommendedByName
                      ? `Recommended by ${suggestion.recommendedByName}`
                      : suggestion.predictedScore != null
                      ? `We think you'll rate this about ${suggestion.predictedScore.toFixed(2)}`
                      : 'Next up in your queue'}
                  </Text>
                </View>
                {suggestion.predictedScore != null && (
                  <View style={styles.predict}>
                    <Text style={[styles.predictScore, { color: songScoreColor(suggestion.predictedScore) }]}>
                      {suggestion.predictedScore.toFixed(2)}
                    </Text>
                    <Text style={styles.predictLabel}>PREDICTED</Text>
                  </View>
                )}
              </View>
              <View style={styles.suggestCta}>
                <Text style={styles.textCtaLabel}>Start rating</Text>
                <ArrowRight size={14} color={colors.green} />
              </View>
            </Pressable>
          </View>
        )}

        {/* New & Popular — tap a cover to reveal add actions */}
        {newReleases.length > 0 && user && (
          <View style={styles.block}>
            <SectionHead label="NEW & POPULAR" />
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.rail}>
              {newReleases.map((r) => (
                <NewReleaseCard
                  key={r.deezerId}
                  release={r}
                  userId={user.id}
                  onRate={openRate}
                  onAdded={() => queryClient.invalidateQueries({ queryKey: ['albums', 'to_listen', userId] })}
                />
              ))}
            </ScrollView>
          </View>
        )}

        {/* Press'd Trending */}
        {trending.length > 0 && (
          <View style={styles.block}>
            <SectionHead
              label="PRESS'D TRENDING"
              meta={trendMode === 'week' ? 'This week' : 'All time'}
              onMetaPress={() => setTrendPickerOpen(true)}
            />
            {trending.map((t, i) => (
              <Pressable key={t.album_id} style={[styles.trendRow, i > 0 && styles.hairline]} onPress={() => openAlbum(t.album_id)}>
                <Text style={styles.rank}>{i + 1}</Text>
                <Cover uri={t.album_art_url} seed={t.album_name} size={46} />
                <View style={styles.mediaText}>
                  <Text style={styles.rowTitle} numberOfLines={1}>{t.album_name}</Text>
                  <Text style={styles.rowSub} numberOfLines={1}>{t.artist}</Text>
                </View>
                {t.avg_score != null && (
                  <View style={[styles.scorePill, { backgroundColor: scoreTint(t.avg_score) }]}>
                    <Text style={[styles.scorePillText, { color: songScoreColor(t.avg_score) }]}>{t.avg_score.toFixed(2)}</Text>
                  </View>
                )}
              </Pressable>
            ))}
          </View>
        )}

        {/* What are pressers talking about — userbase-wide reviews for the day */}
        {topReviews && (
          <View style={styles.block}>
            <SectionHead
              label="WHAT ARE PRESSERS TALKING ABOUT"
              meta={reviews.length > 0 ? dayLabel(topReviews.day) : undefined}
            />
            {reviews.length > 0 ? (
              reviews.map((rv, i) => (
                <ReviewCell
                  key={`${rv.album_id}-${rv.author.id}`}
                  review={rv}
                  first={i === 0}
                  onOpen={() => openAlbum(rv.album_id)}
                  onLike={() => likeReview(rv.album_id)}
                />
              ))
            ) : (
              <View style={styles.reviewEmpty}>
                <Text style={styles.reviewEmptyQuote}>No reviews yet today.</Text>
                <Text style={styles.reviewEmptyBody}>
                  Be the first — rate an album and leave your take to start the conversation.
                </Text>
                <Pressable style={styles.reviewEmptyCta} onPress={() => router.push('/add')}>
                  <Text style={styles.textCtaLabel}>Add an album</Text>
                  <ArrowRight size={14} color={colors.green} />
                </Pressable>
              </View>
            )}
          </View>
        )}
      </ScrollView>

      {/* Press'd Trending range dropdown */}
      <Modal visible={trendPickerOpen} transparent animationType="slide" onRequestClose={() => setTrendPickerOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setTrendPickerOpen(false)}>
          <Pressable style={styles.sheet}>
            <Text style={styles.sheetTitle}>Press'd Trending</Text>
            {([['week', 'This week'], ['top', 'All time']] as const).map(([key, label]) => (
              <Pressable
                key={key}
                style={styles.optionRow}
                onPress={() => { setTrendMode(key); setTrendPickerOpen(false) }}
              >
                <Text style={styles.optionText}>{label}</Text>
                {trendMode === key && <Check size={18} color={colors.green} />}
              </Pressable>
            ))}
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  )
}

function NewReleaseCard({
  release,
  userId,
  onRate,
  onAdded,
}: {
  release: NewRelease
  userId: number
  onRate: (id: number) => void
  onAdded: () => void
}) {
  const [revealed, setRevealed] = useState(false)
  const [pending, setPending] = useState<'rate' | 'listen' | null>(null)
  const [added, setAdded] = useState(false)

  async function act(kind: 'rate' | 'listen') {
    if (pending || added) return
    setPending(kind)
    try {
      const full = await resolveDeezerAlbum(release.deezerId)
      const album = await importAlbum(full, kind === 'rate' ? 'listening' : 'to_listen', userId)
      if (kind === 'rate') { onRate(album.id); return }
      setAdded(true)
      onAdded()
    } catch {
      /* leave the card in place */
    } finally {
      if (kind !== 'rate') setPending(null)
    }
  }

  return (
    <View style={styles.railItem}>
      <Pressable onPress={() => setRevealed((v) => !v)}>
        <Cover uri={release.coverUrl} seed={release.albumName} size={128} radius={radii.md} />
        {added ? (
          <View style={styles.railOverlay}>
            <Check size={18} color="#fff" />
            <Text style={styles.railOverlayText}>In your library</Text>
          </View>
        ) : revealed ? (
          <View style={styles.railOverlay}>
            <Pressable style={styles.railBtn} onPress={() => act('rate')} disabled={!!pending}>
              {pending === 'rate' ? <ActivityIndicator size="small" color="#fff" /> : <Play size={13} color="#fff" fill="#fff" />}
              <Text style={styles.railBtnText}>Rate now</Text>
            </Pressable>
            <Pressable style={[styles.railBtn, styles.railBtnAlt]} onPress={() => act('listen')} disabled={!!pending}>
              {pending === 'listen' ? <ActivityIndicator size="small" color={colors.ink} /> : <Plus size={14} color={colors.ink} />}
              <Text style={styles.railBtnAltText}>To listen</Text>
            </Pressable>
          </View>
        ) : null}
      </Pressable>
      <Text style={styles.railName} numberOfLines={1}>{release.albumName}</Text>
      <Text style={styles.railArtist} numberOfLines={1}>{release.artist}</Text>
    </View>
  )
}

function ReviewCell({ review, first, onOpen, onLike }: { review: TopReview; first: boolean; onOpen: () => void; onLike: () => void }) {
  return (
    <View style={[styles.review, !first && styles.hairline]}>
      <Pressable onPress={onOpen}>
        {/* Reviewer identity leads, bigger than the album */}
        <View style={styles.reviewHead}>
          <Cover uri={review.author.avatar_url} seed={review.author.name} size={38} radius={19} />
          <View style={styles.mediaText}>
            <Text style={styles.reviewAuthor} numberOfLines={1}>{review.author.name}</Text>
            <Text style={styles.reviewOn} numberOfLines={1}>reviewed {review.album_name}</Text>
          </View>
          {review.score != null && (
            <Text style={[styles.reviewScore, { color: songScoreColor(review.score) }]}>{review.score.toFixed(2)}</Text>
          )}
        </View>

        <Text style={styles.reviewQuote}>“{review.review}”</Text>

        {/* Album cover + name, smaller than the reviewer */}
        <View style={styles.reviewAlbumRow}>
          <Cover uri={review.album_art_url} seed={review.album_name} size={40} />
          <View style={styles.mediaText}>
            <Text style={styles.reviewAlbum} numberOfLines={1}>{review.album_name}</Text>
            <Text style={styles.reviewArtist} numberOfLines={1}>{review.artist}</Text>
          </View>
        </View>

        {(review.top_song || review.bottom_song) && (
          <View style={styles.songNotes}>
            {review.top_song && (
              <View style={styles.songNote}>
                <Star size={12} color={songScoreColor(review.top_song.score)} fill={songScoreColor(review.top_song.score)} />
                <Text style={styles.songNoteText} numberOfLines={1}>{review.top_song.title}</Text>
                <Text style={[styles.songNoteScore, { color: songScoreColor(review.top_song.score) }]}>{review.top_song.score.toFixed(1)}</Text>
              </View>
            )}
            {review.bottom_song && (
              <View style={styles.songNote}>
                <ThumbsDown size={12} color={songScoreColor(review.bottom_song.score)} />
                <Text style={styles.songNoteText} numberOfLines={1}>{review.bottom_song.title}</Text>
                <Text style={[styles.songNoteScore, { color: songScoreColor(review.bottom_song.score) }]}>{review.bottom_song.score.toFixed(1)}</Text>
              </View>
            )}
          </View>
        )}
      </Pressable>

      <View style={styles.reviewActions}>
        <Pressable style={styles.reviewAction} onPress={onLike} hitSlop={8}>
          <Heart size={15} color={review.liked_by_me ? '#c0392b' : colors.inkMuted} fill={review.liked_by_me ? '#c0392b' : 'transparent'} />
          <Text style={styles.reviewActionText}>{review.like_count}</Text>
        </Pressable>
        <Pressable style={styles.reviewAction} onPress={onOpen} hitSlop={8}>
          <MessageCircle size={15} color={colors.inkMuted} />
          <Text style={styles.reviewActionText}>{review.comment_count}</Text>
        </Pressable>
      </View>
    </View>
  )
}

function Cover({ uri, seed, size, radius = radii.sm }: { uri?: string | null; seed: string; size: number; radius?: number }) {
  if (uri) {
    return <Image source={{ uri }} style={{ width: size, height: size, borderRadius: radius }} contentFit="cover" />
  }
  return (
    <View style={[styles.coverFallback, { width: size, height: size, borderRadius: radius }]}>
      <Text style={[styles.coverInitial, { fontSize: size * 0.36 }]}>{seed[0]?.toUpperCase()}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: spacing.lg, paddingBottom: 130 },
  date: { fontFamily: fonts.bodyBold, fontSize: 11, letterSpacing: 1.2, color: colors.inkMuted, marginTop: spacing.lg },
  title: { fontFamily: fonts.display, fontSize: 38, color: colors.ink, letterSpacing: 1, marginTop: 2 },
  sub: { fontFamily: fonts.bodyMedium, fontSize: 14, color: colors.inkTertiary, marginTop: 4 },

  block: { marginTop: spacing.xxl },
  sectionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.md },
  sectionLabel: { fontFamily: fonts.bodyBold, fontSize: 13, letterSpacing: 0.6, color: colors.ink },
  sectionMeta: { fontFamily: fonts.bodyMedium, fontSize: 12, color: colors.inkTertiary },
  sectionMetaBtn: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingVertical: 3, paddingHorizontal: 9, borderRadius: radii.pill, backgroundColor: colors.greenSoft },
  sectionMetaBtnText: { fontFamily: fonts.bodySemiBold, fontSize: 12, color: colors.green },

  hairline: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },

  mediaRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: 2 },
  mediaText: { flex: 1, minWidth: 0 },
  rowTitle: { fontFamily: fonts.bodySemiBold, fontSize: 16, color: colors.ink },
  rowSub: { fontFamily: fonts.body, fontSize: 13, color: colors.inkTertiary, marginTop: 1 },

  progressRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: 8 },
  progressTrack: { flex: 1, maxWidth: 200, height: 4, borderRadius: 2, backgroundColor: colors.inset, overflow: 'hidden' },
  progressFill: { height: '100%', backgroundColor: colors.green, borderRadius: 2 },
  progressText: { fontFamily: fonts.body, fontSize: 11, color: colors.inkTertiary },

  suggestWhy: { fontFamily: fonts.body, fontSize: 12, color: colors.inkMuted, fontStyle: 'italic', marginTop: 6 },
  predict: { alignItems: 'center', minWidth: 52 },
  predictScore: { fontFamily: fonts.bodyBold, fontSize: 22 },
  predictLabel: { fontFamily: fonts.bodyBold, fontSize: 8, letterSpacing: 0.8, color: colors.inkMuted, marginTop: 1 },
  suggestCell: { backgroundColor: colors.greenSoft, borderRadius: radii.lg, padding: spacing.lg, marginHorizontal: -spacing.sm },
  suggestCta: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: spacing.md, paddingTop: spacing.sm, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(45,106,79,0.18)' },
  textCtaLabel: { fontFamily: fonts.bodySemiBold, fontSize: 14, color: colors.green },

  rail: { marginHorizontal: -spacing.lg, paddingHorizontal: spacing.lg },
  railItem: { width: 128, marginRight: spacing.md },
  railOverlay: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(28,25,23,0.6)', borderRadius: radii.md,
    alignItems: 'center', justifyContent: 'center', gap: spacing.sm, padding: spacing.sm,
  },
  railOverlayText: { fontFamily: fonts.bodySemiBold, fontSize: 12, color: '#fff' },
  railBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, backgroundColor: colors.green, borderRadius: radii.sm, paddingVertical: 7, width: 104 },
  railBtnText: { fontFamily: fonts.bodySemiBold, fontSize: 12, color: '#fff' },
  railBtnAlt: { backgroundColor: 'rgba(255,255,255,0.92)' },
  railBtnAltText: { fontFamily: fonts.bodySemiBold, fontSize: 12, color: colors.ink },
  railName: { fontFamily: fonts.bodySemiBold, fontSize: 13, color: colors.ink, marginTop: 7 },
  railArtist: { fontFamily: fonts.body, fontSize: 12, color: colors.inkTertiary, marginTop: 1 },

  trendRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.md },
  rank: { fontFamily: fonts.display, fontSize: 16, color: colors.inkMuted, width: 20, textAlign: 'center' },
  scorePill: { borderRadius: radii.sm, paddingHorizontal: 8, paddingVertical: 4, minWidth: 46, alignItems: 'center' },
  scorePillText: { fontFamily: fonts.bodyBold, fontSize: 14 },

  // Review cell — reviewer leads (bigger), album secondary, smaller quote
  review: { paddingVertical: spacing.lg },
  reviewHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  reviewAuthor: { fontFamily: fonts.bodyBold, fontSize: 17, color: colors.ink },
  reviewOn: { fontFamily: fonts.body, fontSize: 12, color: colors.inkTertiary, marginTop: 1 },
  reviewScore: { fontFamily: fonts.bodyBold, fontSize: 20 },
  reviewQuote: { fontFamily: fonts.displayRegular, fontSize: 15, lineHeight: 22, color: colors.ink, marginTop: spacing.md },
  reviewAlbumRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.md },
  reviewAlbum: { fontFamily: fonts.bodySemiBold, fontSize: 13, color: colors.ink },
  reviewArtist: { fontFamily: fonts.body, fontSize: 12, color: colors.inkTertiary, marginTop: 1 },

  songNotes: { marginTop: spacing.md, gap: 5 },
  songNote: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  songNoteText: { flex: 1, fontFamily: fonts.bodyMedium, fontSize: 12, color: colors.inkSecondary },
  songNoteScore: { fontFamily: fonts.bodyBold, fontSize: 12 },

  reviewActions: { flexDirection: 'row', gap: spacing.xl, marginTop: spacing.md, paddingLeft: 38 + spacing.sm },
  reviewAction: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  reviewActionText: { fontFamily: fonts.bodyMedium, fontSize: 13, color: colors.inkTertiary },

  reviewEmpty: { paddingTop: spacing.xs },
  reviewEmptyQuote: { fontFamily: fonts.display, fontSize: 19, color: colors.ink },
  reviewEmptyBody: { fontFamily: fonts.body, fontSize: 13, color: colors.inkTertiary, lineHeight: 19, marginTop: 6, maxWidth: 320 },
  reviewEmptyCta: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: spacing.md },

  coverFallback: { backgroundColor: colors.inset, alignItems: 'center', justifyContent: 'center' },
  coverInitial: { fontFamily: fonts.display, color: colors.inkMuted },

  // Trending range dropdown sheet
  backdrop: { flex: 1, backgroundColor: 'rgba(28,25,23,0.4)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.bg, borderTopLeftRadius: radii.xl, borderTopRightRadius: radii.xl, paddingTop: spacing.lg, paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl },
  sheetTitle: { fontFamily: fonts.bodySemiBold, fontSize: 16, color: colors.ink, marginBottom: spacing.sm },
  optionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border },
  optionText: { fontFamily: fonts.bodyMedium, fontSize: 15, color: colors.ink },
})
