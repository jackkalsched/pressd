// Charts — the userbase-wide album chart. A magazine-style board: dropdown
// filters (period / genre / decade) plus a type-in year, a top-three podium
// with the #1 raised, then the ranked list out to 50, each row showing its
// day-over-day movement. Defaults to This Week with no other filters.
import { useMemo, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Animated,
  Dimensions,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'
import { useQuery } from '@tanstack/react-query'
import { Image } from 'expo-image'
import { useRouter } from 'expo-router'
import { Check, ChevronDown, Triangle, X } from 'lucide-react-native'
import { fetchCharts, type ChartItem } from '../../lib/api'
import { songScoreColor, avatarColor } from '@pressd/shared/types'
import { colors, fonts, radii, spacing } from '../../theme/tokens'

const DOWN = '#c0392b'

// Podium sizes derived from the viewport: sides 30%, center 40% of the row,
// leaving generous air between the three covers.
const CONTENT_W = Dimensions.get('window').width - spacing.lg * 2
const POD_GAP = spacing.xl
const POD_AVAIL = CONTENT_W - POD_GAP * 2
const POD_SIDE = Math.floor(POD_AVAIL * 0.3)
const POD_CENTER = Math.floor(POD_AVAIL * 0.4)

// ISO week number, to date the board like a print chart ("WK 30 · 2026").
function weekLabel(): string {
  const d = new Date()
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
  const dayNum = (t.getUTCDay() + 6) % 7
  t.setUTCDate(t.getUTCDate() - dayNum + 3)
  const firstThursday = new Date(Date.UTC(t.getUTCFullYear(), 0, 4))
  const week =
    1 + Math.round(((t.getTime() - firstThursday.getTime()) / 86_400_000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7)
  return `WK ${week} · ${t.getUTCFullYear()}`
}

export default function Charts() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const [period, setPeriod] = useState<'week' | 'all'>('week')
  const [genre, setGenre] = useState<string | null>(null)
  const [decade, setDecade] = useState<number | null>(null)
  const [yearText, setYearText] = useState('')
  const year = /^\d{4}$/.test(yearText) ? Number(yearText) : null

  const { data, isLoading } = useQuery({
    queryKey: ['charts', period, genre ?? '', decade ?? '', year ?? ''],
    queryFn: () =>
      fetchCharts({
        period,
        genre: genre ?? undefined,
        decade: decade ?? undefined,
        year: year ?? undefined,
      }),
    staleTime: 5 * 60_000,
  })

  const items = data?.items ?? []
  const podium = items.slice(0, 3)
  const rest = items.slice(3)
  const facets = data?.facets

  // The chart ranks albums across the whole userbase, so entries open the
  // averaged view rather than one person's copy.
  function openAlbum(id: number) {
    router.push({ pathname: '/album/[id]', params: { id: String(id), community: '1' } })
  }

  // Scroll-reactive masthead, matching For You / Social: the big title lifts +
  // fades as you scroll and a compact title bar fades in below the status bar.
  const scrollY = useRef(new Animated.Value(0)).current
  const mastheadOpacity = scrollY.interpolate({ inputRange: [0, 70], outputRange: [1, 0], extrapolate: 'clamp' })
  const mastheadShift = scrollY.interpolate({ inputRange: [0, 70], outputRange: [0, -14], extrapolate: 'clamp' })
  const compactOpacity = scrollY.interpolate({ inputRange: [36, 82], outputRange: [0, 1], extrapolate: 'clamp' })
  const onScroll = Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], { useNativeDriver: true })

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      {/* Absolute children ignore the SafeAreaView's inset padding, so push the
          compact bar down below the status bar (clock) explicitly. */}
      <Animated.View
        style={[styles.compactHeader, { opacity: compactOpacity, paddingTop: insets.top + spacing.sm }]}
        pointerEvents="none"
      >
        <Text style={styles.compactTitle}>Charts</Text>
      </Animated.View>
      <Animated.FlatList
        data={rest}
        keyExtractor={(it) => String(it.album_id)}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        onScroll={onScroll}
        scrollEventThrottle={16}
        ListHeaderComponent={
          <View>
            {/* Masthead */}
            <Animated.View style={{ opacity: mastheadOpacity, transform: [{ translateY: mastheadShift }] }}>
              <View style={styles.masthead}>
                <Text style={styles.title}>Charts</Text>
                <Text style={styles.week}>{period === 'week' ? weekLabel() : 'ALL TIME'}</Text>
              </View>
              <View style={styles.rule} />
            </Animated.View>

            {/* Filters — dropdowns + a type-in year */}
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.filterRow}
              style={styles.filterScroll}
              keyboardShouldPersistTaps="handled"
            >
              <FilterDropdown
                title="Period"
                display={period === 'week' ? 'This Week' : 'All Time'}
                active
                options={[
                  { key: 'week', label: 'This Week', value: 'week', selected: period === 'week' },
                  { key: 'all', label: 'All Time', value: 'all', selected: period === 'all' },
                ]}
                onSelect={(v) => setPeriod(v as 'week' | 'all')}
              />
              <FilterDropdown
                title="Genre"
                display={genre ?? 'Genre'}
                active={genre != null}
                options={[
                  { key: 'all', label: 'All genres', value: '', selected: genre == null },
                  ...(facets?.genres ?? []).map((g) => ({ key: g, label: g, value: g, selected: genre === g })),
                ]}
                onSelect={(v) => setGenre(v ? String(v) : null)}
              />
              <FilterDropdown
                title="Decade"
                display={decade != null ? `${decade}s` : 'Decade'}
                active={decade != null}
                options={[
                  { key: 'all', label: 'All decades', value: 0, selected: decade == null },
                  ...(facets?.decades ?? []).map((d) => ({ key: String(d), label: `${d}s`, value: d, selected: decade === d })),
                ]}
                onSelect={(v) => setDecade(Number(v) ? Number(v) : null)}
              />
              {/* Year type-in */}
              <View style={[styles.filterBtn, year != null && styles.filterBtnOn]}>
                <TextInput
                  style={[styles.yearInput, year != null && styles.filterTextOn]}
                  value={yearText}
                  onChangeText={(t) => setYearText(t.replace(/[^0-9]/g, '').slice(0, 4))}
                  placeholder="Year"
                  placeholderTextColor={colors.inkTertiary}
                  keyboardType="number-pad"
                  maxLength={4}
                  returnKeyType="done"
                />
                {yearText ? (
                  <Pressable onPress={() => setYearText('')} hitSlop={6}>
                    <X size={13} color={year != null ? colors.green : colors.inkTertiary} />
                  </Pressable>
                ) : null}
              </View>
            </ScrollView>

            {isLoading && items.length === 0 ? (
              <ActivityIndicator color={colors.green} style={{ marginTop: spacing.xxl }} />
            ) : items.length === 0 ? (
              <Text style={styles.empty}>No rated albums match these filters yet.</Text>
            ) : (
              <Podium items={podium} onOpen={openAlbum} />
            )}
          </View>
        }
        renderItem={({ item }) => <ChartRow item={item} onOpen={openAlbum} />}
      />
    </SafeAreaView>
  )
}

function FilterDropdown({
  title,
  display,
  active,
  options,
  onSelect,
}: {
  title: string
  display: string
  active: boolean
  options: { key: string; label: string; value: string | number; selected: boolean }[]
  onSelect: (v: string | number) => void
}) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Pressable style={[styles.filterBtn, active && styles.filterBtnOn]} onPress={() => setOpen(true)}>
        <Text style={[styles.filterText, active && styles.filterTextOn]}>{display}</Text>
        <ChevronDown size={13} color={active ? colors.green : colors.inkTertiary} />
      </Pressable>
      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)}>
          <Pressable style={styles.sheet}>
            <Text style={styles.sheetTitle}>{title}</Text>
            <ScrollView style={{ maxHeight: 340 }}>
              {options.map((o) => (
                <Pressable
                  key={o.key}
                  style={styles.optionRow}
                  onPress={() => {
                    onSelect(o.value)
                    setOpen(false)
                  }}
                >
                  <Text style={styles.optionText}>{o.label}</Text>
                  {o.selected && <Check size={18} color={colors.green} />}
                </Pressable>
              ))}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  )
}

function Podium({ items, onOpen }: { items: ChartItem[]; onOpen: (id: number) => void }) {
  const [one, two, three] = items
  return (
    <View style={styles.podium}>
      {two && <PodiumTile item={two} size={POD_SIDE} onOpen={onOpen} />}
      {one && <PodiumTile item={one} size={POD_CENTER} onOpen={onOpen} />}
      {three && <PodiumTile item={three} size={POD_SIDE} onOpen={onOpen} />}
    </View>
  )
}

function PodiumTile({ item, size, onOpen }: { item: ChartItem; size: number; onOpen: (id: number) => void }) {
  return (
    <Pressable style={[styles.podCol, { width: size }]} onPress={() => onOpen(item.album_id)}>
      <View style={[styles.podTile, { width: size, height: size }]}>
        {item.album_art_url ? (
          <Image source={{ uri: item.album_art_url }} style={styles.podImg} contentFit="cover" />
        ) : (
          <View style={[styles.podImg, styles.podFallback, { backgroundColor: avatarColor(item.album_name) }]}>
            <Text style={[styles.podLetter, { fontSize: size * 0.4 }]}>{item.album_name[0]?.toUpperCase()}</Text>
          </View>
        )}
      </View>
      <View style={styles.podMeta}>
        <Text style={styles.podRank}>{item.rank}</Text>
        {item.avg_score != null && (
          <Text style={[styles.podScore, { color: songScoreColor(item.avg_score) }]}>
            {item.avg_score.toFixed(2)}
          </Text>
        )}
      </View>
      <Text style={styles.podName} numberOfLines={1}>{item.album_name}</Text>
      <Text style={styles.podArtist} numberOfLines={1}>{item.artist}</Text>
    </Pressable>
  )
}

function Movement({ value }: { value: number | null }) {
  if (value == null || value === 0) return <Text style={styles.moveFlat}>–</Text>
  const up = value > 0
  const color = up ? colors.green : DOWN
  return (
    <View style={styles.moveWrap}>
      {up ? (
        <Triangle size={9} color={color} fill={color} />
      ) : (
        <View style={{ transform: [{ rotate: '180deg' }] }}>
          <Triangle size={9} color={color} fill={color} />
        </View>
      )}
      <Text style={[styles.moveNum, { color }]}>{Math.abs(value)}</Text>
    </View>
  )
}

function ChartRow({ item, onOpen }: { item: ChartItem; onOpen: (id: number) => void }) {
  return (
    <Pressable style={styles.row} onPress={() => onOpen(item.album_id)}>
      <Text style={styles.rowRank}>{item.rank}</Text>
      <View style={styles.moveCol}>
        <Movement value={item.movement} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={styles.rowName} numberOfLines={1}>{item.album_name}</Text>
        <Text style={styles.rowArtist} numberOfLines={1}>{item.artist}</Text>
      </View>
      {item.avg_score != null && (
        <Text style={[styles.rowScore, { color: songScoreColor(item.avg_score) }]}>
          {item.avg_score.toFixed(2)}
        </Text>
      )}
    </Pressable>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: spacing.lg, paddingBottom: 130 },

  compactHeader: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 20,
    backgroundColor: colors.bg,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  compactTitle: { fontFamily: fonts.displayBlack, fontSize: 22, color: colors.ink, letterSpacing: 0.5 },

  masthead: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', marginTop: spacing.md },
  title: { fontFamily: fonts.displayBlack, fontSize: 40, color: colors.ink, letterSpacing: 0.5 },
  week: { fontFamily: fonts.bodyBold, fontSize: 12, letterSpacing: 1.4, color: colors.inkTertiary, marginBottom: 8 },
  rule: { height: 2, backgroundColor: colors.ink, marginTop: spacing.sm },

  // Filters
  filterScroll: { flexGrow: 0, marginTop: spacing.lg },
  filterRow: { gap: spacing.sm, alignItems: 'center', paddingRight: spacing.lg },
  filterBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    minHeight: 36,
    paddingVertical: 7,
    paddingHorizontal: 14,
    borderRadius: radii.pill,
    backgroundColor: colors.inset,
  },
  filterBtnOn: { backgroundColor: colors.greenSoft },
  filterText: { fontFamily: fonts.bodySemiBold, fontSize: 13, color: colors.inkSecondary },
  filterTextOn: { color: colors.green },
  yearInput: { fontFamily: fonts.bodySemiBold, fontSize: 13, color: colors.inkSecondary, minWidth: 42, padding: 0 },

  backdrop: { flex: 1, backgroundColor: 'rgba(28,25,23,0.4)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.bg,
    borderTopLeftRadius: radii.xl,
    borderTopRightRadius: radii.xl,
    paddingTop: spacing.lg,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xxl,
  },
  sheetTitle: { fontFamily: fonts.bodySemiBold, fontSize: 16, color: colors.ink, marginBottom: spacing.sm },
  optionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  optionText: { fontFamily: fonts.bodyMedium, fontSize: 15, color: colors.ink },

  // Podium
  podium: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'center', gap: POD_GAP, marginTop: spacing.xl, marginBottom: spacing.xxl },
  podCol: { alignItems: 'center' },
  podTile: {
    borderRadius: radii.lg,
    overflow: 'hidden',
    shadowColor: '#1c1917',
    shadowOpacity: 0.14,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
    elevation: 6,
  },
  podImg: { width: '100%', height: '100%' },
  podFallback: { alignItems: 'center', justifyContent: 'center' },
  podLetter: { fontFamily: fonts.display, color: 'rgba(255,255,255,0.92)' },
  podMeta: { flexDirection: 'row', alignItems: 'baseline', gap: 6, marginTop: spacing.sm },
  podRank: { fontFamily: fonts.displayBlack, fontSize: 26, color: colors.ink },
  podScore: { fontFamily: fonts.bodyBold, fontSize: 14 },
  podName: { fontFamily: fonts.bodyBold, fontSize: 14, color: colors.ink, marginTop: 2, maxWidth: '100%' },
  podArtist: { fontFamily: fonts.body, fontSize: 12, color: colors.inkTertiary, marginTop: 1 },

  // Ranked list
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  rowRank: { fontFamily: fonts.displayBlack, fontSize: 19, color: colors.ink, width: 28, textAlign: 'center' },
  moveCol: { width: 32, alignItems: 'center' },
  moveWrap: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  moveNum: { fontFamily: fonts.bodyBold, fontSize: 10 },
  moveFlat: { fontFamily: fonts.bodyMedium, fontSize: 13, color: colors.inkMuted },
  rowName: { fontFamily: fonts.bodySemiBold, fontSize: 13, color: colors.ink },
  rowArtist: { fontFamily: fonts.body, fontSize: 12, color: colors.inkTertiary, marginTop: 1 },
  rowScore: { fontFamily: fonts.bodyBold, fontSize: 15, marginLeft: spacing.lg },

  empty: { fontFamily: fonts.body, fontSize: 14, color: colors.inkTertiary, textAlign: 'center', marginTop: spacing.xxl },
})
