// One bin — the Apple Music 100 Best Albums, say. Its records in the list's
// order (or by the Pressd average, or by your predicted score once picks are
// unlocked), each with your score or where it sits in your library, or Rate
// now / Add. The header holds how far through it you are.
//
// A record is opened as your copy when you have one (any edition), and
// otherwise as the community view by name, which handles a record nobody on
// Pressd has rated yet.
import { useMemo, useRef, useState } from 'react'
import { AccessibilityInfo, Alert, FlatList, LayoutAnimation, Linking, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, ArrowUpDown, ChevronDown } from 'lucide-react-native'
import { addBinEntry, fetchBin, type BinEntry } from '../../lib/api'
import { BIN_SORT_DIR, binSortLabel, sortBinEntries, type BinSort, type BinSortDir } from '@pressd/shared/binSort'
import AnchoredMenu from '../../components/AnchoredMenu'
import { useAuth } from '../../lib/auth'
import { selection, success } from '../../lib/haptics'
import { scrollToTop } from '../../lib/scrollToTop'
import { BinMosaic, BinProgressBar } from '../../components/BinCard'
import CoverImage from '../../components/CoverImage'
import VinylSpinner from '../../components/VinylSpinner'
import { colors, fonts, NUM_SCALE_CAP, radii, scoreColor, spacing, useColors } from '../../theme/tokens'

const COVER = 68

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

const STATUS_LABEL = { listening: 'Listening', to_listen: 'To Listen' } as const

/** "1998 · Pop" */
function details(e: BinEntry): string {
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

  const header = (
    <View style={styles.head}>
      <BinMosaic covers={data.covers} size={132} />
      <Text style={styles.title} onPress={() => scrollToTop(list)} accessibilityRole="button" accessibilityHint="Scrolls to the top">
        {data.title}
      </Text>
      {data.sourceName && (
        <Text
          style={[styles.source, data.sourceUrl ? { color: tc.green } : null]}
          onPress={data.sourceUrl ? () => Linking.openURL(data.sourceUrl!) : undefined}
        >
          {data.sourceName}{data.sourceYear ? ` · ${data.sourceYear}` : ''}
        </Text>
      )}
      <View style={styles.progressRow}>
        <BinProgressBar done={data.progress.rated} total={data.progress.total} />
      </View>
      <Text style={styles.progressText} maxFontSizeMultiplier={NUM_SCALE_CAP}>
        <Text style={styles.progressStrong}>{data.progress.rated}</Text> of {data.progress.total} rated
      </Text>
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
  )

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      {back}
      <FlatList
        ref={list}
        data={rows}
        keyExtractor={(e) => String(e.id)}
        ListHeaderComponent={header}
        contentContainerStyle={{ paddingBottom: insets.bottom + spacing.xl }}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={tc.green} />}
        renderItem={({ item: e }) => (
          <Pressable onPress={() => open(e)} style={({ pressed }) => [styles.row, pressed && { opacity: 0.6 }]}>
            {data.ranked && (
              <Text style={styles.rank} maxFontSizeMultiplier={NUM_SCALE_CAP}>{e.rank ?? e.position + 1}</Text>
            )}
            {e.coverUrl ? (
              <CoverImage url={e.coverUrl} displayPx={COVER} style={styles.cover} />
            ) : (
              <View style={[styles.cover, styles.coverEmpty]}>
                <Text style={styles.coverInitial}>{e.albumName[0]?.toUpperCase()}</Text>
              </View>
            )}
            <View style={styles.rowText}>
              <Text style={styles.rowTitle} numberOfLines={1}>{e.albumName}</Text>
              <Text style={styles.rowArtist} numberOfLines={1}>{e.artist}</Text>
              {details(e) !== '' && <Text style={styles.rowDetails} numberOfLines={1}>{details(e)}</Text>}
              {(e.pressdAvg != null || showPredicted(e)) && (
                <Text style={styles.rowMeta} numberOfLines={1} maxFontSizeMultiplier={NUM_SCALE_CAP}>
                  {e.pressdAvg != null && (
                    <>PRESSD <Text style={[styles.rowMetaNum, { color: scoreColor(e.pressdAvg) }]}>{e.pressdAvg.toFixed(2)}</Text></>
                  )}
                  {e.pressdAvg != null && showPredicted(e) && '   '}
                  {showPredicted(e) && e.predictedScore != null && (
                    <>PREDICTED <Text style={[styles.rowMetaNum, { color: scoreColor(e.predictedScore) }]}>{e.predictedScore.toFixed(2)}</Text></>
                  )}
                </Text>
              )}
            </View>
            {e.mine?.status === 'rated' && e.mine.score != null ? (
              <Text style={[styles.score, { color: scoreColor(e.mine.score) }]} maxFontSizeMultiplier={NUM_SCALE_CAP}>
                {e.mine.score.toFixed(2)}
              </Text>
            ) : e.mine ? (
              <Text style={styles.status}>{STATUS_LABEL[e.mine.status as keyof typeof STATUS_LABEL] ?? 'Rated'}</Text>
            ) : e.addable ? (
              busy === e.id ? <VinylSpinner size={22} /> : (
                <View style={styles.actions}>
                  <Pressable
                    onPress={() => add(e, 'listening')}
                    hitSlop={6}
                    style={[styles.actBtn, { backgroundColor: tc.greenFill }]}
                    accessibilityLabel={`Rate ${e.albumName} now`}
                  >
                    <Text style={styles.actPrimary}>Rate</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => add(e, 'to_listen')}
                    hitSlop={6}
                    style={[styles.actBtn, { borderColor: tc.border, borderWidth: StyleSheet.hairlineWidth * 2 }]}
                    accessibilityLabel={`Add ${e.albumName} to To Listen`}
                  >
                    <Text style={[styles.actSecondary, { color: tc.ink }]}>Add</Text>
                  </Pressable>
                </View>
              )
            ) : null}
          </Pressable>
        )}
      />
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
  topBar: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.xs },
  state: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  stateText: { fontFamily: fonts.bodyMedium, fontSize: 14, color: colors.inkSecondary },

  head: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.lg },
  title: { marginTop: spacing.lg, fontFamily: fonts.display, fontSize: 30, lineHeight: 36, color: colors.ink },
  source: { marginTop: 4, fontFamily: fonts.bodySemiBold, fontSize: 14, color: colors.inkSecondary },
  progressRow: { flexDirection: 'row', marginTop: spacing.lg },
  progressText: { marginTop: spacing.sm, fontFamily: fonts.bodyMedium, fontSize: 13, color: colors.inkSecondary },
  progressStrong: { fontFamily: fonts.bodyBold, color: colors.ink },
  controls: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.lg },
  sortBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start',
    paddingHorizontal: 13, paddingVertical: 8, borderRadius: radii.pill, borderWidth: 1,
  },
  sortLabel: { flexShrink: 1, fontFamily: fonts.bodyMedium, fontSize: 13, color: colors.inkSecondary },
  sortValue: { fontFamily: fonts.bodyBold },

  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: 10 },
  rank: { width: 36, textAlign: 'right', fontFamily: fonts.display, fontSize: 22, color: colors.ink, fontVariant: ['tabular-nums'] },
  cover: { width: COVER, height: COVER, borderRadius: radii.sm },
  coverEmpty: { backgroundColor: colors.inset, alignItems: 'center', justifyContent: 'center' },
  coverInitial: { fontFamily: fonts.display, fontSize: 20, color: colors.inkTertiary },
  rowText: { flex: 1, minWidth: 0 },
  rowTitle: { fontFamily: fonts.bodyBold, fontSize: 16, color: colors.ink },
  rowArtist: { marginTop: 2, fontFamily: fonts.bodyMedium, fontSize: 14, color: colors.inkSecondary },
  rowDetails: { marginTop: 2, fontFamily: fonts.bodyMedium, fontSize: 12.5, color: colors.inkTertiary },
  rowMeta: { marginTop: 4, fontFamily: fonts.bodySemiBold, fontSize: 10.5, letterSpacing: 0.5, color: colors.inkTertiary },
  rowMetaNum: { fontFamily: fonts.display, fontSize: 13, letterSpacing: 0 },
  score: { fontFamily: fonts.display, fontSize: 23, fontVariant: ['tabular-nums'] },
  status: { fontFamily: fonts.bodySemiBold, fontSize: 12, color: colors.inkSecondary },
  actions: { flexDirection: 'row', gap: 6 },
  actBtn: { paddingHorizontal: 11, paddingVertical: 6, borderRadius: radii.pill },
  actPrimary: { fontFamily: fonts.bodyBold, fontSize: 12.5, color: colors.onGreen },
  actSecondary: { fontFamily: fonts.bodyBold, fontSize: 12.5 },
})
