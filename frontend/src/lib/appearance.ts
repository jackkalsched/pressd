// Light or dark, on this browser. Mobile's device preference (lib/prefs.ts
// `appearance`), kept per device here too: it follows the system setting, or
// holds one regardless of it.
//
// The theme is a class on <html> (`dark`), which swaps every colour variable in
// index.css. index.html sets it from the same key before the first paint, so a
// dark page never flashes cream; this module keeps it right afterwards — when
// the choice changes, and when the system flips while the choice is System.
import { useSyncExternalStore } from 'react'

export type Appearance = 'system' | 'light' | 'dark'

const KEY = 'pressd-appearance'
const media = typeof window !== 'undefined' ? window.matchMedia('(prefers-color-scheme: dark)') : null
const listeners = new Set<() => void>()

function read(): Appearance {
  try {
    const v = localStorage.getItem(KEY)
    return v === 'light' || v === 'dark' ? v : 'system'
  } catch {
    return 'system'
  }
}

let current: Appearance = read()

function apply() {
  const dark = current === 'dark' || (current === 'system' && !!media?.matches)
  document.documentElement.classList.toggle('dark', dark)
}

media?.addEventListener('change', () => {
  if (current === 'system') apply()
})

export function setAppearance(value: Appearance) {
  current = value
  try {
    if (value === 'system') localStorage.removeItem(KEY)
    else localStorage.setItem(KEY, value)
  } catch {
    // Private mode: the choice holds for this visit.
  }
  apply()
  listeners.forEach((l) => l())
}

/** The current choice, re-rendering when it changes. */
export function useAppearance(): Appearance {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => current,
  )
}
