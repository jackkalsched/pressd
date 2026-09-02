// "Most divisive" — records the userbase disagrees about. PLAN_discussions.md §8.
//
// The signal is free and nobody else can compute it: Press'd holds every user's
// score for a record, so disagreement is a standard deviation away. It earns a
// rail because it is the one discovery surface that points at a record *because*
// people can't agree on it, which is exactly when a discussion is worth reading.
import { useState } from 'react'
import { Image } from 'expo-image'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useRouter } from 'expo-router'
import { useQuery } from '@tanstack/react-query'
import { Flame, Snowflake } from 'lucide-react-native'
import { fetchDivisive } from '../lib/api'
import { colors, fonts, radii, spacing, NUM_SCALE_CAP } from '../theme/tokens'

export default function DivisiveRail() {
  const router = useRouter()
  const [window] = useState<'week' | 'all'>('all')
  const { data: records = [] } = useQuery({
    queryKey: ['divisive', window],
    queryFn: () => fetchDivisive(window, 10),
    retry: false,
  })

  if (records.length === 0) return null

  return (
    <View style={styles.section}>
      <Text style={styles.heading}>Most divisive</Text>
      <Text style={styles.sub}>Records pressers can&rsquo;t agree on.</Text>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.row}
      >
        {records.map((r) => (
          <Pressable
            key={r.subjectKey}
            style={({ pressed }) => [styles.card, pressed && { opacity: 0.85 }]}
            onPress={() =>
              router.push({
                pathname: '/thread/[subject]',
                params: {
                  subject: 'album',
                  artist: r.artist ?? '',
                  album: r.albumName,
                  title: r.albumName,
                },
              })
            }
          >
            {r.albumArtUrl ? (
              <Image source={{ uri: r.albumArtUrl }} style={styles.art} contentFit="cover" />
            ) : (
              <View style={[styles.art, styles.artFallback]}>
                <Text style={styles.artInitial}>{r.albumName[0]}</Text>
              </View>
            )}

            <Text style={styles.album} numberOfLines={1}>{r.albumName}</Text>
            <Text style={styles.artist} numberOfLines={1}>{r.artist ?? ''}</Text>

            {/* Split against each rater's own library mean, not a fixed line —
                "67% flame" means two thirds liked it more than they like their
                own library. An absolute cutoff would mostly measure who rates
                generously. */}
            <View style={styles.bar}>
              <View style={[styles.barCold, { flex: Math.max(r.coldPct, 1) }]} />
              <View style={[styles.barHot, { flex: Math.max(r.hotPct, 1) }]} />
            </View>
            <View style={styles.legend}>
              <View style={styles.legendSide}>
                <Snowflake size={12} color={COLD} />
                <Text style={[styles.legendText, { color: COLD }]} maxFontSizeMultiplier={NUM_SCALE_CAP}>
                  {r.coldPct}%
                </Text>
              </View>
              <View style={styles.legendSide}>
                <Text style={[styles.legendText, { color: HOT }]} maxFontSizeMultiplier={NUM_SCALE_CAP}>
                  {r.hotPct}%
                </Text>
                <Flame size={12} color={HOT} />
              </View>
            </View>

            <Text style={styles.meta}>
              {r.raters} raters · spread {r.spread.toFixed(2)}
            </Text>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  )
}

const COLD = '#4a6fa5'
const HOT = '#c0563a'
const CARD_W = 168

const styles = StyleSheet.create({
  section: { marginTop: spacing.xxl },
  heading: {
    fontFamily: fonts.display, fontSize: 22, color: colors.ink,
    paddingHorizontal: spacing.lg,
  },
  sub: {
    fontFamily: fonts.body, fontSize: 13, color: colors.inkTertiary,
    paddingHorizontal: spacing.lg, marginTop: 2,
  },
  row: { paddingHorizontal: spacing.lg, gap: spacing.md, paddingTop: spacing.lg },
  card: { width: CARD_W },
  art: { width: CARD_W, height: CARD_W, borderRadius: radii.md, backgroundColor: colors.inset },
  artFallback: { alignItems: 'center', justifyContent: 'center' },
  artInitial: { fontFamily: fonts.display, fontSize: 34, color: colors.inkMuted },
  album: { fontFamily: fonts.bodySemiBold, fontSize: 14, color: colors.ink, marginTop: spacing.sm },
  artist: { fontFamily: fonts.body, fontSize: 12, color: colors.inkTertiary },
  bar: {
    flexDirection: 'row', height: 5, borderRadius: 3, overflow: 'hidden',
    marginTop: spacing.sm, backgroundColor: colors.inset,
  },
  barCold: { backgroundColor: COLD },
  barHot: { backgroundColor: HOT },
  legend: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 5 },
  legendSide: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  legendText: { fontFamily: fonts.bodySemiBold, fontSize: 11 },
  meta: { fontFamily: fonts.body, fontSize: 11, color: colors.inkMuted, marginTop: 4 },
})
