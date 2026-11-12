// Upcoming releases — the web port of mobile/app/upcoming.tsx, from the sidebar
// and the arrow beside For You's New & Popular. Notable records only
// (Wikipedia's album lists, or an album / EP by an artist with 500,000+ Last.fm
// listeners: backend/upcoming_releases.py), albums and EPs, out to the list's
// 180 days, from GET /discover/upcoming.
//
// A month at a time, drawn as a wall calendar: a day with releases shows the
// cover of its biggest one (by the artist's Last.fm listeners), its date in the
// corner and "+N" for the rest. Clicking it scrolls to that day in the list,
// which runs through the month's release days, each day's records biggest
// first. Laid out wide: the calendar pinned on the left, the list beside it.
// A record opens its community page by name and artist (Deezer's id when the
// list has one), carrying the release date and cover: there's nothing to rate
// yet, but it can go on To Listen.
import { useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { fetchUpcomingReleases, type UpcomingRelease } from '../api'
import { useUser } from '../context/UserContext'
import CoverImg from '../components/CoverImg'
import { Cover } from '../components/covers'
import VinylSpinner from '../components/VinylSpinner'
import { stagger } from '../lib/format'
import { localDay, untilText, upcomingAlbumPath } from '../lib/upcoming'

const DAYS_AHEAD = 180
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

const monthKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
const MONTH_HEAD = new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' })
const DAY_HEAD = new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric' })

/** Biggest first within a day: the artist's Last.fm listeners. */
const byListeners = (a: UpcomingRelease, b: UpcomingRelease) =>
  (b.artistListeners ?? 0) - (a.artistListeners ?? 0) || a.artist.localeCompare(b.artist)

type Day = { date: string; releases: UpcomingRelease[] }

export default function Upcoming() {
  const { activeUser } = useUser()
  const dayRefs = useRef<Record<string, HTMLElement | null>>({})

  const { data, isLoading, isError } = useQuery({
    queryKey: ['upcoming', activeUser?.id],
    queryFn: () => fetchUpcomingReleases({ days: DAYS_AHEAD, types: ['album', 'ep'], notable: true, limit: 2000 }),
    enabled: !!activeUser,
    staleTime: 30 * 60_000,
  })

  // Release days by month, each day's records biggest first.
  const months = useMemo(() => {
    const out = new Map<string, Day[]>()
    for (const r of data?.releases ?? []) {
      const k = monthKey(localDay(r.releaseDate))
      const days = out.get(k) ?? []
      let d = days[days.length - 1]
      if (!d || d.date !== r.releaseDate) {
        d = { date: r.releaseDate, releases: [] }
        days.push(d)
      }
      d.releases.push(r)
      out.set(k, days)
    }
    for (const days of out.values()) for (const d of days) d.releases.sort(byListeners)
    return out
  }, [data])
  const monthKeys = useMemo(() => [...months.keys()].sort(), [months])
  const [monthIdx, setMonthIdx] = useState(0)
  const idx = Math.min(monthIdx, Math.max(monthKeys.length - 1, 0))
  const current = monthKeys[idx]
  const days = useMemo(() => (current && months.get(current)) || [], [months, current])
  const byDate = useMemo(() => new Map(days.map((d) => [d.date, d])), [days])
  const count = days.reduce((n, d) => n + d.releases.length, 0)

  function jumpTo(date: string) {
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    dayRefs.current[date]?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' })
  }

  const heading = <h1 className="m-0 font-display text-4xl font-bold text-(--c-1c1917)">Upcoming</h1>

  if (isLoading || isError || monthKeys.length === 0) {
    return (
      <div className="mx-auto w-full max-w-[1600px] px-6 md:px-12 py-8 pb-24">
        {heading}
        {isLoading ? (
          <div className="flex justify-center py-24"><VinylSpinner size={64} /></div>
        ) : (
          <p className="mt-10 text-[14px] text-(--c-57534e)">
            {isError ? 'Couldn’t load upcoming releases.' : 'No upcoming releases yet.'}
          </p>
        )}
      </div>
    )
  }

  // The grid: blanks before the 1st, then every day of the month.
  const first = localDay(`${current}-01`)
  const daysInMonth = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate()
  const cells: (number | null)[] = [
    ...Array.from({ length: first.getDay() }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ]
  const atFirst = idx <= 0
  const atLast = idx >= monthKeys.length - 1
  const step = (n: number) => setMonthIdx(Math.max(0, Math.min(monthKeys.length - 1, idx + n)))

  return (
    <div className="mx-auto w-full max-w-[1600px] px-6 md:px-12 py-8 pb-24">
      {heading}

      <div className="mt-8 grid gap-10 lg:grid-cols-[minmax(0,520px)_minmax(0,1fr)] xl:grid-cols-[minmax(0,600px)_minmax(0,1fr)] xl:gap-16">
        {/* ── The month, as a wall calendar ─────────────────────────── */}
        <section className="lg:sticky lg:top-8 lg:self-start">
          <div className="mb-4 flex items-center justify-between">
            <button
              onClick={() => step(-1)}
              disabled={atFirst}
              aria-label="Previous month"
              className="flex h-9 w-9 items-center justify-center rounded-full text-(--c-1c1917) hover:bg-(--c-efebe5) disabled:text-(--c-d7cfc3) disabled:hover:bg-transparent"
            >
              <ChevronLeft size={20} />
            </button>
            <h2 key={current} className="m-0 text-[13px] font-semibold tracking-[0.08em] text-(--c-1c1917) tabular-nums fade-in">
              {MONTH_HEAD.format(first).toUpperCase()}
            </h2>
            <button
              onClick={() => step(1)}
              disabled={atLast}
              aria-label="Next month"
              className="flex h-9 w-9 items-center justify-center rounded-full text-(--c-1c1917) hover:bg-(--c-efebe5) disabled:text-(--c-d7cfc3) disabled:hover:bg-transparent"
            >
              <ChevronRight size={20} />
            </button>
          </div>

          <div className="grid grid-cols-7 gap-1.5">
            {WEEKDAYS.map((w) => (
              <p key={w} className="m-0 pb-1.5 text-center text-[11.5px] font-semibold text-(--c-8a7f72)">{w}</p>
            ))}
            {cells.map((n, i) => {
              if (n == null) return <div key={`b${i}`} className="aspect-square" />
              const iso = `${current}-${String(n).padStart(2, '0')}`
              const d = byDate.get(iso)
              if (!d) {
                return (
                  <div key={iso} className="flex aspect-square items-center justify-center text-[14px] font-medium text-(--c-b5aa9c) tabular-nums">
                    {n}
                  </div>
                )
              }
              const lead = d.releases.find((r) => r.coverUrl) ?? d.releases[0]
              const more = d.releases.length - 1
              return (
                <button
                  key={iso}
                  onClick={() => jumpTo(iso)}
                  title={`${lead.title} — ${lead.artist}${more > 0 ? ` and ${more} more` : ''}`}
                  aria-label={`${DAY_HEAD.format(localDay(iso))}: ${d.releases.length} release${d.releases.length === 1 ? '' : 's'}`}
                  className="group relative aspect-square overflow-hidden rounded-xl bg-(--c-efebe5) rise-in"
                  style={stagger(i)}
                >
                  {lead.coverUrl && (
                    <CoverImg
                      url={lead.coverUrl}
                      displayPx={88}
                      alt=""
                      className="absolute inset-0 h-full w-full object-cover transition-transform duration-[250ms] ease-out group-hover:scale-[1.04]"
                    />
                  )}
                  <span className="absolute left-1.5 top-1 text-[13px] font-bold text-white tabular-nums [text-shadow:0_1px_3px_rgba(0,0,0,0.55)]">
                    {n}
                  </span>
                  {more > 0 && (
                    <span className="absolute bottom-1 right-1 rounded-full bg-black/60 px-1.5 py-px text-[10.5px] font-bold text-white tabular-nums">
                      +{more}
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        </section>

        {/* ── The month's release days ──────────────────────────────── */}
        <section className="min-w-0">
          <p className="m-0 text-[13px] font-medium text-(--c-57534e) tabular-nums">
            {count} {count === 1 ? 'release' : 'releases'} scheduled
          </p>
          {days.map((d) => (
            <div
              key={d.date}
              ref={(el) => { dayRefs.current[d.date] = el }}
              className="scroll-mt-6"
            >
              <h3 className="m-0 pb-2 pt-6 text-[16px] font-bold text-(--c-1c1917)">{DAY_HEAD.format(localDay(d.date))}</h3>
              <div className="-mx-3 grid sm:grid-cols-2 2xl:grid-cols-3">
                {d.releases.map((r, i) => (
                  <Link
                    key={r.key}
                    to={upcomingAlbumPath(r)}
                    className="group flex min-w-0 items-center gap-3.5 rounded-2xl px-3 py-2 transition-colors hover:bg-(--c-f2eee7) rise-in"
                    style={stagger(i)}
                  >
                    <Cover artUrl={r.coverUrl} seed={r.title} size={56} radius={10} fontSize={20} />
                    <div className="min-w-0 flex-1">
                      <p className="m-0 truncate text-[14.5px] font-bold text-(--c-1c1917)">{r.title}</p>
                      <p className="m-0 mt-0.5 truncate text-[13px] text-(--c-57534e)">{r.artist}</p>
                    </div>
                    <span className="shrink-0 text-[12px] font-semibold text-(--c-8a7f72) tabular-nums">{untilText(r.releaseDate)}</span>
                  </Link>
                ))}
              </div>
            </div>
          ))}
        </section>
      </div>
    </div>
  )
}
