// For You — the home feed: a streak banner, "pick up where you left off",
// new & popular releases, and userbase-wide trending. Mirrors the website's
// For You page, mobile-first.
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
import { Flame } from 'lucide-react-native'
import {
  fetchAlbums,
  fetchNewReleases,
  fetchTrending,
  resolveDeezerAlbum,
  importAlbum,
  type NewRelease,
} from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { colors, fonts, radii, spacing } from '../../theme/tokens'

function greeting(): string {
  const h = new Date().getHours()
  if (h < 12) return 'Good morning.'
  if (h < 18) return 'Good afternoon.'
  return 'Good evening.'
}

// Monday-based start of the week (ms) for streak counting.
function weekStart(d: Date): number {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  const day = (x.getDay() + 6) % 7 // Mon=0
  x.setDate(x.getDate() - day)
  return x.getTime()
}

export default function ForYou() {
  const router = useRouter()
  const { user } = useAuth()
  const userId = user?.id ?? 0
  const [importingId, setImportingId] = useState<number | null>(null)

  const { data: rated = [], refetch: refetchRated, isRefetching } = useQuery({
    queryKey: ['albums', 'rated', userId],
    queryFn: () => fetchAlbums({ status: 'rated', userId }),
    enabled: userId > 0,
  })
  const { data: listening = [] } = useQuery({
    queryKey: ['albums', 'listening', userId],
    queryFn: () => fetchAlbums({ status: 'listening', userId }),
    enabled: userId > 0,
  })
  const { data: newReleases = [] } = useQuery({
    queryKey: ['new-releases'],
    queryFn: () => fetchNewReleases(12),
  })
  const { data: trending = [] } = useQuery({
    queryKey: ['discover', 'trending', 'week'],
    queryFn: () => fetchTrending('week', 8),
  })

  // Streak: consecutive weeks (incl. this one) with ≥1 rating + last-7-days count.
  const { weeks, thisWeek } = useMemo(() => {
    const days = rated
      .map((a) => a.dateRated)
      .filter((d): d is string => !!d)
      .map((d) => new Date(d))
    const weekSet = new Set(days.map((d) => weekStart(d)))
    let w = 0
    let cur = weekStart(new Date())
    while (weekSet.has(cur)) {
      w += 1
      cur = weekStart(new Date(cur - 7 * 86_400_000))
    }
    const weekAgo = Date.now() - 7 * 86_400_000
    const recent = days.filter((d) => d.getTime() >= weekAgo).length
    return { weeks: w, thisWeek: recent }
  }, [rated])

  // Pick up where you left off: most recently added in-progress album.
  const continueAlbum = useMemo(() => {
    if (listening.length === 0) return null
    return [...listening].sort((a, b) => (b.dateAdded ?? '').localeCompare(a.dateAdded ?? ''))[0]
  }, [listening])

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
          <RefreshControl refreshing={isRefetching} onRefresh={refetchRated} tintColor={colors.green} />
        }
      >
        <Text style={styles.date}>{today}</Text>
        <Text style={styles.title}>For You</Text>
        <Text style={styles.sub}>
          {greeting()}{firstName ? ` ${firstName},` : ''} here's what's moving this week.
        </Text>

        {/* Streak banner */}
        <View style={styles.streak}>
          <Flame size={26} color="#f5b301" />
          <View style={{ flex: 1 }}>
            <Text style={styles.streakBig}>
              {weeks} week{weeks === 1 ? '' : 's'} streak
            </Text>
            <Text style={styles.streakSub}>
              {thisWeek} album{thisWeek === 1 ? '' : 's'} rated in the last 7 days
            </Text>
          </View>
        </View>

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
                    <View style={styles.scoreChip}>
                      <Text style={styles.scoreText}>{t.avg_score.toFixed(1)}</Text>
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

  streak: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.green,
    borderRadius: radii.lg,
    padding: spacing.lg,
    marginTop: spacing.lg,
  },
  streakBig: { fontFamily: fonts.bodyBold, fontSize: 18, color: '#fff' },
  streakSub: { fontFamily: fonts.body, fontSize: 13, color: 'rgba(255,255,255,0.85)', marginTop: 2 },

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
  scoreChip: { backgroundColor: colors.greenSoft, borderRadius: radii.sm, paddingHorizontal: 8, paddingVertical: 4 },
  scoreText: { fontFamily: fonts.bodyBold, fontSize: 14, color: colors.green },

  artFallback: { backgroundColor: colors.inset, alignItems: 'center', justifyContent: 'center' },
  artInitial: { fontFamily: fonts.display, fontSize: 24, color: colors.inkMuted },
})
