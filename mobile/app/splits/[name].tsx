// Every track of one artist that you and at least one other person have both
// rated — the full board behind Compare's preview.
//
// Ordered by how many people have weighed in rather than by how far apart you
// are. The preview already answers "where do I disagree most"; the question
// this page answers is "where do I stand on the songs Press'd has actually
// listened to", and that ordering puts the well-attended tracks first, where a
// disagreement means something.
import { useMemo } from 'react'
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useQuery } from '@tanstack/react-query'
import { LinearGradient } from 'expo-linear-gradient'
import { ArrowLeft } from 'lucide-react-native'
import { fetchArtistDetail } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { GapAxisLabels, GapList } from '../../components/SongGapChart'
import { colors, fonts, spacing } from '../../theme/tokens'

// Green into cream. A two-stop gradient creases where it meets the solid
// header — the colour's rate of change jumps from nothing to constant, and the
// eye reads that as a band. Sampling a smoothstep leaves the ramp flat at both
// ends, so the header dissolves with no edge anywhere along it. Same treatment
// the artist hero uses for its photo fade.
const FADE_H = 56
const FADE_STEPS = 12

function mix(a: string, b: string, t: number): string {
  const hex = (c: string) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16))
  const [r1, g1, b1] = hex(a)
  const [r2, g2, b2] = hex(b)
  const c = (x: number, y: number) => Math.round(x + (y - x) * t)
  return `rgb(${c(r1, r2)},${c(g1, g2)},${c(b1, b2)})`
}

const FADE_COLORS = Array.from({ length: FADE_STEPS + 1 }, (_, i) => {
  const t = i / FADE_STEPS
  return mix(colors.green, colors.bg, t * t * (3 - 2 * t))
}) as unknown as readonly [string, string, ...string[]]

export default function ArtistSplits() {
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
    // Most-rated first; ties fall back to the loudest disagreement so equally
    // attended tracks still lead with the interesting one.
    return [...gaps].sort(
      (a, b) => b.raters - a.raters || Math.abs(b.diff) - Math.abs(a.diff),
    )
  }, [data])

  const goBack = () => {
    if (router.canGoBack()) router.back()
    else router.replace('/(tabs)/profile')
  }

  return (
    <View style={styles.screen}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable onPress={goBack} hitSlop={12} style={styles.backBtn} accessibilityLabel="Back">
          <ArrowLeft size={18} color="#ffffff" />
          <Text style={styles.backText}>Back</Text>
        </Pressable>
        <Text style={styles.title} numberOfLines={2}>{artist}</Text>
        <Text style={styles.sub}>
          {isLoading ? 'Loading…' : `${rows.length} track${rows.length === 1 ? '' : 's'} you and Press'd have both rated`}
        </Text>
      </View>
      {/* Sits between the header and the body rather than over either, so the
          content below starts on flat cream. */}
      <LinearGradient colors={FADE_COLORS} style={styles.fade} pointerEvents="none" />

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {isLoading ? (
          <ActivityIndicator color={colors.green} style={{ marginTop: spacing.xxl }} />
        ) : rows.length === 0 ? (
          <Text style={styles.empty}>Nobody else has rated {artist} yet.</Text>
        ) : (
          <>
            <Text style={styles.order}>MOST RATED FIRST</Text>
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
  header: {
    backgroundColor: colors.green,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
    gap: 6,
  },
  backBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start' },
  backText: { fontFamily: fonts.bodyMedium, fontSize: 15, color: '#ffffff' },
  title: { fontFamily: fonts.displayBlack, fontSize: 26, color: '#ffffff', marginTop: 2 },
  sub: { fontFamily: fonts.body, fontSize: 12.5, color: 'rgba(255,255,255,0.68)' },

  fade: { height: FADE_H },
  // The fade already supplies the gap under the header.
  content: { paddingHorizontal: spacing.lg, paddingTop: 0, paddingBottom: 60 },
  order: {
    fontFamily: fonts.bodyBold,
    fontSize: 9.5,
    letterSpacing: 1,
    color: colors.inkMuted,
    marginBottom: spacing.sm,
  },
  empty: {
    fontFamily: fonts.body,
    fontSize: 14,
    color: colors.inkTertiary,
    textAlign: 'center',
    marginTop: spacing.xxl,
  },
})
