// Where a discussion lives — as a URL, and as a query key.
//
// Both derivations sit here because four surfaces reach a thread (the album
// page's discussion row, the Heated rail, the Social feed, and the thread page
// itself), and a path assembled by hand in each of them drifts the moment a
// subject grows a field. The query key has the same problem more quietly: a key
// that differs only by an absent `undefined` looks identical while caching
// separately, so posting would leave the album page's count stale.
//
// The subject *key* is never built here. The server derives it from these parts
// (`_resolve_key`, backend/routers/discussions.py:62) precisely so the two
// clients cannot normalise it differently — sending one from a client is what
// forks a room. See CLAUDE.md §12 on grouping keys.
import type { SubjectType } from '../types'

/** The React Query key for one subject. */
export function threadKey(
  subjectType: string,
  artist?: string | null,
  album?: string | null,
): (string | number)[] {
  return ['thread', subjectType, artist ?? '', album ?? '']
}

/** The in-app URL for a subject. The parameter names match mobile's
 *  `/thread/[subject]` route so the two platforms name a room the same way. */
export function threadPath(
  subjectType: SubjectType,
  artist?: string | null,
  album?: string | null,
): string {
  const q = new URLSearchParams()
  if (artist) q.set('artist', artist)
  if (album) q.set('album', album)
  const qs = q.toString()
  return `/thread/${subjectType}${qs ? `?${qs}` : ''}`
}
