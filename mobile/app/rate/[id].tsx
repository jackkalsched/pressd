// Rating screen — the core loop's payoff. Score each track (0–10 via slider),
// then the four external factors unless it's an EP (≤6 tracks). A live card
// shows the projected score, computed exactly like the server will. Submitting
// writes song scores + factors, flips the album to "rated", and surfaces the
// share card with the freshly computed final score.
import { useMemo, useState } from 'react'
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Image } from 'expo-image'
import * as Haptics from 'expo-haptics'
import { ArrowLeft, Check, SkipForward } from 'lucide-react-native'
import {
  fetchAlbum,
  batchRateSongs,
  updateAlbum,
  fetchFactorStats,
  fetchFactorWeights,
} from '../../lib/api'
import {
  computeAlbumScore,
  songScoreColor,
  BANG_THRESHOLD,
  SKIP_THRESHOLD,
  EP_MAX_TRACKS,
  type Album,
  type Song,
} from '@pressd/shared/types'
import { useAuth } from '../../lib/auth'
import ScoreSlider from '../../components/ScoreSlider'
import ShareCard from '../../components/ShareCard'
import AlbumBackdrop from '../../components/AlbumBackdrop'
import BangSkip from '../../components/BangSkip'
import { colors, fonts, radii, spacing } from '../../theme/tokens'

const FACTORS = [
  { key: 'theme', label: 'Theme / Cohesion', desc: 'Strength and cohesion of the central idea' },
  { key: 'replay', label: 'Replay Value', desc: 'How replayable the album is' },
  { key: 'production', label: 'Production', desc: 'Sound quality, mixing, sonic palette' },
  { key: 'distinctness', label: 'Distinctness', desc: 'Originality and genre-bending' },
] as const

export default function RatingScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const albumId = Number(id)
  const router = useRouter()
  const queryClient = useQueryClient()
  const { user } = useAuth()
  const userId = user?.id ?? 0

  const { data: album, isLoading } = useQuery({
    queryKey: ['album', albumId],
    queryFn: () => fetchAlbum(albumId),
  })
  const { data: factorStats } = useQuery({
    queryKey: ['factor-stats'],
    queryFn: fetchFactorStats,
    staleTime: 5 * 60_000,
  })
  const { data: factorWeights } = useQuery({
    queryKey: ['factor-weights', userId],
    queryFn: () => fetchFactorWeights(userId),
    enabled: userId > 0,
    staleTime: 5 * 60_000,
  })

  const sortedSongs = useMemo(
    () => (album ? [...album.songs].sort((a, b) => (a.trackNumber ?? 0) - (b.trackNumber ?? 0)) : []),
    [album],
  )
  const isEP = (album?.songs.length ?? 0) <= EP_MAX_TRACKS
  const isEditing = album?.status === 'rated'

  const [scores, setScores] = useState<(number | null)[]>([])
  const [skipped, setSkipped] = useState<Set<number>>(new Set())
  const [theme, setTheme] = useState<number | null>(null)
  const [replay, setReplay] = useState<number | null>(null)
  const [production, setProduction] = useState<number | null>(null)
  const [distinctness, setDistinctness] = useState<number | null>(null)
  const [extraArtists, setExtraArtists] = useState('')
  const [initialized, setInitialized] = useState(false)
  const [shareAlbum, setShareAlbum] = useState<Album | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Seed local state once the album arrives (supports resuming a draft).
  if (album && !initialized) {
    setScores(sortedSongs.map((s) => s.score))
    setTheme(album.theme)
    setReplay(album.replayValue)
    setProduction(album.production)
    setDistinctness(album.distinctness)
    setExtraArtists(album.extraArtists.join(', '))
    setInitialized(true)
  }

  const factorSetters: Record<string, (v: number | null) => void> = {
    theme: setTheme,
    replay: setReplay,
    production: setProduction,
    distinctness: setDistinctness,
  }
  const factorValues: Record<string, number | null> = { theme, replay, production, distinctness }

  function toggleSkip(i: number) {
    setSkipped((prev) => {
      const next = new Set(prev)
      next.has(i) ? next.delete(i) : next.add(i)
      return next
    })
    // Skipping clears any score on that track.
    if (!skipped.has(i)) {
      setScores((prev) => {
        const next = [...prev]
        next[i] = null
        return next
      })
    }
  }

  function setScoreAt(i: number, v: number | null) {
    setScores((prev) => {
      const next = [...prev]
      next[i] = v
      return next
    })
  }

  const ratedCount = scores.filter((s) => s !== null).length
  const avgSong = ratedCount > 0
    ? scores.filter((s): s is number => s !== null).reduce((a, s) => a + s, 0) / ratedCount
    : null
  const songsComplete = scores.length > 0 && scores.every((s, i) => s !== null || skipped.has(i))
  const factorsComplete = isEP || (theme !== null && replay !== null && production !== null && distinctness !== null)
  const canSubmit = songsComplete && factorsComplete
  const doneCount = scores.filter((s, i) => s !== null || skipped.has(i)).length

  const previewScore = songsComplete && factorsComplete && (isEP || factorStats)
    ? isEP
      ? (avgSong !== null ? Math.round(avgSong * 100) / 100 : null)
      : computeAlbumScore(
          sortedSongs.map((s, i) => ({ ...s, score: scores[i] })) as Song[],
          theme!, replay!, production!, distinctness!,
          factorStats!,
          factorWeights?.points,
        )
    : null

  const displayBig = previewScore !== null ? previewScore : avgSong
  const isFinal = previewScore !== null
  const bigLabel = displayBig === null ? 'START RATING' : isFinal ? 'PROJECTED FINAL' : 'RUNNING AVG'

  const submit = useMutation({
    mutationFn: async () => {
      if (!album) return
      await batchRateSongs(sortedSongs.map((song, i) => ({ id: song.id, score: scores[i] ?? null })), userId)
      const parsedExtra = extraArtists.split(',').map((s) => s.trim()).filter(Boolean)
      await updateAlbum(album.id, {
        ...(isEP ? {} : { theme, replay_value: replay, production, distinctness }),
        status: 'rated',
        extra_artists: parsedExtra.length ? JSON.stringify(parsedExtra) : null,
      })
    },
    onSuccess: async () => {
      setError(null)
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {})
      queryClient.invalidateQueries({ queryKey: ['albums'] })
      queryClient.invalidateQueries({ queryKey: ['stats'] })
      queryClient.invalidateQueries({ queryKey: ['album', albumId] })
      const fresh = await fetchAlbum(albumId).catch(() => null)
      if (fresh) setShareAlbum(fresh)
      else router.replace({ pathname: '/album/[id]', params: { id: String(albumId) } })
    },
    onError: () => setError('Could not save your rating. Please try again.'),
  })

  const saveDraft = useMutation({
    mutationFn: async () => {
      if (!album) return
      await batchRateSongs(sortedSongs.map((song, i) => ({ id: song.id, score: scores[i] ?? null })), userId)
      const parsedExtra = extraArtists.split(',').map((s) => s.trim()).filter(Boolean)
      await updateAlbum(album.id, {
        ...(isEP ? {} : { theme, replay_value: replay, production, distinctness }),
        status: isEditing ? 'rated' : 'listening',
        extra_artists: parsedExtra.length ? JSON.stringify(parsedExtra) : null,
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['albums'] })
      queryClient.invalidateQueries({ queryKey: ['album', albumId] })
      router.back()
    },
    onError: () => setError('Could not save. Please try again.'),
  })

  if (shareAlbum) {
    return (
      <ShareCard
        album={shareAlbum}
        onClose={() => router.replace({ pathname: '/album/[id]', params: { id: String(albumId) } })}
      />
    )
  }

  if (isLoading || !album) {
    return (
      <SafeAreaView style={[styles.screen, styles.center]}>
        <ActivityIndicator color={colors.green} />
      </SafeAreaView>
    )
  }

  const busy = submit.isPending || saveDraft.isPending

  return (
    <View style={styles.root}>
      <AlbumBackdrop albumArtUrl={album.albumArtUrl} album={album.albumName} artist={album.artist} />
      <SafeAreaView style={styles.screen} edges={['top']}>
      {/* Top bar */}
      <View style={styles.topBar}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={styles.backBtn}>
          <ArrowLeft size={18} color={colors.inkSecondary} />
          <Text style={styles.backText}>Back</Text>
        </Pressable>
        <Pressable onPress={() => saveDraft.mutate()} disabled={busy} hitSlop={10}>
          <Text style={styles.saveExit}>{saveDraft.isPending ? 'Saving…' : 'Save & Exit'}</Text>
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* Album header */}
        <View style={styles.albumHead}>
          {album.albumArtUrl ? (
            <Image source={{ uri: album.albumArtUrl }} style={styles.albumArt} contentFit="cover" />
          ) : (
            <View style={[styles.albumArt, styles.artFallback]}>
              <Text style={styles.artInitial}>{album.albumName[0]}</Text>
            </View>
          )}
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.albumName} numberOfLines={2}>{album.albumName}</Text>
            <Text style={styles.albumMeta} numberOfLines={1}>
              {[album.artist, ...album.extraArtists].join(', ')}{album.year ? ` · ${album.year}` : ''}
            </Text>
            <Text style={styles.trackCount}>
              {sortedSongs.length} tracks{isEP ? ' · EP (no factors)' : ''}
            </Text>
          </View>
        </View>

        {/* Live score card */}
        <View style={styles.liveCard}>
          <Text
            style={[styles.bigScore, { color: displayBig !== null ? colors.green : colors.inkMuted }]}
          >
            {displayBig !== null ? displayBig.toFixed(2) : '—'}
          </Text>
          <Text style={styles.bigLabel}>{bigLabel}</Text>
          <View style={styles.progressTrack}>
            <View
              style={[
                styles.progressFill,
                { width: `${sortedSongs.length ? (ratedCount / sortedSongs.length) * 100 : 0}%` },
              ]}
            />
          </View>
          <Text style={styles.progressText}>{ratedCount} / {sortedSongs.length} tracks scored</Text>
        </View>

        {/* Tracks */}
        <Text style={styles.sectionLabel}>TRACKS</Text>
        {sortedSongs.map((song, i) => {
          const isSkipped = skipped.has(i)
          return (
            <View key={song.id} style={[styles.trackRow, isSkipped && styles.trackSkipped]}>
              <View style={styles.trackHead}>
                <Text style={styles.trackNum}>{song.trackNumber}</Text>
                <Text style={[styles.trackTitle, isSkipped && styles.strike]} numberOfLines={1}>
                  {song.title}
                </Text>
                <BangSkip score={scores[i] ?? null} />
                <Pressable onPress={() => toggleSkip(i)} hitSlop={8} style={styles.skipBtn}>
                  <SkipForward size={14} color={isSkipped ? colors.green : colors.inkMuted} />
                  <Text style={[styles.skipText, isSkipped && { color: colors.green }]}>
                    {isSkipped ? 'skipped' : 'skip'}
                  </Text>
                </Pressable>
              </View>
              {!isSkipped && (
                <ScoreSlider value={scores[i] ?? null} onChange={(v) => setScoreAt(i, v)} />
              )}
            </View>
          )
        })}

        {/* External factors */}
        {!isEP && (
          <>
            <Text style={styles.sectionLabel}>EXTERNAL FACTORS</Text>
            {!songsComplete && (
              <Text style={styles.factorHint}>Finish scoring every track to unlock factors.</Text>
            )}
            {FACTORS.map(({ key, label, desc }) => (
              <View key={key} style={[styles.factorCard, !songsComplete && styles.factorLocked]}>
                <Text style={styles.factorLabel}>{label}</Text>
                <Text style={styles.factorDesc}>{desc}</Text>
                <ScoreSlider
                  value={factorValues[key]}
                  onChange={factorSetters[key]}
                  disabled={!songsComplete}
                />
              </View>
            ))}
          </>
        )}

        {/* Additional artists */}
        <Text style={styles.sectionLabel}>ADDITIONAL ARTISTS</Text>
        <TextInput
          style={styles.extraInput}
          value={extraArtists}
          onChangeText={setExtraArtists}
          placeholder="Comma-separated, e.g. Kanye West, Jay-Z"
          placeholderTextColor={colors.inkMuted}
          autoCapitalize="words"
        />

        {error && <Text style={styles.error}>{error}</Text>}

        {/* Submit */}
        <Pressable
          style={[styles.submit, (!canSubmit || busy) && styles.submitDisabled]}
          onPress={() => submit.mutate()}
          disabled={!canSubmit || busy}
        >
          {submit.isPending ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <>
              <Check size={16} color={canSubmit ? '#fff' : colors.inkMuted} />
              <Text style={[styles.submitText, !canSubmit && { color: colors.inkMuted }]}>
                {canSubmit
                  ? isEditing ? 'Update rating' : 'Submit rating'
                  : !songsComplete
                  ? `${doneCount} / ${sortedSongs.length} tracks done`
                  : 'Fill in the factors'}
              </Text>
            </>
          )}
        </Pressable>

        {/* Bang / skip tally */}
        <Text style={styles.tally}>
          {scores.filter((s) => s !== null && s >= BANG_THRESHOLD).length} bangs ·{' '}
          {scores.filter((s) => s !== null && s < SKIP_THRESHOLD).length} skips
        </Text>
      </ScrollView>
      </SafeAreaView>
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
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  backBtn: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  backText: { fontFamily: fonts.bodyMedium, fontSize: 15, color: colors.inkSecondary },
  saveExit: { fontFamily: fonts.bodyMedium, fontSize: 14, color: colors.inkTertiary },
  content: { paddingHorizontal: spacing.lg, paddingBottom: 60 },

  albumHead: { flexDirection: 'row', gap: spacing.md, alignItems: 'center', marginTop: spacing.sm },
  albumArt: { width: 76, height: 76, borderRadius: radii.md },
  artFallback: { backgroundColor: colors.inset, alignItems: 'center', justifyContent: 'center' },
  artInitial: { fontFamily: fonts.display, fontSize: 30, color: colors.inkMuted },
  albumName: { fontFamily: fonts.display, fontSize: 22, color: colors.ink },
  albumMeta: { fontFamily: fonts.bodyMedium, fontSize: 13, color: colors.inkTertiary, marginTop: 3 },
  trackCount: { fontFamily: fonts.body, fontSize: 12, color: colors.inkMuted, marginTop: 3 },

  liveCard: {
    backgroundColor: colors.raised,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    alignItems: 'center',
    marginTop: spacing.lg,
  },
  bigScore: { fontFamily: fonts.display, fontSize: 56, lineHeight: 60 },
  bigLabel: {
    fontFamily: fonts.bodyBold,
    fontSize: 10,
    letterSpacing: 1.4,
    color: colors.inkMuted,
    marginTop: 2,
  },
  progressTrack: {
    width: '100%',
    height: 6,
    backgroundColor: colors.inset,
    borderRadius: 3,
    marginTop: spacing.md,
    overflow: 'hidden',
  },
  progressFill: { height: '100%', backgroundColor: colors.green, borderRadius: 3 },
  progressText: { fontFamily: fonts.body, fontSize: 11, color: colors.inkTertiary, marginTop: 6 },

  sectionLabel: {
    fontFamily: fonts.bodyBold,
    fontSize: 11,
    letterSpacing: 1.2,
    color: colors.inkMuted,
    marginTop: spacing.xl,
    marginBottom: spacing.sm,
  },
  trackRow: {
    backgroundColor: colors.raised,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  trackSkipped: { opacity: 0.6 },
  trackHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  trackNum: { fontFamily: fonts.body, fontSize: 12, color: colors.inkMuted, width: 20 },
  trackTitle: { flex: 1, fontFamily: fonts.bodyMedium, fontSize: 14, color: colors.ink },
  strike: { textDecorationLine: 'line-through', color: colors.inkTertiary },
  skipBtn: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  skipText: { fontFamily: fonts.bodyMedium, fontSize: 11, color: colors.inkMuted },

  factorHint: { fontFamily: fonts.body, fontSize: 12, color: colors.inkMuted, marginBottom: spacing.sm },
  factorCard: {
    backgroundColor: colors.raised,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  factorLocked: { opacity: 0.5 },
  factorLabel: { fontFamily: fonts.bodySemiBold, fontSize: 14, color: colors.ink },
  factorDesc: { fontFamily: fonts.body, fontSize: 11, color: colors.inkTertiary, marginTop: 1, marginBottom: spacing.sm },

  extraInput: {
    backgroundColor: colors.raised,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    fontFamily: fonts.body,
    fontSize: 14,
    color: colors.ink,
  },
  error: { fontFamily: fonts.bodyMedium, fontSize: 13, color: '#b91c1c', textAlign: 'center', marginTop: spacing.md },
  submit: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.green,
    borderRadius: radii.md,
    paddingVertical: 15,
    marginTop: spacing.lg,
  },
  submitDisabled: { backgroundColor: colors.inset },
  submitText: { fontFamily: fonts.bodySemiBold, fontSize: 15, color: '#fff' },
  tally: { fontFamily: fonts.body, fontSize: 12, color: colors.inkTertiary, textAlign: 'center', marginTop: spacing.md },
})
