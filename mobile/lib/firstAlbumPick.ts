// The album chosen in the first-album sheet, handed back to the welcome screen
// that opened it. expo-router has no return value for a dismissed modal, so the
// two talk through this instead — the same tiny store shape socialSeen.ts uses.
//
// Deliberately memory-only, unlike socialSeen: a pick lives for the few seconds
// between choosing a record and confirming it. One surviving a relaunch would
// be wrong rather than helpful.
import { useSyncExternalStore } from 'react'
import type { AlbumSearchResult } from '@pressd/shared/api'

let pick: AlbumSearchResult | null = null
const listeners = new Set<() => void>()

function emit(): void {
  for (const l of listeners) l()
}

/** Record the sheet's choice, or clear it with null. */
export function setFirstAlbumPick(next: AlbumSearchResult | null): void {
  pick = next
  emit()
}

function getFirstAlbumPick(): AlbumSearchResult | null {
  return pick
}

/** Reactive read, so welcome updates the moment the sheet closes. */
export function useFirstAlbumPick(): AlbumSearchResult | null {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    getFirstAlbumPick,
    getFirstAlbumPick,
  )
}
