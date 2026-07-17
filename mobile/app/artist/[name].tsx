// Artist page — per-artist stats scoped to a user: headline metrics (wSong+,
// avg song score, bang/skip), the song-score histogram + KDE, and the artist's
// albums. Mirrors the website ArtistPage.
import { ActivityIndicator, Dimensions, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useQuery } from '@tanstack/react-query'
import { Image } from 'expo-image'
import { ArrowLeft } from 'lucide-react-native'
import { fetchArtistDetail } from '../../lib/api'
import { songScoreColor } from '@pressd/shared/types'
import { useAuth } from '../../lib/auth'
import ArtistChart from '../../components/ArtistChart'
import { colors, fonts, radii, spacing } from '../../theme/tokens'

const CHART_W = Dimensions.get('window').width - spacing.lg * 2 - spacing.lg * 2

export default function ArtistPage() {
  const { name } = useLocalSearchParams<{ name: string }>()
  const artist = decodeURIComponent(name ?? '')
  const router = useRouter()
  const { user } = useAuth()

  const { data, isLoading } = useQuery({
    queryKey: ['artist', artist, user?.id],
    queryFn: () => fetchArtistDetail(artist, user!.id),
    enabled: !!user && !!artist,
  })

  if (isLoading || !data) {
    return (
      <SafeAreaView style={[styles.screen, styles.center]}>
        <ActivityIndicator color={colors.green} />
      </SafeAreaView>
    )
  }

  const fmt = (v: number | null, d = 1) => (v != null ? v.toFixed(d) : '—')
  const pct = (v: number | null) => (v != null ? `${Math.round(v * 100)}%` : '—')

  const metrics: { label: string; value: string; hint?: string }[] = [
    { label: 'wSong+', value: fmt(data.w_song_plus, 1) },
    { label: 'Avg song', value: fmt(data.avg_song_score, 2) },
    { label: 'Avg external', value: fmt(data.avg_external, 2) },
    { label: 'Bang %', value: pct(data.bang_pct) },
    { label: 'Skip %', value: pct(data.skip_pct) },
    { label: 'Consistency+', value: fmt(data.consistency_plus, 0) },
  ]

  const albums = [...data.albums].sort((a, b) => (b.score ?? 0) - (a.score ?? 0))

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.topBar}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={styles.backBtn}>
          <ArrowLeft size={18} color={colors.inkSecondary} />
          <Text style={styles.backText}>Back</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.artist}>{data.artist}</Text>
        <Text style={styles.sub}>
          {data.song_count} songs · {data.album_count} album{data.album_count === 1 ? '' : 's'}
          {data.small_sample ? ' · small sample' : ''}
        </Text>

        {data.song_score_rank != null && (
          <Text style={styles.rank}>
            #{data.song_score_rank} of {data.song_score_rank_of} by avg song score
          </Text>
        )}

        {/* Metrics grid */}
        <View style={styles.metrics}>
          {metrics.map((m) => (
            <View key={m.label} style={styles.metricCell}>
              <Text style={styles.metricValue}>{m.value}</Text>
              <Text style={styles.metricLabel}>{m.label}</Text>
            </View>
          ))}
        </View>

        {/* Distribution */}
        {data.song_scores.length > 0 && (
          <View style={styles.chartCard}>
            <ArtistChart scores={data.song_scores} width={CHART_W} />
          </View>
        )}

        {/* Albums */}
        <Text style={styles.sectionLabel}>ALBUMS</Text>
        {albums.map((a) => (
          <Pressable
            key={a.id}
            style={styles.albumRow}
            onPress={() => router.push({ pathname: '/album/[id]', params: { id: String(a.id) } })}
          >
            {a.album_art_url ? (
              <Image source={{ uri: a.album_art_url }} style={styles.albumArt} contentFit="cover" />
            ) : (
              <View style={[styles.albumArt, styles.artFallback]}>
                <Text style={styles.artInitial}>{a.album_name[0]}</Text>
              </View>
            )}
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={styles.albumName} numberOfLines={1}>{a.album_name}</Text>
              <Text style={styles.albumMeta} numberOfLines={1}>
                {a.year ?? ''}{a.is_ep ? ' · EP' : ''}{a.status !== 'rated' ? ' · unrated' : ''}
              </Text>
            </View>
            {a.score != null && (
              <Text style={[styles.albumScore, { color: songScoreColor(a.score) }]}>
                {a.score.toFixed(2)}
              </Text>
            )}
          </Pressable>
        ))}
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  center: { alignItems: 'center', justifyContent: 'center' },
  topBar: { paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  backBtn: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  backText: { fontFamily: fonts.bodyMedium, fontSize: 15, color: colors.inkSecondary },
  content: { paddingHorizontal: spacing.lg, paddingBottom: 60 },

  artist: { fontFamily: fonts.display, fontSize: 32, color: colors.ink, marginTop: spacing.sm },
  sub: { fontFamily: fonts.bodyMedium, fontSize: 14, color: colors.inkTertiary, marginTop: 4 },
  rank: { fontFamily: fonts.body, fontSize: 13, color: colors.green, marginTop: 4 },

  metrics: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: spacing.lg,
    backgroundColor: colors.raised,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: spacing.sm,
  },
  metricCell: { width: '33.33%', alignItems: 'center', paddingVertical: spacing.md },
  metricValue: { fontFamily: fonts.bodyBold, fontSize: 20, color: colors.ink },
  metricLabel: { fontFamily: fonts.bodyMedium, fontSize: 11, color: colors.inkTertiary, marginTop: 2 },

  chartCard: {
    marginTop: spacing.lg,
    backgroundColor: colors.raised,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
  },

  sectionLabel: {
    fontFamily: fonts.bodyBold,
    fontSize: 11,
    letterSpacing: 1.2,
    color: colors.inkMuted,
    marginTop: spacing.xl,
    marginBottom: spacing.sm,
  },
  albumRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.sm },
  albumArt: { width: 48, height: 48, borderRadius: radii.sm },
  artFallback: { backgroundColor: colors.inset, alignItems: 'center', justifyContent: 'center' },
  artInitial: { fontFamily: fonts.display, fontSize: 20, color: colors.inkMuted },
  albumName: { fontFamily: fonts.bodySemiBold, fontSize: 15, color: colors.ink },
  albumMeta: { fontFamily: fonts.body, fontSize: 13, color: colors.inkTertiary, marginTop: 1 },
  albumScore: { fontFamily: fonts.bodyBold, fontSize: 17 },
})
