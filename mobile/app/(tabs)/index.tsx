// For You — the home feed as one fluid editorial column: resume, a daily "rate
// this next" pick, new releases (with add actions), Pressd Trending, and "what
// are pressers talking about" (userbase-wide top reviews for the day). No boxed
// cards — sections are separated by whitespace and hairline rules.
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Animated,
  Dimensions,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Image } from 'expo-image'
import { useRouter } from 'expo-router'
import { ArrowRight, ChevronDown, Heart, MessageCircle, Triangle } from 'lucide-react-native'
import {
  fetchAlbum,
  fetchPredictedPicks,
  fetchAlbums,
  fetchNewReleases,
  fetchTrending,
  fetchTopReviews,
  toggleLike,
  type NewRelease,
  type TopReview,
  type TrendingAlbum,
} from '../../lib/api'
import { songScoreColor, type Album } from '@pressd/shared/types'
import AnchoredMenu from '../../components/AnchoredMenu'
import RecommendationBanner from '../../components/RecommendationBanner'
import { markRecsSeen, recTime, useRecsSeen } from '../../lib/recsSeen'
import { useAuth } from '../../lib/auth'
import { revealStyle } from '../../lib/scrollReveal'
import { colors, fonts, radii, spacing, NUM_SCALE_CAP } from '../../theme/tokens'

const WINDOW_H = Dimensions.get('window').height

// No terminal punctuation: this opens a sentence the subline finishes, rather
// than standing as one of its own.
function greeting(): string {
  const h = new Date().getHours()
  if (h < 12) return 'Good morning'
  if (h < 18) return 'Good afternoon'
  return 'Good evening'
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

function SectionHead({ label, meta, onMetaPress, metaRef }: {
  label: string
  meta?: string
  onMetaPress?: () => void
  /** The meta chip doubles as a dropdown trigger; the menu anchors to it. */
  metaRef?: React.RefObject<View | null>
}) {
  return (
    <View style={styles.sectionHead}>
      <Text style={styles.sectionLabel}>{label}</Text>
      {meta == null ? null : onMetaPress ? (
        <Pressable ref={metaRef} style={styles.sectionMetaBtn} onPress={onMetaPress} hitSlop={8}>
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
  const insets = useSafeAreaInsets()
  const { user } = useAuth()
  const userId = user?.id ?? 0
  const [refreshing, setRefreshing] = useState(false)
  const [trendMode, setTrendMode] = useState<'week' | 'top'>('week')
  const [trendPickerOpen, setTrendPickerOpen] = useState(false)
  const trendChipRef = useRef<View>(null)
  const [trendBlockY, setTrendBlockY] = useState(0)

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
  // Catalog picks: the nightly model scores every album anyone has added, not
  // only this user's queue. Without them "Rate this next" had nothing to offer
  // anyone who doesn't queue albums — which is nearly everyone.
  const { data: picks = [] } = useQuery({
    queryKey: ['picks', userId],
    queryFn: () => fetchPredictedPicks(10),
    enabled: userId > 0,
    staleTime: 30 * 60_000,
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

  // Everything a friend has sent that's still unrated, newest first. Sorted on
  // recommendedAt rather than id: a friend can pass on a record that has sat in
  // the catalog for months, and its row id says when the album was added, not
  // when they sent it. Rows without a timestamp (sent before the column
  // existed) fall to the back rather than jumping the queue.
  const recommended = useMemo(
    () =>
      toListen
        .filter((a) => a.recommendedByName)
        .sort((a, b) => (b.recommendedAt ?? '').localeCompare(a.recommendedAt ?? '')),
    [toListen],
  )
  const newestRec = recommended[0] ?? null

  // The banner announces an arrival once — the first time the app is opened
  // after a friend sends something — rather than living on For You until the
  // record gets rated. Anything at or below the watermark has already been
  // announced on a previous launch.
  const seenTs = useRecsSeen()
  const unseenRec =
    newestRec && recTime(newestRec.recommendedAt) > seenTs ? newestRec : null

  // Held for the rest of this session once it has been shown. Marking it seen
  // writes the watermark forward, and without pinning the decision that write
  // would re-render the page and pull the banner out from under the reader
  // mid-scroll. It stays put until the app is next launched, which is what
  // "the first time they open the app" means.
  const shownRef = useRef<Album | null>(null)
  if (unseenRec && !shownRef.current) shownRef.current = unseenRec
  const bannerRec = shownRef.current

  useEffect(() => {
    if (!bannerRec) return
    markRecsSeen(recTime(bannerRec.recommendedAt))
  }, [bannerRec])

  // Rate this next: rotates once per day, stable within the day.
  //
  // Your queue and the catalog are one pool. The catalog half used to be a
  // fallback shown only when To Listen was empty, which meant anyone who had
  // queued a single album never saw a prediction again — and the predictions
  // are the half that can surface a record you'd never have thought to queue.
  // The nightly worker scores every album anyone has added, per user, so those
  // exist whether or not you own the record.
  const dayIndex = Math.floor(Date.now() / 86_400_000)
  const daily = useMemo(() => {
    // A friend asking still leads. That's a person waiting on an answer, not a
    // model's guess, and it shouldn't queue behind the catalog.
    if (recommended.length > 0) {
      const pool = [...recommended].sort((a, b) => a.id - b.id)
      return { queued: pool[dayIndex % pool.length], pick: null }
    }
    const queued = [...toListen].sort((a, b) => a.id - b.id)
    const total = queued.length + picks.length
    if (total === 0) return { queued: null, pick: null }
    // One index across both halves, so the rotation walks the whole pool
    // instead of alternating between two clocks.
    const i = dayIndex % total
    return i < queued.length
      ? { queued: queued[i], pick: null }
      : { queued: null, pick: picks[i - queued.length] }
  }, [toListen, picks, recommended, dayIndex])

  const suggestion = daily.queued
  const pick = daily.pick

  async function onRefresh() {
    setRefreshing(true)
    await Promise.all([refetchListening(), refetchToListen(), refetchNew(), refetchTrending(), refetchTopReviews()])
    setRefreshing(false)
  }

  function openAlbum(id: number) {
    router.push({ pathname: '/album/[id]', params: { id: String(id) } })
  }
  // Trending isn't tied to a person, so it opens the userbase's averaged view
  // rather than whichever copy happened to be ranked.
  function openCommunityAlbum(id: number) {
    router.push({ pathname: '/album/[id]', params: { id: String(id), community: '1' } })
  }
  // A new release may not be in Pressd at all, so it's looked up by name and
  // carries its Deezer id for the tracklist and for importing on Rate now.
  function openRelease(r: NewRelease) {
    router.push({
      pathname: '/album/[id]',
      params: {
        // The id segment is unused when name+artist are present, but the route
        // requires one; the Deezer id only travels when the match succeeded.
        id: String(r.deezerId ?? 0),
        name: r.albumName,
        artist: r.artist,
        ...(r.deezerId != null ? { deezer: String(r.deezerId) } : {}),
      },
    })
  }
  /** A pick isn't in the library, so it opens the userbase view by name the way
   *  a new release does, and can be rated from there. */
  function openPick(p: { albumName: string; artist: string }) {
    router.push({
      pathname: '/album/[id]',
      params: { id: '0', name: p.albumName, artist: p.artist },
    })
  }
  function openRate(id: number) {
    router.push({ pathname: '/rate/[id]', params: { id: String(id) } })
  }
  /** The banner opens your own copy rather than the averaged view: the sender
   *  and their note live on your row, and the album page keys its recommended
   *  treatment off exactly that. */
  function openRecommendation(id: number) {
    router.push({ pathname: '/album/[id]', params: { id: String(id) } })
  }
  /** Rate this next leads with recommendations, and a recommendation is someone
   *  else's pick — dropping straight into the scoring flow scores a record the
   *  person hasn't heard of yet and gives them no way to look at it first. Open
   *  the album instead, which carries its own Rate now. Albums you queued
   *  yourself keep the fast path: you already know what they are. */
  function openSuggestion(a: Album) {
    if (a.recommendedByName) {
      router.push({ pathname: '/album/[id]', params: { id: String(a.id), community: '1' } })
      return
    }
    openRate(a.id)
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

  // Scroll-reactive masthead: the big title lifts + fades as you scroll, and a
  // compact title bar fades in at the top (native driver, so it stays smooth).
  const scrollY = useRef(new Animated.Value(0)).current
  const mastheadOpacity = scrollY.interpolate({ inputRange: [0, 96], outputRange: [1, 0], extrapolate: 'clamp' })
  const mastheadShift = scrollY.interpolate({ inputRange: [0, 96], outputRange: [0, -24], extrapolate: 'clamp' })
  const compactOpacity = scrollY.interpolate({ inputRange: [60, 118], outputRange: [0, 1], extrapolate: 'clamp' })

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      {/* Absolute children ignore the SafeAreaView's inset padding, so push the
          compact bar down below the status bar (clock) explicitly. */}
      <Animated.View
        style={[styles.compactHeader, { opacity: compactOpacity, paddingTop: insets.top + spacing.sm }]}
        pointerEvents="none"
      >
        <Text style={styles.compactTitle}>For You</Text>
      </Animated.View>
      <Animated.ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        scrollEventThrottle={16}
        onScroll={Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], { useNativeDriver: true })}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.green} />}
      >
        <Animated.View style={{ opacity: mastheadOpacity, transform: [{ translateY: mastheadShift }] }}>
          <View style={styles.masthead}>
            <Text style={styles.title}>For You</Text>
            {/* Two lines rather than one: on a narrow screen — a smaller phone,
                or any phone with Display Zoom or large text — a single-line
                date has nowhere to go and rides into the title. */}
            <Text style={styles.date} numberOfLines={2}>{today}</Text>
          </View>
          <Text style={styles.sub}>
            {greeting()}{firstName ? ` ${firstName}` : ''}, here&rsquo;s what&rsquo;s moving this week.
          </Text>
        </Animated.View>

        {/* Above everything else on the page, and above "pick up where you left
            off" in particular: that's your own unfinished business and it will
            keep, while this is a friend waiting on an answer. Absent entirely
            when nobody has sent you anything — an empty state here would be a
            permanent orange box advertising that you have no friends. */}
        {bannerRec && (
          <RecommendationBanner
            from={bannerRec.recommendedByName!}
            albumName={bannerRec.albumName}
            count={recommended.length}
            onPress={() => openRecommendation(bannerRec.id)}
          />
        )}

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

        {/* Nothing queued, but the model still has an opinion — same cell, so
            the section reads identically whether the record came from the
            user's own queue or from the catalog. */}
        {!suggestion && pick && (
          <View style={styles.block}>
            <SectionHead label="RATE THIS NEXT" />
            <Pressable style={styles.suggestCell} onPress={() => openPick(pick)}>
              <View style={styles.mediaRow}>
                <Cover uri={pick.coverUrl} seed={pick.albumName} size={64} />
                <View style={styles.mediaText}>
                  <Text style={styles.rowTitle} numberOfLines={1}>{pick.albumName}</Text>
                  <Text style={styles.rowSub} numberOfLines={1}>
                    {pick.artist}{pick.year ? ` · ${pick.year}` : ''}
                  </Text>
                  <Text style={styles.suggestWhy} numberOfLines={1}>
                    We think you&rsquo;ll rate this about {pick.predictedScore.toFixed(2)}
                  </Text>
                </View>
                <View style={styles.predict}>
                  <Text style={[styles.predictScore, { color: songScoreColor(pick.predictedScore) }]}>
                    {pick.predictedScore.toFixed(2)}
                  </Text>
                  <Text style={styles.predictLabel}>PREDICTED</Text>
                </View>
              </View>
            </Pressable>
          </View>
        )}

        {/* Rate this next — held in a subtle cell so the CTA stands apart */}
        {suggestion && (
          <View style={styles.block}>
            <SectionHead label="RATE THIS NEXT" />
            <Pressable style={styles.suggestCell} onPress={() => openSuggestion(suggestion)}>
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
              {/* Say where the tap actually goes — a recommendation opens the
                  record, it doesn't start scoring it. */}
              <View style={styles.suggestCta}>
                <Text style={styles.textCtaLabel}>
                  {suggestion.recommendedByName ? 'See album' : 'Start rating'}
                </Text>
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
              {/* deezerId is null for releases that never matched Deezer, and
                  more than one of those is normal — keying on it alone collides. */}
              {newReleases.map((r) => (
                <NewReleaseCard
                  key={r.deezerId ?? `${r.artist}::${r.albumName}`}
                  release={r}
                  onOpen={() => openRelease(r)}
                />
              ))}
            </ScrollView>
          </View>
        )}

        {/* Pressd Trending — bubbly cells that pop in as they scroll into view */}
        {trending.length > 0 && (
          <View style={styles.block} onLayout={(e) => setTrendBlockY(e.nativeEvent.layout.y)}>
            <SectionHead
              label="PRESSD TRENDING"
              meta={trendMode === 'week' ? 'This week' : 'All time'}
              onMetaPress={() => setTrendPickerOpen(true)}
              metaRef={trendChipRef}
            />
            {trending.map((t, i) => (
              <TrendRow
                key={t.album_id}
                item={t}
                rank={i + 1}
                weekly={trendMode === 'week'}
                scrollY={scrollY}
                baseY={trendBlockY}
                onPress={() => openCommunityAlbum(t.album_id)}
              />
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
      </Animated.ScrollView>

      {/* Pressd Trending range — anchored to the chip that opens it */}
      <AnchoredMenu
        visible={trendPickerOpen}
        anchorRef={trendChipRef}
        align="right"
        options={[
          { key: 'week', label: 'This week', value: 'week', selected: trendMode === 'week' },
          { key: 'top', label: 'All time', value: 'top', selected: trendMode === 'top' },
        ]}
        onSelect={(v) => setTrendMode(v as 'week' | 'top')}
        onClose={() => setTrendPickerOpen(false)}
      />
    </SafeAreaView>
  )
}

/** A fresh release. Tapping opens the album page, where the Pressd average,
 *  your prediction, and the rate / queue actions all live. */
function NewReleaseCard({ release, onOpen }: { release: NewRelease; onOpen: () => void }) {
  return (
    <Pressable style={styles.railItem} onPress={onOpen}>
      <Cover uri={release.coverUrl} seed={release.albumName} size={128} radius={radii.md} />
      <Text style={styles.railName} numberOfLines={1}>{release.albumName}</Text>
      <Text style={styles.railArtist} numberOfLines={1}>{release.artist}</Text>
    </Pressable>
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
            <Text style={[styles.reviewScore, { color: songScoreColor(review.score) }]} numberOfLines={1} maxFontSizeMultiplier={NUM_SCALE_CAP}>{review.score.toFixed(2)}</Text>
          )}
        </View>

        <Text style={styles.reviewQuote}>“{review.review}”</Text>

        {(review.top_song || review.bottom_song) && (
          <View style={styles.songNotes}>
            {review.top_song && (
              <View style={styles.songNote}>
                <Triangle size={11} color={colors.green} fill={colors.green} />
                <Text style={styles.songNoteText} numberOfLines={1}>{review.top_song.title}</Text>
                <Text style={[styles.songNoteScore, { color: songScoreColor(review.top_song.score) }]} numberOfLines={1} maxFontSizeMultiplier={NUM_SCALE_CAP}>{review.top_song.score.toFixed(1)}</Text>
              </View>
            )}
            {review.bottom_song && (
              <View style={styles.songNote}>
                <View style={{ transform: [{ rotate: '180deg' }] }}>
                  <Triangle size={11} color="#e0492b" fill="#e0492b" />
                </View>
                <Text style={styles.songNoteText} numberOfLines={1}>{review.bottom_song.title}</Text>
                <Text style={[styles.songNoteScore, { color: songScoreColor(review.bottom_song.score) }]} numberOfLines={1} maxFontSizeMultiplier={NUM_SCALE_CAP}>{review.bottom_song.score.toFixed(1)}</Text>
              </View>
            )}
          </View>
        )}

        {/* Album cover + name, smaller than the reviewer */}
        <View style={styles.reviewAlbumRow}>
          <Cover uri={review.album_art_url} seed={review.album_name} size={40} />
          <View style={styles.mediaText}>
            <Text style={styles.reviewAlbum} numberOfLines={1}>{review.album_name}</Text>
            <Text style={styles.reviewArtist} numberOfLines={1}>{review.artist}</Text>
          </View>
        </View>
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

// A trending cell that rises, overshoots and settles as it scrolls into view.
// `baseY` is the trending block's offset in the scroll content; combined with
// the row's own offset within the block it gives an absolute content position
// to interpolate the shared scrollY against. Native-driver friendly (opacity +
// transform only), so it stays smooth alongside the masthead animation.
function TrendRow({
  item,
  rank,
  weekly,
  scrollY,
  baseY,
  onPress,
}: {
  item: TrendingAlbum
  rank: number
  weekly: boolean
  scrollY: Animated.Value
  baseY: number
  onPress: () => void
}) {
  const [localY, setLocalY] = useState(0)
  const reveal = revealStyle(scrollY, baseY + localY, rank, WINDOW_H)

  return (
    <Animated.View onLayout={(e) => setLocalY(e.nativeEvent.layout.y)} style={reveal}>
      <Pressable
        style={({ pressed }) => [styles.trendRow, rank > 1 && styles.hairline, pressed && styles.trendRowPressed]}
        onPress={onPress}
      >
        <Text style={styles.rank}>{rank}</Text>
        <Cover uri={item.album_art_url} seed={item.album_name} size={46} />
        <View style={styles.mediaText}>
          <Text style={styles.rowTitle} numberOfLines={1}>{item.album_name}</Text>
          <Text style={styles.rowSub} numberOfLines={1}>{item.artist}</Text>
          <Text style={styles.trendCount} numberOfLines={1}>
            {item.rater_count} {item.rater_count === 1 ? 'rating' : 'ratings'}{weekly ? ' this week' : ''}
          </Text>
        </View>
        {item.avg_score != null && (
          <View style={[styles.scorePill, { backgroundColor: scoreTint(item.avg_score) }]}>
            <Text style={[styles.scorePillText, { color: songScoreColor(item.avg_score) }]} numberOfLines={1} maxFontSizeMultiplier={NUM_SCALE_CAP}>{item.avg_score.toFixed(2)}</Text>
          </View>
        )}
      </Pressable>
    </Animated.View>
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
  compactHeader: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 10,
    backgroundColor: colors.bg,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  compactTitle: { fontFamily: fonts.displayBlack, fontSize: 20, color: colors.ink, letterSpacing: 0.5 },
  // gap, not just space-between: with nothing between them the title and the
  // date are free to touch once the row runs out of width.
  masthead: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: spacing.md,
    marginTop: spacing.md,
  },
  // Shrinks and wraps; the title holds its size. A 40pt masthead losing
  // characters is a worse trade than a date on two lines.
  date: {
    flexShrink: 1,
    fontFamily: fonts.bodyBold,
    fontSize: 12,
    letterSpacing: 1.4,
    color: colors.inkTertiary,
    marginBottom: 8,
    textAlign: 'right',
  },
  title: { flexShrink: 0, fontFamily: fonts.displayBlack, fontSize: 40, color: colors.ink, letterSpacing: 0.5 },
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
  railName: { fontFamily: fonts.bodySemiBold, fontSize: 13, color: colors.ink, marginTop: 7 },
  railArtist: { fontFamily: fonts.body, fontSize: 12, color: colors.inkTertiary, marginTop: 1 },

  trendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
  },
  trendRowPressed: { opacity: 0.5 },
  trendCount: { fontFamily: fonts.body, fontSize: 10, color: colors.inkMuted, marginTop: 3 },
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
