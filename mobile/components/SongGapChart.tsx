// Where your scores split from everyone else's, track by track.
//
// Replaces the percentile bars in Compare, which asked you to read seven
// unrelated metrics against a league table to answer one question: which songs
// do I hear differently? This answers it directly — one row per track, a bar
// growing right when you rate it above the crowd and left when below.
//
// Diverging bars rather than a paired-dot dumbbell: the quantity being ranked
// is the gap itself, and a bar reads its own length off the axis.
import { useMemo, useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { ChevronRight } from 'lucide-react-native'
import type { SongGap } from '@pressd/shared/api'
import NoComparisonYet from './NoComparisonYet'
import { colors, fonts, radii, spacing } from '../theme/tokens'

const UP = '#2d6a4f'    // you rate it higher
const DOWN = '#b5432f'  // you rate it lower
// Below this a bar can't hold its own label, so the pill sets the floor.
const MIN_PILL = 52
// Anything under this rounds to 0.0 at one decimal, so it is drawn as agreement
// rather than as a hair's-breadth lean in one direction.
const ZERO_EPS = 0.05
const EVEN = '#8a8079'  // neither of you is higher, so neither colour applies

/** The rows worth drawing: the extremes of each side.
 *
 *  Signed rather than by magnitude — the five you rate furthest above the crowd
 *  and the five furthest below. Ranking on |diff| put both ends on whichever
 *  side happened to disagree hardest and left the other unrepresented, so a
 *  chart with a LOWER and a HIGHER axis could come back all green.
 *
 *  Ten or fewer and there is nothing to choose between; show them all.
 */
export function selectGaps(gaps: SongGap[], perEnd = 5): SongGap[] {
  const signed = [...gaps].sort((a, b) => b.diff - a.diff)
  if (signed.length <= perEnd * 2) return signed
  // Slicing both ends of one sorted list can't double-count: past 10 rows the
  // two slices are disjoint by construction.
  return [...signed.slice(0, perEnd), ...signed.slice(-perEnd)]
}

/** The bars themselves. Shared by the Compare preview and the full splits page,
 *  so one row looks the same wherever it is drawn. */
export function GapList({ rows }: { rows: SongGap[] }) {
  const [plotW, setPlotW] = useState(0)
  // Scaled to the largest bar actually drawn, so the chart always uses its full
  // width instead of squashing everything against a fixed 10-point range.
  const maxAbs = Math.max(...rows.map((r) => Math.abs(r.diff)), 0.1)
  const half = plotW / 2

  return (
    <View style={styles.card}>
      {rows.map((r, i) => {
        const isZero = Math.abs(r.diff) < ZERO_EPS
        const positive = r.diff >= 0
        const scaled = (Math.abs(r.diff) / maxAbs) * half
        const width = Math.max(MIN_PILL, Math.min(scaled, half))
        return (
          <View key={`${r.title}-${i}`} style={styles.row}>
            <View style={styles.titleCol}>
              <Text style={styles.title} numberOfLines={2}>{r.title}</Text>
            </View>
            <View style={styles.plot} onLayout={(e) => setPlotW(e.nativeEvent.layout.width)}>
              <View style={styles.axis} />
              {plotW > 0 && (
                <View
                  style={[
                    styles.bar,
                    {
                      width,
                      backgroundColor: isZero ? EVEN : positive ? UP : DOWN,
                      // A gap of zero has no direction to grow in, so it
                      // straddles the axis instead of leaning off it — an
                      // agreement drawn as a stub reaching right reads as a
                      // small win for you, which is the opposite of what it
                      // says. Otherwise the value rides the growing end of the
                      // bar, where the eye already is.
                      ...(isZero
                        ? { left: half - width / 2, alignItems: 'center' as const }
                        : positive
                        ? { left: half, alignItems: 'flex-end' as const }
                        : { left: half - width, alignItems: 'flex-start' as const }),
                    },
                  ]}
                >
                  <Text style={styles.barValue}>
                    {isZero ? '' : positive ? '+' : '−'}{Math.abs(r.diff).toFixed(1)}
                  </Text>
                </View>
              )}
            </View>
          </View>
        )
      })}
    </View>
  )
}

/** The ◀ LOWER / HIGHER ▶ heading the bars are read against. */
export function GapAxisLabels() {
  return (
    <View style={styles.dirRow}>
      <Text style={[styles.dirLabel, { color: DOWN }]}>◀ YOU RATE LOWER</Text>
      <Text style={[styles.dirLabel, { color: UP }]}>YOU RATE HIGHER ▶</Text>
    </View>
  )
}

export default function SongGapChart({
  gaps,
  artist,
  onSeeAll,
}: {
  gaps: SongGap[]
  artist: string
  /** Given, the preview offers a way through to every shared track. */
  onSeeAll?: () => void
}) {
  const rows = useMemo(() => selectGaps(gaps), [gaps])

  const summary = useMemo(() => {
    if (gaps.length === 0) return null
    const mean = gaps.reduce((s, g) => s + g.diff, 0) / gaps.length
    const hottest = gaps.reduce((m, g) => (Math.abs(g.diff) > Math.abs(m.diff) ? g : m), gaps[0])
    return { mean, hottest }
  }, [gaps])

  // Nobody else in Press'd has rated a track of theirs, so there is no crowd to
  // split from. A chart of zeroes would be worse than nothing, and the way to
  // fix it is to get someone else listening — so say that instead.
  if (rows.length === 0 || !summary) {
    return (
      <NoComparisonYet
        title={`No one else has rated ${artist} yet — recommend an album to a friend to see a comparison!`}
        body={`Once a friend scores one of ${artist}'s songs, your splits show up here.`}
      />
    )
  }

  return (
    <View>
      <View style={styles.tiles}>
        <View style={styles.tile}>
          <Text style={[styles.tileValue, { color: summary.mean >= 0 ? UP : DOWN }]}>
            {summary.mean >= 0 ? '+' : ''}{summary.mean.toFixed(2)}
          </Text>
          <Text style={styles.tileLabel}>AVG GAP VS PRESS&apos;D</Text>
        </View>
        {/* Right-set, so the pair reads as one line with the two figures
            pushed to opposite edges rather than both crowding the left. */}
        <View style={[styles.tile, styles.tileRight]}>
          {/* The track, not the figure. "2.1" answers how far apart you are;
              the song answers what you are arguing about, which is the thing
              worth reading — and the bar for it is already in the chart. */}
          <Text
            style={[
              styles.tileSong,
              styles.textRight,
              { color: summary.hottest.diff >= 0 ? UP : DOWN },
            ]}
            numberOfLines={2}
          >
            {summary.hottest.title}
          </Text>
          <Text style={[styles.tileLabel, styles.textRight]} numberOfLines={1}>HOTTEST TAKE</Text>
        </View>
      </View>

      <GapAxisLabels />
      <GapList rows={rows} />

      {/* A preview of the extremes; the page behind this holds every shared
          track, ordered by how many people have weighed in. */}
      {onSeeAll && gaps.length > rows.length && (
        <Pressable style={styles.seeAll} onPress={onSeeAll} accessibilityRole="button">
          <Text style={styles.seeAllText}>
            See all {gaps.length} shared tracks
          </Text>
          <ChevronRight size={15} color={colors.green} />
        </Pressable>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  tiles: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.lg },
  // No fill behind these — the numerals carry their own colour, and a tinted
  // cell around each one read as two competing panels above the chart.
  tile: { flex: 1, paddingVertical: spacing.xs },
  tileRight: { alignItems: 'flex-end' },
  tileValue: { fontFamily: fonts.display, fontSize: 28, letterSpacing: -0.5 },
  // Matched to the numeral beside it so the two tiles carry equal weight. A
  // long title wraps to the second line rather than shrinking, which keeps the
  // pair the same height whatever the song is called.
  tileSong: { fontFamily: fonts.display, fontSize: 28, lineHeight: 32, letterSpacing: -0.5 },
  textRight: { textAlign: 'right' },
  tileLabel: {
    fontFamily: fonts.bodyBold,
    fontSize: 8.5,
    letterSpacing: 0.9,
    color: colors.inkTertiary,
    marginTop: 2,
  },

  dirRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: spacing.sm },
  dirLabel: { fontFamily: fonts.bodyBold, fontSize: 9, letterSpacing: 0.8 },

  card: {
    backgroundColor: colors.raised,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.sm },
  titleCol: { width: '40%', paddingRight: spacing.sm },
  title: { fontFamily: fonts.bodyMedium, fontSize: 13.5, color: colors.ink },

  plot: { flex: 1, height: 26, justifyContent: 'center' },
  // The zero line the bars read against, full row height so the column reads
  // as one axis rather than a series of ticks.
  axis: {
    position: 'absolute',
    left: '50%',
    top: -spacing.sm,
    bottom: -spacing.sm,
    width: 1,
    backgroundColor: colors.border,
  },
  bar: {
    position: 'absolute',
    height: 24,
    borderRadius: radii.pill,
    justifyContent: 'center',
    paddingHorizontal: 9,
  },
  barValue: { fontFamily: fonts.bodyBold, fontSize: 12, color: '#ffffff' },

  seeAll: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: spacing.md,
    marginTop: spacing.xs,
  },
  seeAllText: { fontFamily: fonts.bodySemiBold, fontSize: 13.5, color: colors.green },
})
