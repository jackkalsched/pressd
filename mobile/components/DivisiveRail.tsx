// "Most divisive" — records the userbase disagrees about. PLAN_discussions.md §8.
//
// The signal is free here and computable nowhere else: Press'd holds every
// user's score for a record, so disagreement is a standard deviation away. It
// earns a rail because it points at a record *because* people can't agree on
// it, which is exactly when its thread is worth reading.
import { Image } from 'expo-image'
import { Dimensions, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useRouter } from 'expo-router'
import { useQuery } from '@tanstack/react-query'
import { fetchDivisive } from '../lib/api'
import { BANG_THRESHOLD, SKIP_THRESHOLD, type DivisiveRecord } from '@pressd/shared/types'
import { colors, fonts, radii, spacing, NUM_SCALE_CAP } from '../theme/tokens'

// The line spans where album scores actually live. A 0–10 axis would crowd
// every record into its right-hand third and waste the half nobody reaches.
const LINE_MIN = 5
const LINE_MAX = 10

const COLD = '#c0392b'
const MID = '#c8c2b8'
const HOT = colors.green

const CARD_W = Math.min(Dimensions.get('window').width - spacing.lg * 2, 380)
const BADGE = 44

/** Which way the record is leaning, in one line. */
function lean(r: DivisiveRecord): string {
  if (r.bangs === r.skips) return 'Split down the middle'
  return r.bangs > r.skips ? 'Hot side is pulling' : 'Cold side is pulling'
}

export default function DivisiveRail() {
  const router = useRouter()
  const { data: records = [] } = useQuery({
    queryKey: ['divisive', 'all'],
    queryFn: () => fetchDivisive('all', 10),
    retry: false,
  })

  if (records.length === 0) return null

  return (
    <View style={styles.section}>
      <Text style={styles.heading}>MOST DIVISIVE</Text>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        decelerationRate="fast"
        snapToInterval={CARD_W + spacing.md}
        snapToAlignment="start"
        style={styles.rail}
        contentContainerStyle={styles.row}
      >
        {records.map((r) => (
          <DivisiveCard
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

function DivisiveCard({ record: r, onPress }: { record: DivisiveRecord; onPress: () => void }) {
  // Where the average sits on the line, clamped so a record nobody liked still
  // shows its badge on the track rather than off the end of it.
  const t = Math.max(0, Math.min(1, (r.meanScore - LINE_MIN) / (LINE_MAX - LINE_MIN)))

  return (
    <Pressable style={({ pressed }) => [styles.card, pressed && { opacity: 0.9 }]} onPress={onPress}>
      <View style={styles.head}>
        {r.albumArtUrl ? (
          <Image source={{ uri: r.albumArtUrl }} style={styles.art} contentFit="cover" />
        ) : (
          <View style={[styles.art, styles.artFallback]}>
            <Text style={styles.artInitial}>{r.albumName[0]}</Text>
          </View>
        )}
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.album} numberOfLines={2}>{r.albumName}</Text>
          <Text style={styles.lean} numberOfLines={1}>{lean(r)}</Text>
        </View>
      </View>

      <View style={styles.rule} />

      {/* The scale itself carries the meaning: the coloured stretches are the
          app's own skip and bang thresholds, so where the badge lands says how
          the record did without a legend explaining it. */}
      <View style={styles.lineWrap}>
        <View style={styles.line}>
          <View style={[styles.seg, { flex: SKIP_THRESHOLD - LINE_MIN, backgroundColor: COLD }]} />
          <View style={[styles.seg, { flex: BANG_THRESHOLD - SKIP_THRESHOLD, backgroundColor: MID }]} />
          <View style={[styles.seg, { flex: LINE_MAX - BANG_THRESHOLD, backgroundColor: HOT }]} />
        </View>
        <View style={[styles.badgeSlot, { left: `${t * 100}%` }]} pointerEvents="none">
          <View style={styles.badge}>
            <Text style={styles.badgeText} maxFontSizeMultiplier={NUM_SCALE_CAP}>
              {r.meanScore.toFixed(1)}
            </Text>
          </View>
        </View>
      </View>

      <View style={styles.ends}>
        <View>
          <Text style={[styles.count, { color: colors.ink }]} maxFontSizeMultiplier={NUM_SCALE_CAP}>
            {r.skips}
          </Text>
          <Text style={styles.countLabel}>RAN COLD</Text>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Text style={[styles.count, { color: HOT }]} maxFontSizeMultiplier={NUM_SCALE_CAP}>
            {r.bangs}
          </Text>
          <Text style={styles.countLabel}>RAN HOT</Text>
        </View>
      </View>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  section: { marginTop: spacing.xxl },
  // Mirrors For You's own sectionLabel rather than inventing a heading: this
  // sits among that page's sections and has no business looking different.
  heading: { fontFamily: fonts.bodyBold, fontSize: 13, letterSpacing: 0.6, color: colors.ink },
  // The page pads its content, so the rail bleeds back out and re-pads itself,
  // the way New & Popular does — cards run off the edge instead of stopping short.
  rail: { marginHorizontal: -spacing.lg },
  row: { paddingHorizontal: spacing.lg, gap: spacing.md, paddingTop: spacing.lg },

  card: {
    width: CARD_W,
    backgroundColor: colors.raised,
    borderRadius: radii.xl,
    padding: spacing.lg,
  },
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  art: { width: 56, height: 56, borderRadius: radii.md, backgroundColor: colors.inset },
  artFallback: { alignItems: 'center', justifyContent: 'center' },
  artInitial: { fontFamily: fonts.display, fontSize: 22, color: colors.inkMuted },
  album: { fontFamily: fonts.display, fontSize: 18, lineHeight: 23, color: colors.ink },
  lean: { fontFamily: fonts.body, fontSize: 13, color: colors.inkTertiary, marginTop: 2 },

  rule: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    marginTop: spacing.lg,
  },

  // Vertical room for the badge, which overhangs the track on both sides.
  lineWrap: { height: BADGE + spacing.lg, justifyContent: 'center', marginTop: spacing.sm },
  line: { flexDirection: 'row', height: 10, borderRadius: 5, overflow: 'hidden' },
  seg: { height: '100%' },
  badgeSlot: { position: 'absolute', top: 0, bottom: 0, justifyContent: 'center', marginLeft: -BADGE / 2 },
  badge: {
    width: BADGE, height: BADGE, borderRadius: BADGE / 2,
    backgroundColor: colors.raised, borderWidth: 2, borderColor: HOT,
    alignItems: 'center', justifyContent: 'center',
  },
  badgeText: { fontFamily: fonts.display, fontSize: 15, color: HOT },

  ends: { flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing.xs },
  count: { fontFamily: fonts.display, fontSize: 26 },
  countLabel: {
    fontFamily: fonts.bodyBold, fontSize: 10, letterSpacing: 0.8,
    color: colors.inkMuted, marginTop: 1,
  },
})
