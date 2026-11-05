// The row shapes a ranked list of a library renders — an album, an artist and
// a song.
//
// Shared so a friend's page and your own render the same board rather than
// diverging, which they already had: yours sorts by any metric in either
// direction, theirs was a fixed score-descending list of albums with no artist
// mode at all. The favourite-pickers list through the same three.
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { songScoreColor, type Album } from '@pressd/shared/types'
import type { RankedSong } from '@pressd/shared/api'
import { NUM_SCALE_CAP, RANK_NUM_MIN_W, RANK_NUM_SIZE, type ArtistRank } from '../lib/rankings'
import { colors, fonts, radii, spacing } from '../theme/tokens'
import CoverImage from './CoverImage'

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
        <CoverImage url={album.albumArtUrl} displayPx={48} style={styles.ratingArt} />
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

/** A metric placed on the score gradient: t 0 is the red end, 1 the green. */
function gradient(t: number): string {
  return songScoreColor(1 + 9 * Math.min(1, Math.max(0, t)))
}

// Where each metric's ends of the gradient sit. The plus stats are indexed to
// 100, the library's average artist, so 100 lands mid-way; bang is good high and
// skip good low, each over the range real libraries cover.
const PLUS_RED = 60
const PLUS_GREEN = 140
const BANG_GREEN = 0.5
const SKIP_RED = 0.3

/** The trailing figure follows whichever metric the board is sorted by, so the
 *  number you ranked on is the number you can read — in that metric's colour. */
function artistValue(stat: ArtistRank, metricKey: string): { text: string; color?: string } {
  const plus = (v: number | null) =>
    v == null ? { text: '—' } : { text: String(Math.round(v)), color: gradient((v - PLUS_RED) / (PLUS_GREEN - PLUS_RED)) }
  // /stats/artists reports bang/skip as a fraction, not a percentage — without
  // the scale every row on a friend's board rounded to "0%".
  const pct = (v: number | null, t: (v: number) => number) =>
    v == null ? { text: '—' } : { text: `${Math.round(v * 100)}%`, color: gradient(t(v)) }
  switch (metricKey) {
    case 'songPlus':
      return plus(stat.songPlus)
    case 'wSongPlus':
      return plus(stat.wSongPlus)
    case 'consPlus':
      return plus(stat.consistencyPlus)
    case 'bang':
      return pct(stat.bangPct, (v) => v / BANG_GREEN)
    case 'skip':
      return pct(stat.skipPct, (v) => 1 - v / SKIP_RED)
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
          {stat.songs} songs
        </Text>
      </View>
      <Text style={[styles.ratingScore, value.color ? { color: value.color } : { color: colors.ink }]}>
        {value.text}
      </Text>
    </Pressable>
  )
}

/** A scored track, carrying its album's art. The second line names the album
 *  rather than the artist alone — two tracks called "Intro" are told apart by
 *  the record they're on, not by who made them. */
export function SongRankRow({
  song,
  rank,
  onPress,
}: {
  song: RankedSong
  rank: number
  onPress: () => void
}) {
  return (
    <Pressable style={styles.ratingRow} onPress={onPress}>
      <Text style={styles.rankNum} numberOfLines={1} maxFontSizeMultiplier={NUM_SCALE_CAP}>
        {rank}
      </Text>
      {song.album_art_url ? (
        <CoverImage url={song.album_art_url} displayPx={48} style={styles.ratingArt} />
      ) : (
        <View style={[styles.ratingArt, styles.artFallback]}>
          <Text style={styles.artInitial}>{song.title[0]?.toUpperCase()}</Text>
        </View>
      )}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={styles.ratingName} numberOfLines={1}>{song.title}</Text>
        <Text style={styles.ratingArtist} numberOfLines={1}>
          {song.artist} · {song.album_name}
        </Text>
      </View>
      {song.score != null && (
        <Text style={[styles.ratingScore, { color: songScoreColor(song.score) }]}>
          {song.score.toFixed(1)}
        </Text>
      )}
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
