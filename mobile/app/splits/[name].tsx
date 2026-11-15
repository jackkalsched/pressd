// Every track of one artist that you and at least one other person have both
// rated — the full board behind Compare's preview.
//
// Ordered by the gap, highest first, as the Compare preview is.
import { useMemo } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import VinylSpinner from '../../components/VinylSpinner'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft } from 'lucide-react-native'
import { fetchArtistDetail } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { GapAxisLabels, GapList } from '../../components/SongGapChart'
import { colors, fonts, spacing, useColors } from '../../theme/tokens'

export default function ArtistSplits() {
  const tc = useColors()
  const { name } = useLocalSearchParams<{ name: string }>()
  const artist = decodeURIComponent(name ?? '')
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { user } = useAuth()

  // Same key the Compare tab uses, so arriving here costs nothing — the payload
  // is already in cache by the time this can be reached.
  const { data, isLoading } = useQuery({
    queryKey: ['artist', artist, user?.id, 'compare'],
    queryFn: () => fetchArtistDetail(artist, user!.id, 'both'),
    enabled: !!user && !!artist,
  })

  const rows = useMemo(() => {
    const gaps = data?.song_gaps ?? []
    // By the gap, descending: the songs you rate furthest above Pressd first,
    // furthest below last (Jack, November 2026; they were most-rated first).
    return [...gaps].sort((a, b) => b.diff - a.diff)
  }, [data])

  const goBack = () => {
    if (router.canGoBack()) router.back()
    else router.replace('/(tabs)/profile')
  }

  return (
    <View style={styles.screen}>
      {/* Just the comparison (Jack, November 2026): no header, no green — a
          back button over the songs. */}
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable onPress={goBack} hitSlop={12} style={styles.backBtn} accessibilityLabel="Back">
          <ArrowLeft size={18} color={tc.inkSecondary} />
          <Text style={styles.backText}>Back</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {isLoading ? (
          <VinylSpinner size={48} style={{ marginTop: spacing.xxl }} />
        ) : rows.length === 0 ? (
          <Text style={styles.empty}>Nobody else has rated {artist} yet.</Text>
        ) : (
          <>
            <GapAxisLabels />
            <GapList rows={rows} />
          </>
        )}
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  header: { paddingHorizontal: spacing.lg, paddingBottom: spacing.md },
  backBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start' },
  backText: { fontFamily: fonts.bodyMedium, fontSize: 15, color: colors.inkSecondary },
  content: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: 60 },
  empty: {
    fontFamily: fonts.body,
    fontSize: 14,
    color: colors.inkTertiary,
    textAlign: 'center',
    marginTop: spacing.xxl,
  },
})
