// "Heated discussions" — records people are actively writing about.
// PLAN_discussions.md §8.
//
// Ordered by review activity rather than by disagreement: spread is a real
// signal but a slow-moving one, and a section that never changes stops being
// looked at. Disagreement survives as a tag instead.
import { Image } from 'expo-image'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useRouter } from 'expo-router'
import { useQuery } from '@tanstack/react-query'
import { fetchHeated } from '../lib/api'
import { type HeatedRecord } from '@pressd/shared/types'
import { colors, fonts, radii, spacing, NUM_SCALE_CAP } from '../theme/tokens'

const CARD_W = 200

export default function HeatedDiscussions() {
  const router = useRouter()
  const { data: records = [] } = useQuery({
    queryKey: ['heated'],
    queryFn: () => fetchHeated(10),
    retry: false,
  })

  if (records.length === 0) return null

  return (
    <View style={styles.section}>
      <Text style={styles.heading}>HEATED DISCUSSIONS</Text>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.rail}
        contentContainerStyle={styles.row}
      >
        {records.map((r) => (
          <Card
            key={r.subjectKey}
            record={r}
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
          />
        ))}
      </ScrollView>
    </View>
  )
}

function Card({ record: r, onPress }: { record: HeatedRecord; onPress: () => void }) {
  return (
    <Pressable style={({ pressed }) => [styles.card, pressed && { opacity: 0.85 }]} onPress={onPress}>
      {r.albumArtUrl ? (
        <Image source={{ uri: r.albumArtUrl }} style={styles.art} contentFit="cover" />
      ) : (
        <View style={[styles.art, styles.artFallback]}>
          <Text style={styles.artInitial}>{r.albumName[0]}</Text>
        </View>
      )}

      <Text style={styles.album} numberOfLines={1}>{r.albumName}</Text>
      <Text style={styles.artist} numberOfLines={1}>{r.artist ?? ''}</Text>

      {/* At most one of loved/hated can be true — they are opposite ends of the
          same average — so the row never needs to wrap for them. */}
      <View style={styles.tags}>
        {r.controversial && <Tag label="CONTROVERSIAL" tone={TONE.controversial} />}
        {r.loved && <Tag label="LOVED" tone={TONE.loved} />}
        {r.hated && <Tag label="HATED" tone={TONE.hated} />}
        <Text style={styles.reviews} maxFontSizeMultiplier={NUM_SCALE_CAP}>
          {r.reviewCount} {r.reviewCount === 1 ? 'review' : 'reviews'}
        </Text>
      </View>

      {r.isNew && (
        <View style={styles.newRow}>
          <Tag label="NEW" tone={TONE.fresh} />
        </View>
      )}
    </Pressable>
  )
}

function Tag({ label, tone }: { label: string; tone: { bg: string; fg: string } }) {
  return (
    <View style={[styles.tag, { backgroundColor: tone.bg }]}>
      <Text style={[styles.tagText, { color: tone.fg }]} maxFontSizeMultiplier={1}>
        {label}
      </Text>
    </View>
  )
}

const TONE = {
  controversial: { bg: 'rgba(192, 86, 58, 0.12)', fg: '#a8482f' },
  loved: { bg: colors.greenSoft, fg: colors.green },
  hated: { bg: 'rgba(192, 57, 43, 0.10)', fg: '#c0392b' },
  fresh: { bg: colors.ink, fg: '#ffffff' },
}

const styles = StyleSheet.create({
  section: { marginTop: spacing.xxl },
  // Mirrors For You's own sectionLabel rather than inventing a heading: this
  // sits among that page's sections and has no business looking different.
  heading: { fontFamily: fonts.bodyBold, fontSize: 13, letterSpacing: 0.6, color: colors.ink },
  // The page pads its content, so the rail bleeds back out and re-pads itself,
  // the way New & Popular does — cards run off the edge rather than stop short.
  rail: { marginHorizontal: -spacing.lg },
  row: { paddingHorizontal: spacing.lg, gap: spacing.md, paddingTop: spacing.lg },

  card: { width: CARD_W },
  art: { width: CARD_W, height: CARD_W, borderRadius: radii.md, backgroundColor: colors.inset },
  artFallback: { alignItems: 'center', justifyContent: 'center' },
  artInitial: { fontFamily: fonts.display, fontSize: 40, color: colors.inkMuted },
  album: { fontFamily: fonts.bodySemiBold, fontSize: 14, color: colors.ink, marginTop: spacing.sm },
  artist: { fontFamily: fonts.body, fontSize: 12, color: colors.inkTertiary },

  tags: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6, marginTop: spacing.sm },
  tag: { paddingHorizontal: 7, paddingVertical: 3, borderRadius: radii.sm },
  tagText: { fontFamily: fonts.bodyBold, fontSize: 9, letterSpacing: 0.7 },
  reviews: { fontFamily: fonts.bodyMedium, fontSize: 11, color: colors.inkTertiary },
  newRow: { flexDirection: 'row', marginTop: 6 },
})
