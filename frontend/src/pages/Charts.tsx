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
import { Cover, ScorePill, COVER_LIFT } from '../components/covers'

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

/** The year "Best of" jumps to. Bumping this is the whole maintenance story —
 *  the label, the preset, and the active check all read from it. */
const BEST_OF_YEAR = 2026

const FIELD =
  'text-[13px] font-medium h-9 px-3 rounded-lg border bg-white transition-colors ' +
  'focus:outline-none focus:border-[#2d6a4f]'

/** A filter that's set reads back in green, so which ones are narrowing the
 *  board is obvious without having to open each one. */
function fieldCls(active: boolean) {
  return `${FIELD} ${active ? 'border-[#2d6a4f] text-[#2d6a4f]' : 'border-[#e2e2e2] text-[#111] hover:border-[#c8c8c8]'}`
}

function Select({
  value, onChange, active, children, label,
}: {
  value: string
  onChange: (v: string) => void
  active: boolean
  children: React.ReactNode
  label: string
}) {
  return (
    <select
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={`${fieldCls(active)} pr-7 cursor-pointer appearance-none bg-no-repeat`}
      style={{
        backgroundImage:
          "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23999' stroke-width='3'><path d='M6 9l6 6 6-6'/></svg>\")",
        backgroundPosition: 'right 10px center',
      }}
    >
      {children}
    </select>
  )
}

export default function Charts() {
  const [period, setPeriod] = useState<'week' | 'all'>('week')
  const [genre, setGenre] = useState<string | null>(null)
  const [decade, setDecade] = useState<number | null>(null)
  const [yearText, setYearText] = useState('')
  const [artist, setArtist] = useState('')
  const year = /^\d{4}$/.test(yearText) ? Number(yearText) : null
  const artistQuery = artist.trim()

  const { data, isLoading, isError } = useQuery({
    queryKey: ['charts', period, genre ?? '', decade ?? '', year ?? '', artistQuery],
    queryFn: () =>
      fetchCharts({
        period,
        genre: genre ?? undefined,
        decade: decade ?? undefined,
        year: year ?? undefined,
        artist: artistQuery || undefined,
      }),
    staleTime: 5 * 60_000,
  })

  // Decade and year both narrow by release date, and the server ANDs them —
  // holding both at once can only ever return nothing, so they clear each other.
  function pickDecade(v: string) {
    setDecade(v ? Number(v) : null)
    if (v) setYearText('')
  }
  function typeYear(v: string) {
    setYearText(v)
    if (v) setDecade(null)
  }

  // "Best of" is the year read over the whole catalog, not just this week's
  // ratings — scoping it to the week would rank a handful of recent listens.
  const bestOfOn = period === 'all' && year === BEST_OF_YEAR
  function toggleBestOf() {
    if (bestOfOn) {
      setPeriod('week')
      setYearText('')
      return
    }
    setPeriod('all')
    setYearText(String(BEST_OF_YEAR))
    setDecade(null)
  }

  const items: ChartItem[] = data?.items ?? []
  const podium = items.slice(0, 3)
  const rest = items.slice(3)
  // Podium reads 2 · 1 · 3, with the winner raised in the middle.
  const podiumOrder = [podium[1], podium[0], podium[2]]

  return (
    <div className="p-4 md:p-8">
      <div className="flex items-end justify-between gap-5 flex-wrap mb-6">
        <h1 className="font-display text-3xl font-bold text-[#111]">Charts</h1>
        <span className="text-[11px] font-bold tracking-[0.14em] uppercase text-[#aaa]">
          {period === 'week' ? weekLabel() : 'All time'}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-8">
        <button
          onClick={toggleBestOf}
          className={`text-[13px] font-semibold h-9 px-4 rounded-lg border transition-colors ${
            bestOfOn
              ? 'bg-[#2d6a4f] border-[#2d6a4f] text-white'
              : 'bg-white border-[#e2e2e2] text-[#777] hover:text-[#111] hover:border-[#c8c8c8]'
          }`}
        >
          Best of {BEST_OF_YEAR}
        </button>

        <span className="w-px h-6 bg-[#e2e2e2] mx-1" />

        <Select
          label="Period"
          value={period}
          active={period === 'all'}
          onChange={(v) => setPeriod(v as 'week' | 'all')}
        >
          <option value="week">This week</option>
          <option value="all">All time</option>
        </Select>

        <Select
          label="Genre"
          value={genre ?? ''}
          active={genre !== null}
          onChange={(v) => setGenre(v || null)}
        >
          <option value="">All genres</option>
          {data?.facets.genres.map((g) => (
            <option key={g} value={g}>{g}</option>
          ))}
        </Select>

        <Select
          label="Decade"
          value={decade != null ? String(decade) : ''}
          active={decade !== null}
          onChange={pickDecade}
        >
          <option value="">All decades</option>
          {data?.facets.decades.map((d) => (
            <option key={d} value={d}>{d}s</option>
          ))}
        </Select>

        <input
          value={yearText}
          onChange={(e) => typeYear(e.target.value.replace(/\D/g, '').slice(0, 4))}
          placeholder="Year"
          inputMode="numeric"
          aria-label="Year"
          className={`w-[86px] ${fieldCls(year !== null)} placeholder:text-[#bbb]`}
        />

        <input
          value={artist}
          onChange={(e) => setArtist(e.target.value)}
          placeholder="Artist"
          aria-label="Artist"
          className={`w-[150px] ${fieldCls(artistQuery.length > 0)} placeholder:text-[#bbb]`}
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
                    <div
                      className={`rounded-[14px] shadow-[0_14px_32px_-12px_rgba(0,0,0,0.35)] ${COVER_LIFT}`}
                      style={{ willChange: 'transform' }}
                    >
                      <Cover
                        artUrl={it.album_art_url}
                        seed={it.artist}
                        size={i === 1 ? 190 : 150}
                        radius={14}
                      />
                    </div>
                  </div>
                  <p className="text-[14.5px] font-bold text-[#111] mt-3 leading-tight group-hover:text-[#2d6a4f] transition-colors">
                    {it.album_name}
                  </p>
                  <p className="text-[12.5px] text-[#777] mt-0.5">{it.artist}</p>
                  {it.avg_score != null && (
                    <span className="inline-block mt-2">
                      <ScorePill score={it.avg_score} big />
                    </span>
                  )}
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
                <div className={`flex justify-center ${COVER_LIFT}`} style={{ willChange: 'transform' }}>
                  <Cover artUrl={it.album_art_url} seed={it.artist} size={44} radius={8} fontSize={18} />
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
                <span className="flex justify-end">
                  {it.avg_score != null && <ScorePill score={it.avg_score} />}
                </span>
              </Link>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
