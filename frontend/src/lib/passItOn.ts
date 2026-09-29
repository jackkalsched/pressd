// When the "Pass it on" cell on For You is allowed to appear.
//
// The web twin of mobile/lib/passItOn.ts — same rule, same numbers, so the
// feature feels the same on both. It suggests sending one of your favourites
// to a friend, and a suggestion that is always there stops being read — so it
// waits a random three to five visits between showings, never shows twice in
// one day, and remembers which album-and-friend pairs it offered recently so
// the server can draw others.
//
// A "visit" is a page load, or coming back to the tab after AWAY_MS hidden —
// the browser's equivalent of mobile's cold launch and return from background.
// Switching tabs and straight back is the same visit, not a new one.
//
// Kept in localStorage, so it is per browser rather than per account, the same
// way mobile's is per device. Reads never throw: without storage the cell
// simply follows the in-memory count for this page's lifetime.
import { useSyncExternalStore } from 'react'

const KEY = 'pressd_pass_it_on'
const GAP_MIN = 3
const GAP_MAX = 5
const AWAY_MS = 30 * 60_000
const RECENT_MAX = 12

interface State {
  /** Visits counted in this browser. */
  opens: number
  /** The visit count at which the cell may next appear. */
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
  try { if (state) localStorage.setItem(KEY, JSON.stringify(state)) } catch { /* ignore */ }
}

function recordOpen(): void {
  if (!state) return
  state = { ...state, opens: state.opens + 1 }
  persist()
  emit()
}

/** Hydrate, count this page load as a visit, and start counting returns to
 *  the tab. Call once at startup. A first visit starts a full gap away, so the
 *  cell never greets someone the first time they arrive. */
export function loadPassItOn(): void {
  let loaded: State | null = null
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) loaded = JSON.parse(raw) as State
  } catch { /* unreadable — start fresh */ }
  state = loaded ?? { opens: 0, nextAt: gap(), lastShownDay: null, recent: [] }
  recordOpen()

  let leftAt: number | null = null
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') leftAt = Date.now()
    else if (leftAt != null) {
      if (Date.now() - leftAt >= AWAY_MS) recordOpen()
      leftAt = null
    }
  })
}

/** The current visit's number, or 0 before hydration. Changes once per visit,
 *  so a decision pinned to it lasts exactly one visit. */
export function usePassItOnOpen(): number {
  return useSyncExternalStore(subscribe, () => state?.opens ?? 0)
}

/** Whether this visit may show the cell. */
export function usePassItOnDue(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => !!state && state.opens >= state.nextAt && state.lastShownDay !== today(),
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
 *  spending a request on every visit for someone with no pair to offer. */
export function markPassItOnEmpty(): void {
  if (!state) return
  state = { ...state, nextAt: state.opens + gap() }
  persist()
  emit()
}
