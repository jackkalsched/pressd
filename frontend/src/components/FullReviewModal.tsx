// One person's full rating of a record, opened from their post in its thread:
// the score on the post, then the working behind it — four factors, every song
// in track order, and what they wrote.
//
// Reached only from a thread, and only for the record the thread is about.
// The server scopes it the same way (discussions.post_author_rating): a room
// shows you how the people in it heard the record, never their libraries.
import { useEffect, type CSSProperties } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Loader2, Triangle, X } from 'lucide-react'
import { fetchPostAuthorRating } from '../api'
import { songScoreColor } from '../types'
import Avatar from './Avatar'

const FACTORS = [
  { key: 'theme', label: 'Theme / Cohesion' },
  { key: 'replayValue', label: 'Replay Value' },
  { key: 'production', label: 'Production' },
  { key: 'distinctness', label: 'Distinctness' },
] as const

function ratedOn(iso: string | null): string | null {
  if (!iso) return null
  // A date, not a timestamp: parse as local so it doesn't slip a day west of UTC.
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })
}

export default function FullReviewModal({ postId, onClose }: { postId: number; onClose: () => void }) {
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['postRating', postId],
    queryFn: () => fetchPostAuthorRating(postId),
    staleTime: 60_000,
  })

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const scored = data?.songs.filter((s) => s.score != null) ?? []
  const best = scored.length > 1 ? Math.max(...scored.map((s) => s.score!)) : null
  const worst = scored.length > 1 ? Math.min(...scored.map((s) => s.score!)) : null
  // The explicit pick when they made one (TopSongTiebreak); otherwise every
  // track tied at the top is marked, rather than one chosen by sort order.
  const isTop = (s: { id: number; score: number | null }) =>
    data?.topSongId != null ? s.id === data.topSongId : s.score != null && s.score === best
  const hasFactors = !!data && FACTORS.some((f) => data[f.key] != null)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm fade-in" onClick={onClose} />
      <div className="relative bg-[#faf8f5] border border-[#e8e2d9] rounded-2xl w-full max-w-3xl max-h-[88vh] overflow-y-auto shadow-xl pop-in">
        <button
          onClick={onClose}
          aria-label="Close"
          className="absolute right-4 top-4 text-[#aaa] hover:text-[#555] transition-colors"
        >
          <X size={18} />
        </button>

        {isLoading ? (
          <div className="flex items-center gap-2 text-[#aaa] text-sm py-24 justify-center">
            <Loader2 size={16} className="animate-spin" /> Loading review…
          </div>
        ) : isError || !data ? (
          <p className="text-center text-sm text-[#a8998a] py-24 px-6 m-0">
            {(error as Error)?.message || 'Could not load that review.'}
          </p>
        ) : (
          <div className="p-6 md:p-8">
            {/* ── Who, and what they scored it ─────────────────────── */}
            <div className="flex items-center gap-4 pr-8">
              <Avatar name={data.author.name} avatarUrl={data.author.avatarUrl} size={44} />
              <div className="min-w-0 flex-1">
                <p className="m-0 text-[16px] font-semibold text-[#111] truncate">{data.author.name}</p>
                <p className="m-0 text-[12.5px] text-[#8a7f72] truncate">
                  on {data.albumName} · {data.artist}
                  {ratedOn(data.dateRated) && <> · rated {ratedOn(data.dateRated)}</>}
                </p>
              </div>
            </div>

            <div className="mt-6 grid md:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] gap-8">
              <div>
                <div className="flex items-end gap-3">
                  {data.score != null && (
                    <span
                      className="leading-none tabular-nums"
                      style={{ fontFamily: "'Playfair Display', serif", fontWeight: 800, fontSize: 56, color: songScoreColor(data.score) }}
                    >
                      {data.score.toFixed(2)}
                    </span>
                  )}
                  <span className="mb-1.5 text-[10px] font-bold tracking-[0.14em] text-[#a8998a]">FINAL SCORE</span>
                </div>

                {/* EPs skip the four factors, so there is nothing to show. */}
                {hasFactors && (
                  <div className="mt-5 grid grid-cols-2 gap-2">
                    {FACTORS.map((f) => {
                      const v = data[f.key]
                      return (
                        <div key={f.key} className="rise-in rounded-xl bg-white border border-[#ece6dc] px-3 py-2.5" style={{ '--i': FACTORS.indexOf(f) } as CSSProperties}>
                          <p className="m-0 text-[11px] font-medium text-[#8a7f72] truncate">{f.label}</p>
                          <p
                            className="m-0 mt-0.5 font-display text-[20px] font-bold tabular-nums"
                            style={{ color: v != null ? songScoreColor(v) : '#c8c0b4' }}
                          >
                            {v != null ? v.toFixed(1) : '—'}
                          </p>
                        </div>
                      )
                    })}
                  </div>
                )}

                {data.review?.trim() && (
                  <div className="mt-6">
                    <p className="m-0 mb-2 text-[10.5px] font-bold uppercase tracking-[0.16em] text-[#a8998a]">Review</p>
                    <p className="m-0 font-display text-[15px] leading-relaxed text-[#1c1917] whitespace-pre-wrap break-words">
                      {data.review}
                    </p>
                  </div>
                )}
              </div>

              {/* ── Every song, in the order they heard it ───────────── */}
              <div>
                <p className="m-0 mb-2 text-[10.5px] font-bold uppercase tracking-[0.16em] text-[#a8998a]">Track by track</p>
                <ol className="m-0 p-0 list-none">
                  {data.songs.map((s, i) => (
                    <li key={s.id} className="rise-in flex items-center gap-2.5 py-[5px] min-w-0" style={{ '--i': i } as CSSProperties}>
                      <span className="w-5 text-right text-[11.5px] text-[#b5aa9c] tabular-nums shrink-0">
                        {s.trackNumber ?? i + 1}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span
                            className={`text-[13px] truncate ${
                              s.score == null ? 'text-[#b5aa9c] italic' : isTop(s) ? 'font-semibold text-[#111]' : 'text-[#44403c]'
                            }`}
                          >
                            {s.title}
                          </span>
                          {s.score != null && isTop(s) && <Triangle size={9} color="#2d6a4f" className="shrink-0" />}
                          {s.score != null && s.score === worst && worst !== best && (
                            <Triangle size={9} color="#e0492b" style={{ transform: 'rotate(180deg)' }} className="shrink-0" />
                          )}
                        </div>
                        {s.score != null && (
                          <div className="mt-1 h-[3px] rounded-full bg-[#ece6dc] overflow-hidden">
                            <div className="grow-x h-full rounded-full" style={{ width: `${s.score * 10}%`, background: songScoreColor(s.score), '--i': i } as CSSProperties} />
                          </div>
                        )}
                      </div>
                      <span
                        className="font-display w-8 text-right text-[14px] font-bold tabular-nums shrink-0"
                        style={{ color: s.score != null ? songScoreColor(s.score) : '#c8c0b4' }}
                      >
                        {s.score != null ? s.score.toFixed(1) : 'skip'}
                      </span>
                    </li>
                  ))}
                </ol>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
