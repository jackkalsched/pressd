// A bin's progress on its page: "22 of 100 rated" and a strip of one cell per record in the list's order — green where you've
// rated it, a pale tint where it's in your library, empty otherwise — so the
// fills sit where your records sit in the list. Fifty to a row. Mobile's
// components/BinProgress.tsx; the cells come from shared/src/binSort.ts.
import type { BinEntry } from '../api'
import { binCells } from '@pressd/shared/binSort'

const PER_ROW = 50

export default function BinProgress({ entries }: { entries: BinEntry[] }) {
  const cells = binCells(entries)
  const rated = cells.filter((c) => c === 'rated').length
  return (
    <div>
      <div className="mb-2.5 flex items-baseline justify-between">
        <p className="m-0 text-[16px] text-(--c-57534e)">
          <span className="font-bold text-(--c-1c1917)">{rated}</span> of {cells.length} rated
        </p>
      </div>
      <div className="grid gap-[3px]" style={{ gridTemplateColumns: `repeat(${PER_ROW}, minmax(0, 1fr))` }} aria-label={`${rated} of ${cells.length} rated`}>
        {cells.map((c, i) => (
          <span
            key={i}
            className={`block h-2.5 rounded-[2px] ${c === 'empty' ? 'bg-(--c-efe9e0)' : c === 'saved' ? 'bg-(--c-2d6a4f)/30' : 'bg-(--c-2d6a4f)'}`}
          />
        ))}
      </div>
    </div>
  )
}
