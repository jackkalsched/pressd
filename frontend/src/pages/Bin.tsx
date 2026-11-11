// One bin — the Apple Music 100 Best Albums, say. Mobile's app/bins/[slug].tsx
// laid out wide, as the album pages are: a sticky column with the bin's cover,
// title, source and your progress, and its records filling the rest, in the
// order the Sort by menu picks (shared/src/binSort.ts). Each record shows your
// score or where it sits in your library, or Rate / Add.
//
// A record opens as your copy when you have one (any edition), otherwise as
// its community page by name, which handles a record nobody has rated yet.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, ArrowUpDown, Check, ChevronDown } from 'lucide-react'
import { addBinEntry, fetchBin } from '../api'
import type { BinEntry } from '../api'
import { BIN_SORT_DIR, binSortLabel, sortBinEntries, type BinSort, type BinSortDir } from '@pressd/shared/binSort'
import { songScoreColor } from '../types'
import CoverImg from '../components/CoverImg'
import VinylSpinner from '../components/VinylSpinner'
import { BinMosaic, BinProgressBar } from '../components/BinCard'
import { useUser } from '../context/UserContext'

const STATUS_LABEL: Record<string, string> = { listening: 'Listening', to_listen: 'To Listen' }
const SORTS: BinSort[] = ['list', 'pressd', 'yours', 'unrated']

/** When the order changes, each row slides from where it was to where it now
 *  is (FLIP: measure, reorder, play the difference back). Positions are taken
 *  against the list itself, so scrolling between two sorts doesn't count as
 *  movement. Nothing moves under prefers-reduced-motion. */
function useSlideRows(order: string) {
  const list = useRef<HTMLOListElement>(null)
  const last = useRef(new Map<string, DOMRect>())
  useLayoutEffect(() => {
    const ol = list.current
    if (!ol) return
    const base = ol.getBoundingClientRect()
    const now = new Map<string, DOMRect>()
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    for (const li of Array.from(ol.children) as HTMLElement[]) {
      const id = li.dataset.id
      if (!id) continue
      const r = li.getBoundingClientRect()
      const rel = new DOMRect(r.left - base.left, r.top - base.top, r.width, r.height)
      now.set(id, rel)
      const was = last.current.get(id)
      if (!was || still) continue
      const dx = was.left - rel.left, dy = was.top - rel.top
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue
      li.animate(
        [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }],
        { duration: 520, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' },
      )
    }
    last.current = now
  }, [order])
  return list
}

/** "1998 · Pop" */
function details(e: BinEntry): string {
  return [e.year, e.genre].filter(Boolean).join(' · ')
}

function entryHref(e: BinEntry): string {
  if (e.mine) return `/album/${e.mine.id}`
  const p = new URLSearchParams({ name: e.albumName, artist: e.artist })
  if (e.deezerId) p.set('deezer', String(e.deezerId))
  return `/album/community?${p}`
}

export default function Bin() {
  const { slug = '' } = useParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { activeUser } = useUser()
  const [sort, setSort] = useState<BinSort>('list')
  const [dir, setDir] = useState<BinSortDir>('asc')
  const [sortOpen, setSortOpen] = useState(false)
  const sortMenu = useRef<HTMLDivElement>(null)
  const [busy, setBusy] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  const { data, isLoading, isError } = useQuery({
    queryKey: ['bin', slug, activeUser?.id],
    queryFn: () => fetchBin(slug),
    enabled: !!activeUser && !!slug,
  })

  const rows = useMemo(() => {
    const es = data?.entries ?? []
    return sortBinEntries(es, sort, dir)
  }, [data, sort, dir])
  const listRef = useSlideRows(rows.map((e) => e.id).join(','))
  // The prediction that orders the unrated half of "Not yet rated".
  const showPredicted = (e: BinEntry) => sort === 'unrated' && e.mine?.status !== 'rated' && e.predictedScore != null

  // The menu closes on an outside click or Escape.
  useEffect(() => {
    if (!sortOpen) return
    const down = (ev: MouseEvent) => { if (!sortMenu.current?.contains(ev.target as Node)) setSortOpen(false) }
    const key = (ev: KeyboardEvent) => { if (ev.key === 'Escape') setSortOpen(false) }
    document.addEventListener('mousedown', down)
    document.addEventListener('keydown', key)
    return () => { document.removeEventListener('mousedown', down); document.removeEventListener('keydown', key) }
  }, [sortOpen])

  function pickSort(k: BinSort) {
    setSort(k)
    setDir(BIN_SORT_DIR[k])
    setSortOpen(false)
  }

  function refresh() {
    queryClient.invalidateQueries({ queryKey: ['bin', slug] })
    queryClient.invalidateQueries({ queryKey: ['bins'] })
    queryClient.invalidateQueries({ queryKey: ['albums'] })
  }

  async function add(e: BinEntry, status: 'listening' | 'to_listen') {
    if (busy != null) return
    setBusy(e.id)
    setError(null)
    try {
      const r = await addBinEntry(slug, e.id, status)
      refresh()
      if (status === 'listening') navigate(`/rate/${r.albumId}`)
    } catch {
      setError('Couldn’t add that record. Try again in a moment.')
    } finally {
      setBusy(null)
    }
  }

  if (isLoading) return <div className="flex min-h-[60vh] items-center justify-center"><VinylSpinner size={64} /></div>
  if (isError || !data) {
    return <p className="px-6 md:px-12 py-16 text-[14px] text-(--c-57534e)">Couldn’t load this bin.</p>
  }


  return (
    <div className="mx-auto w-full max-w-[1600px] px-6 md:px-12 py-8 pb-24">
      <button
        onClick={() => (window.history.length > 1 ? navigate(-1) : navigate('/bins'))}
        className="mb-6 inline-flex items-center gap-1.5 text-[13px] font-semibold text-(--c-57534e) hover:text-(--c-1c1917)"
      >
        <ArrowLeft size={16} /> Back
      </button>
      <div className="flex flex-col gap-10 lg:flex-row lg:items-start">
        {/* The bin, pinned while its records scroll. */}
        <aside className="lg:sticky lg:top-8 lg:w-[340px] shrink-0">
          <BinMosaic covers={data.covers} size={240} />
          <h1 className="m-0 mt-6 font-display text-[34px] leading-[1.1] font-bold text-(--c-1c1917)">{data.title}</h1>
          {data.sourceName && (
            data.sourceUrl ? (
              <a href={data.sourceUrl} target="_blank" rel="noreferrer" className="mt-2 inline-block text-[14px] font-semibold text-(--c-2d6a4f) hover:underline">
                {data.sourceName}{data.sourceYear ? ` · ${data.sourceYear}` : ''}
              </a>
            ) : (
              <p className="m-0 mt-2 text-[14px] font-semibold text-(--c-57534e)">{data.sourceName}</p>
            )
          )}
          <div className="mt-6 flex"><BinProgressBar done={data.progress.rated} total={data.progress.total} /></div>
          <p className="m-0 mt-2.5 text-[13px] font-medium text-(--c-57534e)">
            <span className="font-bold text-(--c-1c1917)">{data.progress.rated}</span> of {data.progress.total} rated
          </p>
          {error && <p className="m-0 mt-3 text-[13px] text-(--c-b91c1c)">{error}</p>}
        </aside>

        <section className="min-w-0 flex-1">
          <div ref={sortMenu} className="relative mb-5 inline-block">
            <button
              onClick={() => setSortOpen((v) => !v)}
              aria-haspopup="menu"
              aria-expanded={sortOpen}
              className="inline-flex items-center gap-2 rounded-full border border-(--c-e2dbd0) px-4 py-2 text-[13px] font-medium text-(--c-57534e) hover:border-(--c-2d6a4f)"
            >
              <ArrowUpDown size={14} className="text-(--c-2d6a4f)" />
              Sort by <span className="font-bold text-(--c-2d6a4f)">{binSortLabel(sort, data.sourceName)}</span>
              <span>· {dir === 'asc' ? 'Ascending' : 'Descending'}</span>
              <ChevronDown size={14} />
            </button>
            {sortOpen && (
              <div role="menu" className="menu-in absolute left-0 top-full z-20 mt-1.5 w-60 overflow-hidden rounded-xl border border-(--c-e2dbd0) bg-(--c-fff) py-1 shadow-lg" style={{ transformOrigin: 'top left' }}>
                {SORTS.map((k) => (
                  <MenuRow key={k} on={sort === k} onClick={() => pickSort(k)}>{binSortLabel(k, data.sourceName)}</MenuRow>
                ))}
                <div className="my-1 border-t border-(--c-e8e2d9)" />
                <MenuRow on={dir === 'asc'} onClick={() => { setDir('asc'); setSortOpen(false) }}>Ascending</MenuRow>
                <MenuRow on={dir === 'desc'} onClick={() => { setDir('desc'); setSortOpen(false) }}>Descending</MenuRow>
              </div>
            )}
          </div>
          <ol ref={listRef} className="m-0 grid list-none gap-x-10 p-0 2xl:grid-cols-2">
            {rows.map((e) => (
              <li key={e.id} data-id={e.id} className="flex items-center gap-5 border-b border-(--c-e8e2d9) bg-(--c-f9f8f6) py-3.5">
                {data.ranked && (
                  <span className="w-11 shrink-0 text-right font-display text-[26px] font-bold tabular-nums text-(--c-1c1917)">{e.rank ?? e.position + 1}</span>
                )}
                <Link to={entryHref(e)} className="flex min-w-0 flex-1 items-center gap-4 group">
                  {e.coverUrl ? (
                    <CoverImg url={e.coverUrl} displayPx={80} alt="" className="h-20 w-20 shrink-0 rounded-[10px] object-cover" />
                  ) : (
                    <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-[10px] bg-(--c-efe9e0) font-display text-2xl text-(--c-78716c)">
                      {e.albumName[0]?.toUpperCase()}
                    </div>
                  )}
                  <div className="min-w-0">
                    <p className="m-0 truncate text-[16px] font-semibold text-(--c-1c1917) group-hover:underline">{e.albumName}</p>
                    <p className="m-0 mt-0.5 truncate text-[14px] text-(--c-57534e)">{e.artist}</p>
                    {details(e) && <p className="m-0 mt-1 truncate text-[12.5px] text-(--c-8a7f72)">{details(e)}</p>}
                  </div>
                </Link>
                <div className="hidden sm:flex shrink-0 items-center gap-5 text-[10.5px] font-semibold tracking-[0.08em] text-(--c-a8998a)">
                  {showPredicted(e) && e.predictedScore != null && (
                    <span>PREDICTED <span className="font-display text-[16px] tracking-normal" style={{ color: songScoreColor(e.predictedScore) }}>{e.predictedScore.toFixed(2)}</span></span>
                  )}
                  {e.pressdAvg != null && (
                    <span title={`${e.pressdRaters} ${e.pressdRaters === 1 ? 'rating' : 'ratings'}`}>
                      PRESSD <span className="font-display text-[16px] tracking-normal" style={{ color: songScoreColor(e.pressdAvg) }}>{e.pressdAvg.toFixed(2)}</span>
                    </span>
                  )}
                </div>
                <div className="flex w-[124px] shrink-0 justify-end">
                  {e.mine?.status === 'rated' && e.mine.score != null ? (
                    <span className="font-display text-[24px] font-bold tabular-nums" style={{ color: songScoreColor(e.mine.score) }}>{e.mine.score.toFixed(2)}</span>
                  ) : e.mine ? (
                    <span className="inline-flex items-center gap-1 text-[12px] font-semibold text-(--c-57534e)">
                      <Check size={13} /> {STATUS_LABEL[e.mine.status] ?? 'Rated'}
                    </span>
                  ) : e.addable ? (
                    busy === e.id ? <VinylSpinner size={22} /> : (
                      <div className="flex gap-1.5">
                        <button
                          onClick={() => add(e, 'listening')}
                          className="rounded-full bg-(--c-green-fill) hover:bg-(--c-green-fill-hover) px-3 py-1.5 text-[12px] font-bold text-white"
                        >
                          Rate
                        </button>
                        <button
                          onClick={() => add(e, 'to_listen')}
                          className="rounded-full border border-(--c-e2dbd0) px-3 py-1.5 text-[12px] font-bold text-(--c-1c1917) hover:border-(--c-2d6a4f)"
                        >
                          Add
                        </button>
                      </div>
                    )
                  ) : null}
                </div>
              </li>
            ))}
          </ol>
        </section>
      </div>
    </div>
  )
}

function MenuRow({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      role="menuitemradio"
      aria-checked={on}
      onClick={onClick}
      className={`flex w-full items-center justify-between px-3.5 py-2.5 text-left text-[14px] hover:bg-(--c-efe9e0) ${on ? 'font-semibold text-(--c-2d6a4f)' : 'text-(--c-1c1917)'}`}
    >
      {children}
      {on && <Check size={15} />}
    </button>
  )
}
