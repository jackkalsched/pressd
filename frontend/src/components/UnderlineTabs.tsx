// A row of text tabs with one green underline that slides to the tab pressed —
// the profile's Library / Stats / Rankings, as iPhone draws them (no segmented
// box). The underline is measured from the buttons, so it fits each label's
// width; under reduced motion it moves without sliding.
import { useLayoutEffect, useRef, useState } from 'react'

export default function UnderlineTabs<K extends string>({ tabs, value, onChange }: {
  tabs: { key: K; label: string }[]
  value: K
  onChange: (key: K) => void
}) {
  const refs = useRef(new Map<K, HTMLButtonElement>())
  const [bar, setBar] = useState<{ left: number; width: number } | null>(null)

  useLayoutEffect(() => {
    const measure = () => {
      const el = refs.current.get(value)
      if (el) setBar({ left: el.offsetLeft, width: el.offsetWidth })
    }
    measure()
    // Labels reflow when the web font arrives or the window resizes.
    window.addEventListener('resize', measure)
    document.fonts?.ready.then(measure).catch(() => {})
    return () => window.removeEventListener('resize', measure)
  }, [value])

  return (
    <div className="relative flex items-center gap-8 pb-2">
      {tabs.map(({ key, label }) => (
        <button
          key={key}
          ref={(el) => { if (el) refs.current.set(key, el); else refs.current.delete(key) }}
          type="button"
          onClick={() => onChange(key)}
          aria-pressed={value === key}
          className={`text-[15px] font-semibold transition-colors ${
            value === key ? 'text-(--c-1c1917)' : 'text-(--c-a8998a) hover:text-(--c-1c1917)'
          }`}
        >
          {label}
        </button>
      ))}
      {bar && (
        <span
          aria-hidden
          className="absolute bottom-0 left-0 h-0.5 rounded-full bg-(--c-2d6a4f) transition-[transform,width] duration-300 ease-out motion-reduce:transition-none"
          style={{ width: bar.width, transform: `translateX(${bar.left}px)` }}
        />
      )}
    </div>
  )
}
