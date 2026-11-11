// Search on a bin's page (its records) and on the Bins page (the bins), folded
// into a round magnifier until it's wanted: a click opens the field, focused;
// ✕ or Escape clears and folds it, as leaving it empty does. On a bin's page
// the page holds `open`, because opening search squeezes the sort down to its
// icon and that icon folds search away again. One element in both states, so
// its width transitions rather than one box swapping for another. Mobile's
// components/BinSearch.tsx; the matching rule is shared/src/binSort.ts's.
import { useState } from 'react'
import { Search, X } from 'lucide-react'

export default function BinSearch({ value, onChange, placeholder, className = '', open: openProp, onOpenChange }: {
  value: string
  onChange: (v: string) => void
  placeholder: string
  /** The open field's width (a width class, so it transitions from the circle's). */
  className?: string
  /** Held by the page, when something else opens or folds it. */
  open?: boolean
  onOpenChange?: (open: boolean) => void
}) {
  const [ownOpen, setOwnOpen] = useState(false)
  const open = openProp ?? (ownOpen || value !== '')
  const setOpen = (v: boolean) => (onOpenChange ? onOpenChange(v) : setOwnOpen(v))
  const close = () => { onChange(''); setOpen(false) }

  return (
    <div
      className={`flex h-9 shrink-0 items-center overflow-hidden rounded-full border transition-[width,border-color] duration-300 ease-out motion-reduce:transition-none ${
        open ? `gap-2 border-(--c-2d6a4f) bg-(--c-fff) px-4 ${className}` : 'w-9 border-(--c-e2dbd0) hover:border-(--c-2d6a4f)'
      }`}
    >
      {open ? (
        <>
          <Search size={15} className="shrink-0 text-(--c-a8998a)" />
          <input
            type="search"
            autoFocus
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onBlur={() => { if (!value) setOpen(false) }}
            onKeyDown={(e) => { if (e.key === 'Escape') close() }}
            placeholder={placeholder}
            aria-label={placeholder}
            className="min-w-0 flex-1 bg-transparent text-[14px] text-(--c-1c1917) outline-none placeholder:text-(--c-a8998a) [&::-webkit-search-cancel-button]:hidden"
          />
          <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={close} aria-label="Close search" className="shrink-0 text-(--c-a8998a) hover:text-(--c-1c1917)">
            <X size={15} />
          </button>
        </>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label={placeholder}
          title={placeholder}
          className="flex h-full w-full items-center justify-center text-(--c-1c1917) hover:text-(--c-2d6a4f)"
        >
          <Search size={15} />
        </button>
      )}
    </div>
  )
}
