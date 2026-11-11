// One bin — the Apple Music 100 Best Albums, say. A banner across the top of
// the screen fans out the bin's first three records over a blur of the first,
// ending in a hard edge. Below it, centred, the bare Pressd mark on Pressd's bins and
// the title; then your progress — a cell per record, in the list's order — the
// sort, and the records.
//
// Its records in the list's
// order (or by the Pressd average, or by your predicted score once picks are
// unlocked), each with your score or where it sits in your library, or Rate
// now / Add. The header holds how far through it you are.
//
// A record always opens as its Pressd page (the community view): through your
// copy's id when you have one, otherwise by name, which handles a record
// nobody on Pressd has rated yet.
import { useMemo, useRef, useState } from 'react'
import { AccessibilityInfo, Alert, FlatList, LayoutAnimation, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { StatusBar } from 'expo-status-bar'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, ArrowUpDown, Bookmark, ChevronDown, Star } from 'lucide-react-native'
import { addBinEntry, fetchBin, type BinEntry } from '../../lib/api'
import { BIN_SORT_DIR, binEntryMatches, binSortLabel, sortBinEntries, type BinSort, type BinSortDir } from '@pressd/shared/binSort'
import BinSearch from '../../components/BinSearch'
import AnchoredMenu from '../../components/AnchoredMenu'
import { useAuth } from '../../lib/auth'
import { selection, success } from '../../lib/haptics'
import { scrollToTop } from '../../lib/scrollToTop'
import BinProgress from '../../components/BinProgress'
import CoverImage from '../../components/CoverImage'
import { Image } from 'expo-image'
import VinylSpinner from '../../components/VinylSpinner'
import { colors, fonts, NUM_SCALE_CAP, radii, scoreColor, spacing, useColors } from '../../theme/tokens'

const COVER = 120
// The banner's height below the status bar. It ends in a hard edge, no fade
// into the page (Jack's call).
const BANNER = 230
// The fan of three covers on the banner.
const FAN_FRONT = 156
const FAN_SIDE = 122
const FAN_SPREAD = 96
// The title's cream, whatever the appearance: the banner under it is always dark.
const CREAM = '#f9f8f6'

// Reordering slides each row from its old place to its new one. Skipped under
// Reduce Motion, where the list just changes.
let reduceMotion = false
AccessibilityInfo.isReduceMotionEnabled().then((v) => { reduceMotion = v }).catch(() => {})
function slideRows() {
  if (reduceMotion) return
  LayoutAnimation.configureNext({
    duration: 420,
    update: { type: LayoutAnimation.Types.spring, springDamping: 0.82 },
    create: { type: LayoutAnimation.Types.easeOut, property: LayoutAnimation.Properties.opacity, duration: 220 },
    delete: { type: LayoutAnimation.Types.easeIn, property: LayoutAnimation.Properties.opacity, duration: 160 },
  })
}

/** The faint hairline between two ranks. A fill, not a border, so it can take
 *  the dynamic colour (borders can't, on iOS). */
function RankRule() {
  return <View style={styles.rule} />
}

/** A labelled number under a record: the Pressd average, yours, your
 *  predicted, or (`count`) how many people rated it. `muted` is the one the
 *  order isn't about — smaller, in grey. */
function Figure({ label, value, muted = false, count = false, places = 2 }: {
  label: string
  value: number
  muted?: boolean
  count?: boolean
  /** Two for an album's score, one for a song's. */
  places?: number
}) {
  return (
    <View style={styles.figure}>
      <Text style={styles.figureLabel} maxFontSizeMultiplier={NUM_SCALE_CAP}>{label}</Text>
      <Text
        style={muted ? styles.figureMuted : [styles.figureValue, { color: count ? colors.ink : scoreColor(value) }]}
        maxFontSizeMultiplier={NUM_SCALE_CAP}
      >
        {count ? value : value.toFixed(places)}
      </Text>
    </View>
  )
}

/** "1998 · Pop" for a record; "from Fever to Tell · 2003" for a song. */
function details(e: BinEntry): string {
  if (e.songTitle) return [e.albumName ? `from ${e.albumName}` : null, e.year].filter(Boolean).join(' · ')
  return [e.year, e.genre].filter(Boolean).join(' · ')
}

export default function BinPage() {
  const tc = useColors()
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const queryClient = useQueryClient()
  const { user } = useAuth()
  const { slug } = useLocalSearchParams<{ slug: string }>()
  const list = useRef<FlatList<BinEntry>>(null)
  const [sort, setSort] = useState<BinSort>('list')
  const [dir, setDir] = useState<BinSortDir>('asc')
  const [sortOpen, setSortOpen] = useState(false)
  const sortRef = useRef<View>(null)
  const [busy, setBusy] = useState<number | null>(null)

  const { data, isLoading, isError, refetch, isRefetching } = useQuery({
    queryKey: ['bin', slug, user?.id],
    queryFn: () => fetchBin(slug!),
    enabled: !!user && !!slug,
  })

  const [query, setQuery] = useState('')
  const [searching, setSearching] = useState(false)
  // Opening search squeezes the sort to its icon; folding it lets the sort
  // back out. Animated as one layout change, so the two trade the row.
  function toggleSearch(open: boolean) {
    if (!reduceMotion) LayoutAnimation.configureNext(LayoutAnimation.create(260, 'easeInEaseOut', 'scaleXY'))
    if (!open) setQuery('')
    setSearching(open)
  }
  const rows = useMemo(() => {
    const es = (data?.entries ?? []).filter((e) => binEntryMatches(e, query))
    return sortBinEntries(es, sort, dir)
  }, [data, sort, dir, query])

  function refresh() {
    queryClient.invalidateQueries({ queryKey: ['bin', slug] })
    queryClient.invalidateQueries({ queryKey: ['bins'] })
    queryClient.invalidateQueries({ queryKey: ['albums'] })
  }

  // Always the record's Pressd page — the average and everyone's ratings — never
  // one person's copy, yours included: a bin is about the record.
  function open(e: BinEntry) {
    selection()
    // A song opens its album's page with the song highlighted, when Pressd
    // knows its track.
    const track = e.trackId != null ? { track: String(e.trackId) } : {}
    if (e.mine) {
      router.push({ pathname: '/album/[id]', params: { id: String(e.mine.id), community: '1', ...track } })
      return
    }
    router.push({
      pathname: '/album/[id]',
      params: {
        id: e.deezerId ? String(e.deezerId) : '0',
        name: e.albumName,
        artist: e.artist,
        ...(e.deezerId ? { deezer: String(e.deezerId) } : {}),
        ...track,
      },
    })
  }

  function openRate(albumId: number) {
    selection()
    router.push({ pathname: '/rate/[id]', params: { id: String(albumId) } })
  }

  async function add(e: BinEntry, status: 'listening' | 'to_listen') {
    if (busy != null) return
    selection()
    setBusy(e.id)
    try {
      const r = await addBinEntry(slug!, e.id, status)
      refresh()
      if (status === 'listening') router.push({ pathname: '/rate/[id]', params: { id: String(r.albumId) } })
      else success()
    } catch {
      Alert.alert('Couldn’t add that record', 'Try again in a moment.')
    } finally {
      setBusy(null)
    }
  }

  const back = (
    <View style={styles.topBar}>
      <Pressable onPress={() => router.back()} hitSlop={12} accessibilityRole="button" accessibilityLabel="Back">
        <ArrowLeft size={22} color={tc.ink} />
      </Pressable>
    </View>
  )
  // Over the banner, and over the list once it scrolls: a dark disc keeps the
  // cream arrow readable on either.
  const floatingBack = (
    <Pressable
      onPress={() => router.back()}
      hitSlop={10}
      style={[styles.floatBack, { top: insets.top + 6 }]}
      accessibilityRole="button"
      accessibilityLabel="Back"
    >
      <ArrowLeft size={20} color={CREAM} />
    </Pressable>
  )

  if (isLoading || isError || !data) {
    return (
      <View style={[styles.screen, { paddingTop: insets.top }]}>
        {back}
        <View style={styles.state}>
          {isLoading ? <VinylSpinner size={64} /> : <Text style={styles.stateText}>Couldn’t load this bin.</Text>}
        </View>
      </View>
    )
  }

  const SORTS: BinSort[] = ['list', 'pressd', 'raters', 'yours', 'unrated']
  // A song's scores are one decimal; an album's two.
  const places = data.itemType === 'song' ? 1 : 2
  // The prediction that orders the unrated half of "Not yet rated".
  const showPredicted = (e: BinEntry) => sort === 'unrated' && e.mine?.status !== 'rated' && e.predictedScore != null

  function pickSort(v: string | number) {
    selection()
    slideRows()
    if (v === 'asc' || v === 'desc') setDir(v)
    else {
      setSort(v as BinSort)
      setDir(BIN_SORT_DIR[v as BinSort])
    }
  }

  const bannerH = BANNER + insets.top
  // The fan: the list's first three records, its first in front.
  const [front, left, right] = [data.covers[0], data.covers[1], data.covers[2]]
  const header = (
    <View>
      {/* The banner: the lead record blurred into a wash, and over it the
          first three records fanned out, the first in front. It ends in a
          hard edge (Jack's call). */}
      <View style={[styles.banner, { height: bannerH }]}>
        {front && (
          <CoverImage url={front} displayPx={200} blurRadius={40} style={StyleSheet.absoluteFill} />
        )}
        <View style={[StyleSheet.absoluteFill, styles.wash]} />
        <View style={[styles.fan, { top: insets.top + 34 }]}>
          {left && (
            <View style={[styles.fanCard, styles.fanSide, { transform: [{ translateX: -FAN_SPREAD }, { rotate: '-8deg' }] }]}>
              <CoverImage url={left} displayPx={FAN_SIDE} style={styles.fanSideImg} />
            </View>
          )}
          {right && (
            <View style={[styles.fanCard, styles.fanSide, { transform: [{ translateX: FAN_SPREAD }, { rotate: '8deg' }] }]}>
              <CoverImage url={right} displayPx={FAN_SIDE} style={styles.fanSideImg} />
            </View>
          )}
          {front && (
            <View style={[styles.fanCard, styles.fanFront]}>
              <CoverImage url={front} displayPx={FAN_FRONT} style={styles.fanFrontImg} />
            </View>
          )}
        </View>
      </View>

      <View style={styles.head}>
        <View style={styles.titleBlock}>
          {data.kind === 'curated' && (
            <Image source={require('../../assets/pressd-mark.png')} style={styles.mark} contentFit="contain" accessibilityLabel="A Pressd bin" />
          )}
          <Text
            style={styles.title}
            onPress={() => scrollToTop(list)}
            accessibilityRole="header"
            accessibilityHint="Scrolls to the top"
          >
            {data.title}
          </Text>
        </View>
        <BinProgress entries={data.entries} />
      <View style={styles.controls}>
        {/* Searching squeezes the sort down to its icon, and that icon folds
            search away again. One pressable either way, so the change
            animates as a squish rather than a swap. */}
        <Pressable
          ref={sortRef}
          onPress={() => {
            selection()
            if (searching) toggleSearch(false)
            else setSortOpen(true)
          }}
          style={({ pressed }) => [
            styles.sortBtn,
            searching && styles.sortBtnSquished,
            { borderColor: tc.border },
            pressed && { opacity: 0.7 },
          ]}
          accessibilityRole="button"
          accessibilityLabel={
            searching
              ? 'Close search'
              : `Sort by ${binSortLabel(sort, data.sourceName)}, ${dir === 'asc' ? 'ascending' : 'descending'}`
          }
        >
          <ArrowUpDown size={14} color={tc.green} strokeWidth={2.4} />
          {!searching && (
            <>
              <Text style={styles.sortLabel} numberOfLines={1}>
                Sort by <Text style={[styles.sortValue, { color: tc.green }]}>{binSortLabel(sort, data.sourceName)}</Text>
                {` · ${dir === 'asc' ? 'Ascending' : 'Descending'}`}
              </Text>
              <ChevronDown size={14} color={tc.inkSecondary} />
            </>
          )}
        </Pressable>
        <BinSearch
          value={query}
          onChange={setQuery}
          open={searching}
          onOpenChange={toggleSearch}
          placeholder={data.itemType === 'song' ? 'Search songs, artists, albums' : 'Search albums, artists'}
          fieldStyle={styles.search}
        />
      </View>
      </View>
    </View>
  )

  return (
    <View style={styles.screen}>
      <StatusBar style="light" />
      <FlatList
        ref={list}
        data={rows}
        keyExtractor={(e) => String(e.id)}
        ListHeaderComponent={header}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        ListEmptyComponent={query ? <Text style={styles.empty}>Nothing in this bin matches “{query.trim()}”.</Text> : null}
        contentContainerStyle={{ paddingBottom: insets.bottom + spacing.xl }}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={tc.green} />}
        ItemSeparatorComponent={RankRule}
        renderItem={({ item: e }) => {
          const rated = e.mine?.status === 'rated' && e.mine.score != null
          const saved = !!e.mine && !rated
          return (
            <Pressable onPress={() => open(e)} style={({ pressed }) => [styles.row, pressed && { opacity: 0.7 }]}>
              {/* The cover, with the list's number in its corner. */}
              <View style={styles.coverWrap}>
                {e.coverUrl ? (
                  <CoverImage url={e.coverUrl} displayPx={COVER} style={styles.cover} />
                ) : (
                  <View style={[styles.cover, styles.coverEmpty]}>
                    <Text style={styles.coverInitial}>{(e.songTitle ?? e.albumName)[0]?.toUpperCase()}</Text>
                  </View>
                )}
                {data.ranked && (
                  <Text style={styles.rankText} maxFontSizeMultiplier={NUM_SCALE_CAP}>{e.rank ?? e.position + 1}</Text>
                )}
              </View>

              <View style={styles.rowText}>
                <Text style={styles.rowTitle} numberOfLines={2}>{e.songTitle ?? e.albumName}</Text>
                <Text style={styles.rowArtist} numberOfLines={1}>{e.artist}</Text>
                {details(e) !== '' && <Text style={styles.rowDetails} numberOfLines={1}>{details(e)}</Text>}

                <View style={styles.rowFoot}>
                  <View style={styles.figures}>
                    {/* Pressd's order leads with the Pressd average and greys
                        yours; Most rated leads with the count; every other
                        order leads with yours. */}
                    {sort === 'raters' ? (
                      <>
                        <Figure label="RATINGS" value={e.pressdRaters} count />
                        {e.pressdAvg != null && <Figure label="PRESSD" value={e.pressdAvg} places={places} muted />}
                        {rated && <Figure label="YOU" value={e.mine!.score!} places={places} muted />}
                      </>
                    ) : sort === 'pressd' ? (
                      <>
                        {e.pressdAvg != null && <Figure label="PRESSD" value={e.pressdAvg} places={places} />}
                        {rated && <Figure label="YOU" value={e.mine!.score!} places={places} muted />}
                      </>
                    ) : (
                      <>
                        {rated && <Figure label="YOU" value={e.mine!.score!} places={places} />}
                        {!rated && showPredicted(e) && <Figure label="PREDICTED" value={e.predictedScore!} places={places} />}
                        {e.pressdAvg != null && <Figure label="PRESSD" value={e.pressdAvg} places={places} muted />}
                      </>
                    )}
                  </View>
                  {!rated && (e.addable || saved) && (
                    busy === e.id ? <VinylSpinner size={24} /> : (
                      <View style={styles.actions}>
                        <Pressable
                          onPress={() => (e.mine ? openRate(e.mine.id) : add(e, 'listening'))}
                          hitSlop={8}
                          style={({ pressed }) => [styles.iconBtn, { borderColor: tc.border }, pressed && { opacity: 0.6 }]}
                          accessibilityRole="button"
                          accessibilityLabel={`Rate ${e.songTitle ?? e.albumName} now`}
                        >
                          <Star size={19} color={tc.ink} strokeWidth={2} />
                        </Pressable>
                        <Pressable
                          onPress={() => (e.mine ? open(e) : add(e, 'to_listen'))}
                          hitSlop={8}
                          style={({ pressed }) => [
                            styles.iconBtn,
                            { borderColor: saved ? tc.green : tc.border },
                            saved && { backgroundColor: tc.greenSoft },
                            pressed && { opacity: 0.6 },
                          ]}
                          accessibilityRole="button"
                          accessibilityLabel={saved ? `${e.albumName} is in your library` : `Save ${e.albumName} to your library`}
                        >
                          <Bookmark size={19} color={saved ? tc.green : tc.ink} fill={saved ? tc.green : 'none'} strokeWidth={2} />
                        </Pressable>
                      </View>
                    )
                  )}
                </View>
              </View>
            </Pressable>
          )
        }}
      />
      {floatingBack}
      <AnchoredMenu
        visible={sortOpen}
        anchorRef={sortRef}
        options={[
          ...SORTS.map((k) => ({ key: k, label: binSortLabel(k, data.sourceName), value: k, selected: sort === k })),
          { key: 'asc', label: 'Ascending', value: 'asc', selected: dir === 'asc', divider: true },
          { key: 'desc', label: 'Descending', value: 'desc', selected: dir === 'desc' },
        ]}
        onSelect={pickSort}
        onClose={() => setSortOpen(false)}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  floatBack: {
    position: 'absolute', left: spacing.lg, width: 36, height: 36, borderRadius: 18,
    alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(12,10,8,0.42)',
  },
  banner: { overflow: 'hidden', backgroundColor: '#171615' },
  // Held down a little so the fan stands out of its own blurred colour.
  wash: { backgroundColor: 'rgba(14,12,10,0.28)' },
  fan: { position: 'absolute', left: 0, right: 0, height: FAN_FRONT, alignItems: 'center', justifyContent: 'center' },
  fanCard: {
    position: 'absolute', borderRadius: radii.md, backgroundColor: '#171615',
    shadowColor: '#000', shadowOpacity: 0.35, shadowRadius: 14, shadowOffset: { width: 0, height: 8 },
  },
  fanFront: { width: FAN_FRONT, height: FAN_FRONT },
  fanFrontImg: { width: FAN_FRONT, height: FAN_FRONT, borderRadius: radii.md },
  fanSide: { width: FAN_SIDE, height: FAN_SIDE },
  fanSideImg: { width: FAN_SIDE, height: FAN_SIDE, borderRadius: radii.md },
  topBar: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.xs },
  state: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  stateText: { fontFamily: fonts.bodyMedium, fontSize: 14, color: colors.inkSecondary },

  head: { paddingHorizontal: spacing.lg, paddingTop: spacing.lg, paddingBottom: spacing.lg },
  titleBlock: { alignItems: 'center', gap: spacing.sm, marginBottom: spacing.lg },
  // The bare mark on the page, no chip behind it (Jack's call).
  mark: { width: 40, height: 40 * (126 / 232) },
  title: { fontFamily: fonts.displayBlack, fontSize: 32, lineHeight: 38, color: colors.ink, textAlign: 'center' },
  controls: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.lg },
  // Open, the field takes the rest of the row from the squished sort.
  search: { flex: 1 },
  empty: { paddingHorizontal: spacing.lg, paddingVertical: spacing.xl, fontFamily: fonts.bodyMedium, fontSize: 14, color: colors.inkSecondary },
  sortBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1, overflow: 'hidden',
    height: 36, paddingHorizontal: 13, borderRadius: radii.pill, borderWidth: 1,
  },
  sortBtnSquished: { width: 36, paddingHorizontal: 0, justifyContent: 'center', flexShrink: 0 },
  sortLabel: { flexShrink: 1, fontFamily: fonts.bodyMedium, fontSize: 13, color: colors.inkSecondary },
  sortValue: { fontFamily: fonts.bodyBold },

  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg, paddingHorizontal: spacing.lg, paddingVertical: 14 },
  coverWrap: { width: COVER, height: COVER },
  rule: { height: StyleSheet.hairlineWidth, marginHorizontal: spacing.lg, backgroundColor: colors.hairline, opacity: 0.6 },
  cover: { width: COVER, height: COVER, borderRadius: radii.md },
  coverEmpty: { backgroundColor: colors.inset, alignItems: 'center', justifyContent: 'center' },
  coverInitial: { fontFamily: fonts.display, fontSize: 28, color: colors.inkTertiary },
  // The number printed on the cover's lower left, white with a soft shadow so
  // it holds on a pale cover — literal colours, since it sits on the art.
  rankText: {
    position: 'absolute', left: 8, bottom: 2, fontFamily: fonts.displayBlack, fontSize: 38, lineHeight: 44,
    color: '#ffffff', fontVariant: ['tabular-nums'],
    textShadowColor: 'rgba(0,0,0,0.55)', textShadowRadius: 6, textShadowOffset: { width: 0, height: 1 },
  },
  rowText: { flex: 1, minWidth: 0, alignSelf: 'stretch', justifyContent: 'center' },
  rowTitle: { fontFamily: fonts.bodyBold, fontSize: 17, lineHeight: 21, color: colors.ink },
  rowArtist: { marginTop: 3, fontFamily: fonts.bodyMedium, fontSize: 14, color: colors.inkSecondary },
  rowDetails: { marginTop: 2, fontFamily: fonts.bodyMedium, fontSize: 12.5, color: colors.inkTertiary },
  rowFoot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm, marginTop: spacing.md },
  figures: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.lg, flexShrink: 1 },
  figure: { minWidth: 44 },
  figureLabel: { fontFamily: fonts.bodySemiBold, fontSize: 9.5, letterSpacing: 0.8, color: colors.inkTertiary },
  figureValue: { marginTop: 1, fontFamily: fonts.display, fontSize: 20, fontVariant: ['tabular-nums'] },
  figureMuted: { marginTop: 2, fontFamily: fonts.display, fontSize: 14, color: colors.inkTertiary, fontVariant: ['tabular-nums'] },
  actions: { flexDirection: 'row', gap: spacing.sm },
  iconBtn: { width: 38, height: 38, borderRadius: 19, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
})
