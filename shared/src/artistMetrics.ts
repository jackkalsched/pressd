// What each artist-page metric means, for the notecard behind the ⓘ beside
// PERCENTILE RANKINGS — one copy for both platforms. Each line restates a
// formula in backend/routers/stats.py (`_artist_payload`) and the thresholds in
// backend/scoring.py; change them together.
import { BANG_THRESHOLD, SKIP_THRESHOLD } from './types'

export interface ArtistMetric {
  name: string
  meaning: string
}

export const ARTIST_METRICS: ArtistMetric[] = [
  { name: 'Avg Song', meaning: 'The average score of every song by this artist.' },
  {
    name: 'Song+',
    meaning: 'Average song score scaled to 100 against every other artist. Every 10 point increase or decrease from 100 represents a standard deviation above or below the average song score.',
  },
  {
    name: 'wSong+',
    meaning: 'Song+ but with the album factors taken into consideration too. 100 is the average. The most representative metric for how good an artist is.',
  },
  {
    name: 'Avg External',
    meaning: 'The weighted average of the albums’ four external factors (theme, replay value, production, distinctness).',
  },
  { name: 'Bang%', meaning: `The share of songs scored ${BANG_THRESHOLD.toFixed(1)} or higher.` },
  { name: 'Skip%', meaning: `The share of songs scored below ${SKIP_THRESHOLD.toFixed(1)}.` },
  {
    name: 'Consistency+',
    meaning: 'How evenly the songs score, from their spread: 100 is average, higher is steadier.',
  },
]

/** The line under the list: what the bars measure against. */
export const ARTIST_METRICS_FOOT =
  'The bars place this artist among every other artist in the same view — your library, or all of Pressd.'
