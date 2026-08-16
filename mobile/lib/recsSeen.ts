// Remembers which recommendations the "New Recommendation!" banner has already
// announced, so it fires once per arrival rather than sitting on For You until
// the album gets rated.
//
// Same shape as socialSeen: a high-water mark of epoch-ms, persisted in the
// Keychain with an in-memory mirror for synchronous reads and a subscribe layer
// so a change re-renders the page.
//
// A watermark rather than a set of album ids, for two reasons. It stays one
// small value however many albums a person is sent, and a later recommendation
// is always newer than the mark, so the banner re-arms by itself without
// anything having to enumerate what's outstanding.
import { useSyncExternalStore } from 'react'
import * as SecureStore from 'expo-secure-store'

const SEEN_KEY = 'pressd_recs_seen'

let lastSeen = 0
const listeners = new Set<() => void>()

function emit(): void {
  for (const l of listeners) l()
}

/** Hydrate the watermark from the Keychain. Call once at launch, before the
 *  For You tab can render — an unhydrated zero would announce every
 *  recommendation the user has ever been sent. */
export async function loadRecsSeen(): Promise<void> {
  try {
    const raw = await SecureStore.getItemAsync(SEEN_KEY)
    lastSeen = raw ? Number(raw) || 0 : 0
  } catch {
    lastSeen = 0
  }
  emit()
}

/** Mark recommendations up to `ts` (epoch ms) as announced. No-op if not newer. */
export function markRecsSeen(ts: number): void {
  if (!ts || ts <= lastSeen) return
  lastSeen = ts
  SecureStore.setItemAsync(SEEN_KEY, String(ts)).catch(() => {})
  emit()
}

function get(): number {
  return lastSeen
}

/** Reactive read of the watermark (epoch ms). */
export function useRecsSeen(): number {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    get,
    get,
  )
}

/** When a recommendation arrived, as epoch ms. 0 when it carries no timestamp. */
export function recTime(recommendedAt: string | null | undefined): number {
  if (!recommendedAt) return 0
  const t = Date.parse(recommendedAt)
  return Number.isNaN(t) ? 0 : t
}
