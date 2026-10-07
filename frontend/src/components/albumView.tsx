// The pieces both album pages are drawn from — your rating (AlbumDetail) and
// the Pressd average and compare views (CommunityAlbum). One copy, so the two
// can't drift apart in look or motion: the community page was redesigned first,
// and your rating trailed it until October 2026 because each page had its own.
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { songScoreColor, BANG_THRESHOLD, SKIP_THRESHOLD } from '../types'
import { coverUrl } from '@pressd/shared/covers'
import { stagger } from '../lib/format'

export const GREEN = '#2d6a4f'
export const RECOMMEND = '#ea7a2a'
export const DANGER = '#b91c1c'

/** The top bar's controls. */
export const PILL =
  'inline-flex items-center gap-1.5 rounded-full border border-[#e2dbd0] bg-white/80 px-3.5 py-1.5 text-[13px] font-semibold text-[#2d6a4f] hover:border-[#2d6a4f] hover:bg-white disabled:opacity-60'

/** A small caps label over a group of numbers or rows. */
export const SECTION_LABEL = 'm-0 text-[11px] font-bold tracking-[0.16em] text-[#a8998a]'

/** The record's colour, faintly, behind the top of the page. */
export function CoverWash({ url }: { url: string | null | undefined }) {
  if (!url) return null
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-x-0 top-0 h-[460px] opacity-[0.22] fade-in"
      style={{
        // Blurred 70px: a small image is all it needs.
        backgroundImage: `url(${coverUrl(url, 120)})`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        filter: 'blur(70px) saturate(1.3)',
        maskImage: 'linear-gradient(to bottom, black, transparent)',
        WebkitMaskImage: 'linear-gradient(to bottom, black, transparent)',
      }}
    />
  )
}

/** A track row that pops up the first time it scrolls into view — mobile's
 *  tracklist is dealt out the same way. Rows that arrive together (the first
 *  screenful, or a fast scroll) are staggered by their position in that run,
 *  not by their place in the list, so row 14 doesn't wait behind thirteen
 *  delays. Under reduced motion every row is simply there. */
export function RevealRow({ index, children }: { index: number; children: ReactNode }) {
  const ref = useRef<HTMLLIElement>(null)
  const [shown, setShown] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  )
  useEffect(() => {
    if (shown) return
    const el = ref.current
    if (!el) return
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setShown(true)
          io.disconnect()
        }
      },
      { threshold: 0.2, rootMargin: '0px 0px -6% 0px' },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [shown])
  return (
    <li
      ref={ref}
      className={shown ? 'pop-in' : 'opacity-0'}
      style={shown ? { animationDelay: `${(index % 6) * 45}ms` } : undefined}
    >
      {children}
    </li>
  )
}

export function BangSkip({ score }: { score: number | null }) {
  if (score == null) return null
  if (score >= BANG_THRESHOLD) {
    return <span className="text-[10px] font-bold tracking-[0.08em]" style={{ color: songScoreColor(score) }}>BANG</span>
  }
  if (score < SKIP_THRESHOLD) {
    return <span className="text-[10px] font-bold tracking-[0.08em]" style={{ color: songScoreColor(score) }}>SKIP</span>
  }
  return null
}

/** One number in a row of them — the factors, the song stats. */
export function StatFigure({ label, value, digits = 1, suffix = '', color, index }: {
  label: string
  value: number | null
  digits?: number
  suffix?: string
  /** Defaults to the score colour of the value. */
  color?: string
  index: number
}) {
  return (
    <div className="rise-in" style={stagger(index)}>
      <p
        className="font-display m-0 text-[26px] font-bold leading-none tabular-nums"
        style={{ color: value == null ? '#c8c0b4' : (color ?? songScoreColor(value)) }}
      >
        {value != null ? `${value.toFixed(digits)}${suffix}` : '—'}
      </p>
      <p className="m-0 mt-1.5 text-[12px] font-medium text-[#8a7f72]">{label}</p>
    </div>
  )
}
