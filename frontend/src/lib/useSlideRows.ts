// A bin's rows sliding to their new places when the order changes — the
// bin page's Sort by, and its owner's drag to reorder (components/BinEditor.tsx).
import { useLayoutEffect, useRef } from 'react'

/** When the order changes, each row slides from where it was to where it now
 *  is (FLIP: measure, reorder, play the difference back). Positions are taken
 *  against the list itself, so scrolling between two sorts doesn't count as
 *  movement. Nothing moves under prefers-reduced-motion. */
export function useSlideRows(order: string) {
  const list = useRef<HTMLOListElement>(null)
  const last = useRef(new Map<string, DOMRect>())
  useLayoutEffect(() => {
    const ol = list.current
    if (!ol) return
    const base = ol.getBoundingClientRect()
    const now = new Map<string, DOMRect>()
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    for (const li of Array.from(ol.children) as HTMLElement[]) {
      const id = li.dataset.id
      if (!id) continue
      const r = li.getBoundingClientRect()
      const rel = new DOMRect(r.left - base.left, r.top - base.top, r.width, r.height)
      now.set(id, rel)
      const was = last.current.get(id)
      if (!was || still) continue
      const dx = was.left - rel.left, dy = was.top - rel.top
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue
      li.animate(
        [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }],
        { duration: 520, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' },
      )
    }
    last.current = now
  }, [order])
  return list
}
