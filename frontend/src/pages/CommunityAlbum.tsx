// The community album view — what the whole of Pressd thinks of a record: the
// Pressd average, the averaged factors, and every track's pooled score, with
// your own numbers alongside. The web port of mobile/app/album/[id].tsx's
// CommunityAlbum; until this page existed a web user never saw the userbase
// number at all.
//
// Two ways in, as on mobile:
//   /album/:id/community             — from any copy's id (Charts, Trending,
//                                      your To Listen, Compare on your rating)
//   /album/community?name=&artist=   — by name, for a record that may not be in
//                                      Pressd yet (new releases); &deezer= carries
//                                      the release's id for its tracklist
// Entry points that aren't tied to a person land here rather than on whoever's
// copy happened to rank. That copy is friends-only, so linking to it failed for
// anyone who wasn't that user's friend.
//
// `avg_score` is the plain mean of every rated copy's score — the figure mobile
// labels PRESSD AVG. The compare view uses `others_*` instead, so "Pressd users"
// never counts you on both sides of the comparison.
//
// Laid out for a desktop window: the record in a sticky column, the numbers
// beside it, with nothing boxed — the numbers sit on the page and spacing does
// the grouping. Track rows pop up as they scroll into view. ?compare=1 opens
// straight on the comparison.
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Check, Loader2, Plus, Play, Star, Trash2 } from 'lucide-react'
import {
  copyAlbumToLibrary, deleteAlbum, fetchCommunityAlbum, fetchCommunityAlbumByName, importAlbum,
  resolveDeezerAlbum, resolveReleaseByName,
} from '../api'
import type { CommunityAlbum as CommunityAlbumData, CommunityTrack } from '../api'
import { songScoreColor, BANG_THRESHOLD, SKIP_THRESHOLD } from '../types'
import { Cover } from '../components/covers'
import RecommendModal from '../components/RecommendModal'
import { useUser } from '../context/UserContext'
import CoverImg from '../components/CoverImg'
import { coverUrl } from '@pressd/shared/covers'

const GREEN = '#2d6a4f'
const RECOMMEND = '#ea7a2a'
const DANGER = '#b91c1c'

function stagger(i: number): CSSProperties {
  return { '--i': i } as CSSProperties
}

export default function CommunityAlbum() {
  const { id } = useParams<{ id: string }>()
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { activeUser } = useUser()

  const name = params.get('name')
  const artistParam = params.get('artist')
  const byName = !!name && !!artistParam
  const deezerId = params.get('deezer') ? Number(params.get('deezer')) : null
  const albumId = Number(id)

  const { data, isLoading, isError } = useQuery({
    queryKey: byName ? ['community-by-name', name, artistParam] : ['album', albumId, 'community'],
    queryFn: () => (byName ? fetchCommunityAlbumByName(name!, artistParam!) : fetchCommunityAlbum(albumId)),
    enabled: byName || Number.isFinite(albumId),
  })

  // A release nobody has added yet has no Pressd tracklist; resolve one so the
  // page still shows the record, and so Rate now can import it.
  const needsResolve = byName && data != null && data.tracks.length === 0
  const { data: resolved } = useQuery({
    queryKey: ['resolved-release', deezerId ?? `${name}::${artistParam}`],
    queryFn: () => (deezerId != null ? resolveDeezerAlbum(deezerId) : resolveReleaseByName(name!, artistParam!)),
    enabled: needsResolve,
    staleTime: 60 * 60_000,
  })

  const [comparing, setComparing] = useState(params.get('compare') === '1')
  const [busy, setBusy] = useState<'rate' | 'queue' | 'delete' | null>(null)
  const [queued, setQueued] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function leave() {
    if (window.history.state?.idx > 0) navigate(-1)
    else navigate('/for-you')
  }

  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#f9f8f6] flex items-center justify-center gap-2 text-[#a8998a]">
        <Loader2 size={16} className="animate-spin" /> Loading…
      </div>
    )
  }
  if (isError || !data) {
    return (
      <div className="min-h-screen bg-[#f9f8f6] flex flex-col items-center justify-center gap-3 px-6 text-center">
        <p className="font-display m-0 text-2xl font-bold text-[#1c1917]">Couldn&rsquo;t load this album</p>
        <button onClick={leave} className="text-sm font-semibold text-[#2d6a4f] hover:text-[#245c43]">Go back</button>
      </div>
    )
  }

  // Fill in from the resolved release when Pressd has no copy of it yet.
  const shown: CommunityAlbumData = resolved && data.tracks.length === 0
    ? {
        ...data,
        year: data.year ?? resolved.year,
        album_art_url: data.album_art_url ?? resolved.cover_url,
        tracks: resolved.tracks.map((t) => ({
          title: t.title, track_number: t.track_number, avg_score: null, rater_count: 0, your_score: null,
        })),
      }
    : data

  const notRated = shown.your_status !== 'rated'
  const inLibrary = shown.your_album_id != null
  // Someone other than you has to have rated it, or "compare" would hold your
  // score against a Pressd average that is your score.
  const noOneElse = shown.others_rater_count === 0
  const canCompare = shown.you?.score != null && shown.avg_score != null && !noOneElse
  const subs = [shown.sub_genre1, shown.sub_genre2, shown.sub_genre3].filter(Boolean) as string[]

  /** Get this album into your library at `status`, returning your copy's id.
   *  Three routes in, as on mobile: you already have it; Pressd has someone
   *  else's copy to clone; or it's new to Pressd and comes from the catalog. */
  async function ensureInLibrary(status: 'to_listen' | 'listening'): Promise<number> {
    if (shown.your_album_id != null) return shown.your_album_id
    if (shown.album_id != null) {
      const copy = await copyAlbumToLibrary(shown.album_id, status)
      queryClient.invalidateQueries({ queryKey: ['albums'] })
      return copy.id
    }
    const full = resolved ?? (deezerId != null
      ? await resolveDeezerAlbum(deezerId)
      : byName ? await resolveReleaseByName(name!, artistParam!) : null)
    if (!full) throw new Error('Nothing to import')
    const imported = await importAlbum(full, status, activeUser?.id ?? 0)
    queryClient.invalidateQueries({ queryKey: ['albums'] })
    return imported.id
  }

  async function rate() {
    if (busy) return
    setBusy('rate'); setError(null)
    try {
      const target = await ensureInLibrary('listening')
      navigate(`/rate/${target}`)
    } catch {
      setError('Couldn’t open this album to rate. Please try again.')
      setBusy(null)
    }
  }

  async function queue() {
    if (busy || queued) return
    setBusy('queue'); setError(null)
    try {
      await ensureInLibrary('to_listen')
      setQueued(true)
      queryClient.invalidateQueries({ queryKey: ['album', albumId, 'community'] })
      queryClient.invalidateQueries({ queryKey: ['community-by-name', name, artistParam] })
    } catch {
      setError('Couldn’t add this album. Please try again.')
    } finally {
      setBusy(null)
    }
  }

  async function removeCopy() {
    if (busy || shown.your_album_id == null) return
    if (!confirm(`Remove ${shown.album_name} from your library?`)) return
    setBusy('delete'); setError(null)
    try {
      await deleteAlbum(shown.your_album_id)
      queryClient.invalidateQueries({ queryKey: ['albums'] })
      leave()
    } catch {
      setError('Couldn’t remove this album. Please try again.')
      setBusy(null)
    }
  }

  const pill = 'inline-flex items-center gap-1.5 rounded-full border border-[#e2dbd0] bg-white/80 px-3.5 py-1.5 text-[13px] font-semibold text-[#2d6a4f] hover:border-[#2d6a4f] hover:bg-white'

  return (
    <div className="relative min-h-screen overflow-x-hidden bg-[#f9f8f6]">
      {/* The record's colour, faintly, behind the top of the page. */}
      {shown.album_art_url && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-[460px] opacity-[0.22] fade-in"
          style={{
            // Blurred 70px: a small image is all it needs.
            backgroundImage: `url(${coverUrl(shown.album_art_url, 120)})`,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
            filter: 'blur(70px) saturate(1.3)',
            maskImage: 'linear-gradient(to bottom, black, transparent)',
            WebkitMaskImage: 'linear-gradient(to bottom, black, transparent)',
          }}
        />
      )}

      <div className="relative mx-auto w-full max-w-[1400px] px-4 pb-24 md:px-12">
        {/* ── Top bar ──────────────────────────────────────────────── */}
        <div className="flex flex-wrap items-center justify-between gap-3 py-6">
          <button onClick={leave} className="flex items-center gap-1.5 text-[13px] font-medium text-[#57534e] hover:text-[#111]">
            <ArrowLeft size={16} /> Back
          </button>
          <div className="flex flex-wrap items-center justify-end gap-2">
            {/* Your rating and the side-by-side are different intentions, so
                each gets its own control, in this corner as on every page. */}
            {canCompare && shown.your_album_id != null && (
              <Link to={`/album/${shown.your_album_id}`} className={pill}>Your rating</Link>
            )}
            {canCompare && (
              <button onClick={() => setComparing((c) => !c)} className={pill}>
                {comparing ? 'Average rating' : 'Compare'}
              </button>
            )}
            {inLibrary && notRated && (
              <button
                onClick={removeCopy}
                disabled={busy === 'delete'}
                aria-label={`Remove ${shown.album_name} from your library`}
                className="ml-1 flex h-9 w-9 items-center justify-center rounded-full hover:bg-red-50 disabled:opacity-50"
                style={{ color: DANGER }}
              >
                {busy === 'delete' ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={16} />}
              </button>
            )}
          </div>
        </div>

        <div className="grid gap-10 lg:grid-cols-[380px_minmax(0,1fr)] xl:gap-16">
          {/* ── The record ─────────────────────────────────────────── */}
          <aside>
            <div className="lg:sticky lg:top-8">
              <div className="mx-auto w-full max-w-[380px] overflow-hidden rounded-[28px] shadow-[0_28px_60px_-28px_rgba(40,25,10,0.6)] pop-in">
                {shown.album_art_url ? (
                  <CoverImg url={shown.album_art_url} displayPx={380} loading="eager" alt="" className="block aspect-square w-full object-cover" />
                ) : (
                  <Cover artUrl={null} seed={shown.artist} size={380} radius={0} fontSize={120} />
                )}
              </div>
              <h1 className="font-display m-0 mt-6 text-[34px] font-bold leading-tight text-[#1c1917]">{shown.album_name}</h1>
              <p className="m-0 mt-1.5 text-[15px] text-[#57534e]">
                <Link to={`/artist/${encodeURIComponent(shown.artist)}`} className="font-semibold text-[#1c1917] hover:text-[#2d6a4f] hover:underline underline-offset-2">
                  {shown.artist}
                </Link>
                {shown.year ? ` · ${shown.year}` : ''}
              </p>
              {(shown.genre || subs.length > 0) && (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {shown.genre && (
                    <span className="rounded-full bg-[#2d6a4f]/10 px-2.5 py-1 text-[11.5px] font-semibold text-[#2d6a4f]">{shown.genre}</span>
                  )}
                  {subs.map((s) => (
                    <span key={s} className="rounded-full bg-[#efebe5] px-2.5 py-1 text-[11.5px] font-medium text-[#78716c]">{s}</span>
                  ))}
                </div>
              )}
            </div>
          </aside>

          {/* ── The room ───────────────────────────────────────────── */}
          <main className="min-w-0">
            {comparing && canCompare && shown.you ? (
              <CompareView data={shown} />
            ) : (
              <AveragedView
                data={shown}
                notRated={notRated}
                inLibrary={inLibrary}
                noOneElse={noOneElse}
                busy={busy}
                queued={queued}
                onRate={rate}
                onQueue={queue}
              />
            )}
            {error && <p className="m-0 mt-4 text-[13px] text-[#c0392b]">{error}</p>}
          </main>
        </div>
      </div>
    </div>
  )
}

/** A track row that pops up the first time it scrolls into view — mobile's
 *  tracklist is dealt out the same way. Rows that arrive together (the first
 *  screenful, or a fast scroll) are staggered by their position in that run,
 *  not by their place in the list, so row 14 doesn't wait behind thirteen
 *  delays. Under reduced motion every row is simply there. */
function RevealRow({ index, children }: { index: number; children: ReactNode }) {
  const ref = useRef<HTMLLIElement>(null)
  const [shown, setShown] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  )
  useEffect(() => {
    if (shown) return
    const el = ref.current
    if (!el) return
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setShown(true)
          io.disconnect()
        }
      },
      { threshold: 0.2, rootMargin: '0px 0px -6% 0px' },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [shown])
  return (
    <li
      ref={ref}
      className={shown ? 'pop-in' : 'opacity-0'}
      style={shown ? { animationDelay: `${(index % 6) * 45}ms` } : undefined}
    >
      {children}
    </li>
  )
}

// ── The averaged view ─────────────────────────────────────────────────────────

function AveragedView({
  data, notRated, inLibrary, noOneElse, busy, queued, onRate, onQueue,
}: {
  data: CommunityAlbumData
  notRated: boolean
  inLibrary: boolean
  noOneElse: boolean
  busy: 'rate' | 'queue' | 'delete' | null
  queued: boolean
  onRate: () => void
  onQueue: () => void
}) {
  const raters = `${data.rater_count} ${data.rater_count === 1 ? 'rater' : 'raters'}`
  const factors = [
    { label: 'Theme', value: data.avg_theme },
    { label: 'Replay', value: data.avg_replay_value },
    { label: 'Production', value: data.avg_production },
    { label: 'Distinctness', value: data.avg_distinctness },
  ]
  const showPrediction = notRated && data.predicted_score != null
  // Nobody else has rated it, so the way to get a comparison is to send it to
  // someone. Recommending needs a copy with a tracklist: yours when you have
  // one, otherwise the copy this page is built from. A release new to Pressd
  // has neither, so it gets no button.
  const recommendFrom = data.your_album_id ?? data.album_id
  const [recommending, setRecommending] = useState(false)

  return (
    <div>
      {/* What the userbase thinks, against what the model thinks you'll think —
          two readings of one album, sharing a card and a type size. The
          prediction is drawn hollow: same face, stroked, so the pair reads as
          measured against estimated without a second colour. */}
      <div className="flex items-stretch rise-in" style={stagger(0)}>
        <div className="flex-1 py-2">
          <p
            className="font-display m-0 text-[64px] font-bold leading-none tabular-nums"
            style={{ color: data.avg_score != null ? GREEN : '#c8c0b4' }}
          >
            {data.avg_score != null ? data.avg_score.toFixed(2) : '—'}
          </p>
          <p className="m-0 mt-2 text-[11px] font-bold tracking-[0.16em] text-[#2d6a4f]">PRESSD AVG</p>
          <p className="m-0 mt-0.5 text-[13px] text-[#8a7f72] tabular-nums">{raters}</p>
        </div>
        {showPrediction && (
          <>
            <div className="mx-8 my-2 w-px bg-[#e2dbd0]" />
            <div className="flex-1 py-2">
              <p
                className="font-display m-0 text-[64px] font-bold leading-none tabular-nums text-transparent [-webkit-text-stroke:2px_#2d6a4f]"
              >
                {data.predicted_score!.toFixed(2)}
              </p>
              <p className="m-0 mt-2 flex items-center gap-1 text-[11px] font-bold tracking-[0.16em] text-[#2d6a4f]">
                <Star size={11} fill={GREEN} strokeWidth={0} /> FOR YOU
              </p>
              <p className="m-0 mt-0.5 text-[13px] text-[#8a7f72]">predicted</p>
            </div>
          </>
        )}
      </div>

      {/* Nobody but you has rated it: no comparison to draw yet, so offer the
          thing that would create one. */}
      {noOneElse && recommendFrom != null && (
        <div className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-3 rise-in" style={stagger(1)}>
          <p className="m-0 text-[14.5px] text-[#57534e]">
            {data.you?.score != null
              ? <>No one else has rated <span className="font-semibold text-[#1c1917]">{data.album_name}</span> yet.</>
              : <>No one has rated it yet.</>}
          </p>
          <button
            onClick={() => setRecommending(true)}
            className="inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-[13.5px] font-semibold text-white"
            style={{ background: RECOMMEND }}
          >
            <Star size={13} fill="#fff" strokeWidth={0} /> Recommend to a friend
          </button>
        </div>
      )}
      {recommending && recommendFrom != null && (
        <RecommendModal
          album={{ id: recommendFrom, albumName: data.album_name, artist: data.artist }}
          onClose={() => setRecommending(false)}
        />
      )}

      {/* Why it's on your shelf, read off your own copy. */}
      {data.recommended_by_name && (
        <div className="mt-6 border-l-2 border-[#f3b98a] pl-4 rise-in" style={stagger(1)}>
          <p className="m-0 flex items-center gap-1.5 text-[13.5px] font-semibold" style={{ color: RECOMMEND }}>
            <Star size={13} fill={RECOMMEND} strokeWidth={0} /> Recommended by {data.recommended_by_name}
          </p>
          {data.recommendation_note && (
            <p className="font-display m-0 mt-1.5 text-[15px] leading-relaxed text-[#1c1917]">&ldquo;{data.recommendation_note}&rdquo;</p>
          )}
        </div>
      )}

      {factors.some((f) => f.value != null) && (
        <div className="mt-8 grid grid-cols-2 gap-y-5 sm:grid-cols-4">
          {factors.map((f, i) => (
            <div key={f.label} className="rise-in" style={stagger(2 + i)}>
              <p className="font-display m-0 text-[26px] font-bold leading-none tabular-nums" style={{ color: f.value != null ? songScoreColor(f.value) : '#c8c0b4' }}>
                {f.value != null ? f.value.toFixed(1) : '—'}
              </p>
              <p className="m-0 mt-1.5 text-[12px] font-medium text-[#8a7f72]">{f.label}</p>
            </div>
          ))}
        </div>
      )}

      {/* The two ways in sit side by side — alternatives, not a primary with an
          afterthought under it. Queueing only means anything for albums you
          don't hold. */}
      {(notRated || !inLibrary) && (
        <div className="mt-5 flex gap-2.5">
          {notRated && (
            <button
              onClick={onRate}
              disabled={busy === 'rate'}
              className="flex h-12 flex-1 items-center justify-center gap-2 rounded-xl bg-[#2d6a4f] text-[15px] font-semibold text-white hover:bg-[#245c43] disabled:opacity-70"
            >
              {busy === 'rate' ? <Loader2 size={16} className="animate-spin" /> : <Play size={14} fill="currentColor" />}
              {data.your_status === 'listening' ? 'Continue' : 'Rate now'}
            </button>
          )}
          {!inLibrary && (
            <button
              onClick={onQueue}
              disabled={busy === 'queue' || queued}
              className={`flex h-12 flex-1 items-center justify-center gap-2 rounded-xl text-[15px] font-semibold ${
                queued ? 'bg-[#2d6a4f]/10 text-[#2d6a4f]' : 'border border-[#d7cfc3] bg-white text-[#1c1917] hover:border-[#2d6a4f]'
              }`}
            >
              {busy === 'queue' ? <Loader2 size={16} className="animate-spin" /> : queued ? <Check size={16} className="pop" /> : <Plus size={16} />}
              {queued ? 'Added' : 'Add to Library'}
            </button>
          )}
        </div>
      )}

      <p className="m-0 mb-2 mt-9 text-[11px] font-bold tracking-[0.16em] text-[#a8998a]">TRACKS</p>
      <ol className="m-0 -mx-4 list-none p-0">
        {data.tracks.map((t, i) => (
          <RevealRow key={`${t.title}-${i}`} index={i}>
            <div className="flex items-center gap-4 rounded-2xl px-4 py-3 transition-colors hover:bg-[#f2eee7]">
              <span className="w-6 shrink-0 text-right text-[12.5px] text-[#b5aa9c] tabular-nums">{t.track_number}</span>
              <span className="min-w-0 flex-1 truncate text-[14.5px] text-[#1c1917]">{t.title}</span>
              <BangSkip score={t.avg_score} />
              {t.avg_score != null && (
                <span className="hidden w-[64px] text-right text-[11.5px] text-[#a8998a] tabular-nums sm:block">
                  {t.rater_count} {t.rater_count === 1 ? 'rater' : 'raters'}
                </span>
              )}
              <span
                className="font-display w-10 text-right text-[16px] font-bold tabular-nums"
                style={{ color: t.avg_score != null ? songScoreColor(t.avg_score) : '#c8c0b4' }}
              >
                {t.avg_score != null ? t.avg_score.toFixed(1) : '—'}
              </span>
            </div>
          </RevealRow>
        ))}
      </ol>
    </div>
  )
}

function BangSkip({ score }: { score: number | null }) {
  if (score == null) return null
  if (score >= BANG_THRESHOLD) {
    return <span className="text-[10px] font-bold tracking-[0.08em]" style={{ color: songScoreColor(score) }}>BANG</span>
  }
  if (score < SKIP_THRESHOLD) {
    return <span className="text-[10px] font-bold tracking-[0.08em]" style={{ color: songScoreColor(score) }}>SKIP</span>
  }
  return null
}

// ── The comparison ────────────────────────────────────────────────────────────

/** You against everyone else. Everyone else means `others_*`: the pooled
 *  average includes your own copy, and a panel headed "Pressd users | You"
 *  would otherwise count you on both sides — on a two-rater record that halves
 *  every gap. The lower score sits on the left, as on mobile. */
function CompareView({ data }: { data: CommunityAlbumData }) {
  const you = data.you!
  const avgScore = data.others_avg_score ?? data.avg_score!
  const cmpRaters = data.others_rater_count || data.rater_count
  const yourScore = you.score!
  const diff = yourScore - avgScore
  const youLeft = yourScore <= avgScore
  const pos = (v: number) => ((Math.max(5, Math.min(10, v)) - 5) / 5) * 100

  const otherScore = (t: CommunityTrack) => t.others_avg_score ?? t.avg_score
  let widest: { title: string; gap: number } | null = null
  for (const t of data.tracks) {
    const o = otherScore(t)
    if (o == null || t.your_score == null) continue
    const gap = Math.abs(t.your_score - o)
    if (!widest || gap > widest.gap) widest = { title: t.title, gap }
  }

  const youSide = { label: 'YOU', score: yourScore, color: '#44403c' }
  const themSide = { label: 'PRESSD USERS', score: avgScore, color: GREEN }
  const [left, right] = youLeft ? [youSide, themSide] : [themSide, youSide]

  return (
    <div>
      <div className="rise-in" style={stagger(0)}>
        <div className="flex items-stretch">
          {[left, right].map((side, i) => (
            <div key={side.label} className={`flex-1 ${i === 1 ? 'border-l border-[#e2dbd0] pl-8' : ''}`}>
              <p className="m-0 text-[11px] font-bold tracking-[0.16em]" style={{ color: side.color }}>{side.label}</p>
              <p className="font-display m-0 mt-1 text-[56px] font-bold leading-none tabular-nums" style={{ color: side.color }}>
                {side.score.toFixed(2)}
              </p>
            </div>
          ))}
        </div>

        {/* 5 to 10: where almost every album score lives, so the gap is visible. */}
        <div className="relative mt-6 h-2 rounded-full bg-[#2d6a4f]/15">
          <div
            className="grow-x absolute inset-y-0 left-0 rounded-full bg-[#2d6a4f]/45"
            style={{ width: `${Math.max(pos(avgScore), pos(yourScore))}%` }}
          />
          <span className="absolute top-1/2 h-4 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full" style={{ left: `${pos(avgScore)}%`, background: GREEN }} />
          <span className="absolute top-1/2 h-4 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#1c1917]" style={{ left: `${pos(yourScore)}%` }} />
        </div>
        <div className="mt-1.5 flex justify-between text-[11px] text-[#8a7f72] tabular-nums">
          {[5, 6, 7, 8, 9, 10].map((n) => <span key={n}>{n}</span>)}
        </div>

        {Math.abs(diff) < 0.005 ? (
          <p className="m-0 mt-5 text-[15px] text-[#1c1917]">You landed exactly on the Pressd average.</p>
        ) : (
          <p className="m-0 mt-5 text-[15px] text-[#1c1917]">
            You rated this{' '}
            <span className="font-bold tabular-nums" style={{ color: diff > 0 ? GREEN : '#c0392b' }}>{Math.abs(diff).toFixed(2)}</span>
            {` ${diff > 0 ? 'above' : 'below'} the Pressd average`}
          </p>
        )}
        {widest && widest.gap > 0 && (
          <p className="m-0 mt-1 text-[13.5px] text-[#57534e]">Biggest difference on &ldquo;{widest.title}&rdquo;</p>
        )}
        <p className="m-0 mt-1 text-[13px] text-[#8a7f72]">
          Averaged across {cmpRaters} other {cmpRaters === 1 ? 'rater' : 'raters'}
        </p>
      </div>

      <div className="mb-2 mt-9 flex items-baseline justify-between">
        <p className="m-0 text-[11px] font-bold tracking-[0.16em] text-[#a8998a]">TRACKS</p>
        <p className="m-0 text-[11px] font-bold tracking-[0.12em]">
          <span style={{ color: left.color }}>{left.label}</span>
          <span className="text-[#c2b8ad]"> / </span>
          <span style={{ color: right.color }}>{right.label}</span>
        </p>
      </div>
      <ol className="m-0 -mx-4 list-none p-0">
        {data.tracks.map((t, i) => {
          const leftVal = youLeft ? t.your_score : otherScore(t)
          const rightVal = youLeft ? otherScore(t) : t.your_score
          const isWidest = widest != null && widest.gap > 0 && t.title === widest.title
          return (
            <RevealRow key={`${t.title}-${i}`} index={i}>
              <div className={`flex items-center gap-4 rounded-2xl px-4 py-3 transition-colors hover:bg-[#f2eee7] ${isWidest ? 'bg-[#2d6a4f]/[0.07]' : ''}`}>
                <span className="w-6 shrink-0 text-right text-[12.5px] text-[#b5aa9c] tabular-nums">{t.track_number}</span>
                <span className={`min-w-0 flex-1 truncate text-[14.5px] ${isWidest ? 'font-semibold text-[#1c1917]' : 'text-[#1c1917]'}`}>{t.title}</span>
                <span className="font-display w-12 text-right text-[16px] font-bold tabular-nums" style={{ color: left.color }}>
                  {leftVal != null ? leftVal.toFixed(1) : '—'}
                </span>
                <span className="font-display w-12 text-right text-[16px] font-bold tabular-nums" style={{ color: right.color }}>
                  {rightVal != null ? rightVal.toFixed(1) : '—'}
                </span>
              </div>
            </RevealRow>
          )
        })}
      </ol>
    </div>
  )
}
