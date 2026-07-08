export type AlbumStatus = 'to_listen' | 'listening' | 'rated'

export interface Song {
  id: number
  title: string
  trackNumber: number
  score: number | null
  aScore: number | null
  durationMs: number | null
  spotifyPopularity: number | null
  explicit: boolean
  spotifyId: string | null
  albumId: number
  artist: string
  bpm: number | null
  musicalKey: string | null
  loudnessDb: number | null
}

export interface Album {
  id: number
  albumName: string
  artist: string
  year: number
  status: AlbumStatus
  score: number | null
  theme: number | null
  replayValue: number | null
  production: number | null
  distinctness: number | null
  genre: string | null
  subGenre1: string | null
  subGenre2: string | null
  extraArtists: string[]
  albumArtUrl: string | null
  totalTracks: number | null
  spotifyId: string | null
  dateAdded: string
  dateRated: string | null
  songs: Song[]
  predictedTheme: number | null
  predictedThemeReasoning: string | null
  predictedScore: number | null
  recommendedBy: number | null
  recommendedByName: string | null
  review: string | null
  reviewAt: string | null
}

export interface ArtistStats {
  artist: string
  count: number
  avgSongScore: number
  wavgSongScore: number
  aCi: number
  sar: number
  sarPs: number
  skipPct: number
  bangPct: number
  songPlus: number
  wSongPlus: number
}

export const BANG_THRESHOLD = 8.0
export const SKIP_THRESHOLD = 6.5

// Short releases (≤6 tracks) skip the factor ratings and score as the song
// mean; they show everywhere with a tag so they read differently from LPs
export const EP_MAX_TRACKS = 6

export function shortReleaseLabel(album: Album): 'EP' | 'Single' | null {
  const n = album.songs.length
  if (n === 0 || n > EP_MAX_TRACKS) return null
  return n <= 2 ? 'Single' : 'EP'
}

// Maps a 1–10 song score to a gradient color (dark red → dark forest green)
export function songScoreColor(score: number): string {
  const hue = Math.round(((score - 1) / 9) * 130)
  return `hsl(${hue}, 65%, 32%)`
}

export function computeAScore(score: number): number {
  return (15 * score - 14) / 13
}

export interface FactorStats {
  theme:        [number, number]
  replay_value: [number, number]
  production:   [number, number]
  distinctness: [number, number]
}

// Per-user external-factor weighting, stored as a fixed 60-point budget
// (each factor ≥ 5). The scoring weight applied to a factor is points / 100.
export interface FactorPoints {
  theme:        number
  replay_value: number
  production:   number
  distinctness: number
}

export const DEFAULT_FACTOR_POINTS: FactorPoints = { theme: 25, replay_value: 15, production: 15, distinctness: 5 }
export const TOTAL_FACTOR_POINTS = 60
export const MIN_FACTOR_POINTS = 5

// Display order + labels for the four factors (mirrors the rating screen)
export const FACTOR_META: { key: keyof FactorPoints; label: string; desc: string }[] = [
  { key: 'theme',        label: 'Theme / Cohesion', desc: 'Strength and cohesion of the central idea' },
  { key: 'replay_value', label: 'Replay Value',     desc: 'How replayable the album is' },
  { key: 'production',   label: 'Production',        desc: 'Sound quality, mixing, sonic palette' },
  { key: 'distinctness', label: 'Distinctness',      desc: 'Originality and genre-bending' },
]

export function computeAlbumScore(
  songs: Song[],
  theme: number,
  replayValue: number,
  production: number,
  distinctness: number,
  factorStats: FactorStats,
  points: FactorPoints = DEFAULT_FACTOR_POINTS,
): number {
  const rated = songs.filter((s) => s.score !== null && s.score !== undefined)
  if (rated.length === 0) return 0
  const avgSong = rated.reduce((sum, s) => sum + s.score!, 0) / rated.length

  const z = (val: number, key: keyof FactorStats) => {
    const [mu, sd] = factorStats[key]
    return (val - mu) / sd
  }

  return (
    1.00 * avgSong +
    (points.theme        / 100) * z(theme,        'theme') +
    (points.replay_value / 100) * z(replayValue,  'replay_value') +
    (points.production   / 100) * z(production,   'production') +
    (points.distinctness / 100) * z(distinctness, 'distinctness')
  )
}
