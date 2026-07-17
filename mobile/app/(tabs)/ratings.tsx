// Ratings — two tabs mirroring the desktop page:
//   Albums  — every rated album, searchable + filterable (genre / decade /
//             release type) and sortable by score, year, name, or any factor.
//   Artists — artist rankings (≥15 songs) by avg song score, wSong+,
//             consistency+, bang% or skip%, each linking to its Artist page.
import { useMemo, useState } from 'react'
import {
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
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
type ReleaseType = 'LP' | 'EP' | 'Single'
const QUALIFIED = 15

// ── Albums sorting ──
type AlbumSortKey = 'score' | 'year' | 'albumName' | 'theme' | 'replayValue' | 'production' | 'distinctness'
const ALBUM_SORTS: { key: AlbumSortKey; label: string }[] = [
  { key: 'score', label: 'Score' },
  { key: 'year', label: 'Year' },
  { key: 'albumName', label: 'Name' },
  { key: 'theme', label: 'Theme' },
  { key: 'replayValue', label: 'Replay' },
  { key: 'production', label: 'Prod.' },
  { key: 'distinctness', label: 'Dist.' },
]

// ── Artists sorting ──
type ArtistSortKey = 'songScore' | 'wSongPlus' | 'consistencyPlus' | 'bangPct' | 'skipPct' | 'external'
const ARTIST_SORTS: { key: ArtistSortKey; label: string }[] = [
  { key: 'songScore', label: 'Avg song' },
  { key: 'wSongPlus', label: 'wSong+' },
  { key: 'consistencyPlus', label: 'Consist.+' },
  { key: 'bangPct', label: 'Bang %' },
  { key: 'skipPct', label: 'Skip %' },
  { key: 'external', label: 'External' },
]

function releaseType(a: Album): ReleaseType {
  return shortReleaseLabel(a) ?? 'LP'
}
function decadeOf(year: number | null): string | null {
  return year ? `${Math.floor(year / 10) * 10}s` : null
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
            <Text style={[styles.tabText, tab === t && styles.tabTextActive]}>
              {t === 'albums' ? 'Albums' : 'Artists'}
            </Text>
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

function AlbumsTab({ userId, onOpen }: { userId: number; onOpen: (id: number) => void }) {
  const [search, setSearch] = useState('')
  const [genre, setGenre] = useState<string | null>(null)
  const [decade, setDecade] = useState<string | null>(null)
  const [type, setType] = useState<ReleaseType | null>(null)
  const [picker, setPicker] = useState<null | 'genre' | 'decade' | 'type'>(null)
  const [sortKey, setSortKey] = useState<AlbumSortKey>('score')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')

  const { data: albums = [] } = useQuery({
    queryKey: ['albums', 'rated', userId],
    queryFn: () => fetchAlbums({ status: 'rated', userId }),
    enabled: userId > 0,
  })

  const options = useMemo(() => {
    const genres = new Set<string>()
    const decades = new Set<string>()
    for (const a of albums) {
      if (a.genre) genres.add(a.genre)
      const d = decadeOf(a.year)
      if (d) decades.add(d)
    }
    return {
      genre: [...genres].sort(),
      decade: [...decades].sort().reverse(),
      type: ['LP', 'EP', 'Single'] as ReleaseType[],
    }
  }, [albums])

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase()
    const filtered = albums.filter((a) => {
      if (q && !a.albumName.toLowerCase().includes(q) && !a.artist.toLowerCase().includes(q)) return false
      if (genre && a.genre !== genre) return false
      if (decade && decadeOf(a.year) !== decade) return false
      if (type && releaseType(a) !== type) return false
      return true
    })
    return [...filtered].sort((a, b) => {
      const av = a[sortKey] ?? (sortKey === 'albumName' ? '' : -Infinity)
      const bv = b[sortKey] ?? (sortKey === 'albumName' ? '' : -Infinity)
      if (av < bv) return sortDir === 'asc' ? -1 : 1
      if (av > bv) return sortDir === 'asc' ? 1 : -1
      return 0
    })
  }, [albums, search, genre, decade, type, sortKey, sortDir])

  function toggleSort(key: AlbumSortKey) {
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    else { setSortKey(key); setSortDir('desc') }
  }

  const activeFilters = [
    genre ? { key: 'genre', label: genre, clear: () => setGenre(null) } : null,
    decade ? { key: 'decade', label: decade, clear: () => setDecade(null) } : null,
    type ? { key: 'type', label: type, clear: () => setType(null) } : null,
  ].filter(Boolean) as { key: string; label: string; clear: () => void }[]
  const availableChips = (['genre', 'decade', 'type'] as const).filter((k) => !activeFilters.some((f) => f.key === k))

  function setPickerValue(v: string) {
    if (picker === 'genre') setGenre(v)
    else if (picker === 'decade') setDecade(v)
    else if (picker === 'type') setType(v as ReleaseType)
    setPicker(null)
  }
  const pickerValues = picker ? options[picker] : []
  const pickerCurrent = picker === 'genre' ? genre : picker === 'decade' ? decade : type

  return (
    <>
      <View style={styles.searchBar}>
        <Search size={16} color={colors.inkMuted} />
        <TextInput
          style={styles.searchInput}
          value={search}
          onChangeText={setSearch}
          placeholder="Search albums or artists"
          placeholderTextColor={colors.inkMuted}
          autoCorrect={false}
        />
        {search.length > 0 && <Pressable onPress={() => setSearch('')} hitSlop={8}><X size={15} color={colors.inkMuted} /></Pressable>}
      </View>

      {/* Filter chips */}
      <View style={styles.chipRow}>
        {activeFilters.map((f) => (
          <Pressable key={f.key} style={[styles.chip, styles.chipActive]} onPress={f.clear}>
            <Text style={styles.chipActiveText}>{f.label}</Text>
            <X size={12} color="#fff" />
          </Pressable>
        ))}
        {availableChips.map((k) => (
          <Pressable key={k} style={styles.chip} onPress={() => setPicker(k)}>
            <Text style={styles.chipText}>{k[0].toUpperCase() + k.slice(1)}</Text>
            <ChevronDown size={12} color={colors.inkTertiary} />
          </Pressable>
        ))}
      </View>

      {/* Sort chips */}
      <FlatList
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.sortRow}
        contentContainerStyle={styles.sortRowContent}
        data={ALBUM_SORTS}
        keyExtractor={(s) => s.key}
        renderItem={({ item }) => {
          const active = sortKey === item.key
          return (
            <Pressable style={[styles.sortChip, active && styles.sortChipActive]} onPress={() => toggleSort(item.key)}>
              <Text style={[styles.sortChipText, active && styles.sortChipTextActive]}>
                {item.label}{active ? (sortDir === 'desc' ? ' ↓' : ' ↑') : ''}
              </Text>
            </Pressable>
          )
        }}
      />

      <FlatList
        data={rows}
        keyExtractor={(a) => String(a.id)}
        contentContainerStyle={styles.list}
        keyboardShouldPersistTaps="handled"
        renderItem={({ item, index }) => {
          const tag = shortReleaseLabel(item)
          return (
            <Pressable style={styles.albumRow} onPress={() => onOpen(item.id)}>
              <Text style={styles.rank}>{index + 1}</Text>
              {item.albumArtUrl ? (
                <Image source={{ uri: item.albumArtUrl }} style={styles.albumArt} contentFit="cover" />
              ) : (
                <View style={[styles.albumArt, styles.artFallback]}><Text style={styles.artInitial}>{item.albumName[0]}</Text></View>
              )}
              <View style={styles.rowText}>
                <View style={styles.nameLine}>
                  <Text style={styles.albumName} numberOfLines={1}>{item.albumName}</Text>
                  {tag && <Text style={styles.tag}>{tag}</Text>}
                </View>
                <Text style={styles.rowSub} numberOfLines={1}>{item.artist}{item.year ? ` · ${item.year}` : ''}</Text>
              </View>
              {item.score != null && (
                <Text style={[styles.scoreVal, { color: songScoreColor(item.score) }]}>{item.score.toFixed(2)}</Text>
              )}
            </Pressable>
          )
        }}
        ListEmptyComponent={<Text style={styles.empty}>{albums.length === 0 ? 'No rated albums yet.' : 'No albums match these filters.'}</Text>}
      />

      <Modal visible={picker !== null} transparent animationType="slide" onRequestClose={() => setPicker(null)}>
        <Pressable style={styles.backdrop} onPress={() => setPicker(null)}>
          <Pressable style={styles.sheet}>
            <View style={styles.sheetHead}>
              <Text style={styles.sheetTitle}>{picker ? picker[0].toUpperCase() + picker.slice(1) : ''}</Text>
              <Pressable onPress={() => setPicker(null)} hitSlop={10}><X size={20} color={colors.inkTertiary} /></Pressable>
            </View>
            <FlatList
              data={pickerValues}
              keyExtractor={(v) => v}
              renderItem={({ item }) => (
                <Pressable style={styles.optionRow} onPress={() => setPickerValue(item)}>
                  <Text style={styles.optionText}>{item}</Text>
                  {pickerCurrent === item && <Check size={18} color={colors.green} />}
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

function ArtistsTab({ userId, onOpen }: { userId: number; onOpen: (name: string) => void }) {
  const [sortKey, setSortKey] = useState<ArtistSortKey>('wSongPlus')

  const { data: scatter } = useQuery({
    queryKey: ['stats', 'scatter', userId],
    queryFn: () => fetchScatterData(userId),
    enabled: userId > 0,
    staleTime: 5 * 60_000,
  })
  const { data: artistStats = [] } = useQuery({
    queryKey: ['stats', 'artists', userId],
    queryFn: () => fetchArtistStats(userId),
    enabled: userId > 0,
    staleTime: 5 * 60_000,
  })

  const rows = useMemo(() => {
    const statBy = new Map(artistStats.map((s) => [s.artist, s]))
    const merged = (scatter?.points ?? [])
      .filter((p) => p.song_count >= QUALIFIED)
      .map((p) => {
        const st = statBy.get(p.artist)
        return {
          artist: p.artist,
          songs: p.song_count,
          songScore: p.avg_song_score,
          external: p.avg_external,
          wSongPlus: p.w_song_plus,
          consistencyPlus: p.consistency_plus,
          bangPct: st?.bangPct ?? null,
          skipPct: st?.skipPct ?? null,
        }
      })
    return merged.sort((a, b) => (Number(b[sortKey] ?? -Infinity)) - (Number(a[sortKey] ?? -Infinity)))
  }, [scatter, artistStats, sortKey])

  function fmt(key: ArtistSortKey, v: number | null): string {
    if (v == null) return '—'
    if (key === 'bangPct' || key === 'skipPct') return `${Math.round(v * 100)}%`
    if (key === 'wSongPlus' || key === 'consistencyPlus') return String(Math.round(v))
    return v.toFixed(2)
  }

  return (
    <>
      <FlatList
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.sortRow}
        contentContainerStyle={styles.sortRowContent}
        data={ARTIST_SORTS}
        keyExtractor={(s) => s.key}
        renderItem={({ item }) => {
          const active = sortKey === item.key
          return (
            <Pressable style={[styles.sortChip, active && styles.sortChipActive]} onPress={() => setSortKey(item.key)}>
              <Text style={[styles.sortChipText, active && styles.sortChipTextActive]}>{item.label}</Text>
            </Pressable>
          )
        }}
      />
      <FlatList
        data={rows}
        keyExtractor={(r) => r.artist}
        contentContainerStyle={styles.list}
        renderItem={({ item, index }) => (
          <Pressable style={styles.artistRow} onPress={() => onOpen(item.artist)}>
            <Text style={styles.rank}>{index + 1}</Text>
            <View style={styles.rowText}>
              <Text style={styles.artistName} numberOfLines={1}>{item.artist}</Text>
              <Text style={styles.rowSub}>{item.songs} songs · avg {item.songScore.toFixed(2)}</Text>
            </View>
            <Text style={styles.metricVal}>{fmt(sortKey, item[sortKey])}</Text>
          </Pressable>
        )}
        ListEmptyComponent={
          <Text style={styles.empty}>
            {scatter ? `No artists with at least ${QUALIFIED} rated songs yet.` : 'Loading…'}
          </Text>
        }
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

  searchBar: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    marginHorizontal: spacing.lg, marginTop: spacing.md, paddingHorizontal: spacing.md, height: 42,
    backgroundColor: colors.raised, borderRadius: radii.md, borderWidth: 1, borderColor: colors.border,
  },
  searchInput: { flex: 1, fontFamily: fonts.body, fontSize: 15, color: colors.ink },

  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, paddingHorizontal: spacing.lg, marginTop: spacing.md },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 6, paddingHorizontal: 12, borderRadius: radii.pill, backgroundColor: colors.raised, borderWidth: 1, borderColor: colors.border },
  chipActive: { backgroundColor: colors.green, borderColor: colors.green },
  chipText: { fontFamily: fonts.bodyMedium, fontSize: 13, color: colors.inkSecondary },
  chipActiveText: { fontFamily: fonts.bodySemiBold, fontSize: 13, color: '#fff' },

  sortRow: { flexGrow: 0, marginTop: spacing.md },
  sortRowContent: { paddingHorizontal: spacing.lg, gap: spacing.sm },
  sortChip: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: radii.pill, backgroundColor: colors.inset },
  sortChipActive: { backgroundColor: colors.ink },
  sortChipText: { fontFamily: fonts.bodyMedium, fontSize: 13, color: colors.inkSecondary },
  sortChipTextActive: { color: '#fff', fontFamily: fonts.bodySemiBold },

  list: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: 120 },
  albumRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.sm },
  artistRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  rank: { fontFamily: fonts.display, fontSize: 15, color: colors.inkMuted, width: 24, textAlign: 'center' },
  albumArt: { width: 48, height: 48, borderRadius: radii.sm },
  artFallback: { backgroundColor: colors.inset, alignItems: 'center', justifyContent: 'center' },
  artInitial: { fontFamily: fonts.display, fontSize: 20, color: colors.inkMuted },
  rowText: { flex: 1, minWidth: 0 },
  nameLine: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  albumName: { fontFamily: fonts.bodySemiBold, fontSize: 15, color: colors.ink, flexShrink: 1 },
  artistName: { fontFamily: fonts.bodySemiBold, fontSize: 15, color: colors.ink },
  tag: { fontFamily: fonts.bodyBold, fontSize: 9, letterSpacing: 0.5, color: colors.inkTertiary, backgroundColor: colors.inset, paddingHorizontal: 5, paddingVertical: 1, borderRadius: 4, overflow: 'hidden' },
  rowSub: { fontFamily: fonts.body, fontSize: 13, color: colors.inkTertiary, marginTop: 1 },
  scoreVal: { fontFamily: fonts.bodyBold, fontSize: 17 },
  metricVal: { fontFamily: fonts.bodyBold, fontSize: 17, color: colors.ink, minWidth: 52, textAlign: 'right' },

  empty: { fontFamily: fonts.body, fontSize: 14, color: colors.inkTertiary, textAlign: 'center', marginTop: spacing.xxl },

  backdrop: { flex: 1, backgroundColor: 'rgba(28,25,23,0.4)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.bg, borderTopLeftRadius: radii.xl, borderTopRightRadius: radii.xl, paddingTop: spacing.lg, paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl, maxHeight: '70%' },
  sheetHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.md },
  sheetTitle: { fontFamily: fonts.bodySemiBold, fontSize: 16, color: colors.ink },
  optionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border },
  optionText: { fontFamily: fonts.bodyMedium, fontSize: 15, color: colors.ink },
})
