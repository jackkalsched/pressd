import { useState, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { X, Loader2, Search, Music } from 'lucide-react'
import { searchSpotify, searchMusicBrainz, searchItunes, importAlbum, createAlbum } from '../api'
import type { SpotifyAlbumResult } from '../api'

type SearchSource = 'spotify' | 'itunes' | 'musicbrainz' | 'manual'

const SOURCE_LABELS: Record<SearchSource, string> = {
  spotify: 'Spotify',
  itunes: 'iTunes',
  musicbrainz: 'MusicBrainz',
  manual: 'Manual',
}

export default function AddAlbumModal({ onClose, userId }: { onClose: () => void; userId: number }) {
  const [query, setQuery] = useState('')
  const [albumName, setAlbumName] = useState('')
  const [artist, setArtist] = useState('')
  const [source, setSource] = useState<SearchSource>('itunes')
  const [status, setStatus] = useState<'listening' | 'to_listen'>('listening')
  const [results, setResults] = useState<SpotifyAlbumResult[]>([])
  const [selected, setSelected] = useState<SpotifyAlbumResult | null>(null)
  const [searching, setSearching] = useState(false)
  const [showDropdown, setShowDropdown] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const dropdownRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (source === 'manual' || query.trim().length < 2) {
      setResults([])
      setShowDropdown(false)
      setSearching(false)
      return
    }
    setSearching(true)
    const timer = setTimeout(async () => {
      try {
        const fn = source === 'spotify' ? searchSpotify
          : source === 'itunes' ? searchItunes
          : searchMusicBrainz
        const q = source === 'spotify' ? `album:${query.trim()}` : query.trim()
        const res = await fn(q)
        setResults(res.slice(0, 8))
        setShowDropdown(res.length > 0)
      } catch {
        setResults([])
        setShowDropdown(false)
      } finally {
        setSearching(false)
      }
    }, 380)
    return () => clearTimeout(timer)
  }, [query, source])

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
          <h2 className="text-[#111] font-semibold">Add Album</h2>
          <button onClick={onClose} className="text-[#aaa] hover:text-[#555] transition-colors">
            <X size={18} />
          </button>
        </div>

        <div className="flex gap-1.5 mb-3">
          {(['itunes', 'spotify', 'musicbrainz', 'manual'] as SearchSource[]).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => {
                setSource(s)
                setSelected(null)
                setResults([])
                setShowDropdown(false)
                if (s === 'manual') setStatus('to_listen')
              }}
              className={`flex-1 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                source === s
                  ? 'bg-[#2d6a4f]/10 border border-[#2d6a4f]/40 text-[#2d6a4f]'
                  : 'bg-[#f5f5f5] border border-[#e2e2e2] text-[#aaa] hover:text-[#555]'
              }`}
            >
              {SOURCE_LABELS[s]}
            </button>
          ))}
        </div>

        {source === 'manual' ? (
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
                <div className="absolute z-10 top-full mt-1 left-0 right-0 bg-white border border-[#e2e2e2] rounded-xl shadow-lg overflow-hidden max-h-60 overflow-y-auto">
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
                        <p className="text-[#111] text-sm font-medium truncate leading-snug">{r.album_name}</p>
                        <p className="text-[#aaa] text-xs truncate">{r.artist}{r.year ? ` · ${r.year}` : ''}</p>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>

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
                  </p>
                </div>
              </div>
            )}

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
          </div>
        )}
      </div>
    </div>
  )
}
