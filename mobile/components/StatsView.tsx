// Stats — the Profile "Stats" sub-tab, magazine-dashboard style:
//   1. headline card (songs / avg song / perfect 10s / avg year)
//   2. Bang% + Skip% cards with big serif numbers and progress bars
//   3. song score distribution histogram (1–10, red→green)
//   4. genres as horizontal count bars
// plus the most-rated artists list linking into artist pages.
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native'
import { useQuery } from '@tanstack/react-query'
import { useRouter } from 'expo-router'
import { fetchArtistStats, fetchGenreStats, fetchSongs } from '../lib/api'
import { songScoreColor, BANG_THRESHOLD, SKIP_THRESHOLD } from '@pressd/shared/types'
import { colors, fonts, spacing } from '../theme/tokens'

const RED = '#c0392b'
const CHART_H = 120

export default function StatsView({ userId }: { userId: number }) {
  const router = useRouter()
  const { data: artists = [], isLoading } = useQuery({
    queryKey: ['artist-stats', userId],
    queryFn: () => fetchArtistStats(userId),
    enabled: userId > 0,
  })
  const { data: songs = [] } = useQuery({
    queryKey: ['songs', 'all', userId],
    queryFn: () => fetchSongs({ userId }),
    enabled: userId > 0,
    staleTime: 5 * 60_000,
  })
  const { data: genres = [] } = useQuery({
    queryKey: ['genre-stats', userId],
    queryFn: () => fetchGenreStats(userId),
    enabled: userId > 0,
    staleTime: 5 * 60_000,
  })

  const scored = songs.filter((s) => s.score != null).map((s) => s.score!)
  const bangs = scored.filter((s) => s >= BANG_THRESHOLD).length
  const skips = scored.filter((s) => s < SKIP_THRESHOLD).length
  const bangPct = scored.length ? (bangs / scored.length) * 100 : null
  const skipPct = scored.length ? (skips / scored.length) * 100 : null

  // Histogram: ten bins at the integers, scores rounded to the nearest.
  const bins = Array.from({ length: 10 }, (_, i) => i + 1).map(
    (n) => scored.filter((s) => Math.max(1, Math.min(10, Math.round(s))) === n).length,
  )
  const maxBin = Math.max(1, ...bins)

  const topGenres = [...genres].sort((a, b) => b.count - a.count).slice(0, 4)
  const maxGenre = Math.max(1, ...topGenres.map((g) => g.count))
  const topArtists = [...artists].sort((a, b) => b.count - a.count).slice(0, 15)

  return (
    <View style={styles.wrap}>
      {/* Bang vs skip — one joined distribution, mids gray (per the share card) */}
      <View style={styles.bsCard}>
        <View style={styles.bsHead}>
          <View>
            <Text style={[styles.bsValue, { color: colors.green }]}>
              {bangPct != null ? bangPct.toFixed(1) : '—'}%
            </Text>
            <Text style={styles.bsLabel}>BANGS</Text>
            <Text style={styles.bsCaption}>{bangs.toLocaleString()} songs · {BANG_THRESHOLD.toFixed(1)}+</Text>
          </View>
          <Text style={styles.bsVs}>vs</Text>
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={[styles.bsValue, { color: RED }]}>
              {skipPct != null ? skipPct.toFixed(1) : '—'}%
            </Text>
            <Text style={styles.bsLabel}>SKIPS</Text>
            <Text style={styles.bsCaption}>{skips.toLocaleString()} songs · under {SKIP_THRESHOLD.toFixed(1)}</Text>
          </View>
        </View>
        <View style={styles.bsBar}>
          <View style={{ flex: Math.max(bangs, 0.0001), backgroundColor: colors.green, borderRadius: 99 }} />
          <View style={{ flex: Math.max(scored.length - bangs - skips, 0.0001), backgroundColor: 'rgba(120,100,80,0.2)', borderRadius: 99 }} />
          <View style={{ flex: Math.max(skips, 0.0001), backgroundColor: RED, borderRadius: 99 }} />
        </View>
        <View style={styles.bsCounts}>
          <Text style={styles.bsCount}>{bangs.toLocaleString()} {bangs === 1 ? 'BANG' : 'BANGS'}</Text>
          <Text style={styles.bsCount}>{skips.toLocaleString()} {skips === 1 ? 'SKIP' : 'SKIPS'}</Text>
        </View>
      </View>

      {/* Score distribution */}
      <Text style={styles.sectionLabel}>SCORE DISTRIBUTION</Text>
      <View style={styles.chart}>
        {bins.map((count, i) => (
          <View key={i} style={styles.chartCol}>
            <View
              style={[
                styles.bar,
                { height: Math.max(count > 0 ? 6 : 2, (count / maxBin) * CHART_H), backgroundColor: songScoreColor(i + 1) },
              ]}
            />
          </View>
        ))}
      </View>
      {/* One label per bin, centered under its bar (bin n = scores rounding to n). */}
      <View style={styles.chartAxis}>
        {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
          <Text key={n} style={styles.axisLabel}>{n}</Text>
        ))}
      </View>

      {/* Genres */}
      {topGenres.length > 0 && (
        <>
          <Text style={styles.sectionLabel}>GENRES</Text>
          {topGenres.map((g) => (
            <View key={g.genre} style={styles.genreRow}>
              <Text style={styles.genreName} numberOfLines={1}>{g.genre}</Text>
              <View style={styles.genreTrack}>
                <View style={[styles.genreFill, { width: `${(g.count / maxGenre) * 100}%` }]} />
              </View>
              <Text style={styles.genreCount}>{g.count}</Text>
            </View>
          ))}
        </>
      )}

      {/* Most rated artists */}
      <Text style={styles.sectionLabel}>MOST RATED ARTISTS</Text>
      {isLoading ? (
        <ActivityIndicator color={colors.green} style={{ marginTop: spacing.md }} />
      ) : topArtists.length === 0 ? (
        <Text style={styles.empty}>Rate more albums to build artist stats.</Text>
      ) : (
        topArtists.map((a) => (
          <Pressable
            key={a.artist}
            style={styles.artistRow}
            onPress={() => router.push({ pathname: '/artist/[name]', params: { name: encodeURIComponent(a.artist) } })}
          >
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={styles.artistName} numberOfLines={1}>{a.artist}</Text>
              <Text style={styles.artistMeta}>{a.count} song{a.count === 1 ? '' : 's'} · {(a.bangPct * 100).toFixed(0)}% bangs</Text>
            </View>
            <Text style={[styles.artistScore, { color: songScoreColor(a.avgSongScore) }]}>
              {a.avgSongScore.toFixed(2)}
            </Text>
          </Pressable>
        ))
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: { marginTop: spacing.lg },

  bsCard: { marginTop: spacing.sm },
  bsHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  bsValue: { fontFamily: fonts.display, fontSize: 34, lineHeight: 38 },
  bsLabel: { fontFamily: fonts.bodyBold, fontSize: 11, letterSpacing: 1.4, color: colors.ink, marginTop: 3 },
  bsCaption: { fontFamily: fonts.body, fontSize: 11.5, color: colors.inkTertiary, marginTop: 2 },
  bsVs: { fontFamily: fonts.display, fontSize: 16, color: colors.inkMuted },
  bsBar: { flexDirection: 'row', gap: 4, height: 14, marginTop: spacing.lg },
  bsCounts: { flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing.sm },
  bsCount: { fontFamily: fonts.bodySemiBold, fontSize: 11, letterSpacing: 0.6, color: colors.inkMuted },

  sectionLabel: {
    fontFamily: fonts.bodyBold,
    fontSize: 11,
    letterSpacing: 1.2,
    color: colors.inkMuted,
    marginTop: spacing.xl,
    marginBottom: spacing.sm,
  },

  chart: { flexDirection: 'row', alignItems: 'flex-end', height: CHART_H, gap: 4 },
  chartCol: { flex: 1, alignItems: 'center', justifyContent: 'flex-end' },
  bar: { width: '100%', borderRadius: 3, opacity: 0.9 },
  chartAxis: { flexDirection: 'row', gap: 4, marginTop: 4 },
  axisLabel: { flex: 1, textAlign: 'center', fontFamily: fonts.body, fontSize: 10, color: colors.inkMuted },

  genreRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: 7 },
  genreName: { width: 88, fontFamily: fonts.bodyMedium, fontSize: 14, color: colors.ink },
  genreTrack: { flex: 1, height: 8, borderRadius: 4, backgroundColor: colors.inset, overflow: 'hidden' },
  genreFill: { height: '100%', borderRadius: 4, backgroundColor: colors.green },
  genreCount: { width: 30, textAlign: 'right', fontFamily: fonts.bodyBold, fontSize: 14, color: colors.ink },

  artistRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  artistName: { fontFamily: fonts.bodySemiBold, fontSize: 15, color: colors.ink },
  artistMeta: { fontFamily: fonts.body, fontSize: 12, color: colors.inkTertiary, marginTop: 1 },
  artistScore: { fontFamily: fonts.bodyBold, fontSize: 17 },
  empty: { fontFamily: fonts.body, fontSize: 14, color: colors.inkTertiary, marginTop: spacing.md },
})
