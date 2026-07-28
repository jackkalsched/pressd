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
import { Plus, Search, X } from 'lucide-react-native'
import { useAlbumSearch } from '@pressd/shared/hooks/useAlbumSearch'
import type { AlbumSearchResult } from '@pressd/shared/api'
import { importAlbum, resolveAlbum } from '../lib/api'
import { useAuth } from '../lib/auth'
import TracklistLoader from '../components/TracklistLoader'
import { colors, fonts, radii, spacing } from '../theme/tokens'

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

  function keyFor(r: AlbumSearchResult): string {
    return `${r.source}:${r.source_id}`
  }

  async function pick(r: AlbumSearchResult) {
    if (picked || !user) return
    setPicked(r)
    setError(null)
    try {
      const full = await resolveAlbum(r)
      const album = await importAlbum(full, 'listening', user.id)
      router.replace({ pathname: '/rate/[id]', params: { id: String(album.id) } })
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
        renderItem={({ item }) => (
          <Pressable
            style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.inset }]}
            onPress={() => pick(item)}
          >
            {item.cover_url ? (
              <Image source={{ uri: item.cover_url }} style={styles.cover} contentFit="cover" />
            ) : (
              <View style={[styles.cover, styles.coverFallback]}>
                <Text style={styles.coverInitial}>{item.album_name[0]?.toUpperCase()}</Text>
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
            <View style={styles.addBtn}>
              <Plus size={18} color={colors.green} strokeWidth={2.5} />
            </View>
          </Pressable>
        )}
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
  cover: { width: 52, height: 52, borderRadius: radii.sm },
  coverFallback: { backgroundColor: colors.inset, alignItems: 'center', justifyContent: 'center' },
  coverInitial: { fontFamily: fonts.display, fontSize: 22, color: colors.inkMuted },
  rowText: { flex: 1, minWidth: 0 },
  albumName: { fontFamily: fonts.bodySemiBold, fontSize: 15, color: colors.ink },
  meta: { fontFamily: fonts.body, fontSize: 13, color: colors.inkTertiary, marginTop: 2 },
  addBtn: {
    width: 34,
    height: 34,
    borderRadius: radii.sm,
    backgroundColor: colors.greenSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
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
