// Welcome — the first-run screen for users with no rated albums, mirroring the
// website's onboarding page (frontend/src/pages/Onboarding.tsx): an animated
// belt of album art over centred copy and a first-album search. Pick an album,
// confirm with Start rating, and go straight into rating; that first rating
// clears the gate in (tabs)/_layout.
import { useEffect, useRef, useState } from 'react'
import {
  AccessibilityInfo,
  ActivityIndicator,
  Animated,
  Easing,
  FlatList,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { Image } from 'expo-image'
import { Play, Search, X } from 'lucide-react-native'
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
  const [selected, setSelected] = useState<AlbumSearchResult | null>(null)
  // Picking an album rewrites the query to its title, which re-runs the search;
  // this keeps that second pass from popping the list back open over the CTA.
  const [showResults, setShowResults] = useState(false)
  const [importing, setImporting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const { data: art = [] } = useQuery({ queryKey: ['art-strip'], queryFn: fetchArtStrip })

  const half = Math.ceil(art.length / 2)
  const topArt = art.slice(0, half)
  const bottomArt = art.slice(half)

  function keyFor(r: AlbumSearchResult) {
    return `${r.source}:${r.source_id}`
  }

  function onChangeQuery(text: string) {
    setQuery(text)
    setSelected(null)
    setShowResults(true)
    setError(null)
  }

  function selectResult(r: AlbumSearchResult) {
    setSelected(r)
    setQuery(`${r.album_name} — ${r.artist}`)
    setShowResults(false)
    Keyboard.dismiss()
  }

  function clearQuery() {
    setQuery('')
    setSelected(null)
    setShowResults(false)
    setError(null)
  }

  async function startRating() {
    if (!selected || !user || importing) return
    setImporting(true)
    setError(null)
    try {
      // Search results carry identity only; the tracklist is fetched here, for
      // the one album the user actually picked.
      const full = await resolveAlbum(selected)
      const album = await importAlbum(full, 'listening', user.id)
      router.replace({ pathname: '/rate/[id]', params: { id: String(album.id) } })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong — try again.')
      setImporting(false)
    }
  }

  function explore() {
    skipOnboarding()
    router.replace('/(tabs)')
  }

  if (importing && selected) {
    return (
      <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
        <TracklistLoader
          albumName={selected.album_name}
          artist={selected.artist}
          coverUrl={selected.cover_url}
        />
      </SafeAreaView>
    )
  }

  const listVisible = showResults && (results.length > 0 || searching || noResults)

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      <View style={styles.belts}>
        <Belt art={topArt} duration={45000} />
        <Belt art={bottomArt} duration={60000} reverse />
      </View>

      <KeyboardAvoidingView
        style={styles.body}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <Text style={styles.eyebrow}>WELCOME TO PRESSD</Text>
        <Text style={styles.title}>Start with an album{'\n'}you know by heart.</Text>
        <Text style={styles.sub}>
          Log your first album for your library! Pressd begins to learn your taste from your
          first record. Search for any album and rate it, track by track.
        </Text>

        <View style={[styles.searchBar, selected && styles.searchBarActive]}>
          <Search size={17} color={colors.inkMuted} />
          <TextInput
            style={styles.input}
            value={query}
            onChangeText={onChangeQuery}
            onFocus={() => results.length > 0 && setShowResults(true)}
            placeholder="Search any album or artist…"
            placeholderTextColor={colors.inkMuted}
            autoCorrect={false}
            returnKeyType="search"
          />
          {searching && <ActivityIndicator size="small" color={colors.inkMuted} />}
          {query.length > 0 && !searching && (
            <Pressable onPress={clearQuery} hitSlop={8}>
              <X size={16} color={colors.inkMuted} />
            </Pressable>
          )}
        </View>

        {/* Results take the space between the search bar and the CTA, so the
            first-run screen reads exactly like the design until you type. */}
        {listVisible ? (
          <FlatList
            data={results}
            keyExtractor={keyFor}
            keyboardShouldPersistTaps="handled"
            style={styles.results}
            ListHeaderComponent={
              mbPending && results.length > 0 ? (
                <Text style={styles.pending}>Checking more sources…</Text>
              ) : null
            }
            ListEmptyComponent={
              noResults && !searching ? (
                <Text style={styles.hint}>No results — try another spelling or a different album.</Text>
              ) : null
            }
            renderItem={({ item }) => (
              <Pressable
                style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.inset }]}
                onPress={() => selectResult(item)}
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
              </Pressable>
            )}
          />
        ) : (
          <View style={styles.spacer}>
            {selected && (
              <View style={styles.picked}>
                {selected.cover_url ? (
                  <Image source={{ uri: selected.cover_url }} style={styles.pickedCover} contentFit="cover" />
                ) : (
                  <View style={[styles.pickedCover, styles.coverFallback]}>
                    <Text style={styles.coverInitial}>{selected.album_name[0]?.toUpperCase()}</Text>
                  </View>
                )}
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={styles.albumName} numberOfLines={1}>{selected.album_name}</Text>
                  <Text style={styles.meta} numberOfLines={1}>
                    {selected.artist}
                    {selected.year ? ` · ${selected.year}` : ''}
                    {selected.total_tracks ? ` · ${selected.total_tracks} tracks` : ''}
                  </Text>
                </View>
              </View>
            )}
          </View>
        )}

        {error && <Text style={styles.error}>{error}</Text>}

        <Pressable
          onPress={startRating}
          disabled={!selected}
          style={({ pressed }) => [
            styles.cta,
            !selected && styles.ctaDisabled,
            pressed && selected && { backgroundColor: colors.greenPressed },
          ]}
        >
          <Play size={13} color="#fff" fill="#fff" strokeWidth={0} />
          <Text style={styles.ctaText}>Start rating</Text>
        </Pressable>

        <Pressable onPress={explore} style={styles.explore} hitSlop={8}>
          <Text style={styles.exploreText}>I&rsquo;ll explore first →</Text>
        </Pressable>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  belts: { gap: GAP, paddingTop: spacing.md },
  beltClip: { height: TILE, overflow: 'hidden' },
  belt: { flexDirection: 'row', gap: GAP },
  tile: { width: TILE, height: TILE, borderRadius: radii.md },

  body: { flex: 1, paddingHorizontal: spacing.xl, marginTop: spacing.xl },
  eyebrow: {
    fontFamily: fonts.bodyBold,
    fontSize: 11,
    color: colors.green,
    letterSpacing: 1.9,
    textAlign: 'center',
  },
  // Plus Jakarta Bold, matching the website's .font-display headings.
  title: {
    fontFamily: fonts.bodyBold,
    fontSize: 31,
    lineHeight: 37,
    letterSpacing: -0.6,
    color: colors.ink,
    textAlign: 'center',
    marginTop: spacing.sm,
  },
  sub: {
    fontFamily: fonts.body,
    fontSize: 14.5,
    lineHeight: 22,
    color: colors.inkTertiary,
    textAlign: 'center',
    marginTop: spacing.md,
  },

  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.xl,
    paddingHorizontal: spacing.md,
    height: 50,
    backgroundColor: colors.raised,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  searchBarActive: { borderColor: colors.green },
  input: { flex: 1, fontFamily: fonts.body, fontSize: 15, color: colors.ink },

  results: { flex: 1, marginTop: spacing.md },
  spacer: { flex: 1, justifyContent: 'flex-start', paddingTop: spacing.md },
  pending: { fontFamily: fonts.body, fontSize: 12, color: colors.inkMuted, textAlign: 'center', marginBottom: spacing.sm },
  hint: { fontFamily: fonts.body, fontSize: 13, color: colors.inkMuted, textAlign: 'center', marginTop: spacing.lg },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.sm, borderRadius: radii.md, paddingHorizontal: spacing.sm },
  cover: { width: 52, height: 52, borderRadius: radii.sm },
  coverFallback: { backgroundColor: colors.inset, alignItems: 'center', justifyContent: 'center' },
  coverInitial: { fontFamily: fonts.display, fontSize: 22, color: colors.inkMuted },
  albumName: { fontFamily: fonts.bodySemiBold, fontSize: 15, color: colors.ink },
  meta: { fontFamily: fonts.body, fontSize: 13, color: colors.inkTertiary, marginTop: 2 },

  picked: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.raised,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: 'rgba(45, 106, 79, 0.25)',
    padding: spacing.md,
  },
  pickedCover: { width: 48, height: 48, borderRadius: radii.sm },

  error: { fontFamily: fonts.body, fontSize: 12.5, color: '#c0392b', textAlign: 'center', marginBottom: spacing.sm },

  cta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    height: 52,
    borderRadius: radii.md,
    backgroundColor: colors.green,
  },
  ctaDisabled: { opacity: 0.4 },
  ctaText: { fontFamily: fonts.bodySemiBold, fontSize: 15.5, color: '#fff' },

  explore: { alignItems: 'center', paddingVertical: spacing.lg },
  exploreText: { fontFamily: fonts.bodyMedium, fontSize: 13.5, color: colors.inkMuted },
})
