// Your bin's edit mode (spec §5): its title, description, ranked or not,
// Private / Public, its own picture, and its records — dragged into order,
// taken out, each with a note — plus Add albums, from your library or the
// catalogs (Add an album's search). Every change is its own request and the
// bin is refetched after it: the server answers adds and notes with a partial
// entry (no genre, no Pressd figures), never a row to keep.
import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, GripVertical, ImagePlus, Music, Plus, Search, Trash2, X } from 'lucide-react'
import {
  addToBin, deleteBin, deleteBinCover, fetchAlbums, removeBinEntry, reorderBin, resolveAlbum, updateBin,
  updateBinEntryNote, uploadBinCover,
} from '../api'
import type { AlbumSearchResult, BinDetail, BinEntry } from '../api'
import { isUnreleased } from '../types'
import { useAlbumSearch } from '../hooks/useAlbumSearch'
import { useUser } from '../context/UserContext'
import { BIN_COVER_PX, loadImage, renderCrop } from '../lib/banner'
import { BIN_FIELD, DESCRIPTION_MAX, NOTE_MAX, TITLE_MAX, binErrorText } from '../lib/bins'
import { useSlideRows } from '../lib/useSlideRows'
import BannerCropper from './BannerCropper'
import { BinMosaic } from './BinCard'
import CoverImg from './CoverImg'
import { VisibilitySwitch } from './NewBinDialog'
import VinylSpinner from './VinylSpinner'

const LABEL = 'm-0 mb-2 text-[11px] font-bold uppercase tracking-[0.16em] text-(--c-a8998a)'

/** Name and artist folded, to mark a record already in the bin. The server's
 *  test is the record's subject key (any edition), so this only greys the
 *  obvious ones; anything it misses is refused as "Already in this bin". */
const recordKey = (name: string, artist: string) => `${name.trim().toLowerCase()}|${artist.trim().toLowerCase()}`

export default function BinEditor({ bin, onDone }: { bin: BinDetail; onDone: () => void }) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const slug = bin.slug
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [deleting, setDeleting] = useState(false)

  function refresh() {
    queryClient.invalidateQueries({ queryKey: ['bin', slug] })
    queryClient.invalidateQueries({ queryKey: ['bins'] })
  }

  async function run(what: string, fn: () => Promise<unknown>, fallback: string): Promise<boolean> {
    setSaving(what)
    setError(null)
    try {
      await fn()
      refresh()
      return true
    } catch (e) {
      setError(binErrorText(e, fallback))
      return false
    } finally {
      setSaving(null)
    }
  }

  // ── Details: text saves when the field is left; switches save at once ──
  const [title, setTitle] = useState(bin.title)
  const [description, setDescription] = useState(bin.description ?? '')
  function saveTitle() {
    const t = title.trim()
    if (!t) { setTitle(bin.title); return }
    if (t !== bin.title) void run('title', () => updateBin(slug, { title: t }), 'Couldn’t save the title')
  }
  function saveDescription() {
    const d = description.trim()
    if (d !== (bin.description ?? '')) void run('description', () => updateBin(slug, { description: d }), 'Couldn’t save the description')
  }

  // ── The bin's own picture: square, framed in the banner's cropper ──
  const fileInput = useRef<HTMLInputElement>(null)
  const [cropImage, setCropImage] = useState<HTMLImageElement | null>(null)
  async function uploadCover(base64: string) {
    if (await run('cover', () => uploadBinCover(slug, base64), 'Couldn’t set that picture')) setCropImage(null)
  }
  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = '' // the same file can be picked again
    if (!file) return
    if (!file.type.startsWith('image/')) { setError('Please choose an image file'); return }
    try {
      const img = await loadImage(file)
      if (Math.abs(img.naturalWidth / img.naturalHeight - 1) < 0.01) await uploadCover(renderCrop(img, BIN_COVER_PX, BIN_COVER_PX))
      else setCropImage(img)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Couldn’t read that picture')
    }
  }

  // ── Order: dragged locally, sent whole when the drag ends ──
  const serverIds = [...bin.entries].sort((a, b) => a.position - b.position).map((e) => e.id)
  const serverKey = serverIds.join(',')
  const [order, setOrder] = useState(serverIds)
  const [orderFor, setOrderFor] = useState(serverKey)
  if (orderFor !== serverKey) {
    setOrderFor(serverKey)
    setOrder(serverIds)
  }
  const byId = new Map(bin.entries.map((e) => [e.id, e]))
  const rows = order.map((id) => byId.get(id)).filter((e): e is BinEntry => !!e)
  const listRef = useSlideRows(order.join(','))
  const [armed, setArmed] = useState<number | null>(null)
  const [dragging, setDragging] = useState<number | null>(null)

  function moveTo(id: number, index: number, list = order): number[] {
    const next = list.filter((x) => x !== id)
    next.splice(Math.max(0, Math.min(index, next.length)), 0, id)
    return next
  }
  async function commitOrder(next: number[]) {
    if (next.join(',') === serverKey) return
    const ok = await run('order', () => reorderBin(slug, next), 'Couldn’t save the new order')
    if (!ok) setOrder(serverIds)
  }
  function onHandleKey(e: React.KeyboardEvent, id: number) {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return
    e.preventDefault()
    const at = order.indexOf(id)
    const next = moveTo(id, at + (e.key === 'ArrowUp' ? -1 : 1))
    setOrder(next)
    void commitOrder(next)
  }

  const inBin = new Set(bin.entries.map((e) => recordKey(e.albumName, e.artist)))

  return (
    <div className="grid gap-10 xl:grid-cols-[360px_minmax(0,1fr)] xl:gap-16">
      {/* ── The bin itself ── */}
      <aside className="flex flex-col gap-6">
        <div>
          <p className={LABEL}>Picture</p>
          <div className="flex items-center gap-4">
            <BinMosaic covers={bin.covers} coverUrl={bin.coverUrl} size={112} />
            <div className="flex flex-col items-start gap-2">
              <input ref={fileInput} type="file" accept="image/*" className="hidden" onChange={onFile} />
              <button
                type="button"
                onClick={() => fileInput.current?.click()}
                disabled={saving === 'cover'}
                className="flex items-center gap-1.5 rounded-full border border-(--c-e2dbd0) px-3.5 py-1.5 text-[13px] font-semibold text-(--c-2d6a4f) hover:border-(--c-2d6a4f) disabled:opacity-60"
              >
                {saving === 'cover' ? <VinylSpinner size={14} /> : <ImagePlus size={14} />}
                {bin.coverUrl ? 'Change picture' : 'Upload a picture'}
              </button>
              {bin.coverUrl && (
                <button
                  type="button"
                  onClick={() => run('cover', () => deleteBinCover(slug), 'Couldn’t remove that picture')}
                  disabled={saving === 'cover'}
                  className="px-1 text-[13px] font-medium text-(--c-8a7f72) hover:text-(--c-b91c1c)"
                >
                  Use the album covers
                </button>
              )}
            </div>
          </div>
        </div>

        <div>
          <p className={LABEL}>Title</p>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={saveTitle}
            onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
            maxLength={TITLE_MAX}
            aria-label="Title"
            className={BIN_FIELD}
          />
        </div>

        <div>
          <p className={LABEL}>Description</p>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            onBlur={saveDescription}
            maxLength={DESCRIPTION_MAX}
            rows={4}
            placeholder="What ties these records together?"
            aria-label="Description"
            className={`${BIN_FIELD} resize-none`}
          />
        </div>

        <div>
          <p className={LABEL}>Who can see it</p>
          <VisibilitySwitch
            value={bin.visibility}
            onChange={(v) => v !== bin.visibility && run('visibility', () => updateBin(slug, { visibility: v }), 'Couldn’t change who can see it')}
            disabled={saving === 'visibility'}
          />
        </div>

        <label className="flex cursor-pointer items-center justify-between gap-4">
          <span className="text-[14.5px] font-medium text-(--c-1c1917)">Number the records</span>
          <input
            type="checkbox"
            checked={bin.ranked}
            disabled={saving === 'ranked'}
            onChange={(e) => run('ranked', () => updateBin(slug, { ranked: e.target.checked }), 'Couldn’t change that')}
            className="h-5 w-5 accent-(--c-2d6a4f)"
          />
        </label>

        {error && <p className="m-0 text-[13px] text-(--c-b91c1c)" role="alert">{error}</p>}

        <div className="flex items-center justify-between gap-3 border-t border-(--c-e8e2d9) pt-5">
          <button
            type="button"
            onClick={() => setDeleting(true)}
            className="flex items-center gap-1.5 text-[13.5px] font-semibold text-(--c-b91c1c) hover:underline"
          >
            <Trash2 size={14} /> Delete bin
          </button>
          <button
            type="button"
            onClick={onDone}
            className="flex h-10 items-center gap-1.5 rounded-full bg-(--c-green-fill) px-5 text-[14px] font-semibold text-white hover:bg-(--c-green-fill-hover)"
          >
            {saving ? <VinylSpinner size={16} /> : <Check size={15} strokeWidth={2.6} />} Done
          </button>
        </div>
      </aside>

      {/* ── Its records ── */}
      <section className="min-w-0">
        <div className="mb-4 flex items-center justify-between gap-3">
          <p className="m-0 text-[14px] font-semibold text-(--c-57534e)">
            {rows.length} {rows.length === 1 ? 'album' : 'albums'}
            {saving === 'order' && <VinylSpinner size={16} className="ml-2 inline-block align-middle" />}
          </p>
          <button
            type="button"
            onClick={() => setAdding(true)}
            disabled={rows.length >= 100}
            className="flex h-10 items-center gap-1.5 rounded-full border border-(--c-2d6a4f) px-4 text-[14px] font-semibold text-(--c-2d6a4f) hover:bg-(--c-2d6a4f)/10 disabled:opacity-50"
          >
            <Plus size={16} strokeWidth={2.4} /> Add albums
          </button>
        </div>
        {rows.length === 0 ? (
          <p className="m-0 py-10 text-[14px] text-(--c-57534e)">No albums yet.</p>
        ) : (
          <ol ref={listRef} className="m-0 list-none p-0">
            {rows.map((e, i) => (
              <li
                key={e.id}
                data-id={e.id}
                draggable={armed === e.id}
                onDragStart={(ev) => { setDragging(e.id); ev.dataTransfer.effectAllowed = 'move' }}
                onDragOver={(ev) => {
                  if (dragging == null) return
                  ev.preventDefault()
                  // The dragged row takes this row's place; once it has, the
                  // pointer is over the dragged row itself and nothing moves.
                  if (dragging !== e.id) setOrder((o) => moveTo(dragging, o.indexOf(e.id), o))
                }}
                onDrop={(ev) => ev.preventDefault()}
                onDragEnd={() => {
                  setDragging(null)
                  setArmed(null)
                  void commitOrder(order)
                }}
                className={`flex items-start gap-4 border-b border-(--c-e8e2d9)/60 bg-(--c-f9f8f6) py-4 ${dragging === e.id ? 'opacity-60' : ''}`}
              >
                <button
                  type="button"
                  aria-label={`Move ${e.albumName}; arrow keys move it up or down`}
                  onPointerDown={() => setArmed(e.id)}
                  onPointerUp={() => dragging == null && setArmed(null)}
                  onKeyDown={(ev) => onHandleKey(ev, e.id)}
                  className="mt-5 cursor-grab touch-none text-(--c-a8998a) hover:text-(--c-57534e) active:cursor-grabbing"
                >
                  <GripVertical size={18} />
                </button>
                <div className="relative shrink-0">
                  {e.coverUrl ? (
                    <CoverImg url={e.coverUrl} displayPx={72} alt="" className="block h-18 w-18 rounded-lg object-cover" />
                  ) : (
                    <div className="flex h-18 w-18 items-center justify-center rounded-lg bg-(--c-efe9e0)"><Music size={18} className="text-(--c-b0a090)" /></div>
                  )}
                  {bin.ranked && (
                    <span className="absolute bottom-0.5 left-1.5 font-display text-[22px] font-black leading-none tabular-nums text-white [text-shadow:0_1px_5px_rgba(0,0,0,0.6)]">{i + 1}</span>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-start gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="m-0 truncate text-[15.5px] font-bold text-(--c-1c1917)">{e.albumName}</p>
                      <p className="m-0 mt-0.5 truncate text-[13.5px] text-(--c-57534e)">{e.artist}{e.year ? ` · ${e.year}` : ''}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => run(`remove:${e.id}`, () => removeBinEntry(slug, e.id), 'Couldn’t take that album out')}
                      disabled={saving === `remove:${e.id}`}
                      aria-label={`Take ${e.albumName} out of the bin`}
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-(--c-a8998a) hover:bg-(--c-efe9e0) hover:text-(--c-b91c1c)"
                    >
                      {saving === `remove:${e.id}` ? <VinylSpinner size={14} /> : <X size={16} />}
                    </button>
                  </div>
                  <NoteField key={`${e.id}:${e.note ?? ''}`} slug={slug} entry={e} onSaved={refresh} />
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>

      {adding && <AddAlbumsDialog slug={slug} inBin={inBin} onClose={() => setAdding(false)} onAdded={refresh} />}
      {cropImage && (
        <BannerCropper
          image={cropImage}
          saving={saving === 'cover'}
          width={BIN_COVER_PX}
          height={BIN_COVER_PX}
          title="Frame the picture"
          saveLabel="Save picture"
          onCancel={() => setCropImage(null)}
          onSave={uploadCover}
        />
      )}
      {deleting && (
        <ConfirmDelete
          title={bin.title}
          onCancel={() => setDeleting(false)}
          onConfirm={async () => {
            await deleteBin(slug)
            queryClient.removeQueries({ queryKey: ['bin', slug] })
            queryClient.invalidateQueries({ queryKey: ['bins'] })
            navigate('/bins', { replace: true })
          }}
        />
      )}
    </div>
  )
}

/** A record's note, saved when the field is left. */
function NoteField({ slug, entry, onSaved }: { slug: string; entry: BinEntry; onSaved: () => void }) {
  const [value, setValue] = useState(entry.note ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  async function save() {
    const v = value.trim()
    if (v === (entry.note ?? '')) return
    setBusy(true)
    setError(null)
    try {
      await updateBinEntryNote(slug, entry.id, v)
      onSaved()
    } catch (e) {
      setError(binErrorText(e, 'Couldn’t save that note'))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="mt-2.5">
      <div className="relative">
        <textarea
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onBlur={save}
          maxLength={NOTE_MAX}
          rows={2}
          placeholder="Add a note"
          aria-label={`Your note on ${entry.albumName}`}
          className="w-full resize-none rounded-lg border border-transparent bg-(--c-efe9e0)/60 px-3 py-2 text-[13.5px] leading-snug text-(--c-1c1917) placeholder:text-(--c-a8998a) focus:border-(--c-2d6a4f) focus:bg-(--c-fff) focus:outline-none"
        />
        {busy && <VinylSpinner size={14} className="absolute right-2 top-2" />}
      </div>
      {error && <p className="m-0 mt-1 text-[12.5px] text-(--c-b91c1c)">{error}</p>}
    </div>
  )
}

type RowState = 'busy' | 'added' | { error: string }

/** Add albums: your library, or the catalogs as Add an album searches them. */
function AddAlbumsDialog({ slug, inBin, onClose, onAdded }: {
  slug: string
  inBin: Set<string>
  onClose: () => void
  onAdded: () => void
}) {
  const { activeUser } = useUser()
  const userId = activeUser?.id
  const [tab, setTab] = useState<'library' | 'catalogs'>('library')
  const [query, setQuery] = useState('')
  const [state, setState] = useState<Record<string, RowState>>({})

  const { data: library = [], isLoading: libraryLoading } = useQuery({
    queryKey: ['albums', 'all', userId, 'library'],
    queryFn: () => fetchAlbums({ userId, excludeSingles: true }),
    enabled: userId != null,
  })
  const { results, searching } = useAlbumSearch(tab === 'catalogs' ? query : '')

  const q = query.trim().toLowerCase()
  const mine = library
    .filter((a) => !isUnreleased(a.releaseDate))
    .filter((a) => !q || a.albumName.toLowerCase().includes(q) || a.artist.toLowerCase().includes(q))
    .sort((a, b) => a.artist.localeCompare(b.artist) || a.albumName.localeCompare(b.albumName))

  async function add(key: string, source: () => Promise<{ albumId: number } | { release: Record<string, unknown> }>) {
    if (state[key] === 'busy' || state[key] === 'added') return
    setState((s) => ({ ...s, [key]: 'busy' }))
    try {
      await addToBin(slug, await source())
      setState((s) => ({ ...s, [key]: 'added' }))
      onAdded()
    } catch (e) {
      setState((s) => ({ ...s, [key]: { error: binErrorText(e, 'Couldn’t add that album') } }))
    }
  }

  const tabBtn = (t: 'library' | 'catalogs', label: string) => (
    <button
      type="button"
      role="tab"
      aria-selected={tab === t}
      onClick={() => setTab(t)}
      className={`rounded-full px-3.5 py-1.5 text-[13px] font-semibold transition-colors ${
        tab === t ? 'bg-(--c-green-fill) text-white' : 'text-(--c-57534e) hover:text-(--c-1c1917)'
      }`}
    >
      {label}
    </button>
  )

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm fade-in" onClick={onClose} />
      <div role="dialog" aria-modal="true" aria-labelledby="add-albums-title" className="relative flex max-h-[85vh] w-full max-w-xl flex-col rounded-3xl bg-(--c-f9f8f6) p-6 shadow-xl pop-in">
        <div className="mb-4 flex items-center justify-between">
          <h2 id="add-albums-title" className="m-0 font-display text-[24px] font-bold text-(--c-1c1917)">Add albums</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="text-(--c-a8998a) hover:text-(--c-57534e)">
            <X size={18} />
          </button>
        </div>
        <div role="tablist" className="mb-3 flex gap-1">
          {tabBtn('library', 'Your library')}
          {tabBtn('catalogs', 'Search the catalogs')}
        </div>
        <div className="relative mb-3">
          <Search size={15} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-(--c-a8998a)" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={tab === 'library' ? 'Filter your library' : 'Search album or artist…'}
            aria-label={tab === 'library' ? 'Filter your library' : 'Search the catalogs'}
            className={`${BIN_FIELD} pl-10`}
          />
          {tab === 'catalogs' && searching && <VinylSpinner size={16} className="absolute right-3.5 top-1/2 -translate-y-1/2" />}
        </div>
        <ul className="-mx-2 m-0 min-h-40 flex-1 list-none overflow-y-auto p-0">
          {tab === 'library' ? (
            libraryLoading ? (
              <li className="flex justify-center py-8"><VinylSpinner size={44} /></li>
            ) : mine.length === 0 ? (
              <li className="px-2 py-6 text-[14px] text-(--c-57534e)">{q ? 'Nothing in your library matches.' : 'Your library is empty.'}</li>
            ) : (
              mine.map((a) => {
                const key = `album:${a.id}`
                return (
                  <PickRow
                    key={key}
                    cover={a.albumArtUrl}
                    title={a.albumName}
                    sub={a.artist}
                    state={inBin.has(recordKey(a.albumName, a.artist)) ? 'added' : state[key]}
                    onAdd={() => add(key, async () => ({ albumId: a.id }))}
                  />
                )
              })
            )
          ) : (
            results.map((r: AlbumSearchResult) => {
              const key = `catalog:${r.source}:${r.source_id}`
              return (
                <PickRow
                  key={key}
                  cover={r.cover_url}
                  title={r.album_name}
                  sub={`${r.artist}${r.year ? ` · ${r.year}` : ''}`}
                  state={
                    r.upcoming
                      ? { error: 'That album isn’t out yet' }
                      : inBin.has(recordKey(r.album_name, r.artist)) ? 'added' : state[key]
                  }
                  disabled={!!r.upcoming}
                  onAdd={() => add(key, async () => ({ release: (await resolveAlbum(r)) as unknown as Record<string, unknown> }))}
                />
              )
            })
          )}
        </ul>
      </div>
    </div>
  )
}

function PickRow({ cover, title, sub, state, disabled = false, onAdd }: {
  cover: string | null | undefined
  title: string
  sub: string
  state: RowState | undefined
  disabled?: boolean
  onAdd: () => void
}) {
  const error = typeof state === 'object' ? state.error : null
  return (
    <li className="rounded-xl px-2 py-2 hover:bg-(--c-efe9e0)/60">
      <div className="flex items-center gap-3">
        {cover ? (
          <CoverImg url={cover} displayPx={40} alt="" className="h-10 w-10 shrink-0 rounded-md object-cover" />
        ) : (
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-(--c-e8e2d9)"><Music size={14} className="text-(--c-b0a090)" /></div>
        )}
        <div className="min-w-0 flex-1">
          <p className="m-0 truncate text-sm font-medium leading-snug text-(--c-111)">{title}</p>
          <p className="m-0 truncate text-xs text-(--c-aaa)">{sub}</p>
        </div>
        <button
          type="button"
          onClick={onAdd}
          disabled={disabled || state === 'busy' || state === 'added'}
          aria-label={`Add ${title}`}
          className={`flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-3 text-[12.5px] font-semibold transition-colors ${
            state === 'added' ? 'bg-(--c-f2eee7) text-(--c-2d6a4f)' : 'bg-(--c-2d6a4f)/10 text-(--c-2d6a4f) hover:bg-(--c-2d6a4f)/[0.16] disabled:opacity-50'
          }`}
        >
          {state === 'busy' ? <VinylSpinner size={13} /> : state === 'added' ? <Check size={13} strokeWidth={2.6} className="pop" /> : <Plus size={13} strokeWidth={2.6} />}
          {state === 'added' ? 'In bin' : 'Add'}
        </button>
      </div>
      {error && <p className="m-0 mt-1 pl-13 text-[12.5px] text-(--c-b91c1c)">{error}</p>}
    </li>
  )
}

function ConfirmDelete({ title, onCancel, onConfirm }: { title: string; onCancel: () => void; onConfirm: () => Promise<void> }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm fade-in" onClick={busy ? undefined : onCancel} />
      <div role="alertdialog" aria-modal="true" aria-labelledby="delete-bin-title" className="relative w-full max-w-sm rounded-3xl bg-(--c-f9f8f6) p-6 shadow-xl pop-in">
        <h2 id="delete-bin-title" className="m-0 font-display text-[22px] font-bold text-(--c-1c1917)">Delete “{title}”?</h2>
        {error && <p className="m-0 mt-3 text-[13px] text-(--c-b91c1c)">{error}</p>}
        <div className="mt-6 flex justify-end gap-2">
          <button type="button" onClick={onCancel} disabled={busy} className="h-11 rounded-full px-5 text-[14.5px] font-semibold text-(--c-78716c) hover:bg-(--c-efebe5)">
            Cancel
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={async () => {
              setBusy(true)
              setError(null)
              try {
                await onConfirm()
              } catch (e) {
                setError(binErrorText(e, 'Couldn’t delete that bin'))
                setBusy(false)
              }
            }}
            className="flex h-11 items-center gap-2 rounded-full bg-(--c-b91c1c) px-6 text-[14.5px] font-semibold text-white hover:opacity-90 disabled:opacity-60"
          >
            {busy && <VinylSpinner size={17} />}
            Delete
          </button>
        </div>
      </div>
    </div>
  )
}
