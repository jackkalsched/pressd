// The "one record, one thing to do with it" card at the top of For You — used
// by Pass it on and by Pick this back up.
//
// It replaced two bordered boxes with a rectangular button each, which read as
// form rows. This one has no border and no box button: the record's own cover,
// blurred, is the card's colour; the cover sits tilted and eases a little
// straighter under the pointer; the whole card is the target, and the action
// is a round arrow that moves when you reach for it. The two callers differ
// only in what rides
// on the cover (a friend's face) and around the arrow (a progress ring).
import type { CSSProperties, ReactNode } from 'react'
import { ArrowRight } from 'lucide-react'
import { Cover } from './covers'
import CoverImg from './CoverImg'

const TONES = {
  green: { ink: '#2d6a4f', wash: 'linear-gradient(115deg, #e6f0ea, #f6f4ef 70%)', ring: '#cfe0d6' },
  orange: { ink: '#ea6c0a', wash: 'linear-gradient(115deg, #ffeedd, #f8f5f0 70%)', ring: '#fbd5b5' },
} as const

const RING = 58
const RING_STROKE = 3

export default function SpotlightCard({
  tone,
  eyebrow,
  title,
  artUrl,
  seed,
  children,
  action,
  ariaLabel,
  onClick,
  badge,
  progress,
  index = 0,
}: {
  tone: keyof typeof TONES
  /** The small label over the title, icon included. */
  eyebrow: ReactNode
  title: string
  artUrl?: string | null
  seed: string
  /** Lines under the title. */
  children: ReactNode
  /** What the arrow does, in a word — shown beside it. */
  action: string
  ariaLabel: string
  onClick: () => void
  /** Rides on the cover's lower-right corner. */
  badge?: ReactNode
  /** 0–100: drawn as a ring around the arrow. */
  progress?: number
  /** Position in the row, for the staggered entrance. */
  index?: number
}) {
  const t = TONES[tone]
  const r = (RING - RING_STROKE) / 2
  const circumference = 2 * Math.PI * r

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      className="rise-in group relative w-full overflow-hidden rounded-[28px] text-left isolate transition-shadow duration-300 hover:shadow-[0_22px_44px_-26px_rgba(50,30,10,0.5)]"
      style={{ background: t.wash, '--i': index } as CSSProperties}
    >
      {/* The record's colour, as light rather than as a picture. Scaled past
          the edges so the blur has no hard border to fade against. */}
      {artUrl && (
        <CoverImg
          url={artUrl}
          // Blurred to a wash: a small image is all it needs.
          displayPx={120}
          alt=""
          aria-hidden
          className="pointer-events-none absolute inset-0 -z-10 h-full w-full scale-150 object-cover opacity-[0.22] blur-3xl saturate-150 transition-opacity duration-500 group-hover:opacity-[0.36]"
        />
      )}

      <div className="flex items-center gap-5 p-5 pr-6">
        <div className="relative shrink-0">
          <div className="-rotate-[5deg] rounded-[18px] shadow-[0_16px_30px_-14px_rgba(40,25,10,0.6)] transition-transform duration-300 ease-out group-hover:-rotate-[2deg] group-hover:scale-[1.02]">
            <Cover artUrl={artUrl} seed={seed} size={92} radius={18} />
          </div>
          {badge && (
            <div className="absolute -bottom-1.5 -right-2 rounded-full ring-[3px] ring-white/90 transition-transform duration-300 ease-out group-hover:scale-[1.04]">
              {badge}
            </div>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <p className="m-0 mb-1 flex items-center gap-1.5 text-[10.5px] font-bold uppercase tracking-[0.16em]" style={{ color: t.ink }}>
            {eyebrow}
          </p>
          <p className="m-0 font-display text-[22px] font-bold leading-tight text-[#1c1917] truncate">{title}</p>
          {children}
        </div>

        <div className="flex shrink-0 items-center gap-3">
          <span
            className="hidden sm:block text-[13.5px] font-bold transition-transform duration-300 group-hover:-translate-x-0.5"
            style={{ color: t.ink }}
          >
            {action}
          </span>
          <span className="relative flex items-center justify-center" style={{ width: RING, height: RING }}>
            {progress != null && (
              <svg width={RING} height={RING} className="absolute inset-0 -rotate-90" aria-hidden>
                <circle cx={RING / 2} cy={RING / 2} r={r} fill="none" stroke={t.ring} strokeWidth={RING_STROKE} />
                <circle
                  cx={RING / 2}
                  cy={RING / 2}
                  r={r}
                  fill="none"
                  stroke={t.ink}
                  strokeWidth={RING_STROKE}
                  strokeLinecap="round"
                  strokeDasharray={circumference}
                  strokeDashoffset={circumference * (1 - Math.min(100, Math.max(0, progress)) / 100)}
                  className="transition-[stroke-dashoffset] duration-700 ease-out"
                />
              </svg>
            )}
            <span
              className="flex h-11 w-11 items-center justify-center rounded-full text-white shadow-[0_8px_18px_-8px_rgba(0,0,0,0.45)] transition-transform duration-300 ease-out group-hover:scale-[1.05]"
              style={{ background: t.ink }}
            >
              <ArrowRight size={18} className="transition-transform duration-300 group-hover:translate-x-0.5" />
            </span>
          </span>
        </div>
      </div>
    </button>
  )
}
