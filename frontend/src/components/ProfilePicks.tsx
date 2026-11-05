// The shelf on a profile — four of the person's rated albums, overlapping and
// staggered — and, on your own, the picker behind each slot.
// Mobile's ProfileBanner ShelfRow and its app/favorite/album screen, as covers
// and a dialog.
//
// The shelf lives on the account (PressUser.shelf; PATCH /users/{id}), so one
// shelf shows on both platforms. Hidden until picks_unlocked — ten rated
// albums, PICKS_MIN_RATED_ALBUMS in backend/routers/users.py — as on mobile.
// On your own page every slot shows, the empty ones as the invitation to fill
// them; on someone else's only the albums do, and a bare shelf isn't drawn.
import { useMemo, useState, type CSSProperties } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Loader2, Plus, Search, X } from 'lucide-react'
import { SHELF_SIZE, fetchAlbums, shelfWith, updateUser, type Profile } from '../api'
import CoverImg from './CoverImg'
import { Cover } from './covers'
import { songScoreColor } from '../types'

// Each cover's lean and lift, so the row reads as records stood up by hand
// rather than a grid. Mobile's SHELF_TILT / SHELF_LIFT, scaled up.
const TILT = [-3, 2, -1.5, 2.5]
const LIFT = [0, -10, -3, -12]

/** "jack's", "james'". */
function possessive(name: string): string {
  return /s$/i.test(name) ? `${name}'` : `${name}'s`
}

export default function ProfilePicks({ profile, editable }: { profile: Profile; editable: boolean }) {
  const [picking, setPicking] = useState<number | null>(null)
  if (!profile.picks_unlocked) return null

  const slots = (profile.shelf ?? []).slice(0, SHELF_SIZE).map((album, slot) => ({ album, slot }))
  const shown = editable ? slots : slots.filter((s) => s.album)
  if (shown.length === 0) return null

  return (
    <section className="mb-8">
      <h2 className="font-wide m-0 mb-4 text-[19px] tracking-[0.01em] text-[#1c1917]">{possessive(profile.name)} shelf</h2>
      <div className="max-w-3xl">
        <div className="flex items-end pt-4">
          {shown.map(({ album, slot }, i) => {
            const face = album ? (
              <div className="relative aspect-square overflow-hidden rounded-xl bg-[#ebe5dc]">
                <span className="font-display absolute inset-0 flex items-center justify-center text-[40px] text-[#a8998a]">
                  {album.album_name[0]?.toUpperCase()}
                </span>
                {album.album_art_url && (
                  <CoverImg url={album.album_art_url} displayPx={180} alt="" className="absolute inset-0 h-full w-full object-cover" />
                )}
              </div>
            ) : (
              <div className="flex aspect-square items-center justify-center rounded-xl border-2 border-dashed border-[#d7cfc3] bg-[#f9f8f6] text-[#c8c0b4]">
                <Plus size={28} />
              </div>
            )
            // Where it stands; .shelf-record (index.css) lifts it out from there.
            const style = { zIndex: i, '--lift': `${LIFT[i]}px`, '--tilt': `${TILT[i]}deg` } as CSSProperties
            const className = `shelf-record block min-w-0 flex-1 ${i > 0 ? '-ml-6' : ''} rounded-xl`
            return editable ? (
              <button
                key={slot}
                onClick={() => setPicking(slot)}
                className={`${className} cursor-pointer border-none bg-transparent p-0 text-left`}
                style={style}
                title={album ? `${album.album_name} — ${album.artist}` : undefined}
                aria-label={album ? `${album.album_name} by ${album.artist}. Change` : 'Add an album to your shelf'}
              >
                {face}
              </button>
            ) : (
              <Link
                key={slot}
                to={`/album/${album!.id}`}
                className={className}
                style={style}
                title={`${album!.album_name} — ${album!.artist}`}
              >
                {face}
              </Link>
            )
          })}
        </div>
      </div>
      {picking != null && <ShelfDialog slot={picking} profile={profile} onClose={() => setPicking(null)} />}
    </section>
  )
}

function ShelfDialog({ slot, profile, onClose }: { slot: number; profile: Profile; onClose: () => void }) {
  const qc = useQueryClient()
  const userId = profile.id
  const [search, setSearch] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const shelf = profile.shelf ?? []
  const here = shelf[slot] ?? null
  const onShelf = new Set(shelf.flatMap((a) => (a ? [a.id] : [])))

  const albums = useQuery({
    queryKey: ['albums', 'rated', userId],
    queryFn: () => fetchAlbums({ status: 'rated', userId }),
  })

  const q = search.trim().toLowerCase()
  const rows = useMemo(
    () => [...(albums.data ?? [])]
      .filter((a) => !q || a.albumName.toLowerCase().includes(q) || a.artist.toLowerCase().includes(q))
      .sort((a, b) => (b.score ?? -1) - (a.score ?? -1)),
    [albums.data, q],
  )

  // An album already elsewhere on the shelf moves to this slot.
  async function save(albumId: number | null) {
    if (saving) return
    setSaving(true)
    setError(null)
    try {
      qc.setQueryData(['profile', userId], await updateUser(userId, { shelf: shelfWith(shelf, slot, albumId) }))
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save your shelf')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm fade-in" onClick={saving ? undefined : onClose} />
      <div role="dialog" aria-modal="true" aria-labelledby="shelf-title" className="relative flex max-h-[80vh] w-full max-w-lg flex-col rounded-3xl bg-[#f9f8f6] shadow-xl pop-in">
        <div className="px-6 pt-6">
          <div className="flex items-start justify-between gap-4">
            <h2 id="shelf-title" className="font-display m-0 text-[24px] font-bold leading-tight text-[#1c1917]">Which record goes on your shelf?</h2>
            <button onClick={onClose} aria-label="Close" className="mt-1 text-[#a8998a] hover:text-[#57534e]"><X size={18} /></button>
          </div>
          <div className="mt-4 flex items-center gap-2 rounded-xl border border-[#e2dbd0] bg-white px-3 py-2.5">
            <Search size={15} className="text-[#a8998a]" />
            <input
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search your rated albums"
              className="flex-1 bg-transparent text-[14px] text-[#1c1917] placeholder:text-[#b5aa9c] focus:outline-none"
            />
          </div>
          <div className="flex items-center justify-between py-2">
            {error ? <p className="m-0 text-[13px] text-[#b91c1c]">{error}</p> : <span />}
            {here && (
              <button onClick={() => save(null)} disabled={saving} className="text-[13px] font-medium text-[#78716c] hover:text-[#1c1917]">
                Take it off the shelf
              </button>
            )}
          </div>
        </div>
        <ul className="m-0 min-h-0 flex-1 list-none overflow-y-auto px-3 pb-4">
          {albums.isLoading ? (
            <li className="flex justify-center py-10"><Loader2 size={18} className="animate-spin text-[#2d6a4f]" /></li>
          ) : rows.length === 0 ? (
            <li className="py-10 text-center text-[14px] text-[#8a7f72]">{q ? 'Nothing matches your search.' : 'No rated albums yet.'}</li>
          ) : rows.map((a, i) => (
            <li key={a.id}>
              <button
                onClick={() => save(a.id)}
                disabled={saving}
                className="flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left transition-colors hover:bg-[#f2eee7] disabled:opacity-60"
              >
                <span className="w-6 shrink-0 text-right text-[12.5px] tabular-nums text-[#b5aa9c]">{i + 1}</span>
                <span className="h-10 w-10 shrink-0 overflow-hidden rounded-lg">
                  {a.albumArtUrl ? <CoverImg url={a.albumArtUrl} displayPx={40} alt="" className="h-full w-full object-cover" /> : <Cover artUrl={null} seed={a.albumName} size={40} radius={0} fontSize={16} />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14.5px] font-semibold text-[#1c1917]">{a.albumName}</span>
                  <span className="block truncate text-[12.5px] text-[#8a7f72]">{a.artist}</span>
                </span>
                {a.score != null && (
                  <span className="font-display shrink-0 text-[16px] font-bold tabular-nums" style={{ color: songScoreColor(a.score) }}>
                    {a.score.toFixed(2)}
                  </span>
                )}
                {/* Ticked: everything on the shelf, so a record isn't picked twice by mistake. */}
                <span className="w-5 shrink-0">{onShelf.has(a.id) && <Check size={17} className="text-[#2d6a4f]" strokeWidth={2.6} />}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
