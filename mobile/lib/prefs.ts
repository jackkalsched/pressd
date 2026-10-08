// Preferences that belong to this phone rather than the account: whether it
// buzzes, and which shelf Library opens on. Kept in the Keychain beside the
// session token, read once at launch (lib/auth.tsx awaits `loadPrefs` before
// the app is marked ready), and held in memory after that so a haptic tap
// never waits on storage.
//
// Notification switches are *not* here — the server sends the pushes, so it is
// the one that has to know (GET/PUT /users/me/notifications).
import { useSyncExternalStore } from 'react'
import * as SecureStore from 'expo-secure-store'
import type { AlbumStatus } from '@pressd/shared/types'

const PREFS_KEY = 'pressd_prefs'

export interface DevicePrefs {
  haptics: boolean
  libraryStart: AlbumStatus
}

const DEFAULTS: DevicePrefs = { haptics: true, libraryStart: 'rated' }

let prefs: DevicePrefs = DEFAULTS
const listeners = new Set<() => void>()

export async function loadPrefs(): Promise<void> {
  try {
    const raw = await SecureStore.getItemAsync(PREFS_KEY)
    // Merged over the defaults, so a preference added later has a value on
    // phones that saved their prefs before it existed.
    if (raw) prefs = { ...DEFAULTS, ...JSON.parse(raw) }
  } catch {
    // An unreadable blob just means the defaults.
  }
}

export function getPrefs(): DevicePrefs {
  return prefs
}

export function setPref<K extends keyof DevicePrefs>(key: K, value: DevicePrefs[K]): void {
  prefs = { ...prefs, [key]: value }
  listeners.forEach((l) => l())
  SecureStore.setItemAsync(PREFS_KEY, JSON.stringify(prefs)).catch(() => {})
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** The current prefs, re-rendering when Settings changes one. */
export function usePrefs(): DevicePrefs {
  return useSyncExternalStore(subscribe, getPrefs)
}
