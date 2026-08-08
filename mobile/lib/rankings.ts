// The sortable album/artist leaderboards behind the Ratings tab.
//
// Lifted out of Profile so a friend's page can offer the same board rather than
// the fixed score-descending list it had. The metric definitions are the part
// that must not drift: two screens ranking the same library by "Song+" have to
// mean the same thing by it.
import type { Album } from '@pressd/shared/types'

export const QUALIFIED = 15 // artists need ≥15 rated songs to rank

// The rank column holds a position in a library that grows without bound, so it
// is sized from what it has to show rather than pinned. Same shape as the chart
// board: cap how far the numeral scales, then give it a floor wide enough for
// three digits at that ceiling, and let it grow past it if a library ever runs
// to four.
export const NUM_SCALE_CAP = 1.3
export const RANK_NUM_SIZE = 15
// Playfair sets digits at roughly 0.55em.
export const RANK_NUM_MIN_W = Math.ceil(RANK_NUM_SIZE * NUM_SCALE_CAP * 0.55 * 3)

export type RankMode = 'albums' | 'artists'
export type RankDir = 'asc' | 'desc'

export interface Metric<T> {
  key: string
  label: string
  get: (x: T) => number | string | null
}

export const ALBUM_METRICS: Metric<Album>[] = [
  { key: 'score', label: 'Score', get: (a) => a.score },
  { key: 'year', label: 'Year', get: (a) => a.year },
  { key: 'dateRated', label: 'Date Rated', get: (a) => a.dateRated },
  { key: 'name', label: 'Name', get: (a) => a.albumName.toLowerCase() },
]

/** One artist row for the Rankings leaderboard: the +-metrics come from the
 *  scatter endpoint (league-indexed), bang/skip from the artist-stats one. */
export interface ArtistRank {
  artist: string
  songs: number
  avgSongScore: number
  songPlus: number | null
  wSongPlus: number | null
  consistencyPlus: number | null
  bangPct: number | null
  skipPct: number | null
}

export const ARTIST_METRICS: Metric<ArtistRank>[] = [
  { key: 'songPlus', label: 'Song+', get: (s) => s.songPlus },
  { key: 'wSongPlus', label: 'wSong+', get: (s) => s.wSongPlus },
  { key: 'consPlus', label: 'Cons+', get: (s) => s.consistencyPlus },
  { key: 'bang', label: 'Bang %', get: (s) => s.bangPct },
  { key: 'skip', label: 'Skip %', get: (s) => s.skipPct },
  { key: 'avg', label: 'Avg Song', get: (s) => s.avgSongScore },
]

/** null-safe comparator: nulls sink to the end regardless of direction */
export function cmpVals(a: number | string | null, b: number | string | null, dir: RankDir): number {
  if (a == null && b == null) return 0
  if (a == null) return 1
  if (b == null) return -1
  const c =
    typeof a === 'string' || typeof b === 'string'
      ? String(a).localeCompare(String(b))
      : (a as number) - (b as number)
  return dir === 'desc' ? -c : c
}

/** The metric list for a mode, and the one currently chosen within it. */
export function metricsFor(mode: RankMode): Metric<Album>[] | Metric<ArtistRank>[] {
  return mode === 'albums' ? ALBUM_METRICS : ARTIST_METRICS
}

/** Switching mode has to move the metric too — "Song+" means nothing to an
 *  album list. Falls back to the first metric of the mode being entered. */
export function defaultMetricFor(mode: RankMode): string {
  return mode === 'albums' ? ALBUM_METRICS[0].key : ARTIST_METRICS[0].key
}
