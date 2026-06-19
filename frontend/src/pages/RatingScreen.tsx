import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Check, Loader2, Save, SkipForward } from 'lucide-react'
import { fetchAlbum, batchRateSongs, updateAlbum, fetchFactorStats, fetchAlbumReport } from '../api'
import type { AlbumReportData } from '../api'
import { computeAlbumScore, BANG_THRESHOLD, SKIP_THRESHOLD, songScoreColor } from '../types'
import type { Song } from '../types'
import clsx from 'clsx'
import RatingReport from '../components/RatingReport'

function ScoreInput({
  value,
  onChange,
  disabled,
}: {
  value: number | null
  onChange: (v: number | null) => void
  disabled: boolean
}) {
  const [raw, setRaw] = useState(value !== null ? String(value) : '')

  function handleBlur() {
    const n = parseFloat(raw)
    if (!isNaN(n) && n >= 0 && n <= 10) {
      const rounded = Math.round(n * 10) / 10
      onChange(rounded)
      setRaw(String(rounded))
    } else if (raw === '--') {
      onChange(null)
    } else {
      setRaw(value !== null ? String(value) : '')
    }
  }

  return (
    <input
      type="text"
      value={raw}
      disabled={disabled}
      onChange={(e) => setRaw(e.target.value)}
      onBlur={handleBlur}
      placeholder="—"
      className={clsx(
        'w-16 text-center bg-[#f5f5f5] border rounded-lg py-1.5 text-sm font-medium focus:outline-none transition-colors',
        disabled ? 'border-[#e8e8e8] text-[#ccc] cursor-not-allowed' : 'border-[#e2e2e2] focus:border-[#2d6a4f] cursor-text',
      )}
      style={!disabled && value !== null ? { color: songScoreColor(value) } : undefined}
    />
  )
}

export default function RatingScreen() {
  const { id } = useParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const { data: album, isLoading } = useQuery({
    queryKey: ['album', Number(id)],
    queryFn: () => fetchAlbum(Number(id)),
  })

  const { data: factorStats } = useQuery({
    queryKey: ['factor-stats'],
    queryFn: fetchFactorStats,
    staleTime: 5 * 60 * 1000,
  })

  const [scores, setScores] = useState<(number | null)[]>([])
  const [skipped, setSkipped] = useState<Set<number>>(new Set())
  const [initialized, setInitialized] = useState(false)
  const [theme, setTheme] = useState<number | null>(null)
  const [replayValue, setReplayValue] = useState<number | null>(null)
  const [production, setProduction] = useState<number | null>(null)
  const [distinctness, setDistinctness] = useState<number | null>(null)
  const [extraArtists, setExtraArtists] = useState('')
  const [reportData, setReportData] = useState<AlbumReportData | null>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)

  if (album && !initialized) {
    const sorted = [...album.songs].sort((a, b) => (a.trackNumber ?? 0) - (b.trackNumber ?? 0))
    setScores(sorted.map((s) => s.score))
    setTheme(album.theme)
    setReplayValue(album.replayValue)
    setProduction(album.production)
    setDistinctness(album.distinctness)
    setExtraArtists(album.extraArtists.join(', '))
    setInitialized(true)
  }

  // Capture at render time so mutations close over the correct value
  const isEditing = album?.status === 'rated'
  const isEP = (album?.songs.length ?? 0) <= 6

  const submitMutation = useMutation({
    mutationFn: async () => {
      if (!album) return
      const sorted = [...album.songs].sort((a, b) => (a.trackNumber ?? 0) - (b.trackNumber ?? 0))
      await batchRateSongs(sorted.map((song, i) => ({ id: song.id, score: scores[i] ?? null })))
      const parsedExtra = extraArtists.split(',').map(s => s.trim()).filter(Boolean)
      await updateAlbum(album.id, {
        ...(isEP ? {} : { theme, replay_value: replayValue, production, distinctness }),
        status: 'rated',
        extra_artists: parsedExtra.length ? JSON.stringify(parsedExtra) : null,
      })
    },
    onSuccess: async () => {
      setSubmitError(null)
      queryClient.invalidateQueries({ queryKey: ['albums'] })
      queryClient.invalidateQueries({ queryKey: ['stats'] })
      queryClient.invalidateQueries({ queryKey: ['album', Number(id)] })
      try {
        const report = await fetchAlbumReport(Number(id))
        setReportData(report)
      } catch {
        navigate(`/album/${id}`)
      }
    },
    onError: (err: unknown) => {
      setSubmitError(err instanceof Error ? err.message : 'Failed to save rating — please try again')
    },
  })

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!album) return
      const sorted = [...album.songs].sort((a, b) => (a.trackNumber ?? 0) - (b.trackNumber ?? 0))
      await batchRateSongs(sorted.map((song, i) => ({ id: song.id, score: scores[i] ?? null })))
      const parsedExtra = extraArtists.split(',').map(s => s.trim()).filter(Boolean)
      await updateAlbum(album.id, {
        ...(isEP ? {} : { theme, replay_value: replayValue, production, distinctness }),
        status: album.status === 'rated' ? 'rated' : 'listening',
        extra_artists: parsedExtra.length ? JSON.stringify(parsedExtra) : null,
      })
    },
    onSuccess: async () => {
      setSaveError(null)
      queryClient.invalidateQueries({ queryKey: ['albums'] })
      queryClient.invalidateQueries({ queryKey: ['album', Number(id)] })
      navigate('/library')
    },
    onError: (err: unknown) => {
      setSaveError(err instanceof Error ? err.message : 'Failed to save — please try again')
    },
  })

  if (reportData) {
    return (
      <RatingReport
        data={reportData}
        onClose={() => navigate(isEditing ? `/album/${id}` : '/library')}
      />
    )
  }

  if (isLoading || !album) {
    return (
      <div className="flex items-center justify-center h-64 text-[#aaa] gap-2">
        <Loader2 size={16} className="animate-spin" /> Loading album…
      </div>
    )
  }

  const sortedSongs = [...album.songs].sort((a, b) => (a.trackNumber ?? 0) - (b.trackNumber ?? 0))
  const ratedCount = scores.filter((s) => s !== null).length
  const doneCount = scores.filter((s, i) => s !== null || skipped.has(i)).length
  const avgSong = ratedCount > 0
    ? scores.filter((s): s is number => s !== null).reduce((a, s) => a + s, 0) / ratedCount
    : null
  const songsComplete = scores.length > 0 && scores.every((s, i) => s !== null || skipped.has(i))
  const factorsComplete = isEP || (theme !== null && replayValue !== null && production !== null && distinctness !== null)
  const canSubmit = songsComplete && factorsComplete

  const previewScore = songsComplete && factorsComplete && (isEP || factorStats)
    ? isEP
      ? (avgSong !== null ? Math.round(avgSong * 100) / 100 : null)
      : computeAlbumScore(
          sortedSongs.map((s, i) => ({ ...s, score: scores[i] })) as Song[],
          theme!, replayValue!, production!, distinctness!,
          factorStats!,
        )
    : null

  const isSubmitting = submitMutation.isPending
  const isSavingDraft = saveMutation.isPending

  return (
    <div className="flex min-h-screen bg-white">
      {/* Main content */}
      <div className="flex-1 p-8">
        <div className="flex items-center justify-between mb-6">
          <button
            onClick={() => navigate(-1)}
            className="flex items-center gap-2 text-[#777] hover:text-[#111] text-sm transition-colors"
          >
            <ArrowLeft size={15} /> Back
          </button>
          <button
            onClick={() => { setSaveError(null); saveMutation.mutate() }}
            disabled={isSavingDraft || isSubmitting}
            className="flex items-center gap-1.5 text-xs text-[#777] hover:text-[#111] px-3 py-1.5 bg-[#f5f5f5] border border-[#e2e2e2] rounded-lg transition-colors disabled:opacity-40"
          >
            {isSavingDraft ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
            {isSavingDraft ? 'Saving…' : 'Save & Exit'}
          </button>
        </div>

        {/* Album header */}
        <div className="flex items-center gap-5 mb-8">
          <div className="w-20 h-20 shrink-0 bg-[#e8e8e8] rounded-xl flex items-center justify-center text-[#aaa] text-3xl font-bold overflow-hidden">
            {album.albumArtUrl
              ? <img src={album.albumArtUrl} alt={album.albumName} className="w-full h-full object-cover rounded-xl" />
              : album.albumName[0]}
          </div>
          <div>
            <h1 className="text-xl font-semibold text-[#111]">{album.albumName}</h1>
            <p className="text-[#777] text-sm mt-0.5">
              {[album.artist, ...album.extraArtists].join(', ')} · {album.year}
            </p>
            <p className="text-[#aaa] text-xs mt-1">{sortedSongs.length} tracks</p>
          </div>
        </div>

        {/* Song list */}
        <div className="mb-8">
          <h2 className="text-xs font-semibold text-[#999] uppercase tracking-widest mb-3">Tracks</h2>
          <div className="flex flex-col gap-1">
            {sortedSongs.map((song, i) => {
              const prevPassed = isEditing || i === 0 || scores[i - 1] !== null || skipped.has(i - 1)
              const isSkipped = skipped.has(i)
              const isActive = prevPassed && scores[i] === null && !isSkipped
              const isDone = scores[i] !== null
              const score = scores[i]

              return (
                <div
                  key={song.id}
                  className={clsx(
                    'flex items-center gap-4 px-4 py-2.5 rounded-lg transition-colors',
                    isActive ? 'bg-white border border-[#d0d0d0] shadow-sm' : 'bg-[#f5f5f5]',
                    !prevPassed && !isDone && !isSkipped && 'opacity-40',
                    isSkipped && 'opacity-50',
                  )}
                >
                  <span className="text-[#aaa] text-xs w-5 text-right shrink-0">{song.trackNumber}</span>
                  <span className={clsx('flex-1 text-sm truncate', isDone ? 'text-[#111]' : 'text-[#999]', isSkipped && 'line-through')}>
                    {song.title}
                  </span>
                  {isDone && score !== null && score >= BANG_THRESHOLD && (
                    <span className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: songScoreColor(score) }}>bang</span>
                  )}
                  {isDone && score !== null && score < SKIP_THRESHOLD && (
                    <span className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: songScoreColor(score) }}>skip</span>
                  )}
                  {isActive && (
                    <button
                      onClick={() => setSkipped(prev => new Set(prev).add(i))}
                      className="text-[#bbb] hover:text-[#999] transition-colors shrink-0"
                      title="Skip for now"
                    >
                      <SkipForward size={14} />
                    </button>
                  )}
                  {isSkipped && (
                    <button
                      onClick={() => setSkipped(prev => { const s = new Set(prev); s.delete(i); return s })}
                      className="text-[10px] font-semibold uppercase tracking-wide text-[#bbb] hover:text-[#999] transition-colors"
                    >
                      skipped
                    </button>
                  )}
                  <ScoreInput
                    value={scores[i] ?? null}
                    disabled={!prevPassed && !isSkipped}
                    onChange={(v) => {
                      const next = [...scores]
                      next[i] = v
                      setScores(next)
                      if (v !== null) setSkipped(prev => { const s = new Set(prev); s.delete(i); return s })
                    }}
                  />
                </div>
              )
            })}
          </div>
        </div>

        {/* External factors — hidden for EPs */}
        {!isEP && (
          <div className={clsx('mb-8 transition-opacity', songsComplete ? 'opacity-100' : 'opacity-30 pointer-events-none')}>
            <h2 className="text-xs font-semibold text-[#999] uppercase tracking-widest mb-3">External Factors</h2>
            <div className="grid grid-cols-2 gap-3 mb-4">
              {(
                [
                  { label: 'Theme', value: theme, set: setTheme },
                  { label: 'Replay Value', value: replayValue, set: setReplayValue },
                  { label: 'Production', value: production, set: setProduction },
                  { label: 'Distinctness', value: distinctness, set: setDistinctness },
                ] as const
              ).map(({ label, value, set }) => (
                <div key={label} className="bg-[#f5f5f5] rounded-xl p-4 border border-[#e2e2e2]">
                  <p className="text-[#777] text-xs mb-2">{label}</p>
                  <ScoreInput value={value} disabled={!songsComplete} onChange={set} />
                </div>
              ))}
            </div>
            <div className="bg-[#f5f5f5] rounded-xl p-4 border border-[#e2e2e2]">
              <p className="text-[#777] text-xs mb-2">Additional Artists <span className="text-[#bbb]">(comma-separated)</span></p>
              <input
                type="text"
                value={extraArtists}
                onChange={e => setExtraArtists(e.target.value)}
                placeholder="e.g. Kanye West, Jay-Z"
                className="w-full bg-transparent text-sm text-[#111] placeholder-[#ccc] focus:outline-none"
              />
            </div>
          </div>
        )}
        {isEP && (
          <div className="mb-8">
            <div className="bg-[#f5f5f5] rounded-xl p-4 border border-[#e2e2e2]">
              <p className="text-[#777] text-xs mb-2">Additional Artists <span className="text-[#bbb]">(comma-separated)</span></p>
              <input
                type="text"
                value={extraArtists}
                onChange={e => setExtraArtists(e.target.value)}
                placeholder="e.g. Kanye West, Jay-Z"
                className="w-full bg-transparent text-sm text-[#111] placeholder-[#ccc] focus:outline-none"
              />
            </div>
          </div>
        )}

        {/* Submit */}
        {saveError && (
          <p className="text-[#c0392b] text-xs text-center mb-2">{saveError}</p>
        )}
        {submitError && (
          <p className="text-[#c0392b] text-xs text-center mb-2">{submitError}</p>
        )}
        <button
          disabled={!canSubmit || isSubmitting || isSavingDraft}
          onClick={() => { setSubmitError(null); submitMutation.mutate() }}
          className={clsx(
            'w-full flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-semibold transition-colors',
            canSubmit && !isSubmitting && !isSavingDraft
              ? 'bg-[#2d6a4f] hover:bg-[#245c43] text-white'
              : 'bg-[#f5f5f5] text-[#bbb] cursor-not-allowed border border-[#e2e2e2]',
          )}
        >
          {isSubmitting ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />}
          {isSubmitting
            ? 'Saving…'
            : canSubmit
              ? (isEditing ? 'Update Rating' : 'Submit Rating')
              : !songsComplete
                ? `${doneCount} / ${sortedSongs.length} tracks done`
                : 'Fill in external factors'}
        </button>
      </div>

      {/* Sticky score card */}
      <aside className="w-64 shrink-0 sticky top-0 h-screen border-l border-[#e2e2e2] p-6 flex flex-col bg-white">
        <p className="text-xs font-semibold text-[#999] uppercase tracking-widest mb-5">Live Score</p>
        {isSubmitting ? (
          <div className="mb-6">
            <div className="flex items-center gap-2 mb-2">
              <Loader2 size={18} className="animate-spin text-[#2d6a4f]" />
              <span className="text-[#2d6a4f] text-sm font-semibold">Recalibrating…</span>
            </div>
            <div className="h-1.5 bg-[#e8e8e8] rounded-full overflow-hidden">
              <div className="h-full bg-[#2d6a4f] rounded-full animate-pulse w-3/4" />
            </div>
            <p className="text-[#aaa] text-[10px] mt-2">Updating all album scores</p>
          </div>
        ) : (
          <>
            <div className="text-5xl font-bold text-[#2d6a4f] mb-1 tabular-nums">
              {previewScore !== null ? previewScore.toFixed(2) : '—'}
            </div>
            <p className="text-[#aaa] text-xs mb-6">Final score</p>
          </>
        )}

        <div className="flex flex-col gap-3">
          {(isEP
            ? [{ label: 'Avg Song Score', value: avgSong, weight: '×1.00' }]
            : [
                { label: 'Avg Song Score', value: avgSong,     weight: '×1.00' },
                { label: 'Theme',          value: theme,        weight: 'z ×0.25' },
                { label: 'Replay Value',   value: replayValue,  weight: 'z ×0.15' },
                { label: 'Production',     value: production,   weight: 'z ×0.15' },
                { label: 'Distinctness',   value: distinctness, weight: 'z ×0.05' },
              ]
          ).map(({ label, value, weight }) => (
            <div key={label} className="flex items-center justify-between">
              <div>
                <p className="text-[#777] text-xs">{label}</p>
                <p className="text-[#aaa] text-[10px]">{weight}</p>
              </div>
              <span className="text-[#111] text-sm font-medium tabular-nums">
                {value !== null ? (value as number).toFixed(2) : '—'}
              </span>
            </div>
          ))}
        </div>

        <div className="mt-6 pt-6 border-t border-[#e2e2e2]">
          <div className="flex justify-between text-xs text-[#aaa] mb-1">
            <span>Songs rated</span>
            <span>{ratedCount} / {sortedSongs.length}</span>
          </div>
          <div className="h-1.5 bg-[#e8e8e8] rounded-full">
            <div
              className="h-1.5 bg-[#2d6a4f] rounded-full transition-all"
              style={{ width: sortedSongs.length > 0 ? `${(ratedCount / sortedSongs.length) * 100}%` : '0%' }}
            />
          </div>
        </div>
      </aside>
    </div>
  )
}
