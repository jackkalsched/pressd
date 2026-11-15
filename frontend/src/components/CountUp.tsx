// A figure that counts up to its value as the profile loads — "6,098" from zero,
// "7.22" through the decimals — and from the old value when it changes. iPhone's
// CountUp (mobile/components/ProfileBanner.tsx), line for line: the same 1.3s and
// the same quintic ease-out, so the two profiles land together. Anything that
// isn't a number ("—") is shown as it is, and reduced motion shows the value
// straight away.
import { useEffect, useRef, useState } from 'react'

const COUNT_MS = 1300

// Where each figure last got to, by profile and label, so a header rebuilt
// mid-visit starts from there rather than from zero.
const counted = new Map<string, number>()

export default function CountUp({ value, cacheKey }: { value: string; cacheKey: string }) {
  const target = Number(value.replace(/,/g, ''))
  const numeric = value.trim() !== '' && Number.isFinite(target)
  const decimals = numeric ? (value.split('.')[1]?.length ?? 0) : 0
  const grouped = value.includes(',')
  const [shown, setShown] = useState(() => counted.get(cacheKey) ?? 0)
  const from = useRef(counted.get(cacheKey) ?? 0)

  useEffect(() => {
    if (!numeric) return
    let frame = 0
    const start = from.current
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduce || start === target) {
      from.current = target
      counted.set(cacheKey, target)
      frame = requestAnimationFrame(() => setShown(target))
      return () => cancelAnimationFrame(frame)
    }
    const t0 = performance.now()
    const tick = (now: number) => {
      const t = Math.min(1, (now - t0) / COUNT_MS)
      // Quintic ease-out: most of the climb early, a long settle into the value.
      const eased = 1 - Math.pow(1 - t, 5)
      const v = start + (target - start) * eased
      from.current = v
      counted.set(cacheKey, v)
      setShown(v)
      if (t < 1) frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [numeric, target, cacheKey])

  if (!numeric) return <>{value}</>
  const text = decimals > 0 ? shown.toFixed(decimals) : Math.round(shown).toString()
  return <>{grouped ? Number(text).toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals }) : text}</>
}
