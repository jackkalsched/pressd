// "See more artist comparisons" — the neighbours of whoever you're looking at,
// each carrying the one track you and Press'd disagree about most.
//
// Square cells in a scrolling row: the artist's photo, their name, and the
// split underneath. The note is the point — a grid of faces is a list of links,
// but a grid of faces each saying "you rate Paranoia 3.4 higher than Press'd"
// is a reason to tap one.
import { StyleSheet, Text, View, Pressable, ScrollView } from 'react-native'
import { Image } from 'expo-image'
import type { SimilarArtistComparison } from '@pressd/shared/api'
import { colors, fonts, radii, spacing, NUM_SCALE_CAP } from '../theme/tokens'

const UP = '#2d6a4f'
const DOWN = '#b5432f'
const CELL = 132

export default function SimilarArtistComparisons({
  rows,
  onOpen,
}: {
  rows: SimilarArtistComparison[]
  onOpen: (artist: string) => void
}) {
  if (rows.length === 0) return null

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      // Bled to the screen edge so the row reads as scrollable rather than as a
      // short list that happens to end.
      contentContainerStyle={styles.strip}
    >
      {rows.map((r) => {
        const higher = r.top_gap.diff >= 0
        return (
          <Pressable
            key={r.artist}
            style={styles.cell}
            onPress={() => onOpen(r.artist)}
            accessibilityRole="button"
            accessibilityLabel={`Compare ${r.artist}`}
          >
            <View style={styles.art}>
              {/* The initial sits underneath, so an artist Deezer has no photo
                  for still reads as a filled cell rather than a hole. */}
              <Text style={styles.initial}>{r.artist[0]?.toUpperCase()}</Text>
              {r.image_url ? (
                <Image
                  source={{ uri: r.image_url }}
                  style={styles.artImg}
                  contentFit="cover"
                  cachePolicy="memory-disk"
                  recyclingKey={r.image_url}
                  transition={140}
                />
              ) : null}
            </View>
            <Text style={styles.name} numberOfLines={1}>{r.artist}</Text>
            {/* Prose inside a fixed square tile, so the line budget is the
                constraint rather than the width — capped to keep the sentence
                inside three lines at a large setting. */}
            <Text style={styles.note} numberOfLines={3} maxFontSizeMultiplier={NUM_SCALE_CAP}>
              You rate <Text style={styles.noteSong}>{r.top_gap.title}</Text>{' '}
              <Text style={[styles.noteDiff, { color: higher ? UP : DOWN }]}>
                {Math.abs(r.top_gap.diff).toFixed(1)} {higher ? 'higher' : 'lower'}
              </Text>{' '}
              than Press&apos;d
            </Text>
          </Pressable>
        )
      })}
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  strip: { gap: spacing.md, paddingRight: spacing.lg, paddingBottom: spacing.xs },
  cell: { width: CELL },
  art: {
    width: CELL,
    height: CELL,
    borderRadius: radii.md,
    backgroundColor: colors.inset,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  artImg: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  initial: { fontFamily: fonts.display, fontSize: 44, color: colors.inkMuted },
  name: { fontFamily: fonts.bodySemiBold, fontSize: 13.5, color: colors.ink, marginTop: 7 },
  note: { fontFamily: fonts.body, fontSize: 11, lineHeight: 15.5, color: colors.inkTertiary, marginTop: 2 },
  noteSong: { fontFamily: fonts.bodyMedium, color: colors.inkSecondary },
  noteDiff: { fontFamily: fonts.bodyBold },
})
