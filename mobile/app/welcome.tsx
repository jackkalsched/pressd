// Welcome — the first-run screen for users with no rated albums: an animated
// belt of album art over a first-album search. Pick one, import it, and go
// straight into rating; that first rating clears the gate in (tabs)/_layout.
import { useEffect, useRef, useState } from 'react'
import {
  AccessibilityInfo,
  ActivityIndicator,
  Animated,
  Easing,
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
import { useQuery } from '@tanstack/react-query'
import { useAlbumSearch } from '@pressd/shared/hooks/useAlbumSearch'
import type { AlbumSearchResult } from '@pressd/shared/api'
import { fetchArtStrip, importAlbum, resolveAlbum } from '../lib/api'
import { useAuth } from '../lib/auth'
import { skipOnboarding } from '../lib/onboarding'
import TracklistLoader from '../components/TracklistLoader'
import { colors, fonts, radii, spacing } from '../theme/tokens'

const TILE = 84
const GAP = 10

function Belt({ art, duration, reverse }: { art: string[]; duration: number; reverse?: boolean }) {
  const x = useRef(new Animated.Value(0)).current
  const [reduceMotion, setReduceMotion] = useState(false)
  const loopWidth = art.length * (TILE + GAP)

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion)
  }, [])

  useEffect(() => {
    if (reduceMotion || loopWidth === 0) return
    const from = reverse ? -loopWidth : 0
    const to = reverse ? 0 : -loopWidth
    x.setValue(from)
    const anim = Animated.loop(
      Animated.timing(x, { toValue: to, duration, easing: Easing.linear, useNativeDriver: true }),
    )
    anim.start()
    return () => anim.stop()
  }, [reduceMotion, loopWidth, duration, reverse, x])

  if (art.length === 0) return <View style={{ height: TILE }} />

  // Duplicate the strip so the translation wraps seamlessly.
  const doubled = [...art, ...art]
  return (
    <View style={styles.beltClip}>
      <Animated.View style={[styles.belt, { transform: [{ translateX: x }] }]}>
        {doubled.map((uri, i) => (
          <Image key={i} source={{ uri }} style={styles.tile} contentFit="cover" />
        ))}
      </Animated.View>
    </View>
  )
}

export default function Welcome() {
  const router = useRouter()
  const { user } = useAuth()
  const [query, setQuery] = useState('')
  const { results, searching, mbPending, noResults } = useAlbumSearch(query)
  const [picked, setPicked] = useState<AlbumSearchResult | null>(null)

  const { data: art = [] } = useQuery({ queryKey: ['art-strip'], queryFn: fetchArtStrip })

  const half = Math.ceil(art.length / 2)
  const topArt = art.slice(0, half)
  const bottomArt = art.slice(half)

  function keyFor(r: AlbumSearchResult) {
    return `${r.source}:${r.source_id}`
  }

  async function pick(r: AlbumSearchResult) {
    if (picked || !user) return
    setPicked(r)
    try {
      const full = await resolveAlbum(r)
      const album = await importAlbum(full, 'listening', user.id)
      router.replace({ pathname: '/rate/[id]', params: { id: String(album.id) } })
    } catch {
      setPicked(null)
    }
  }

  function explore() {
    skipOnboarding()
    router.replace('/(tabs)')
  }

  if (picked) {
    return (
      <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
        <TracklistLoader
          albumName={picked.album_name}
          artist={picked.artist}
          coverUrl={picked.cover_url}
        />
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      <View style={styles.belts}>
        <Belt art={topArt} duration={45000} />
        <Belt art={bottomArt} duration={60000} reverse />
        <View style={styles.beltFade} pointerEvents="none" />
      </View>

      <View style={styles.body}>
        <Text style={styles.title}>Welcome to Press'd</Text>
        <Text style={styles.sub}>Rate your first album to start building your taste.</Text>

        <View style={styles.searchBar}>
          <Search size={18} color={colors.inkMuted} />
          <TextInput
            style={styles.input}
            value={query}
            onChangeText={setQuery}
            placeholder="Search for an album"
            placeholderTextColor={colors.inkMuted}
            autoCorrect={false}
            returnKeyType="search"
          />
          {query.length > 0 && (
            <Pressable onPress={() => setQuery('')} hitSlop={8}>
              <X size={16} color={colors.inkMuted} />
            </Pressable>
          )}
        </View>

        <FlatList
          data={results}
          keyExtractor={keyFor}
          keyboardShouldPersistTaps="handled"
          style={styles.results}
          ListHeaderComponent={
            searching && results.length === 0 ? (
              <ActivityIndicator color={colors.green} style={{ marginTop: spacing.lg }} />
            ) : mbPending && results.length > 0 ? (
              <Text style={styles.pending}>Checking more sources…</Text>
            ) : null
          }
          ListEmptyComponent={
            noResults && !searching ? <Text style={styles.hint}>No albums found.</Text> : null
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
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.albumName} numberOfLines={1}>{item.album_name}</Text>
                <Text style={styles.meta} numberOfLines={1}>
                  {item.artist}
                  {item.year ? ` · ${item.year}` : item.total_tracks ? ` · ${item.total_tracks} tracks` : ''}
                </Text>
              </View>
              <View style={styles.addBtn}>
                <Plus size={18} color={colors.green} strokeWidth={2.5} />
              </View>
            </Pressable>
          )}
        />

        <Pressable onPress={explore} style={styles.explore}>
          <Text style={styles.exploreText}>I'll explore first →</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  belts: { gap: GAP, paddingTop: spacing.md },
  beltClip: { height: TILE, overflow: 'hidden' },
  belt: { flexDirection: 'row', gap: GAP },
  tile: { width: TILE, height: TILE, borderRadius: radii.md },
  beltFade: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 24 },

  body: { flex: 1, paddingHorizontal: spacing.lg, marginTop: spacing.xl },
  title: { fontFamily: fonts.display, fontSize: 32, color: colors.ink, letterSpacing: 0.5 },
  sub: { fontFamily: fonts.bodyMedium, fontSize: 15, color: colors.inkTertiary, marginTop: 6 },

  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.lg,
    paddingHorizontal: spacing.md,
    height: 48,
    backgroundColor: colors.raised,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  input: { flex: 1, fontFamily: fonts.body, fontSize: 15, color: colors.ink },
  results: { flex: 1, marginTop: spacing.md },
  pending: { fontFamily: fonts.body, fontSize: 12, color: colors.inkMuted, textAlign: 'center', marginBottom: spacing.sm },
  hint: { fontFamily: fonts.body, fontSize: 14, color: colors.inkMuted, textAlign: 'center', marginTop: spacing.lg },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.sm, borderRadius: radii.md, paddingHorizontal: spacing.sm },
  cover: { width: 52, height: 52, borderRadius: radii.sm },
  coverFallback: { backgroundColor: colors.inset, alignItems: 'center', justifyContent: 'center' },
  coverInitial: { fontFamily: fonts.display, fontSize: 22, color: colors.inkMuted },
  albumName: { fontFamily: fonts.bodySemiBold, fontSize: 15, color: colors.ink },
  meta: { fontFamily: fonts.body, fontSize: 13, color: colors.inkTertiary, marginTop: 2 },
  addBtn: { width: 34, height: 34, borderRadius: radii.sm, backgroundColor: colors.greenSoft, alignItems: 'center', justifyContent: 'center' },

  explore: { alignItems: 'center', paddingVertical: spacing.lg },
  exploreText: { fontFamily: fonts.bodyMedium, fontSize: 15, color: colors.inkTertiary },
})
