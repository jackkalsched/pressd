// One bin — the Apple Music 100 Best Albums, say. Mobile's app/bins/[slug].tsx
// laid out wide. A banner across the top fans out the bin's first three
// records over a blur of the first, ending in a hard edge; below it, centred,
// the bare Pressd mark on Pressd's bins, the title and your progress (a cell per
// record, in the list's order), then its records, in the order the Sort by
// menu picks (shared/src/binSort.ts). Each row is the cover, then its words —
// title, artist, year · genre and Pressd's one-line blurb (worker/bin_blurbs.py) —
// and on the right your score or where it sits in your library, with Rate / Add.
//
// A user bin (spec 2026-11-13) reads the same, with its maker under the title,
// its description, and the owner's note where Pressd's blurb sits. Its owner
// gets Edit, which swaps the list for components/BinEditor.tsx; anyone else's
// has a "…" menu with Report.
//
// A record always opens as its Pressd page (the community view): through your
// copy's id when you have one, otherwise by name, which handles a record
// nobody has rated yet.
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, ArrowUpDown, Bookmark, Check, ChevronDown, Flag, Lock, MoreHorizontal, Pencil, Star, X } from 'lucide-react'
import { addBinEntry, fetchBin, reportBin } from '../api'
import type { BinEntry } from '../api'
import { BIN_SORT_DIR, binEntryMatches, binSortLabel, sortBinEntries, type BinSort, type BinSortDir } from '@pressd/shared/binSort'
import BinSearch from '../components/BinSearch'
import { songScoreColor } from '../types'
import CoverImg from '../components/CoverImg'
import PressdMark from '../components/PressdMark'
import VinylSpinner from '../components/VinylSpinner'
import PredictedScore from '../components/PredictedScore'
import BinProgress from '../components/BinProgress'
import BinEditor from '../components/BinEditor'
import { BIN_FIELD, DESCRIPTION_MAX, binErrorText } from '../lib/bins'
import { useSlideRows } from '../lib/useSlideRows'
import { useUser } from '../context/UserContext'

const SORTS: BinSort[] = ['list', 'pressd', 'raters', 'yours', 'unrated']

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
  // A bin made a moment ago opens in edit mode (`?edit=1`), to add albums.
  const [params, setParams] = useSearchParams()
  const editing = params.get('edit') === '1'
  const setEditing = (on: boolean) => setParams(on ? { edit: '1' } : {}, { replace: true })
  const [moreOpen, setMoreOpen] = useState(false)
  const moreMenu = useRef<HTMLDivElement>(null)
  const [reporting, setReporting] = useState(false)

  const { data, isLoading, isError } = useQuery({
    queryKey: ['bin', slug, activeUser?.id],
    queryFn: () => fetchBin(slug),
    enabled: !!activeUser && !!slug,
  })

  const [query, setQuery] = useState('')
  const [searching, setSearching] = useState(false)
  function toggleSearch(open: boolean) {
    if (!open) setQuery('')
    setSortOpen(false)
    setSearching(open)
  }
  const rows = useMemo(() => {
    const es = (data?.entries ?? []).filter((e) => binEntryMatches(e, query))
    return sortBinEntries(es, sort, dir)
  }, [data, sort, dir, query])
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

  useEffect(() => {
    if (!moreOpen) return
    const down = (ev: MouseEvent) => { if (!moreMenu.current?.contains(ev.target as Node)) setMoreOpen(false) }
    const key = (ev: KeyboardEvent) => { if (ev.key === 'Escape') setMoreOpen(false) }
    document.addEventListener('mousedown', down)
    document.addEventListener('keydown', key)
    return () => { document.removeEventListener('mousedown', down); document.removeEventListener('keydown', key) }
  }, [moreOpen])

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
    } catch (err) {
      setError(binErrorText(err, 'Couldn’t add that record. Try again in a moment.'))
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
      {/* The banner: the lead record blurred into a wash, and over it the
          first three records fanned out, the first in front. It ends in a hard
          edge (Jack's call); its colours are literal, dark in either
          appearance. */}
      <header className="relative h-[340px] overflow-hidden bg-[#171615]">
        {data.coverUrl ? (
          <img src={data.coverUrl} alt="" className="absolute inset-0 h-full w-full scale-125 object-cover blur-2xl" />
        ) : data.covers[0] && (
          <CoverImg url={data.covers[0]} displayPx={300} alt="" className="absolute inset-0 h-full w-full scale-125 object-cover blur-2xl" />
        )}
        <div className="absolute inset-0 bg-[rgba(14,12,10,0.28)]" />
        {/* The owner's own picture stands alone; otherwise the fan. */}
        {data.coverUrl ? (
          <div className="absolute inset-x-0 top-1/2 flex h-[230px] -translate-y-1/2 items-center justify-center">
            <img src={data.coverUrl} alt="" className="h-[230px] w-[230px] rounded-2xl object-cover shadow-[0_18px_40px_rgba(0,0,0,0.45)]" />
          </div>
        ) : (
        <div className="absolute inset-x-0 top-1/2 flex h-[230px] -translate-y-1/2 items-center justify-center">
          {data.covers[1] && (
            <CoverImg url={data.covers[1]} displayPx={180} alt="" className="absolute h-[180px] w-[180px] -translate-x-[150px] -rotate-[8deg] rounded-2xl object-cover shadow-[0_14px_30px_rgba(0,0,0,0.35)]" />
          )}
          {data.covers[2] && (
            <CoverImg url={data.covers[2]} displayPx={180} alt="" className="absolute h-[180px] w-[180px] translate-x-[150px] rotate-[8deg] rounded-2xl object-cover shadow-[0_14px_30px_rgba(0,0,0,0.35)]" />
          )}
          {data.covers[0] && (
            <CoverImg url={data.covers[0]} displayPx={230} alt="" className="relative h-[230px] w-[230px] rounded-2xl object-cover shadow-[0_18px_40px_rgba(0,0,0,0.45)]" />
          )}
        </div>
        )}
        <button
          onClick={() => (window.history.length > 1 ? navigate(-1) : navigate('/bins'))}
          className="absolute left-6 top-6 md:left-12 flex h-9 w-9 items-center justify-center rounded-full bg-[rgba(12,10,8,0.42)] text-[#f9f8f6] hover:bg-[rgba(12,10,8,0.6)]"
          aria-label="Back"
        >
          <ArrowLeft size={18} />
        </button>
        {/* Top right: Edit on your own bin; on someone else's, Report in a
            "…" menu. Pressd's bins have neither. */}
        <div className="absolute right-6 top-6 md:right-12 flex items-center gap-2">
          {data.canEdit && !editing && (
            <button
              onClick={() => setEditing(true)}
              className="flex h-9 items-center gap-1.5 rounded-full bg-[rgba(12,10,8,0.42)] px-4 text-[13.5px] font-semibold text-[#f9f8f6] hover:bg-[rgba(12,10,8,0.6)]"
            >
              <Pencil size={14} /> Edit
            </button>
          )}
          {data.kind === 'user' && !data.canEdit && (
            <div ref={moreMenu} className="relative">
              <button
                onClick={() => setMoreOpen((v) => !v)}
                aria-haspopup="menu"
                aria-expanded={moreOpen}
                aria-label="More"
                className="flex h-9 w-9 items-center justify-center rounded-full bg-[rgba(12,10,8,0.42)] text-[#f9f8f6] hover:bg-[rgba(12,10,8,0.6)]"
              >
                <MoreHorizontal size={18} />
              </button>
              {moreOpen && (
                <div role="menu" className="menu-in absolute right-0 top-full z-20 mt-1.5 w-48 overflow-hidden rounded-xl border border-(--c-e2dbd0) bg-(--c-fff) py-1 shadow-lg" style={{ transformOrigin: 'top right' }}>
                  <button
                    role="menuitem"
                    onClick={() => { setMoreOpen(false); setReporting(true) }}
                    className="flex w-full items-center gap-2 px-3.5 py-2.5 text-left text-[14px] text-(--c-b91c1c) hover:bg-(--c-efe9e0)"
                  >
                    <Flag size={14} /> Report bin
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </header>

      <div className="mx-auto w-full max-w-[1600px] px-6 md:px-12 pt-8">
        {/* Centred under the fan: the bare Pressd mark, the title, your progress. */}
        <div className="mx-auto mb-10 flex max-w-3xl flex-col items-center text-center">
          {data.kind === 'curated' && <span className="mb-1" title="A Pressd bin"><PressdMark size={48} /></span>}
          <h1 className="m-0 font-title text-[40px] md:text-[52px] leading-[1.05] font-black text-(--c-1c1917)">{data.title}</h1>
          {data.kind === 'user' && (
            <p className="m-0 mt-3 flex items-center gap-2 text-[14px] text-(--c-57534e)">
              {data.owner ? (
                <span>by <Link to={`/u/${data.owner.id}`} className="font-semibold text-(--c-1c1917) hover:underline">{data.owner.name}</Link></span>
              ) : (
                <span>by a former Pressd member</span>
              )}
              {data.visibility === 'private' && (
                <span className="inline-flex items-center gap-1 rounded-full bg-(--c-efe9e0) px-2.5 py-0.5 text-[12px] font-semibold text-(--c-57534e)">
                  <Lock size={11} strokeWidth={2.4} /> Private
                </span>
              )}
            </p>
          )}
          {data.kind === 'user' && data.description && !editing && (
            <p className="m-0 mt-4 max-w-[62ch] whitespace-pre-line text-[15px] leading-relaxed text-(--c-57534e)">{data.description}</p>
          )}
          {data.entries.length > 0 && !editing && (
            <div className="mt-7 w-full text-left">
              <BinProgress entries={data.entries} />
            </div>
          )}
          {error && <p className="m-0 mt-3 text-[13px] text-(--c-b91c1c)">{error}</p>}
        </div>
      {editing && data.canEdit ? (
        <BinEditor bin={data} onDone={() => setEditing(false)} />
      ) : (
      <div className="flex flex-col">
        <section className="min-w-0 flex-1">
          {data.entries.length === 0 && (
            <p className="m-0 py-10 text-center text-[14px] text-(--c-57534e)">No albums in this bin yet.</p>
          )}
          {/* Searching squeezes the sort down to its icon, and that icon folds
              search away again: the sort's words collapse while the field
              grows across the row, both on width transitions. */}
          <div className="mb-5 flex w-full items-center gap-3">
          <div ref={sortMenu} className="relative shrink-0">
            <button
              onClick={() => (searching ? toggleSearch(false) : setSortOpen((v) => !v))}
              aria-haspopup={searching ? undefined : 'menu'}
              aria-expanded={searching ? undefined : sortOpen}
              aria-label={searching ? 'Close search' : undefined}
              className="inline-flex h-9 items-center rounded-full border border-(--c-e2dbd0) px-[10px] text-[13px] font-medium text-(--c-57534e) hover:border-(--c-2d6a4f)"
            >
              <ArrowUpDown size={14} className="shrink-0 text-(--c-2d6a4f)" />
              <span
                className={`flex items-center gap-2 overflow-hidden whitespace-nowrap transition-[max-width,opacity,padding] duration-300 ease-out motion-reduce:transition-none ${
                  searching ? 'max-w-0 pl-0 opacity-0' : 'max-w-[30rem] pl-2 pr-1 opacity-100'
                }`}
              >
                <span>Sort by <span className="font-bold text-(--c-2d6a4f)">{binSortLabel(sort, data.sourceName)}</span></span>
                <span>· {dir === 'asc' ? 'Ascending' : 'Descending'}</span>
                <ChevronDown size={14} className="shrink-0" />
              </span>
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
          <BinSearch
            value={query}
            onChange={setQuery}
            open={searching}
            onOpenChange={toggleSearch}
            placeholder={data.itemType === 'song' ? 'Search songs, artists, albums' : 'Search albums, artists'}
            className="w-[calc(100%-3rem)]"
          />
          </div>
          {rows.length === 0 && query && (
            <p className="m-0 py-10 text-[14px] text-(--c-57534e)">Nothing in this bin matches “{query.trim()}”.</p>
          )}
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

                    {/* The words on the left — title, artist, year · genre and the
                        blurb — and the numbers with Rate / Save in one group on
                        the right, sharing a bottom edge. Below sm the group drops
                        under the words, figures left and buttons right. */}
                    <div className="flex min-w-0 flex-1 flex-col gap-3.5 sm:flex-row sm:items-end sm:gap-8">
                      <Link to={entryHref(e)} className="group block min-w-0 flex-1">
                        <p className="m-0 line-clamp-2 text-[17px] font-bold leading-snug text-(--c-1c1917) group-hover:underline">{e.songTitle ?? e.albumName}</p>
                        <p className="m-0 mt-1 truncate text-[14px] text-(--c-57534e)">{e.artist}</p>
                        {details(e) && <p className="m-0 mt-0.5 truncate text-[12.5px] text-(--c-8a7f72)">{details(e)}</p>}
                        {(e.blurb ?? e.note) && <p className="m-0 mt-2.5 hidden max-w-[62ch] text-[13.5px] leading-snug text-(--c-57534e) md:line-clamp-2">{e.blurb ?? e.note}</p>}
                      </Link>

                      <div className="flex shrink-0 items-end justify-between gap-7">
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
                              {!rated && showPredicted(e) && <Figure label="PREDICTED" value={e.predictedScore!} places={places} predicted />}
                              {e.pressdAvg != null && <Figure label="PRESSD" value={e.pressdAvg} places={places} title={raters(e)} muted />}
                            </>
                          )}
                        </div>
                        {!rated && (e.addable || saved) && (
                          busy === e.id ? <VinylSpinner size={24} /> : (
                            <div className="flex gap-2">
                              <button
                                onClick={() => (e.mine ? navigate(`/rate/${e.mine.id}`) : add(e, 'listening'))}
                                className="flex h-12 w-12 items-center justify-center rounded-full border border-(--c-e2dbd0) text-(--c-1c1917) hover:border-(--c-2d6a4f) hover:text-(--c-2d6a4f)"
                                title="Rate now"
                                aria-label={`Rate ${e.songTitle ?? e.albumName} now`}
                              >
                                <Star size={22} />
                              </button>
                              <button
                                onClick={() => (e.mine ? navigate(entryHref(e)) : add(e, 'to_listen'))}
                                className={`flex h-12 w-12 items-center justify-center rounded-full border ${
                                  saved
                                    ? 'border-(--c-2d6a4f) bg-(--c-2d6a4f)/10 text-(--c-2d6a4f)'
                                    : 'border-(--c-e2dbd0) text-(--c-1c1917) hover:border-(--c-2d6a4f) hover:text-(--c-2d6a4f)'
                                }`}
                                title={saved ? 'In your library' : 'Save to your library'}
                                aria-label={saved ? `${e.albumName} is in your library` : `Save ${e.albumName} to your library`}
                              >
                                <Bookmark size={22} fill={saved ? 'currentColor' : 'none'} />
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
      )}
      </div>
      {reporting && (
        <ReportDialog
          title={data.title}
          onCancel={() => setReporting(false)}
          onReport={async (reason) => {
            await reportBin(slug, reason)
            // A bin you report leaves your lists at once (the server's rule).
            queryClient.removeQueries({ queryKey: ['bin', slug] })
            queryClient.invalidateQueries({ queryKey: ['bins'] })
            queryClient.invalidateQueries({ queryKey: ['search'] })
            navigate('/bins', { replace: true })
          }}
        />
      )}
    </div>
  )
}

function ReportDialog({ title, onCancel, onReport }: {
  title: string
  onCancel: () => void
  onReport: (reason: string) => Promise<void>
}) {
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm fade-in" onClick={busy ? undefined : onCancel} />
      <div role="dialog" aria-modal="true" aria-labelledby="report-bin-title" className="relative w-full max-w-md rounded-3xl bg-(--c-f9f8f6) p-6 shadow-xl pop-in">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 id="report-bin-title" className="m-0 font-title text-[22px] font-bold text-(--c-1c1917)">Report “{title}”?</h2>
          <button onClick={onCancel} disabled={busy} aria-label="Close" className="text-(--c-a8998a) hover:text-(--c-57534e)">
            <X size={18} />
          </button>
        </div>
        <textarea
          autoFocus
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          maxLength={DESCRIPTION_MAX}
          rows={3}
          placeholder="What’s wrong with it? (optional)"
          aria-label="Reason"
          className={`${BIN_FIELD} resize-none`}
        />
        {error && <p className="m-0 mt-3 text-[13px] text-(--c-b91c1c)">{error}</p>}
        <div className="mt-6 flex justify-end gap-2">
          <button onClick={onCancel} disabled={busy} className="h-11 rounded-full px-5 text-[14.5px] font-semibold text-(--c-78716c) hover:bg-(--c-efebe5)">
            Cancel
          </button>
          <button
            disabled={busy}
            onClick={async () => {
              setBusy(true)
              setError(null)
              try {
                await onReport(reason.trim())
              } catch (e) {
                setError(binErrorText(e, 'Couldn’t send that report'))
                setBusy(false)
              }
            }}
            className="flex h-11 items-center gap-2 rounded-full bg-(--c-b91c1c) px-6 text-[14.5px] font-semibold text-white hover:opacity-90 disabled:opacity-60"
          >
            {busy && <VinylSpinner size={17} />}
            Report
          </button>
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
 *  predicted (`predicted`, PredictedScore's fill), or (`count`) how many
 *  people rated it. `muted` is the one the
 *  order isn't about — smaller, in grey. */
function Figure({ label, value, title, muted = false, count = false, predicted = false, places = 2 }: {
  label: string
  value: number
  title?: string
  muted?: boolean
  count?: boolean
  /** An estimate: drawn by PredictedScore, never in a score's flat colour. */
  predicted?: boolean
  /** Two for an album's score, one for a song's. */
  places?: number
}) {
  return (
    <div title={title}>
      <p className="m-0 text-[11px] font-semibold tracking-[0.12em] text-(--c-a8998a)">{label}</p>
      {muted ? (
        <p className="m-0 mt-1.5 font-display text-[21px] font-bold leading-none tabular-nums text-(--c-8a7f72)">{count ? value : value.toFixed(places)}</p>
      ) : predicted ? (
        <p className="m-0 mt-1 font-display text-[30px] font-bold leading-none tabular-nums">
          <PredictedScore value={value} places={places} />
        </p>
      ) : (
        <p className="m-0 mt-1 font-display text-[30px] font-bold leading-none tabular-nums" style={{ color: count ? 'var(--c-1c1917)' : songScoreColor(value) }}>
          {count ? value : value.toFixed(places)}
        </p>
      )}
    </div>
  )
}
