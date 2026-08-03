// Album detail — read view for any album, and the entry into the rating screen:
// "Rate" (to-listen), "Continue" (listening), or "Edit rating" (rated). Shows
// the final or predicted score, factor breakdown, and per-track scores.
import { useRef, useState } from 'react'
import {
  ActivityIndicator,
  Animated,
  Dimensions,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Image } from 'expo-image'
import * as Haptics from 'expo-haptics'
import { ArrowLeft, Check, ChevronRight, Heart, Pencil, Trash2 } from 'lucide-react-native'
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
  type CommunityAlbum as CommunityAlbumData,
} from '../../lib/api'
import { songScoreColor, avatarColor, EP_MAX_TRACKS, type Album, type Song } from '@pressd/shared/types'
import { useAuth } from '../../lib/auth'
import CommentThread from '../../components/CommentThread'
import AlbumBackdrop from '../../components/AlbumBackdrop'
import BangSkip from '../../components/BangSkip'
import ScoreDial from '../../components/ScoreDial'
import { useDeleteAlbum } from '../../lib/useDeleteAlbum'
import { colors, fonts, radii, spacing } from '../../theme/tokens'

const WINDOW_H = Dimensions.get('window').height

// Destructive red, and the wash behind it. Shared by every delete control so
// removing a record looks the same wherever you reach it from.
const DANGER = '#b91c1c'
const DANGER_SOFT = 'rgba(185,28,28,0.09)'

// The comparison card sits over the album backdrop, and at a lighter wash the
// cover's own colors read straight through and fight the score type. Heavier
// than colors.greenSoft so the card settles a shade darker and mutes whatever
// is behind it, but still short of opaque — the art should show, not compete.
const CMP_CARD_TINT = 0.18
const CMP_CARD_BORDER = 0.26

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

  if (isCommunity) {
    if (communityLoading) {
      return (
        <SafeAreaView style={[styles.screen, styles.center]}>
          <ActivityIndicator color={colors.green} />
        </SafeAreaView>
      )
    }
    if (communityError || !communityData) {
      return <LoadFailed onBack={() => router.back()} />
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
        onBack={() => router.back()}
        onOpenArtist={(n) =>
          router.push({ pathname: '/artist/[name]', params: { name: encodeURIComponent(n) } })
        }
        onRate={() => startRating(shown)}
        onQueue={() => queueAlbum(shown)}
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
    return <LoadFailed onBack={() => router.back()} />
  }

  const sorted = [...album.songs].sort((a, b) => (a.trackNumber ?? 0) - (b.trackNumber ?? 0))
  const isEP = album.songs.length <= EP_MAX_TRACKS
  const isRated = album.status === 'rated'
  const showScore = isRated ? album.score : album.predictedScore
  const scoreIsPredicted = !isRated && album.predictedScore != null

  const cta =
    album.status === 'rated' ? 'Edit rating' : album.status === 'listening' ? 'Continue' : 'Rate this album'
  const isMine = user != null && album.userId === user.id
  const owner = !isMine && album.userId != null ? friends.find((f) => f.id === album.userId) ?? null : null
  const ownerColor = owner ? avatarColor(owner.name) : colors.green

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

  // Only your own copy can be deleted — a friend's rating isn't yours to remove.
  const { confirmDelete, deleting } = useDeleteAlbum({
    albumId,
    albumName: album.albumName,
    onDeleted: () => router.back(),
  })

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
        onBack={() => router.back()}
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
        <Pressable onPress={() => router.back()} hitSlop={10} style={styles.backBtn}>
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
        {canCompare && (
          <Pressable style={styles.compareBtn} onPress={openCompare} hitSlop={8}>
            <Text style={styles.compareBtnText}>Compare</Text>
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

      <Animated.ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        onScroll={onScroll}
        scrollEventThrottle={16}
      >
        <View style={styles.head}>
          {album.albumArtUrl ? (
            <Image source={{ uri: album.albumArtUrl }} style={styles.art} contentFit="cover" />
          ) : (
            <View style={[styles.art, styles.artFallback]}>
              <Text style={styles.artInitial}>{album.albumName[0]}</Text>
            </View>
          )}
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
          {/* A prediction reads as a dial, a settled score as the numeral —
              so the two are never mistaken for each other. */}
          {scoreIsPredicted && showScore != null ? (
            // The numeral's line-height supplies its own breathing room; the
            // dial needs the gap added back before the label.
            <View style={{ marginBottom: 6 }}>
              <ScoreDial value={showScore} size={104} />
            </View>
          ) : (
            <Text style={[styles.bigScore, { color: showScore != null ? colors.green : colors.inkMuted }]}>
              {showScore != null ? showScore.toFixed(2) : '—'}
            </Text>
          )}
          <Text style={styles.scoreLabel}>
            {isRated ? 'FINAL SCORE' : scoreIsPredicted ? 'PREDICTED' : 'NOT YET RATED'}
          </Text>
        </View>

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

        <Pressable
          style={({ pressed }) => [styles.cta, pressed && { backgroundColor: colors.greenPressed }]}
          onPress={() => router.push({ pathname: '/rate/[id]', params: { id: String(albumId) } })}
        >
          <Text style={styles.ctaText}>{cta}</Text>
        </Pressable>

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

        <CommentThread albumId={albumId} />
      </Animated.ScrollView>
      </SafeAreaView>
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
}: {
  data: CommunityAlbumData
  onBack: () => void
  onOpenArtist: (name: string) => void
  onRate: () => void
  onQueue: () => Promise<void>
  initialComparing?: boolean
  onOpenYours?: () => void
}) {
  const [comparing, setComparing] = useState(initialComparing)
  const [rating, setRating] = useState(false)
  const [queuing, setQueuing] = useState(false)
  const [queued, setQueued] = useState(false)
  const notRated = data.your_status !== 'rated'
  const inLibrary = data.your_album_id != null
  const canCompare = data.you?.score != null && data.avg_score != null
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
      {/* Only the way in lives up here — the comparison itself carries its own
          pair of exits, so there's no second Average control competing. */}
      {canCompare && !comparing ? (
        <Pressable style={styles.compareBtn} onPress={() => setComparing(true)} hitSlop={8}>
          <Text style={styles.compareBtnText}>Compare</Text>
        </Pressable>
      ) : null}
    </View>
  )

  if (comparing && data.you) {
    const you = data.you
    const pos = (v: number) => ((Math.max(5, Math.min(10, v)) - 5) / 5) * 100
    const avgScore = data.avg_score!
    const yourScore = you.score!
    const diff = yourScore - avgScore
    const youLeft = yourScore <= avgScore

    const rated = data.tracks.filter((t) => t.avg_score != null && t.your_score != null)
    let widest: { title: string; gap: number } | null = null
    for (const t of rated) {
      const gap = Math.abs(t.your_score! - t.avg_score!)
      if (!widest || gap > widest.gap) widest = { title: t.title, gap }
    }
    const verdict =
      Math.abs(diff) < 0.005
        ? `You landed exactly on the Pressd average.`
        : `You rated this ${Math.abs(diff).toFixed(2)} ${diff > 0 ? 'above' : 'below'} the Pressd average` +
          (widest ? ` — biggest gap on “${widest.title}”.` : '.')

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
                  <Text style={[styles.cmpScore, { color: left.color }]}>{left.score.toFixed(2)}</Text>
                </View>
                <View style={[styles.cmpDivider, { backgroundColor: 'rgba(45,106,79,0.25)' }]} />
                <View style={styles.cmpScoreCol}>
                  <Text style={[styles.cmpWho, { color: right.head }]} numberOfLines={1}>{right.label}</Text>
                  <Text style={[styles.cmpScore, { color: right.color }]}>{right.score.toFixed(2)}</Text>
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

              <Text style={styles.cmpVerdict}>{verdict}</Text>
              <Text style={styles.cmpRaters}>Averaged across {raters}</Text>
            </View>

            {/* Either side of the comparison in full, so this screen forks
                rather than dead-ends. */}
            <View style={styles.cmpFork}>
              {onOpenYours && <ForkBtn label="Your rating" onPress={onOpenYours} />}
              <ForkBtn label="Average rating" onPress={() => setComparing(false)} />
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
              const leftVal = youLeft ? t.your_score : t.avg_score
              const rightVal = youLeft ? t.avg_score : t.your_score
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
          <View style={styles.scoreRow}>
            <View style={styles.scoreCol}>
              <Text style={[styles.bigScore, { color: data.avg_score != null ? colors.green : colors.inkMuted }]}>
                {data.avg_score != null ? data.avg_score.toFixed(2) : '—'}
              </Text>
              <Text style={styles.scoreLabel}>PRESSD AVERAGE</Text>
              <Text style={styles.raterLine}>{raters}</Text>
            </View>
            {notRated && data.predicted_score != null && (
              <View style={styles.dialCol}>
                <ScoreDial value={data.predicted_score} size={78} />
                <Text style={styles.dialLabel}>PREDICTED</Text>
              </View>
            )}
          </View>

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

          {notRated && (
            <Pressable
              style={({ pressed }) => [styles.cta, pressed && { backgroundColor: colors.greenPressed }]}
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
                <Text style={styles.ctaText}>
                  {data.your_status === 'listening' ? 'Continue rating' : 'Rate now'}
                </Text>
              )}
            </Pressable>
          )}

          {/* Queueing only means anything for albums you don't already hold. */}
          {!inLibrary && (
            <Pressable
              style={styles.queueBtn}
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
              <Text style={styles.queueBtnText}>
                {queued ? 'Added to To Listen' : queuing ? 'Adding…' : 'Add to To Listen'}
              </Text>
            </Pressable>
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

const normTitle = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '')

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

  const verdict =
    Math.abs(diff) < 0.005
      ? `You and ${owner.name} landed on exactly the same score.`
      : `${owner.name} rated this ${Math.abs(diff).toFixed(2)} ${diff > 0 ? 'higher' : 'lower'} than you` +
        (widest ? ` — biggest gap on “${widest.title}”.` : '.')

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
                <Text style={[styles.cmpScore, { color: left.color }]}>{left.score.toFixed(2)}</Text>
              </View>
              <View style={[styles.cmpDivider, { backgroundColor: tint(color, 0.25) }]} />
              <View style={styles.cmpScoreCol}>
                <Text style={[styles.cmpWho, { color: right.head }]} numberOfLines={1}>{right.label}</Text>
                <Text style={[styles.cmpScore, { color: right.color }]}>{right.score.toFixed(2)}</Text>
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

            <Text style={styles.cmpVerdict}>{verdict}</Text>
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
  const queryClient = useQueryClient()
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

  return (
    <View>
      <Text style={styles.sectionLabel}>REVIEW</Text>
      {editing ? (
        <View>
          <TextInput
            style={styles.reviewInput}
            value={draft}
            onChangeText={setDraft}
            placeholder="Write your thoughts on this album…"
            placeholderTextColor={colors.inkMuted}
            multiline
            autoFocus
          />
          <View style={styles.reviewActions}>
            <Pressable style={styles.reviewSave} onPress={save} disabled={busy}>
              {busy ? <ActivityIndicator size="small" color="#fff" /> : <Check size={15} color="#fff" />}
              <Text style={styles.reviewSaveText}>Save</Text>
            </Pressable>
            <Pressable style={styles.reviewCancel} onPress={() => { setDraft(album.review ?? ''); setEditing(false) }}>
              <Text style={styles.reviewCancelText}>Cancel</Text>
            </Pressable>
            {album.review && (
              <Pressable style={styles.reviewDelete} onPress={remove} disabled={busy} hitSlop={8}>
                <Trash2 size={16} color="#b91c1c" />
              </Pressable>
            )}
          </View>
        </View>
      ) : album.review ? (
        <View>
          <Text style={styles.reviewBody}>{album.review}</Text>
          {editable && (
            <Pressable style={styles.reviewEdit} onPress={() => { setDraft(album.review ?? ''); setEditing(true) }}>
              <Pencil size={13} color={colors.inkTertiary} />
              <Text style={styles.reviewEditText}>Edit review</Text>
            </Pressable>
          )}
        </View>
      ) : (
        <Pressable style={styles.reviewWrite} onPress={() => setEditing(true)}>
          <Pencil size={14} color={colors.green} />
          <Text style={styles.reviewWriteText}>Write a review</Text>
        </Pressable>
      )}
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
  backBtn: { flexDirection: 'row', alignItems: 'center', gap: 4 },
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

  compareBtn: {
    backgroundColor: colors.greenSoft,
    borderRadius: radii.pill,
    paddingHorizontal: 14,
    paddingVertical: 7,
  },
  compareBtnText: { fontFamily: fonts.bodySemiBold, fontSize: 13, color: colors.green },
  deleteBtn: {
    width: 34,
    height: 34,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: DANGER_SOFT,
  },
  raterLine: { fontFamily: fonts.body, fontSize: 12, color: colors.inkTertiary, marginTop: 4 },

  // Average and prediction sit on one line; the column centres itself when
  // there's no prediction to show.
  scoreRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xxl,
    marginTop: spacing.xl,
  },
  scoreCol: { alignItems: 'center' },
  dialCol: { alignItems: 'center', gap: 6 },
  dialLabel: { fontFamily: fonts.bodyBold, fontSize: 10, letterSpacing: 1.2, color: colors.inkTertiary },
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
  bigScore: { fontFamily: fonts.display, fontSize: 64, lineHeight: 68 },
  scoreLabel: { fontFamily: fonts.bodyBold, fontSize: 11, letterSpacing: 1.4, color: colors.inkSecondary },

  factorRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing.xl },
  factorCell: { alignItems: 'center', flex: 1 },
  factorValue: { fontFamily: fonts.bodyBold, fontSize: 17, color: colors.ink },
  factorLabel: { fontFamily: fonts.bodyMedium, fontSize: 10, color: colors.inkSecondary, marginTop: 2 },

  cta: {
    backgroundColor: colors.green,
    borderRadius: radii.md,
    paddingVertical: 15,
    alignItems: 'center',
    marginTop: spacing.xl,
  },
  ctaText: { fontFamily: fonts.bodySemiBold, fontSize: 15, color: '#fff' },
  queueBtn: { alignSelf: 'center', paddingVertical: spacing.md },
  queueBtnText: { fontFamily: fonts.bodySemiBold, fontSize: 14, color: colors.green },

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
  reviewInput: {
    minHeight: 90,
    backgroundColor: colors.raised,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    fontFamily: fonts.body,
    fontSize: 15,
    color: colors.ink,
    textAlignVertical: 'top',
  },
  reviewActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.sm },
  reviewSave: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.green,
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderRadius: radii.md,
  },
  reviewSaveText: { fontFamily: fonts.bodySemiBold, fontSize: 14, color: '#fff' },
  reviewCancel: { paddingHorizontal: 14, paddingVertical: 9 },
  reviewCancelText: { fontFamily: fonts.bodyMedium, fontSize: 14, color: colors.inkTertiary },
  reviewDelete: { marginLeft: 'auto', padding: spacing.sm },
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
})
