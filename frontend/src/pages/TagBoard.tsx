// The board behind one row of the Stats genre/subgenre breakdown: every record
// that person has rated in that tag, best first.
//
// The web port of mobile/app/genre/[tag].tsx. Built as the Charts board rather
// than a plain list — same podium, same ranked rows — because it answers the
// same question at a smaller scope. A desktop row has room mobile's doesn't,
// so each record also carries where it sits in the whole library: "#3 in
// Hip-Hop" means more beside "#12 overall".
//
// Works for a friend's stats as well as your own: whose records to read and
// whose name to head them with both arrive in the URL (?user=&owner=), so the
// page never assumes it is showing the signed-in user. The server gates the
// read on an accepted friendship (viewable_user_id).
import { useMemo, type CSSProperties } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, Loader2 } from 'lucide-react'
import { fetchAlbums, fetchSummary, fetchTagRecords } from '../api'
import { songScoreColor } from '../types'
import { Cover, COVER_LIFT, ScorePill } from '../components/covers'
import { useUser } from '../context/UserContext'

/** The --i a staggered animation (rise-in in index.css) reads. */
function stagger(i: number): CSSProperties {
  return { '--i': i } as CSSProperties
}

/** "Chris" → "Chris's", "Travis" → "Travis'". */
function possessive(name: string): string {
  return /s$/i.test(name) ? `${name}'` : `${name}'s`
}

export default function TagBoard() {
  const navigate = useNavigate()
  const { kind: kindParam, tag: tagParam } = useParams<{ kind: string; tag: string }>()
  const [params] = useSearchParams()
  const { activeUser } = useUser()

  const tag = decodeURIComponent(tagParam ?? '')
  const kind = kindParam === 'subgenre' ? 'subgenre' : 'genre'
  const userId = Number(params.get('user')) || activeUser?.id || 0
  const ownerName = params.get('owner') ?? ''
  const isOwn = !ownerName || userId === activeUser?.id

  const { data, isLoading, isError } = useQuery({
    queryKey: ['tag-records', userId, kind, tag],
    queryFn: () => fetchTagRecords(tag, kind, userId),
    enabled: userId > 0 && !!tag,
    staleTime: 5 * 60_000,
  })

  // For "#12 overall" and the tag's lean against the whole library. Same keys
  // as Stats and the onboarding gate, so arriving from Stats costs nothing.
  const { data: rated = [] } = useQuery({
    queryKey: ['albums', 'rated', userId],
    queryFn: () => fetchAlbums({ status: 'rated', userId }),
    enabled: userId > 0,
    staleTime: 5 * 60_000,
  })
  const { data: summary } = useQuery({
    queryKey: ['stats', 'summary', userId],
    queryFn: () => fetchSummary(userId),
    enabled: userId > 0,
    staleTime: 5 * 60_000,
  })

  // Ranked the way tag-records ranks: score, then title, so a tie reads the
  // same in both numbers.
  const overall = useMemo(() => {
    const ranks = new Map<number, number>()
    ;[...rated]
      .filter((a) => a.score != null)
      .sort((a, b) => (b.score! - a.score!) || a.albumName.toLowerCase().localeCompare(b.albumName.toLowerCase()))
      .forEach((a, i) => ranks.set(a.id, i + 1))
    return ranks
  }, [rated])
  const libraryCount = overall.size

  const items = data?.items ?? []
  const podium = items.slice(0, 3)
  const rest = items.slice(3)
  // Podium reads 2 · 1 · 3, with the winner raised in the middle, as Charts does.
  const podiumOrder = [podium[1], podium[0], podium[2]]

  const libAvg = summary?.avg_album_score ?? null
  const lean = data?.avg_score != null && libAvg != null ? data.avg_score - libAvg : null
  const share = data && libraryCount ? (data.count / libraryCount) * 100 : null

  const kicker = `${isOwn ? 'Your' : possessive(ownerName)} top records · ${kind}`

  function goBack() {
    if (window.history.state?.idx > 0) navigate(-1)
    else navigate('/stats')
  }

  return (
    <div className="min-h-screen bg-[#f9f8f6]">
      <div className="mx-auto w-full max-w-[1600px] px-4 md:px-12 py-6 md:py-8 pb-24">
        <button
          onClick={goBack}
          className="flex items-center gap-1.5 text-[13px] font-medium text-[#8a7f72] hover:text-[#111] transition-colors mb-5"
        >
          <ArrowLeft size={16} /> Back
        </button>

        {/* ── Masthead ─────────────────────────────────────────────── */}
        <div className="flex flex-wrap items-end justify-between gap-6 pb-6 mb-8 border-b border-[#e8e2d9]">
          <div className="min-w-0">
            <p className="m-0 mb-1.5 text-[11px] font-bold uppercase tracking-[0.16em] text-[#2d6a4f]">{kicker}</p>
            <h1 className="m-0 font-display text-4xl md:text-5xl font-bold text-[#1c1917] tracking-tight">{tag}</h1>
          </div>
          {data && data.count > 0 && (
            <div className="flex flex-wrap gap-x-10 gap-y-4">
              <Stat label="Records" value={String(data.count)}
                sub={share != null ? `${share.toFixed(share < 10 ? 1 : 0)}% of the library` : undefined} />
              {data.avg_score != null && (
                <Stat
                  label="Avg score"
                  value={data.avg_score.toFixed(2)}
                  color={songScoreColor(data.avg_score)}
                  sub={lean != null
                    ? `${lean >= 0 ? '+' : '−'}${Math.abs(lean).toFixed(2)} vs ${isOwn ? 'your' : 'their'} ${libAvg!.toFixed(2)}`
                    : undefined}
                />
              )}
              {items[0] && (
                <Stat label="Best" value={items[0].score.toFixed(2)} color={songScoreColor(items[0].score)}
                  sub={items[0].album_name} />
              )}
            </div>
          )}
        </div>

        {isLoading ? (
          <div className="py-16 flex justify-center text-[#aaa]">
            <Loader2 size={20} className="animate-spin" />
          </div>
        ) : isError ? (
          <p className="py-16 text-center text-sm text-[#777] m-0">Couldn't load these records just now.</p>
        ) : items.length === 0 ? (
          <p className="py-16 text-center text-sm text-[#777] m-0">
            {isOwn ? "You haven't" : `${ownerName} hasn't`} rated anything in {tag} yet.
          </p>
        ) : (
          <>
            {/* ── Podium ─────────────────────────────────────────── */}
            <div className="grid grid-cols-1 md:grid-cols-[1fr_1.25fr_1fr] gap-5 md:gap-7 items-end mb-11 max-w-[1100px] mx-auto">
              {podiumOrder.map((it, i) =>
                it ? (
                  <Link
                    key={it.album_id}
                    to={`/album/${it.album_id}`}
                    // The winner lands first, then second and third either side.
                    className="text-center group rise-in"
                    style={stagger(i === 1 ? 0 : i === 0 ? 2 : 3)}
                  >
                    <div className={`font-display font-bold leading-none mb-2.5 ${i === 1 ? 'text-[44px] text-[#111]' : 'text-[34px] text-[#bbb]'}`}>
                      {it.rank}
                    </div>
                    <div className="flex justify-center">
                      <div className={`rounded-[14px] shadow-[0_14px_32px_-12px_rgba(0,0,0,0.35)] ${COVER_LIFT}`} style={{ willChange: 'transform' }}>
                        <Cover artUrl={it.album_art_url} seed={it.artist} size={i === 1 ? 210 : 165} radius={14} />
                      </div>
                    </div>
                    <p className="text-[14.5px] font-bold text-[#111] mt-3 leading-tight group-hover:text-[#2d6a4f] transition-colors">
                      {it.album_name}
                    </p>
                    <p className="text-[12.5px] text-[#777] mt-0.5">
                      {it.artist}{it.year ? ` · ${it.year}` : ''}
                    </p>
                    <div className="flex items-center justify-center gap-2 mt-2">
                      <ScorePill score={it.score} big />
                      {overall.get(it.album_id) && (
                        <span className="text-[11.5px] text-[#a8998a] tabular-nums">#{overall.get(it.album_id)} overall</span>
                      )}
                    </div>
                  </Link>
                ) : (
                  <div key={`empty-${i}`} />
                ),
              )}
            </div>

            {/* ── Board ──────────────────────────────────────────── */}
            {rest.length > 0 && (
              <div className="border-t border-[#e2e2e2]">
                {rest.map((it, i) => (
                  <Link
                    key={it.album_id}
                    to={`/album/${it.album_id}`}
                    style={stagger(i + 4)}
                    className="rise-in group grid grid-cols-[32px_44px_minmax(0,1fr)_auto] md:grid-cols-[44px_56px_minmax(0,1fr)_120px_auto] items-center gap-3 md:gap-4 px-1.5 py-3 border-b border-[#ededed] hover:bg-[#f2f0ec] active:bg-[#ebe7e0] transition-colors"
                  >
                    <span className="font-display text-[19px] text-[#aaa] tabular-nums text-center">{it.rank}</span>
                    <div className={`flex justify-center ${COVER_LIFT}`} style={{ willChange: 'transform' }}>
                      <Cover artUrl={it.album_art_url} seed={it.artist} size={44} radius={8} fontSize={18} />
                    </div>
                    <div className="min-w-0">
                      <p className="m-0 text-[14.5px] font-semibold text-[#111] leading-tight truncate group-hover:text-[#2d6a4f] transition-colors">
                        {it.album_name}
                      </p>
                      <p className="m-0 text-[12.5px] text-[#777] mt-0.5 truncate">
                        {it.artist}{it.year ? ` · ${it.year}` : ''}
                      </p>
                    </div>
                    <span className="hidden md:block text-xs text-[#aaa] whitespace-nowrap text-right tabular-nums">
                      {overall.get(it.album_id) ? `#${overall.get(it.album_id)} of ${libraryCount} overall` : ''}
                    </span>
                    <span className="flex justify-end">
                      <ScorePill score={it.score} />
                    </span>
                  </Link>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

function Stat({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div className="min-w-0 max-w-[220px]">
      <p className="m-0 text-[10px] font-semibold uppercase tracking-[0.12em] text-[#a8998a]">{label}</p>
      <p className="m-0 mt-1 font-display text-[30px] font-bold tabular-nums leading-none" style={{ color: color ?? '#1c1917' }}>
        {value}
      </p>
      {sub && <p className="m-0 mt-1.5 text-[12px] text-[#8a7f72] truncate">{sub}</p>}
    </div>
  )
}
