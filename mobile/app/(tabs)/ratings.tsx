// Ratings — your rated library two ways: Recent (newest first) and All-Time
// (ranked by score). Client-side filters over the rated set: artist/album
// search, genre, subgenre, decade, and release type (LP / EP / Single).
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
import { fetchAlbums } from '../../lib/api'
import { shortReleaseLabel, songScoreColor, type Album } from '@pressd/shared/types'
import { useAuth } from '../../lib/auth'
import { colors, fonts, radii, spacing } from '../../theme/tokens'

type Mode = 'recent' | 'alltime'
type ReleaseType = 'LP' | 'EP' | 'Single'

function releaseType(a: Album): ReleaseType {
  return shortReleaseLabel(a) ?? 'LP'
}
function decadeOf(year: number | null): string | null {
  if (!year) return null
  return `${Math.floor(year / 10) * 10}s`
}

export default function Ratings() {
  const { user } = useAuth()
  const router = useRouter()
  const [mode, setMode] = useState<Mode>('recent')
  const [search, setSearch] = useState('')
  const [genre, setGenre] = useState<string | null>(null)
  const [subgenre, setSubgenre] = useState<string | null>(null)
  const [decade, setDecade] = useState<string | null>(null)
  const [type, setType] = useState<ReleaseType | null>(null)
  const [picker, setPicker] = useState<null | 'genre' | 'subgenre' | 'decade' | 'type'>(null)

  const { data: rated = [] } = useQuery({
    queryKey: ['albums', 'rated', user?.id],
    queryFn: () => fetchAlbums({ status: 'rated', userId: user!.id }),
    enabled: !!user,
  })

  // Distinct option lists from the library.
  const options = useMemo(() => {
    const genres = new Set<string>()
    const subs = new Set<string>()
    const decades = new Set<string>()
    for (const a of rated) {
      if (a.genre) genres.add(a.genre)
      for (const s of [a.subGenre1, a.subGenre2, a.subGenre3]) if (s) subs.add(s)
      const d = decadeOf(a.year)
      if (d) decades.add(d)
    }
    return {
      genre: [...genres].sort(),
      subgenre: [...subs].sort(),
      decade: [...decades].sort().reverse(),
      type: ['LP', 'EP', 'Single'] as ReleaseType[],
    }
  }, [rated])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    const list = rated.filter((a) => {
      if (q && !a.albumName.toLowerCase().includes(q) && !a.artist.toLowerCase().includes(q)) return false
      if (genre && a.genre !== genre) return false
      if (subgenre && ![a.subGenre1, a.subGenre2, a.subGenre3].includes(subgenre)) return false
      if (decade && decadeOf(a.year) !== decade) return false
      if (type && releaseType(a) !== type) return false
      return true
    })
    return [...list].sort((a, b) =>
      mode === 'alltime'
        ? (b.score ?? 0) - (a.score ?? 0)
        : (b.dateRated ?? '').localeCompare(a.dateRated ?? ''),
    )
  }, [rated, search, genre, subgenre, decade, type, mode])

  const activeFilters = [
    genre ? { key: 'genre' as const, label: genre, clear: () => setGenre(null) } : null,
    subgenre ? { key: 'subgenre' as const, label: subgenre, clear: () => setSubgenre(null) } : null,
    decade ? { key: 'decade' as const, label: decade, clear: () => setDecade(null) } : null,
    type ? { key: 'type' as const, label: type, clear: () => setType(null) } : null,
  ].filter(Boolean) as { key: string; label: string; clear: () => void }[]

  function setPickerValue(value: string) {
    if (picker === 'genre') setGenre(value)
    else if (picker === 'subgenre') setSubgenre(value)
    else if (picker === 'decade') setDecade(value)
    else if (picker === 'type') setType(value as ReleaseType)
    setPicker(null)
  }

  const pickerValues = picker ? options[picker] : []
  const pickerCurrent =
    picker === 'genre' ? genre : picker === 'subgenre' ? subgenre : picker === 'decade' ? decade : type

  const availableChips = (['genre', 'subgenre', 'decade', 'type'] as const).filter(
    (k) => !activeFilters.some((f) => f.key === k),
  )

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <Text style={styles.title}>Ratings</Text>

      <View style={styles.segment}>
        {(['recent', 'alltime'] as Mode[]).map((m) => (
          <Pressable
            key={m}
            style={[styles.segmentTab, mode === m && styles.segmentActive]}
            onPress={() => setMode(m)}
          >
            <Text style={[styles.segmentText, mode === m && styles.segmentTextActive]}>
              {m === 'recent' ? 'Recent' : 'All-Time'}
            </Text>
          </Pressable>
        ))}
      </View>

      <View style={styles.searchBar}>
        <Search size={16} color={colors.inkMuted} />
        <TextInput
          style={styles.searchInput}
          value={search}
          onChangeText={setSearch}
          placeholder="Search album or artist"
          placeholderTextColor={colors.inkMuted}
          autoCorrect={false}
        />
        {search.length > 0 && (
          <Pressable onPress={() => setSearch('')} hitSlop={8}>
            <X size={15} color={colors.inkMuted} />
          </Pressable>
        )}
      </View>

      <FlatList
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.chipRow}
        contentContainerStyle={styles.chipRowContent}
        data={availableChips}
        keyExtractor={(k) => k}
        ListHeaderComponent={
          activeFilters.length > 0 ? (
            <View style={styles.activeChips}>
              {activeFilters.map((f) => (
                <Pressable key={f.key} style={[styles.chip, styles.chipActive]} onPress={f.clear}>
                  <Text style={styles.chipActiveText}>{f.label}</Text>
                  <X size={13} color="#fff" />
                </Pressable>
              ))}
            </View>
          ) : null
        }
        renderItem={({ item }) => (
          <Pressable style={styles.chip} onPress={() => setPicker(item)}>
            <Text style={styles.chipText}>{item[0].toUpperCase() + item.slice(1)}</Text>
            <ChevronDown size={13} color={colors.inkTertiary} />
          </Pressable>
        )}
      />

      <FlatList
        data={filtered}
        keyExtractor={(a) => String(a.id)}
        contentContainerStyle={styles.list}
        keyboardShouldPersistTaps="handled"
        renderItem={({ item, index }) => {
          const tag = shortReleaseLabel(item)
          return (
            <Pressable
              style={styles.row}
              onPress={() => router.push({ pathname: '/album/[id]', params: { id: String(item.id) } })}
            >
              {mode === 'alltime' && <Text style={styles.rowRank}>{index + 1}</Text>}
              {item.albumArtUrl ? (
                <Image source={{ uri: item.albumArtUrl }} style={styles.rowArt} contentFit="cover" />
              ) : (
                <View style={[styles.rowArt, styles.artFallback]}>
                  <Text style={styles.artInitial}>{item.albumName[0]}</Text>
                </View>
              )}
              <View style={styles.rowText}>
                <View style={styles.rowNameLine}>
                  <Text style={styles.rowName} numberOfLines={1}>{item.albumName}</Text>
                  {tag && <Text style={styles.tag}>{tag}</Text>}
                </View>
                <Text style={styles.rowArtist} numberOfLines={1}>
                  {item.artist}{item.year ? ` · ${item.year}` : ''}
                </Text>
              </View>
              {item.score != null && (
                <Text style={[styles.rowScore, { color: songScoreColor(item.score) }]}>
                  {item.score.toFixed(2)}
                </Text>
              )}
            </Pressable>
          )
        }}
        ListEmptyComponent={
          <Text style={styles.empty}>
            {rated.length === 0 ? 'No rated albums yet.' : 'No albums match these filters.'}
          </Text>
        }
      />

      <Modal visible={picker !== null} transparent animationType="slide" onRequestClose={() => setPicker(null)}>
        <Pressable style={styles.backdrop} onPress={() => setPicker(null)}>
          <Pressable style={styles.sheet}>
            <View style={styles.sheetHead}>
              <Text style={styles.sheetTitle}>{picker ? picker[0].toUpperCase() + picker.slice(1) : ''}</Text>
              <Pressable onPress={() => setPicker(null)} hitSlop={10}>
                <X size={20} color={colors.inkTertiary} />
              </Pressable>
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
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  title: {
    fontFamily: fonts.display,
    fontSize: 34,
    color: colors.ink,
    letterSpacing: 1,
    paddingHorizontal: spacing.lg,
    marginTop: spacing.md,
  },
  segment: {
    flexDirection: 'row',
    backgroundColor: colors.inset,
    borderRadius: radii.md,
    padding: 4,
    marginHorizontal: spacing.lg,
    marginTop: spacing.md,
  },
  segmentTab: { flex: 1, paddingVertical: 8, alignItems: 'center', borderRadius: radii.sm },
  segmentActive: { backgroundColor: colors.raised },
  segmentText: { fontFamily: fonts.bodySemiBold, fontSize: 14, color: colors.inkTertiary },
  segmentTextActive: { color: colors.ink },

  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginHorizontal: spacing.lg,
    marginTop: spacing.md,
    paddingHorizontal: spacing.md,
    height: 42,
    backgroundColor: colors.raised,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  searchInput: { flex: 1, fontFamily: fonts.body, fontSize: 15, color: colors.ink },

  chipRow: { flexGrow: 0, marginTop: spacing.md },
  chipRowContent: { paddingHorizontal: spacing.lg, gap: spacing.sm, alignItems: 'center' },
  activeChips: { flexDirection: 'row', gap: spacing.sm, marginRight: spacing.sm },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: radii.pill,
    backgroundColor: colors.raised,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipActive: { backgroundColor: colors.green, borderColor: colors.green },
  chipText: { fontFamily: fonts.bodyMedium, fontSize: 13, color: colors.inkSecondary },
  chipActiveText: { fontFamily: fonts.bodySemiBold, fontSize: 13, color: '#fff' },

  list: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: 120 },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.sm },
  rowRank: { fontFamily: fonts.bodyBold, fontSize: 13, color: colors.inkMuted, width: 22, textAlign: 'center' },
  rowArt: { width: 48, height: 48, borderRadius: radii.sm },
  artFallback: { backgroundColor: colors.inset, alignItems: 'center', justifyContent: 'center' },
  artInitial: { fontFamily: fonts.display, fontSize: 20, color: colors.inkMuted },
  rowText: { flex: 1, minWidth: 0 },
  rowNameLine: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  rowName: { fontFamily: fonts.bodySemiBold, fontSize: 15, color: colors.ink, flexShrink: 1 },
  tag: {
    fontFamily: fonts.bodyBold,
    fontSize: 9,
    letterSpacing: 0.5,
    color: colors.inkTertiary,
    backgroundColor: colors.inset,
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 4,
    overflow: 'hidden',
  },
  rowArtist: { fontFamily: fonts.body, fontSize: 13, color: colors.inkTertiary, marginTop: 1 },
  rowScore: { fontFamily: fonts.bodyBold, fontSize: 17 },
  empty: { fontFamily: fonts.body, fontSize: 14, color: colors.inkTertiary, textAlign: 'center', marginTop: spacing.xxl },

  backdrop: { flex: 1, backgroundColor: 'rgba(28,25,23,0.4)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.bg,
    borderTopLeftRadius: radii.xl,
    borderTopRightRadius: radii.xl,
    paddingTop: spacing.lg,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xxl,
    maxHeight: '70%',
  },
  sheetHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.md },
  sheetTitle: { fontFamily: fonts.bodySemiBold, fontSize: 16, color: colors.ink },
  optionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  optionText: { fontFamily: fonts.bodyMedium, fontSize: 15, color: colors.ink },
})
