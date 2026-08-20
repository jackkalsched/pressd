// The artist's records, rated and not — the mobile counterpart of the desktop
// DiscographyGrid.
//
// Same construction: your rated copies in full colour with their score, the
// rest of the catalog pulled from MusicBrainz and drained to greyscale, merged
// and ordered newest first. The greyed tiles are the point — a discography that
// only showed what you'd already rated couldn't tell you what you'd missed.
import { useMemo, useState } from 'react'
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native'
import { Image } from 'expo-image'
import { useQuery } from '@tanstack/react-query'
import { ChevronDown, ChevronRight } from 'lucide-react-native'
import { fetchAotyAlbums } from '../lib/api'
import { songScoreColor } from '@pressd/shared/types'
import type { ArtistDetail } from '@pressd/shared/api'
import { colors, fonts, radii, spacing, NUM_SCALE_CAP } from '../theme/tokens'

const GAP = 10
// Three across is the target. A narrow screen — or a large Display Zoom, which
// is the more common cause — drops to two rather than shrinking covers to the
// point the score badge stops being readable.
const MIN_TILE = 96
const MAX_COLS = 3
const MIN_COLS = 2

function columnsFor(width: number): number {
  if (!width) return MAX_COLS
  const fits = Math.floor((width + GAP) / (MIN_TILE + GAP))
  return Math.max(MIN_COLS, Math.min(MAX_COLS, fits))
}

type Entry =
  | { kind: 'rated'; key: string; id: number; name: string; year: number | null; art: string | null; score: number | null }
  | { kind: 'unrated'; key: string; name: string; year: number | null; art: string | null }

export default function Discography({
  albums,
  artist,
  onOpenAlbum,
  onPreviewAlbum,
}: {
  albums: ArtistDetail['albums']
  artist: string
  onOpenAlbum: (id: number) => void
  /** A record you don't hold: opens the userbase view by name, the way a new
   *  release or a predicted pick does. */
  onPreviewAlbum: (albumName: string) => void
}) {
  const [width, setWidth] = useState(0)
  const [open, setOpen] = useState(true)
  const cols = columnsFor(width)
  // Exact pixel width, so N tiles and N-1 gaps always fill the row — a
  // percentage leaves a sub-pixel remainder that wraps the last tile.
  const tile = width > 0 ? (width - GAP * (cols - 1)) / cols : 0

  // Cached for an hour like the desktop grid — the catalog behind it is a
  // scrape, and it does not change between two looks at the same page.
  const { data, isLoading } = useQuery({
    queryKey: ['aoty', artist],
    queryFn: () => fetchAotyAlbums(artist),
    retry: false,
    staleTime: 60 * 60_000,
  })

  const { entries, ratedCount, unratedCount } = useMemo(() => {
    const rated: Entry[] = albums
      .filter((a) => a.status === 'rated')
      .map((a) => ({
        kind: 'rated' as const,
        key: `r-${a.id}`,
        id: a.id,
        name: a.album_name,
        year: a.year ?? null,
        art: a.album_art_url ?? null,
        score: a.score,
      }))
    const unrated: Entry[] = (data?.unrated ?? []).map((a) => ({
      kind: 'unrated' as const,
      key: `u-${a.mb_id}`,
      name: a.title,
      year: a.year ?? null,
      art: a.cover_url ?? null,
    }))
    return {
      entries: [...rated, ...unrated].sort((a, b) => (b.year ?? 0) - (a.year ?? 0)),
      ratedCount: rated.length,
      unratedCount: unrated.length,
    }
  }, [albums, data])

  if (entries.length === 0 && !isLoading) return null

  return (
    <View>
      <Pressable
        style={styles.head}
        onPress={() => setOpen((v) => !v)}
        accessibilityRole="button"
        accessibilityLabel={open ? 'Collapse discography' : 'Expand discography'}
      >
        <View style={styles.headLeft}>
          {open ? (
            <ChevronDown size={14} color={colors.inkMuted} />
          ) : (
            <ChevronRight size={14} color={colors.inkMuted} />
          )}
          <Text style={styles.label}>DISCOGRAPHY</Text>
        </View>
        <View style={styles.count}>
          {isLoading && open && <ActivityIndicator size="small" color={colors.inkMuted} />}
          <Text style={styles.countText}>
            {ratedCount} rated · {isLoading ? '…' : unratedCount} unrated
          </Text>
        </View>
      </Pressable>

      {/* Measured even while collapsed, so reopening doesn't reflow from zero. */}
      <View style={styles.grid} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
        {open && tile > 0 &&
        entries.map((e) => {
          const rated = e.kind === 'rated'
          return (
            <Pressable
              key={e.key}
              style={{ width: tile }}
              // A record you hold opens your copy; one you don't opens the
              // userbase view for it, which carries the pooled score and a way
              // to start rating. Neither tile is a dead end.
              onPress={() => (rated ? onOpenAlbum(e.id) : onPreviewAlbum(e.name))}
              accessibilityLabel={
                rated ? `Open ${e.name}` : `Preview ${e.name} — not in your library`
              }
            >
              <View style={styles.art}>
                {e.art ? (
                  <Image
                    source={{ uri: e.art }}
                    style={styles.artImg}
                    contentFit="cover"
                    cachePolicy="memory-disk"
                    recyclingKey={e.art}
                  />
                ) : (
                  <Text
                    style={styles.initial}
                    numberOfLines={1}
                    adjustsFontSizeToFit
                    maxFontSizeMultiplier={NUM_SCALE_CAP}
                  >
                    {e.name[0]?.toUpperCase()}
                  </Text>
                )}
                {/* Greyscale isn't available to expo-image here, so an unrated
                    cover is knocked back with a scrim instead — same read at a
                    glance, no native filter needed. */}
                {!rated && <View style={styles.dim} pointerEvents="none" />}
                {rated && e.score != null && (
                  <View style={[styles.scorePill, { borderColor: songScoreColor(e.score) }]}>
                    <Text
                      style={[styles.scoreText, { color: songScoreColor(e.score) }]}
                      numberOfLines={1}
                      maxFontSizeMultiplier={NUM_SCALE_CAP}
                    >
                      {e.score.toFixed(2)}
                    </Text>
                  </View>
                )}
              </View>
              <Text style={[styles.name, !rated && styles.nameMuted]} numberOfLines={1}>
                {e.name}
              </Text>
              {e.year != null && <Text style={styles.year}>{e.year}</Text>}
            </Pressable>
          )
        })}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.md },
  headLeft: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  label: { fontFamily: fonts.bodyBold, fontSize: 10, letterSpacing: 1.2, color: colors.inkMuted },
  count: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  countText: { fontFamily: fonts.body, fontSize: 10.5, color: colors.inkMuted },

  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: GAP },
  art: {
    width: '100%',
    aspectRatio: 1,
    borderRadius: radii.md,
    backgroundColor: colors.inset,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  artImg: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  initial: { fontFamily: fonts.display, fontSize: 26, color: colors.inkMuted },
  dim: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(249,248,246,0.62)',
  },
  // The same widget the library grid uses — white pill, score-coloured figure
  // and border — so one album reads identically wherever it appears.
  scorePill: {
    position: 'absolute',
    top: 5,
    right: 5,
    backgroundColor: '#ffffff',
    borderRadius: radii.pill,
    borderWidth: 1.5,
    paddingHorizontal: 7,
    paddingVertical: 1,
    shadowColor: '#321e0a',
    shadowOpacity: 0.18,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  scoreText: { fontFamily: fonts.bodyBold, fontSize: 11, letterSpacing: -0.2 },
  name: { fontFamily: fonts.bodyMedium, fontSize: 11.5, color: colors.inkSecondary, marginTop: 5 },
  nameMuted: { color: colors.inkMuted },
  year: { fontFamily: fonts.body, fontSize: 10, color: colors.inkMuted, marginTop: 1 },
})
