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

export function computeAlbumScore(
  songs: Song[],
  theme: number,
  replayValue: number,
  production: number,
  distinctness: number,
  factorStats: FactorStats,
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
    0.25 * z(theme,        'theme') +
    0.15 * z(replayValue,  'replay_value') +
    0.15 * z(production,   'production') +
    0.05 * z(distinctness, 'distinctness')
  )
}
