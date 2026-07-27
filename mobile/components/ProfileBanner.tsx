// The green profile header, shared by your own Profile tab and a friend's
// page: identity, an average-score ring, four headline stats, and taste chips
// that straddle the banner's bottom edge. The `action` slot holds whatever
// control belongs to the viewer (sign out on your own page, add/remove friend
// on someone else's).
import { useMemo, useState, type ReactNode } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { Image } from 'expo-image'
import Svg, { Circle } from 'react-native-svg'
import { colors, fonts, radii, spacing } from '../theme/tokens'

export interface BannerStatItem {
  value: string
  label: string
}

export default function ProfileBanner({
  name,
  avatarUrl,
  since,
  avg,
  stats,
  genres,
  subgenres,
  action,
  topInset,
}: {
  name: string
  avatarUrl?: string | null
  since?: string | null
  avg: number | null
  stats: BannerStatItem[]
  genres: string[]
  subgenres: string[]
  action?: ReactNode
  topInset: number
}) {
  const [expanded, setExpanded] = useState(false)
  const [rowW, setRowW] = useState(0)
  const [widths, setWidths] = useState<number[]>([])

  // Genres lead, subgenres follow; the split between shown and collapsed is
  // decided purely by what fits, not by which kind a tag is.
  const tags = useMemo(
    () => [
      ...genres.map((label) => ({ label, sub: false })),
      ...subgenres.map((label) => ({ label, sub: true })),
    ],
    [genres, subgenres],
  )

  // Chip text width + its own horizontal padding/border; the count chip needs
  // room reserved on the line whenever anything is going to overflow.
  const CHIP_PAD = 24
  const GAP = 6
  const MORE_W = 46

  const fitCount = useMemo(() => {
    if (!rowW || widths.length < tags.length || widths.some((w) => w == null)) return tags.length
    const fits = (budget: number) => {
      let used = 0
      let n = 0
      for (let i = 0; i < tags.length; i++) {
        const w = widths[i] + CHIP_PAD + (i > 0 ? GAP : 0)
        if (used + w > budget) break
        used += w
        n += 1
      }
      return n
    }
    const all = fits(rowW)
    if (all >= tags.length) return tags.length
    return Math.max(1, fits(rowW - MORE_W - GAP))
  }, [rowW, widths, tags])

  const shownTags = tags.slice(0, fitCount)
  const overflowTags = tags.slice(fitCount)
  const overflowCount = overflowTags.length

  return (
    <>
      <View style={[styles.banner, { paddingTop: topInset + spacing.sm }]}>
        <View style={styles.bannerTop}>
          <View style={styles.avatar}>
            {avatarUrl ? (
              <Image source={{ uri: avatarUrl }} style={styles.avatarImg} contentFit="cover" />
            ) : (
              <Text style={styles.avatarInitial}>{name[0]?.toUpperCase()}</Text>
            )}
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.name} numberOfLines={1}>{name}</Text>
            {since ? <Text style={styles.since} numberOfLines={1}>Pressing since {since}</Text> : null}
          </View>
          <AvgRing value={avg} />
          {action}
        </View>

        <View style={styles.stats}>
          {stats.map((s) => (
            <View key={s.label} style={styles.statCol}>
              <Text style={styles.statValue}>{s.value}</Text>
              <Text style={styles.statLabel}>{s.label}</Text>
            </View>
          ))}
        </View>
      </View>

      {/* Taste chips ride the banner boundary: genres first (green outline),
          then subgenres (gray). Only as many as actually fit the line are
          shown — the rest collapse behind a count chip that reveals them
          below, so the headline row is always exactly one line. */}
      {tags.length > 0 && (
        <>
          {/* Off-screen pass that measures each chip at its natural width;
              the visible row is sliced from these, so it never reflows. */}
          <View style={styles.measure} pointerEvents="none">
            {tags.map((t, i) => (
              <View key={`m-${t.label}`} style={[styles.chip, styles.chipNatural, t.sub ? styles.chipSub : styles.chipGenre]}>
                <Text
                  style={t.sub ? styles.chipSubText : styles.chipGenreText}
                  onLayout={(e) => {
                    const w = e.nativeEvent.layout.width
                    setWidths((prev) => {
                      if (Math.abs((prev[i] ?? -1) - w) < 0.5) return prev
                      const next = [...prev]
                      next[i] = w
                      return next
                    })
                  }}
                >
                  {t.label}
                </Text>
              </View>
            ))}
          </View>

          <View style={styles.chipsRow} onLayout={(e) => setRowW(e.nativeEvent.layout.width)}>
            {shownTags.map((t) => (
              <View key={t.label} style={[styles.chip, t.sub ? styles.chipSub : styles.chipGenre]}>
                <Text style={t.sub ? styles.chipSubText : styles.chipGenreText} numberOfLines={1}>{t.label}</Text>
              </View>
            ))}
            {(overflowCount > 0 || expanded) && (
              <Pressable
                style={[styles.chip, styles.chipMore]}
                onPress={() => setExpanded((v) => !v)}
                hitSlop={6}
                accessibilityLabel={expanded ? 'Show fewer tags' : `Show ${overflowCount} more tags`}
              >
                <Text style={styles.chipMoreText}>{expanded ? 'Hide' : `+${overflowCount}`}</Text>
              </Pressable>
            )}
          </View>

          {expanded && overflowTags.length > 0 && (
            <View style={styles.subRow}>
              {overflowTags.map((t) => (
                <View key={`o-${t.label}`} style={[styles.chip, t.sub ? styles.chipSub : styles.chipGenre]}>
                  <Text style={t.sub ? styles.chipSubText : styles.chipGenreText} numberOfLines={1}>{t.label}</Text>
                </View>
              ))}
            </View>
          )}
        </>
      )}
    </>
  )
}

/** Average-score gauge: a ring filled to score/10, value centered. */
function AvgRing({ value }: { value: number | null }) {
  const R = 24
  const SW = 4.5
  const SIZE = (R + SW) * 2 + 2
  const C = 2 * Math.PI * R
  const frac = value != null ? Math.max(0, Math.min(1, value / 10)) : 0
  const mid = SIZE / 2
  return (
    <View style={{ width: SIZE, height: SIZE }}>
      <Svg width={SIZE} height={SIZE}>
        <Circle cx={mid} cy={mid} r={R} stroke="rgba(255,255,255,0.18)" strokeWidth={SW} fill="none" />
        {value != null && (
          <Circle
            cx={mid}
            cy={mid}
            r={R}
            stroke="#a9d5b4"
            strokeWidth={SW}
            fill="none"
            strokeDasharray={`${C * frac} ${C}`}
            strokeLinecap="round"
            transform={`rotate(-90 ${mid} ${mid})`}
          />
        )}
      </Svg>
      <View style={styles.ringCenter}>
        <Text style={styles.ringValue}>{value != null ? value.toFixed(2) : '—'}</Text>
        <Text style={styles.ringLabel}>AVG</Text>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  banner: {
    backgroundColor: colors.green,
    marginHorizontal: -spacing.lg,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.lg + 10,
  },
  bannerTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginTop: spacing.sm },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  avatarImg: { width: '100%', height: '100%' },
  avatarInitial: { fontFamily: fonts.display, fontSize: 24, color: colors.green },
  name: { fontFamily: fonts.displayBlack, fontSize: 25, color: '#ffffff', letterSpacing: 0.3 },
  since: { fontFamily: fonts.bodyMedium, fontSize: 12.5, color: 'rgba(255,255,255,0.65)', marginTop: 2 },

  ringCenter: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  ringValue: { fontFamily: fonts.display, fontSize: 13.5, color: '#ffffff' },
  ringLabel: { fontFamily: fonts.bodyBold, fontSize: 7, letterSpacing: 1, color: 'rgba(255,255,255,0.65)' },

  stats: { flexDirection: 'row', marginTop: spacing.lg },
  statCol: { flex: 1, alignItems: 'flex-start' },
  statValue: { fontFamily: fonts.display, fontSize: 22, color: '#ffffff' },
  statLabel: {
    fontFamily: fonts.bodyMedium,
    fontSize: 9.5,
    color: 'rgba(255,255,255,0.6)',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginTop: 2,
  },

  chipsRow: {
    flexDirection: 'row',
    flexWrap: 'nowrap',
    alignItems: 'center',
    gap: 6,
    marginTop: -14,
    zIndex: 2,
  },
  // Off-screen measuring row — natural widths, never painted.
  measure: { position: 'absolute', top: 0, left: 0, flexDirection: 'row', opacity: 0 },
  chipNatural: { flexShrink: 0 },
  chip: {
    backgroundColor: '#ffffff',
    borderRadius: radii.pill,
    borderWidth: 1.5,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  chipGenre: { borderColor: colors.green },
  chipGenreText: { fontFamily: fonts.bodySemiBold, fontSize: 12.5, color: colors.green },
  // The count chip is filled rather than outlined, so it reads as a control
  // next to the tag labels instead of another tag.
  chipMore: { backgroundColor: colors.inset, borderColor: colors.inset },
  chipMoreText: { fontFamily: fonts.bodySemiBold, fontSize: 12.5, color: colors.inkTertiary },
  subRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6, marginTop: spacing.sm },
  chipSub: { borderColor: '#c9c2b8' },
  chipSubText: { fontFamily: fonts.bodyMedium, fontSize: 12.5, color: colors.inkTertiary },
})
