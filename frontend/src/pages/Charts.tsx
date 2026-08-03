// Charts — the userbase-wide board, for people who are signed in.
//
// Same ranking as PublicCharts, but this one lives inside Layout: the app's
// light shell and sidebar, and — the reason it exists as its own page — rows
// that open the album. The public board is deliberately read-only, since a
// logged-out visitor has nowhere to land.
//
// Reads /discover/charts (auth) rather than /public/charts, which is also what
// unlocks the year filter the mobile Charts tab has.
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Loader2, Triangle } from 'lucide-react'
import { fetchCharts } from '../api'
import type { ChartItem } from '../api'

const UP = '#2d6a4f'
const DOWN = '#c0392b'

/** ISO week, to date the board like a print chart ("WK 30 · 2026"). */
function weekLabel(): string {
  const d = new Date()
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
  const dayNum = (t.getUTCDay() + 6) % 7
  t.setUTCDate(t.getUTCDate() - dayNum + 3)
  const firstThursday = new Date(Date.UTC(t.getUTCFullYear(), 0, 4))
  const week =
    1 + Math.round(((t.getTime() - firstThursday.getTime()) / 86_400_000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7)
  return `WK ${week} · ${t.getUTCFullYear()}`
}

function Movement({ value }: { value: number | null }) {
  if (value === null) {
    return <span className="text-[11px] font-bold tracking-wide text-[#2d6a4f]">NEW</span>
  }
  if (value === 0) return <span className="text-[11px] font-bold text-[#ccc]">–</span>
  const up = value > 0
  return (
    <span className="inline-flex items-center gap-[3px] text-[11.5px] font-bold" style={{ color: up ? UP : DOWN }}>
      <Triangle
        size={9}
        fill={up ? UP : DOWN}
        color={up ? UP : DOWN}
        style={{ transform: up ? undefined : 'rotate(180deg)' }}
      />
      {Math.abs(value)}
    </span>
  )
}

function Cover({ url, alt, size, rounded }: { url: string | null; alt: string; size: number; rounded: string }) {
  if (!url) {
    return (
      <div
        className={`bg-[#e8e6e1] ${rounded} shrink-0`}
        style={{ width: size, height: size }}
        aria-hidden
      />
    )
  }
  return (
    <img
      src={url}
      alt={alt}
      loading="lazy"
      className={`object-cover ${rounded} shrink-0`}
      style={{ width: size, height: size }}
    />
  )
}

/** Filter pill. The board's filters are all one-of-many toggles. */
function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`text-[13px] font-semibold px-3.5 py-1.5 rounded-full border transition-colors ${
        on
          ? 'bg-[#2d6a4f] border-[#2d6a4f] text-white'
          : 'bg-white border-[#e2e2e2] text-[#777] hover:text-[#111] hover:border-[#c8c8c8]'
      }`}
    >
      {children}
    </button>
  )
}

export default function Charts() {
  const [period, setPeriod] = useState<'week' | 'all'>('week')
  const [genre, setGenre] = useState<string | null>(null)
  const [decade, setDecade] = useState<number | null>(null)
  const [yearText, setYearText] = useState('')
  const year = /^\d{4}$/.test(yearText) ? Number(yearText) : null

  const { data, isLoading, isError } = useQuery({
    queryKey: ['charts', period, genre ?? '', decade ?? '', year ?? ''],
    queryFn: () =>
      fetchCharts({
        period,
        genre: genre ?? undefined,
        decade: decade ?? undefined,
        year: year ?? undefined,
      }),
    staleTime: 5 * 60_000,
  })

  // Decade and year both narrow by release date, and the server ANDs them —
  // holding both at once can only ever return nothing, so they clear each other.
  function pickDecade(d: number) {
    setDecade(d === decade ? null : d)
    setYearText('')
  }
  function typeYear(v: string) {
    setYearText(v)
    if (v) setDecade(null)
  }

  const items: ChartItem[] = data?.items ?? []
  const podium = items.slice(0, 3)
  const rest = items.slice(3)
  // Podium reads 2 · 1 · 3, with the winner raised in the middle.
  const podiumOrder = [podium[1], podium[0], podium[2]]

  return (
    <div className="p-4 md:p-8">
      <div className="flex items-end justify-between gap-5 flex-wrap mb-6">
        <div>
          <h1 className="font-display text-3xl font-bold text-[#111]">Charts</h1>
          <p className="text-sm text-[#777] mt-1.5 max-w-xl">
            Every album rated on Pressd, ranked by the average score across everyone who
            rated it. Movement compares against yesterday's board.
          </p>
        </div>
        <span className="text-[11px] font-bold tracking-[0.14em] uppercase text-[#aaa]">
          {period === 'week' ? weekLabel() : 'All time'}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-8">
        <Chip on={period === 'week'} onClick={() => setPeriod('week')}>This week</Chip>
        <Chip on={period === 'all'} onClick={() => setPeriod('all')}>All time</Chip>

        {data?.facets.genres.length ? <span className="w-px self-stretch bg-[#e2e2e2] mx-1.5" /> : null}
        <Chip on={genre === null} onClick={() => setGenre(null)}>All genres</Chip>
        {data?.facets.genres.map((g) => (
          <Chip key={g} on={genre === g} onClick={() => setGenre(g === genre ? null : g)}>{g}</Chip>
        ))}

        {data?.facets.decades.length ? <span className="w-px self-stretch bg-[#e2e2e2] mx-1.5" /> : null}
        {data?.facets.decades.slice(0, 6).map((d) => (
          <Chip key={d} on={decade === d} onClick={() => pickDecade(d)}>{d}s</Chip>
        ))}

        <input
          value={yearText}
          onChange={(e) => typeYear(e.target.value.replace(/\D/g, '').slice(0, 4))}
          placeholder="Year"
          inputMode="numeric"
          className={`w-[74px] text-[13px] font-semibold px-3.5 py-1.5 rounded-full border bg-white transition-colors focus:outline-none placeholder:font-normal placeholder:text-[#bbb] ${
            year ? 'border-[#2d6a4f] text-[#2d6a4f]' : 'border-[#e2e2e2] text-[#111] focus:border-[#2d6a4f]'
          }`}
        />
      </div>

      {isLoading ? (
        <div className="py-16 flex justify-center text-[#aaa]">
          <Loader2 size={20} className="animate-spin" />
        </div>
      ) : isError ? (
        <div className="py-16 text-center text-sm text-[#777]">
          Couldn't load the charts just now. Please try again.
        </div>
      ) : items.length === 0 ? (
        <div className="py-16 text-center text-sm text-[#777]">No albums match this filter yet.</div>
      ) : (
        <>
          {/* Podium */}
          <div className="grid grid-cols-1 md:grid-cols-[1fr_1.25fr_1fr] gap-5 md:gap-7 items-end mb-11">
            {podiumOrder.map((it, i) =>
              it ? (
                <Link
                  key={it.album_id}
                  to={`/album/${it.album_id}`}
                  className="text-center group"
                >
                  <div
                    className={`font-display font-bold leading-none mb-2.5 ${
                      i === 1 ? 'text-[44px] text-[#111]' : 'text-[34px] text-[#bbb]'
                    }`}
                  >
                    {it.rank}
                  </div>
                  <div className="flex justify-center">
                    <Cover
                      url={it.album_art_url}
                      alt=""
                      size={i === 1 ? 190 : 150}
                      rounded="rounded-xl shadow-[0_14px_32px_-12px_rgba(0,0,0,0.35)] group-hover:shadow-[0_18px_40px_-12px_rgba(0,0,0,0.45)] transition-shadow"
                    />
                  </div>
                  <p className="text-[14.5px] font-bold text-[#111] mt-3 leading-tight group-hover:text-[#2d6a4f] transition-colors">
                    {it.album_name}
                  </p>
                  <p className="text-[12.5px] text-[#777] mt-0.5">{it.artist}</p>
                  <p className="font-display text-[22px] font-bold text-[#111] mt-1.5 tabular-nums">
                    {it.avg_score?.toFixed(2)}
                  </p>
                </Link>
              ) : (
                <div key={`empty-${i}`} />
              ),
            )}
          </div>

          {/* Board */}
          <div className="border-t border-[#e2e2e2]">
            {rest.map((it) => (
              <Link
                key={it.album_id}
                to={`/album/${it.album_id}`}
                className="grid grid-cols-[32px_44px_1fr_38px_auto] md:grid-cols-[44px_56px_1fr_auto_42px_auto] items-center gap-3 md:gap-4 px-1.5 py-3 border-b border-[#ededed] hover:bg-[#f2f0ec] transition-colors"
              >
                <span className="font-display text-[19px] text-[#aaa] tabular-nums text-center">{it.rank}</span>
                <div className="flex justify-center">
                  <Cover url={it.album_art_url} alt="" size={44} rounded="rounded-md" />
                </div>
                <div className="min-w-0">
                  <p className="text-[14.5px] font-semibold text-[#111] leading-tight truncate">{it.album_name}</p>
                  <p className="text-[12.5px] text-[#777] mt-0.5 truncate">
                    {it.artist}{it.year ? ` · ${it.year}` : ''}
                  </p>
                </div>
                <span className="hidden md:block text-xs text-[#aaa] whitespace-nowrap">
                  {it.rater_count} {it.rater_count === 1 ? 'rating' : 'ratings'}
                </span>
                <span className="w-[38px] md:w-[42px] text-right">
                  <Movement value={it.movement} />
                </span>
                <span className="font-display text-[18px] text-[#111] tabular-nums text-right min-w-[46px]">
                  {it.avg_score?.toFixed(2)}
                </span>
              </Link>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
