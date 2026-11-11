// A bin as a card — For You's Bins section and the Bins page. Its cover is a
// 2×2 of the bin's first four records, never the source's artwork; then the
// title, the source, and how far through it you are. Mobile's
// components/BinCard.tsx, laid out for a wider screen.
import { Link } from 'react-router-dom'
import type { BinCard as Bin } from '../api'
import CoverImg from './CoverImg'

export function BinMosaic({ covers, size }: { covers: string[]; size: number }) {
  const cell = size / 2
  return (
    <div className="grid grid-cols-2 overflow-hidden rounded-[14px] shrink-0" style={{ width: size, height: size }}>
      {[0, 1, 2, 3].map((i) =>
        covers[i] ? (
          <CoverImg key={i} url={covers[i]} displayPx={Math.ceil(cell)} alt="" className="block h-full w-full object-cover" />
        ) : (
          <div key={i} className="bg-(--c-efe9e0)" />
        ),
      )}
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
      <BinMosaic covers={bin.covers} size={size} />
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
