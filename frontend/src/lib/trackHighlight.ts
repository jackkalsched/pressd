// A song found in search opens its record with `?track=<track_id>`: the page
// scrolls that row into view and marks it once with index.css's `flash`, so the
// eye lands on it. Rows opt in with `data-track-id`; the page passes `ready`
// once the row can be on screen (for your own copy, only when it is rated: an
// unfinished record's songs are still locked, and search never jumps ahead).
import { useEffect, useRef, useState } from 'react'

const SCROLL_AFTER_MS = 150
const FLASH_AFTER_MS = 350
const FLASH_MS = 1700

/** The track id lit right now, or null. */
export function useTrackHighlight(track: number | null, ready: boolean): number | null {
  const [lit, setLit] = useState<number | null>(null)
  const done = useRef<number | null>(null)

  useEffect(() => {
    if (!ready || track == null || done.current === track) return
    const timers: number[] = []
    timers.push(window.setTimeout(() => {
      const el = document.querySelector(`[data-track-id="${track}"]`)
      if (!el) return
      done.current = track
      const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
      el.scrollIntoView({ block: 'center', behavior: reduced ? 'auto' : 'smooth' })
      timers.push(window.setTimeout(() => setLit(track), FLASH_AFTER_MS))
      timers.push(window.setTimeout(() => setLit(null), FLASH_AFTER_MS + FLASH_MS))
    }, SCROLL_AFTER_MS))
    return () => timers.forEach((t) => window.clearTimeout(t))
  }, [track, ready])

  return lit
}

/** `?track=` as a number, or null. */
export function trackParam(params: URLSearchParams): number | null {
  const raw = params.get('track')
  const n = raw ? Number(raw) : NaN
  return Number.isFinite(n) ? n : null
}
