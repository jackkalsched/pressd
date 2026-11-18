// A row that drifts sideways on its own and loops, until someone reaches for
// it (For You's New & Popular, November 2026). The items are drawn twice, the
// second copy hidden from assistive tech, so the scroll wraps from the end of
// the first copy back to its start without a jump.
//
// Everything moves by easing, never by snapping, and the row has weight
// (November 2026):
//   - the drift eases to a stop while the pointer is over the row or focus is
//     inside, and back up after;
//   - thrown — a mouse drag let go, a trackpad swipe, a finger on a touch
//     screen — it carries on at the speed of the hand, either way, and settles
//     back to the idle drift over SETTLE_MS rather than stopping dead;
//   - the arrows glide the row one item at a time, landing on an item's edge;
//   - a drag never counts as a click.
// The edges fade, so items arrive and leave rather than being cut off. Under
// reduced motion the row doesn't drift and the arrows jump; requestAnimationFrame
// already stops in a background tab.
import { useEffect, useRef, type ReactNode } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'

const SPEED = 28 // px per second, the idle drift
const EASE_MS = 420 // rest ↔ idle drift
const SETTLE_MS = 2100 // a throw → idle drift: the row's weight
const MAX_THROW = 5000 // px per second
const HAND_MS = 90 // the row is the hand's while it moved it this recently
const STEP_MS = 560 // an arrow's glide
const FADE = 56 // px of fade at each edge

const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3)

export default function AutoCarousel({ items, className = '', arrowTop = '50%', label = 'items', gap = 16 }: {
  items: ReactNode[]
  className?: string
  /** px between items. */
  gap?: number
  /** Where the arrows' centres sit, from the row's top (e.g. a cover's middle). */
  arrowTop?: number | string
  /** What the row holds, for the arrows' labels ("albums"). */
  label?: string
}) {
  const ref = useRef<HTMLDivElement>(null)
  const stepRef = useRef<(dir: 1 | -1) => void>(() => {})

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches

    let held = 0 // reasons it's held: hover, focus
    let pos = el.scrollLeft // a float, since scrollLeft rounds
    let written = el.scrollLeft // what the row last set, as the browser rounded it
    let vel = 0 // px/s: the row's current speed, settling toward its target
    let hand = { until: 0, v: 0 } // a trackpad or touch scroll in progress, and its speed
    let last = performance.now()
    let frame = 0
    let tween: { from: number; to: number; start: number; dur: number } | null = null
    let drag: { x: number; lastX: number; lastT: number; moved: boolean; v: number } | null = null
    let swallowClick = false

    // One copy's length: from the first item to the first item of the copy
    // (padding on the row doesn't belong to the loop).
    const n = items.length
    const half = () => {
      const first = el.children[0] as HTMLElement | undefined
      const copy = el.children[n]?.firstElementChild as HTMLElement | null | undefined
      return first && copy ? copy.offsetLeft - first.offsetLeft : el.scrollWidth / 2
    }
    const itemWidth = () => ((el.firstElementChild as HTMLElement | null)?.offsetWidth ?? 0) + gap
    const wrap = () => {
      const h = half()
      if (h <= 0) return
      while (pos >= h) pos -= h
      while (pos < 0) pos += h
    }
    const clampThrow = (v: number) => Math.max(-MAX_THROW, Math.min(MAX_THROW, v))

    const tick = (now: number) => {
      const dt = Math.min(64, now - last)
      last = now
      // A trackpad or a finger moved it (the browser's own scrolling, momentum
      // included): follow it and measure the hand's speed, without writing back.
      const moved = el.scrollLeft - written
      if (!tween && !drag && Math.abs(moved) > 0.5 && dt > 0) {
        const v = (moved / dt) * 1000
        hand = { until: now + HAND_MS, v: now < hand.until ? hand.v * 0.5 + v * 0.5 : v }
        pos = el.scrollLeft
        // Past either end of the first copy, jump by one copy: the same view.
        const h = half()
        if (h > 0 && (pos >= h || pos <= 0)) { wrap(); el.scrollLeft = pos }
        written = el.scrollLeft
        frame = requestAnimationFrame(tick)
        return
      }
      if (hand.until && now >= hand.until) {
        // The hand let go: the row takes the throw.
        vel = clampThrow(hand.v)
        hand = { until: 0, v: 0 }
      }

      if (tween) {
        const t = tween.dur ? Math.min(1, (now - tween.start) / tween.dur) : 1
        pos = tween.from + (tween.to - tween.from) * easeOutCubic(t)
        if (t >= 1) tween = null
        vel = 0
      } else if (drag) {
        vel = 0
      } else {
        const target = !reduce && held === 0 && el.scrollWidth / 2 > el.clientWidth ? SPEED : 0
        // Faster than the drift, or thrown backwards, it settles slowly; from
        // rest it eases up quickly.
        const tau = Math.abs(vel) > Math.abs(target) * 1.25 + 1 || vel * target < 0 ? SETTLE_MS / 3 : EASE_MS / 3
        vel += (target - vel) * (1 - Math.exp(-dt / tau))
        pos += (vel * dt) / 1000
      }
      wrap()
      el.scrollLeft = pos
      written = el.scrollLeft
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)

    stepRef.current = (dir) => {
      const w = itemWidth()
      if (!w) return
      vel = 0
      // Land on an item's edge: one along from where the row is headed (a
      // glide already under way, for quick repeated taps), from where it is.
      const base = tween ? tween.to : pos
      let to = (Math.round(base / w) + dir) * w
      if (to < 0) {
        // Going back past the start: the same place in the first copy is one
        // copy's width on, so move there first.
        pos += half()
        to += half()
        el.scrollLeft = pos
      }
      tween = { from: pos, to, start: performance.now(), dur: reduce ? 0 : STEP_MS }
    }

    const hold = () => { held += 1 }
    const release = () => { held = Math.max(0, held - 1) }
    const onPointerDown = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse' || e.button !== 0) return
      if ((e.target as HTMLElement).closest('[data-carousel-arrow]')) return
      drag = { x: e.clientX, lastX: e.clientX, lastT: performance.now(), moved: false, v: 0 }
      tween = null
      vel = 0
    }
    const onPointerMove = (e: PointerEvent) => {
      if (!drag) return
      const now = performance.now()
      const dx = e.clientX - drag.lastX
      const dtm = Math.max(1, now - drag.lastT)
      pos -= dx
      wrap()
      el.scrollLeft = pos
      written = el.scrollLeft
      // The throw's speed, smoothed over the last few moves.
      drag.v = drag.v * 0.6 + (-dx / dtm) * 1000 * 0.4
      drag.lastX = e.clientX
      drag.lastT = now
      if (!drag.moved && Math.abs(e.clientX - drag.x) > 5) {
        drag.moved = true
        el.style.cursor = 'grabbing'
        el.style.userSelect = 'none'
      }
    }
    const onPointerUp = () => {
      if (!drag) return
      if (drag.moved) {
        swallowClick = true
        // A hand that came to rest before letting go throws nothing.
        vel = performance.now() - drag.lastT > 80 ? 0 : clampThrow(drag.v)
      }
      drag = null
      el.style.cursor = ''
      el.style.userSelect = ''
    }
    const onClickCapture = (e: MouseEvent) => {
      if (swallowClick) { e.preventDefault(); e.stopPropagation(); swallowClick = false }
    }
    const onDragStart = (e: DragEvent) => e.preventDefault()

    el.addEventListener('pointerenter', hold)
    el.addEventListener('pointerleave', release)
    el.addEventListener('focusin', hold)
    el.addEventListener('focusout', release)
    el.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)
    el.addEventListener('click', onClickCapture, true)
    el.addEventListener('dragstart', onDragStart)
    return () => {
      cancelAnimationFrame(frame)
      el.removeEventListener('pointerenter', hold)
      el.removeEventListener('pointerleave', release)
      el.removeEventListener('focusin', hold)
      el.removeEventListener('focusout', release)
      el.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)
      el.removeEventListener('click', onClickCapture, true)
      el.removeEventListener('dragstart', onDragStart)
    }
  }, [items.length, gap])

  const fade = `linear-gradient(to right, transparent, #000 ${FADE}px, #000 calc(100% - ${FADE}px), transparent)`
  const arrow = (dir: 1 | -1) => {
    const Icon = dir === 1 ? ChevronRight : ChevronLeft
    return (
      <button
        type="button"
        data-carousel-arrow
        onClick={() => stepRef.current(dir)}
        aria-label={dir === 1 ? `Next ${label}` : `Previous ${label}`}
        className={`absolute z-10 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full border border-(--c-e8e2d9)/80 bg-(--c-fff)/75 text-(--c-1c1917) shadow-[0_10px_28px_-12px_rgba(40,25,10,0.55)] backdrop-blur-md transition-[opacity,transform,background-color] duration-200 ease-out hover:scale-[1.07] hover:bg-(--c-fff)/95 active:scale-[0.93] opacity-0 group-hover/carousel:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100 ${
          dir === 1 ? 'right-2' : 'left-2'
        }`}
        style={{ top: arrowTop }}
      >
        <Icon size={20} strokeWidth={2.4} />
      </button>
    )
  }

  return (
    <div className="group/carousel relative">
      <div
        ref={ref}
        className={`flex overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden ${className}`}
        style={{ gap, maskImage: fade, WebkitMaskImage: fade }}
      >
        {items}
        {/* The loop's second copy: for the eye only. */}
        {items.map((item, i) => (
          <div key={`copy-${i}`} aria-hidden inert className="contents">{item}</div>
        ))}
      </div>
      {arrow(-1)}
      {arrow(1)}
    </div>
  )
}
