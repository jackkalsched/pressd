// When the "Pass it on" cell on For You is allowed to appear.
//
// It suggests sending one of your favourites to a friend, and a suggestion that
// is always there stops being read — so it waits a random three to five app
// opens between showings, never shows twice in one day, and remembers which
// album-and-friend pairs it offered recently so the server can draw others.
//
// An "open" is a cold launch, or coming back after AWAY_MS in the background.
// Flipping to another app and straight back is the same visit, not a new one.
//
// Same shape as recsSeen/whatsNew: Keychain-backed, an in-memory mirror for
// synchronous reads, and a subscribe layer so hydration re-renders.
import { useSyncExternalStore } from 'react'
import { AppState, type AppStateStatus } from 'react-native'
import * as SecureStore from 'expo-secure-store'

const KEY = 'pressd_pass_it_on'
const GAP_MIN = 3
const GAP_MAX = 5
const AWAY_MS = 30 * 60_000
const RECENT_MAX = 12

interface State {
  /** App opens counted on this device. */
  opens: number
  /** The open count at which the cell may next appear. */
  nextAt: number
  /** Local calendar day of the last showing, YYYY-MM-DD. */
  lastShownDay: string | null
  /** "albumId:friendId", newest first. */
  recent: string[]
}

let state: State | null = null
const listeners = new Set<() => void>()

function emit(): void {
  for (const l of listeners) l()
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

function gap(): number {
  return GAP_MIN + Math.floor(Math.random() * (GAP_MAX - GAP_MIN + 1))
}

function today(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function persist(): void {
  if (state) SecureStore.setItemAsync(KEY, JSON.stringify(state)).catch(() => {})
}

function recordOpen(): void {
  if (!state) return
  state = { ...state, opens: state.opens + 1 }
  persist()
  emit()
}

/** Hydrate, count this launch as an open, and start counting returns from the
 *  background. Call once at launch. A first install starts a full gap away, so
 *  the cell never greets someone on their first open. */
export async function loadPassItOn(): Promise<void> {
  let loaded: State | null = null
  try {
    const raw = await SecureStore.getItemAsync(KEY)
    if (raw) loaded = JSON.parse(raw) as State
  } catch { /* unreadable — start fresh */ }
  state = loaded ?? { opens: 0, nextAt: gap(), lastShownDay: null, recent: [] }
  recordOpen()

  let leftAt: number | null = null
  AppState.addEventListener('change', (status: AppStateStatus) => {
    if (status === 'background') leftAt = Date.now()
    else if (status === 'active' && leftAt != null) {
      if (Date.now() - leftAt >= AWAY_MS) recordOpen()
      leftAt = null
    }
  })
}

/** The current open's number, or 0 before hydration. Changes once per open, so
 *  a decision pinned to it lasts exactly one visit. */
export function usePassItOnOpen(): number {
  return useSyncExternalStore(subscribe, () => state?.opens ?? 0, () => 0)
}

/** Whether this open may show the cell. */
export function usePassItOnDue(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => !!state && state.opens >= state.nextAt && state.lastShownDay !== today(),
    () => false,
  )
}

/** Pairs shown recently, for the server to draw around. */
export function passItOnRecent(): string[] {
  return state?.recent ?? []
}

/** The cell was shown for `pair` ("albumId:friendId"): start the next gap. */
export function markPassItOnShown(pair: string): void {
  if (!state) return
  state = {
    ...state,
    nextAt: state.opens + gap(),
    lastShownDay: today(),
    recent: [pair, ...state.recent.filter((p) => p !== pair)].slice(0, RECENT_MAX),
  }
  persist()
  emit()
}

/** Nothing qualified this time. Wait out a gap before asking again rather than
 *  spending a request on every open for someone with no pair to offer. */
export function markPassItOnEmpty(): void {
  if (!state) return
  state = { ...state, nextAt: state.opens + gap() }
  persist()
  emit()
}
