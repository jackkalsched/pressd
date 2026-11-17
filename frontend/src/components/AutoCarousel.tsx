// A row that drifts sideways on its own and loops, until someone reaches for
// it (For You's New & Popular, November 2026). The items are drawn twice, the
// second copy hidden from assistive tech, so the scroll wraps from the end of
// the first copy back to its start without a jump.
//
// Everything moves by easing, never by snapping:
//   - the drift eases to a stop when the pointer is over the row, a finger
//     touches it, it's scrolled by hand or focus lands inside, and eases back
//     up RESUME_MS after all of that ends;
//   - the arrows glide the row one item at a time, landing on an item's edge;
//   - with a mouse the row can be grabbed and dragged, and let go it coasts on
//     with the speed it was thrown at (a drag never counts as a click).
// The edges fade, so items arrive and leave rather than being cut off. Under
// reduced motion the row doesn't drift and the arrows jump; requestAnimationFrame
// already stops in a background tab.
import { useEffect, useRef, type ReactNode } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'

const SPEED = 28 // px per second, at full drift
const EASE_MS = 420 // how long the drift takes to ease in or out
const RESUME_MS = 1800
const STEP_MS = 560 // an arrow's glide
const GAP = 16 // gap-4, between items
const FADE = 56 // px of fade at each edge

const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3)

export default function AutoCarousel({ items, className = '', arrowTop = '50%', label = 'items' }: {
  items: ReactNode[]
  className?: string
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
    let resumeAt = 0
    let pos = el.scrollLeft // a float, since scrollLeft rounds
    let vel = 0 // the drift's current speed, eased toward SPEED or 0
    let last = performance.now()
    let frame = 0
    let tween: { from: number; to: number; start: number; dur: number } | null = null
    let fling = 0 // px/s left over from a throw
    let drag: { x: number; lastX: number; lastT: number; moved: boolean; v: number } | null = null
    let swallowClick = false

    const half = () => el.scrollWidth / 2
    const itemWidth = () => ((el.firstElementChild as HTMLElement | null)?.offsetWidth ?? 0) + GAP
    const wrap = () => {
      const h = half()
      if (h <= 0) return
      while (pos >= h) pos -= h
      while (pos < 0) pos += h
    }
    const pause = () => { resumeAt = performance.now() + RESUME_MS }

    const tick = (now: number) => {
      const dt = Math.min(64, now - last)
      last = now
      // A hand on a trackpad moved it: carry on from there.
      if (!tween && !drag && Math.abs(el.scrollLeft - pos) > 2) { pos = el.scrollLeft; pause() }

      if (tween) {
        const t = tween.dur ? Math.min(1, (now - tween.start) / tween.dur) : 1
        pos = tween.from + (tween.to - tween.from) * easeOutCubic(t)
        if (t >= 1) { tween = null; pause() }
        vel = 0
      } else if (drag) {
        vel = 0
      } else if (Math.abs(fling) > 8) {
        pos += (fling * dt) / 1000
        fling *= Math.exp(-dt / 320)
        vel = 0
        if (Math.abs(fling) <= 8) pause()
      } else {
        const target = !reduce && held === 0 && now >= resumeAt && half() > el.clientWidth ? SPEED : 0
        vel += (target - vel) * (1 - Math.exp(-dt / (EASE_MS / 3)))
        pos += (vel * dt) / 1000
      }
      wrap()
      el.scrollLeft = pos
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)

    stepRef.current = (dir) => {
      const w = itemWidth()
      if (!w) return
      fling = 0
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
    const release = () => { held = Math.max(0, held - 1); pause() }
    const onPointerDown = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse' || e.button !== 0) return
      if ((e.target as HTMLElement).closest('[data-carousel-arrow]')) return
      drag = { x: e.clientX, lastX: e.clientX, lastT: performance.now(), moved: false, v: 0 }
      tween = null
      fling = 0
    }
    const onPointerMove = (e: PointerEvent) => {
      if (!drag) return
      const now = performance.now()
      const dx = e.clientX - drag.lastX
      const dtm = Math.max(1, now - drag.lastT)
      pos -= dx
      wrap()
      el.scrollLeft = pos
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
        fling = Math.max(-2400, Math.min(2400, drag.v))
      }
      drag = null
      el.style.cursor = ''
      el.style.userSelect = ''
      pause()
    }
    const onClickCapture = (e: MouseEvent) => {
      if (swallowClick) { e.preventDefault(); e.stopPropagation(); swallowClick = false }
    }
    const onDragStart = (e: DragEvent) => e.preventDefault()

    el.addEventListener('pointerenter', hold)
    el.addEventListener('pointerleave', release)
    el.addEventListener('focusin', hold)
    el.addEventListener('focusout', release)
    el.addEventListener('wheel', pause, { passive: true })
    el.addEventListener('touchstart', pause, { passive: true })
    el.addEventListener('touchmove', pause, { passive: true })
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
      el.removeEventListener('wheel', pause)
      el.removeEventListener('touchstart', pause)
      el.removeEventListener('touchmove', pause)
      el.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)
      el.removeEventListener('click', onClickCapture, true)
      el.removeEventListener('dragstart', onDragStart)
    }
  }, [items.length])

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
        className={`flex gap-4 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden ${className}`}
        style={{ maskImage: fade, WebkitMaskImage: fade }}
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
