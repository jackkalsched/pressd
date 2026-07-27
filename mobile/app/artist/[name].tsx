// Artist page — per-artist stats scoped to a user: headline metrics (wSong+,
// avg song score, bang/skip), the song-score histogram + KDE, and the artist's
// albums. Mirrors the website ArtistPage.
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useQuery } from '@tanstack/react-query'
import { Image } from 'expo-image'
import { ArrowLeft } from 'lucide-react-native'
import { fetchArtistDetail, type ArtistDetail } from '../../lib/api'
import { songScoreColor } from '@pressd/shared/types'
import { useAuth } from '../../lib/auth'
import ScoreHistogram from '../../components/ScoreHistogram'
import { colors, fonts, radii, spacing } from '../../theme/tokens'

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

  const fmt2 = (v: number | null) => (v != null ? v.toFixed(2) : '—')
  const plus = (v: number | null) => (v != null ? String(Math.round(v)) : '—')
  const pctv = (v: number | null) => (v != null ? `${(v * 100).toFixed(1)}%` : '—')

  const albums = [...data.albums].sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
  const p = data.percentiles


  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.topBar}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={styles.backBtn}>
          <ArrowLeft size={18} color={colors.inkSecondary} />
          <Text style={styles.backText}>Back</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {/* Header: identity left, overlapping rated-album strip in the top-right */}
        <View style={styles.header}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.artist}>{data.artist}</Text>
            <Text style={styles.sub}>
              {data.song_count} songs · {data.album_count} album{data.album_count === 1 ? '' : 's'}
              {data.small_sample ? ' · small sample' : ''}
            </Text>
            <Text style={styles.rank}>
              {[
                data.song_plus_rank != null && `Song+ #${data.song_plus_rank}/${data.song_plus_rank_of}`,
                data.w_song_plus_rank != null && `wSong+ #${data.w_song_plus_rank}/${data.w_song_plus_rank_of}`,
              ]
                .filter(Boolean)
                .join('   ·   ')}
            </Text>
          </View>
          <ArtStrip
            albums={data.albums}
            onOpen={(id) => router.push({ pathname: '/album/[id]', params: { id: String(id) } })}
          />
        </View>

        {/* Percentile rankings — savant-style bars (replaces the metric cells) */}
        <Text style={styles.sectionLabel}>PERCENTILE RANKINGS</Text>
        <View style={styles.pctScaleRow}>
          <View style={styles.pctLabelSpacer} />
          <View style={styles.pctScale}>
            <Text style={[styles.pctScaleText, { color: barColor(0) }]}>▲{'\n'}POOR</Text>
            <Text style={[styles.pctScaleText, { color: barColor(50) }]}>▲{'\n'}AVG</Text>
            <Text style={[styles.pctScaleText, { color: barColor(100) }]}>▲{'\n'}GREAT</Text>
          </View>
          <View style={styles.pctValueSpacer} />
        </View>
        <PercentileBar label="Avg Song"     value={fmt2(data.avg_song_score)}   percentile={p.avg_song_score}   smallSample={data.small_sample} />
        <PercentileBar label="Song+"        value={plus(data.song_plus)}        percentile={p.song_plus}        smallSample={data.small_sample} />
        <PercentileBar label="wSong+"       value={plus(data.w_song_plus)}      percentile={p.w_song_plus}      smallSample={data.small_sample} />
        <PercentileBar label="Avg External" value={fmt2(data.avg_external)}      percentile={p.avg_external}     smallSample={data.small_sample} />
        <PercentileBar label="Bang%"        value={pctv(data.bang_pct)}         percentile={p.bang_pct}         smallSample={data.small_sample} />
        <PercentileBar label="Skip%"        value={pctv(data.skip_pct)}         percentile={p.skip_pct}         smallSample={data.small_sample} invert />
        <PercentileBar label="Consistency+" value={plus(data.consistency_plus)} percentile={p.consistency_plus} smallSample={data.small_sample} />

        {/* Distribution — same histogram as Profile → Stats */}
        {data.song_scores.length > 0 && (
          <>
            <Text style={styles.sectionLabel}>SCORE DISTRIBUTION</Text>
            <ScoreHistogram scores={data.song_scores} />
          </>
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

// Continuous red→green gradient, matching the desktop PercentileBar.
function barColor(pct: number): string {
  const hue = Math.round(pct * 1.3) // 0 → red, 100 → forest green
  return `hsl(${hue}, 65%, 28%)`
}

// One savant-style percentile bar: a track with a colored fill and a numbered
// badge sitting at the percentile. `invert` flips the reading (low Skip% good).
function PercentileBar({
  label,
  value,
  percentile,
  invert = false,
  smallSample = false,
}: {
  label: string
  value: string
  percentile: number | null
  invert?: boolean
  smallSample?: boolean
}) {
  const display = percentile != null ? (invert ? 100 - percentile : percentile) : null
  const color = display != null ? barColor(display) : '#ccc'
  const badgePct = display != null ? Math.max(3, Math.min(97, display)) : 50

  return (
    <View style={styles.pctRow}>
      <Text style={styles.pctLabel} numberOfLines={2}>{label}</Text>
      <View style={styles.pctTrack}>
        {display != null ? (
          <>
            <View
              style={[styles.pctFill, { width: `${display}%`, backgroundColor: color, opacity: smallSample ? 0.5 : 0.75 }]}
            />
            <View
              style={[styles.pctBadge, { left: `${badgePct}%`, backgroundColor: color, opacity: smallSample ? 0.7 : 1 }]}
            >
              <Text style={styles.pctBadgeText}>{Math.round(display)}</Text>
            </View>
          </>
        ) : (
          <Text style={styles.pctDash}>—</Text>
        )}
      </View>
      <Text style={[styles.pctValue, smallSample && styles.pctValueSmall]}>{value}</Text>
    </View>
  )
}

// Overlapping strip of the artist's rated album covers, tucked in the header's
// top-right (mirrors the desktop header montage).
function ArtStrip({ albums, onOpen }: { albums: ArtistDetail['albums']; onOpen: (id: number) => void }) {
  const shown = albums.filter((a) => a.status === 'rated' && a.album_art_url).slice(0, 6)
  if (shown.length === 0) return null
  return (
    <View style={styles.strip}>
      {shown.map((a, i) => (
        <Pressable
          key={a.id}
          onPress={() => onOpen(a.id)}
          style={[styles.stripItem, { marginLeft: i === 0 ? 0 : -12, zIndex: shown.length - i }]}
        >
          <Image source={{ uri: a.album_art_url! }} style={styles.stripImg} contentFit="cover" />
        </Pressable>
      ))}
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  center: { alignItems: 'center', justifyContent: 'center' },
  topBar: { paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  backBtn: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  backText: { fontFamily: fonts.bodyMedium, fontSize: 15, color: colors.inkSecondary },
  content: { paddingHorizontal: spacing.lg, paddingBottom: 60 },

  header: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md, marginTop: spacing.sm },
  artist: { fontFamily: fonts.display, fontSize: 32, color: colors.ink },
  sub: { fontFamily: fonts.bodyMedium, fontSize: 14, color: colors.inkTertiary, marginTop: 4 },
  rank: { fontFamily: fonts.body, fontSize: 13, color: colors.green, marginTop: 4 },

  strip: { flexDirection: 'row', flexShrink: 0, paddingTop: 4 },
  stripItem: {
    width: 36,
    height: 36,
    borderRadius: radii.md,
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: colors.bg,
  },
  stripImg: { width: '100%', height: '100%' },

  // Percentile (savant) bars
  pctScaleRow: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm, marginBottom: 2 },
  pctLabelSpacer: { width: 84 },
  pctValueSpacer: { width: 46 },
  pctScale: { flex: 1, flexDirection: 'row', justifyContent: 'space-between' },
  pctScaleText: { fontFamily: fonts.bodyBold, fontSize: 8, lineHeight: 10, letterSpacing: 0.4, textAlign: 'center' },
  pctRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 7 },
  pctLabel: { width: 84, textAlign: 'right', fontFamily: fonts.bodyMedium, fontSize: 11, lineHeight: 13, color: colors.inkMuted },
  pctTrack: { flex: 1, height: 14, borderRadius: 7, backgroundColor: colors.inset, position: 'relative', justifyContent: 'center' },
  pctFill: { position: 'absolute', left: 0, top: 0, bottom: 0, borderRadius: 7 },
  pctBadge: {
    position: 'absolute',
    top: '50%',
    marginTop: -11,
    marginLeft: -11,
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
  },
  pctBadgeText: { fontFamily: fonts.bodyBold, fontSize: 9, color: '#ffffff' },
  pctDash: { textAlign: 'center', color: colors.inkMuted, fontSize: 10 },
  pctValue: { width: 46, textAlign: 'right', fontFamily: fonts.bodySemiBold, fontSize: 12, color: colors.ink },
  pctValueSmall: { color: colors.inkMuted },

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
