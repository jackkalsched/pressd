// The two row shapes the Ratings leaderboard renders — an album and an artist.
//
// Shared so a friend's page and your own render the same board rather than
// diverging, which they already had: yours sorts by any metric in either
// direction, theirs was a fixed score-descending list of albums with no artist
// mode at all.
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { Image } from 'expo-image'
import { songScoreColor, type Album } from '@pressd/shared/types'
import { NUM_SCALE_CAP, RANK_NUM_MIN_W, RANK_NUM_SIZE, type ArtistRank } from '../lib/rankings'
import { colors, fonts, radii, spacing } from '../theme/tokens'

export function RatingRow({
  album,
  rank,
  onPress,
}: {
  album: Album
  rank: number
  onPress: () => void
}) {
  return (
    <Pressable style={styles.ratingRow} onPress={onPress}>
      <Text style={styles.rankNum} numberOfLines={1} maxFontSizeMultiplier={NUM_SCALE_CAP}>
        {rank}
      </Text>
      {album.albumArtUrl ? (
        <Image source={{ uri: album.albumArtUrl }} style={styles.ratingArt} contentFit="cover" />
      ) : (
        <View style={[styles.ratingArt, styles.artFallback]}>
          <Text style={styles.artInitial}>{album.albumName[0]?.toUpperCase()}</Text>
        </View>
      )}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={styles.ratingName} numberOfLines={1}>{album.albumName}</Text>
        <Text style={styles.ratingArtist} numberOfLines={1}>
          {album.artist}{album.year ? ` · ${album.year}` : ''}
        </Text>
      </View>
      {album.score != null && (
        <Text style={[styles.ratingScore, { color: songScoreColor(album.score) }]}>
          {album.score.toFixed(2)}
        </Text>
      )}
    </Pressable>
  )
}

/** The trailing figure follows whichever metric the board is sorted by, so the
 *  number you ranked on is the number you can read. */
function artistValue(stat: ArtistRank, metricKey: string): { text: string; color?: string } {
  const plus = (v: number | null) => (v == null ? '—' : String(Math.round(v)))
  const pct = (v: number | null) => (v == null ? '—' : `${Math.round(v)}%`)
  switch (metricKey) {
    case 'songPlus':
      return { text: plus(stat.songPlus) }
    case 'wSongPlus':
      return { text: plus(stat.wSongPlus) }
    case 'consPlus':
      return { text: plus(stat.consistencyPlus) }
    case 'bang':
      return { text: pct(stat.bangPct) }
    case 'skip':
      return { text: pct(stat.skipPct) }
    default:
      return { text: stat.avgSongScore.toFixed(2), color: songScoreColor(stat.avgSongScore) }
  }
}

export function ArtistRankRow({
  stat,
  rank,
  metricKey,
  onPress,
}: {
  stat: ArtistRank
  rank: number
  metricKey: string
  onPress: () => void
}) {
  const value = artistValue(stat, metricKey)
  return (
    <Pressable style={styles.ratingRow} onPress={onPress}>
      <Text style={styles.rankNum} numberOfLines={1} maxFontSizeMultiplier={NUM_SCALE_CAP}>
        {rank}
      </Text>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={styles.ratingName} numberOfLines={1}>{stat.artist}</Text>
        <Text style={styles.ratingArtist} numberOfLines={1}>
          {stat.songs} songs · avg {stat.avgSongScore.toFixed(2)}
        </Text>
      </View>
      <Text style={[styles.ratingScore, value.color ? { color: value.color } : { color: colors.ink }]}>
        {value.text}
      </Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  ratingRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.sm },
  // minWidth, not width: a library past 99 albums needs three digits.
  rankNum: {
    fontFamily: fonts.display,
    fontSize: RANK_NUM_SIZE,
    color: colors.inkMuted,
    minWidth: RANK_NUM_MIN_W,
    textAlign: 'center',
  },
  ratingArt: { width: 48, height: 48, borderRadius: radii.sm },
  artFallback: { backgroundColor: colors.inset, alignItems: 'center', justifyContent: 'center' },
  artInitial: { fontFamily: fonts.display, fontSize: 28, color: colors.inkMuted },
  ratingName: { fontFamily: fonts.bodySemiBold, fontSize: 15, color: colors.ink },
  ratingArtist: { fontFamily: fonts.body, fontSize: 13, color: colors.inkTertiary, marginTop: 1 },
  ratingScore: { fontFamily: fonts.bodyBold, fontSize: 17 },
})
