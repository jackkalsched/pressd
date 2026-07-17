// For You — the home feed: "pick up where you left off", a "rate this next"
// recommendation from the queue, new & popular releases, and userbase-wide
// trending. Mirrors the website's For You page, mobile-first.
import { useMemo, useState } from 'react'
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useQuery } from '@tanstack/react-query'
import { Image } from 'expo-image'
import { useRouter } from 'expo-router'
import { ArrowRight } from 'lucide-react-native'
import {
  fetchAlbums,
  fetchNewReleases,
  fetchTrending,
  resolveDeezerAlbum,
  importAlbum,
  type NewRelease,
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

export default function ForYou() {
  const router = useRouter()
  const { user } = useAuth()
  const userId = user?.id ?? 0
  const [importingId, setImportingId] = useState<number | null>(null)
  const [refreshing, setRefreshing] = useState(false)

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
    queryKey: ['discover', 'trending', 'week'],
    queryFn: () => fetchTrending('week', 8),
  })

  async function onRefresh() {
    setRefreshing(true)
    await Promise.all([refetchListening(), refetchToListen(), refetchNew(), refetchTrending()])
    setRefreshing(false)
  }

  // Pick up where you left off: most recently added in-progress album.
  const continueAlbum = useMemo(() => {
    if (listening.length === 0) return null
    return [...listening].sort((a, b) => (b.dateAdded ?? '').localeCompare(a.dateAdded ?? ''))[0]
  }, [listening])

  // Rate this next: a friend-recommended album first, else next in the queue.
  const suggestion = useMemo(() => {
    if (toListen.length === 0) return null
    return toListen.find((a) => a.recommendedByName) ?? toListen[0]
  }, [toListen])

  const today = new Date()
    .toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
    .toUpperCase()

  async function openNewRelease(r: NewRelease) {
    if (importingId || !user) return
    setImportingId(r.deezerId)
    try {
      const full = await resolveDeezerAlbum(r.deezerId)
      const album = await importAlbum(full, 'listening', user.id)
      router.push({ pathname: '/rate/[id]', params: { id: String(album.id) } })
    } catch {
      /* ignore — leave the card in place */
    } finally {
      setImportingId(null)
    }
  }

  function openAlbum(id: number) {
    router.push({ pathname: '/album/[id]', params: { id: String(id) } })
  }

  const firstName = user?.name?.split(' ')[0] ?? ''

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.green} />
        }
      >
        <Text style={styles.date}>{today}</Text>
        <Text style={styles.title}>For You</Text>
        <Text style={styles.sub}>
          {greeting()}{firstName ? ` ${firstName},` : ''} here's what's moving this week.
        </Text>

        {/* Continue */}
        {continueAlbum && (
          <Pressable
            style={({ pressed }) => [styles.continueCard, pressed && { opacity: 0.85 }]}
            onPress={() => router.push({ pathname: '/rate/[id]', params: { id: String(continueAlbum.id) } })}
          >
            {continueAlbum.albumArtUrl ? (
              <Image source={{ uri: continueAlbum.albumArtUrl }} style={styles.continueArt} contentFit="cover" />
            ) : (
              <View style={[styles.continueArt, styles.artFallback]}>
                <Text style={styles.artInitial}>{continueAlbum.albumName[0]}</Text>
              </View>
            )}
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={styles.continueLabel}>PICK UP WHERE YOU LEFT OFF</Text>
              <Text style={styles.continueName} numberOfLines={1}>{continueAlbum.albumName}</Text>
              <Text style={styles.continueProgress}>
                {continueAlbum.songs.filter((s) => s.score != null).length} / {continueAlbum.songs.length} tracks scored
              </Text>
            </View>
          </Pressable>
        )}

        {/* Rate this next — a recommendation from the To Listen queue */}
        {suggestion && (
          <>
            <Text style={styles.sectionLabel}>RATE THIS NEXT</Text>
            <View style={styles.suggestCard}>
              <View style={styles.suggestTop}>
                {suggestion.albumArtUrl ? (
                  <Image source={{ uri: suggestion.albumArtUrl }} style={styles.suggestArt} contentFit="cover" />
                ) : (
                  <View style={[styles.suggestArt, styles.artFallback]}>
                    <Text style={styles.artInitial}>{suggestion.albumName[0]}</Text>
                  </View>
                )}
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={styles.suggestName} numberOfLines={1}>{suggestion.albumName}</Text>
                  <Text style={styles.suggestArtist} numberOfLines={1}>
                    {suggestion.artist}{suggestion.year ? ` · ${suggestion.year}` : ''}
                  </Text>
                  <Text style={styles.suggestWhy} numberOfLines={2}>
                    {suggestion.recommendedByName
                      ? `Recommended by ${suggestion.recommendedByName}`
                      : suggestion.predictedScore != null
                      ? `We think you'll rate this ~${suggestion.predictedScore.toFixed(2)}`
                      : 'Next up in your queue'}
                  </Text>
                </View>
                {suggestion.predictedScore != null && (
                  <View style={styles.predictBadge}>
                    <Text style={[styles.predictScore, { color: songScoreColor(suggestion.predictedScore) }]}>
                      {suggestion.predictedScore.toFixed(2)}
                    </Text>
                    <Text style={styles.predictLabel}>PREDICTED</Text>
                  </View>
                )}
              </View>
              <Pressable
                style={({ pressed }) => [styles.suggestBtn, pressed && { backgroundColor: colors.greenPressed }]}
                onPress={() => router.push({ pathname: '/rate/[id]', params: { id: String(suggestion.id) } })}
              >
                <Text style={styles.suggestBtnText}>Start rating</Text>
                <ArrowRight size={15} color="#fff" />
              </Pressable>
            </View>
          </>
        )}

        {/* New & Popular */}
        {newReleases.length > 0 && (
          <>
            <Text style={styles.sectionLabel}>NEW & POPULAR</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.hscroll}>
              {newReleases.map((r) => (
                <Pressable
                  key={r.deezerId}
                  style={styles.releaseCard}
                  onPress={() => openNewRelease(r)}
                  disabled={!!importingId}
                >
                  <View>
                    {r.coverUrl ? (
                      <Image source={{ uri: r.coverUrl }} style={styles.releaseArt} contentFit="cover" />
                    ) : (
                      <View style={[styles.releaseArt, styles.artFallback]}>
                        <Text style={styles.artInitial}>{r.albumName[0]}</Text>
                      </View>
                    )}
                    {importingId === r.deezerId && (
                      <View style={styles.releaseBusy}>
                        <ActivityIndicator color="#fff" />
                      </View>
                    )}
                  </View>
                  <Text style={styles.releaseName} numberOfLines={1}>{r.albumName}</Text>
                  <Text style={styles.releaseArtist} numberOfLines={1}>{r.artist}</Text>
                </Pressable>
              ))}
            </ScrollView>
          </>
        )}

        {/* Trending */}
        {trending.length > 0 && (
          <>
            <Text style={styles.sectionLabel}>TRENDING THIS WEEK</Text>
            <View style={styles.card}>
              {trending.map((t, i) => (
                <Pressable
                  key={t.album_id}
                  style={[styles.row, i > 0 && styles.rowBorder]}
                  onPress={() => openAlbum(t.album_id)}
                >
                  <Text style={styles.rank}>{i + 1}</Text>
                  {t.album_art_url ? (
                    <Image source={{ uri: t.album_art_url }} style={styles.rowArt} contentFit="cover" />
                  ) : (
                    <View style={[styles.rowArt, { backgroundColor: colors.inset }]} />
                  )}
                  <View style={styles.rowText}>
                    <Text style={styles.rowName} numberOfLines={1}>{t.album_name}</Text>
                    <Text style={styles.rowArtist} numberOfLines={1}>{t.artist}</Text>
                  </View>
                  {t.avg_score != null && (
                    <View style={[styles.scoreChip, { backgroundColor: scoreTint(t.avg_score) }]}>
                      <Text style={[styles.scoreText, { color: songScoreColor(t.avg_score) }]}>
                        {t.avg_score.toFixed(2)}
                      </Text>
                    </View>
                  )}
                </Pressable>
              ))}
            </View>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: spacing.lg, paddingBottom: 120 },
  date: { fontFamily: fonts.bodyBold, fontSize: 11, letterSpacing: 1.2, color: colors.inkMuted, marginTop: spacing.lg },
  title: { fontFamily: fonts.display, fontSize: 38, color: colors.ink, letterSpacing: 1, marginTop: 2 },
  sub: { fontFamily: fonts.bodyMedium, fontSize: 14, color: colors.inkTertiary, marginTop: 4 },

  continueCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.raised,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginTop: spacing.md,
  },
  continueArt: { width: 56, height: 56, borderRadius: radii.sm },
  continueLabel: { fontFamily: fonts.bodyBold, fontSize: 10, letterSpacing: 1, color: colors.green },
  continueName: { fontFamily: fonts.bodySemiBold, fontSize: 16, color: colors.ink, marginTop: 2 },
  continueProgress: { fontFamily: fonts.body, fontSize: 12, color: colors.inkTertiary, marginTop: 2 },

  suggestCard: {
    backgroundColor: colors.raised,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
  },
  suggestTop: { flexDirection: 'row', gap: spacing.md, alignItems: 'center' },
  suggestArt: { width: 60, height: 60, borderRadius: radii.md },
  suggestName: { fontFamily: fonts.bodySemiBold, fontSize: 16, color: colors.ink },
  suggestArtist: { fontFamily: fonts.body, fontSize: 13, color: colors.inkTertiary, marginTop: 1 },
  suggestWhy: { fontFamily: fonts.body, fontSize: 12, color: colors.inkMuted, fontStyle: 'italic', marginTop: 5 },
  predictBadge: { alignItems: 'center', minWidth: 52 },
  predictScore: { fontFamily: fonts.bodyBold, fontSize: 22 },
  predictLabel: { fontFamily: fonts.bodyBold, fontSize: 8, letterSpacing: 0.8, color: colors.inkMuted, marginTop: 1 },
  suggestBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: colors.green,
    borderRadius: radii.md,
    paddingVertical: 12,
    marginTop: spacing.md,
  },
  suggestBtnText: { fontFamily: fonts.bodySemiBold, fontSize: 14, color: '#fff' },

  sectionLabel: {
    fontFamily: fonts.bodyBold,
    fontSize: 11,
    letterSpacing: 1.2,
    color: colors.inkMuted,
    marginTop: spacing.xl,
    marginBottom: spacing.sm,
  },
  hscroll: { marginHorizontal: -spacing.lg, paddingHorizontal: spacing.lg },
  releaseCard: { width: 124, marginRight: spacing.md },
  releaseArt: { width: 124, height: 124, borderRadius: radii.md },
  releaseBusy: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(28,25,23,0.4)',
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  releaseName: { fontFamily: fonts.bodySemiBold, fontSize: 13, color: colors.ink, marginTop: 6 },
  releaseArtist: { fontFamily: fonts.body, fontSize: 12, color: colors.inkTertiary, marginTop: 1 },

  card: {
    backgroundColor: colors.raised,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
  },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.md, gap: spacing.md },
  rowBorder: { borderTopWidth: 1, borderTopColor: colors.border },
  rank: { fontFamily: fonts.bodyMedium, fontSize: 14, color: colors.inkMuted, width: 14, textAlign: 'center' },
  rowArt: { width: 44, height: 44, borderRadius: radii.sm },
  rowText: { flex: 1, minWidth: 0 },
  rowName: { fontFamily: fonts.bodySemiBold, fontSize: 15, color: colors.ink },
  rowArtist: { fontFamily: fonts.body, fontSize: 13, color: colors.inkTertiary, marginTop: 1 },
  scoreChip: { borderRadius: radii.sm, paddingHorizontal: 8, paddingVertical: 4, minWidth: 44, alignItems: 'center' },
  scoreText: { fontFamily: fonts.bodyBold, fontSize: 14 },

  artFallback: { backgroundColor: colors.inset, alignItems: 'center', justifyContent: 'center' },
  artInitial: { fontFamily: fonts.display, fontSize: 24, color: colors.inkMuted },
})
