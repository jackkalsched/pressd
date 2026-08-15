// Stats — the Profile "Stats" sub-tab, magazine-dashboard style:
//   1. headline card (songs / avg song / perfect 10s / avg year)
//   2. Bang% + Skip% cards with big serif numbers and progress bars
//   3. song score distribution histogram (1–10, red→green)
//   4. genres as horizontal count bars
// plus the most-rated artists list linking into artist pages.
import { useMemo, useState } from 'react'
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native'
import { useQuery } from '@tanstack/react-query'
import { useRouter } from 'expo-router'
import { ChevronDown, ChevronUp } from 'lucide-react-native'
import { fetchArtistStats, fetchGenreStats, fetchSubgenreStats, fetchSongs } from '../lib/api'
import { songScoreColor, BANG_THRESHOLD, SKIP_THRESHOLD } from '@pressd/shared/types'
import type { GenreStat } from '@pressd/shared/api'
import ScoreHistogram from './ScoreHistogram'
import { colors, fonts, spacing } from '../theme/tokens'

// Rows shown before the chart is expanded.
const TAG_PREVIEW = 4

const RED = '#c0392b'

/** @param ownerName  whose stats these are, when they aren't the reader's own.
 *                    Only used to title the pages the bars open — a board
 *                    headed "Your top records" on a friend's profile would be
 *                    showing one person's ratings under another's name. */
export default function StatsView({ userId, ownerName }: { userId: number; ownerName?: string }) {
  const router = useRouter()
  const { data: artists = [], isLoading } = useQuery({
    queryKey: ['artist-stats', userId],
    queryFn: () => fetchArtistStats(userId),
    enabled: userId > 0,
  })
  const { data: songs = [] } = useQuery({
    queryKey: ['songs', 'all', userId],
    queryFn: () => fetchSongs({ userId }),
    enabled: userId > 0,
    staleTime: 5 * 60_000,
  })
  const { data: genres = [] } = useQuery({
    queryKey: ['genre-stats', userId],
    queryFn: () => fetchGenreStats(userId),
    enabled: userId > 0,
    staleTime: 5 * 60_000,
  })
  const { data: subgenres = [] } = useQuery({
    queryKey: ['subgenre-stats', userId],
    queryFn: () => fetchSubgenreStats(userId),
    enabled: userId > 0,
    staleTime: 5 * 60_000,
  })

  const scored = songs.filter((s) => s.score != null).map((s) => s.score!)
  const bangs = scored.filter((s) => s >= BANG_THRESHOLD).length
  const skips = scored.filter((s) => s < SKIP_THRESHOLD).length
  const bangPct = scored.length ? (bangs / scored.length) * 100 : null
  const skipPct = scored.length ? (skips / scored.length) * 100 : null

  const topArtists = [...artists].sort((a, b) => b.count - a.count).slice(0, 15)

  return (
    <View style={styles.wrap}>
      {/* Bang vs skip — one joined distribution, mids gray (per the share card) */}
      <View style={styles.bsCard}>
        <View style={styles.bsHead}>
          <View>
            <Text style={[styles.bsValue, { color: colors.green }]} numberOfLines={1} adjustsFontSizeToFit>
              {bangPct != null ? bangPct.toFixed(1) : '—'}%
            </Text>
            <Text style={styles.bsLabel}>BANGS</Text>
            <Text style={styles.bsCaption}>{bangs.toLocaleString()} songs · {BANG_THRESHOLD.toFixed(1)}+</Text>
          </View>
          <Text style={styles.bsVs}>vs</Text>
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={[styles.bsValue, { color: RED }]} numberOfLines={1} adjustsFontSizeToFit>
              {skipPct != null ? skipPct.toFixed(1) : '—'}%
            </Text>
            <Text style={styles.bsLabel}>SKIPS</Text>
            <Text style={styles.bsCaption}>{skips.toLocaleString()} songs · under {SKIP_THRESHOLD.toFixed(1)}</Text>
          </View>
        </View>
        <View style={styles.bsBar}>
          <View style={{ flex: Math.max(bangs, 0.0001), backgroundColor: colors.green, borderRadius: 99 }} />
          <View style={{ flex: Math.max(scored.length - bangs - skips, 0.0001), backgroundColor: 'rgba(120,100,80,0.2)', borderRadius: 99 }} />
          <View style={{ flex: Math.max(skips, 0.0001), backgroundColor: RED, borderRadius: 99 }} />
        </View>
        <View style={styles.bsCounts}>
          <Text style={styles.bsCount}>{bangs.toLocaleString()} {bangs === 1 ? 'BANG' : 'BANGS'}</Text>
          <Text style={styles.bsCount}>{skips.toLocaleString()} {skips === 1 ? 'SKIP' : 'SKIPS'}</Text>
        </View>
      </View>

      {/* Score distribution */}
      <Text style={styles.sectionLabel}>SCORE DISTRIBUTION</Text>
      <ScoreHistogram scores={scored} />

      <TagBars label="GENRES" kind="genre" rows={genres} userId={userId} ownerName={ownerName} />
      <TagBars label="SUBGENRES" kind="subgenre" rows={subgenres} userId={userId} ownerName={ownerName} />

      {/* Most rated artists */}
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

/** A count-ranked bar chart that opens up, each bar a link to its records.
 *
 *  Four rows is enough to read the shape of someone's taste; the rest is a long
 *  tail that would push everything below it off the page. Subgenres especially —
 *  75 of them here against 11 genres.
 *
 *  Bars are scaled to the largest row currently shown, not to the largest
 *  overall, so a collapsed chart uses its full width instead of leaving the top
 *  bar short in anticipation of rows nobody can see yet.
 */
function TagBars({
  label,
  kind,
  rows,
  userId,
  ownerName,
}: {
  label: string
  kind: 'genre' | 'subgenre'
  rows: GenreStat[]
  userId: number
  ownerName?: string
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const ranked = useMemo(() => [...rows].sort((a, b) => b.count - a.count), [rows])
  if (ranked.length === 0) return null

  const shown = open ? ranked : ranked.slice(0, TAG_PREVIEW)
  const max = Math.max(1, ...shown.map((g) => g.count))

  return (
    <>
      <Text style={styles.sectionLabel}>{label}</Text>
      {shown.map((g) => (
        <Pressable
          key={g.genre}
          style={styles.genreRow}
          accessibilityRole="button"
          accessibilityLabel={`${g.genre}, ${g.count} records`}
          onPress={() =>
            router.push({
              pathname: '/genre/[tag]',
              params: {
                tag: encodeURIComponent(g.genre),
                kind,
                userId: String(userId),
                // Omitted for your own stats, which is what the board reads as
                // "yours" — an empty string would title it "'s top records".
                ...(ownerName ? { owner: encodeURIComponent(ownerName) } : {}),
              },
            })
          }
        >
          <Text style={styles.genreName} numberOfLines={1}>{g.genre}</Text>
          <View style={styles.genreTrack}>
            <View style={[styles.genreFill, { width: `${(g.count / max) * 100}%` }]} />
          </View>
          <Text style={styles.genreCount}>{g.count}</Text>
        </Pressable>
      ))}
      {ranked.length > TAG_PREVIEW && (
        <Pressable style={styles.moreBtn} onPress={() => setOpen((v) => !v)} hitSlop={6}>
          <Text style={styles.moreText}>
            {open ? 'Show less' : `See all ${ranked.length}`}
          </Text>
          {open ? (
            <ChevronUp size={14} color={colors.green} />
          ) : (
            <ChevronDown size={14} color={colors.green} />
          )}
        </Pressable>
      )}
    </>
  )
}

const styles = StyleSheet.create({
  wrap: { marginTop: spacing.lg },

  bsCard: { marginTop: spacing.sm },
  bsHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  bsValue: { fontFamily: fonts.display, fontSize: 34, lineHeight: 38 },
  bsLabel: { fontFamily: fonts.bodyBold, fontSize: 11, letterSpacing: 1.4, color: colors.ink, marginTop: 3 },
  bsCaption: { fontFamily: fonts.body, fontSize: 11.5, color: colors.inkTertiary, marginTop: 2 },
  bsVs: { fontFamily: fonts.display, fontSize: 16, color: colors.inkMuted },
  bsBar: { flexDirection: 'row', gap: 4, height: 14, marginTop: spacing.lg },
  bsCounts: { flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing.sm },
  bsCount: { fontFamily: fonts.bodySemiBold, fontSize: 11, letterSpacing: 0.6, color: colors.inkMuted },

  sectionLabel: {
    fontFamily: fonts.bodyBold,
    fontSize: 11,
    letterSpacing: 1.2,
    color: colors.inkMuted,
    marginTop: spacing.xl,
    marginBottom: spacing.sm,
  },


  moreBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    alignSelf: 'flex-start',
    paddingVertical: spacing.sm,
  },
  moreText: { fontFamily: fonts.bodySemiBold, fontSize: 13, color: colors.green },
  genreRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: 7 },
  genreName: { width: 88, fontFamily: fonts.bodyMedium, fontSize: 14, color: colors.ink },
  genreTrack: { flex: 1, height: 8, borderRadius: 4, backgroundColor: colors.inset, overflow: 'hidden' },
  genreFill: { height: '100%', borderRadius: 4, backgroundColor: colors.green },
  genreCount: { width: 30, textAlign: 'right', fontFamily: fonts.bodyBold, fontSize: 14, color: colors.ink },

  artistRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  artistName: { fontFamily: fonts.bodySemiBold, fontSize: 15, color: colors.ink },
  artistMeta: { fontFamily: fonts.body, fontSize: 12, color: colors.inkTertiary, marginTop: 1 },
  artistScore: { fontFamily: fonts.bodyBold, fontSize: 17 },
  empty: { fontFamily: fonts.body, fontSize: 14, color: colors.inkTertiary, marginTop: spacing.md },
})
