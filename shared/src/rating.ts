// The first-pass rules of the rating flow, shared by web's RatingScreen and
// mobile's rate/[id] so the two can never disagree about which track is
// reachable or where Next goes.
//
// Songs unlock one at a time in track order on the first pass — that
// constraint is the product. A carried score (Song.carriedScore, a score the
// user already gave the same recording on another of their records) is
// prefilled so they aren't asked twice, but it must not become a way round the
// constraint: a carried track further down the record stays locked until the
// listener has reached it.

import type { Song } from './types'

/** Draft text per track, in track order, plus the indices whose draft is a
 *  carried score the listener hasn't touched yet. A song's own score wins over
 *  a carried one; the server only sends one for unscored songs anyway. */
export function seedDrafts(sortedSongs: Song[]): { drafts: string[]; carried: Set<number> } {
  const carried = new Set<number>()
  const drafts = sortedSongs.map((s, i) => {
    if (s.score != null) return String(s.score)
    if (s.carriedScore != null) {
      carried.add(i)
      return String(s.carriedScore)
    }
    return ''
  })
  return { drafts, carried }
}

/** The first track that still needs the listener: no draft and not skipped.
 *  -1 when every track is accounted for. */
export function firstOpenIndex(drafts: string[], skipped: Set<number>): number {
  return drafts.findIndex((t, i) => !t.trim() && !skipped.has(i))
}

/** Whether the listener may jump to track `i`. The track they're standing on,
 *  and anything they scored or skipped themselves, is always reachable. A
 *  carried track is reachable only once the listener has passed it — when it
 *  sits before the first open track — so a carried song in the middle of the
 *  record never opens the way to the tracks around it. */
export function canJumpTo(
  i: number,
  state: {
    scores: (number | null)[]
    skipped: Set<number>
    carried: Set<number>
    current: number
    firstOpen: number
  },
): boolean {
  if (i === state.current) return true
  if (state.carried.has(i)) return state.firstOpen === -1 || i < state.firstOpen
  return state.scores[i] != null || state.skipped.has(i)
}

/** Where Next (and a forward swipe) goes from `idx`: the next track that isn't
 *  an untouched carried score, so a run of them is passed over rather than
 *  stepped through. Tracks the listener scored or skipped are still stepped
 *  through, as before carried scores existed — that is how a rated album is
 *  walked when editing. -1 when nothing is left, which means the factors. */
export function nextTrackIndex(idx: number, count: number, carried: Set<number>): number {
  for (let i = idx + 1; i < count; i++) {
    if (!carried.has(i)) return i
  }
  return -1
}
