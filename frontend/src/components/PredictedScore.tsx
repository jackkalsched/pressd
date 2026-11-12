// A predicted album score: the number filled with a slow gray → green → red →
// green → gray gradient, so an estimate never reads as a settled score (which is
// drawn in one flat colour), with a small sparkle that flashes at its corner.
// mobile/components/PredictedScore.tsx is the same drawing; change both.
//
// Layout is the caller's: this is an inline-block span that inherits the font,
// size, weight and line height of whatever it sits in, so swapping it in for a
// coloured number moves nothing. The fill is the text itself
// (`background-clip: text`) over a gradient three times its width, panned
// 0 → 100% → 0 on a 6s ease-in-out loop; the sparkle scales up, turns 45° and
// fades every 3.4s. The keyframes and the colours (`--predicted-*`, a pair per
// appearance) are in index.css, "PredictedScore". Both stop while the number is
// off screen or the tab is hidden, and under prefers-reduced-motion the gradient
// stands still and there is no sparkle.
import { useEffect, useRef, useState } from 'react'

export default function PredictedScore({
  value,
  places = 2,
  prefix = '',
  sparkle = true,
  className = '',
}: {
  value: number
  /** Two for an album score, which is every predicted score today. */
  places?: number
  /** Drawn before the number, inside the gradient ("~"). */
  prefix?: string
  /** The flashing corner sparkle; off for very small numbers. */
  sparkle?: boolean
  className?: string
}) {
  const ref = useRef<HTMLSpanElement>(null)
  const [onScreen, setOnScreen] = useState(true)
  const [visible, setVisible] = useState(() => typeof document === 'undefined' || !document.hidden)

  useEffect(() => {
    const el = ref.current
    if (!el || typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver(([entry]) => setOnScreen(entry.isIntersecting))
    io.observe(el)
    return () => io.disconnect()
  }, [])

  useEffect(() => {
    const onChange = () => setVisible(!document.hidden)
    document.addEventListener('visibilitychange', onChange)
    return () => document.removeEventListener('visibilitychange', onChange)
  }, [])

  const paused = !onScreen || !visible

  return (
    <span ref={ref} className={`predicted-score${paused ? ' predicted-paused' : ''} ${className}`}>
      <span className="predicted-fill">{prefix}{value.toFixed(places)}</span>
      {sparkle && (
        <svg className="predicted-sparkle" viewBox="0 0 24 24" aria-hidden="true">
          {/* A four-point star: concave sides meeting at the four tips. */}
          <path d="M12 0 C12.8 7.5 16.5 11.2 24 12 C16.5 12.8 12.8 16.5 12 24 C11.2 16.5 7.5 12.8 0 12 C7.5 11.2 11.2 7.5 12 0 Z" fill="#ffffff" />
        </svg>
      )}
    </span>
  )
}
