// The way into rating a record you haven't started (your own copy's page, beside
// its predicted score; November 2026). Prominent, and alive under the pointer:
// "Rate Now" rolls up and away as "Begin Rating" rolls in from below, the arrow
// steps forward, a soft shine sweeps across, and the button lifts. Both labels
// share one grid cell, so the button never changes width mid-roll. Under reduced
// motion the labels cross-fade and nothing travels.
import { ArrowRight } from 'lucide-react'

const ROLL = 'transition-[transform,opacity] duration-[520ms] ease-[cubic-bezier(0.2,0.9,0.2,1)] motion-reduce:transition-opacity motion-reduce:duration-200'

export default function RateNowButton({ onClick, className = '' }: { onClick: () => void; className?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Rate Now"
      className={`group/rate relative inline-flex h-14 shrink-0 items-center gap-3 overflow-hidden rounded-full bg-(--c-green-fill) pl-7 pr-6 text-[16px] font-bold text-white shadow-[0_14px_30px_-14px_rgba(45,106,79,0.75)] transition-[transform,box-shadow,background-color] duration-300 ease-out hover:-translate-y-0.5 hover:bg-(--c-green-fill-hover) hover:shadow-[0_20px_38px_-14px_rgba(45,106,79,0.85)] active:translate-y-0 active:scale-[0.97] motion-reduce:hover:translate-y-0 ${className}`}
    >
      {/* The shine: a soft band that crosses once per hover. */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-y-0 -left-1/2 w-1/2 -skew-x-12 bg-linear-to-r from-transparent via-white/25 to-transparent opacity-0 transition-[left,opacity] duration-700 ease-out group-hover/rate:left-[110%] group-hover/rate:opacity-100 motion-reduce:hidden"
      />
      <span className="relative grid overflow-hidden" aria-hidden>
        <span className={`col-start-1 row-start-1 whitespace-nowrap ${ROLL} group-hover/rate:-translate-y-[115%] group-hover/rate:opacity-0 motion-reduce:group-hover/rate:translate-y-0`}>
          Rate Now
        </span>
        <span className={`col-start-1 row-start-1 whitespace-nowrap ${ROLL} translate-y-[115%] opacity-0 group-hover/rate:translate-y-0 group-hover/rate:opacity-100 motion-reduce:translate-y-0`}>
          Begin Rating
        </span>
      </span>
      <ArrowRight size={18} strokeWidth={2.4} className="relative transition-transform duration-500 ease-[cubic-bezier(0.2,0.9,0.2,1)] group-hover/rate:translate-x-1 motion-reduce:transition-none" />
    </button>
  )
}
