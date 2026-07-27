// Rating flow — one song at a time. Each track gets its own screen: title,
// runtime, a typed score, and Next / Skip. A list button opens every track
// you've already scored so you can jump back and change one. After the last
// track the four album factors are rated (skipped for EPs), then submitting
// writes everything and surfaces the share card.
import { useMemo, useState } from 'react'
import {
  ActivityIndicator,
  Modal,
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
import { ArrowLeft, ArrowRight, Check, ListMusic, X } from 'lucide-react-native'
import {
  fetchAlbum,
  fetchAlbums,
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
import ShareCard from '../../components/ShareCard'
import AlbumBackdrop from '../../components/AlbumBackdrop'
import { colors, fonts, radii, spacing } from '../../theme/tokens'

const FACTORS = [
  { key: 'theme', label: 'Theme / Cohesion', desc: 'Strength and cohesion of the central idea' },
  { key: 'replay', label: 'Replay Value', desc: 'How replayable the album is' },
  { key: 'production', label: 'Production', desc: 'Sound quality, mixing, sonic palette' },
  { key: 'distinctness', label: 'Distinctness', desc: 'Originality and genre-bending' },
] as const

/** Text → score, tolerating partial input like "8." while typing. */
function parseScore(text: string): number | null {
  if (!text.trim()) return null
  const n = Number.parseFloat(text)
  if (!Number.isFinite(n)) return null
  return Math.max(0, Math.min(10, n))
}

/** Keep only digits and a single decimal point, capped at 10. */
function cleanScoreText(text: string): string {
  let t = text.replace(/[^0-9.]/g, '')
  const firstDot = t.indexOf('.')
  if (firstDot !== -1) t = t.slice(0, firstDot + 1) + t.slice(firstDot + 1).replace(/\./g, '')
  const n = Number.parseFloat(t)
  if (Number.isFinite(n) && n > 10) return '10'
  return t.slice(0, 4)
}

function runtime(ms?: number | null): string | null {
  if (!ms) return null
  const total = Math.round(ms / 1000)
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

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
  // Already-rated albums, for the "on pace for a top-N album" read-out. Shared
  // cache with Profile/Social, so this is usually free.
  const { data: ratedAlbums = [] } = useQuery({
    queryKey: ['albums', 'rated', userId],
    queryFn: () => fetchAlbums({ status: 'rated', userId }),
    enabled: userId > 0,
  })

  const sortedSongs = useMemo(
    () => (album ? [...album.songs].sort((a, b) => (a.trackNumber ?? 0) - (b.trackNumber ?? 0)) : []),
    [album],
  )
  const isEP = (album?.songs.length ?? 0) <= EP_MAX_TRACKS
  const isEditing = album?.status === 'rated'

  const [drafts, setDrafts] = useState<string[]>([])
  const [skipped, setSkipped] = useState<Set<number>>(new Set())
  const [idx, setIdx] = useState(0)
  const [phase, setPhase] = useState<'tracks' | 'factors'>('tracks')
  const [factorText, setFactorText] = useState<Record<string, string>>({
    theme: '', replay: '', production: '', distinctness: '',
  })
  const [extraArtists, setExtraArtists] = useState('')
  const [listOpen, setListOpen] = useState(false)
  const [initialized, setInitialized] = useState(false)
  const [shareAlbum, setShareAlbum] = useState<Album | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Seed once the album arrives; resume at the first unscored track.
  if (album && !initialized) {
    const seeded = sortedSongs.map((s) => (s.score != null ? String(s.score) : ''))
    setDrafts(seeded)
    setFactorText({
      theme: album.theme != null ? String(album.theme) : '',
      replay: album.replayValue != null ? String(album.replayValue) : '',
      production: album.production != null ? String(album.production) : '',
      distinctness: album.distinctness != null ? String(album.distinctness) : '',
    })
    setExtraArtists(album.extraArtists.join(', '))
    const firstOpen = seeded.findIndex((t) => t === '')
    setIdx(firstOpen === -1 ? 0 : firstOpen)
    if (firstOpen === -1 && !isEP) setPhase('factors')
    setInitialized(true)
  }

  const scores = useMemo(() => drafts.map(parseScore), [drafts])
  const factorVals = useMemo(
    () => ({
      theme: parseScore(factorText.theme),
      replay: parseScore(factorText.replay),
      production: parseScore(factorText.production),
      distinctness: parseScore(factorText.distinctness),
    }),
    [factorText],
  )

  const ratedIdx = scores.map((s, i) => (s !== null || skipped.has(i) ? i : -1)).filter((i) => i >= 0)
  const withScores = scores.filter((s): s is number => s !== null)
  const runningAvg = withScores.length ? withScores.reduce((a, b) => a + b, 0) / withScores.length : null
  const bangs = withScores.filter((s) => s >= BANG_THRESHOLD).length
  const skips = withScores.filter((s) => s < SKIP_THRESHOLD).length

  const songsComplete = drafts.length > 0 && drafts.every((t, i) => parseScore(t) !== null || skipped.has(i))
  const factorsComplete =
    isEP || (factorVals.theme !== null && factorVals.replay !== null &&
             factorVals.production !== null && factorVals.distinctness !== null)
  const canSubmit = songsComplete && factorsComplete

  const previewScore =
    songsComplete && factorsComplete && (isEP || factorStats)
      ? isEP
        ? runningAvg !== null
          ? Math.round(runningAvg * 100) / 100
          : null
        : computeAlbumScore(
            sortedSongs.map((s, i) => ({ ...s, score: scores[i] })) as Song[],
            factorVals.theme!, factorVals.replay!, factorVals.production!, factorVals.distinctness!,
            factorStats!,
            factorWeights?.points,
          )
      : null

  // Where this album would land in the library if it finished at the running avg.
  const pace = useMemo(() => {
    if (runningAvg == null || ratedAlbums.length < 10) return null
    const better = ratedAlbums.filter((a) => (a.score ?? 0) > runningAvg).length
    return better + 1
  }, [runningAvg, ratedAlbums])

  function setDraftAt(i: number, text: string) {
    setDrafts((prev) => {
      const next = [...prev]
      next[i] = cleanScoreText(text)
      return next
    })
    if (skipped.has(i)) {
      setSkipped((prev) => {
        const next = new Set(prev)
        next.delete(i)
        return next
      })
    }
  }

  function advance() {
    Haptics.selectionAsync().catch(() => {})
    if (idx < sortedSongs.length - 1) setIdx(idx + 1)
    else setPhase(isEP ? 'factors' : 'factors')
  }

  function onNext() {
    if (parseScore(drafts[idx] ?? '') === null) return
    advance()
  }

  function onSkip() {
    setSkipped((prev) => new Set(prev).add(idx))
    setDrafts((prev) => {
      const next = [...prev]
      next[idx] = ''
      return next
    })
    advance()
  }

  function jumpTo(i: number) {
    setListOpen(false)
    setPhase('tracks')
    setIdx(i)
  }

  const persist = async (status: 'rated' | 'listening') => {
    if (!album) return
    await batchRateSongs(sortedSongs.map((song, i) => ({ id: song.id, score: scores[i] ?? null })), userId)
    const parsedExtra = extraArtists.split(',').map((s) => s.trim()).filter(Boolean)
    await updateAlbum(album.id, {
      ...(isEP
        ? {}
        : {
            theme: factorVals.theme,
            replay_value: factorVals.replay,
            production: factorVals.production,
            distinctness: factorVals.distinctness,
          }),
      status,
      extra_artists: parsedExtra.length ? JSON.stringify(parsedExtra) : null,
    })
  }

  const submit = useMutation({
    mutationFn: () => persist('rated'),
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
    mutationFn: () => persist(isEditing ? 'rated' : 'listening'),
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
  const song = sortedSongs[idx]
  const done = ratedIdx.length

  return (
    <View style={styles.root}>
      <AlbumBackdrop albumArtUrl={album.albumArtUrl} album={album.albumName} artist={album.artist} subtle />
      <SafeAreaView style={styles.screen} edges={['top']}>
        {/* Header: album identity + save draft */}
        <View style={styles.topBar}>
          <Pressable onPress={() => router.back()} hitSlop={10}>
            <ArrowLeft size={20} color={colors.inkSecondary} />
          </Pressable>
          {album.albumArtUrl ? (
            <Image source={{ uri: album.albumArtUrl }} style={styles.topArt} contentFit="cover" />
          ) : (
            <View style={[styles.topArt, styles.artFallback]}>
              <Text style={styles.artInitial}>{album.albumName[0]}</Text>
            </View>
          )}
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.topAlbum} numberOfLines={1}>{album.albumName}</Text>
            <Text style={styles.topArtist} numberOfLines={1}>{album.artist}</Text>
          </View>
          <Pressable onPress={() => saveDraft.mutate()} disabled={busy} hitSlop={10}>
            <Text style={styles.saveDraft}>{saveDraft.isPending ? 'Saving…' : 'Save draft'}</Text>
          </Pressable>
        </View>

        {/* Progress */}
        <View style={styles.progressRow}>
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${(done / Math.max(1, sortedSongs.length)) * 100}%` }]} />
          </View>
          <Text style={styles.progressText}>{done} / {sortedSongs.length}</Text>
        </View>

        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          {phase === 'tracks' && song ? (
            <>
              <Text style={styles.trackEyebrow}>TRACK {song.trackNumber ?? idx + 1}</Text>
              <Text style={styles.trackTitle}>{song.title}</Text>
              {runtime(song.durationMs) && <Text style={styles.trackMeta}>{runtime(song.durationMs)}</Text>}

              <ScoreField
                value={drafts[idx] ?? ''}
                onChange={(t) => setDraftAt(idx, t)}
                label={skipped.has(idx) ? 'SKIPPED' : 'YOUR SCORE'}
                autoFocus
              />
              <ScoreScale value={scores[idx]} />

              <View style={styles.actions}>
                <Pressable style={styles.listBtn} onPress={() => setListOpen(true)} accessibilityLabel="Jump to a track">
                  <ListMusic size={20} color={colors.inkSecondary} />
                </Pressable>
                <Pressable
                  style={({ pressed }) => [
                    styles.nextBtn,
                    parseScore(drafts[idx] ?? '') === null && styles.nextBtnOff,
                    pressed && { opacity: 0.9 },
                  ]}
                  onPress={onNext}
                  disabled={parseScore(drafts[idx] ?? '') === null}
                >
                  <Text style={styles.nextBtnText}>
                    {idx < sortedSongs.length - 1 ? 'Next track' : isEP ? 'Finish' : 'Rate the album'}
                  </Text>
                  <ArrowRight size={16} color="#fff" />
                </Pressable>
                <Pressable style={styles.skipBtn} onPress={onSkip}>
                  <Text style={styles.skipBtnText}>Skip</Text>
                </Pressable>
              </View>

              {/* Running average */}
              <View style={styles.runCard}>
                <View style={styles.runTop}>
                  <View>
                    <Text style={styles.runLabel}>RUNNING AVG</Text>
                    <Text style={styles.runValue}>{runningAvg != null ? runningAvg.toFixed(2) : '—'}</Text>
                  </View>
                  <View style={styles.runNotes}>
                    <Text style={styles.runNote}>{bangs} bang{bangs === 1 ? '' : 's'} · {skips} skip{skips === 1 ? '' : 's'}</Text>
                    {album.predictedScore != null && (
                      <Text style={styles.runNote}>predicted was {album.predictedScore.toFixed(2)}</Text>
                    )}
                    {pace != null && <Text style={styles.runNote}>on pace for a top-{pace} album</Text>}
                  </View>
                </View>
                <View style={styles.chipRow}>
                  {sortedSongs.map((s, i) => {
                    const v = scores[i]
                    return (
                      <View
                        key={s.id}
                        style={[
                          styles.chip,
                          { backgroundColor: v != null ? songScoreColor(v) : colors.inset },
                          i === idx && styles.chipCurrent,
                        ]}
                      />
                    )
                  })}
                </View>
              </View>

              {/* Up next */}
              {idx < sortedSongs.length - 1 && (
                <>
                  <Text style={styles.sectionLabel}>UP NEXT</Text>
                  {sortedSongs.slice(idx + 1, idx + 4).map((s) => (
                    <View key={s.id} style={styles.upRow}>
                      <Text style={styles.upNum}>{s.trackNumber}</Text>
                      <Text style={styles.upTitle} numberOfLines={1}>{s.title}</Text>
                      <Text style={styles.upLocked}>locked</Text>
                    </View>
                  ))}
                </>
              )}
            </>
          ) : (
            /* Factors */
            <>
              <Text style={styles.trackEyebrow}>THE ALBUM</Text>
              <Text style={styles.trackTitle}>{album.albumName}</Text>
              <Text style={styles.trackMeta}>
                {withScores.length} track{withScores.length === 1 ? '' : 's'} scored · avg{' '}
                {runningAvg != null ? runningAvg.toFixed(2) : '—'}
              </Text>

              {!songsComplete && (
                <Text style={styles.warn}>Every track needs a score or a skip before you can submit.</Text>
              )}

              {FACTORS.map(({ key, label, desc }) => (
                <View key={key} style={styles.factorRow}>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={styles.factorLabel}>{label}</Text>
                    <Text style={styles.factorDesc}>{desc}</Text>
                  </View>
                  <TextInput
                    style={styles.factorInput}
                    value={factorText[key]}
                    onChangeText={(t) => setFactorText((prev) => ({ ...prev, [key]: cleanScoreText(t) }))}
                    keyboardType="decimal-pad"
                    placeholder="—"
                    placeholderTextColor={colors.inkMuted}
                    maxLength={4}
                  />
                </View>
              ))}

              <Text style={styles.sectionLabel}>ADDITIONAL ARTISTS</Text>
              <TextInput
                style={styles.extraInput}
                value={extraArtists}
                onChangeText={setExtraArtists}
                placeholder="Comma-separated, e.g. Kanye West, Jay-Z"
                placeholderTextColor={colors.inkMuted}
                autoCapitalize="words"
              />

              {previewScore !== null && (
                <View style={styles.previewBlock}>
                  <Text style={[styles.previewScore, { color: colors.green }]}>{previewScore.toFixed(2)}</Text>
                  <Text style={styles.previewLabel}>PROJECTED FINAL</Text>
                </View>
              )}

              {error && <Text style={styles.error}>{error}</Text>}

              <Pressable
                style={[styles.submit, (!canSubmit || busy) && styles.submitOff]}
                onPress={() => submit.mutate()}
                disabled={!canSubmit || busy}
              >
                {submit.isPending ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <>
                    <Check size={16} color={canSubmit ? '#fff' : colors.inkMuted} />
                    <Text style={[styles.submitText, !canSubmit && { color: colors.inkMuted }]}>
                      {isEditing ? 'Update rating' : 'Submit rating'}
                    </Text>
                  </>
                )}
              </Pressable>

              <Pressable style={styles.backToTracks} onPress={() => { setPhase('tracks'); setIdx(0) }}>
                <Text style={styles.backToTracksText}>Back to tracks</Text>
              </Pressable>
            </>
          )}
        </ScrollView>

        <TrackSheet
          visible={listOpen}
          songs={sortedSongs}
          scores={scores}
          skipped={skipped}
          current={phase === 'tracks' ? idx : -1}
          onPick={jumpTo}
          onClose={() => setListOpen(false)}
        />
      </SafeAreaView>
    </View>
  )
}

/** The big typed score. The number itself is the input. */
function ScoreField({
  value,
  onChange,
  label,
  autoFocus,
}: {
  value: string
  onChange: (t: string) => void
  label: string
  autoFocus?: boolean
}) {
  const n = parseScore(value)
  return (
    <View style={styles.scoreWrap}>
      <TextInput
        style={[styles.scoreInput, { color: n != null ? songScoreColor(n) : colors.inkMuted }]}
        value={value}
        onChangeText={onChange}
        keyboardType="decimal-pad"
        placeholder="—"
        placeholderTextColor={colors.inkMuted}
        maxLength={4}
        autoFocus={autoFocus}
        selectTextOnFocus
        textAlign="center"
      />
      <Text style={styles.scoreLabel}>{label}</Text>
    </View>
  )
}

/** Read-only reference scale showing where a score lands. */
function ScoreScale({ value }: { value: number | null }) {
  const pct = value != null ? (Math.max(0, Math.min(10, value)) / 10) * 100 : null
  return (
    <View style={styles.scaleWrap}>
      <View style={styles.scaleTrack}>
        {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => (
          <View key={i} style={{ flex: 1, backgroundColor: songScoreColor(i + 0.5) }} />
        ))}
      </View>
      {pct != null && <View style={[styles.scaleMarker, { left: `${pct}%` }]} />}
      <View style={styles.scaleLabels}>
        <Text style={styles.scaleLabel}>0</Text>
        <Text style={styles.scaleLabel}>SKIP {SKIP_THRESHOLD.toFixed(1)}</Text>
        <Text style={styles.scaleLabel}>BANG {BANG_THRESHOLD.toFixed(1)}</Text>
        <Text style={styles.scaleLabel}>10</Text>
      </View>
    </View>
  )
}

function TrackSheet({
  visible,
  songs,
  scores,
  skipped,
  current,
  onPick,
  onClose,
}: {
  visible: boolean
  songs: Song[]
  scores: (number | null)[]
  skipped: Set<number>
  current: number
  onPick: (i: number) => void
  onClose: () => void
}) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet}>
          <View style={styles.sheetHead}>
            <Text style={styles.sheetTitle}>Tracks</Text>
            <Pressable onPress={onClose} hitSlop={10}><X size={20} color={colors.inkTertiary} /></Pressable>
          </View>
          <ScrollView style={{ maxHeight: 380 }}>
            {songs.map((s, i) => {
              const v = scores[i]
              const isSkipped = skipped.has(i)
              const visited = v != null || isSkipped
              return (
                <Pressable
                  key={s.id}
                  style={[styles.sheetRow, i === current && styles.sheetRowCurrent]}
                  onPress={() => (visited || i === current ? onPick(i) : null)}
                  disabled={!visited && i !== current}
                >
                  <Text style={styles.sheetNum}>{s.trackNumber}</Text>
                  <Text
                    style={[styles.sheetTrack, !visited && i !== current && styles.sheetTrackLocked]}
                    numberOfLines={1}
                  >
                    {s.title}
                  </Text>
                  {v != null ? (
                    <Text style={[styles.sheetScore, { color: songScoreColor(v) }]}>{v.toFixed(1)}</Text>
                  ) : isSkipped ? (
                    <Text style={styles.sheetMuted}>skipped</Text>
                  ) : i === current ? (
                    <Text style={styles.sheetCurrent}>now</Text>
                  ) : (
                    <Text style={styles.sheetMuted}>locked</Text>
                  )}
                </Pressable>
              )
            })}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  screen: { flex: 1, backgroundColor: 'transparent' },
  center: { alignItems: 'center', justifyContent: 'center' },

  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  topArt: { width: 38, height: 38, borderRadius: radii.sm },
  artFallback: { backgroundColor: colors.inset, alignItems: 'center', justifyContent: 'center' },
  artInitial: { fontFamily: fonts.display, fontSize: 18, color: colors.inkMuted },
  topAlbum: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.ink },
  topArtist: { fontFamily: fonts.body, fontSize: 12.5, color: colors.inkTertiary, marginTop: 1 },
  saveDraft: { fontFamily: fonts.bodySemiBold, fontSize: 14, color: colors.green },

  progressRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg, marginTop: 2 },
  progressTrack: { flex: 1, height: 6, borderRadius: 3, backgroundColor: colors.inset, overflow: 'hidden' },
  progressFill: { height: '100%', backgroundColor: colors.green, borderRadius: 3 },
  progressText: { fontFamily: fonts.bodyMedium, fontSize: 13, color: colors.inkTertiary },

  content: { paddingHorizontal: spacing.lg, paddingBottom: 60 },

  trackEyebrow: {
    fontFamily: fonts.bodyBold,
    fontSize: 11,
    letterSpacing: 1.6,
    color: colors.inkMuted,
    textAlign: 'center',
    marginTop: spacing.xl,
  },
  trackTitle: { fontFamily: fonts.displayBlack, fontSize: 32, color: colors.ink, textAlign: 'center', marginTop: 6 },
  trackMeta: { fontFamily: fonts.bodyMedium, fontSize: 14, color: colors.inkTertiary, textAlign: 'center', marginTop: 6 },

  scoreWrap: { alignItems: 'center', marginTop: spacing.xl },
  scoreInput: {
    fontFamily: fonts.display,
    fontSize: 72,
    lineHeight: 82,
    minWidth: 180,
    padding: 0,
  },
  scoreLabel: { fontFamily: fonts.bodyBold, fontSize: 11, letterSpacing: 1.6, color: colors.inkMuted, marginTop: -2 },

  scaleWrap: { marginTop: spacing.lg },
  scaleTrack: { flexDirection: 'row', height: 6, borderRadius: 3, overflow: 'hidden' },
  scaleMarker: {
    position: 'absolute',
    top: -5,
    marginLeft: -8,
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: '#fff',
    borderWidth: 2.5,
    borderColor: colors.green,
  },
  scaleLabels: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 8 },
  scaleLabel: { fontFamily: fonts.bodyMedium, fontSize: 10, color: colors.inkMuted },

  actions: { flexDirection: 'row', alignItems: 'stretch', gap: spacing.sm, marginTop: spacing.xl },
  nextBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: colors.green,
    borderRadius: radii.md,
    paddingVertical: 16,
  },
  nextBtnOff: { backgroundColor: colors.inkMuted },
  nextBtnText: { fontFamily: fonts.bodySemiBold, fontSize: 16, color: '#fff' },
  skipBtn: {
    justifyContent: 'center',
    paddingHorizontal: 22,
    backgroundColor: colors.raised,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  skipBtnText: { fontFamily: fonts.bodySemiBold, fontSize: 15, color: colors.inkSecondary },
  listBtn: {
    justifyContent: 'center',
    alignItems: 'center',
    width: 52,
    backgroundColor: colors.raised,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
  },

  runCard: {
    backgroundColor: 'rgba(45,106,79,0.07)',
    borderRadius: radii.lg,
    padding: spacing.lg,
    marginTop: spacing.xl,
  },
  runTop: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  runLabel: { fontFamily: fonts.bodyBold, fontSize: 11, letterSpacing: 1.2, color: colors.green },
  runValue: { fontFamily: fonts.display, fontSize: 34, color: colors.green, marginTop: 2 },
  runNotes: { alignItems: 'flex-end', gap: 2 },
  runNote: { fontFamily: fonts.body, fontSize: 12.5, color: colors.inkSecondary },
  chipRow: { flexDirection: 'row', gap: 4, marginTop: spacing.md },
  chip: { flex: 1, height: 28, borderRadius: 5 },
  chipCurrent: { borderWidth: 2, borderColor: colors.ink },

  sectionLabel: {
    fontFamily: fonts.bodyBold,
    fontSize: 11,
    letterSpacing: 1.2,
    color: colors.inkMuted,
    marginTop: spacing.xl,
    marginBottom: spacing.xs,
  },
  upRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  upNum: { fontFamily: fonts.body, fontSize: 12, color: colors.inkMuted, width: 18 },
  upTitle: { flex: 1, fontFamily: fonts.bodyMedium, fontSize: 15, color: colors.inkTertiary },
  upLocked: { fontFamily: fonts.body, fontSize: 12, color: colors.inkMuted },

  warn: { fontFamily: fonts.body, fontSize: 13, color: '#b91c1c', textAlign: 'center', marginTop: spacing.md },

  factorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  factorLabel: { fontFamily: fonts.bodySemiBold, fontSize: 15, color: colors.ink },
  factorDesc: { fontFamily: fonts.body, fontSize: 12, color: colors.inkTertiary, marginTop: 2 },
  factorInput: {
    width: 72,
    textAlign: 'center',
    fontFamily: fonts.display,
    fontSize: 26,
    color: colors.ink,
    paddingVertical: 4,
    backgroundColor: colors.raised,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
  },

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

  previewBlock: { alignItems: 'center', marginTop: spacing.xl },
  previewScore: { fontFamily: fonts.display, fontSize: 52, lineHeight: 58 },
  previewLabel: { fontFamily: fonts.bodyBold, fontSize: 11, letterSpacing: 1.4, color: colors.inkMuted },

  error: { fontFamily: fonts.bodyMedium, fontSize: 13, color: '#b91c1c', textAlign: 'center', marginTop: spacing.md },
  submit: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.green,
    borderRadius: radii.md,
    paddingVertical: 16,
    marginTop: spacing.lg,
  },
  submitOff: { backgroundColor: colors.inset },
  submitText: { fontFamily: fonts.bodySemiBold, fontSize: 16, color: '#fff' },
  backToTracks: { alignSelf: 'center', marginTop: spacing.lg },
  backToTracksText: { fontFamily: fonts.bodySemiBold, fontSize: 14, color: colors.inkTertiary },

  backdrop: { flex: 1, backgroundColor: 'rgba(28,25,23,0.4)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.bg,
    borderTopLeftRadius: radii.xl,
    borderTopRightRadius: radii.xl,
    paddingTop: spacing.lg,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xxl,
  },
  sheetHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.sm },
  sheetTitle: { fontFamily: fonts.bodySemiBold, fontSize: 16, color: colors.ink },
  sheetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  sheetRowCurrent: { backgroundColor: colors.greenSoft, borderRadius: radii.sm, paddingHorizontal: spacing.sm },
  sheetNum: { fontFamily: fonts.body, fontSize: 12, color: colors.inkMuted, width: 20 },
  sheetTrack: { flex: 1, fontFamily: fonts.bodyMedium, fontSize: 15, color: colors.ink },
  sheetTrackLocked: { color: colors.inkMuted },
  sheetScore: { fontFamily: fonts.bodyBold, fontSize: 15 },
  sheetMuted: { fontFamily: fonts.body, fontSize: 12, color: colors.inkMuted },
  sheetCurrent: { fontFamily: fonts.bodySemiBold, fontSize: 12, color: colors.green },
})
