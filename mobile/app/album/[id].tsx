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
import { ArrowLeft, Check, Heart, Pencil, Trash2 } from 'lucide-react-native'
import { fetchAlbum, fetchAlbums, fetchFriends, saveReview, deleteReview, toggleLike } from '../../lib/api'
import { songScoreColor, avatarColor, EP_MAX_TRACKS, type Album, type Song } from '@pressd/shared/types'
import { useAuth } from '../../lib/auth'
import CommentThread from '../../components/CommentThread'
import AlbumBackdrop from '../../components/AlbumBackdrop'
import BangSkip from '../../components/BangSkip'
import { colors, fonts, radii, spacing } from '../../theme/tokens'

const WINDOW_H = Dimensions.get('window').height

export default function AlbumDetail() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const albumId = Number(id)
  const router = useRouter()
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

  const { data: album, isLoading } = useQuery({
    queryKey: ['album', albumId],
    queryFn: () => fetchAlbum(albumId),
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

  if (isLoading || !album) {
    return (
      <SafeAreaView style={[styles.screen, styles.center]}>
        <ActivityIndicator color={colors.green} />
      </SafeAreaView>
    )
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

  const openArtist = (name: string) =>
    router.push({ pathname: '/artist/[name]', params: { name: encodeURIComponent(name) } })

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
          <Text style={[styles.bigScore, { color: showScore != null ? colors.green : colors.inkMuted }]}>
            {showScore != null ? showScore.toFixed(2) : '—'}
          </Text>
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
  onOpenArtist,
}: {
  theirs: Album
  mine: Album
  owner: { id: number; name: string; avatarUrl?: string }
  color: string
  onBack: () => void
  onOpenMine: () => void
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
          <View style={[styles.cmpCard, { backgroundColor: tint(color, 0.07), borderColor: tint(color, 0.18) }]}>
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

          <Pressable style={styles.cmpOpenMine} onPress={onOpenMine}>
            <Text style={styles.cmpOpenMineText}>Open your rating</Text>
          </Pressable>

          <CommentThread albumId={theirs.id} />
        </ScrollView>
      </SafeAreaView>
    </View>
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

  cmpOpenMine: { alignSelf: 'flex-start', marginTop: spacing.lg },
  cmpOpenMineText: { fontFamily: fonts.bodySemiBold, fontSize: 14, color: colors.green },

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
