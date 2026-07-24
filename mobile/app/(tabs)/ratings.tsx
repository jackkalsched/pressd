// Ratings — two sortable tables mirroring the desktop page.
//   Albums  — rated albums, filterable by genre / artist / year, with every
//             metric column sortable (tap a header to sort; tap again to flip).
//   Artists — artist rankings (≥15 songs) as a table with the same
//             tap-to-sort / tap-again-to-flip column headers.
import { useMemo, useState } from 'react'
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  FlatList,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useQuery } from '@tanstack/react-query'
import { Image } from 'expo-image'
import { useRouter } from 'expo-router'
import { Check, ChevronDown, Search, X } from 'lucide-react-native'
import { fetchAlbums, fetchScatterData, fetchArtistStats } from '../../lib/api'
import { shortReleaseLabel, songScoreColor, type Album } from '@pressd/shared/types'
import { useAuth } from '../../lib/auth'
import { colors, fonts, radii, spacing } from '../../theme/tokens'

type Tab = 'albums' | 'artists'
const QUALIFIED = 15
const ROW_H = 56
const HEAD_H = 38

// ── shared sortable header cell ──
function Th({
  label, width, active, dir, onPress, align = 'right',
}: {
  label: string; width: number; active: boolean; dir: 'asc' | 'desc'; onPress: () => void; align?: 'left' | 'right'
}) {
  return (
    <Pressable style={[styles.th, { width, alignItems: align === 'left' ? 'flex-start' : 'flex-end' }]} onPress={onPress}>
      <Text style={[styles.thText, active && styles.thActive]} numberOfLines={1}>
        {label}{active ? (dir === 'desc' ? ' ↓' : ' ↑') : ''}
      </Text>
    </Pressable>
  )
}

function num(v: number | string | null): number {
  return typeof v === 'number' ? v : -Infinity
}

export default function Ratings() {
  const { user } = useAuth()
  const router = useRouter()
  const [tab, setTab] = useState<Tab>('albums')

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <Text style={styles.title}>Ratings</Text>
      <View style={styles.tabBar}>
        {(['albums', 'artists'] as Tab[]).map((t) => (
          <Pressable key={t} style={styles.tab} onPress={() => setTab(t)}>
            <Text style={[styles.tabText, tab === t && styles.tabTextActive]}>{t === 'albums' ? 'Albums' : 'Artists'}</Text>
            <View style={[styles.tabRule, tab === t && styles.tabRuleActive]} />
          </Pressable>
        ))}
      </View>

      {tab === 'albums' ? (
        <AlbumsTab userId={user?.id ?? 0} onOpen={(id) => router.push({ pathname: '/album/[id]', params: { id: String(id) } })} />
      ) : (
        <ArtistsTab userId={user?.id ?? 0} onOpen={(name) => router.push({ pathname: '/artist/[name]', params: { name: encodeURIComponent(name) } })} />
      )}
    </SafeAreaView>
  )
}

// ── Albums ──
type AlbumKey = 'albumName' | 'score' | 'theme' | 'replayValue' | 'production' | 'distinctness' | 'year' | 'genre'
const ALBUM_COLS: { key: AlbumKey; label: string; width: number }[] = [
  { key: 'score', label: 'Score', width: 62 },
  { key: 'theme', label: 'Theme', width: 60 },
  { key: 'replayValue', label: 'Replay', width: 62 },
  { key: 'production', label: 'Prod', width: 52 },
  { key: 'distinctness', label: 'Dist', width: 50 },
  { key: 'year', label: 'Year', width: 56 },
  { key: 'genre', label: 'Genre', width: 130 },
]

function albumVal(a: Album, key: AlbumKey): number | string | null {
  if (key === 'albumName') return a.albumName.toLowerCase()
  if (key === 'genre') return (a.genre ?? '').toLowerCase()
  return a[key] as number | null
}

function AlbumsTab({ userId, onOpen }: { userId: number; onOpen: (id: number) => void }) {
  const [search, setSearch] = useState('')
  const [genre, setGenre] = useState<string | null>(null)
  const [artist, setArtist] = useState<string | null>(null)
  const [year, setYear] = useState<string | null>(null)
  const [picker, setPicker] = useState<null | 'genre' | 'artist' | 'year'>(null)
  const [sortKey, setSortKey] = useState<AlbumKey>('score')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')

  const { data: albums = [] } = useQuery({
    queryKey: ['albums', 'rated', userId],
    queryFn: () => fetchAlbums({ status: 'rated', userId }),
    enabled: userId > 0,
  })

  const options = useMemo(() => ({
    genre: [...new Set(albums.map((a) => a.genre).filter(Boolean) as string[])].sort(),
    artist: [...new Set(albums.flatMap((a) => [a.artist, ...a.extraArtists]))].sort(),
    year: [...new Set(albums.map((a) => a.year).filter(Boolean))].sort((a, b) => b! - a!).map(String),
  }), [albums])

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase()
    const filtered = albums.filter((a) =>
      (!q || a.albumName.toLowerCase().includes(q) || a.artist.toLowerCase().includes(q)) &&
      (!genre || a.genre === genre) &&
      (!artist || a.artist === artist || a.extraArtists.includes(artist)) &&
      (!year || String(a.year) === year))
    return [...filtered].sort((x, y) => {
      const xv = albumVal(x, sortKey), yv = albumVal(y, sortKey)
      let c = 0
      if (typeof xv === 'string' || typeof yv === 'string') c = String(xv).localeCompare(String(yv))
      else c = num(xv) - num(yv)
      return sortDir === 'asc' ? c : -c
    })
  }, [albums, search, genre, artist, year, sortKey, sortDir])

  function sort(key: AlbumKey) {
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    else { setSortKey(key); setSortDir(key === 'albumName' || key === 'genre' ? 'asc' : 'desc') }
  }

  const active = [
    genre ? { key: 'genre', label: genre, clear: () => setGenre(null) } : null,
    artist ? { key: 'artist', label: artist, clear: () => setArtist(null) } : null,
    year ? { key: 'year', label: year, clear: () => setYear(null) } : null,
  ].filter(Boolean) as { key: string; label: string; clear: () => void }[]
  const avail = (['genre', 'artist', 'year'] as const).filter((k) => !active.some((f) => f.key === k))

  function setPick(v: string) {
    if (picker === 'genre') setGenre(v)
    else if (picker === 'artist') setArtist(v)
    else if (picker === 'year') setYear(v)
    setPicker(null)
  }
  const pickerVals = picker ? options[picker] : []
  const pickerCur = picker === 'genre' ? genre : picker === 'artist' ? artist : year

  function fmt(a: Album, key: AlbumKey): { text: string; color?: string } {
    if (key === 'score') return { text: a.score != null ? a.score.toFixed(2) : '—', color: a.score != null ? songScoreColor(a.score) : undefined }
    if (key === 'year') return { text: a.year ? String(a.year) : '—' }
    if (key === 'genre') return { text: a.genre ?? '—' }
    const v = a[key] as number | null
    return { text: v != null ? v.toFixed(1) : '—' }
  }

  return (
    <>
      <View style={styles.searchBar}>
        <Search size={16} color={colors.inkMuted} />
        <TextInput style={styles.searchInput} value={search} onChangeText={setSearch} placeholder="Search albums or artists" placeholderTextColor={colors.inkMuted} autoCorrect={false} />
        {search.length > 0 && <Pressable onPress={() => setSearch('')} hitSlop={8}><X size={15} color={colors.inkMuted} /></Pressable>}
      </View>

      <View style={styles.chipRow}>
        {active.map((f) => (
          <Pressable key={f.key} style={[styles.chip, styles.chipActive]} onPress={f.clear}>
            <Text style={styles.chipActiveText} numberOfLines={1}>{f.label}</Text>
            <X size={12} color="#fff" />
          </Pressable>
        ))}
        {avail.map((k) => (
          <Pressable key={k} style={styles.chip} onPress={() => setPicker(k)}>
            <Text style={styles.chipText}>{k[0].toUpperCase() + k.slice(1)}</Text>
            <ChevronDown size={12} color={colors.inkTertiary} />
          </Pressable>
        ))}
      </View>

      <ScrollView style={styles.tableScroll} contentContainerStyle={{ paddingBottom: 140 }} showsVerticalScrollIndicator={false}>
        <View style={{ flexDirection: 'row' }}>
          {/* Pinned Album column */}
          <View>
            <Th label="Album" width={188} active={sortKey === 'albumName'} dir={sortDir} onPress={() => sort('albumName')} align="left" />
            {rows.map((a, i) => (
              <Pressable key={a.id} style={[styles.pinnedCell, { width: 188 }]} onPress={() => onOpen(a.id)}>
                <Text style={styles.rank}>{i + 1}</Text>
                {a.albumArtUrl ? (
                  <Image source={{ uri: a.albumArtUrl }} style={styles.art} contentFit="cover" />
                ) : (
                  <View style={[styles.art, styles.artFallback]}><Text style={styles.artInitial}>{a.albumName[0]}</Text></View>
                )}
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={styles.cellName} numberOfLines={1}>{a.albumName}</Text>
                  <Text style={styles.cellSub} numberOfLines={1}>{a.artist}</Text>
                </View>
              </Pressable>
            ))}
          </View>
          {/* Scrolling metric columns */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View>
              <View style={{ flexDirection: 'row' }}>
                {ALBUM_COLS.map((c) => (
                  <Th key={c.key} label={c.label} width={c.width} active={sortKey === c.key} dir={sortDir} onPress={() => sort(c.key)} align={c.key === 'genre' ? 'left' : 'right'} />
                ))}
              </View>
              {rows.map((a) => (
                <Pressable key={a.id} style={styles.metricRow} onPress={() => onOpen(a.id)}>
                  {ALBUM_COLS.map((c) => {
                    const { text, color } = fmt(a, c.key)
                    return (
                      <View key={c.key} style={[styles.td, { width: c.width, alignItems: c.key === 'genre' ? 'flex-start' : 'flex-end' }]}>
                        <Text style={[styles.tdText, color ? { color, fontFamily: fonts.bodyBold } : null]} numberOfLines={1}>{text}</Text>
                      </View>
                    )
                  })}
                </Pressable>
              ))}
            </View>
          </ScrollView>
        </View>
        {rows.length === 0 && <Text style={styles.empty}>{albums.length === 0 ? 'No rated albums yet.' : 'No albums match these filters.'}</Text>}
      </ScrollView>

      <Modal visible={picker !== null} transparent animationType="slide" onRequestClose={() => setPicker(null)}>
        <Pressable style={styles.backdrop} onPress={() => setPicker(null)}>
          <Pressable style={styles.sheet}>
            <View style={styles.sheetHead}>
              <Text style={styles.sheetTitle}>{picker ? picker[0].toUpperCase() + picker.slice(1) : ''}</Text>
              <Pressable onPress={() => setPicker(null)} hitSlop={10}><X size={20} color={colors.inkTertiary} /></Pressable>
            </View>
            <FlatList
              data={pickerVals}
              keyExtractor={(v) => v}
              renderItem={({ item }) => (
                <Pressable style={styles.optionRow} onPress={() => setPick(item)}>
                  <Text style={styles.optionText}>{item}</Text>
                  {pickerCur === item && <Check size={18} color={colors.green} />}
                </Pressable>
              )}
              ListEmptyComponent={<Text style={styles.empty}>Nothing to filter by yet.</Text>}
            />
          </Pressable>
        </Pressable>
      </Modal>
    </>
  )
}

// ── Artists ──
type ArtistKey = 'artist' | 'songs' | 'songScore' | 'wSongPlus' | 'consistencyPlus' | 'bangPct' | 'skipPct' | 'external'
interface ArtistRow {
  artist: string; songs: number; songScore: number; external: number | null
  wSongPlus: number | null; consistencyPlus: number | null; bangPct: number | null; skipPct: number | null
}
const ARTIST_COLS: { key: ArtistKey; label: string; width: number }[] = [
  { key: 'songs', label: 'Songs', width: 58 },
  { key: 'songScore', label: 'Avg', width: 56 },
  { key: 'wSongPlus', label: 'wSong+', width: 66 },
  { key: 'consistencyPlus', label: 'Cons+', width: 60 },
  { key: 'bangPct', label: 'Bang%', width: 62 },
  { key: 'skipPct', label: 'Skip%', width: 60 },
  { key: 'external', label: 'Ext', width: 54 },
]

function ArtistsTab({ userId, onOpen }: { userId: number; onOpen: (name: string) => void }) {
  const [sortKey, setSortKey] = useState<ArtistKey>('wSongPlus')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')

  const { data: scatter } = useQuery({ queryKey: ['stats', 'scatter', userId], queryFn: () => fetchScatterData(userId), enabled: userId > 0, staleTime: 5 * 60_000 })
  const { data: artistStats = [] } = useQuery({ queryKey: ['stats', 'artists', userId], queryFn: () => fetchArtistStats(userId), enabled: userId > 0, staleTime: 5 * 60_000 })

  const rows = useMemo(() => {
    const statBy = new Map(artistStats.map((s) => [s.artist, s]))
    const merged: ArtistRow[] = (scatter?.points ?? [])
      .filter((p) => p.song_count >= QUALIFIED)
      .map((p) => {
        const st = statBy.get(p.artist)
        return { artist: p.artist, songs: p.song_count, songScore: p.avg_song_score, external: p.avg_external, wSongPlus: p.w_song_plus, consistencyPlus: p.consistency_plus, bangPct: st?.bangPct ?? null, skipPct: st?.skipPct ?? null }
      })
    return merged.sort((a, b) => {
      let c = 0
      if (sortKey === 'artist') c = a.artist.toLowerCase().localeCompare(b.artist.toLowerCase())
      else c = num(a[sortKey]) - num(b[sortKey])
      return sortDir === 'asc' ? c : -c
    })
  }, [scatter, artistStats, sortKey, sortDir])

  function sort(key: ArtistKey) {
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    else { setSortKey(key); setSortDir(key === 'artist' ? 'asc' : 'desc') }
  }

  function fmt(r: ArtistRow, key: ArtistKey): { text: string; color?: string } {
    const v = r[key]
    if (v == null) return { text: '—' }
    if (key === 'songs') return { text: String(v) }
    if (key === 'songScore') return { text: (v as number).toFixed(2), color: songScoreColor(v as number) }
    if (key === 'bangPct' || key === 'skipPct') return { text: `${Math.round((v as number) * 100)}%` }
    if (key === 'wSongPlus' || key === 'consistencyPlus') return { text: String(Math.round(v as number)) }
    return { text: (v as number).toFixed(2) }
  }

  return (
    <>
      {/* Click-and-sort buttons. Tapping the active one flips asc <-> desc. A
          horizontal ScrollView (not FlatList) so the pills size to their content
          and the custom-font glyphs / arrows aren't vertically clipped. */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.sortRow}
        contentContainerStyle={styles.sortRowContent}
      >
        {ARTIST_COLS.map((item) => {
          const on = sortKey === item.key
          return (
            <Pressable key={item.key} style={[styles.sortChip, on && styles.sortChipActive]} onPress={() => sort(item.key)}>
              <Text style={[styles.sortChipText, on && styles.sortChipTextActive]} numberOfLines={1}>
                {item.label}{on ? (sortDir === 'desc' ? ' ↓' : ' ↑') : ''}
              </Text>
            </Pressable>
          )
        })}
      </ScrollView>
      <Text style={styles.qualifyNote}>
        Artists must have at least {QUALIFIED} rated songs to appear here.
      </Text>
      <FlatList
        data={rows}
        keyExtractor={(r) => r.artist}
        contentContainerStyle={styles.list}
        renderItem={({ item, index }) => {
          const metric = fmt(item, sortKey)
          return (
            <Pressable style={styles.artistRow} onPress={() => onOpen(item.artist)}>
              <Text style={styles.rank}>{index + 1}</Text>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.cellName} numberOfLines={1}>{item.artist}</Text>
                <Text style={styles.cellSub}>{item.songs} songs · avg {item.songScore.toFixed(2)}</Text>
              </View>
              <Text style={[styles.metricVal, metric.color ? { color: metric.color } : null]}>{metric.text}</Text>
            </Pressable>
          )
        }}
        ListEmptyComponent={<Text style={styles.empty}>{scatter ? `No artists with at least ${QUALIFIED} rated songs yet.` : 'Loading…'}</Text>}
      />
    </>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  title: { fontFamily: fonts.display, fontSize: 34, color: colors.ink, letterSpacing: 1, paddingHorizontal: spacing.lg, marginTop: spacing.md },

  tabBar: { flexDirection: 'row', paddingHorizontal: spacing.lg, marginTop: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border },
  tab: { marginRight: spacing.xl, alignItems: 'center' },
  tabText: { fontFamily: fonts.bodySemiBold, fontSize: 15, color: colors.inkMuted, paddingBottom: spacing.sm },
  tabTextActive: { color: colors.ink },
  tabRule: { height: 2, alignSelf: 'stretch', backgroundColor: 'transparent', marginBottom: -1 },
  tabRuleActive: { backgroundColor: colors.green },

  searchBar: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginHorizontal: spacing.lg, marginTop: spacing.md, paddingHorizontal: spacing.md, height: 42, backgroundColor: colors.raised, borderRadius: radii.md, borderWidth: 1, borderColor: colors.border },
  searchInput: { flex: 1, fontFamily: fonts.body, fontSize: 15, color: colors.ink },

  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, paddingHorizontal: spacing.lg, marginTop: spacing.md },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 6, paddingHorizontal: 12, borderRadius: radii.pill, backgroundColor: colors.raised, borderWidth: 1, borderColor: colors.border, maxWidth: 200 },
  chipActive: { backgroundColor: colors.green, borderColor: colors.green },
  chipText: { fontFamily: fonts.bodyMedium, fontSize: 13, color: colors.inkSecondary },
  chipActiveText: { fontFamily: fonts.bodySemiBold, fontSize: 13, color: '#fff', flexShrink: 1 },

  tableScroll: { flex: 1, paddingLeft: spacing.lg, marginTop: spacing.md },

  // Artists — click-and-sort buttons (green active) + ranked list
  sortRow: { flexGrow: 0, marginTop: spacing.md },
  sortRowContent: { paddingHorizontal: spacing.lg, gap: spacing.sm, alignItems: 'center', paddingVertical: 2 },
  sortChip: { minHeight: 32, justifyContent: 'center', alignItems: 'center', paddingVertical: 6, paddingHorizontal: 14, borderRadius: radii.pill, backgroundColor: colors.greenSoft },
  sortChipActive: { backgroundColor: colors.green },
  sortChipText: { fontFamily: fonts.bodyMedium, fontSize: 13, lineHeight: 18, color: colors.green },
  sortChipTextActive: { color: '#fff', fontFamily: fonts.bodySemiBold },
  qualifyNote: { fontFamily: fonts.body, fontSize: 11, color: colors.inkTertiary, paddingHorizontal: spacing.lg, marginTop: spacing.sm },
  list: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: 140 },
  artistRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  metricVal: { fontFamily: fonts.bodyBold, fontSize: 17, color: colors.ink, minWidth: 56, textAlign: 'right' },

  th: { height: HEAD_H, justifyContent: 'center', paddingHorizontal: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border },
  thText: { fontFamily: fonts.bodyBold, fontSize: 11, letterSpacing: 0.4, color: colors.inkMuted, textTransform: 'uppercase' },
  thActive: { color: colors.green },

  pinnedCell: { height: ROW_H, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingRight: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  rank: { fontFamily: fonts.body, fontSize: 12, color: colors.inkMuted, width: 20, textAlign: 'center' },
  art: { width: 36, height: 36, borderRadius: radii.sm },
  artFallback: { backgroundColor: colors.inset, alignItems: 'center', justifyContent: 'center' },
  artInitial: { fontFamily: fonts.display, fontSize: 16, color: colors.inkMuted },
  cellName: { fontFamily: fonts.bodySemiBold, fontSize: 14, color: colors.ink },
  cellSub: { fontFamily: fonts.body, fontSize: 12, color: colors.inkTertiary, marginTop: 1 },

  metricRow: { flexDirection: 'row', height: ROW_H, alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  td: { height: ROW_H, justifyContent: 'center', paddingHorizontal: spacing.sm },
  tdText: { fontFamily: fonts.bodyMedium, fontSize: 13, color: colors.inkSecondary },

  empty: { fontFamily: fonts.body, fontSize: 14, color: colors.inkTertiary, textAlign: 'center', marginTop: spacing.xxl },

  backdrop: { flex: 1, backgroundColor: 'rgba(28,25,23,0.4)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.bg, borderTopLeftRadius: radii.xl, borderTopRightRadius: radii.xl, paddingTop: spacing.lg, paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl, maxHeight: '70%' },
  sheetHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.md },
  sheetTitle: { fontFamily: fonts.bodySemiBold, fontSize: 16, color: colors.ink },
  optionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border },
  optionText: { fontFamily: fonts.bodyMedium, fontSize: 15, color: colors.ink },
})
