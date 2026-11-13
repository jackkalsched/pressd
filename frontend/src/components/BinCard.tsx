// A bin as a card — For You's Bins section and the Bins page. Its cover is a
// 2×2 of the bin's first four records, never the source's artwork — on a bin
// Pressd made, with the full-colour Pressd mark on a cream chip in its
// lower-right corner — then the title, the source, and how far through it you
// are. Mobile's
// components/BinCard.tsx, laid out for a wider screen.
import { Link } from 'react-router-dom'
import type { BinCard as Bin } from '../api'
import CoverImg from './CoverImg'
import PressdBinBadge from './PressdBinBadge'

/** The 2×2 of a bin's first four covers. `pressd` adds the official chip: the
 *  full-colour Pressd mark on cream in the lower-right corner. */
export function BinMosaic({ covers, size, pressd = false }: { covers: string[]; size: number; pressd?: boolean }) {
  const cell = size / 2
  const chip = Math.max(32, size * 0.38)
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <div className="grid h-full w-full grid-cols-2 overflow-hidden rounded-[14px]">
        {[0, 1, 2, 3].map((i) =>
          covers[i] ? (
            <CoverImg key={i} url={covers[i]} displayPx={Math.ceil(cell)} alt="" className="block h-full w-full object-cover" />
          ) : (
            <div key={i} className="bg-(--c-efe9e0)" />
          ),
        )}
      </div>
      {pressd && <PressdBinBadge width={chip} className="absolute bottom-1 right-1" />}
    </div>
  )
}

export function BinProgressBar({ done, total }: { done: number; total: number }) {
  const pct = total ? Math.min(100, (done / total) * 100) : 0
  return (
    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-(--c-efe9e0)">
      <div className="h-full rounded-full bg-(--c-2d6a4f) grow-x" style={{ width: `${pct}%` }} />
    </div>
  )
}

export default function BinCard({ bin, size = 104 }: { bin: Bin; size?: number }) {
  const done = bin.progress.rated
  return (
    <Link
      to={`/bins/${bin.slug}`}
      className="group flex items-center gap-4 rounded-2xl p-2 -m-2 hover:bg-(--c-efe9e0)/50 transition-colors"
    >
      <BinMosaic covers={bin.covers} size={size} pressd={bin.kind === 'curated'} />
      <div className="min-w-0 flex-1">
        <p className="m-0 font-display text-[20px] leading-tight font-bold text-(--c-1c1917)">{bin.title}</p>
        {bin.sourceName && (
          <p className="m-0 mt-1 text-[13px] font-medium text-(--c-57534e)">
            {bin.sourceName}{bin.sourceYear ? ` · ${bin.sourceYear}` : ''}
          </p>
        )}
        <div className="mt-3 flex items-center gap-2.5 max-w-[320px]">
          <BinProgressBar done={done} total={bin.progress.total} />
          <span className="text-[12px] font-semibold tabular-nums text-(--c-57534e)">{done} / {bin.progress.total}</span>
        </div>
      </div>
    </Link>
  )
}

/** The Bins page's card: the 2×2 of covers is the whole card, and the title,
 *  source and progress sit over its lower part on a dark fade, in white — so
 *  the covers carry the bin rather than sitting beside it. On a Pressd bin the
 *  chip rides in the top-right corner. For You keeps the compact BinCard row.
 *  Over album art, so its colours are literal in either appearance. */
export function BinPoster({ bin }: { bin: Bin }) {
  const done = bin.progress.rated
  const pct = bin.progress.total ? Math.min(100, (done / bin.progress.total) * 100) : 0
  return (
    <Link
      to={`/bins/${bin.slug}`}
      className="group relative block aspect-square overflow-hidden rounded-[22px] isolate shadow-[0_18px_40px_-26px_rgba(40,25,10,0.65)] transition-[transform,box-shadow] duration-300 ease-out hover:-translate-y-1 hover:shadow-[0_26px_50px_-26px_rgba(40,25,10,0.7)]"
    >
      <div className="absolute inset-0 -z-10 grid grid-cols-2 transition-transform duration-500 ease-out group-hover:scale-[1.03]">
        {[0, 1, 2, 3].map((i) =>
          bin.covers[i] ? (
            <CoverImg key={i} url={bin.covers[i]} displayPx={320} alt="" className="block h-full w-full object-cover" />
          ) : (
            <div key={i} className="bg-[#2a2622]" />
          ),
        )}
      </div>
      {/* The fade the words sit on: clear at the top, near-black at the foot. */}
      <div
        className="absolute inset-0 -z-10"
        style={{ background: 'linear-gradient(180deg, rgba(12,10,8,0) 30%, rgba(12,10,8,.55) 55%, rgba(12,10,8,.92) 100%)' }}
      />
      {bin.kind === 'curated' && <PressdBinBadge width={56} className="absolute top-3.5 right-3.5" />}
      <div className="absolute inset-x-0 bottom-0 p-5 sm:p-6">
        <p className="m-0 font-display text-[26px] sm:text-[28px] leading-[1.08] font-bold text-white line-clamp-3 [text-shadow:0_2px_14px_rgba(0,0,0,.45)]">{bin.title}</p>
        {bin.sourceName && (
          <p className="m-0 mt-1.5 text-[13px] font-medium text-white/75">
            {bin.sourceName}{bin.sourceYear ? ` · ${bin.sourceYear}` : ''}
          </p>
        )}
        <div className="mt-4 flex items-center gap-3">
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/20">
            <div className="h-full rounded-full bg-[#7fd1a8] grow-x" style={{ width: `${pct}%` }} />
          </div>
          <span className="text-[12.5px] font-semibold tabular-nums text-white/85">{done} / {bin.progress.total}</span>
        </div>
      </div>
    </Link>
  )
}
