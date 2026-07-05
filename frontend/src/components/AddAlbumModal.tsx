import { useState, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { X, Loader2, Search, Music, ArrowLeft } from 'lucide-react'
import { searchSpotify, searchMusicBrainz, searchItunes, searchDeezer, importAlbum, createAlbum } from '../api'
import type { SpotifyAlbumResult } from '../api'

function normalizeKey(name: string, artist: string): string {
  return `${name}|||${artist}`.toLowerCase().replace(/[^a-z0-9|]/g, '')
}

function mergeResults(
  itunes: SpotifyAlbumResult[],
  spotify: SpotifyAlbumResult[],
  deezer: SpotifyAlbumResult[],
  mb: SpotifyAlbumResult[],
): SpotifyAlbumResult[] {
  const seen = new Map<string, SpotifyAlbumResult>()
  for (const r of [...itunes, ...spotify, ...deezer, ...mb]) {
    const key = normalizeKey(r.album_name, r.artist)
    const existing = seen.get(key)
    if (!existing) {
      seen.set(key, r)
    } else if (!existing.cover_url && r.cover_url) {
      seen.set(key, r)
    }
  }
  return [...seen.values()].slice(0, 12)
}

export default function AddAlbumModal({ onClose, userId }: { onClose: () => void; userId: number }) {
  const [query, setQuery] = useState('')
  const [manualMode, setManualMode] = useState(false)
  const [albumName, setAlbumName] = useState('')
  const [artist, setArtist] = useState('')
  const [status, setStatus] = useState<'listening' | 'to_listen'>('listening')
  const [results, setResults] = useState<SpotifyAlbumResult[]>([])
  const [selected, setSelected] = useState<SpotifyAlbumResult | null>(null)
  const [searching, setSearching] = useState(false)
  const [mbPending, setMbPending] = useState(false)
  const [noResults, setNoResults] = useState(false)
  const [showDropdown, setShowDropdown] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const dropdownRef = useRef<HTMLDivElement>(null)

  // Fan out to all 4 APIs simultaneously. The three fast sources (iTunes,
  // Spotify, Deezer) populate the dropdown immediately; MusicBrainz — slow
  // (global ~1 req/s limit) but the only source with announced/unreleased
  // albums — is merged in when it arrives instead of holding everything up.
  useEffect(() => {
    if (query.trim().length < 2) {
      setResults([])
      setShowDropdown(false)
      setSearching(false)
      setMbPending(false)
      setNoResults(false)
      return
    }
    setSearching(true)
    setMbPending(false)
    setNoResults(false)
    let cancelled = false
    const timer = setTimeout(async () => {
      const q = query.trim()
      const mbPromise = searchMusicBrainz(q).catch(() => [] as SpotifyAlbumResult[])
      try {
        const [itunesRes, spotifyRes, deezerRes] = await Promise.allSettled([
          searchItunes(q),
          searchSpotify(`album:${q}`),
          searchDeezer(q),
        ])
        if (cancelled) return
        const itunes  = itunesRes.status  === 'fulfilled' ? itunesRes.value  : []
        const spotify = spotifyRes.status === 'fulfilled' ? spotifyRes.value : []
        const deezer  = deezerRes.status  === 'fulfilled' ? deezerRes.value  : []
        const fast = mergeResults(itunes, spotify, deezer, [])
        setResults(fast)
        // Keep the dropdown open even with zero fast results — the pending
        // row tells the user slower sources are still being searched
        setShowDropdown(true)
        setMbPending(true)

        const mb = await mbPromise
        if (cancelled) return
        setMbPending(false)
        const merged = mergeResults(itunes, spotify, deezer, mb)
        setResults(merged)
        setShowDropdown(merged.length > 0)
        setNoResults(merged.length === 0)
      } catch {
        if (cancelled) return
        setResults([])
        setShowDropdown(false)
        setMbPending(false)
        setNoResults(true)
      } finally {
        if (!cancelled) setSearching(false)
      }
    }, 380)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [query])

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowDropdown(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  function selectResult(r: SpotifyAlbumResult) {
    setSelected(r)
    setQuery(`${r.album_name} — ${r.artist}`)
    setShowDropdown(false)
  }

  async function handleAdd() {
    if (!selected) return
    setLoading(true)
    setError(null)
    try {
      const album = await importAlbum(selected, status, userId)
      queryClient.invalidateQueries({ queryKey: ['albums'] })
      if (status === 'listening') navigate(`/rate/${album.id}`)
      else onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.')
      setLoading(false)
    }
  }

  async function handleManualSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!albumName.trim() || !artist.trim()) return
    setLoading(true)
    setError(null)
    try {
      await createAlbum({ albumName: albumName.trim(), artist: artist.trim(), status: 'to_listen', userId })
      queryClient.invalidateQueries({ queryKey: ['albums'] })
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.')
      setLoading(false)
    }
  }

  const inputCls = 'w-full bg-[#f5f5f5] border border-[#e2e2e2] text-[#111] text-sm px-4 py-2.5 rounded-lg focus:outline-none focus:border-[#2d6a4f] transition-colors placeholder:text-[#bbb]'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white border border-[#e2e2e2] rounded-2xl p-6 w-full max-w-sm mx-4 shadow-xl">

        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2">
            {manualMode && (
              <button onClick={() => setManualMode(false)} className="text-[#aaa] hover:text-[#555] transition-colors -ml-1 p-1">
                <ArrowLeft size={16} />
              </button>
            )}
            <h2 className="text-[#111] font-semibold">
              {manualMode ? 'Add Manually' : 'Add Album'}
            </h2>
          </div>
          <button onClick={onClose} className="text-[#aaa] hover:text-[#555] transition-colors">
            <X size={18} />
          </button>
        </div>

        {manualMode ? (
          <form onSubmit={handleManualSubmit} className="flex flex-col gap-3">
            <input autoFocus type="text" placeholder="Album name" value={albumName}
              onChange={(e) => setAlbumName(e.target.value)} className={inputCls} />
            <input type="text" placeholder="Artist" value={artist}
              onChange={(e) => setArtist(e.target.value)} className={inputCls} />
            <p className="text-[#aaa] text-[11px] -mt-1">Adds without track data — useful for unreleased albums.</p>
            {error && <p className="text-[#c0392b] text-xs">{error}</p>}
            <button type="submit" disabled={loading || !albumName.trim() || !artist.trim()}
              className="w-full py-2.5 rounded-xl text-sm font-semibold bg-[#2d6a4f] hover:bg-[#245c43] text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2">
              {loading ? <><Loader2 size={14} className="animate-spin" /> Adding…</> : 'Add to List'}
            </button>
          </form>
        ) : (
          <div className="flex flex-col gap-3">
            {/* Unified search input */}
            <div ref={dropdownRef} className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#bbb] pointer-events-none" />
              {searching && (
                <Loader2 size={13} className="absolute right-3 top-1/2 -translate-y-1/2 text-[#bbb] animate-spin pointer-events-none" />
              )}
              <input
                autoFocus
                type="text"
                placeholder="Search album or artist…"
                value={query}
                onChange={(e) => { setQuery(e.target.value); setSelected(null) }}
                onFocus={() => results.length > 0 && setShowDropdown(true)}
                className={`${inputCls} pl-9 pr-8 ${selected ? 'border-[#2d6a4f]' : ''}`}
              />
              {showDropdown && (
                <div className="absolute z-10 top-full mt-1 left-0 right-0 bg-white border border-[#e2e2e2] rounded-xl shadow-lg overflow-hidden max-h-64 overflow-y-auto">
                  {results.map((r, i) => (
                    <button
                      key={i}
                      type="button"
                      onMouseDown={(e) => { e.preventDefault(); selectResult(r) }}
                      className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-[#f5f5f5] transition-colors text-left border-b border-[#f0f0f0] last:border-0"
                    >
                      {r.cover_url ? (
                        <img src={r.cover_url} alt="" className="w-9 h-9 rounded-md object-cover shrink-0" />
                      ) : (
                        <div className="w-9 h-9 rounded-md bg-[#e8e2d9] shrink-0 flex items-center justify-center">
                          <Music size={13} className="text-[#b0a090]" />
                        </div>
                      )}
                      <div className="min-w-0">
                        <p className="text-[#111] text-sm font-medium truncate leading-snug">
                          {r.album_name}
                          {r.upcoming && (
                            <span className="ml-1.5 align-middle inline-block px-1.5 py-px rounded-full bg-[#2d6a4f]/10 text-[#2d6a4f] text-[10px] font-semibold">
                              Upcoming
                            </span>
                          )}
                        </p>
                        <p className="text-[#aaa] text-xs truncate">
                          {r.artist}
                          {r.upcoming && r.release_date ? ` · ${r.release_date}` : r.year ? ` · ${r.year}` : ''}
                        </p>
                      </div>
                    </button>
                  ))}
                  {mbPending && (
                    <div className="flex items-center gap-2 px-3 py-2 text-[11px] text-[#a8998a] border-t border-[#f0f0f0] bg-[#fafafa]">
                      <Loader2 size={11} className="animate-spin shrink-0" />
                      Checking more sources for new &amp; upcoming releases…
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* No results nudge */}
            {noResults && !searching && query.trim().length >= 2 && (
              <p className="text-[#a8998a] text-xs text-center py-1">
                No results found.{' '}
                <button onClick={() => setManualMode(true)} className="text-[#2d6a4f] font-medium hover:underline">
                  Add manually →
                </button>
              </p>
            )}

            {/* Selected album preview */}
            {selected && (
              <div className="flex items-center gap-3 bg-[#f5f5f5] rounded-xl px-3 py-2.5 border border-[#2d6a4f]/25">
                {selected.cover_url ? (
                  <img src={selected.cover_url} alt="" className="w-10 h-10 rounded-lg object-cover shrink-0" />
                ) : (
                  <div className="w-10 h-10 rounded-lg bg-[#e8e2d9] shrink-0" />
                )}
                <div className="min-w-0">
                  <p className="text-[#111] text-sm font-semibold truncate">{selected.album_name}</p>
                  <p className="text-[#aaa] text-xs truncate">
                    {selected.artist}{selected.year ? ` · ${selected.year}` : ''} · {selected.total_tracks} tracks
                    {selected.upcoming ? ` · out ${selected.release_date ?? 'soon'}` : ''}
                  </p>
                </div>
              </div>
            )}

            {/* Status */}
            <div className="flex gap-2">
              {(['listening', 'to_listen'] as const).map((s) => (
                <button key={s} type="button" onClick={() => setStatus(s)}
                  className={`flex-1 py-2 rounded-lg text-xs font-medium transition-colors ${
                    status === s
                      ? 'bg-[#2d6a4f]/10 border border-[#2d6a4f]/40 text-[#2d6a4f]'
                      : 'bg-[#f5f5f5] border border-[#e2e2e2] text-[#aaa] hover:text-[#555]'
                  }`}>
                  {s === 'listening' ? 'Rate Now' : 'Add to List'}
                </button>
              ))}
            </div>

            {error && <p className="text-[#c0392b] text-xs">{error}</p>}

            <button type="button" onClick={handleAdd} disabled={loading || !selected}
              className="w-full py-2.5 rounded-xl text-sm font-semibold bg-[#2d6a4f] hover:bg-[#245c43] text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2">
              {loading ? <><Loader2 size={14} className="animate-spin" /> Adding…</> : 'Confirm'}
            </button>

            {/* Manual fallback — always available */}
            {!noResults && (
              <button onClick={() => setManualMode(true)}
                className="text-[#a8998a] text-xs text-center hover:text-[#78716c] transition-colors">
                Can't find it? Add manually →
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
