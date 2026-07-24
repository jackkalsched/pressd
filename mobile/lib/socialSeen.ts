// Tracks when the user last looked at the Social activity feed so the tab bar
// can show a "new activity" dot. The newest feed timestamp is compared against
// this stored value; opening the Social tab marks everything seen. Persisted in
// the Keychain (async) with an in-memory mirror for synchronous reads, and a
// tiny subscribe layer so the tab bar re-renders when it changes.
import { useSyncExternalStore } from 'react'
import * as SecureStore from 'expo-secure-store'
import type { FeedItem } from './api'

const SEEN_KEY = 'pressd_social_seen'

let lastSeen = 0
const listeners = new Set<() => void>()

function emit(): void {
  for (const l of listeners) l()
}

/** Hydrate the last-seen timestamp from the Keychain. Call once at launch. */
export async function loadSocialSeen(): Promise<void> {
  try {
    const raw = await SecureStore.getItemAsync(SEEN_KEY)
    lastSeen = raw ? Number(raw) || 0 : 0
  } catch {
    lastSeen = 0
  }
  emit()
}

/** Mark feed activity up to `ts` (epoch ms) as seen. No-op if not newer. */
export function markSocialSeen(ts: number): void {
  if (!ts || ts <= lastSeen) return
  lastSeen = ts
  SecureStore.setItemAsync(SEEN_KEY, String(ts)).catch(() => {})
  emit()
}

function getSocialSeen(): number {
  return lastSeen
}

/** Reactive read of the last-seen timestamp (epoch ms). */
export function useSocialSeen(): number {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    getSocialSeen,
    getSocialSeen,
  )
}

function itemTime(item: FeedItem): number {
  let max = 0
  for (const stamp of [item.review_at, item.recommended_at, item.date_rated]) {
    if (!stamp) continue
    const t = Date.parse(stamp)
    if (!Number.isNaN(t) && t > max) max = t
  }
  return max
}

/** Newest activity time across a feed (epoch ms), or 0 if empty. */
export function latestFeedTime(feed: FeedItem[]): number {
  let max = 0
  for (const item of feed) {
    const t = itemTime(item)
    if (t > max) max = t
  }
  return max
}
