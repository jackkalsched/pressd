// For You — Phase 0 shows the greeting header and userbase-wide trending
// (live from /discover/trending); streaks, continue-listening, and new &
// popular land in Phase 1.
import { ScrollView, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useQuery } from '@tanstack/react-query'
import { Image } from 'expo-image'
import { fetchTrending } from '../../lib/api'
import { colors, fonts, radii, spacing } from '../../theme/tokens'

function greeting(): string {
  const h = new Date().getHours()
  if (h < 12) return 'Good morning.'
  if (h < 18) return 'Good afternoon.'
  return 'Good evening.'
}

export default function ForYou() {
  const { data: trending = [] } = useQuery({
    queryKey: ['discover', 'trending', 'week'],
    queryFn: () => fetchTrending('week', 5),
  })

  const today = new Date()
    .toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
    .toUpperCase()

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.date}>{today}</Text>
        <Text style={styles.title}>For You</Text>
        <Text style={styles.sub}>{greeting()} Here's what's moving this week.</Text>

        {trending.length > 0 && (
          <>
            <Text style={styles.sectionLabel}>TRENDING THIS WEEK</Text>
            <View style={styles.card}>
              {trending.map((t, i) => (
                <View key={t.album_id} style={[styles.row, i > 0 && styles.rowBorder]}>
                  <Text style={styles.rank}>{i + 1}</Text>
                  {t.album_art_url ? (
                    <Image source={{ uri: t.album_art_url }} style={styles.art} contentFit="cover" />
                  ) : (
                    <View style={[styles.art, { backgroundColor: colors.inset }]} />
                  )}
                  <View style={styles.rowText}>
                    <Text style={styles.albumName} numberOfLines={1}>{t.album_name}</Text>
                    <Text style={styles.artist} numberOfLines={1}>{t.artist}</Text>
                  </View>
                  {t.avg_score != null && (
                    <View style={styles.scoreChip}>
                      <Text style={styles.scoreText}>{t.avg_score.toFixed(1)}</Text>
                    </View>
                  )}
                </View>
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
  date: {
    fontFamily: fonts.bodyBold,
    fontSize: 11,
    letterSpacing: 1.2,
    color: colors.inkMuted,
    marginTop: spacing.lg,
  },
  title: { fontFamily: fonts.display, fontSize: 38, color: colors.ink, letterSpacing: 2, marginTop: 2 },
  sub: { fontFamily: fonts.bodyMedium, fontSize: 14, color: colors.inkTertiary, marginTop: 4 },
  sectionLabel: {
    fontFamily: fonts.bodyBold,
    fontSize: 11,
    letterSpacing: 1.2,
    color: colors.inkMuted,
    marginTop: spacing.xl,
    marginBottom: spacing.sm,
  },
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
  art: { width: 44, height: 44, borderRadius: radii.sm },
  rowText: { flex: 1, minWidth: 0 },
  albumName: { fontFamily: fonts.bodySemiBold, fontSize: 15, color: colors.ink },
  artist: { fontFamily: fonts.body, fontSize: 13, color: colors.inkTertiary, marginTop: 1 },
  scoreChip: {
    backgroundColor: colors.greenSoft,
    borderRadius: radii.sm,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  scoreText: { fontFamily: fonts.bodyBold, fontSize: 14, color: colors.green },
})
