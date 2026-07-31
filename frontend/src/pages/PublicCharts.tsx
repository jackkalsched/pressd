// Public Charts — the desktop counterpart to the mobile Charts tab.
//
// Same board, same ranking, but laid out for a wide screen: filters sit in one
// row instead of behind dropdown sheets, and the top three get a podium with #1
// raised. Rows are not links — a logged-out visitor has no album page to land
// on, so the whole board is read-only until they sign in.
//
// Data comes from /public/charts (no auth) rather than /discover/charts, so
// nothing here is personalised and no per-user field is ever fetched.
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Loader2, Triangle } from 'lucide-react'
import { fetchPublicCharts } from '../api'
import type { ChartItem } from '../api'
import PublicShell from '../components/PublicShell'

const DOWN = '#e07a6a'
const UP = '#9fd6b0'

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
  if (value === null) return <span className="mv new">NEW</span>
  if (value === 0) return <span className="mv flat">–</span>
  const up = value > 0
  return (
    <span className="mv" style={{ color: up ? UP : DOWN }}>
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

function Cover({ url, alt, size }: { url: string | null; alt: string; size: number }) {
  if (!url) {
    return <div className="cover placeholder" style={{ width: size, height: size }} aria-hidden />
  }
  return <img className="cover" src={url} alt={alt} style={{ width: size, height: size }} loading="lazy" />
}

export default function PublicCharts() {
  const [period, setPeriod] = useState<'week' | 'all'>('week')
  const [genre, setGenre] = useState<string | null>(null)
  const [decade, setDecade] = useState<number | null>(null)

  const { data, isLoading, isError } = useQuery({
    queryKey: ['public-charts', period, genre ?? '', decade ?? ''],
    queryFn: () =>
      fetchPublicCharts({
        period,
        genre: genre ?? undefined,
        decade: decade ?? undefined,
      }),
    staleTime: 5 * 60_000,
  })

  const items: ChartItem[] = data?.items ?? []
  const podium = items.slice(0, 3)
  const rest = items.slice(3)
  // Podium reads 2 · 1 · 3, with the winner raised in the middle.
  const podiumOrder = [podium[1], podium[0], podium[2]]

  return (
    <PublicShell active="charts">
      <style>{`
        .chart-head { display: flex; align-items: flex-end; justify-content: space-between; gap: 20px; flex-wrap: wrap; }
        .chart-week {
          font-size: 12px; font-weight: 700; letter-spacing: 0.14em;
          color: rgba(244,242,236,0.6); text-transform: uppercase;
        }

        .filters { display: flex; flex-wrap: wrap; gap: 8px; margin: 30px 0 34px; }
        .chip {
          font-family: inherit; font-size: 13px; font-weight: 600;
          padding: 7px 14px; border-radius: 100px; cursor: pointer;
          background: rgba(244,242,236,0.10);
          border: 1px solid rgba(244,242,236,0.20);
          color: rgba(244,242,236,0.82);
          transition: background 0.15s, color 0.15s, border-color 0.15s;
        }
        .chip:hover { background: rgba(244,242,236,0.18); color: #F4F2EC; }
        .chip.on { background: #F4F2EC; color: #23372C; border-color: #F4F2EC; }
        .filter-sep { width: 1px; align-self: stretch; background: rgba(244,242,236,0.18); margin: 0 6px; }

        /* ── Podium ── */
        .podium { display: grid; grid-template-columns: 1fr 1.25fr 1fr; gap: 26px; align-items: end; margin-bottom: 46px; }
        .pod { text-align: center; }
        /* Tailwind's preflight makes images display:block, so text-align can't
           centre them — they pin to the left edge of the column without this. */
        .pod .cover { border-radius: 12px; object-fit: cover; margin: 0 auto; box-shadow: 0 18px 40px -10px rgba(0,0,0,0.5); }
        .pod-rank {
          font-family: 'Clash Display', 'Plus Jakarta Sans', system-ui, sans-serif;
          font-size: 34px; font-weight: 700; line-height: 1;
          color: rgba(244,242,236,0.5); margin-bottom: 10px;
        }
        .pod.first .pod-rank { color: #F4F2EC; font-size: 44px; }
        .pod-name { font-size: 14.5px; font-weight: 700; margin-top: 12px; line-height: 1.25; }
        .pod-artist { font-size: 12.5px; color: rgba(244,242,236,0.66); margin-top: 2px; }
        .pod-score {
          font-family: 'Playfair Display', Georgia, serif;
          font-size: 22px; font-weight: 700; margin-top: 8px;
          font-variant-numeric: tabular-nums;
        }

        /* ── Board ── */
        .board { border-top: 1px solid rgba(244,242,236,0.16); }
        /* rank · cover · title block · rating count · movement · score */
        .row {
          display: grid;
          grid-template-columns: 44px 56px 1fr auto 42px auto;
          align-items: center;
          gap: 16px;
          padding: 12px 6px;
          border-bottom: 1px solid rgba(244,242,236,0.10);
        }
        .row:hover { background: rgba(244,242,236,0.05); }
        .row-rank {
          font-family: 'Playfair Display', Georgia, serif;
          font-size: 19px; color: rgba(244,242,236,0.58);
          font-variant-numeric: tabular-nums; text-align: center;
        }
        .row .cover { border-radius: 7px; object-fit: cover; justify-self: center; }
        .cover.placeholder { background: rgba(244,242,236,0.14); border-radius: 7px; }
        .row-name { font-size: 14.5px; font-weight: 600; line-height: 1.25; }
        .row-artist { font-size: 12.5px; color: rgba(244,242,236,0.62); margin-top: 2px; }
        .row-raters { font-size: 12px; color: rgba(244,242,236,0.5); white-space: nowrap; }
        .row-score {
          font-family: 'Playfair Display', Georgia, serif;
          font-size: 18px; font-variant-numeric: tabular-nums; min-width: 46px; text-align: right;
        }

        .mv { display: inline-flex; align-items: center; gap: 3px; font-size: 11.5px; font-weight: 700; }
        .mv.new { color: #CFE3D6; letter-spacing: 0.06em; }
        .mv.flat { color: rgba(244,242,236,0.35); }
        .mv-cell { width: 42px; text-align: right; }

        .state { padding: 60px 0; text-align: center; color: rgba(244,242,236,0.7); }

        @media (max-width: 760px) {
          .podium { grid-template-columns: 1fr; gap: 18px; }
          /* the rating count drops out, leaving five cells */
          .row { grid-template-columns: 34px 44px 1fr 38px auto; gap: 12px; }
          .row-raters { display: none; }
        }
      `}</style>

      <main className="pub-body">
        <div className="chart-head">
          <div>
            <h1 className="pub-title">Charts</h1>
            <p className="pub-lede">
              Every album rated on Pressd, ranked by the average score across everyone
              who rated it. Movement compares against yesterday's board.
            </p>
          </div>
          <span className="chart-week">{period === 'week' ? weekLabel() : 'All time'}</span>
        </div>

        <div className="filters">
          <button className={`chip${period === 'week' ? ' on' : ''}`} onClick={() => setPeriod('week')}>This week</button>
          <button className={`chip${period === 'all' ? ' on' : ''}`} onClick={() => setPeriod('all')}>All time</button>

          {data?.facets.genres.length ? <span className="filter-sep" /> : null}
          <button className={`chip${genre === null ? ' on' : ''}`} onClick={() => setGenre(null)}>All genres</button>
          {data?.facets.genres.map((g) => (
            <button key={g} className={`chip${genre === g ? ' on' : ''}`} onClick={() => setGenre(g === genre ? null : g)}>
              {g}
            </button>
          ))}

          {data?.facets.decades.length ? <span className="filter-sep" /> : null}
          {data?.facets.decades.slice(0, 6).map((d) => (
            <button key={d} className={`chip${decade === d ? ' on' : ''}`} onClick={() => setDecade(d === decade ? null : d)}>
              {d}s
            </button>
          ))}
        </div>

        {isLoading ? (
          <div className="state"><Loader2 size={20} className="animate-spin" /></div>
        ) : isError ? (
          <div className="state">Couldn't load the charts just now. Please try again.</div>
        ) : items.length === 0 ? (
          <div className="state">No albums match this filter yet.</div>
        ) : (
          <>
            <div className="podium">
              {podiumOrder.map((it, i) =>
                it ? (
                  <div key={it.album_id} className={`pod${i === 1 ? ' first' : ''}`}>
                    <div className="pod-rank">{it.rank}</div>
                    <Cover url={it.album_art_url} alt="" size={i === 1 ? 190 : 150} />
                    <p className="pod-name">{it.album_name}</p>
                    <p className="pod-artist">{it.artist}</p>
                    <p className="pod-score">{it.avg_score?.toFixed(2)}</p>
                  </div>
                ) : (
                  <div key={`empty-${i}`} />
                ),
              )}
            </div>

            <div className="board">
              {rest.map((it) => (
                <div className="row" key={it.album_id}>
                  <span className="row-rank">{it.rank}</span>
                  <Cover url={it.album_art_url} alt="" size={44} />
                  <div>
                    <p className="row-name">{it.album_name}</p>
                    <p className="row-artist">
                      {it.artist}{it.year ? ` · ${it.year}` : ''}
                    </p>
                  </div>
                  <span className="row-raters">
                    {it.rater_count} {it.rater_count === 1 ? 'rating' : 'ratings'}
                  </span>
                  <span className="mv-cell"><Movement value={it.movement} /></span>
                  <span className="row-score">{it.avg_score?.toFixed(2)}</span>
                </div>
              ))}
            </div>
          </>
        )}
      </main>
    </PublicShell>
  )
}
