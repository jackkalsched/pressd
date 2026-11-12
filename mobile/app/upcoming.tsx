// Upcoming releases — the calendar that opens from the icon beside New &
// Popular on For You, pushed over the tabs. Notable records only (Wikipedia's
// album lists, or an album / EP by an artist with 500,000+ Last.fm listeners:
// backend/upcoming_releases.py), albums and EPs, out to the list's 180 days,
// from GET /discover/upcoming.
//
// A month at a time, drawn as a wall calendar: a day with releases shows the
// cover of its biggest one (by the artist's Last.fm listeners), its date in the
// corner and "+N" for the rest. Tapping it scrolls down to that day in the
// list below, which runs through the month's release days, each day's records
// biggest first. A record opens its album page by name and artist (Deezer's id
// when the list has one), carrying the release date and cover: there's nothing
// to rate yet, but it can go on To Listen.
import { useMemo, useRef, useState } from 'react'
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, ChevronLeft, ChevronRight } from 'lucide-react-native'
import { fetchUpcomingReleases, type UpcomingRelease } from '../lib/api'
import { useAuth } from '../lib/auth'
import { selection } from '../lib/haptics'
import CoverImage from '../components/CoverImage'
import VinylSpinner from '../components/VinylSpinner'
import { colors, fonts, radii, spacing, NUM_SCALE_CAP, useColors } from '../theme/tokens'
import { scrollToTop } from '../lib/scrollToTop'

const DAYS_AHEAD = 180
const COVER = 52
const GAP = 4 // between calendar tiles
const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S']

/** "2026-11-13" read as a local calendar day, never shifted by the time zone. */
function day(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d)
}
const monthKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`

const MONTH_HEAD = new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' })
const DAY_HEAD = new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric' })

function untilText(iso: string): string {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const n = Math.round((day(iso).getTime() - today.getTime()) / 86_400_000)
  return n <= 0 ? 'today' : n === 1 ? 'tomorrow' : `in ${n} days`
}

/** Biggest first within a day: the artist's Last.fm listeners. */
const byListeners = (a: UpcomingRelease, b: UpcomingRelease) =>
  (b.artistListeners ?? 0) - (a.artistListeners ?? 0) || a.artist.localeCompare(b.artist)

type Day = { date: string; releases: UpcomingRelease[] }

export default function Upcoming() {
  const tc = useColors()
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { width } = useWindowDimensions()
  const { user } = useAuth()
  const scroll = useRef<ScrollView>(null)
  const listY = useRef(0)
  const dayY = useRef<Record<string, number>>({})

  const { data, isLoading, isError, refetch, isRefetching } = useQuery({
    queryKey: ['upcoming', user?.id],
    queryFn: () => fetchUpcomingReleases({ days: DAYS_AHEAD, types: ['album', 'ep'], notable: true, limit: 2000 }),
    enabled: !!user,
    staleTime: 30 * 60_000,
  })

  // Release days by month, each day's records biggest first.
  const months = useMemo(() => {
    const out = new Map<string, Day[]>()
    for (const r of data?.releases ?? []) {
      const k = monthKey(day(r.releaseDate))
      const days = out.get(k) ?? []
      let d = days[days.length - 1]
      if (!d || d.date !== r.releaseDate) {
        d = { date: r.releaseDate, releases: [] }
        days.push(d)
      }
      d.releases.push(r)
      out.set(k, days)
    }
    for (const days of out.values()) for (const d of days) d.releases.sort(byListeners)
    return out
  }, [data])
  const monthKeys = useMemo(() => [...months.keys()].sort(), [months])
  const [monthIdx, setMonthIdx] = useState(0)
  const current = monthKeys[Math.min(monthIdx, Math.max(monthKeys.length - 1, 0))]
  const days = useMemo(() => (current && months.get(current)) || [], [months, current])
  const byDate = useMemo(() => new Map(days.map((d) => [d.date, d])), [days])
  const count = days.reduce((n, d) => n + d.releases.length, 0)

  // The grid: blanks before the 1st, then every day of the month.
  const first = current ? day(`${current}-01`) : new Date()
  const daysInMonth = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate()
  const cells: (number | null)[] = [
    ...Array.from({ length: first.getDay() }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ]
  const tile = (width - spacing.lg * 2 - GAP * 6) / 7

  function changeMonth(step: number) {
    selection()
    dayY.current = {}
    setMonthIdx((i) => Math.max(0, Math.min(monthKeys.length - 1, i + step)))
  }

  function jumpTo(date: string) {
    selection()
    const y = dayY.current[date]
    if (y != null) scroll.current?.scrollTo({ y: listY.current + y - spacing.sm, animated: true })
  }

  function open(r: UpcomingRelease) {
    selection()
    const deezer = r.deezerId != null ? String(r.deezerId) : null
    router.push({
      pathname: '/album/[id]',
      params: {
        // The id segment goes unused once name+artist are present.
        id: deezer ?? '0',
        name: r.title,
        artist: r.artist,
        release: r.releaseDate,
        ...(deezer ? { deezer } : {}),
        ...(r.coverUrl ? { cover: r.coverUrl } : {}),
      },
    })
  }

  const header = (
    <View style={styles.header}>
      <Pressable onPress={() => router.back()} hitSlop={12} accessibilityRole="button" accessibilityLabel="Back">
        <ArrowLeft size={22} color={tc.ink} />
      </Pressable>
      <Text style={styles.title} onPress={() => scrollToTop(scroll)} accessibilityRole="button" accessibilityHint="Scrolls to the top">Upcoming</Text>
    </View>
  )

  if (isLoading || isError || monthKeys.length === 0) {
    return (
      <View style={[styles.screen, { paddingTop: insets.top }]}>
        {header}
        <View style={styles.state}>
          {isLoading ? <VinylSpinner size={64} /> : (
            <Text style={styles.stateText}>
              {isError ? 'Couldn’t load upcoming releases.' : 'No upcoming releases yet.'}
            </Text>
          )}
        </View>
      </View>
    )
  }

  const atFirst = monthIdx <= 0
  const atLast = monthIdx >= monthKeys.length - 1

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      {header}
      <ScrollView
        ref={scroll}
        contentContainerStyle={{ paddingBottom: insets.bottom + spacing.xl }}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={tc.green} />}
      >
        <Text style={styles.count} maxFontSizeMultiplier={NUM_SCALE_CAP}>
          {count} {count === 1 ? 'release' : 'releases'} scheduled
        </Text>

        {/* The month, as a wall calendar. */}
        <View style={styles.monthBar}>
          <Pressable onPress={() => changeMonth(-1)} disabled={atFirst} hitSlop={12} accessibilityLabel="Previous month">
            <ChevronLeft size={20} color={atFirst ? tc.border : tc.ink} />
          </Pressable>
          <Text style={styles.monthTitle} maxFontSizeMultiplier={NUM_SCALE_CAP}>
            {MONTH_HEAD.format(first).toUpperCase()}
          </Text>
          <Pressable onPress={() => changeMonth(1)} disabled={atLast} hitSlop={12} accessibilityLabel="Next month">
            <ChevronRight size={20} color={atLast ? tc.border : tc.ink} />
          </Pressable>
        </View>
        <View style={styles.grid}>
          {WEEKDAYS.map((w, i) => (
            <Text key={i} style={[styles.weekday, { width: tile }]} maxFontSizeMultiplier={NUM_SCALE_CAP}>{w}</Text>
          ))}
          {cells.map((n, i) => {
            if (n == null) return <View key={`b${i}`} style={{ width: tile, height: tile }} />
            const iso = `${current}-${String(n).padStart(2, '0')}`
            const d = byDate.get(iso)
            if (!d) {
              return (
                <View key={iso} style={[styles.dayCell, { width: tile, height: tile }]}>
                  <Text style={styles.dayNum} maxFontSizeMultiplier={NUM_SCALE_CAP}>{n}</Text>
                </View>
              )
            }
            const lead = d.releases.find((r) => r.coverUrl) ?? d.releases[0]
            const more = d.releases.length - 1
            return (
              <Pressable
                key={iso}
                onPress={() => jumpTo(iso)}
                style={({ pressed }) => [styles.tile, { width: tile, height: tile }, pressed && { opacity: 0.7 }]}
                accessibilityRole="button"
                accessibilityLabel={`${DAY_HEAD.format(day(iso))}: ${d.releases.length} release${d.releases.length === 1 ? '' : 's'}`}
              >
                {lead.coverUrl ? (
                  <CoverImage url={lead.coverUrl} displayPx={Math.ceil(tile)} style={StyleSheet.absoluteFill} />
                ) : (
                  <View style={[StyleSheet.absoluteFill, styles.tileEmpty]} />
                )}
                <Text style={styles.tileNum} maxFontSizeMultiplier={NUM_SCALE_CAP}>{n}</Text>
                {more > 0 && (
                  <View style={styles.more}>
                    <Text style={styles.moreText} maxFontSizeMultiplier={NUM_SCALE_CAP}>+{more}</Text>
                  </View>
                )}
              </Pressable>
            )
          })}
        </View>

        {/* The month's release days. */}
        <View onLayout={(e) => { listY.current = e.nativeEvent.layout.y }} style={styles.list}>
          {days.map((d) => (
            <View key={d.date} onLayout={(e) => { dayY.current[d.date] = e.nativeEvent.layout.y }}>
              <Text style={styles.dayHead}>{DAY_HEAD.format(day(d.date))}</Text>
              {d.releases.map((r) => (
                  <Pressable
                    key={r.key}
                    onPress={() => open(r)}
                    style={({ pressed }) => [styles.row, pressed && { opacity: 0.6 }]}
                    accessibilityRole="button"
                    accessibilityLabel={`${r.title} by ${r.artist}, ${untilText(r.releaseDate)}`}
                  >
                    {r.coverUrl ? (
                      <CoverImage url={r.coverUrl} displayPx={COVER} style={styles.cover} />
                    ) : (
                      <View style={[styles.cover, styles.coverEmpty]}>
                        <Text style={styles.coverInitial}>{r.title[0]?.toUpperCase()}</Text>
                      </View>
                    )}
                    <View style={styles.rowText}>
                      <Text style={styles.rowTitle} numberOfLines={1}>{r.title}</Text>
                      <Text style={styles.rowArtist} numberOfLines={1}>{r.artist}</Text>
                    </View>
                    <Text style={styles.until} maxFontSizeMultiplier={NUM_SCALE_CAP}>{untilText(r.releaseDate)}</Text>
                  </Pressable>
              ))}
            </View>
          ))}
        </View>
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.xs },
  title: { fontFamily: fonts.display, fontSize: 28, lineHeight: 34, color: colors.ink },
  state: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  stateText: { fontFamily: fonts.bodyMedium, fontSize: 14, color: colors.inkSecondary },
  count: { paddingHorizontal: spacing.lg, fontFamily: fonts.bodyMedium, fontSize: 13, color: colors.inkSecondary },

  monthBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: spacing.lg + 4, marginTop: spacing.lg, marginBottom: spacing.md,
  },
  monthTitle: { fontFamily: fonts.bodySemiBold, fontSize: 12.5, letterSpacing: 0.8, color: colors.ink },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: GAP, paddingHorizontal: spacing.lg },
  weekday: { textAlign: 'center', fontFamily: fonts.bodySemiBold, fontSize: 11.5, color: colors.inkSecondary, marginBottom: spacing.sm },
  dayCell: { alignItems: 'center', justifyContent: 'center' },
  dayNum: { fontFamily: fonts.bodyMedium, fontSize: 14, color: colors.inkTertiary, fontVariant: ['tabular-nums'] },
  tile: { borderRadius: radii.md, overflow: 'hidden', backgroundColor: colors.inset },
  tileEmpty: { backgroundColor: colors.inset },
  // White on a cover, held up by a soft shadow so it reads on a pale one too.
  tileNum: {
    position: 'absolute', top: 4, left: 6, fontFamily: fonts.bodyBold, fontSize: 13, color: '#ffffff',
    textShadowColor: 'rgba(0,0,0,0.55)', textShadowRadius: 3, textShadowOffset: { width: 0, height: 1 },
    fontVariant: ['tabular-nums'],
  },
  more: {
    position: 'absolute', right: 4, bottom: 4, paddingHorizontal: 5, paddingVertical: 1.5,
    borderRadius: radii.pill, backgroundColor: 'rgba(0,0,0,0.6)',
  },
  moreText: { fontFamily: fonts.bodyBold, fontSize: 10.5, color: '#ffffff', fontVariant: ['tabular-nums'] },

  list: { marginTop: spacing.xl, paddingHorizontal: spacing.lg },
  dayHead: { fontFamily: fonts.bodyBold, fontSize: 16, color: colors.ink, paddingTop: spacing.lg, paddingBottom: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: 7 },
  cover: { width: COVER, height: COVER, borderRadius: radii.sm },
  coverEmpty: { backgroundColor: colors.inset, alignItems: 'center', justifyContent: 'center' },
  coverInitial: { fontFamily: fonts.display, fontSize: 20, color: colors.inkTertiary },
  rowText: { flex: 1, minWidth: 0 },
  rowTitle: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.ink },
  rowArtist: { marginTop: 3, fontFamily: fonts.bodyMedium, fontSize: 13, color: colors.inkSecondary },
  until: { fontFamily: fonts.bodySemiBold, fontSize: 12, color: colors.inkSecondary },
})
