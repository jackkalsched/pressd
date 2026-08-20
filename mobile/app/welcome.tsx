// Welcome — the first-run screen for users with no rated albums, mirroring the
// website's onboarding page (frontend/src/pages/Onboarding.tsx): an animated
// belt of album art over centred copy and a first-album search. Pick an album,
// confirm with Start rating, and go straight into rating; that first rating
// clears the gate in (tabs)/_layout.
import { useEffect, useRef, useState } from 'react'
import {
  AccessibilityInfo,
  Animated,
  Easing,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { Image } from 'expo-image'
import { Play, Search, X } from 'lucide-react-native'
import { useQuery } from '@tanstack/react-query'
import { fetchArtStrip, importAlbum, resolveAlbum } from '../lib/api'
import { useAuth } from '../lib/auth'
import { setFirstAlbumPick, useFirstAlbumPick } from '../lib/firstAlbumPick'
import { skipOnboarding } from '../lib/onboarding'
import TracklistLoader from '../components/TracklistLoader'
import { colors, fonts, radii, spacing, NUM_SCALE_CAP } from '../theme/tokens'

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
  // The search itself lives in the /first-album sheet; this screen only shows
  // what came back from it. Keeping the field out of here is what stops the
  // keyboard covering it — there is no field left to cover.
  const selected = useFirstAlbumPick()
  const [importing, setImporting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const { data: art = [] } = useQuery({ queryKey: ['art-strip'], queryFn: fetchArtStrip })

  const half = Math.ceil(art.length / 2)
  const topArt = art.slice(0, half)
  const bottomArt = art.slice(half)

  function openSearch() {
    setError(null)
    router.push('/first-album')
  }

  function clearPick() {
    setFirstAlbumPick(null)
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

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      <View style={styles.belts}>
        <Belt art={topArt} duration={45000} />
        <Belt art={bottomArt} duration={60000} reverse />
      </View>

      <View style={styles.body}>
        <Text style={styles.eyebrow}>WELCOME TO PRESSD</Text>
        <Text style={styles.title}>Start with an album{'\n'}you know by heart.</Text>
        <Text style={styles.sub}>
          Log your first album for your library! Pressd begins to learn your taste from your
          first record. Search for any album and rate it, track by track.
        </Text>

        {/* Reads as the field it replaces, but opens the sheet instead of a
            keyboard. Once a record is chosen it shows that, so the bar doubles
            as the answer rather than going blank. */}
        <View style={[styles.searchBar, selected && styles.searchBarActive]}>
          <Pressable
            style={styles.searchMain}
            onPress={openSearch}
            accessibilityRole="button"
            accessibilityLabel={
              selected ? `Chosen: ${selected.album_name} by ${selected.artist}. Change album` : 'Search for an album'
            }
          >
            <Search size={17} color={colors.inkMuted} />
            <Text
              style={[styles.searchText, !selected && styles.searchPlaceholder]}
              numberOfLines={1}
            >
              {selected ? `${selected.album_name} — ${selected.artist}` : 'Search any album or artist…'}
            </Text>
          </Pressable>
          {selected && (
            <Pressable onPress={clearPick} hitSlop={8} accessibilityLabel="Clear chosen album">
              <X size={16} color={colors.inkMuted} />
            </Pressable>
          )}
        </View>

        {/* Holds the space the results used to take, so the first-run screen
            keeps its proportions whether or not anything is chosen. */}
        <View style={styles.spacer}>
          {selected && (
            <View style={styles.picked}>
              {selected.cover_url ? (
                <Image source={{ uri: selected.cover_url }} style={styles.pickedCover} contentFit="cover" />
              ) : (
                <View style={[styles.pickedCover, styles.coverFallback]}>
                  <Text style={styles.coverInitial} numberOfLines={1} adjustsFontSizeToFit maxFontSizeMultiplier={NUM_SCALE_CAP}>{selected.album_name[0]?.toUpperCase()}</Text>
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
  // Takes the bar's slack so the whole field is the tap target, not just the
  // words in it.
  searchMain: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  searchText: { flex: 1, fontFamily: fonts.body, fontSize: 15, color: colors.ink },
  searchPlaceholder: { color: colors.inkMuted },

  spacer: { flex: 1, justifyContent: 'flex-start', paddingTop: spacing.md },
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
