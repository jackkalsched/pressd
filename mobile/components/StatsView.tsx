// Stats — the Profile "Stats" sub-tab: headline highlights from the summary
// plus the user's most-rated artists, each linking to its Artist page (where
// the histogram + KDE live). Scoped to one user.
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native'
import { useQuery } from '@tanstack/react-query'
import { useRouter } from 'expo-router'
import { fetchArtistStats, type Summary } from '../lib/api'
import { songScoreColor } from '@pressd/shared/types'
import { colors, fonts, radii, spacing } from '../theme/tokens'

export default function StatsView({ userId, summary }: { userId: number; summary?: Summary }) {
  const router = useRouter()
  const { data: artists = [], isLoading } = useQuery({
    queryKey: ['artist-stats', userId],
    queryFn: () => fetchArtistStats(userId),
    enabled: userId > 0,
  })

  const topArtists = [...artists].sort((a, b) => b.count - a.count).slice(0, 15)

  const highlights: { label: string; value: string; sub?: string }[] = [
    { label: 'Songs rated', value: String(summary?.total_songs_rated ?? '—') },
    { label: 'Avg song', value: summary?.avg_song_score != null ? summary.avg_song_score.toFixed(2) : '—' },
    { label: 'Perfect 10s', value: String(summary?.total_10s ?? 0) },
    { label: 'Avg year', value: summary?.avg_release_year != null ? String(Math.round(summary.avg_release_year)) : '—' },
  ]

  return (
    <View style={styles.wrap}>
      <View style={styles.highlights}>
        {highlights.map((h) => (
          <View key={h.label} style={styles.hlCell}>
            <Text style={styles.hlValue}>{h.value}</Text>
            <Text style={styles.hlLabel}>{h.label}</Text>
          </View>
        ))}
      </View>

      {summary?.top_album && (
        <Highlight label="TOP ALBUM" title={summary.top_album.name} sub={summary.top_album.artist} score={summary.top_album.score} />
      )}
      {summary?.top_song && (
        <Highlight label="TOP SONG" title={summary.top_song.title} sub={summary.top_song.artist} score={summary.top_song.score} songScore />
      )}
      {summary?.best_genre && (
        <Highlight label="BEST GENRE" title={summary.best_genre.genre} sub={`${summary.best_genre.count} albums`} score={summary.best_genre.avg_score} />
      )}

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

function Highlight({
  label,
  title,
  sub,
  score,
  songScore,
}: {
  label: string
  title: string
  sub: string
  score: number
  songScore?: boolean
}) {
  return (
    <View style={styles.highlight}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={styles.highlightLabel}>{label}</Text>
        <Text style={styles.highlightTitle} numberOfLines={1}>{title}</Text>
        <Text style={styles.highlightSub} numberOfLines={1}>{sub}</Text>
      </View>
      <Text style={[styles.highlightScore, { color: songScoreColor(score) }]}>
        {songScore ? score.toFixed(1) : score.toFixed(2)}
      </Text>
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: { marginTop: spacing.lg },
  highlights: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    backgroundColor: colors.raised,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: spacing.sm,
  },
  hlCell: { width: '25%', alignItems: 'center', paddingVertical: spacing.md },
  hlValue: { fontFamily: fonts.bodyBold, fontSize: 18, color: colors.ink },
  hlLabel: { fontFamily: fonts.bodyMedium, fontSize: 10, color: colors.inkTertiary, marginTop: 2, textAlign: 'center' },

  highlight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.raised,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginTop: spacing.md,
  },
  highlightLabel: { fontFamily: fonts.bodyBold, fontSize: 10, letterSpacing: 1, color: colors.inkMuted },
  highlightTitle: { fontFamily: fonts.bodySemiBold, fontSize: 15, color: colors.ink, marginTop: 3 },
  highlightSub: { fontFamily: fonts.body, fontSize: 13, color: colors.inkTertiary, marginTop: 1 },
  highlightScore: { fontFamily: fonts.bodyBold, fontSize: 22 },

  sectionLabel: {
    fontFamily: fonts.bodyBold,
    fontSize: 11,
    letterSpacing: 1.2,
    color: colors.inkMuted,
    marginTop: spacing.xl,
    marginBottom: spacing.sm,
  },
  artistRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  artistName: { fontFamily: fonts.bodySemiBold, fontSize: 15, color: colors.ink },
  artistMeta: { fontFamily: fonts.body, fontSize: 12, color: colors.inkTertiary, marginTop: 1 },
  artistScore: { fontFamily: fonts.bodyBold, fontSize: 17 },
  empty: { fontFamily: fonts.body, fontSize: 14, color: colors.inkTertiary, marginTop: spacing.md },
})
