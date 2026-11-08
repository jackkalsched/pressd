// The recent-searches list, per account. Pure: each app keeps the array in its own
// storage (localStorage on web, the Keychain on mobile) under `recentKey`.
import type { SearchSong } from './types'

export type RecentItem = {
  kind: 'person' | 'album' | 'artist' | 'song' | 'catalog'
  key: string
  label: string
  sub?: string
  artUrl?: string | null
  /** What opening it needs; each app decides the shape for its router. */
  target: unknown
}

export const RECENT_MAX = 8

/** Newest first, one entry per kind+key, capped at RECENT_MAX. */
export function pushRecent(list: RecentItem[], item: RecentItem): RecentItem[] {
  const same = (r: RecentItem) => r.kind === item.kind && r.key === item.key
  return [item, ...list.filter(r => !same(r))].slice(0, RECENT_MAX)
}

export function recentKey(userId: number): string {
  return `pressd_recent_search_${userId}`
}

/** Where a song result opens: your own copy of its record (highlighting the song once
 *  rated, since an unrated record's songs are still locked), or the community page. */
export function songTarget(
  song: SearchSong,
): { kind: 'own'; albumId: number; highlight: number | null } | { kind: 'community'; albumId: number; highlight: number } {
  if (!song.mine) return { kind: 'community', albumId: song.albumId, highlight: song.trackId }
  return { kind: 'own', albumId: song.albumId, highlight: song.status === 'rated' ? song.trackId : null }
}
