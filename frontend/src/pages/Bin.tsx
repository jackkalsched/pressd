// One bin — the Apple Music 100 Best Albums, say. Mobile's app/bins/[slug].tsx
// laid out wide. A banner across the top projects the bin's 2×2 collage,
// darkened and faded into the page, with the title over it in cream — dark
// enough that the cream reads on a cream page — under the Pressd-verified
// badge on Pressd's bins. Below it, as the album pages are: a sticky column
// with the source and your progress, and its records filling the rest, in the
// order the Sort by menu picks (shared/src/binSort.ts). Each record shows your
// score or where it sits in your library, or Rate / Add.
//
// A record always opens as its Pressd page (the community view): through your
// copy's id when you have one, otherwise by name, which handles a record
// nobody has rated yet.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, ArrowUpDown, Bookmark, Check, ChevronDown, Star } from 'lucide-react'
import { addBinEntry, fetchBin } from '../api'
import type { BinEntry } from '../api'
import { BIN_SORT_DIR, binSortLabel, sortBinEntries, type BinSort, type BinSortDir } from '@pressd/shared/binSort'
import { songScoreColor } from '../types'
import CoverImg from '../components/CoverImg'
import PressdBinBadge from '../components/PressdBinBadge'
import VinylSpinner from '../components/VinylSpinner'
import { BinProgressBar } from '../components/BinCard'
import { useUser } from '../context/UserContext'

const SORTS: BinSort[] = ['list', 'pressd', 'raters', 'yours', 'unrated']

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

const raters = (e: BinEntry) => `${e.pressdRaters} ${e.pressdRaters === 1 ? 'rating' : 'ratings'}`

/** "1998 · Pop" for a record; "from Fever to Tell · 2003" for a song. */
function details(e: BinEntry): string {
  if (e.songTitle) return [e.albumName ? `from ${e.albumName}` : null, e.year].filter(Boolean).join(' · ')
  return [e.year, e.genre].filter(Boolean).join(' · ')
}

// Always the record's Pressd page — the average and everyone's ratings — never
// one person's copy, yours included: a bin is about the record.
function entryHref(e: BinEntry): string {
  // A song opens its album's page with the song highlighted, when Pressd knows
  // its track.
  const track = e.trackId != null ? `track=${e.trackId}` : ''
  if (e.mine) return `/album/${e.mine.id}/community${track ? `?${track}` : ''}`
  const p = new URLSearchParams({ name: e.albumName, artist: e.artist })
  if (e.deezerId) p.set('deezer', String(e.deezerId))
  if (e.trackId != null) p.set('track', String(e.trackId))
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
  // A song's scores are one decimal; an album's two.
  const places = data?.itemType === 'song' ? 1 : 2
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
    <div className="pb-24">
      {/* The banner: the collage across the full width, centred, held low under
          a dark wash and fading into the page at its foot. Its colours are
          literal — the banner is dark in either appearance. */}
      <header className="relative h-[340px] overflow-hidden bg-[#171615]">
        <div className="absolute inset-x-0 top-1/2 grid aspect-square -translate-y-1/2 grid-cols-2 opacity-90">
          {[0, 1, 2, 3].map((i) =>
            data.covers[i] ? (
              <CoverImg key={i} url={data.covers[i]} displayPx={1000} alt="" className="block h-full w-full object-cover" />
            ) : (
              <div key={i} />
            ),
          )}
        </div>
        <div className="absolute inset-0 bg-[rgba(14,12,10,0.6)]" />
        <div className="absolute inset-x-0 bottom-0 h-24 bg-linear-to-b from-transparent to-(--c-f9f8f6)" />
        <button
          onClick={() => (window.history.length > 1 ? navigate(-1) : navigate('/bins'))}
          className="absolute left-6 top-6 md:left-12 flex h-9 w-9 items-center justify-center rounded-full bg-[rgba(12,10,8,0.42)] text-[#f9f8f6] hover:bg-[rgba(12,10,8,0.6)]"
          aria-label="Back"
        >
          <ArrowLeft size={18} />
        </button>
        <div className="absolute inset-x-0 bottom-20">
          <div className="mx-auto w-full max-w-[1600px] px-6 md:px-12">
            {data.kind === 'curated' && <div className="mb-4"><PressdBinBadge width={72} /></div>}
            <h1 className="m-0 max-w-[900px] font-display text-[40px] md:text-[56px] leading-[1.05] font-bold text-[#f9f8f6] [text-shadow:0_2px_14px_rgba(0,0,0,0.35)]">
              {data.title}
            </h1>
          </div>
        </div>
      </header>

      <div className="mx-auto w-full max-w-[1600px] px-6 md:px-12 pt-2">
      <div className="flex flex-col gap-10 lg:flex-row lg:items-start">
        {/* The bin, pinned while its records scroll. */}
        <aside className="lg:sticky lg:top-8 lg:w-[340px] shrink-0">
          {data.sourceName && (
            <p className="m-0 text-[14px] font-semibold text-(--c-57534e)">
              {data.sourceName}{data.sourceYear ? ` · ${data.sourceYear}` : ''}
            </p>
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
          <ol ref={listRef} className="m-0 grid list-none gap-x-12 p-0 2xl:grid-cols-2">
            {rows.map((e) => {
              const rated = e.mine?.status === 'rated' && e.mine.score != null
              const saved = !!e.mine && !rated
              return (
                <li key={e.id} data-id={e.id} className="border-b border-(--c-e8e2d9)/60 bg-(--c-f9f8f6)">
                  <div className="flex items-center gap-6 py-5">
                    {/* The cover, with the list's number in its corner. */}
                    <Link to={entryHref(e)} className="relative block shrink-0">
                      {e.coverUrl ? (
                        <CoverImg url={e.coverUrl} displayPx={152} alt="" className="block h-38 w-38 rounded-xl object-cover" />
                      ) : (
                        <div className="flex h-38 w-38 items-center justify-center rounded-xl bg-(--c-efe9e0) font-display text-4xl text-(--c-78716c)">
                          {(e.songTitle ?? e.albumName)[0]?.toUpperCase()}
                        </div>
                      )}
                      {data.ranked && (
                        // Printed on the cover's lower left, white with a soft
                        // shadow so it holds on a pale cover.
                        <span className="absolute bottom-1 left-2.5 font-display text-[46px] font-black leading-none tabular-nums text-white [text-shadow:0_1px_6px_rgba(0,0,0,0.55)]">
                          {e.rank ?? e.position + 1}
                        </span>
                      )}
                    </Link>

                    <div className="min-w-0 flex-1">
                      <Link to={entryHref(e)} className="group block">
                        <p className="m-0 line-clamp-2 text-[17px] font-bold leading-snug text-(--c-1c1917) group-hover:underline">{e.songTitle ?? e.albumName}</p>
                        <p className="m-0 mt-1 truncate text-[14px] text-(--c-57534e)">{e.artist}</p>
                        {details(e) && <p className="m-0 mt-0.5 truncate text-[12.5px] text-(--c-8a7f72)">{details(e)}</p>}
                      </Link>

                      <div className="mt-3.5 flex items-end justify-between gap-4">
                        {/* Pressd's order leads with the Pressd average and greys
                            yours; every other order leads with yours. */}
                        <div className="flex items-end gap-7">
                          {sort === 'raters' ? (
                            <>
                              <Figure label="RATINGS" value={e.pressdRaters} count />
                              {e.pressdAvg != null && <Figure label="PRESSD" value={e.pressdAvg} places={places} muted />}
                              {rated && <Figure label="YOU" value={e.mine!.score!} places={places} muted />}
                            </>
                          ) : sort === 'pressd' ? (
                            <>
                              {e.pressdAvg != null && <Figure label="PRESSD" value={e.pressdAvg} places={places} title={raters(e)} />}
                              {rated && <Figure label="YOU" value={e.mine!.score!} places={places} muted />}
                            </>
                          ) : (
                            <>
                              {rated && <Figure label="YOU" value={e.mine!.score!} places={places} />}
                              {!rated && showPredicted(e) && <Figure label="PREDICTED" value={e.predictedScore!} places={places} />}
                              {e.pressdAvg != null && <Figure label="PRESSD" value={e.pressdAvg} places={places} title={raters(e)} muted />}
                            </>
                          )}
                        </div>
                        {!rated && (e.addable || saved) && (
                          busy === e.id ? <VinylSpinner size={24} /> : (
                            <div className="flex gap-2">
                              <button
                                onClick={() => (e.mine ? navigate(`/rate/${e.mine.id}`) : add(e, 'listening'))}
                                className="flex h-10 w-10 items-center justify-center rounded-full border border-(--c-e2dbd0) text-(--c-1c1917) hover:border-(--c-2d6a4f) hover:text-(--c-2d6a4f)"
                                title="Rate now"
                                aria-label={`Rate ${e.songTitle ?? e.albumName} now`}
                              >
                                <Star size={18} />
                              </button>
                              <button
                                onClick={() => (e.mine ? navigate(entryHref(e)) : add(e, 'to_listen'))}
                                className={`flex h-10 w-10 items-center justify-center rounded-full border ${
                                  saved
                                    ? 'border-(--c-2d6a4f) bg-(--c-2d6a4f)/10 text-(--c-2d6a4f)'
                                    : 'border-(--c-e2dbd0) text-(--c-1c1917) hover:border-(--c-2d6a4f) hover:text-(--c-2d6a4f)'
                                }`}
                                title={saved ? 'In your library' : 'Save to your library'}
                                aria-label={saved ? `${e.albumName} is in your library` : `Save ${e.albumName} to your library`}
                              >
                                <Bookmark size={18} fill={saved ? 'currentColor' : 'none'} />
                              </button>
                            </div>
                          )
                        )}
                      </div>
                    </div>
                  </div>
                </li>
              )
            })}
          </ol>
        </section>
      </div>
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

/** A labelled number under a record: the Pressd average, yours, your
 *  predicted, or (`count`) how many people rated it. `muted` is the one the
 *  order isn't about — smaller, in grey. */
function Figure({ label, value, title, muted = false, count = false, places = 2 }: {
  label: string
  value: number
  title?: string
  muted?: boolean
  count?: boolean
  /** Two for an album's score, one for a song's. */
  places?: number
}) {
  return (
    <div title={title}>
      <p className="m-0 text-[10px] font-semibold tracking-[0.12em] text-(--c-a8998a)">{label}</p>
      {muted ? (
        <p className="m-0 mt-1 font-display text-[15px] font-bold leading-none tabular-nums text-(--c-8a7f72)">{count ? value : value.toFixed(places)}</p>
      ) : (
        <p className="m-0 mt-0.5 font-display text-[22px] font-bold leading-none tabular-nums" style={{ color: count ? 'var(--c-1c1917)' : songScoreColor(value) }}>
          {count ? value : value.toFixed(places)}
        </p>
      )}
    </div>
  )
}
