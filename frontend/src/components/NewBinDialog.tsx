// Making a bin: a title, an optional description, and who can see it. A new
// bin is Private (spec §3) until its owner switches it to Public, here or later
// in the bin's edit mode. Opened from the Bins page's New bin button and from an
// album page's Add to bin… menu, which puts that album straight in.
import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Globe, Lock, X } from 'lucide-react'
import { createBin, type BinCard } from '../api'
import { BIN_FIELD as FIELD, DESCRIPTION_MAX, TITLE_MAX, binErrorText } from '../lib/bins'
import VinylSpinner from './VinylSpinner'

/** Private / Public, as two halves of one control. The wire value for
 *  Public is `published`. */
export function VisibilitySwitch({ value, onChange, disabled = false }: {
  value: 'private' | 'published'
  onChange: (v: 'private' | 'published') => void
  disabled?: boolean
}) {
  const opt = (v: 'private' | 'published', label: string, icon: React.ReactNode) => (
    <button
      type="button"
      role="radio"
      aria-checked={value === v}
      disabled={disabled}
      onClick={() => onChange(v)}
      className={`flex flex-1 items-center justify-center gap-1.5 rounded-full px-4 py-2 text-[13.5px] font-semibold transition-colors disabled:opacity-60 ${
        value === v ? 'bg-(--c-green-fill) text-white' : 'text-(--c-57534e) hover:text-(--c-1c1917)'
      }`}
    >
      {icon}
      {label}
    </button>
  )
  return (
    <div role="radiogroup" aria-label="Who can see this bin" className="flex rounded-full border border-(--c-e2dbd0) bg-(--c-fff) p-1">
      {opt('private', 'Private', <Lock size={13} strokeWidth={2.4} />)}
      {opt('published', 'Public', <Globe size={13} strokeWidth={2.4} />)}
    </div>
  )
}

export default function NewBinDialog({ onClose, onCreated }: {
  onClose: () => void
  onCreated: (bin: BinCard) => void
}) {
  const queryClient = useQueryClient()
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [visibility, setVisibility] = useState<'private' | 'published'>('private')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!title.trim() || saving) return
    setSaving(true)
    setError(null)
    try {
      const bin = await createBin({ title: title.trim(), description: description.trim(), visibility, ranked: true })
      queryClient.invalidateQueries({ queryKey: ['bins'] })
      onCreated(bin)
    } catch (err) {
      setError(binErrorText(err, 'Couldn’t make that bin'))
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm fade-in" onClick={saving ? undefined : onClose} />
      <form
        onSubmit={submit}
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-bin-title"
        className="relative w-full max-w-md rounded-3xl bg-(--c-f9f8f6) p-6 shadow-xl pop-in"
      >
        <div className="mb-5 flex items-center justify-between">
          <h2 id="new-bin-title" className="m-0 font-display text-[24px] font-bold text-(--c-1c1917)">New bin</h2>
          <button type="button" onClick={onClose} disabled={saving} aria-label="Close" className="text-(--c-a8998a) hover:text-(--c-57534e)">
            <X size={18} />
          </button>
        </div>
        <div className="flex flex-col gap-3">
          <input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={TITLE_MAX}
            placeholder="Title"
            aria-label="Title"
            className={FIELD}
          />
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={DESCRIPTION_MAX}
            rows={3}
            placeholder="Description (optional)"
            aria-label="Description"
            className={`${FIELD} resize-none`}
          />
          <VisibilitySwitch value={visibility} onChange={setVisibility} disabled={saving} />
        </div>
        {error && <p className="m-0 mt-3 text-[13px] text-(--c-b91c1c)">{error}</p>}
        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="h-11 rounded-full px-5 text-[14.5px] font-semibold text-(--c-78716c) hover:bg-(--c-efebe5)"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving || !title.trim()}
            className="flex h-11 items-center gap-2 rounded-full bg-(--c-green-fill) px-6 text-[14.5px] font-semibold text-white hover:bg-(--c-green-fill-hover) disabled:opacity-50"
          >
            {saving && <VinylSpinner size={17} />}
            Make bin
          </button>
        </div>
      </form>
    </div>
  )
}
