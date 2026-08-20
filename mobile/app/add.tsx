// The "+" sheet: search across iTunes / Deezer / MusicBrainz (shared, ranked
// fan-out), then resolve the picked album's tracklist, import it as
// "listening", and jump straight into rating it — the app's core loop start.
import { useState } from 'react'
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { Image } from 'expo-image'
import { Check, Plus, Search, Star, X } from 'lucide-react-native'
import { useQueryClient } from '@tanstack/react-query'
import { useAlbumSearch } from '@pressd/shared/hooks/useAlbumSearch'
import type { AlbumSearchResult } from '@pressd/shared/api'
import { importAlbum, resolveAlbum } from '../lib/api'
import { useAuth } from '../lib/auth'
import TracklistLoader from '../components/TracklistLoader'
import { colors, fonts, radii, spacing, NUM_SCALE_CAP } from '../theme/tokens'

/** "· 2016" when the year is known, "· 12 tracks" when it isn't (Deezer's
 *  search payload carries no release date), and nothing when neither is. */
function meta(r: AlbumSearchResult): string {
  if (r.year) return ` · ${r.year}`
  if (r.total_tracks) return ` · ${r.total_tracks} tracks`
  return ''
}

export default function AddAlbum() {
  const router = useRouter()
  const { user } = useAuth()
  const [query, setQuery] = useState('')
  const { results, searching, mbPending, noResults } = useAlbumSearch(query)
  const [picked, setPicked] = useState<AlbumSearchResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Rows already shelved this session — the list stays put after "add", so
  // without a mark there's nothing to show the tap landed.
  const [shelved, setShelved] = useState<string[]>([])
  const queryClient = useQueryClient()

  function keyFor(r: AlbumSearchResult): string {
    return `${r.source}:${r.source_id}`
  }

  /** The third way out of a search result: look before you commit. Opens the
   *  userbase view by name+artist — the record may not be in Pressd at all yet
   *  — carrying the Deezer id when we have one so the tracklist resolves and
   *  Rate now can import from it. Nothing is written to the library here. */
  function preview(r: AlbumSearchResult) {
    const deezerId = r.source === 'deezer' ? r.source_id : null
    router.push({
      pathname: '/album/[id]',
      params: {
        // The id segment goes unused once name+artist are present, but the
        // route still requires one.
        id: deezerId ?? '0',
        name: r.album_name,
        artist: r.artist,
        ...(deezerId ? { deezer: deezerId } : {}),
      },
    })
  }

  /** Both actions import the same album — they differ in the status it lands
   *  in and where you end up. "Rate now" opens the rating flow; "Add to
   *  library" shelves it under To Listen and stays here, so several records
   *  can be queued from one search. */
  async function pick(r: AlbumSearchResult, mode: 'rate' | 'shelve') {
    if (picked || !user) return
    setPicked(r)
    setError(null)
    try {
      const full = await resolveAlbum(r)
      const album = await importAlbum(full, mode === 'rate' ? 'listening' : 'to_listen', user.id)
      if (mode === 'rate') {
        router.replace({ pathname: '/rate/[id]', params: { id: String(album.id) } })
        return
      }
      // Shelved: the library grids are now stale wherever they're mounted.
      queryClient.invalidateQueries({ queryKey: ['albums'] })
      setShelved((s) => [...s, keyFor(r)])
      setPicked(null)
    } catch {
      setError('Could not load that album. Try another result.')
      setPicked(null)
    }
  }

  // The tracklist fetch owns the whole sheet — there's nothing useful to do on
  // the results list while it runs, and the pick is already committed.
  if (picked) {
    return (
      <SafeAreaView style={styles.screen} edges={['top']}>
        <TracklistLoader
          albumName={picked.album_name}
          artist={picked.artist}
          coverUrl={picked.cover_url}
        />
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.title}>Add an album</Text>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Text style={styles.cancel}>Cancel</Text>
        </Pressable>
      </View>

      <View style={styles.searchBar}>
        <Search size={18} color={colors.inkMuted} />
        <TextInput
          style={styles.input}
          value={query}
          onChangeText={setQuery}
          placeholder="Search albums or artists"
          placeholderTextColor={colors.inkMuted}
          autoFocus
          autoCorrect={false}
          returnKeyType="search"
        />
        {query.length > 0 && (
          <Pressable onPress={() => setQuery('')} hitSlop={8}>
            <X size={16} color={colors.inkMuted} />
          </Pressable>
        )}
      </View>

      {error && <Text style={styles.error}>{error}</Text>}

      <FlatList
        data={results}
        keyExtractor={keyFor}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.list}
        ListHeaderComponent={
          searching && results.length === 0 ? (
            <View style={styles.centerNote}>
              <ActivityIndicator color={colors.green} />
            </View>
          ) : mbPending && results.length > 0 ? (
            <Text style={styles.pending}>Checking MusicBrainz for more…</Text>
          ) : null
        }
        ListEmptyComponent={
          noResults && !searching ? (
            <Text style={styles.centerNote}>No albums found for "{query.trim()}".</Text>
          ) : query.trim().length < 2 ? (
            <Text style={styles.hint}>Start typing to search across every source.</Text>
          ) : null
        }
        renderItem={({ item }) => {
          const done = shelved.includes(keyFor(item))
          return (
            <View style={styles.row}>
              {/* The record itself is the third action: tap it to read the
                  tracklist before deciding. Only the art and title area — the
                  two buttons keep their own targets. */}
              <Pressable
                style={styles.rowMain}
                onPress={() => preview(item)}
                accessibilityLabel={`See ${item.album_name} by ${item.artist}`}
              >
                {item.cover_url ? (
                  <Image source={{ uri: item.cover_url }} style={styles.cover} contentFit="cover" />
                ) : (
                  <View style={[styles.cover, styles.coverFallback]}>
                    <Text style={styles.coverInitial} numberOfLines={1} adjustsFontSizeToFit maxFontSizeMultiplier={NUM_SCALE_CAP}>{item.album_name[0]?.toUpperCase()}</Text>
                  </View>
                )}
                <View style={styles.rowText}>
                  <Text style={styles.albumName} numberOfLines={1}>{item.album_name}</Text>
                  <Text style={styles.meta} numberOfLines={1}>
                    {item.artist}
                    {meta(item)}
                    {item.upcoming ? ' · upcoming' : ''}
                  </Text>
                </View>
              </Pressable>

              {/* Two ways in: score it now, or shelve it for later. Icons rather
                  than labels — at this row height, two worded buttons would
                  crowd out the album name they belong to. */}
              <View style={styles.actions}>
                <Pressable
                  onPress={() => pick(item, 'rate')}
                  hitSlop={6}
                  accessibilityLabel={`Rate ${item.album_name} now`}
                  style={({ pressed }) => [styles.actionBtn, pressed && styles.actionBtnOn]}
                >
                  <Star size={17} color={colors.green} strokeWidth={2.2} />
                </Pressable>
                <Pressable
                  onPress={() => pick(item, 'shelve')}
                  disabled={done}
                  hitSlop={6}
                  accessibilityLabel={`Add ${item.album_name} to library`}
                  style={({ pressed }) => [
                    styles.actionBtn,
                    done && styles.actionBtnDone,
                    pressed && !done && styles.actionBtnOn,
                  ]}
                >
                  {done ? (
                    <Check size={17} color={colors.green} strokeWidth={2.5} />
                  ) : (
                    <Plus size={17} color={colors.green} strokeWidth={2.5} />
                  )}
                </Pressable>
              </View>
            </View>
          )
        }}
      />
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
  },
  title: { fontFamily: fonts.display, fontSize: 26, color: colors.ink, letterSpacing: 1 },
  cancel: { fontFamily: fonts.bodyMedium, fontSize: 15, color: colors.inkTertiary },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginHorizontal: spacing.lg,
    paddingHorizontal: spacing.md,
    height: 46,
    backgroundColor: colors.raised,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  input: { flex: 1, fontFamily: fonts.body, fontSize: 15, color: colors.ink },
  error: {
    fontFamily: fonts.bodyMedium,
    fontSize: 13,
    color: '#b91c1c',
    textAlign: 'center',
    marginTop: spacing.sm,
  },
  list: { padding: spacing.lg, gap: spacing.xs },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.sm,
    borderRadius: radii.md,
  },
  // Takes the row's slack so the tap target reaches the buttons rather than
  // stopping at the end of the title.
  rowMain: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  cover: { width: 52, height: 52, borderRadius: radii.sm },
  coverFallback: { backgroundColor: colors.inset, alignItems: 'center', justifyContent: 'center' },
  coverInitial: { fontFamily: fonts.display, fontSize: 22, color: colors.inkMuted },
  rowText: { flex: 1, minWidth: 0 },
  albumName: { fontFamily: fonts.bodySemiBold, fontSize: 15, color: colors.ink },
  meta: { fontFamily: fonts.body, fontSize: 13, color: colors.inkTertiary, marginTop: 2 },
  actions: { flexDirection: 'row', gap: 8 },
  actionBtn: {
    width: 34,
    height: 34,
    borderRadius: radii.sm,
    backgroundColor: colors.greenSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionBtnOn: { opacity: 0.55 },
  actionBtnDone: { backgroundColor: colors.inset },
  centerNote: {
    fontFamily: fonts.body,
    fontSize: 14,
    color: colors.inkTertiary,
    textAlign: 'center',
    marginTop: spacing.xxl,
  },
  pending: {
    fontFamily: fonts.body,
    fontSize: 12,
    color: colors.inkMuted,
    textAlign: 'center',
    marginBottom: spacing.sm,
  },
  hint: {
    fontFamily: fonts.body,
    fontSize: 14,
    color: colors.inkMuted,
    textAlign: 'center',
    marginTop: spacing.xxl,
  },
})
