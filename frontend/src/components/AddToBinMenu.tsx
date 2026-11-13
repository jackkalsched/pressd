// Add to bin… on an album page — your copy and the community view (spec §5),
// never inside the rating flow. A dropdown of your own bins, plus New bin,
// which makes one and puts this album in it.
//
// A copy of yours goes by its id, so the bin stores exactly the tracklist you
// hold; a record you don't hold is resolved from the catalogs by name, as
// "Rate now" on a public page does, once per menu.
import { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, FolderPlus, Plus } from 'lucide-react'
import { addToBin, fetchBins, resolveReleaseByName, type BinCard } from '../api'
import { binErrorText } from '../lib/bins'
import { useUser } from '../context/UserContext'
import { BinMosaic } from './BinCard'
import NewBinDialog from './NewBinDialog'
import VinylSpinner from './VinylSpinner'
import { PILL } from './albumView'

export default function AddToBinMenu({ ownAlbumId, albumName, artist }: {
  /** Your copy of the record, in any edition, when you have one. */
  ownAlbumId: number | null
  albumName: string
  artist: string
}) {
  const queryClient = useQueryClient()
  const { activeUser } = useUser()
  const [open, setOpen] = useState(false)
  const [making, setMaking] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [added, setAdded] = useState<string[]>([])
  const [error, setError] = useState<{ slug: string; text: string } | null>(null)
  const menu = useRef<HTMLDivElement>(null)
  const release = useRef<Promise<Record<string, unknown>> | null>(null)

  const { data: bins, isLoading } = useQuery({
    queryKey: ['bins', 'mine', activeUser?.id],
    queryFn: () => fetchBins('mine'),
    enabled: open && !!activeUser,
  })

  useEffect(() => {
    if (!open) return
    const down = (ev: MouseEvent) => { if (!menu.current?.contains(ev.target as Node)) setOpen(false) }
    const key = (ev: KeyboardEvent) => { if (ev.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', down)
    document.addEventListener('keydown', key)
    return () => { document.removeEventListener('mousedown', down); document.removeEventListener('keydown', key) }
  }, [open])

  function source(): Promise<{ albumId: number } | { release: Record<string, unknown> }> {
    if (ownAlbumId != null) return Promise.resolve({ albumId: ownAlbumId })
    if (!release.current) {
      release.current = resolveReleaseByName(albumName, artist).then((r) => r as unknown as Record<string, unknown>)
      // A failed lookup isn't kept, so the next tap asks again.
      release.current.catch(() => { release.current = null })
    }
    return release.current.then((r) => ({ release: r }))
  }

  async function add(slug: string) {
    if (busy) return
    setBusy(slug)
    setError(null)
    try {
      await addToBin(slug, await source())
      setAdded((a) => [...a, slug])
      // The response is a partial entry; the bin's own page refetches whole.
      queryClient.invalidateQueries({ queryKey: ['bin', slug] })
      queryClient.invalidateQueries({ queryKey: ['bins'] })
    } catch (e) {
      setError({ slug, text: binErrorText(e, 'Couldn’t add it to that bin') })
    } finally {
      setBusy(null)
    }
  }

  function created(bin: BinCard) {
    setMaking(false)
    setOpen(true)
    void add(bin.slug)
  }

  return (
    <div ref={menu} className="relative">
      <button onClick={() => setOpen((v) => !v)} aria-haspopup="menu" aria-expanded={open} className={PILL}>
        <FolderPlus size={13} /> Add to bin
      </button>
      {open && (
        <div
          role="menu"
          className="menu-in absolute right-0 top-full z-30 mt-1.5 w-72 overflow-hidden rounded-xl border border-(--c-e2dbd0) bg-(--c-fff) py-1 shadow-lg"
          style={{ transformOrigin: 'top right' }}
        >
          {isLoading ? (
            <div className="flex justify-center py-4"><VinylSpinner size={24} /></div>
          ) : (
            <div className="max-h-80 overflow-y-auto">
              {(bins ?? []).map((b) => {
                const done = added.includes(b.slug)
                return (
                  <div key={b.slug}>
                    <button
                      role="menuitem"
                      onClick={() => !done && add(b.slug)}
                      disabled={busy != null}
                      className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-(--c-efe9e0) disabled:cursor-default"
                    >
                      <BinMosaic covers={b.covers} coverUrl={b.coverUrl} size={36} rounded="rounded-md" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[14px] font-medium text-(--c-1c1917)">{b.title}</span>
                        <span className="block text-[12px] text-(--c-8a7f72)">
                          {b.entryCount} {b.entryCount === 1 ? 'album' : 'albums'}
                        </span>
                      </span>
                      {busy === b.slug ? (
                        <VinylSpinner size={18} />
                      ) : done ? (
                        <Check size={16} className="pop text-(--c-2d6a4f)" />
                      ) : null}
                    </button>
                    {error?.slug === b.slug && (
                      <p className="m-0 px-3 pb-2 text-[12.5px] text-(--c-b91c1c)">{error.text}</p>
                    )}
                  </div>
                )
              })}
            </div>
          )}
          <div className="my-1 border-t border-(--c-e8e2d9)" />
          <button
            role="menuitem"
            onClick={() => { setOpen(false); setMaking(true) }}
            disabled={busy != null}
            className="flex w-full items-center gap-2 px-3.5 py-2.5 text-left text-[14px] font-semibold text-(--c-2d6a4f) hover:bg-(--c-efe9e0)"
          >
            <Plus size={15} strokeWidth={2.4} /> New bin
          </button>
        </div>
      )}
      {making && <NewBinDialog onClose={() => setMaking(false)} onCreated={created} />}
    </div>
  )
}
