// Rating flow — one song at a time, the way mobile's rate/[id].tsx does it.
// Each track gets the stage to itself: title, runtime, a typed score, a colour
// ramp, and Next / Skip. After the last track the four album factors are rated
// (skipped for EPs), then an optional review, then submitting writes everything,
// asks about a tied top song if there is one, and surfaces the share card.
//
// This replaced a page that laid the whole tracklist out as a form. That form
// honoured the unlock rule by greying rows, but it still put the album's end in
// view from the first track — and the one-at-a-time constraint is the product
// (CLAUDE.md §1). The desktop adaptation is the rail: what mobile keeps behind a
// list button and below the fold (running average, the tracklist, where you
// stand) sits beside the stage, because a desktop window has the room.
//
// Songs unlock in track order on the first pass only. Anything already scored
// or skipped can be revisited, and a rated album is editable anywhere.
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, ArrowRight, Check, ListMusic, Loader2, Lock, Trash2, X } from 'lucide-react'
import {
  fetchAlbum, fetchAlbums, batchRateSongs, updateAlbum, fetchFactorStats, fetchFactorWeights,
  publishThoughts, setTopSong, deleteAlbum,
} from '../api'
import {
  computeAlbumScore, songScoreColor, tiedTopSongs, libraryPercentileLabel,
  BANG_THRESHOLD, SKIP_THRESHOLD, EP_MAX_TRACKS,
} from '../types'
import type { Song, Album } from '../types'
import ShareCardModal from '../components/ShareCard'
import TopSongTiebreak from '../components/TopSongTiebreak'
import { useUser } from '../context/UserContext'
import { useRecalibrationMessage } from '@pressd/shared/hooks/useRecalibration'
import CoverImg from '../components/CoverImg'
import { coverUrl } from '@pressd/shared/covers'

const DANGER = '#b91c1c'

/**
 * Covers the screen while a submitted rating settles.
 *
 * Mounted only for the duration of the wait, so the message sequence restarts
 * cleanly each submit. Not dismissible: the album is mid-recompute and there is
 * nothing useful to go back to until it lands.
 */
function RecalibratingOverlay() {
  const message = useRecalibrationMessage()
  return (
    <div
      className="fixed inset-0 z-50 flex flex-col items-center justify-center px-8 fade-in"
      style={{ background: 'rgba(249,248,246,.94)', backdropFilter: 'blur(3px)' }}
      role="status"
      aria-live="polite"
    >
      <div className="relative flex items-center justify-center mb-7" style={{ width: 74, height: 74 }}>
        <span className="absolute inset-0 rounded-full border-2 border-[#e3ebe6]" />
        <span className="absolute inset-0 rounded-full border-2 border-transparent border-t-[#2d6a4f] animate-spin" />
        <Check size={26} className="text-[#2d6a4f]" strokeWidth={2.5} />
      </div>
      <p key={message} className="m-0 text-center text-[17px] font-bold text-[#1c1917] rise-in">
        {message}
      </p>
    </div>
  )
}

/** A number that eases to its new value instead of jumping. */
function useCountUp(target: number | null, duration = 550) {
  const [display, setDisplay] = useState(0)
  const raf = useRef<number | undefined>(undefined)
  const from = useRef(0)
  useEffect(() => {
    if (target === null) return
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    cancelAnimationFrame(raf.current!)
    if (reduced) {
      raf.current = requestAnimationFrame(() => { setDisplay(target); from.current = target })
      return
    }
    const start = from.current
    const t0 = performance.now()
    const tick = (now: number) => {
      const p = Math.min(1, (now - t0) / duration)
      const e = 1 - Math.pow(1 - p, 3)
      const v = start + (target - start) * e
      setDisplay(v); from.current = v
      if (p < 1) raf.current = requestAnimationFrame(tick)
    }
    raf.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf.current!)
  }, [target, duration])
  return display
}

const FACTORS = [
  { key: 'theme', label: 'Theme / Cohesion', desc: 'Strength and cohesion of the central idea' },
  { key: 'replay', label: 'Replay Value', desc: 'How replayable the album is' },
  { key: 'production', label: 'Production', desc: 'Sound quality, mixing, sonic palette' },
  { key: 'distinctness', label: 'Distinctness', desc: 'Originality and genre-bending' },
] as const
type FactorKey = typeof FACTORS[number]['key']

// Long enough that typing "8.5" is one write rather than three, short enough
// that closing the tab mid-album has already saved. Same as mobile.
const AUTOSAVE_DELAY_MS = 1200

/** Text → score, tolerating partial input like "8." while typing. */
function parseScore(text: string): number | null {
  if (!text.trim()) return null
  const n = Number.parseFloat(text)
  if (!Number.isFinite(n)) return null
  return Math.max(0, Math.min(10, n))
}

/** Which tracks the user may jump to — the same function mobile uses, so the
 *  chips and the tracklist can never disagree about what is reachable. A
 *  track not yet reached stays out of reach: that first-pass constraint is the
 *  product. */
function canJumpTo(i: number, scores: (number | null)[], skipped: Set<number>, current: number): boolean {
  return scores[i] != null || skipped.has(i) || i === current
}

/** Keep only digits and a single decimal point, capped at 10. */
function cleanScoreText(text: string): string {
  let t = text.replace(/[^0-9.]/g, '')
  const firstDot = t.indexOf('.')
  if (firstDot !== -1) t = t.slice(0, firstDot + 1) + t.slice(firstDot + 1).replace(/\./g, '')
  const n = Number.parseFloat(t)
  if (Number.isFinite(n) && n > 10) return '10'
  return t.slice(0, 4)
}

function runtime(ms?: number | null): string | null {
  if (!ms) return null
  const total = Math.round(ms / 1000)
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

function stagger(i: number): CSSProperties {
  return { '--i': i } as CSSProperties
}

export default function RatingScreen() {
  const { id } = useParams()
  const albumId = Number(id)
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { isViewingFriend, activeUser } = useUser()
  // Route is gated by <RequireUser>, so activeUser is always present here.
  const userId = activeUser?.id ?? 0

  useEffect(() => {
    if (isViewingFriend) navigate(-1)
  }, [isViewingFriend, navigate])

  const { data: album, isLoading } = useQuery({
    queryKey: ['album', albumId],
    queryFn: () => fetchAlbum(albumId),
  })
  const { data: factorStats } = useQuery({
    queryKey: ['factor-stats'],
    queryFn: fetchFactorStats,
    staleTime: 5 * 60 * 1000,
  })
  // The user's own factor weights, so the projected score matches how the
  // server will score the album.
  const { data: factorWeights } = useQuery({
    queryKey: ['factor-weights', userId],
    queryFn: () => fetchFactorWeights(userId),
    enabled: userId > 0,
    staleTime: 5 * 60 * 1000,
  })
  // For "on pace for a top-N album". Shared cache with the onboarding gate and
  // Stats, so this is usually free.
  const { data: ratedAlbums = [] } = useQuery({
    queryKey: ['albums', 'rated', userId],
    queryFn: () => fetchAlbums({ status: 'rated', userId }),
    enabled: userId > 0,
  })

  const sortedSongs = useMemo(
    () => (album ? [...album.songs].sort((a, b) => (a.trackNumber ?? 0) - (b.trackNumber ?? 0)) : []),
    [album],
  )
  const isEP = (album?.songs.length ?? 0) <= EP_MAX_TRACKS
  const isEditing = album?.status === 'rated'

  const [drafts, setDrafts] = useState<string[]>([])
  const [review, setReview] = useState('')
  const [skipped, setSkipped] = useState<Set<number>>(new Set())
  const [idx, setIdx] = useState(0)
  // Which way the last move went, so the next track slides in from that side.
  const [dir, setDir] = useState<'next' | 'prev'>('next')
  const [phase, setPhase] = useState<'tracks' | 'factors' | 'review'>('tracks')
  const [factorText, setFactorText] = useState<Record<FactorKey, string>>({
    theme: '', replay: '', production: '', distinctness: '',
  })
  const [extraArtists, setExtraArtists] = useState('')
  const [listOpen, setListOpen] = useState(false)
  const [initialized, setInitialized] = useState(false)
  const [shareAlbum, setShareAlbum] = useState<Album | null>(null)
  // Held between submitting and the share card: the album whose top score two
  // or more tracks reached, waiting on the user to say which one counts.
  const [tiebreak, setTiebreak] = useState<Album | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Seed once the album arrives; resume at the first unscored track.
  if (album && !initialized) {
    const seeded = sortedSongs.map((s) => (s.score != null ? String(s.score) : ''))
    setDrafts(seeded)
    setReview(album.review ?? '')
    setFactorText({
      theme: album.theme != null ? String(album.theme) : '',
      replay: album.replayValue != null ? String(album.replayValue) : '',
      production: album.production != null ? String(album.production) : '',
      distinctness: album.distinctness != null ? String(album.distinctness) : '',
    })
    setExtraArtists(album.extraArtists.join(', '))
    const firstOpen = seeded.findIndex((t) => t === '')
    setIdx(firstOpen === -1 ? 0 : firstOpen)
    if (firstOpen === -1 && !isEP) setPhase('factors')
    setInitialized(true)
  }

  const scores = useMemo(() => drafts.map(parseScore), [drafts])
  const factorVals = useMemo(
    () => ({
      theme: parseScore(factorText.theme),
      replay: parseScore(factorText.replay),
      production: parseScore(factorText.production),
      distinctness: parseScore(factorText.distinctness),
    }),
    [factorText],
  )

  const withScores = scores.filter((s): s is number => s !== null)
  const runningAvg = withScores.length ? withScores.reduce((a, b) => a + b, 0) / withScores.length : null
  const bangs = withScores.filter((s) => s >= BANG_THRESHOLD).length
  const skips = withScores.filter((s) => s < SKIP_THRESHOLD).length
  const done = scores.filter((s, i) => s !== null || skipped.has(i)).length

  const songsComplete = drafts.length > 0 && drafts.every((t, i) => parseScore(t) !== null || skipped.has(i))
  const factorsComplete =
    isEP || (factorVals.theme !== null && factorVals.replay !== null &&
             factorVals.production !== null && factorVals.distinctness !== null)
  const canSubmit = songsComplete && factorsComplete

  const previewScore =
    songsComplete && factorsComplete && (isEP || factorStats)
      ? isEP
        ? runningAvg !== null ? Math.round(runningAvg * 100) / 100 : null
        : computeAlbumScore(
            sortedSongs.map((s, i) => ({ ...s, score: scores[i] })) as Song[],
            factorVals.theme!, factorVals.replay!, factorVals.production!, factorVals.distinctness!,
            factorStats!,
            factorWeights?.points,
          )
      : null

  // Where this album would land in the library if it finished at the running
  // avg, as a percentile. Needs a library of ten for the number to mean much.
  const pace = useMemo(() => {
    if (runningAvg == null || ratedAlbums.length < 10) return null
    const others = ratedAlbums.filter((a) => a.id !== albumId && a.score != null).map((a) => a.score!)
    return libraryPercentileLabel(runningAvg, others)
  }, [runningAvg, ratedAlbums, albumId])

  // The rail's headline: the projected final once it can be computed, the
  // running song average until then.
  const headline = previewScore ?? runningAvg
  const shownHeadline = useCountUp(headline)

  function setDraftAt(i: number, text: string) {
    setDrafts((prev) => {
      const next = [...prev]
      next[i] = cleanScoreText(text)
      return next
    })
    if (skipped.has(i)) {
      setSkipped((prev) => {
        const next = new Set(prev)
        next.delete(i)
        return next
      })
    }
  }

  function goTo(i: number) {
    setDir(i < idx || phase !== 'tracks' ? 'prev' : 'next')
    setListOpen(false)
    setPhase('tracks')
    setIdx(i)
  }

  function advance() {
    setDir('next')
    if (idx < sortedSongs.length - 1) setIdx(idx + 1)
    else setPhase('factors')
  }

  function onNext() {
    if (parseScore(drafts[idx] ?? '') === null) return
    advance()
  }

  function onSkip() {
    setSkipped((prev) => new Set(prev).add(idx))
    setDrafts((prev) => {
      const next = [...prev]
      next[idx] = ''
      return next
    })
    advance()
  }

  const persist = async (status: 'rated' | 'listening') => {
    if (!album) return
    await batchRateSongs(sortedSongs.map((song, i) => ({ id: song.id, score: scores[i] ?? null })), userId)
    const parsedExtra = extraArtists.split(',').map((s) => s.trim()).filter(Boolean)
    await updateAlbum(album.id, {
      ...(isEP
        ? {}
        : {
            theme: factorVals.theme,
            replay_value: factorVals.replay,
            production: factorVals.production,
            distinctness: factorVals.distinctness,
          }),
      status,
      extra_artists: parsedExtra.length ? JSON.stringify(parsedExtra) : null,
    })
  }

  const submit = useMutation({
    mutationFn: async () => {
      await persist('rated')
      // After the rating, never as part of it: a review is a consequence of
      // having rated the record, and a thread that refuses a post must not be
      // able to cost someone the rating they just spent an album on.
      await publishThoughts(albumId, review.trim() || null).catch(() => {})
    },
    onSuccess: async () => {
      setError(null)
      queryClient.invalidateQueries({ queryKey: ['albums'] })
      queryClient.invalidateQueries({ queryKey: ['stats'] })
      queryClient.invalidateQueries({ queryKey: ['album', albumId] })
      queryClient.invalidateQueries({ queryKey: ['thread'] })
      const fresh = await fetchAlbum(albumId).catch(() => null)
      if (!fresh) {
        navigate(`/album/${albumId}`, { replace: true })
        return
      }
      // Ask about a tie before the share card, since the card is one of the
      // things that has to name a single favourite.
      if (tiedTopSongs(fresh).length > 1) setTiebreak(fresh)
      else setShareAlbum(fresh)
    },
    onError: () => setError('Could not save your rating. Please try again.'),
  })

  // Recording the pick shouldn't be able to cost someone their share card, so
  // a failure falls through to it rather than stranding them on the dialog.
  const chooseTopSong = useMutation({
    mutationFn: (songId: number) => setTopSong(albumId, songId),
    onSuccess: (_updated, songId) => {
      setShareAlbum(tiebreak ? { ...tiebreak, topSongId: songId } : null)
    },
    onError: () => setShareAlbum(tiebreak),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['album', albumId] })
      queryClient.invalidateQueries({ queryKey: ['reviews'] })
      setTiebreak(null)
    },
  })

  const saveDraft = useMutation({
    mutationFn: () => persist(isEditing ? 'rated' : 'listening'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['albums'] })
      queryClient.invalidateQueries({ queryKey: ['album', albumId] })
      navigate(-1)
    },
    onError: () => setError('Could not save. Please try again.'),
  })

  const remove = useMutation({
    mutationFn: () => deleteAlbum(albumId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['albums'] })
      queryClient.invalidateQueries({ queryKey: ['stats'] })
      navigate('/library', { replace: true })
    },
    onError: () => setError('Could not delete this album. Please try again.'),
  })

  // ── Autosave ──────────────────────────────────────────────────────────────
  // Writes exactly what Save draft writes, after a pause in typing, so closing
  // the tab mid-album costs nothing: scores live on the songs, and seeding reads
  // them back and resumes at the first unscored track.
  const lastSavedRef = useRef<string | null>(null)
  const autosaving = useRef(false)
  // Where you are sitting (idx, phase) is left out deliberately: it is derived
  // on the way back in, and including it would write on every Next.
  const snapshot = useMemo(
    () => JSON.stringify({ drafts, factorText, extraArtists, skipped: [...skipped].sort() }),
    [drafts, factorText, extraArtists, skipped],
  )

  useEffect(() => {
    if (!album || !initialized) return
    if (album.userId !== userId) return // not yours to write
    // Submitting owns the record from here; an autosave landing after it would
    // put `listening` back on an album that just finished being rated.
    if (submit.isPending || saveDraft.isPending || submit.isSuccess || remove.isPending) return
    if (tiebreak || shareAlbum) return
    // The first pass after seeding sets the baseline, so opening a part-rated
    // album doesn't immediately write back what it just read.
    if (lastSavedRef.current === null) {
      lastSavedRef.current = snapshot
      return
    }
    if (snapshot === lastSavedRef.current) return

    const t = setTimeout(async () => {
      if (autosaving.current) return
      autosaving.current = true
      const attempted = snapshot
      try {
        await persist(isEditing ? 'rated' : 'listening')
        lastSavedRef.current = attempted
        queryClient.invalidateQueries({ queryKey: ['albums'] })
      } catch {
        // Silent, and the baseline is left alone so the next edit retries.
        // Save draft still reports failure, which is where it matters.
      } finally {
        autosaving.current = false
      }
    }, AUTOSAVE_DELAY_MS)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshot, album, initialized, isEditing, submit.isPending, submit.isSuccess, saveDraft.isPending, remove.isPending, tiebreak, shareAlbum])

  // Escape closes the tracklist sheet.
  useEffect(() => {
    if (!listOpen) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setListOpen(false) }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [listOpen])

  if (tiebreak) {
    const tied = tiedTopSongs(tiebreak)
    return (
      <div className="min-h-screen bg-[#f9f8f6]">
        <TopSongTiebreak
          songs={tied}
          score={tied[0]?.score ?? 0}
          busy={chooseTopSong.isPending}
          onPick={(songId) => chooseTopSong.mutate(songId)}
          onSkip={() => {
            setShareAlbum(tiebreak)
            setTiebreak(null)
          }}
        />
      </div>
    )
  }

  if (shareAlbum) {
    return (
      <ShareCardModal
        album={shareAlbum}
        onClose={() => navigate(`/album/${albumId}`, { replace: true })}
      />
    )
  }

  if (isLoading || !album) {
    return (
      <div className="min-h-screen bg-[#f9f8f6] flex items-center justify-center text-[#aaa] gap-2">
        <Loader2 size={16} className="animate-spin" /> Loading album…
      </div>
    )
  }

  // Someone else's copy is not yours to score. The server refuses every write
  // anyway, so fail at the door rather than after a whole album of scoring.
  if (album.userId !== userId) {
    return (
      <div className="min-h-screen bg-[#f9f8f6] flex flex-col items-center justify-center text-center px-6">
        <p className="font-display text-2xl font-bold text-[#1c1917] m-0">This isn&rsquo;t your rating</p>
        <p className="text-sm text-[#78716c] mt-2 max-w-sm leading-relaxed">
          You can read {album.albumName} on its album page, but only its owner can score it.
        </p>
        <button
          onClick={() => navigate(-1)}
          className="mt-5 px-5 py-2 rounded-full bg-[#2d6a4f]/10 text-[#2d6a4f] text-sm font-semibold hover:bg-[#2d6a4f]/15"
        >
          Go back
        </button>
      </div>
    )
  }

  const busy = submit.isPending || saveDraft.isPending || remove.isPending
  const song = sortedSongs[idx]
  const currentScore = parseScore(drafts[idx] ?? '')
  const isLast = idx === sortedSongs.length - 1

  // ── Pieces shared by the stage (narrow) and the rail (wide) ────────────────

  const chips = (
    <div className="flex gap-1 mt-3">
      {sortedSongs.map((s, i) => {
        const v = scores[i]
        const open = canJumpTo(i, scores, skipped, idx)
        return (
          <button
            key={s.id}
            onClick={() => open && goTo(i)}
            disabled={!open}
            title={`${s.trackNumber ?? i + 1}. ${s.title}${v != null ? ` — ${v.toFixed(1)}` : skipped.has(i) ? ' — skipped' : ''}`}
            aria-label={
              `Track ${s.trackNumber ?? i + 1}, ${s.title}` +
              (v != null ? `, scored ${v.toFixed(1)}` : skipped.has(i) ? ', skipped' : i === idx ? ', rating now' : ', locked')
            }
            className={`flex-1 h-2.5 rounded-full transition-[background-color,box-shadow,transform] duration-300 ${open ? 'cursor-pointer hover:scale-y-150' : 'cursor-default'}`}
            style={{
              background: v != null ? songScoreColor(v) : '#ece6dc',
              boxShadow: i === idx && phase === 'tracks' ? '0 0 0 2px #f9f8f6, 0 0 0 3.5px #2d6a4f' : undefined,
            }}
          />
        )
      })}
    </div>
  )

  const runCard = (
    <div className="rounded-2xl border border-[#e8e2d9] bg-white/70 p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="m-0 text-[10px] font-bold tracking-[0.14em] text-[#2d6a4f]">
            {previewScore != null ? 'PROJECTED FINAL' : 'RUNNING AVG'}
          </p>
          <p
            className="m-0 mt-1 font-display text-[44px] font-bold leading-none tabular-nums"
            style={{ color: headline != null ? songScoreColor(headline) : '#c8c0b4' }}
          >
            {headline != null ? shownHeadline.toFixed(2) : '—'}
          </p>
        </div>
        <div className="text-right text-[12px] text-[#8a7f72] leading-[1.7] pt-1">
          <p className="m-0">{bangs} bang{bangs === 1 ? '' : 's'} · {skips} skip{skips === 1 ? '' : 's'}</p>
          {album.predictedScore != null && <p className="m-0">predicted {album.predictedScore.toFixed(2)}</p>}
          {pace != null && <p className="m-0">on pace for {pace}</p>}
        </div>
      </div>
      {chips}
    </div>
  )

  const trackList = (
    <ol className="m-0 p-0 list-none">
      {sortedSongs.map((s, i) => {
        const v = scores[i]
        const isSkipped = skipped.has(i)
        const current = phase === 'tracks' && i === idx
        const open = canJumpTo(i, scores, skipped, phase === 'tracks' ? idx : -1)
        return (
          <li key={s.id}>
            <button
              onClick={() => open && goTo(i)}
              disabled={!open}
              className={`w-full grid grid-cols-[22px_minmax(0,1fr)_auto] items-center gap-3 px-2.5 py-2 rounded-lg text-left transition-colors ${
                current ? 'bg-[#2d6a4f]/10' : open ? 'hover:bg-[#f2f0ec]' : ''
              }`}
            >
              <span className="text-[11.5px] text-[#b5aa9c] tabular-nums text-right">{s.trackNumber ?? i + 1}</span>
              <span className={`text-[13.5px] truncate ${current ? 'font-semibold text-[#1c1917]' : v != null ? 'text-[#44403c]' : 'text-[#b5aa9c]'}`}>
                {s.title}
              </span>
              {v != null ? (
                <span key={v} className="pop font-display text-[14px] font-bold tabular-nums" style={{ color: songScoreColor(v) }}>
                  {v.toFixed(1)}
                </span>
              ) : isSkipped ? (
                <span className="text-[11px] text-[#b5aa9c]">skipped</span>
              ) : current ? (
                <span className="text-[11px] font-semibold text-[#2d6a4f]">now</span>
              ) : (
                <Lock size={11} className="text-[#cfc6b8]" />
              )}
            </button>
          </li>
        )
      })}
    </ol>
  )

  return (
    <div className="relative min-h-screen bg-[#f9f8f6] overflow-x-hidden">
      {submit.isPending && <RecalibratingOverlay />}

      {/* The record's colour, faintly, behind the top of the page — the web
          version of mobile's subtle AlbumBackdrop. */}
      {album.albumArtUrl && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-[420px] opacity-[0.22] fade-in"
          style={{
            // Blurred 70px: a small image is all it needs.
            backgroundImage: `url(${coverUrl(album.albumArtUrl, 120)})`,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
            filter: 'blur(70px) saturate(1.3)',
            maskImage: 'linear-gradient(to bottom, black, transparent)',
            WebkitMaskImage: 'linear-gradient(to bottom, black, transparent)',
          }}
        />
      )}

      <div className="relative mx-auto w-full max-w-[1400px] px-4 md:px-10 pb-20">
        {/* ── Top bar ───────────────────────────────────────────────── */}
        <div className="flex items-center gap-3 pt-5 pb-4">
          <button
            onClick={() => navigate(-1)}
            aria-label="Back"
            className="w-9 h-9 rounded-full flex items-center justify-center text-[#57534e] hover:bg-black/5"
          >
            <ArrowLeft size={18} />
          </button>
          {album.albumArtUrl ? (
            <CoverImg url={album.albumArtUrl} displayPx={40} alt="" className="w-10 h-10 rounded-lg object-cover shrink-0 lg:hidden" />
          ) : null}
          <div className="min-w-0 flex-1 lg:hidden">
            <p className="m-0 text-[14.5px] font-semibold text-[#1c1917] truncate">{album.albumName}</p>
            <p className="m-0 text-[12.5px] text-[#8a7f72] truncate">{album.artist}</p>
          </div>
          <div className="flex-1 hidden lg:block" />
          <button
            onClick={() => { setError(null); saveDraft.mutate() }}
            disabled={busy}
            className="text-[13.5px] font-semibold text-[#2d6a4f] hover:text-[#245c43] px-3 py-1.5 rounded-lg hover:bg-[#2d6a4f]/8 disabled:opacity-40 flex items-center gap-1.5"
          >
            {saveDraft.isPending && <Loader2 size={13} className="animate-spin" />}
            {saveDraft.isPending ? 'Saving…' : 'Save draft'}
          </button>
        </div>

        {/* ── Progress ──────────────────────────────────────────────── */}
        <div className="flex items-center gap-3 mb-8">
          <div className="flex-1 h-1.5 rounded-full bg-[#e8e2d9] overflow-hidden">
            <div
              className="h-full rounded-full bg-[#2d6a4f] transition-[width] duration-500 ease-out"
              style={{ width: `${(done / Math.max(1, sortedSongs.length)) * 100}%` }}
            />
          </div>
          <span className="text-[12px] font-medium text-[#8a7f72] tabular-nums">{done} / {sortedSongs.length}</span>
        </div>

        <div className="grid lg:grid-cols-[minmax(0,1fr)_380px] gap-10 xl:gap-16">
          {/* ── Stage ─────────────────────────────────────────────── */}
          <main className="min-w-0">
            <div className="max-w-[640px] mx-auto lg:pt-6">
              {phase === 'tracks' && song ? (
                <div key={`t${idx}`} className={dir === 'next' ? 'slide-next' : 'slide-prev'}>
                  <p className="m-0 text-center text-[11px] font-bold tracking-[0.16em] text-[#a8998a]">
                    TRACK {song.trackNumber ?? idx + 1}
                  </p>
                  <h1 className="m-0 mt-2 text-center font-display text-[34px] md:text-[44px] leading-tight font-bold text-[#1c1917] break-words">
                    {song.title}
                  </h1>
                  {runtime(song.durationMs) && (
                    <p className="m-0 mt-1.5 text-center text-[13px] font-medium text-[#a8998a] tabular-nums">
                      {runtime(song.durationMs)}
                    </p>
                  )}

                  <ScoreField
                    value={drafts[idx] ?? ''}
                    onChange={(t) => setDraftAt(idx, t)}
                    onEnter={onNext}
                    label={skipped.has(idx) ? 'SKIPPED' : 'YOUR SCORE'}
                  />
                  <ScoreScale value={currentScore} />

                  {/* Offered, never prefilled: writing it into the draft would
                      unlock the next track and hand the user a number they
                      never agreed to. One click is the whole saving. */}
                  {song.carriedScore != null && song.score == null && !drafts[idx] && (
                    <button
                      onClick={() => setDraftAt(idx, String(song.carriedScore))}
                      className="rise-in mt-5 w-full flex items-center gap-3 rounded-xl border border-[#d7e6dd] bg-[#2d6a4f]/5 hover:bg-[#2d6a4f]/10 px-4 py-3 text-left"
                    >
                      <span className="flex-1 min-w-0 text-[13.5px] text-[#57534e]">
                        You rated this {song.carriedScore.toFixed(1)} on{' '}
                        <span className="font-semibold text-[#1c1917]">{song.carriedFromAlbumName}</span>
                      </span>
                      <span className="text-[13px] font-bold text-[#2d6a4f]">Use it</span>
                    </button>
                  )}

                  <div className="flex items-center gap-2 mt-7">
                    <button
                      onClick={() => setListOpen(true)}
                      aria-label="Jump to a track"
                      className="lg:hidden w-12 h-12 shrink-0 rounded-xl border border-[#e2dbd0] bg-white text-[#57534e] flex items-center justify-center hover:bg-[#f5f1ea]"
                    >
                      <ListMusic size={19} />
                    </button>
                    {idx > 0 && (
                      <button
                        onClick={() => goTo(idx - 1)}
                        aria-label="Previous track"
                        className="w-12 h-12 shrink-0 rounded-xl border border-[#e2dbd0] bg-white text-[#57534e] flex items-center justify-center hover:bg-[#f5f1ea]"
                      >
                        <ArrowLeft size={18} />
                      </button>
                    )}
                    <button
                      onClick={onNext}
                      disabled={currentScore === null}
                      className="flex-1 h-12 rounded-xl bg-[#2d6a4f] hover:bg-[#245c43] text-white text-[15px] font-semibold flex items-center justify-center gap-2 disabled:bg-[#e8e2d9] disabled:text-[#a8998a]"
                    >
                      {!isLast ? 'Next track' : isEP ? 'Finish' : 'Rate the album'} <ArrowRight size={16} />
                    </button>
                    <button
                      onClick={onSkip}
                      className="h-12 px-5 shrink-0 rounded-xl text-[14px] font-semibold text-[#8a7f72] hover:bg-black/5"
                    >
                      Skip
                    </button>
                  </div>

                  {/* Narrow windows: the rail's contents, below the controls,
                      the way mobile stacks them. */}
                  <div className="lg:hidden mt-8">
                    {runCard}
                    {!isLast && (
                      <div className="mt-6">
                        <p className="m-0 mb-2 text-[10.5px] font-bold tracking-[0.16em] text-[#a8998a]">UP NEXT</p>
                        {sortedSongs.slice(idx + 1, idx + 4).map((s) => (
                          <div key={s.id} className="flex items-center gap-3 py-2 border-b border-[#f0ebe3]">
                            <span className="w-5 text-right text-[12px] text-[#b5aa9c]">{s.trackNumber}</span>
                            <span className="flex-1 truncate text-[13.5px] text-[#a8998a]">{s.title}</span>
                            <Lock size={11} className="text-[#cfc6b8]" />
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ) : phase === 'factors' ? (
                <div key="factors" className="slide-next">
                  <p className="m-0 text-center text-[11px] font-bold tracking-[0.16em] text-[#a8998a]">{isEP ? 'FINISH' : 'THE ALBUM'}</p>
                  <h1 className="m-0 mt-2 text-center font-display text-[34px] md:text-[44px] leading-tight font-bold text-[#1c1917]">
                    {album.albumName}
                  </h1>
                  <p className="m-0 mt-1.5 text-center text-[13px] font-medium text-[#a8998a]">
                    {withScores.length} track{withScores.length === 1 ? '' : 's'} scored · avg{' '}
                    {runningAvg != null ? runningAvg.toFixed(2) : '—'}
                  </p>

                  {!songsComplete && (
                    <p className="mt-5 mb-0 rounded-xl bg-[#fdf3e7] text-[#9a5b13] text-[13px] px-4 py-2.5 text-center">
                      Every track needs a score or a skip before you can submit.
                    </p>
                  )}

                  {/* An EP scores as its song mean and never reads these, so it
                      gets the finish step without four inputs that change nothing. */}
                  {!isEP && (
                  <div className="mt-7 rounded-2xl border border-[#e8e2d9] bg-white/70 overflow-hidden">
                    {FACTORS.map(({ key, label, desc }, i) => {
                      const v = factorVals[key]
                      return (
                        <label
                          key={key}
                          className={`rise-in flex items-center gap-4 px-5 py-4 cursor-text ${i < FACTORS.length - 1 ? 'border-b border-[#f0ebe3]' : ''}`}
                          style={stagger(i)}
                        >
                          <span className="flex-1 min-w-0">
                            <span className="block text-[15px] font-semibold text-[#1c1917]">{label}</span>
                            <span className="block text-[12.5px] text-[#8a7f72] mt-0.5">{desc}</span>
                          </span>
                          <input
                            data-factor={i}
                            value={factorText[key]}
                            onChange={(e) => setFactorText((prev) => ({ ...prev, [key]: cleanScoreText(e.target.value) }))}
                            onKeyDown={(e) => {
                              if (e.key !== 'Enter') return
                              e.preventDefault()
                              // Enter walks down the four, then moves on once
                              // they're all in.
                              const next = document.querySelector<HTMLInputElement>(`[data-factor="${i + 1}"]`)
                              if (next) next.focus()
                              else if (canSubmit) setPhase('review')
                            }}
                            autoFocus={i === 0}
                            inputMode="decimal"
                            placeholder="—"
                            maxLength={4}
                            className="w-20 h-12 text-center rounded-xl border border-[#e2dbd0] bg-[#faf8f5] font-display text-[22px] font-bold tabular-nums focus:outline-none focus:border-[#2d6a4f] focus:bg-white transition-colors"
                            style={{ color: v != null ? songScoreColor(v) : undefined }}
                          />
                        </label>
                      )
                    })}
                  </div>
                  )}

                  <label className="block mt-5">
                    <span className="block mb-1.5 text-[10.5px] font-bold tracking-[0.16em] text-[#a8998a]">ADDITIONAL ARTISTS</span>
                    <input
                      value={extraArtists}
                      onChange={(e) => setExtraArtists(e.target.value)}
                      placeholder="Comma-separated, e.g. Kanye West, Jay-Z"
                      className="w-full h-11 px-4 rounded-xl border border-[#e2dbd0] bg-white/70 text-[14px] text-[#1c1917] placeholder:text-[#c2b8ad] focus:outline-none focus:border-[#2d6a4f]"
                    />
                  </label>

                  <div className="lg:hidden">
                    {previewScore !== null && <Projected score={previewScore} />}
                  </div>

                  {error && <p className="text-[#c0392b] text-[13px] text-center mt-4 mb-0">{error}</p>}

                  <button
                    onClick={() => { setDir('next'); setPhase('review') }}
                    disabled={!canSubmit || busy}
                    className="mt-7 w-full h-12 rounded-xl bg-[#2d6a4f] hover:bg-[#245c43] text-white text-[15px] font-semibold flex items-center justify-center gap-2 disabled:bg-[#e8e2d9] disabled:text-[#a8998a]"
                  >
                    Next: your review <ArrowRight size={16} />
                  </button>
                  <button
                    onClick={() => goTo(sortedSongs.length - 1)}
                    className="mt-2 w-full py-2.5 text-[13.5px] font-semibold text-[#8a7f72] hover:text-[#1c1917]"
                  >
                    Back to tracks
                  </button>
                </div>
              ) : (
                /* Review — the last thing before submitting, because you have
                   just finished the record and this is when you have something
                   to say. An empty box submits the rating and posts nothing. */
                <div key="review" className="slide-next">
                  <p className="m-0 text-center text-[11px] font-bold tracking-[0.16em] text-[#a8998a]">YOUR REVIEW</p>
                  <h1 className="m-0 mt-2 text-center font-display text-[34px] md:text-[44px] leading-tight font-bold text-[#1c1917]">
                    {album.albumName}
                  </h1>
                  {previewScore != null && (
                    <p
                      className="m-0 mt-1.5 text-center font-display text-[18px] font-bold tabular-nums"
                      style={{ color: songScoreColor(previewScore) }}
                    >
                      {previewScore.toFixed(2)}
                    </p>
                  )}

                  <textarea
                    value={review}
                    onChange={(e) => setReview(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !busy) submit.mutate()
                    }}
                    autoFocus
                    rows={8}
                    placeholder="What did you make of it?"
                    className="mt-7 w-full resize-none rounded-2xl border border-[#e2dbd0] bg-white/80 px-5 py-4 font-display text-[16px] leading-relaxed text-[#1c1917] placeholder:text-[#c2b8ad] focus:outline-none focus:border-[#2d6a4f]"
                  />

                  {error && <p className="text-[#c0392b] text-[13px] text-center mt-4 mb-0">{error}</p>}

                  <button
                    onClick={() => { setError(null); submit.mutate() }}
                    disabled={busy || !canSubmit}
                    className="mt-5 w-full h-12 rounded-xl bg-[#2d6a4f] hover:bg-[#245c43] text-white text-[15px] font-semibold flex items-center justify-center gap-2 disabled:bg-[#e8e2d9] disabled:text-[#a8998a]"
                  >
                    {submit.isPending ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
                    {isEditing ? 'Update rating' : 'Submit rating'}
                  </button>
                  <button
                    onClick={() => { setDir('prev'); setPhase('factors') }}
                    className="mt-2 w-full py-2.5 text-[13.5px] font-semibold text-[#8a7f72] hover:text-[#1c1917]"
                  >
                    Back
                  </button>
                </div>
              )}

              {/* Well past the controls used to finish a rating: abandoning one
                  is a real thing to want, but it shouldn't sit near Submit. */}
              <button
                onClick={() => {
                  if (confirm(`Delete ${album.albumName} from your library? Your scores for it will be lost.`)) remove.mutate()
                }}
                disabled={busy}
                className="mt-16 mx-auto flex items-center gap-1.5 text-[12.5px] font-medium hover:underline disabled:opacity-40"
                style={{ color: DANGER }}
              >
                {remove.isPending ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                Delete album
              </button>
            </div>
          </main>

          {/* ── Rail (wide windows) ──────────────────────────────────── */}
          <aside className="hidden lg:block">
            <div className="sticky top-6 flex flex-col gap-5">
              <div className="flex items-center gap-4">
                {album.albumArtUrl ? (
                  <CoverImg
                    url={album.albumArtUrl}
                    displayPx={96}
                    alt=""
                    className="w-24 h-24 rounded-2xl object-cover shrink-0 shadow-[0_16px_34px_-16px_rgba(50,30,10,0.5)]"
                  />
                ) : (
                  <div className="w-24 h-24 rounded-2xl bg-[#ece6dc] shrink-0" />
                )}
                <div className="min-w-0">
                  <p className="m-0 font-display text-[22px] leading-tight font-bold text-[#1c1917] line-clamp-2">{album.albumName}</p>
                  <p className="m-0 mt-1 text-[13.5px] text-[#8a7f72] truncate">
                    {[album.artist, ...album.extraArtists].join(', ')}{album.year ? ` · ${album.year}` : ''}
                  </p>
                </div>
              </div>

              {runCard}

              <div className="rounded-2xl border border-[#e8e2d9] bg-white/70 p-2 max-h-[calc(100vh-420px)] min-h-[160px] overflow-y-auto">
                {trackList}
              </div>
            </div>
          </aside>
        </div>
      </div>

      {/* Narrow windows: the tracklist as a sheet, like mobile's. */}
      {listOpen && (
        <div className="lg:hidden fixed inset-0 z-50 flex items-end sm:items-center justify-center" role="dialog" aria-modal="true">
          <div className="absolute inset-0 bg-black/30 fade-in" onClick={() => setListOpen(false)} />
          <div className="relative w-full sm:max-w-md bg-[#faf8f5] rounded-t-3xl sm:rounded-3xl p-4 pb-6 max-h-[75vh] overflow-y-auto pop-in">
            <div className="flex items-center justify-between px-2 mb-2">
              <p className="m-0 font-display text-[20px] font-bold text-[#1c1917]">Tracks</p>
              <button onClick={() => setListOpen(false)} aria-label="Close" className="text-[#a8998a] hover:text-[#57534e]">
                <X size={19} />
              </button>
            </div>
            {trackList}
          </div>
        </div>
      )}
    </div>
  )
}

/** The big typed score. The number itself is the input; Enter moves on. */
function ScoreField({
  value, onChange, onEnter, label,
}: {
  value: string
  onChange: (t: string) => void
  onEnter: () => void
  label: string
}) {
  const n = parseScore(value)
  return (
    <div className="mt-8 flex flex-col items-center">
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onEnter() } }}
        onFocus={(e) => e.currentTarget.select()}
        autoFocus
        inputMode="decimal"
        placeholder="—"
        maxLength={4}
        aria-label="Score"
        className="w-[260px] bg-transparent text-center font-display font-bold leading-none tabular-nums focus:outline-none placeholder:text-[#d6cec2] transition-colors"
        style={{ fontSize: 104, color: n != null ? songScoreColor(n) : '#c8c0b4', outline: 'none' }}
      />
      <p className="m-0 mt-2 text-[10.5px] font-bold tracking-[0.16em] text-[#a8998a]">{label}</p>
    </div>
  )
}

/** Where the typed score lands on the 0–10 ramp. The dot slides between
 *  values rather than jumping, so a digit typed or deleted reads as the same
 *  dot moving. */
function ScoreScale({ value }: { value: number | null }) {
  return (
    <div className="mt-6 max-w-[480px] mx-auto">
      <div className="relative h-2.5">
        <div className="flex h-full rounded-full overflow-hidden">
          {Array.from({ length: 10 }, (_, i) => (
            <div key={i} className="flex-1" style={{ background: songScoreColor(i + 0.5) }} />
          ))}
        </div>
        <div
          className="absolute top-1/2 w-5 h-5 -ml-2.5 -mt-2.5 rounded-full bg-white border-[3px] border-[#1c1917] shadow-md transition-[left,opacity] duration-300 ease-[cubic-bezier(0.34,1.4,0.64,1)]"
          style={{ left: `${((value ?? 0) / 10) * 100}%`, opacity: value == null ? 0 : 1 }}
        />
      </div>
      <div className="flex justify-between mt-1.5 text-[11px] text-[#b5aa9c] tabular-nums">
        <span>0</span>
        <span>10</span>
      </div>
    </div>
  )
}

function Projected({ score }: { score: number }) {
  return (
    <div className="mt-7 text-center pop-in">
      <p className="m-0 font-display text-[52px] font-bold leading-none tabular-nums" style={{ color: '#2d6a4f' }}>
        {score.toFixed(2)}
      </p>
      <p className="m-0 mt-1.5 text-[10.5px] font-bold tracking-[0.16em] text-[#2d6a4f]">PROJECTED FINAL</p>
    </div>
  )
}
