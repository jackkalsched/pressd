// "Heated discussions" — records people are actively writing about.
// PLAN_discussions.md §8. Mirror of frontend/src/components/HeatedDiscussions.
//
// Ordered by review activity rather than by disagreement: spread is a real
// signal but a slow-moving one, and a section that never changes stops being
// looked at.
//
// Each card shows how the room feels rather than labelling it. It used to carry
// small text tags (CONTROVERSIAL / LOVED / HATED); now, as on web, the verdict
// is something you see before you read anything:
//   - a badge with no words: crossed swords for a divided room, otherwise a
//     face — laughing (loved), angry (hated), meh (lukewarm);
//   - a glow under the cover in the verdict's colour — red into green for a
//     room that can't agree, so a divided record looks torn;
//   - a "room meter": the 1–10 scale with a band over where the room's scores
//     actually fall (the mean ± one standard deviation), and a dot at the mean.
// The verdicts are the server's flags (discover.py: LOVED_MEAN, HATED_MEAN,
// CONTROVERSIAL_SPREAD), so the two platforms can't disagree on what counts.
import { useEffect, useState } from 'react'
import { AccessibilityInfo, Animated, Easing, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { LinearGradient } from 'expo-linear-gradient'
import { useRouter } from 'expo-router'
import { useQuery } from '@tanstack/react-query'
import { Angry, Laugh, Meh, Smile, Swords, type LucideIcon } from 'lucide-react-native'
import { fetchHeated } from '../lib/api'
import { songScoreColor, type HeatedMood, type HeatedRecord } from '@pressd/shared/types'
import { colors, fonts, radii, spacing, NUM_SCALE_CAP } from '../theme/tokens'
import CoverImage from './CoverImage'

const CARD_W = 184
const GREEN = '#2d6a4f'
const RED = '#c0392b'

// Web's colours. `glow` is a list rather than a gradient: mobile has no blur,
// so the glow is coloured shadows, one per stop, laid side by side.
const VERDICTS: Record<HeatedMood, { label: string; icon: LucideIcon; ink: string; glow: string[]; pill: string[] }> = {
  // A room that can't agree is the better story than where its average lands,
  // so divided wins when a record is also loved or hated. Its badge and glow
  // run red into green — the record looks pulled both ways.
  divided: { label: 'Divided', icon: Swords, ink: '#a8482f', glow: [RED, '#d9a03b', GREEN], pill: [RED, '#c47a2c', GREEN] },
  // The rest are the room's face, by its mean: laughing ≥ 8, smiling ≥ 7.25,
  // meh ≥ 6.5, angry below (discover.py, _mood).
  loved: { label: 'Loved', icon: Laugh, ink: GREEN, glow: ['#3f8a63', GREEN], pill: [GREEN, GREEN] },
  liked: { label: 'Liked', icon: Smile, ink: '#4f7f3a', glow: ['#8fbf6a', '#6a9a45'], pill: ['#5f8f42', '#5f8f42'] },
  hated: { label: 'Hated', icon: Angry, ink: RED, glow: [RED, '#a8482f'], pill: [RED, RED] },
  lukewarm: { label: 'Lukewarm', icon: Meh, ink: '#9a7b2f', glow: ['#d9b25b', '#c9a24a'], pill: ['#b08a2e', '#b08a2e'] },
}

function verdictOf(r: HeatedRecord): HeatedMood {
  return r.mood
}

export default function HeatedDiscussions() {
  const router = useRouter()
  const { data: records = [] } = useQuery({
    queryKey: ['heated'],
    queryFn: () => fetchHeated(10),
    retry: false,
  })

  // Default off and switch on once the setting has been read, so the first
  // frame is never one we'd have to take back. Same rule as RecommendationBanner.
  const [animate, setAnimate] = useState(false)
  useEffect(() => {
    let alive = true
    AccessibilityInfo.isReduceMotionEnabled()
      .then((reduced) => { if (alive) setAnimate(!reduced) })
      .catch(() => { if (alive) setAnimate(true) })
    return () => { alive = false }
  }, [])

  if (records.length === 0) return null

  return (
    <View style={styles.section}>
      <Text style={styles.heading}>HEATED DISCUSSIONS</Text>

      {/* A horizontal scroller clips, and the glow spreads below the cover, so
          the row carries room at the bottom and the section gives it back. */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.rail}
        contentContainerStyle={styles.row}
      >
        {records.map((r, i) => (
          <Card
            key={r.subjectKey}
            record={r}
            index={i}
            animate={animate}
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

function Card({ record: r, index, animate, onPress }: { record: HeatedRecord; index: number; animate: boolean; onPress: () => void }) {
  const v = VERDICTS[verdictOf(r)]
  const Icon = v.icon

  return (
    <Pressable
      style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${r.albumName}${r.artist ? ` by ${r.artist}` : ''}: ${v.label.toLowerCase()}${r.meanScore != null ? `, room average ${r.meanScore.toFixed(2)}` : ''}, ${r.reviewCount} ${r.reviewCount === 1 ? 'review' : 'reviews'}`}
    >
      <View>
        {/* The verdict as light: coloured shadows under the cover's lower edge,
            inset so they spread out from beneath it rather than beside it. */}
        <View style={styles.glow} pointerEvents="none">
          {v.glow.map((c, i) => (
            <View key={i} style={[styles.glowStop, { backgroundColor: c, shadowColor: c }]} />
          ))}
        </View>

        <View style={styles.coverShadow}>
          {r.albumArtUrl ? (
            <CoverImage url={r.albumArtUrl} displayPx={CARD_W} style={styles.art} />
          ) : (
            <View style={[styles.art, styles.artFallback]}>
              <Text style={styles.artInitial}>{r.albumName[0]}</Text>
            </View>
          )}
        </View>

        {/* The verdict's word lives in the card's accessibility label; the
            badge itself is just the face. */}
        <LinearGradient colors={v.pill as [string, string, ...string[]]} start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }} style={styles.badge}>
          <Icon size={18} color="#fff" strokeWidth={2.4} />
        </LinearGradient>
        {r.isNew && (
          <View style={styles.newBadge}>
            <Text style={styles.newText} maxFontSizeMultiplier={1}>NEW</Text>
          </View>
        )}
      </View>

      <Text style={styles.album} numberOfLines={1}>{r.albumName}</Text>
      <Text style={styles.artist} numberOfLines={1}>{r.artist ?? ''}</Text>

      {r.meanScore != null && <RoomMeter mean={r.meanScore} spread={r.spread} index={index} animate={animate} />}

      <View style={styles.counts}>
        {r.recentReviews > 0 && (
          // Live: reviews landed in the last few days.
          <View style={styles.live}>
            <View style={[styles.liveDot, { backgroundColor: v.ink }]} />
            <Text style={[styles.liveText, { color: v.ink }]} maxFontSizeMultiplier={NUM_SCALE_CAP}>
              {r.recentReviews} new
            </Text>
          </View>
        )}
        <Text style={styles.reviews} maxFontSizeMultiplier={NUM_SCALE_CAP}>
          {r.reviewCount} {r.reviewCount === 1 ? 'review' : 'reviews'}
        </Text>
      </View>
    </Pressable>
  )
}

/** Where the room's scores fall on the 1–10 scale: a band from mean − spread
 *  to mean + spread, coloured end to end by the scores at its edges, with a dot
 *  at the mean and the mean itself beside it. The band grows out from the
 *  mean when the rail first appears, staggered card by card. */
function RoomMeter({ mean, spread, index, animate }: { mean: number; spread: number; index: number; animate: boolean }) {
  const pos = (s: number) => ((Math.min(10, Math.max(1, s)) - 1) / 9) * 100
  const lo = Math.max(1, mean - spread)
  const hi = Math.min(10, mean + spread)
  // A room in perfect agreement still needs a band you can see.
  const left = Math.max(0, Math.min(pos(lo), pos(mean) - 3))
  const width = Math.min(Math.max(pos(hi) - pos(lo), 6), 100 - left)

  const [grow] = useState(() => new Animated.Value(0))
  useEffect(() => {
    if (!animate) {
      grow.setValue(1)
      return
    }
    Animated.timing(grow, {
      toValue: 1,
      duration: 700,
      delay: 120 + index * 70,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start()
  }, [animate, grow, index])

  return (
    <View style={styles.meterRow}>
      <View style={styles.meter}>
        <View style={styles.meterTrack} />
        <Animated.View
          style={[
            styles.meterBand,
            {
              left: `${left}%`,
              width: `${width}%`,
              shadowColor: songScoreColor(mean),
              // Array form: React Native misreads the string form's second value as z.
              transformOrigin: [`${Math.round(((pos(mean) - left) / width) * 100)}%`, '50%', 0],
              transform: [{ scaleX: grow }],
            },
          ]}
        >
          <LinearGradient
            colors={[songScoreColor(lo), songScoreColor(hi)]}
            start={{ x: 0, y: 0.5 }}
            end={{ x: 1, y: 0.5 }}
            style={styles.meterFill}
          />
        </Animated.View>
        <View
          style={[
            styles.meterDot,
            { left: `${pos(mean)}%`, borderColor: songScoreColor(mean), shadowColor: songScoreColor(mean) },
          ]}
        />
      </View>
      <Text style={[styles.meterMean, { color: songScoreColor(mean) }]} maxFontSizeMultiplier={NUM_SCALE_CAP}>
        {mean.toFixed(2)}
      </Text>
    </View>
  )
}

const DOT = 14

const styles = StyleSheet.create({
  section: { marginTop: spacing.xxl },
  // Mirrors For You's own sectionLabel rather than inventing a heading: this
  // sits among that page's sections and has no business looking different.
  heading: { fontFamily: fonts.bodyBold, fontSize: 13, letterSpacing: 0.6, color: colors.ink },
  // The page pads its content, so the rail bleeds back out and re-pads itself,
  // the way New & Popular does — cards run off the edge rather than stop short.
  // The bottom padding is the glow's room; the negative margin returns it.
  rail: { marginHorizontal: -spacing.lg, marginBottom: -spacing.md },
  row: { paddingHorizontal: spacing.lg, gap: spacing.lg, paddingTop: spacing.lg, paddingBottom: spacing.md },

  card: { width: CARD_W },
  cardPressed: { transform: [{ scale: 0.98 }] },

  glow: {
    position: 'absolute',
    left: 22,
    right: 22,
    bottom: 4,
    height: 30,
    flexDirection: 'row',
  },
  glowStop: {
    flex: 1,
    borderRadius: 15,
    shadowOpacity: 0.9,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 16 },
  },
  coverShadow: {
    borderRadius: 16,
    shadowColor: '#3c2d1e',
    shadowOpacity: 0.25,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 8 },
  },
  art: { width: CARD_W, height: CARD_W, borderRadius: 16, backgroundColor: colors.inset },
  artFallback: { alignItems: 'center', justifyContent: 'center' },
  artInitial: { fontFamily: fonts.display, fontSize: 56, color: colors.inkMuted },

  badge: {
    position: 'absolute',
    left: 8,
    top: 8,
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
  },
  newBadge: {
    position: 'absolute',
    right: 8,
    top: 8,
    borderRadius: radii.pill,
    backgroundColor: colors.ink,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  newText: { fontFamily: fonts.bodyBold, fontSize: 9.5, letterSpacing: 0.8, color: '#fff' },

  album: { fontFamily: fonts.bodyBold, fontSize: 14, color: colors.ink, marginTop: 14 },
  artist: { fontFamily: fonts.body, fontSize: 12, color: colors.inkTertiary, marginTop: 1 },

  meterRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 10 },
  meter: { flex: 1, height: 10, justifyContent: 'center' },
  meterTrack: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderRadius: 5, backgroundColor: '#ece6dc' },
  meterBand: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    borderRadius: 5,
    shadowOpacity: 0.8,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 0 },
  },
  meterFill: { flex: 1, borderRadius: 5 },
  meterDot: {
    position: 'absolute',
    width: DOT,
    height: DOT,
    marginLeft: -DOT / 2,
    borderRadius: DOT / 2,
    borderWidth: 3,
    backgroundColor: '#fff',
    shadowOpacity: 0.9,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 0 },
  },
  meterMean: { fontFamily: fonts.display, fontSize: 17, fontVariant: ['tabular-nums'] },

  counts: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 },
  live: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  liveDot: { width: 6, height: 6, borderRadius: 3 },
  liveText: { fontFamily: fonts.bodySemiBold, fontSize: 11, fontVariant: ['tabular-nums'] },
  reviews: { fontFamily: fonts.bodyMedium, fontSize: 11, color: colors.inkMuted, fontVariant: ['tabular-nums'] },
})
