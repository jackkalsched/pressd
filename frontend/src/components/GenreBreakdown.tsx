// One ranked breakdown on Stats — genres or subgenres — each row a link to the
// board of records behind it (pages/TagBoard.tsx).
//
// The web counterpart of mobile's TagBars (components/StatsView.tsx), with one
// more axis: a desktop panel has room for the average beside the count, so it
// can be ranked either way. Most rated says what you listen to; highest rated
// says what you love, and the two orders rarely agree.
//
// A handful of rows reads the shape of someone's taste; the rest is a long
// tail (75 subgenres against 11 genres on a real library), so the panel opens
// up rather than starting at full length.
import { useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { Link } from 'react-router-dom'
import { ChevronDown, ChevronUp } from 'lucide-react'
import type { GenreStat } from '../api'
import { songScoreColor } from '../types'

const PREVIEW = 8
// Below this many records an average says more about one album than about the
// tag, so highest-rated ranks those after everything with a real sample.
const MIN_FOR_AVG = 3

type Sort = 'count' | 'avg'

/** The --i a staggered animation (rise-in, grow-x in index.css) reads. */
function stagger(i: number): CSSProperties {
  return { '--i': i } as CSSProperties
}

export default function GenreBreakdown({
  title,
  kind,
  rows,
  userId,
  ownerName,
}: {
  title: string
  kind: 'genre' | 'subgenre'
  rows: GenreStat[]
  userId: number
  /** Whose stats these are, when not the reader's own — carried to the board
   *  so a friend's records aren't headed "Your top records". */
  ownerName?: string
}) {
  const [sort, setSort] = useState<Sort>('count')
  const [open, setOpen] = useState(false)

  const ranked = useMemo(() => {
    const list = [...rows]
    if (sort === 'count') {
      list.sort((a, b) => b.count - a.count || b.avg_score - a.avg_score)
    } else {
      list.sort((a, b) => {
        const thinA = a.count < MIN_FOR_AVG
        const thinB = b.count < MIN_FOR_AVG
        if (thinA !== thinB) return thinA ? 1 : -1
        return b.avg_score - a.avg_score || b.count - a.count
      })
    }
    return list
  }, [rows, sort])

  // Re-sorting glides each row from where it was to where it now ranks (FLIP):
  // measure every row after the new order paints, offset it back to its old
  // position, then let it transition home. A list that jumps loses the reader's
  // place; one that moves shows them where their genre went.
  const rowRefs = useRef(new Map<string, HTMLLIElement>())
  const lastTops = useRef(new Map<string, number>())
  const lastSort = useRef(sort)
  useLayoutEffect(() => {
    // offsetTop is layout position, which a transform doesn't move — so a row
    // caught mid-glide still records where it really sits.
    const tops = new Map<string, number>()
    rowRefs.current.forEach((el, key) => tops.set(key, el.offsetTop))
    // Only a new order animates; opening "See all" just extends the list.
    const resorted = lastSort.current !== sort
    lastSort.current = sort
    if (resorted && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      rowRefs.current.forEach((el, key) => {
        const before = lastTops.current.get(key)
        const top = tops.get(key)
        if (before == null || top == null || before === top) return
        el.style.transition = 'none'
        el.style.transform = `translateY(${before - top}px)`
        requestAnimationFrame(() => {
          el.style.transition = 'transform 420ms cubic-bezier(0.33, 1, 0.68, 1)'
          el.style.transform = ''
        })
      })
    }
    lastTops.current = tops
  })

  if (ranked.length === 0) return null

  const shown = open ? ranked : ranked.slice(0, PREVIEW)
  // Scaled to the largest row showing, so a collapsed panel uses its width.
  const maxCount = Math.max(1, ...shown.map((g) => g.count))

  function href(tag: string) {
    const q = new URLSearchParams({ user: String(userId) })
    if (ownerName) q.set('owner', ownerName)
    return `/stats/${kind}/${encodeURIComponent(tag)}?${q.toString()}`
  }

  return (
    <div className="border border-[#e8e2d9] rounded-2xl p-6">
      <div className="flex items-center justify-between gap-3 mb-4">
        <h2 className="text-sm font-semibold text-[#78716c] m-0">{title}</h2>
        <div className="flex items-center rounded-lg bg-[#efebe5] p-0.5 shrink-0">
          {([['count', 'Most rated'], ['avg', 'Highest rated']] as const).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setSort(key)}
              className={`text-[11.5px] font-medium px-2.5 py-1 rounded-md transition-colors ${
                sort === key ? 'bg-white text-[#1c1917] shadow-sm' : 'text-[#8a7f72] hover:text-[#1c1917]'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <ol className="m-0 p-0 list-none">
        {shown.map((g, i) => {
          const thin = sort === 'avg' && g.count < MIN_FOR_AVG
          return (
            <li
              key={g.genre}
              ref={(el) => { if (el) rowRefs.current.set(g.genre, el); else rowRefs.current.delete(g.genre) }}
              // Rows added by "See all" rise in; the first screenful is there
              // with the page.
              className={i >= PREVIEW ? 'rise-in' : undefined}
              style={stagger(Math.max(0, i - PREVIEW))}
            >
              <Link
                to={href(g.genre)}
                className="group grid grid-cols-[22px_minmax(0,1fr)_40px_44px] items-center gap-3 px-1.5 -mx-1.5 py-2 rounded-lg hover:bg-[#f2f0ec] transition-colors"
              >
                <span className="text-[11.5px] text-[#b5aa9c] tabular-nums text-right">{i + 1}</span>
                <div className="min-w-0">
                  <p className={`m-0 text-[13.5px] truncate group-hover:text-[#2d6a4f] transition-colors ${thin ? 'text-[#a8998a]' : 'text-[#1c1917] font-medium'}`}>
                    {g.genre}
                  </p>
                  <div className="mt-1 h-[5px] rounded-full bg-[#ece6dc] overflow-hidden">
                    <div
                      className="grow-x h-full rounded-full transition-[width,background-color] duration-500"
                      style={{
                        ...stagger(i),
                        ...(sort === 'count'
                          ? { width: `${(g.count / maxCount) * 100}%`, background: '#2d6a4f', opacity: 0.8 }
                          : { width: `${g.avg_score * 10}%`, background: songScoreColor(g.avg_score) }),
                      }}
                    />
                  </div>
                </div>
                <span className="text-[12px] text-[#8a7f72] tabular-nums text-right" title={`${g.count} rated`}>
                  {g.count}
                </span>
                <span
                  className="font-display text-[15px] font-bold tabular-nums text-right"
                  style={{ color: songScoreColor(g.avg_score) }}
                  title="Average album score"
                >
                  {g.avg_score.toFixed(2)}
                </span>
              </Link>
            </li>
          )
        })}
      </ol>

      {ranked.length > PREVIEW && (
        <div className="flex justify-end mt-3 pt-3 border-t border-[#f0ebe3]">
          <button
            onClick={() => setOpen((v) => !v)}
            className="flex items-center gap-1 text-[12px] font-semibold text-[#2d6a4f] hover:text-[#245c43] transition-colors"
          >
            {open ? 'Show less' : `See all ${ranked.length}`}
            {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
        </div>
      )}
    </div>
  )
}
