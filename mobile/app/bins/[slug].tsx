// One bin — the Apple Music 100 Best Albums, say. A banner across the top of
// the screen projects the bin's 2×2 collage, darkened and faded, with the
// bin's title over it in cream — dark enough that the cream reads whatever the
// page is — under the Pressd-verified badge on Pressd's bins. Everything else
// sits below it: the bin's icon, the source, your progress, the sort, and the
// records.
//
// Its records in the list's
// order (or by the Pressd average, or by your predicted score once picks are
// unlocked), each with your score or where it sits in your library, or Rate
// now / Add. The header holds how far through it you are.
//
// A record is opened as your copy when you have one (any edition), and
// otherwise as the community view by name, which handles a record nobody on
// Pressd has rated yet.
import { useMemo, useRef, useState } from 'react'
import { AccessibilityInfo, Alert, FlatList, LayoutAnimation, Pressable, RefreshControl, StyleSheet, Text, View, useWindowDimensions } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { LinearGradient } from 'expo-linear-gradient'
import { StatusBar } from 'expo-status-bar'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, ArrowUpDown, Bookmark, ChevronDown, Star } from 'lucide-react-native'
import { addBinEntry, fetchBin, type BinEntry } from '../../lib/api'
import { BIN_SORT_DIR, binSortLabel, sortBinEntries, type BinSort, type BinSortDir } from '@pressd/shared/binSort'
import AnchoredMenu from '../../components/AnchoredMenu'
import { useAuth } from '../../lib/auth'
import { selection, success } from '../../lib/haptics'
import { scrollToTop } from '../../lib/scrollToTop'
import { BinMosaic, BinProgressBar } from '../../components/BinCard'
import CoverImage from '../../components/CoverImage'
import PressdBinBadge from '../../components/PressdBinBadge'
import VinylSpinner from '../../components/VinylSpinner'
import { colors, fonts, NUM_SCALE_CAP, radii, scoreColor, spacing, useColors, usePageRgb } from '../../theme/tokens'

const COVER = 120
// The banner's height below the status bar, and the fade into the page at its foot.
const BANNER = 280
const FADE = 56
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

/** A labelled score under a record: the Pressd average, yours, or your
 *  predicted. `muted` is the one the order isn't about — smaller, in grey. */
function Figure({ label, value, muted = false }: { label: string; value: number; muted?: boolean }) {
  return (
    <View style={styles.figure}>
      <Text style={styles.figureLabel} maxFontSizeMultiplier={NUM_SCALE_CAP}>{label}</Text>
      <Text
        style={muted ? styles.figureMuted : [styles.figureValue, { color: scoreColor(value) }]}
        maxFontSizeMultiplier={NUM_SCALE_CAP}
      >
        {value.toFixed(2)}
      </Text>
    </View>
  )
}

/** "1998 · Pop" */
function details(e: BinEntry): string {
  return [e.year, e.genre].filter(Boolean).join(' · ')
}

export default function BinPage() {
  const tc = useColors()
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { width } = useWindowDimensions()
  const pageRgb = usePageRgb()
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

  const rows = useMemo(() => {
    const es = data?.entries ?? []
    return sortBinEntries(es, sort, dir)
  }, [data, sort, dir])

  function refresh() {
    queryClient.invalidateQueries({ queryKey: ['bin', slug] })
    queryClient.invalidateQueries({ queryKey: ['bins'] })
    queryClient.invalidateQueries({ queryKey: ['albums'] })
  }

  function open(e: BinEntry) {
    selection()
    if (e.mine) {
      router.push({ pathname: '/album/[id]', params: { id: String(e.mine.id) } })
      return
    }
    router.push({
      pathname: '/album/[id]',
      params: {
        id: e.deezerId ? String(e.deezerId) : '0',
        name: e.albumName,
        artist: e.artist,
        ...(e.deezerId ? { deezer: String(e.deezerId) } : {}),
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

  const SORTS: BinSort[] = ['list', 'pressd', 'yours', 'unrated']
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
  const header = (
    <View>
      {/* The banner: the collage, scaled to the screen's width and centred,
          held low under a dark wash, fading into the page at its foot. */}
      <View style={[styles.banner, { height: bannerH }]}>
        <View style={[styles.collage, { width, height: width, top: (bannerH - width) / 2 }]}>
          {[0, 1, 2, 3].map((i) =>
            data.covers[i] ? (
              <CoverImage key={i} url={data.covers[i]} displayPx={Math.ceil(width / 2)} style={{ width: width / 2, height: width / 2 }} />
            ) : (
              <View key={i} style={{ width: width / 2, height: width / 2 }} />
            ),
          )}
        </View>
        <View style={[StyleSheet.absoluteFill, styles.wash]} />
        <LinearGradient
          colors={[`rgba(${pageRgb},0)`, `rgba(${pageRgb},1)`]}
          style={[styles.fade, { height: FADE }]}
          pointerEvents="none"
        />
        <View style={[styles.titleBlock, { bottom: FADE - 4 }]}>
          {data.kind === 'curated' && <PressdBinBadge width={48} />}
          <Text
            style={styles.title}
            onPress={() => scrollToTop(list)}
            accessibilityRole="header"
            accessibilityHint="Scrolls to the top"
            numberOfLines={3}
          >
            {data.title}
          </Text>
        </View>
      </View>

      <View style={styles.head}>
        <View style={styles.about}>
          <BinMosaic covers={data.covers} size={76} />
          <View style={styles.aboutText}>
            {data.sourceName && (
              <Text style={styles.source} numberOfLines={1}>
                {data.sourceName}{data.sourceYear ? ` · ${data.sourceYear}` : ''}
              </Text>
            )}
            <View style={styles.progressRow}>
              <BinProgressBar done={data.progress.rated} total={data.progress.total} />
            </View>
            <Text style={styles.progressText} maxFontSizeMultiplier={NUM_SCALE_CAP}>
              <Text style={styles.progressStrong}>{data.progress.rated}</Text> of {data.progress.total} rated
            </Text>
          </View>
        </View>
      <View style={styles.controls}>
        <Pressable
          ref={sortRef}
          onPress={() => { selection(); setSortOpen(true) }}
          style={({ pressed }) => [styles.sortBtn, { borderColor: tc.border }, pressed && { opacity: 0.7 }]}
          accessibilityRole="button"
          accessibilityLabel={`Sort by ${binSortLabel(sort, data.sourceName)}, ${dir === 'asc' ? 'ascending' : 'descending'}`}
        >
          <ArrowUpDown size={14} color={tc.green} strokeWidth={2.4} />
          <Text style={styles.sortLabel} numberOfLines={1}>
            Sort by <Text style={[styles.sortValue, { color: tc.green }]}>{binSortLabel(sort, data.sourceName)}</Text>
            {` · ${dir === 'asc' ? 'Ascending' : 'Descending'}`}
          </Text>
          <ChevronDown size={14} color={tc.inkSecondary} />
        </Pressable>
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
                    <Text style={styles.coverInitial}>{e.albumName[0]?.toUpperCase()}</Text>
                  </View>
                )}
                {data.ranked && (
                  <Text style={styles.rankText} maxFontSizeMultiplier={NUM_SCALE_CAP}>{e.rank ?? e.position + 1}</Text>
                )}
              </View>

              <View style={styles.rowText}>
                <Text style={styles.rowTitle} numberOfLines={2}>{e.albumName}</Text>
                <Text style={styles.rowArtist} numberOfLines={1}>{e.artist}</Text>
                {details(e) !== '' && <Text style={styles.rowDetails} numberOfLines={1}>{details(e)}</Text>}

                <View style={styles.rowFoot}>
                  <View style={styles.figures}>
                    {/* Pressd's order leads with the Pressd average and greys
                        yours; every other order leads with yours. */}
                    {sort === 'pressd' ? (
                      <>
                        {e.pressdAvg != null && <Figure label="PRESSD" value={e.pressdAvg} />}
                        {rated && <Figure label="YOU" value={e.mine!.score!} muted />}
                      </>
                    ) : (
                      <>
                        {rated && <Figure label="YOU" value={e.mine!.score!} />}
                        {!rated && showPredicted(e) && <Figure label="PREDICTED" value={e.predictedScore!} />}
                        {e.pressdAvg != null && <Figure label="PRESSD" value={e.pressdAvg} muted />}
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
                          accessibilityLabel={`Rate ${e.albumName} now`}
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
  collage: { position: 'absolute', left: 0, flexDirection: 'row', flexWrap: 'wrap', opacity: 0.9 },
  // Low exposure: the covers stay legible as covers, but nothing in them is
  // bright enough to fight the cream title.
  wash: { backgroundColor: 'rgba(14,12,10,0.6)' },
  fade: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  topBar: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.xs },
  state: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  stateText: { fontFamily: fonts.bodyMedium, fontSize: 14, color: colors.inkSecondary },

  head: { paddingHorizontal: spacing.lg, paddingTop: spacing.xs, paddingBottom: spacing.lg },
  titleBlock: { position: 'absolute', left: spacing.lg, right: spacing.lg, alignItems: 'flex-start', gap: spacing.md },
  title: {
    fontFamily: fonts.display, fontSize: 34, lineHeight: 40, color: CREAM,
    textShadowColor: 'rgba(0,0,0,0.35)', textShadowRadius: 12, textShadowOffset: { width: 0, height: 2 },
  },
  about: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg },
  aboutText: { flex: 1, minWidth: 0 },
  source: { fontFamily: fonts.bodySemiBold, fontSize: 14, color: colors.inkSecondary },
  progressRow: { flexDirection: 'row', marginTop: spacing.md },
  progressText: { marginTop: spacing.sm, fontFamily: fonts.bodyMedium, fontSize: 13, color: colors.inkSecondary },
  progressStrong: { fontFamily: fonts.bodyBold, color: colors.ink },
  controls: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.lg },
  sortBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start',
    paddingHorizontal: 13, paddingVertical: 8, borderRadius: radii.pill, borderWidth: 1,
  },
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
