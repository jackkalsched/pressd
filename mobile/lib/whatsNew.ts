// Remembers which build's release notes have already been shown, so "What's
// New" appears once after an update and never again until the next one.
//
// Keyed on the build number rather than a boolean, for two reasons. A boolean
// would have to be cleared by hand every release — a step nobody remembers on
// the release that matters. And a stored number lets a user who skips a version
// still see the newest notes on the build they actually land on.
//
// Same shape as socialSeen/recsSeen: Keychain-backed with an in-memory mirror
// for synchronous reads and a subscribe layer so hydration re-renders.
import { useSyncExternalStore } from 'react'
import * as SecureStore from 'expo-secure-store'
import Constants from 'expo-constants'

const SEEN_KEY = 'pressd_whats_new_build'

// -1 rather than 0 while unread: a fresh install has nothing stored, and 0
// would compare equal to a missing build number and suppress the notes for the
// one case where they matter least but should still be correct.
let seenBuild = -1
let hydrated = false
const listeners = new Set<() => void>()

function emit(): void {
  for (const l of listeners) l()
}

/** The build this binary was shipped as, as a number.
 *
 *  `nativeBuildVersion` is what the installed app actually reports; the value
 *  in app.json only describes what the *next* build will be, so reading that
 *  would show the notes in Expo Go against a build that was never installed.
 */
export function currentBuild(): number {
  const raw =
    Constants.nativeBuildVersion ??
    Constants.expoConfig?.ios?.buildNumber ??
    null
  const n = raw == null ? NaN : Number(raw)
  return Number.isFinite(n) ? n : 0
}

/** Hydrate the last-seen build from the Keychain. Call once at launch. */
export async function loadWhatsNewSeen(): Promise<void> {
  try {
    const raw = await SecureStore.getItemAsync(SEEN_KEY)
    const n = raw == null ? NaN : Number(raw)
    seenBuild = Number.isFinite(n) ? n : -1
  } catch {
    seenBuild = -1
  }
  hydrated = true
  emit()
}

/** Mark the running build's notes as read. */
export function markWhatsNewSeen(build: number = currentBuild()): void {
  if (!Number.isFinite(build) || build <= seenBuild) return
  seenBuild = build
  SecureStore.setItemAsync(SEEN_KEY, String(build)).catch(() => {})
  emit()
}

function getSeen(): number {
  return seenBuild
}

function getHydrated(): boolean {
  return hydrated
}

function subscribe(cb: () => void) {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

/** Reactive read of the last-seen build. */
export function useWhatsNewSeen(): number {
  return useSyncExternalStore(subscribe, getSeen, getSeen)
}

/** True once the Keychain has answered — held off until then so the sheet
 *  never flashes up on a build whose notes were already read. */
export function useWhatsNewHydrated(): boolean {
  return useSyncExternalStore(subscribe, getHydrated, getHydrated)
}
