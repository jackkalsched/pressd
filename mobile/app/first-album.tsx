// The first-album sheet: the same rolled-up search the "+" tab uses, opened
// from the welcome screen.
//
// It exists because the welcome screen sets its search bar below a headline and
// two paragraphs of copy, which is right for a first-run page but leaves the
// field around the middle of the screen — exactly where the keyboard lands. As
// a sheet the field sits directly under the header instead, so the keyboard can
// only ever cover the bottom of the results.
//
// Picking is all this does. The pick goes back to welcome, which still owns the
// confirm step, so the onboarding flow reads the same as before: choose a
// record, then Start rating.
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import { useState } from 'react'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { Image } from 'expo-image'
import { Search, X } from 'lucide-react-native'
import { useAlbumSearch } from '@pressd/shared/hooks/useAlbumSearch'
import type { AlbumSearchResult } from '@pressd/shared/api'
import { setFirstAlbumPick } from '../lib/firstAlbumPick'
import { colors, fonts, radii, spacing } from '../theme/tokens'

/** "· 2016" when the year is known, "· 12 tracks" when it isn't (Deezer's
 *  search payload carries no release date), and nothing when neither is. */
function meta(r: AlbumSearchResult): string {
  if (r.year) return ` · ${r.year}`
  if (r.total_tracks) return ` · ${r.total_tracks} tracks`
  return ''
}

export default function FirstAlbumSheet() {
  const router = useRouter()
  const [query, setQuery] = useState('')
  const { results, searching, mbPending, noResults } = useAlbumSearch(query)

  function keyFor(r: AlbumSearchResult): string {
    return `${r.source}:${r.source_id}`
  }

  function choose(r: AlbumSearchResult) {
    setFirstAlbumPick(r)
    router.back()
  }

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.title}>Your first album</Text>
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
          placeholder="Search any album or artist"
          placeholderTextColor={colors.inkMuted}
          autoFocus
          autoCorrect={false}
          returnKeyType="search"
        />
        {searching && <ActivityIndicator size="small" color={colors.inkMuted} />}
        {query.length > 0 && !searching && (
          <Pressable onPress={() => setQuery('')} hitSlop={8}>
            <X size={16} color={colors.inkMuted} />
          </Pressable>
        )}
      </View>

      <FlatList
        data={results}
        keyExtractor={keyFor}
        // Tapping a result must land while the keyboard is still up, and a drag
        // through the list should put it away rather than fight the scroll.
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        contentContainerStyle={styles.list}
        ListHeaderComponent={
          searching && results.length === 0 ? (
            <View style={styles.centerNote}>
              <ActivityIndicator color={colors.green} />
            </View>
          ) : mbPending && results.length > 0 ? (
            <Text style={styles.pending}>Checking more sources…</Text>
          ) : null
        }
        ListEmptyComponent={
          noResults && !searching ? (
            <Text style={styles.centerNote}>
              No results — try another spelling or a different album.
            </Text>
          ) : query.trim().length < 2 ? (
            <Text style={styles.hint}>Start typing to search across every source.</Text>
          ) : null
        }
        renderItem={({ item }) => (
          <Pressable
            style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.inset }]}
            onPress={() => choose(item)}
            accessibilityLabel={`Choose ${item.album_name} by ${item.artist}`}
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
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
  },
  title: { flexShrink: 1, fontFamily: fonts.display, fontSize: 26, color: colors.ink, letterSpacing: 1 },
  cancel: { flexShrink: 0, fontFamily: fonts.bodyMedium, fontSize: 15, color: colors.inkTertiary },
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
