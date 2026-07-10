import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { RotateCcw, ChevronDown, Loader2 } from 'lucide-react'
import clsx from 'clsx'
import { fetchFactorWeights, updateFactorWeights } from '../api'
import {
  FACTOR_META,
  DEFAULT_FACTOR_POINTS,
  TOTAL_FACTOR_POINTS,
  MIN_FACTOR_POINTS,
} from '../types'
import type { FactorPoints } from '../types'

export function factorPointsTotal(p: FactorPoints): number {
  return p.theme + p.replay_value + p.production + p.distinctness
}

// The four factors share a fixed 60-point budget (each ≥ 5). This is a
// controlled editor: the parent owns the draft and decides when to persist.
export default function FactorWeightsEditor({
  points,
  onChange,
}: {
  points: FactorPoints
  onChange: (p: FactorPoints) => void
}) {
  const total = factorPointsTotal(points)
  const remaining = TOTAL_FACTOR_POINTS - total

  function setOne(key: keyof FactorPoints, raw: number) {
    // Clamp so a factor never drops below the minimum or pushes the budget over
    // its total: the most a slider can reach is its value plus what's unassigned.
    const max = points[key] + remaining
    const next = Math.max(MIN_FACTOR_POINTS, Math.min(raw, max))
    onChange({ ...points, [key]: next })
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-[11px] text-[#8a7f72] leading-snug">
        Set how much each factor matters to you.
      </p>

      {FACTOR_META.map(({ key, label }) => {
        const val = points[key]
        return (
          <div key={key}>
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-[#555]">{label}</span>
              <span className="text-xs font-semibold tabular-nums text-[#2d6a4f]">{val} pts</span>
            </div>
            <input
              type="range"
              min={MIN_FACTOR_POINTS}
              max={val + remaining}
              value={val}
              onChange={(e) => setOne(key, Number(e.target.value))}
              className="w-full accent-[#2d6a4f] cursor-pointer"
            />
          </div>
        )
      })}

      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => onChange(DEFAULT_FACTOR_POINTS)}
          className="flex items-center gap-1 text-[11px] text-[#8a7f72] hover:text-[#2d6a4f] transition-colors"
        >
          <RotateCcw size={11} /> Reset to default
        </button>
        <span
          className={clsx(
            'text-[11px] font-semibold tabular-nums',
            remaining === 0 ? 'text-[#2d6a4f]' : 'text-[#b0402f]',
          )}
        >
          {remaining === 0
            ? 'Balanced · 60 / 60'
            : `${total} / 60 · ${remaining > 0 ? `${remaining} to assign` : `${-remaining} over`}`}
        </span>
      </div>
    </div>
  )
}

// Self-contained section for the profile/settings modal: loads the user's
// current allocation, edits a draft, and on save re-scores their rated albums.
export function FactorWeightsSection({ userId }: { userId: number }) {
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<FactorPoints | null>(null)
  const [saved, setSaved] = useState<FactorPoints | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['factor-weights', userId],
    queryFn: () => fetchFactorWeights(userId),
  })

  useEffect(() => {
    if (data && draft === null) {
      setDraft(data.points)
      setSaved(data.points)
    }
  }, [data, draft])

  const total = draft ? factorPointsTotal(draft) : 0
  const changed = draft !== null && saved !== null && JSON.stringify(draft) !== JSON.stringify(saved)
  const canSave = draft !== null && total === TOTAL_FACTOR_POINTS && changed

  const mutation = useMutation({
    mutationFn: () => updateFactorWeights(userId, draft!),
    onSuccess: (res) => {
      setSaved(res.points)
      setDraft(res.points)
      setError(null)
      setStatus(`Saved — updated ${res.recomputed} album${res.recomputed === 1 ? '' : 's'}`)
      queryClient.invalidateQueries({ queryKey: ['albums'] })
      queryClient.invalidateQueries({ queryKey: ['stats'] })
      queryClient.invalidateQueries({ queryKey: ['factor-weights', userId] })
    },
    onError: (e: unknown) => setError(e instanceof Error ? e.message : 'Failed to save preferences'),
  })

  function handleSave() {
    if (!draft) return
    if (!confirm('Update your album scores to match your new preferences?')) return
    setStatus(null)
    mutation.mutate()
  }

  return (
    <div>
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between text-left"
      >
        <div>
          <p className="text-sm text-[#111] font-medium">Preferences</p>
          <p className="text-[11px] text-[#8a7f72]">Adjust your external factor preferences</p>
        </div>
        <ChevronDown size={16} className={clsx('text-[#aaa] transition-transform shrink-0', open && 'rotate-180')} />
      </button>

      {open && (
        <div className="mt-3">
          {isLoading || !draft ? (
            <div className="flex items-center gap-2 text-[#aaa] text-xs py-2">
              <Loader2 size={13} className="animate-spin" /> Loading…
            </div>
          ) : (
            <>
              <FactorWeightsEditor points={draft} onChange={(p) => { setDraft(p); setStatus(null) }} />
              {error && <p className="text-[#c0392b] text-xs mt-2">{error}</p>}
              {status && !error && <p className="text-[#2d6a4f] text-xs mt-2">{status}</p>}
              <button
                onClick={handleSave}
                disabled={!canSave || mutation.isPending}
                className="w-full mt-3 py-2 rounded-xl text-sm font-semibold bg-[#2d6a4f] hover:bg-[#245c43] text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {mutation.isPending ? <><Loader2 size={14} className="animate-spin" /> Saving…</> : 'Save preferences'}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  )
}
