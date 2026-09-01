// Album detail — read view for any album, and the entry into the rating screen:
// "Rate" (to-listen), "Continue" (listening), or "Edit rating" (rated). Shows
// the final or predicted score, factor breakdown, and per-track scores.
import { useCallback, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Animated,
  Dimensions,
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
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Image } from 'expo-image'
import * as Haptics from 'expo-haptics'
import Svg, { Text as SvgText } from 'react-native-svg'
import { ArrowLeft, Check, ChevronRight, Heart, Pencil, Share2, Star, Trash2 } from 'lucide-react-native'
import {
  fetchAlbum,
  fetchAlbums,
  fetchFriends,
  fetchCommunityAlbum,
  fetchCommunityAlbumByName,
  resolveDeezerAlbum,
  resolveReleaseByName,
  importAlbum,
  copyAlbumToLibrary,
  saveReview,
  deleteReview,
  toggleLike,
  resolveThread,
  type CommunityAlbum as CommunityAlbumData,
  type CommunityTrack,
} from '../../lib/api'
import { songScoreColor, avatarColor, EP_MAX_TRACKS, type Album, type Song } from '@pressd/shared/types'
import { normalizeTrackTitle } from '@pressd/shared/albumSearch'
import { useAuth } from '../../lib/auth'
import CommentThread from '../../components/CommentThread'
import AlbumBackdrop from '../../components/AlbumBackdrop'
import BangSkip from '../../components/BangSkip'
import ShareCard from '../../components/ShareCard'
import RecommendSheet from '../../components/RecommendSheet'
import AlbumThoughts from '../../components/AlbumThoughts'
import { threadKey } from '../../lib/refresh'
import NoComparisonYet from '../../components/NoComparisonYet'
import { confirmDeleteAlbum, useDeleteAlbum } from '../../lib/useDeleteAlbum'
import { colors, contentWidth, fitType, fonts, radii, spacing } from '../../theme/tokens'

const WINDOW_H = Dimensions.get('window').height

// Destructive red, shared by every delete control so removing a record looks
// the same wherever you reach it from.
const DANGER = '#b91c1c'
// The recommendation accent, shared with the star on a recommended cover.
const RECOMMEND = '#f97316'

/** "today" / "3 days ago" / "12 Mar". Prose rather than CommentThread's compact
 *  "3d" — that one is a suffix on a timestamp line, this reads inside a
 *  sentence about a person, and "sent 3d" is not how anyone says it. */
function relativeDay(iso: string): string {
  const then = new Date(iso)
  if (Number.isNaN(then.getTime())) return ''
  const days = Math.floor((Date.now() - then.getTime()) / 86_400_000)
  if (days <= 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 30) return `${days} days ago`
  return then.toLocaleDateString('en-US', { day: 'numeric', month: 'short' })
}

// The album average and the prediction are two readings of one thing, so they
// are set at one size. Both the filled numeral and the stroked one read from
// this — set it once and they can't drift.
//
// 64 is the size the design asks for, but the two share a row, so each gets
// half the content width less the divider. On a narrow screen "10.00" at 64pt
// is wider than that half and wrapped to a second line, which reads as broken
// rather than tight. Deriving the size from the width that's actually there
// keeps every normal phone at 64 and steps only a cramped one down.
const SCORE_COL_W = (contentWidth() - 1) / 2
const SCORE_SIZE = fitType(64, SCORE_COL_W)
const SCORE_LINE = SCORE_SIZE + 4

// The comparison card sits over the album backdrop, and at a lighter wash the
// cover's own colors read straight through and fight the score type. Heavier
// than colors.greenSoft so the card settles a shade darker and mutes whatever
// is behind it, but still short of opaque — the art should show, not compete.
const CMP_CARD_TINT = 0.18
const CMP_CARD_BORDER = 0.26

// Amber at parity, deepening toward green the further above and red the further
// below — the same ramp the library score badges run. ±1.5 saturates it: album
// scores cluster tightly enough that a gap that wide is already extreme.
const DIFF_FULL = 1.5
function diffColor(diff: number): string {
  const t = Math.min(1, Math.abs(diff) / DIFF_FULL)
  return diff >= 0
    ? `hsl(${Math.round(30 + t * 108)}, 70%, 30%)`
    : `hsl(${Math.round(30 - t * 30)}, 72%, 30%)`
}

/** The comparison in two lines: the sentence, with only the number carrying
 *  colour, then the track that drove the gap. Splitting them stops a long song
 *  title from wrapping the verdict into an unreadable block. */
function CompareVerdict({
  even,
  diff,
  before,
  after,
  widest,
}: {
  even: string
  diff: number
  before: string
  after: string
  widest: { title: string } | null
}) {
  if (Math.abs(diff) < 0.005) return <Text style={styles.cmpVerdict}>{even}</Text>
  return (
    <>
      <Text style={styles.cmpVerdict}>
        {before}
        <Text style={[styles.cmpDiff, { color: diffColor(diff) }]}>{Math.abs(diff).toFixed(2)}</Text>
        {after}
      </Text>
      {widest && (
        <Text style={styles.cmpWidest}>Biggest difference on “{widest.title}”</Text>
      )}
    </>
  )
}

/** The prediction drawn hollow: the same face and size as the real score, but
 *  stroked rather than filled, so the pair reads as measured-vs-estimated
 *  without needing a second colour or a dial. React Native text has no stroke
 *  property, so this goes through SVG. */
function OutlineScore({ value, size = SCORE_SIZE }: { value: number; size?: number }) {
  const w = size * 2.6
  // Matches the filled numeral's line box exactly, so both columns' labels sit
  // on the same line beneath them.
  const h = SCORE_LINE
  return (
    <Svg width={w} height={h}>
      <SvgText
        x={w / 2}
        y={size * 0.86}
        textAnchor="middle"
        fontFamily={fonts.display}
        fontSize={size}
        fill="none"
        stroke={colors.green}
        strokeWidth={1.6}
      >
        {value.toFixed(2)}
      </SvgText>
    </Svg>
  )
}

export default function AlbumDetail() {
  const { id, community, name, artist, deezer, compare } = useLocalSearchParams<{
    id: string
    community?: string
    name?: string
    artist?: string
    deezer?: string
    compare?: string
  }>()
  const albumId = Number(id)

  // New releases arrive by name+artist (they may not exist in Pressd yet);
  // everything else arrives with a copy's id.
  const byName = !!name && !!artist
  const isCommunity = community === '1' || byName
  const deezerId = deezer ? Number(deezer) : null
  const router = useRouter()
  // Onboarding reaches this screen with an empty stack: welcome replaces itself
  // with the rating flow, which replaces itself with this page, so a new user
  // finishing their first album had a Back button that did nothing. Falling
  // through to the tabs is what "back to the app" means when there is no
  // history to pop.
  const leave = useCallback(() => {
    if (router.canGoBack()) router.back()
    else router.replace('/(tabs)')
  }, [router])
  const queryClient = useQueryClient()
  const { user } = useAuth()

  // Tracklist reveal: rows fade + rise as they cross into view, and each new
  // one that crosses ticks the Taptic engine — the list feels like it's being
  // dealt out rather than simply scrolled past. Measured row offsets drive
  // both, so the haptic lands exactly when a row appears.
  const scrollY = useRef(new Animated.Value(0)).current
  const rowYs = useRef<Map<number, number>>(new Map())
  const crossedCount = useRef(-1)
  const onScroll = Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], {
    useNativeDriver: true,
    listener: (e: { nativeEvent: { contentOffset: { y: number } } }) => {
      const line = e.nativeEvent.contentOffset.y + WINDOW_H * 0.82
      let crossed = 0
      rowYs.current.forEach((y) => {
        if (y < line) crossed += 1
      })
      // First event just calibrates — rows already on screen shouldn't buzz.
      if (crossedCount.current < 0) {
        crossedCount.current = crossed
        return
      }
      if (crossed > crossedCount.current) Haptics.selectionAsync().catch(() => {})
      crossedCount.current = crossed
    },
  })

  const { data: album, isLoading, isError } = useQuery({
    queryKey: ['album', albumId],
    queryFn: () => fetchAlbum(albumId),
    enabled: !isCommunity,
  })

  // Generic entry points (trending, charts) open the userbase's averaged view
  // — one request, and it can't 403 the way a stranger's personal copy does.
  const {
    data: communityData,
    isLoading: communityLoading,
    isError: communityError,
  } = useQuery({
    queryKey: byName ? ['community-by-name', name, artist] : ['album', albumId, 'community'],
    queryFn: () => (byName ? fetchCommunityAlbumByName(name!, artist!) : fetchCommunityAlbum(albumId)),
    enabled: isCommunity,
  })

  // A release nobody has added yet has no Pressd tracklist; resolve one so the
  // page still shows the record, and so Rate now can import it. Releases that
  // never matched Deezer (common for AOTY's most-rated new records) carry no id
  // at all — those are resolved by searching name + artist instead.
  const needsResolve =
    byName && communityData != null && communityData.tracks.length === 0
  const { data: resolvedAlbum } = useQuery({
    queryKey: ['resolved-release', deezerId ?? `${name}::${artist}`],
    queryFn: () =>
      deezerId != null ? resolveDeezerAlbum(deezerId) : resolveReleaseByName(name!, artist!),
    enabled: needsResolve,
    staleTime: 60 * 60_000,
  })

  // Friends resolve the owner's name/color when viewing someone else's copy.
  const { data: friends = [] } = useQuery({
    queryKey: ['friends', user?.id],
    queryFn: () => fetchFriends(user!.id),
    enabled: !!user,
  })

  // Viewing someone else's copy: look up your own rating of the same album so
  // the two can be shown side by side. The list endpoint omits songs, so the
  // match is resolved to a full album fetch for per-track scores.
  const notMine = !!user && !!album && album.userId !== user.id
  const { data: myMatches = [] } = useQuery({
    queryKey: ['albums', 'rated', user?.id, album?.albumName, album?.artist],
    queryFn: () =>
      fetchAlbums({ status: 'rated', albumName: album!.albumName, artist: album!.artist, userId: user!.id }),
    enabled: notMine,
  })
  const myCopyId = myMatches[0]?.id
  const { data: myAlbum } = useQuery({
    queryKey: ['album', myCopyId],
    queryFn: () => fetchAlbum(myCopyId!),
    enabled: !!myCopyId,
  })

  // Only your own copy can be deleted — a friend's rating isn't yours to remove.
  // Declared above every early return: the community branch bails before this
  // point, so leaving it further down changed the hook count between renders
  // and blew up with "rendered more hooks than during the previous render" the
  // moment a delete sent the page back through here.
  const { confirmDelete, deleting } = useDeleteAlbum({
    albumId,
    albumName: album?.albumName ?? '',
    onDeleted: leave,
  })

  // Above the early returns for the same reason useDeleteAlbum is.
  const [sharing, setSharing] = useState(false)
  const [recommending, setRecommending] = useState(false)

  if (isCommunity) {
    if (communityLoading) {
      return (
        <SafeAreaView style={[styles.screen, styles.center]}>
          <ActivityIndicator color={colors.green} />
        </SafeAreaView>
      )
    }
    if (communityError || !communityData) {
      return <LoadFailed onBack={leave} />
    }
    // Fill in from the resolved release when Pressd has no copy of it yet.
    const shown: CommunityAlbumData = resolvedAlbum
      ? {
          ...communityData,
          year: communityData.year ?? resolvedAlbum.year,
          album_art_url: communityData.album_art_url ?? resolvedAlbum.cover_url,
          tracks: resolvedAlbum.tracks.map((t) => ({
            title: t.title,
            track_number: t.track_number,
            avg_score: null,
            rater_count: 0,
            your_score: null,
          })),
        }
      : communityData

    return (
      <CommunityAlbum
        data={shown}
        // Arriving from a personal copy's Compare button opens straight on the
        // breakdown rather than the averaged view.
        initialComparing={compare === '1'}
        onOpenYours={
          shown.your_album_id != null
            ? () =>
                router.push({
                  pathname: '/album/[id]',
                  params: { id: String(shown.your_album_id) },
                })
            : undefined
        }
        onBack={leave}
        onOpenArtist={(n) =>
          router.push({ pathname: '/artist/[name]', params: { name: encodeURIComponent(n) } })
        }
        onRate={() => startRating(shown)}
        onQueue={() => queueAlbum(shown)}
        onDeleted={leave}
      />
    )
  }

  if (isLoading) {
    return (
      <SafeAreaView style={[styles.screen, styles.center]}>
        <ActivityIndicator color={colors.green} />
      </SafeAreaView>
    )
  }
  // Personal copies are friends-only; without this an unauthorized album left
  // the screen spinning forever.
  if (isError || !album) {
    return <LoadFailed onBack={leave} />
  }

  const sorted = [...album.songs].sort((a, b) => (a.trackNumber ?? 0) - (b.trackNumber ?? 0))
  const isEP = album.songs.length <= EP_MAX_TRACKS
  const isRated = album.status === 'rated'
  const showScore = isRated ? album.score : album.predictedScore
  const scoreIsPredicted = !isRated && album.predictedScore != null

  const cta =
    album.status === 'rated' ? 'Edit rating' : album.status === 'listening' ? 'Continue' : 'Rate this album'
  const isMine = user != null && album.userId === user.id

  // Takes over the screen the way it does after a rating, so the card is the
  // whole surface and the Share control sits directly beneath it.
  if (sharing) return <ShareCard album={album} onClose={() => setSharing(false)} />
  const owner = !isMine && album.userId != null ? friends.find((f) => f.id === album.userId) ?? null : null
  const ownerColor = owner ? avatarColor(owner.name) : colors.green

  // The whole recommended presentation hangs off this one condition: it's your
  // copy and somebody sent it. On a friend's copy the sender is their business,
  // not yours, so the page stays ordinary.
  const wasRecommended = isMine && !!album.recommendedByName
  // Matched by id, not name — two friends can share a first name, and the id is
  // what the sender was recorded as. Falls back to initials when they aren't in
  // your friends list any more.
  const recSender = album.recommendedBy != null
    ? friends.find((f) => f.id === album.recommendedBy) ?? null
    : null
  const recWhen = album.recommendedAt ? relativeDay(album.recommendedAt) : null

  // Compare is offered wherever a comparison exists to make, so the control is
  // the same however you reached the record — your own copy from the library or
  // an artist page, or a friend's copy you've also rated. It needs a score of
  // yours to hold against the userbase: this copy's when it's yours, otherwise
  // your separate copy of the same record.
  const canCompare =
    (isMine ? isRated && album.score != null : myAlbum?.status === 'rated' && myAlbum.score != null) === true
  const openCompare = () =>
    router.push({
      pathname: '/album/[id]',
      params: { id: String(albumId), community: '1', compare: '1' },
    })

  const openArtist = (name: string) =>
    router.push({ pathname: '/artist/[name]', params: { name: encodeURIComponent(name) } })

  /** Get this album into your library at `status`, returning your copy's id.
   *  Three routes in: you already have it; Pressd has someone else's copy to
   *  clone; or it's new to Pressd entirely and comes from Deezer. */
  async function ensureInLibrary(data: CommunityAlbumData, status: 'to_listen' | 'listening'): Promise<number> {
    if (data.your_album_id != null) return data.your_album_id
    if (data.album_id != null) {
      const copy = await copyAlbumToLibrary(data.album_id, status)
      queryClient.invalidateQueries({ queryKey: ['albums'] })
      return copy.id
    }
    // Reuse the tracklist the page already resolved; only re-fetch if the user
    // hit Rate now before that query settled.
    const full =
      resolvedAlbum ??
      (deezerId != null
        ? await resolveDeezerAlbum(deezerId)
        : byName
          ? await resolveReleaseByName(name!, artist!)
          : null)
    if (!full) throw new Error('Nothing to import')
    const imported = await importAlbum(full, status, user?.id ?? 1)
    queryClient.invalidateQueries({ queryKey: ['albums'] })
    return imported.id
  }

  async function startRating(data: CommunityAlbumData) {
    const target = await ensureInLibrary(data, 'listening')
    router.push({ pathname: '/rate/[id]', params: { id: String(target) } })
  }

  async function queueAlbum(data: CommunityAlbumData) {
    await ensureInLibrary(data, 'to_listen')
    queryClient.invalidateQueries({ queryKey: ['album', albumId, 'community'] })
    queryClient.invalidateQueries({ queryKey: ['community-by-name', name, artist] })
  }

  // Both of you finished this album → the side-by-side comparison view.
  if (owner && myAlbum && album.status === 'rated' && myAlbum.status === 'rated' &&
      album.score != null && myAlbum.score != null) {
    return (
      <FriendCompare
        theirs={album}
        mine={myAlbum}
        owner={owner}
        color={ownerColor}
        onBack={leave}
        onOpenMine={() => router.push({ pathname: '/album/[id]', params: { id: String(myAlbum.id) } })}
        onOpenAverage={() =>
          router.push({ pathname: '/album/[id]', params: { id: String(albumId), community: '1' } })
        }
        onOpenArtist={openArtist}
      />
    )
  }

  const factors: { label: string; value: number | null }[] = isEP
    ? []
    : [
        { label: 'Theme', value: album.theme },
        { label: 'Replay', value: album.replayValue },
        { label: 'Production', value: album.production },
        { label: 'Distinct', value: album.distinctness },
      ]

  return (
    <View style={styles.root}>
      <AlbumBackdrop albumArtUrl={album.albumArtUrl} album={album.albumName} artist={album.artist} />
      <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.topBar}>
        <Pressable onPress={leave} hitSlop={10} style={styles.backBtn}>
          <ArrowLeft size={18} color={colors.inkSecondary} />
          <Text style={styles.backText}>Back</Text>
        </Pressable>
        {/* Whose rating this is — only when viewing a friend's copy. */}
        {owner && (
          <View style={styles.ownerTag}>
            <View style={[styles.ownerPfp, { backgroundColor: ownerColor }]}>
              {owner.avatarUrl ? (
                <Image source={{ uri: owner.avatarUrl }} style={styles.ownerPfpImg} contentFit="cover" />
              ) : (
                <Text style={styles.ownerPfpInitial}>{owner.name[0]?.toUpperCase()}</Text>
              )}
            </View>
            <Text style={[styles.ownerName, { color: ownerColor }]} numberOfLines={1}>
              {owner.name}'s rating
            </Text>
          </View>
        )}
        {/* Every action travels in one right-hand cluster. Left to space-between
            they spread across the whole bar, and Compare drifts into the middle
            where it reads as a title rather than a control. */}
        <View style={styles.topBarRight}>
        {canCompare && (
          <Pressable style={styles.compareBtn} onPress={openCompare} hitSlop={8}>
            <Text style={styles.compareBtnText}>Compare</Text>
          </Pressable>
        )}
        {/* Any finished album can be shared, not just your own — a friend's
            rating is worth passing on too, and the card names whose it is. */}
        {album.status === 'rated' && album.score != null && (
          <Pressable
            style={styles.shareBtn}
            onPress={() => setSharing(true)}
            hitSlop={10}
            accessibilityLabel={`Share ${album.albumName}`}
          >
            <Share2 size={17} color={colors.green} />
          </Pressable>
        )}
        {/* Only a record you've finished, and only your own copy: passing on an
            album you haven't scored is a suggestion with nothing behind it, and
            a friend's copy isn't yours to send. Same condition the desktop
            detail page uses. */}
        {isMine && album.status === 'rated' && (
          <Pressable
            style={styles.recommendBtn}
            onPress={() => setRecommending(true)}
            hitSlop={10}
            accessibilityLabel={`Recommend ${album.albumName} to a friend`}
          >
            <Star size={17} color={RECOMMEND} fill={RECOMMEND} />
          </Pressable>
        )}
        {/* Sits last in the bar, away from Back and Compare — destructive, so
            it shouldn't be adjacent to anything you tap on the way in. */}
        {isMine && (
          <Pressable
            style={styles.deleteBtn}
            onPress={confirmDelete}
            disabled={deleting}
            hitSlop={10}
            accessibilityLabel="Delete album from your library"
          >
            {deleting ? (
              <ActivityIndicator size="small" color={DANGER} />
            ) : (
              <Trash2 size={17} color={DANGER} />
            )}
          </Pressable>
        )}
        </View>
      </View>

      <Animated.ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        onScroll={onScroll}
        scrollEventThrottle={16}
      >
        <View style={styles.head}>
          {/* The glow lives on a wrapper, not on the artwork. iOS derives a
              shadow path from the view's own background and corner radius, and
              an Image has neither until its source loads — so the halo simply
              never drew. The wrapper is opaque and the same shape, and it must
              not clip, or it would cut off the light it is casting. */}
          <View style={wasRecommended ? styles.artGlow : undefined}>
            {album.albumArtUrl ? (
              <Image
                source={{ uri: album.albumArtUrl }}
                style={styles.art}
                contentFit="cover"
              />
            ) : (
              <View style={[styles.art, styles.artFallback]}>
                <Text style={styles.artInitial}>{album.albumName[0]}</Text>
              </View>
            )}
          </View>
          <Text style={styles.albumName} numberOfLines={2}>{album.albumName}</Text>
          <Text style={styles.artist} numberOfLines={1}>
            {[album.artist, ...album.extraArtists].map((n, i) => (
              <Text key={n}>
                {i > 0 ? ', ' : ''}
                <Text style={styles.artistLink} onPress={() => openArtist(n)}>{n}</Text>
              </Text>
            ))}
            {album.year ? ` · ${album.year}` : ''}
          </Text>
          {album.genre && <Text style={styles.genre}>{album.genre}</Text>}
          {(() => {
            const subs = [album.subGenre1, album.subGenre2, album.subGenre3].filter(Boolean)
            return subs.length > 0 ? (
              <Text style={styles.subGenres}>{subs.join(' · ')}</Text>
            ) : null
          })()}
        </View>

        <View style={styles.scoreBlock}>
          {/* A prediction is drawn hollow and a settled score filled, so the two
              are never mistaken for each other.

              This used to be a dial here and a stroked numeral on the userbase
              view, which meant the same album's prediction changed shape
              depending on which copy you opened — the one place the encoding
              most needs to hold still. The stroke wins because it can sit
              beside a real score at the same size and baseline; a ring cannot. */}
          {scoreIsPredicted && showScore != null ? (
            <OutlineScore value={showScore} />
          ) : (
            <Text
              style={[styles.bigScore, { color: showScore != null ? colors.green : colors.inkMuted }]}
              numberOfLines={1}
              adjustsFontSizeToFit
            >
              {showScore != null ? showScore.toFixed(2) : '—'}
            </Text>
          )}
          <Text style={styles.scoreLabel}>
            {isRated ? 'FINAL SCORE' : scoreIsPredicted ? 'PREDICTED' : 'NOT YET RATED'}
          </Text>
        </View>

        {/* Why it's on your shelf, from the person who put it there. Sits above
            the tracklist because it's the reason you're looking at this at all —
            and without somewhere to read it, the note the sender wrote would be
            stored and never seen.

            Presented as a message from them, avatar included, rather than as a
            field on the record: a recommendation is a thing a person did, and
            attributing it to a face is what separates this page from every
            other album page in the app. */}
        {wasRecommended && (
          <View style={styles.recCard}>
            <View style={styles.recHead}>
              <View style={[styles.recPfp, { backgroundColor: avatarColor(album.recommendedByName!) }]}>
                {recSender?.avatarUrl ? (
                  <Image source={{ uri: recSender.avatarUrl }} style={styles.recPfpImg} contentFit="cover" />
                ) : (
                  <Text style={styles.recPfpInitial}>
                    {album.recommendedByName![0]?.toUpperCase()}
                  </Text>
                )}
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.recFrom} numberOfLines={1}>
                  {album.recommendedByName} recommended this
                </Text>
                {recWhen && <Text style={styles.recWhen}>{recWhen}</Text>}
              </View>
              <Star size={15} color={RECOMMEND} fill={RECOMMEND} />
            </View>
            {album.recommendationNote ? (
              <Text style={styles.recNote}>“{album.recommendationNote}”</Text>
            ) : (
              // Without this the card is a header and nothing else, which reads
              // as an empty field rather than as a message with no words in it.
              <Text style={styles.recNoNote}>
                No note — they just thought you should hear it.
              </Text>
            )}
            {!isRated && (
              <Text style={styles.recNudge}>
                Rate it and {album.recommendedByName} will see what you thought.
              </Text>
            )}
          </View>
        )}

        {factors.length > 0 && isRated && (
          <View style={styles.factorRow}>
            {factors.map((f) => (
              <View key={f.label} style={styles.factorCell}>
                <Text style={styles.factorValue}>{f.value != null ? f.value.toFixed(1) : '—'}</Text>
                <Text style={styles.factorLabel}>{f.label}</Text>
              </View>
            ))}
          </View>
        )}

        {/* Only your own copy is yours to score. This page renders a friend's
            rating too, and an ungated CTA offered to "edit" it — the server
            refuses the write, so nothing could be overwritten, but you'd have
            re-rated the whole record before finding that out. */}
        {isMine && (
        <Pressable
          style={({ pressed }) => [styles.cta, pressed && { backgroundColor: colors.greenPressed }]}
          onPress={() => router.push({ pathname: '/rate/[id]', params: { id: String(albumId) } })}
        >
          <Text style={styles.ctaText}>{cta}</Text>
        </Pressable>
        )}

        <AlbumThoughts album={album.albumName} artist={album.artist} />

        <Text style={styles.sectionLabel}>TRACKS</Text>
        {sorted.map((s) => (
          <TrackRow
            key={s.id}
            song={s}
            scrollY={scrollY}
            onMeasure={(y) => rowYs.current.set(s.id, y)}
          />
        ))}

        <ReviewSection album={album} editable={isMine} />

        <CommentThread albumId={albumId} canComment={!isMine} />
      </Animated.ScrollView>
      </SafeAreaView>

      <RecommendSheet
        album={album}
        visible={recommending}
        onClose={() => setRecommending(false)}
      />
    </View>
  )
}

function LoadFailed({ onBack }: { onBack: () => void }) {
  return (
    <SafeAreaView style={[styles.screen, styles.center]}>
      <Text style={styles.failTitle}>This album didn't load</Text>
      <Text style={styles.failBody}>It may have been removed, or it belongs to someone you don't follow.</Text>
      <Pressable style={styles.failBtn} onPress={onBack}>
        <Text style={styles.failBtnText}>Go back</Text>
      </Pressable>
    </SafeAreaView>
  )
}

/**
 * The userbase's view of an album: averaged score, factors and track scores in
 * the standard layout. When you've rated it too, a Compare control swaps in a
 * you-versus-everyone breakdown built from the same styles as the friend view.
 */
function CommunityAlbum({
  data,
  onBack,
  onOpenArtist,
  onRate,
  onQueue,
  initialComparing = false,
  onOpenYours,
  onDeleted,
}: {
  data: CommunityAlbumData
  onBack: () => void
  onOpenArtist: (name: string) => void
  onRate: () => void
  onQueue: () => Promise<void>
  initialComparing?: boolean
  onOpenYours?: () => void
  /** Where to go once the copy is gone — this page is showing the thing that
   *  just stopped existing. */
  onDeleted?: () => void
}) {
  const queryClient = useQueryClient()
  const [comparing, setComparing] = useState(initialComparing)
  const [rating, setRating] = useState(false)
  const [queuing, setQueuing] = useState(false)
  const [queued, setQueued] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const notRated = data.your_status !== 'rated'
  const inLibrary = data.your_album_id != null
  // Someone other than you has to have rated it. Without that check the button
  // appeared on a record only you had scored, and opened a side-by-side of your
  // score against a "Pressd average" that was your score.
  const noOneElse = data.others_rater_count === 0
  const canCompare = data.you?.score != null && data.avg_score != null && !noOneElse
  const subs = [data.sub_genre1, data.sub_genre2, data.sub_genre3].filter(Boolean) as string[]
  const raters = `${data.rater_count} ${data.rater_count === 1 ? 'rater' : 'raters'}`

  const factors: { label: string; value: number | null }[] = [
    { label: 'Theme', value: data.avg_theme },
    { label: 'Replay', value: data.avg_replay_value },
    { label: 'Production', value: data.avg_production },
    { label: 'Distinct', value: data.avg_distinctness },
  ]

  const header = (
    <View style={styles.topBar}>
      <Pressable onPress={onBack} hitSlop={10} style={styles.backBtn}>
        <ArrowLeft size={18} color={colors.inkSecondary} />
        <Text style={styles.backText}>Back</Text>
      </Pressable>
      <View style={styles.topBarRight}>
        {/* Your own rating was only reachable through the comparison's fork —
            two taps and a detour through a screen you didn't ask for. It sits
            beside Compare now, since wanting your copy and wanting the
            side-by-side are different intentions. */}
        {canCompare && !comparing && onOpenYours ? (
          <Pressable style={styles.compareBtn} onPress={onOpenYours} hitSlop={8}>
            <Text style={styles.compareBtnText}>My Rating</Text>
          </Pressable>
        ) : null}
        {canCompare && !comparing ? (
          <Pressable style={styles.compareBtn} onPress={() => setComparing(true)} hitSlop={8}>
            <Text style={styles.compareBtnText}>Compare</Text>
          </Pressable>
        ) : null}
        {/* The comparison's two exits, in the bar rather than halfway down the
            page. Every other screen keeps its controls in this corner, and a
            fork buried under the verdict meant scrolling to leave a view you
            could enter from up here. */}
        {comparing && onOpenYours ? (
          <Pressable style={[styles.compareBtn, styles.compareBtnFlex]} onPress={onOpenYours} hitSlop={8}>
            <Text style={styles.compareBtnText} numberOfLines={1}>Your Rating</Text>
          </Pressable>
        ) : null}
        {comparing ? (
          <Pressable style={[styles.compareBtn, styles.compareBtnFlex]} onPress={() => setComparing(false)} hitSlop={8}>
            <Text style={styles.compareBtnText} numberOfLines={1}>Average Rating</Text>
          </Pressable>
        ) : null}
        {/* Removing an unrated copy lives here rather than on the library tile:
            a 12px target in a grid is a bad place for something with no undo,
            and by this point you're looking at the record you'd be deleting.
            Sits last in the bar, away from Back, like the rated page's. */}
        {inLibrary && notRated && (
          <Pressable
            style={styles.deleteBtn}
            onPress={() => {
              if (deleting) return
              confirmDeleteAlbum(
                { albumId: data.your_album_id!, albumName: data.album_name, onDeleted },
                queryClient,
                setDeleting,
              )
            }}
            disabled={deleting}
            hitSlop={10}
            accessibilityLabel={`Remove ${data.album_name} from your library`}
          >
            {deleting ? (
              <ActivityIndicator size="small" color={DANGER} />
            ) : (
              <Trash2 size={17} color={DANGER} />
            )}
          </Pressable>
        )}
      </View>
    </View>
  )

  if (comparing && data.you && !noOneElse) {
    const you = data.you
    const pos = (v: number) => ((Math.max(5, Math.min(10, v)) - 5) / 5) * 100
    // Everyone but you. `avg_score` pools your own copy in, so a panel headed
    // "PRESSD USERS | YOU" was counting the reader on both sides — on a record
    // with one other rater that halves the gap exactly.
    const avgScore = data.others_avg_score ?? data.avg_score!
    const cmpRaters = data.others_rater_count || data.rater_count
    const yourScore = you.score!
    const diff = yourScore - avgScore
    const youLeft = yourScore <= avgScore

    const otherScore = (t: CommunityTrack) => t.others_avg_score ?? t.avg_score
    const rated = data.tracks.filter((t) => otherScore(t) != null && t.your_score != null)
    let widest: { title: string; gap: number } | null = null
    for (const t of rated) {
      const gap = Math.abs(t.your_score! - otherScore(t)!)
      if (!widest || gap > widest.gap) widest = { title: t.title, gap }
    }

    const left = youLeft
      ? { label: 'YOU', score: yourScore, color: colors.inkSecondary, head: colors.inkMuted }
      : { label: "PRESSD USERS", score: avgScore, color: colors.green, head: colors.green }
    const right = youLeft
      ? { label: "PRESSD USERS", score: avgScore, color: colors.green, head: colors.green }
      : { label: 'YOU', score: yourScore, color: colors.inkSecondary, head: colors.inkMuted }

    return (
      <View style={styles.root}>
        <AlbumBackdrop albumArtUrl={data.album_art_url} album={data.album_name} artist={data.artist} subtle />
        <SafeAreaView style={styles.screen} edges={['top']}>
          {header}
          <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
            <View style={styles.cmpHead}>
              <View style={[styles.cmpAccent, { backgroundColor: colors.green }]} />
              {data.album_art_url ? (
                <Image source={{ uri: data.album_art_url }} style={styles.cmpArt} contentFit="cover" />
              ) : (
                <View style={[styles.cmpArt, styles.artFallback]}>
                  <Text style={styles.artInitial}>{data.album_name[0]}</Text>
                </View>
              )}
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.cmpAlbumName} numberOfLines={2}>{data.album_name}</Text>
                <Text style={styles.cmpArtist} numberOfLines={1}>
                  <Text style={styles.artistLink} onPress={() => onOpenArtist(data.artist)}>{data.artist}</Text>
                  {data.year ? ` · ${data.year}` : ''}
                </Text>
                {data.genre && <Text style={styles.cmpGenre}>{data.genre}</Text>}
                {subs.length > 0 && <Text style={styles.cmpSubGenres}>{subs.join(' · ')}</Text>}
              </View>
            </View>

            <View
              style={[
                styles.cmpCard,
                {
                  backgroundColor: `rgba(45,106,79,${CMP_CARD_TINT})`,
                  borderColor: `rgba(45,106,79,${CMP_CARD_BORDER})`,
                },
              ]}
            >
              <View style={styles.cmpScores}>
                <View style={styles.cmpScoreCol}>
                  <Text style={[styles.cmpWho, { color: left.head }]} numberOfLines={1}>{left.label}</Text>
                  <Text style={[styles.cmpScore, { color: left.color }]} numberOfLines={1} maxFontSizeMultiplier={1.2}>{left.score.toFixed(2)}</Text>
                </View>
                <View style={[styles.cmpDivider, { backgroundColor: 'rgba(45,106,79,0.25)' }]} />
                <View style={styles.cmpScoreCol}>
                  <Text style={[styles.cmpWho, { color: right.head }]} numberOfLines={1}>{right.label}</Text>
                  <Text style={[styles.cmpScore, { color: right.color }]} numberOfLines={1} maxFontSizeMultiplier={1.2}>{right.score.toFixed(2)}</Text>
                </View>
              </View>

              <View style={styles.railWrap}>
                <View style={styles.rail} />
                <View style={[styles.railFill, { width: `${Math.max(pos(avgScore), pos(yourScore))}%`, backgroundColor: 'rgba(45,106,79,0.45)' }]} />
                <View style={[styles.railTick, { left: `${pos(avgScore)}%`, backgroundColor: colors.green }]} />
                <View style={[styles.railTick, { left: `${pos(yourScore)}%`, backgroundColor: colors.ink }]} />
              </View>
              <View style={styles.railAxis}>
                {[5, 6, 7, 8, 9, 10].map((n) => (
                  <Text key={n} style={styles.railAxisLabel}>{n}</Text>
                ))}
              </View>

              <CompareVerdict
                even="You landed exactly on the Pressd average."
                diff={diff}
                before="You rated this "
                after={` ${diff > 0 ? 'above' : 'below'} the Pressd average`}
                widest={widest}
              />
              <Text style={styles.cmpRaters}>
                Averaged across {cmpRaters} other {cmpRaters === 1 ? 'rater' : 'raters'}
              </Text>
            </View>

            <View style={styles.cmpTracksHead}>
              <Text style={styles.cmpTracksLabel}>TRACKS</Text>
              <Text style={styles.cmpColHead} numberOfLines={1}>
                <Text style={{ color: left.head }}>{left.label}</Text>
                <Text style={styles.cmpColSlash}> / </Text>
                <Text style={{ color: right.head }}>{right.label}</Text>
              </Text>
            </View>
            {data.tracks.map((t, i) => {
              const leftVal = youLeft ? t.your_score : otherScore(t)
              const rightVal = youLeft ? otherScore(t) : t.your_score
              return (
                <View key={`${t.title}-${i}`} style={[styles.cmpTrackRow, i > 0 && styles.cmpTrackDivider]}>
                  <Text style={styles.cmpTrackNum}>{t.track_number}</Text>
                  <Text style={styles.cmpTrackTitle} numberOfLines={1}>{t.title}</Text>
                  <Text style={[styles.cmpTrackScore, { color: left.head }]}>
                    {leftVal != null ? leftVal.toFixed(1) : '—'}
                  </Text>
                  <Text style={[styles.cmpTrackScore, { color: right.head }]}>
                    {rightVal != null ? rightVal.toFixed(1) : '—'}
                  </Text>
                </View>
              )
            })}
          </ScrollView>
        </SafeAreaView>
      </View>
    )
  }

  // Classic layout, showing what everyone averaged.
  return (
    <View style={styles.root}>
      <AlbumBackdrop albumArtUrl={data.album_art_url} album={data.album_name} artist={data.artist} />
      <SafeAreaView style={styles.screen} edges={['top']}>
        {header}
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <View style={styles.head}>
            {data.album_art_url ? (
              <Image source={{ uri: data.album_art_url }} style={styles.art} contentFit="cover" />
            ) : (
              <View style={[styles.art, styles.artFallback]}>
                <Text style={styles.artInitial}>{data.album_name[0]}</Text>
              </View>
            )}
            <Text style={styles.albumName} numberOfLines={2}>{data.album_name}</Text>
            <Text style={styles.artist} numberOfLines={1}>
              <Text style={styles.artistLink} onPress={() => onOpenArtist(data.artist)}>{data.artist}</Text>
              {data.year ? ` · ${data.year}` : ''}
            </Text>
            {data.genre && <Text style={styles.genre}>{data.genre}</Text>}
            {subs.length > 0 && <Text style={styles.subGenres}>{subs.join(' · ')}</Text>}
          </View>

          {/* Pressd average and — when the model has a read on it and you
              haven't rated it — your predicted score, side by side. Paired in
              one row so the dial doesn't interrupt the vertical flow. */}
          {/* What the userbase thinks against what we think you'll think —
              two readings of one album, so they share a card, a baseline and a
              type size, split by a rule rather than set as headline + footnote. */}
          <View style={styles.scoreCard}>
            <View style={styles.scoreCol}>
              {/* Sized to the column at build time; these two also guard against
                  a large system text setting, which no width maths can predict. */}
              <Text
                style={[styles.bigScore, { color: data.avg_score != null ? colors.green : colors.inkMuted }]}
                numberOfLines={1}
                adjustsFontSizeToFit
              >
                {data.avg_score != null ? data.avg_score.toFixed(2) : '—'}
              </Text>
              <Text style={styles.scoreLabel}>PRESSD AVG</Text>
              <Text style={styles.raterLine}>{raters}</Text>
            </View>
            {notRated && data.predicted_score != null && (
              <>
                <View style={styles.scoreDivider} />
                <View style={styles.scoreCol}>
                  <OutlineScore value={data.predicted_score} />
                  <View style={styles.forYouRow}>
                    <Star size={11} color={colors.green} fill={colors.green} strokeWidth={0} />
                    <Text style={styles.scoreLabel}>FOR YOU</Text>
                  </View>
                  <Text style={styles.raterLine}>predicted</Text>
                </View>
              </>
            )}
          </View>

          {/* You've scored it and nobody else has, so there is no comparison to
              draw — say why, and point at the thing that would create one. */}
          {data.you?.score != null && noOneElse && (
            <View style={{ marginTop: spacing.lg }}>
              <NoComparisonYet
                title={`No one else has rated ${data.album_name} :(. Recommend it to a friend!`}
              />
            </View>
          )}

          {/* Same card the personal view carries. It reads off your own copy,
              so it says why this record is on your shelf — which is worth
              knowing here too, where the decision to rate it gets made. */}
          {data.recommended_by_name && (
            <View style={styles.recCard}>
              <View style={styles.recHead}>
                <Star size={13} color={RECOMMEND} fill={RECOMMEND} />
                <Text style={styles.recFrom}>Recommended by {data.recommended_by_name}</Text>
              </View>
              {data.recommendation_note ? (
                <Text style={styles.recNote}>“{data.recommendation_note}”</Text>
              ) : null}
            </View>
          )}

          {factors.some((f) => f.value != null) && (
            <View style={styles.factorRow}>
              {factors.map((f) => (
                <View key={f.label} style={styles.factorCell}>
                  <Text style={styles.factorValue}>{f.value != null ? f.value.toFixed(1) : '—'}</Text>
                  <Text style={styles.factorLabel}>{f.label}</Text>
                </View>
              ))}
            </View>
          )}

          {/* The two ways in sit side by side rather than stacked — they're
              alternatives, not a primary with an afterthought under it. Each
              takes an equal share of the row, and a lone one spans the width on
              its own. Queueing only means anything for albums you don't hold. */}
          {(notRated || !inLibrary) && (
            <View style={styles.ctaRow}>
              {notRated && (
                <Pressable
                  style={({ pressed }) => [styles.cta, styles.ctaInRow, pressed && { backgroundColor: colors.greenPressed }]}
                  onPress={async () => {
                    if (rating) return
                    setRating(true)
                    try {
                      await onRate()
                    } finally {
                      setRating(false)
                    }
                  }}
                  disabled={rating}
                >
                  {rating ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <Text style={styles.ctaText} numberOfLines={1}>
                      {data.your_status === 'listening' ? 'Continue' : 'Rate now'}
                    </Text>
                  )}
                </Pressable>
              )}

              {!inLibrary && (
                <Pressable
                  style={({ pressed }) => [
                    styles.cta,
                    styles.ctaInRow,
                    queued && styles.ctaDone,
                    pressed && !queued && { backgroundColor: colors.greenPressed },
                  ]}
                  onPress={async () => {
                    if (queuing || queued) return
                    setQueuing(true)
                    try {
                      await onQueue()
                      setQueued(true)
                    } finally {
                      setQueuing(false)
                    }
                  }}
                  disabled={queuing || queued}
                >
                  {queuing ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <Text style={styles.ctaText} numberOfLines={1}>
                      {queued ? 'Added' : 'Add to Library'}
                    </Text>
                  )}
                </Pressable>
              )}
            </View>
          )}

          <Text style={styles.sectionLabel}>TRACKS</Text>
          {data.tracks.map((t, i) => (
            <View key={`${t.title}-${i}`} style={styles.trackRow}>
              <Text style={styles.trackNum}>{t.track_number}</Text>
              <Text style={styles.trackTitle} numberOfLines={1}>{t.title}</Text>
              <BangSkip score={t.avg_score} />
              {t.avg_score != null ? (
                <Text style={[styles.trackScore, { color: songScoreColor(t.avg_score) }]}>
                  {t.avg_score.toFixed(1)}
                </Text>
              ) : (
                <Text style={styles.trackScoreEmpty}>—</Text>
              )}
            </View>
          ))}
        </ScrollView>
      </SafeAreaView>
    </View>
  )
}

/**
 * One track, revealed as it scrolls into view. Rows render visible until they
 * report their offset, so nothing flashes on mount — by the time a row knows
 * it sits below the fold, it's already off screen and can fade in cleanly.
 */
function TrackRow({
  song,
  scrollY,
  onMeasure,
}: {
  song: Song
  scrollY: Animated.Value
  onMeasure: (y: number) => void
}) {
  const [y, setY] = useState<number | null>(null)
  const start = (y ?? 0) - WINDOW_H + 90
  const progress = scrollY.interpolate({
    inputRange: [start, start + 130],
    outputRange: [0, 1],
    extrapolate: 'clamp',
  })
  const translateY = progress.interpolate({ inputRange: [0, 1], outputRange: [14, 0] })

  return (
    <Animated.View
      onLayout={(e) => {
        const next = e.nativeEvent.layout.y
        setY(next)
        onMeasure(next)
      }}
      style={[
        styles.trackRow,
        y == null ? null : { opacity: progress, transform: [{ translateY }] },
      ]}
    >
      <Text style={styles.trackNum}>{song.trackNumber}</Text>
      <Text style={styles.trackTitle} numberOfLines={1}>{song.title}</Text>
      <BangSkip score={song.score} />
      {song.score != null ? (
        <Text style={[styles.trackScore, { color: songScoreColor(song.score) }]}>
          {song.score.toFixed(1)}
        </Text>
      ) : (
        <Text style={styles.trackScoreEmpty}>—</Text>
      )}
    </Animated.View>
  )
}

/** hsl(...) → hsla(..., a), so a friend's avatar color can tint a surface. */
function tint(hsl: string, alpha: number): string {
  return hsl.replace('hsl(', 'hsla(').replace(')', `, ${alpha})`)
}

// Matching your copy's tracks to theirs: same rules the server uses, so the
// two views agree about what counts as one track.
const normTitle = normalizeTrackTitle

/** Clip a display name so long usernames can't blow out a column header. */
const shortName = (name: string, max: number) =>
  name.length > max ? `${name.slice(0, max - 1).trimEnd()}…` : name

/**
 * Side-by-side view shown when you and a friend have both finished rating the
 * same album: their score against yours, their review, and every track scored
 * by each of you.
 */
function FriendCompare({
  theirs,
  mine,
  owner,
  color,
  onBack,
  onOpenMine,
  onOpenAverage,
  onOpenArtist,
}: {
  theirs: Album
  mine: Album
  owner: { id: number; name: string; avatarUrl?: string }
  color: string
  onBack: () => void
  onOpenMine: () => void
  onOpenAverage: () => void
  onOpenArtist: (name: string) => void
}) {
  const { user } = useAuth()
  const [liked, setLiked] = useState(false)

  const theirScore = theirs.score!
  const myScore = mine.score!
  const diff = theirScore - myScore

  // Pair tracks on normalized title so re-imports with punctuation differences
  // still line up; fall back to no comparison for anything unmatched.
  const mineByTitle = new Map(mine.songs.map((s) => [normTitle(s.title), s.score]))
  const tracks = [...theirs.songs]
    .sort((a, b) => (a.trackNumber ?? 0) - (b.trackNumber ?? 0))
    .map((song: Song) => ({ song, myScore: mineByTitle.get(normTitle(song.title)) ?? null }))

  let widest: { title: string; gap: number } | null = null
  for (const t of tracks) {
    if (t.song.score == null || t.myScore == null) continue
    const gap = Math.abs(t.song.score - t.myScore)
    if (!widest || gap > widest.gap) widest = { title: t.song.title, gap }
  }

  // Both scores on one 5–10 rail, matching the Compare tab's scale.
  const pos = (v: number) => ((Math.max(5, Math.min(10, v)) - 5) / 5) * 100

  // Lower score sits on the left so the pair reads ascending; the track columns
  // follow the same order so nothing swaps places mid-page.
  const youLeft = myScore <= theirScore
  const left = youLeft
    ? { label: 'YOU', score: myScore, color: colors.inkSecondary, head: colors.inkMuted }
    : { label: shortName(owner.name, 10).toUpperCase(), score: theirScore, color, head: color }
  const right = youLeft
    ? { label: owner.name.toUpperCase(), score: theirScore, color, head: color }
    : { label: 'YOU', score: myScore, color: colors.inkSecondary, head: colors.inkMuted }


  async function like() {
    if (!user) return
    setLiked((v) => !v)
    try {
      await toggleLike(user.id, theirs.id)
    } catch {
      setLiked((v) => !v)
    }
  }

  return (
    <View style={styles.root}>
      <AlbumBackdrop albumArtUrl={theirs.albumArtUrl} album={theirs.albumName} artist={theirs.artist} subtle />
      <SafeAreaView style={styles.screen} edges={['top']}>
        <View style={styles.topBar}>
          <Pressable onPress={onBack} hitSlop={10} style={styles.backBtn}>
            <ArrowLeft size={18} color={colors.inkSecondary} />
            <Text style={styles.backText}>Back</Text>
          </Pressable>
          <View style={[styles.ownerTag, { backgroundColor: tint(color, 0.1), paddingHorizontal: 10, paddingVertical: 5, borderRadius: radii.pill }]}>
            <View style={[styles.ownerPfp, { backgroundColor: color }]}>
              {owner.avatarUrl ? (
                <Image source={{ uri: owner.avatarUrl }} style={styles.ownerPfpImg} contentFit="cover" />
              ) : (
                <Text style={styles.ownerPfpInitial}>{owner.name[0]?.toUpperCase()}</Text>
              )}
            </View>
            <Text style={[styles.ownerName, { color }]} numberOfLines={1}>{owner.name}'s rating</Text>
          </View>
        </View>

        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          {/* Album identity: cover left, details right, accent rule in their color */}
          <View style={styles.cmpHead}>
            <View style={[styles.cmpAccent, { backgroundColor: color }]} />
            {theirs.albumArtUrl ? (
              <Image source={{ uri: theirs.albumArtUrl }} style={styles.cmpArt} contentFit="cover" />
            ) : (
              <View style={[styles.cmpArt, styles.artFallback]}>
                <Text style={styles.artInitial}>{theirs.albumName[0]}</Text>
              </View>
            )}
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={styles.cmpAlbumName} numberOfLines={2}>{theirs.albumName}</Text>
              <Text style={styles.cmpArtist} numberOfLines={1}>
                <Text style={styles.artistLink} onPress={() => onOpenArtist(theirs.artist)}>{theirs.artist}</Text>
                {theirs.year ? ` · ${theirs.year}` : ''}
              </Text>
              {theirs.genre && <Text style={styles.cmpGenre}>{theirs.genre}</Text>}
              {(() => {
                const subs = [theirs.subGenre1, theirs.subGenre2, theirs.subGenre3].filter(Boolean)
                return subs.length > 0 ? (
                  <Text style={styles.cmpSubGenres}>{subs.join(' · ')}</Text>
                ) : null
              })()}
            </View>
          </View>

          {/* Score comparison */}
          <View style={[styles.cmpCard, { backgroundColor: tint(color, CMP_CARD_TINT), borderColor: tint(color, CMP_CARD_BORDER) }]}>
            <View style={styles.cmpScores}>
              <View style={styles.cmpScoreCol}>
                <Text style={[styles.cmpWho, { color: left.head }]} numberOfLines={1}>{left.label}</Text>
                <Text style={[styles.cmpScore, { color: left.color }]} numberOfLines={1} maxFontSizeMultiplier={1.2}>{left.score.toFixed(2)}</Text>
              </View>
              <View style={[styles.cmpDivider, { backgroundColor: tint(color, 0.25) }]} />
              <View style={styles.cmpScoreCol}>
                <Text style={[styles.cmpWho, { color: right.head }]} numberOfLines={1}>{right.label}</Text>
                <Text style={[styles.cmpScore, { color: right.color }]} numberOfLines={1} maxFontSizeMultiplier={1.2}>{right.score.toFixed(2)}</Text>
              </View>
            </View>

            <View style={styles.railWrap}>
              <View style={styles.rail} />
              <View style={[styles.railFill, { width: `${Math.max(pos(theirScore), pos(myScore))}%`, backgroundColor: tint(color, 0.45) }]} />
              <View style={[styles.railTick, { left: `${pos(theirScore)}%`, backgroundColor: color }]} />
              <View style={[styles.railTick, { left: `${pos(myScore)}%`, backgroundColor: colors.ink }]} />
            </View>
            <View style={styles.railAxis}>
              {[5, 6, 7, 8, 9, 10].map((n) => (
                <Text key={n} style={styles.railAxisLabel}>{n}</Text>
              ))}
            </View>

            <CompareVerdict
              even={`You and ${owner.name} landed on exactly the same score.`}
              diff={diff}
              before={`${owner.name} rated this `}
              after={` ${diff > 0 ? 'higher' : 'lower'} than you`}
              widest={widest}
            />
          </View>

          {/* Their review */}
          {theirs.review ? (
            <View style={styles.cmpReview}>
              <Text style={[styles.cmpSection, { color }]} numberOfLines={1}>
                {shortName(owner.name, 16).toUpperCase()}'S REVIEW
              </Text>
              <Text style={styles.cmpQuote}>“{theirs.review}”</Text>
              <Pressable style={styles.cmpLike} onPress={like} hitSlop={8}>
                <Heart size={16} color={liked ? '#c0392b' : colors.inkTertiary} fill={liked ? '#c0392b' : 'transparent'} />
                <Text style={styles.cmpLikeText}>{liked ? 'Liked' : 'Like'}</Text>
              </Pressable>
            </View>
          ) : null}

          {/* Track-by-track */}
          <View style={styles.cmpTracksHead}>
            <Text style={styles.cmpTracksLabel}>TRACKS</Text>
            <Text style={styles.cmpColHead} numberOfLines={1}>
              <Text style={{ color: left.head }}>{left.label}</Text>
              <Text style={styles.cmpColSlash}> / </Text>
              <Text style={{ color: right.head }}>{right.label}</Text>
            </Text>
          </View>
          {tracks.map(({ song, myScore: ms }, i) => (
            <View key={song.id} style={[styles.cmpTrackRow, i > 0 && styles.cmpTrackDivider]}>
              <Text style={styles.cmpTrackNum}>{song.trackNumber}</Text>
              <Text style={styles.cmpTrackTitle} numberOfLines={1}>{song.title}</Text>
              <Text style={[styles.cmpTrackScore, { color: left.head }]}>
                {(youLeft ? ms : song.score) != null ? (youLeft ? ms! : song.score!).toFixed(1) : '—'}
              </Text>
              <Text style={[styles.cmpTrackScore, { color: right.head }]}>
                {(youLeft ? song.score : ms) != null ? (youLeft ? song.score! : ms!).toFixed(1) : '—'}
              </Text>
            </View>
          ))}

          {/* Same fork the userbase comparison offers, so both compare screens
              lead the same two places. */}
          <View style={styles.cmpFork}>
            <ForkBtn label="Your rating" onPress={onOpenMine} />
            <ForkBtn label="Average rating" onPress={onOpenAverage} />
          </View>

          <CommentThread albumId={theirs.id} />
        </ScrollView>
      </SafeAreaView>
    </View>
  )
}

/** One exit off a comparison — half of the pair both compare screens end on. */
function ForkBtn({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable style={styles.cmpForkBtn} onPress={onPress} hitSlop={6}>
      <Text style={styles.cmpForkText} numberOfLines={1}>{label}</Text>
      <ChevronRight size={15} color={colors.green} />
    </Pressable>
  )
}

function ReviewSection({ album, editable }: { album: Album; editable: boolean }) {
  // Whether this record already has a discussion. Same query key as
  // AlbumThoughts, so the two share one cached answer rather than two requests.
  const { data: thread } = useQuery({
    queryKey: threadKey('album', album.artist, album.albumName),
    queryFn: () => resolveThread({ subjectType: 'album', artist: album.artist, album: album.albumName }),
    retry: false,
  })
  // Once people are talking, writing is joining them rather than filing a
  // review into an empty page — the review is mirrored into the thread either
  // way, so the label is the only thing that should change.
  const reviews = thread?.reviewCount ?? 0
  const others = thread?.raterCount ?? 0
  const started = reviews > 0

  const queryClient = useQueryClient()
  // A Modal renders in its own native hierarchy, outside the SafeAreaProvider,
  // so SafeAreaView is inert in there — the bar drew straight under the status
  // bar. Read the insets from the app's tree and apply them by hand.
  const insets = useSafeAreaInsets()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(album.review ?? '')
  const [busy, setBusy] = useState(false)

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ['album', album.id] })
    queryClient.invalidateQueries({ queryKey: ['feed'] })
    queryClient.invalidateQueries({ queryKey: ['reviews'] })
  }

  async function save() {
    setBusy(true)
    try {
      await saveReview(album.id, draft.trim())
      setEditing(false)
      invalidate()
    } finally {
      setBusy(false)
    }
  }
  async function remove() {
    setBusy(true)
    try {
      await deleteReview(album.id)
      setDraft('')
      setEditing(false)
      invalidate()
    } finally {
      setBusy(false)
    }
  }

  // Not mine and no review → nothing to show.
  if (!editable && !album.review) return null

  function cancel() {
    setDraft(album.review ?? '')
    setEditing(false)
  }

  return (
    <View>
      <Text style={styles.sectionLabel}>{started ? 'YOUR THOUGHTS' : 'REVIEW'}</Text>
      {album.review ? (
        <View>
          <Text style={styles.reviewBody}>{album.review}</Text>
          {editable && (
            <Pressable style={styles.reviewEdit} onPress={() => { setDraft(album.review ?? ''); setEditing(true) }}>
              <Pencil size={13} color={colors.inkTertiary} />
              <Text style={styles.reviewEditText}>Edit review</Text>
            </Pressable>
          )}
        </View>
      ) : editable ? (
        <Pressable style={styles.reviewWrite} onPress={() => setEditing(true)}>
          <Pencil size={14} color={colors.green} />
          <Text style={styles.reviewWriteText}>
            {started ? 'Give your thoughts' : 'Write a review'}
          </Text>
        </Pressable>
      ) : null}
      {/* Only worth saying when there is company to name. */}
      {editable && !album.review && started && others > 0 && (
        <Text style={styles.reviewWriteSub}>
          Review alongside {others}{' '}
          {others === 1 ? 'presser who\u2019s' : 'pressers who\u2019ve'} rated this record
        </Text>
      )}

      {/* Writing happens on its own surface, over the album page. Inline, the
          box sat near the bottom of a long scroll and the keyboard covered the
          thing you were typing into. Here the field takes every point between
          the bar and the keyboard, so what you write is always in view. */}
      <Modal visible={editing} animationType="slide" onRequestClose={cancel}>
        <View style={[styles.reviewSheet, { paddingTop: insets.top }]}>
          <View style={styles.reviewSheetBar}>
            <Pressable onPress={cancel} hitSlop={10} disabled={busy}>
              <Text style={styles.reviewCancelText}>Cancel</Text>
            </Pressable>
            <Text style={styles.reviewSheetTitle} numberOfLines={1}>{album.albumName}</Text>
            <Pressable onPress={save} disabled={busy} hitSlop={10}>
              {busy ? (
                <ActivityIndicator size="small" color={colors.green} />
              ) : (
                <Text style={styles.reviewSheetSave}>Save</Text>
              )}
            </Pressable>
          </View>

          <KeyboardAvoidingView
            style={[styles.reviewSheetBody, { paddingBottom: Math.max(insets.bottom, spacing.md) }]}
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          >
            <TextInput
              style={styles.reviewSheetInput}
              value={draft}
              onChangeText={setDraft}
              placeholder="Write your thoughts on this album…"
              placeholderTextColor={colors.inkMuted}
              multiline
              autoFocus
              textAlignVertical="top"
            />
            {album.review && (
              <Pressable style={styles.reviewSheetDelete} onPress={remove} disabled={busy} hitSlop={8}>
                <Trash2 size={15} color="#b91c1c" />
                <Text style={styles.reviewSheetDeleteText}>Delete review</Text>
              </Pressable>
            )}
          </KeyboardAvoidingView>
        </View>
      </Modal>
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  screen: { flex: 1, backgroundColor: 'transparent' },
  center: { alignItems: 'center', justifyContent: 'center' },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  // Compare and the delete control travel together at the right, so the bar
  // still reads as one edge no matter which of them is showing.
  topBarRight: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexShrink: 1, minWidth: 0 },
  backBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, flexShrink: 0 },
  // Two word-labels ride this bar in the comparison; at a large text size they
  // give way rather than pushing Back off the screen.
  compareBtnFlex: { flexShrink: 1, minWidth: 0 },
  backText: { fontFamily: fonts.bodyMedium, fontSize: 15, color: colors.inkSecondary },
  ownerTag: { flexDirection: 'row', alignItems: 'center', gap: 7, flexShrink: 1 },
  ownerPfp: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  ownerPfpImg: { width: '100%', height: '100%' },
  ownerPfpInitial: { fontFamily: fonts.bodyBold, fontSize: 11, color: '#ffffff' },
  ownerName: { fontFamily: fonts.bodySemiBold, fontSize: 14, flexShrink: 1 },
  content: { paddingHorizontal: spacing.lg, paddingBottom: 60 },

  // ── Friend comparison view ──
  cmpHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginTop: spacing.lg },
  cmpAccent: { width: 3, alignSelf: 'stretch', borderRadius: 2, marginVertical: 6 },
  cmpArt: { width: 92, height: 92, borderRadius: radii.lg },
  cmpAlbumName: { fontFamily: fonts.display, fontSize: 26, color: colors.ink },
  cmpArtist: { fontFamily: fonts.bodyMedium, fontSize: 14, color: colors.inkSecondary, marginTop: 3 },
  cmpGenre: {
    fontFamily: fonts.bodyBold,
    fontSize: 11,
    letterSpacing: 1.2,
    color: colors.green,
    marginTop: 6,
    textTransform: 'uppercase',
  },
  // Same treatment as the album detail page, left-aligned for this header.
  cmpSubGenres: { fontFamily: fonts.bodyMedium, fontSize: 12, color: colors.inkTertiary, marginTop: 4 },

  cmpCard: {
    borderRadius: radii.lg,
    borderWidth: 1,
    padding: spacing.lg,
    marginTop: spacing.xl,
  },
  cmpScores: { flexDirection: 'row', alignItems: 'center' },
  cmpScoreCol: { flex: 1 },
  cmpDivider: { width: 1, alignSelf: 'stretch', marginHorizontal: spacing.md },
  cmpWho: { fontFamily: fonts.bodyBold, fontSize: 11, letterSpacing: 1.4 },
  cmpScore: { fontFamily: fonts.display, fontSize: 42, lineHeight: 48 },

  railWrap: { height: 14, justifyContent: 'center', marginTop: spacing.md },
  rail: { position: 'absolute', left: 0, right: 0, height: 5, borderRadius: 3, backgroundColor: colors.inset },
  railFill: { position: 'absolute', left: 0, height: 5, borderRadius: 3 },
  railTick: { position: 'absolute', width: 3, height: 14, borderRadius: 1.5, marginLeft: -1.5 },
  // Scale labels sit under the rail; first/last hug the ends so the 5–10 span
  // the ticks are positioned against is legible.
  railAxis: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 5 },
  railAxisLabel: { fontFamily: fonts.body, fontSize: 10, color: colors.inkMuted },
  cmpVerdict: { fontFamily: fonts.body, fontSize: 13, lineHeight: 19, color: colors.inkSecondary, marginTop: spacing.md },
  // Only the number is coloured — the sentence around it stays neutral so the
  // gradient reads as data rather than decoration.
  cmpDiff: { fontFamily: fonts.bodyBold, fontSize: 14 },
  cmpWidest: { fontFamily: fonts.body, fontSize: 13, lineHeight: 19, color: colors.inkSecondary, marginTop: 2 },

  cmpReview: { marginTop: spacing.xl },
  cmpSection: { fontFamily: fonts.bodyBold, fontSize: 11, letterSpacing: 1.2 },
  cmpQuote: { fontFamily: fonts.displayRegular, fontSize: 16, lineHeight: 25, color: colors.ink, marginTop: spacing.sm },
  cmpLike: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: spacing.md },
  cmpLikeText: { fontFamily: fonts.bodyMedium, fontSize: 13, color: colors.inkTertiary },

  cmpTracksHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.xl,
    marginBottom: 2,
  },
  // Own label style (not the shared sectionLabel) so the header row isn't
  // double-margined and the column head can sit tight above the first track.
  cmpTracksLabel: { fontFamily: fonts.bodyBold, fontSize: 11, letterSpacing: 1.2, color: colors.inkTertiary },
  cmpColHead: { fontFamily: fonts.bodyBold, fontSize: 10, letterSpacing: 1 },
  cmpColSlash: { color: colors.inkTertiary },
  cmpTrackRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
  },
  // Separators sit between tracks only — none against the header, none trailing.
  cmpTrackDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  cmpTrackNum: { fontFamily: fonts.body, fontSize: 12, color: colors.inkTertiary, width: 18 },
  cmpTrackTitle: { flex: 1, fontFamily: fonts.bodyMedium, fontSize: 14, color: colors.ink },
  cmpTrackScore: { fontFamily: fonts.bodyBold, fontSize: 15, width: 40, textAlign: 'right' },

  cmpFork: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg },
  cmpForkBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    backgroundColor: colors.raised,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.pill,
    paddingVertical: 11,
    paddingHorizontal: spacing.sm,
  },
  cmpForkText: { fontFamily: fonts.bodySemiBold, fontSize: 13.5, color: colors.green, flexShrink: 1 },

  head: { alignItems: 'center', marginTop: spacing.xxl },
  art: { width: 148, height: 148, borderRadius: radii.lg },
  artFallback: { backgroundColor: colors.inset, alignItems: 'center', justifyContent: 'center' },
  artInitial: { fontFamily: fonts.display, fontSize: 56, color: colors.inkMuted },
  albumName: { fontFamily: fonts.display, fontSize: 26, color: colors.ink, textAlign: 'center', marginTop: spacing.lg },
  artist: { fontFamily: fonts.bodyMedium, fontSize: 14, color: colors.inkSecondary, marginTop: 6, textAlign: 'center' },
  // Artist names route to the artist page — weighted darker so they read as
  // the tappable part of the line.
  artistLink: { fontFamily: fonts.bodySemiBold, color: colors.ink },
  genre: {
    fontFamily: fonts.bodyBold,
    fontSize: 11,
    letterSpacing: 1.2,
    color: colors.green,
    marginTop: spacing.sm,
    textTransform: 'uppercase',
  },
  subGenres: {
    fontFamily: fonts.bodyMedium,
    fontSize: 12,
    color: colors.inkSecondary,
    marginTop: 5,
    textAlign: 'center',
  },

  // These three sit directly on the album backdrop. A 10% tint washed out over
  // busy artwork; a light fill read as a white cell stamped on the art. The
  // middle ground is a stronger tint of their own colour plus a border, so the
  // artwork still shows through the control.
  compareBtn: {
    backgroundColor: 'rgba(45,106,79,0.20)',
    borderWidth: 1,
    borderColor: 'rgba(45,106,79,0.38)',
    borderRadius: radii.pill,
    paddingHorizontal: 14,
    // Matches the 34pt icon buttons beside it so the cluster sits on one line
    // rather than three controls of three heights.
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
  },
  compareBtnText: { fontFamily: fonts.bodySemiBold, fontSize: 13, color: colors.green },
  shareBtn: {
    width: 34,
    height: 34,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(45,106,79,0.20)',
    borderWidth: 1,
    borderColor: 'rgba(45,106,79,0.38)',
  },
  // A warm glow around the cover rather than a stroke on it. A border sits on
  // the artwork and reads as a frame someone put there; light coming off the
  // edges belongs to the record. Zero offset so it radiates evenly instead of
  // falling to one side like a drop shadow.
  //
  // backgroundColor is load-bearing, not decoration: without an opaque
  // background iOS has no path to cast from and draws nothing at all.
  artGlow: {
    width: 148,
    height: 148,
    borderRadius: radii.lg,
    backgroundColor: colors.inset,
    shadowColor: RECOMMEND,
    shadowOpacity: 0.9,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 0 },
    // Android has no shadow colour, so elevation would render a grey drop
    // shadow rather than an orange halo — left off deliberately.
  },
  recCard: {
    backgroundColor: '#fff7ed',
    borderWidth: 1,
    borderColor: 'rgba(249,115,22,0.30)',
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    marginTop: spacing.lg,
  },
  recHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  recPfp: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  recPfpImg: { width: '100%', height: '100%' },
  recPfpInitial: { fontFamily: fonts.bodyBold, fontSize: 14, color: '#ffffff' },
  recFrom: { fontFamily: fonts.bodySemiBold, fontSize: 13.5, color: '#c2410c' },
  recWhen: { fontFamily: fonts.body, fontSize: 11.5, color: '#c2410c', opacity: 0.75, marginTop: 1 },
  recNote: {
    fontFamily: fonts.body,
    fontSize: 14,
    lineHeight: 21,
    color: colors.inkSecondary,
    marginTop: spacing.sm,
  },
  recNoNote: {
    fontFamily: fonts.body,
    fontSize: 13,
    fontStyle: 'italic',
    color: colors.inkTertiary,
    marginTop: spacing.sm,
  },
  // Only while it's unrated — once you've scored it, telling you to score it is
  // noise, and the sender can already see the result.
  recNudge: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 12.5,
    color: '#c2410c',
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(249,115,22,0.30)',
  },
  // Same shape as Share, in the recommendation orange rather than the brand
  // green, so the two read as siblings without reading as the same action.
  recommendBtn: {
    width: 34,
    height: 34,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(249,115,22,0.18)',
    borderWidth: 1,
    borderColor: 'rgba(249,115,22,0.40)',
  },
  deleteBtn: {
    width: 34,
    height: 34,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(185,28,28,0.16)',
    borderWidth: 1,
    borderColor: 'rgba(185,28,28,0.34)',
  },
  raterLine: { fontFamily: fonts.body, fontSize: 12, color: colors.inkTertiary, marginTop: 4 },

  // Average and prediction share one card. A single column centres itself when
  // there's no prediction to pair it with.
  scoreCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    // No fill and no frame — the album wash behind carries the block, and a
    // white panel stamped over the artwork was fighting it.
    paddingVertical: spacing.lg,
    marginTop: spacing.xl,
  },
  scoreCol: { flex: 1, alignItems: 'center' },
  // Stops short of the card's padding so it reads as a rule between two
  // readings, not a wall between two boxes.
  scoreDivider: { width: 1, alignSelf: 'stretch', marginVertical: 4, backgroundColor: colors.border },
  forYouRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  cmpRaters: { fontFamily: fonts.body, fontSize: 12, color: colors.inkTertiary, marginTop: 4 },

  failTitle: { fontFamily: fonts.display, fontSize: 22, color: colors.ink, textAlign: 'center' },
  failBody: {
    fontFamily: fonts.body,
    fontSize: 14,
    color: colors.inkTertiary,
    textAlign: 'center',
    lineHeight: 20,
    marginTop: spacing.sm,
    paddingHorizontal: spacing.xl,
  },
  failBtn: {
    backgroundColor: colors.green,
    borderRadius: radii.md,
    paddingHorizontal: 24,
    paddingVertical: 12,
    marginTop: spacing.lg,
  },
  failBtnText: { fontFamily: fonts.bodySemiBold, fontSize: 15, color: '#fff' },

  scoreBlock: { alignItems: 'center', marginTop: spacing.xl },
  bigScore: { fontFamily: fonts.display, fontSize: SCORE_SIZE, lineHeight: SCORE_LINE },
  scoreLabel: { fontFamily: fonts.bodyBold, fontSize: 11, letterSpacing: 1.4, color: colors.green },

  factorRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing.xl },
  factorCell: { alignItems: 'center', flex: 1 },
  factorValue: { fontFamily: fonts.bodyBold, fontSize: 17, color: colors.ink },
  factorLabel: { fontFamily: fonts.bodyMedium, fontSize: 10, color: colors.inkSecondary, marginTop: 2 },

  ctaRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xl },
  // The standalone button — Edit rating on a finished album. Owns its own top
  // margin, since nothing wraps it.
  cta: {
    backgroundColor: colors.green,
    borderRadius: radii.md,
    // Horizontal padding as well as vertical: at half width the label would
    // otherwise sit hard against the edges of its own button.
    paddingVertical: 15,
    paddingHorizontal: spacing.md,
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.xl,
  },
  // Paired inside ctaRow, which supplies the margin for both.
  ctaInRow: { flex: 1, marginTop: 0 },
  // Shelved: holds the button's shape so the row doesn't reflow under the tap,
  // but stops reading as something still to press.
  ctaDone: { backgroundColor: colors.inkMuted },
  ctaText: { fontFamily: fonts.bodySemiBold, fontSize: 15, color: '#fff' },

  sectionLabel: {
    fontFamily: fonts.bodyBold,
    fontSize: 11,
    letterSpacing: 1.2,
    color: colors.inkTertiary,
    marginTop: spacing.xl,
    marginBottom: spacing.sm,
  },
  trackRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  trackNum: { fontFamily: fonts.body, fontSize: 12, color: colors.inkTertiary, width: 20 },
  trackTitle: { flex: 1, fontFamily: fonts.bodyMedium, fontSize: 14, color: colors.ink },
  trackScore: { fontFamily: fonts.bodyBold, fontSize: 15 },
  trackScoreEmpty: { fontFamily: fonts.body, fontSize: 15, color: colors.inkTertiary },

  reviewBody: { fontFamily: fonts.body, fontSize: 15, color: colors.inkSecondary, lineHeight: 22 },
  // The write-a-review sheet: a full surface over the album page, so the field
  // can own everything between the bar and the keyboard.
  reviewSheet: { flex: 1, backgroundColor: colors.bg },
  reviewSheetBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  reviewSheetTitle: {
    flex: 1,
    textAlign: 'center',
    fontFamily: fonts.bodySemiBold,
    fontSize: 15,
    color: colors.ink,
  },
  reviewSheetSave: { fontFamily: fonts.bodySemiBold, fontSize: 15, color: colors.green },
  reviewSheetBody: { flex: 1, paddingHorizontal: spacing.lg, paddingTop: spacing.md },
  // flex rather than a fixed height: whatever the keyboard leaves is the field.
  reviewSheetInput: {
    flex: 1,
    fontFamily: fonts.body,
    fontSize: 16,
    lineHeight: 24,
    color: colors.ink,
  },
  reviewSheetDelete: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: spacing.md,
  },
  reviewSheetDeleteText: { fontFamily: fonts.bodyMedium, fontSize: 14, color: '#b91c1c' },

  reviewCancelText: { fontFamily: fonts.bodyMedium, fontSize: 14, color: colors.inkTertiary },
  reviewEdit: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: spacing.sm },
  reviewEditText: { fontFamily: fonts.bodyMedium, fontSize: 13, color: colors.inkTertiary },
  reviewWrite: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.greenSoft,
    paddingVertical: 11,
    borderRadius: radii.md,
    justifyContent: 'center',
  },
  reviewWriteText: { fontFamily: fonts.bodySemiBold, fontSize: 14, color: colors.green },
  reviewWriteSub: { fontFamily: fonts.body, fontSize: 12, color: colors.inkTertiary,
    marginTop: spacing.sm, textAlign: 'center' },
})
