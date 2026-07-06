import { useState, useRef, useEffect } from 'react'
import { useNavigate, Navigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Search, Loader2, Music, Play } from 'lucide-react'
import { fetchArtStrip, fetchAlbums, importAlbum } from '../api'
import type { SpotifyAlbumResult } from '../api'
import { useAlbumSearch } from '../hooks/useAlbumSearch'
import { useUser } from '../context/UserContext'

export const ONBOARDING_SKIP_KEY = 'pressd-onboarding-skipped'

/** One conveyor row of album covers, drifting left → right. */
function Belt({ urls, duration, size }: { urls: string[]; duration: number; size: string }) {
  // Duplicate once: the track animates -50% → 0, so the second copy makes
  // the loop seamless
  const content = [...urls, ...urls]
  return (
    <div className="belt-fade overflow-hidden">
      <div className="belt-track gap-3 py-1.5" style={{ '--belt-duration': `${duration}s` } as React.CSSProperties}>
        {content.map((url, i) => (
          <div key={i} className={`${size} shrink-0 rounded-xl overflow-hidden bg-[#ece6dc] shadow-[0_4px_14px_-4px_rgba(50,30,10,0.25)]`}>
            {url ? (
              <img src={url} alt="" loading="lazy" className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-[#e8dfd2] to-[#cfc3b0]">
                <Music size={20} className="text-[#b0a090]" strokeWidth={1.25} />
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

export default function Onboarding() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { activeUser } = useUser()
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<SpotifyAlbumResult | null>(null)
  const [showDropdown, setShowDropdown] = useState(false)
  const [importing, setImporting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)

  const { results, searching, mbPending, noResults } = useAlbumSearch(query)

  const { data: artUrls = [] } = useQuery({
    queryKey: ['art-strip'],
    queryFn: fetchArtStrip,
    staleTime: 10 * 60 * 1000,
  })

  // Someone with rated albums doesn't belong here (typed the URL, or just
  // finished their first rating in another tab)
  const { data: rated } = useQuery({
    queryKey: ['albums', 'rated', activeUser?.id],
    queryFn: () => fetchAlbums({ status: 'rated', userId: activeUser!.id }),
    enabled: !!activeUser,
  })

  useEffect(() => {
    setShowDropdown(results.length > 0 || mbPending)
  }, [results, mbPending])

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowDropdown(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  if ((rated ?? []).length > 0) return <Navigate to="/library" replace />

  // Always render 2 rows; placeholders keep the belt moving before art loads
  const row = (offset: number) =>
    artUrls.length >= 8
      ? artUrls.filter((_, i) => i % 2 === offset)
      : Array(12).fill('')

  function selectResult(r: SpotifyAlbumResult) {
    setSelected(r)
    setQuery(`${r.album_name} — ${r.artist}`)
    setShowDropdown(false)
  }

  async function handleStart() {
    if (!selected || !activeUser) return
    setImporting(true)
    setError(null)
    try {
      const album = await importAlbum(selected, 'listening', activeUser.id)
      queryClient.invalidateQueries({ queryKey: ['albums'] })
      navigate(`/rate/${album.id}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong — try again.')
      setImporting(false)
    }
  }

  function handleSkip() {
    sessionStorage.setItem(ONBOARDING_SKIP_KEY, '1')
    navigate('/library', { replace: true })
  }

  return (
    <div className="min-h-screen bg-[#faf8f5] flex flex-col overflow-hidden">

      {/* ── Conveyor: the community's shelves rolling past ─────────── */}
      <div className="pt-10 md:pt-14 -rotate-2 scale-[1.06] select-none pointer-events-none" aria-hidden="true">
        <Belt urls={row(0)} duration={75} size="w-24 h-24 md:w-28 md:h-28" />
        <div className="mt-3">
          <Belt urls={row(1)} duration={105} size="w-20 h-20 md:w-24 md:h-24" />
        </div>
      </div>

      {/* ── Copy + search ───────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col items-center px-4 pt-10 md:pt-14 pb-10">
        <div className="w-full max-w-md">
          <p className="text-[#2d6a4f] text-[11px] font-bold uppercase tracking-[0.18em] text-center">
            Welcome to Press'd
          </p>
          <h1 className="font-display text-[#1c1917] text-3xl md:text-4xl font-bold text-center leading-tight mt-2">
            Start with an album you know by heart.
          </h1>
          <p className="text-[#78716c] text-sm text-center mt-3 leading-relaxed">
            Your first rating starts your library — and starts teaching
            Press'd your taste. Search any album, then score it track by track.
          </p>

          {/* Search */}
          <div ref={dropdownRef} className="relative mt-8">
            <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#bbb] pointer-events-none" />
            {searching && (
              <Loader2 size={14} className="absolute right-3.5 top-1/2 -translate-y-1/2 text-[#bbb] animate-spin pointer-events-none" />
            )}
            <input
              autoFocus
              type="text"
              placeholder="Search any album or artist…"
              value={query}
              onChange={(e) => { setQuery(e.target.value); setSelected(null) }}
              onFocus={() => results.length > 0 && setShowDropdown(true)}
              className={`w-full bg-white border text-[#111] text-sm pl-10 pr-9 py-3 rounded-xl focus:outline-none focus:border-[#2d6a4f] transition-colors placeholder:text-[#bbb] shadow-sm ${selected ? 'border-[#2d6a4f]' : 'border-[#e8e2d9]'}`}
            />
            {showDropdown && (
              <div className="absolute z-10 top-full mt-1.5 left-0 right-0 bg-white border border-[#e8e2d9] rounded-xl shadow-lg overflow-hidden max-h-72 overflow-y-auto">
                {results.map((r, i) => (
                  <button
                    key={i}
                    type="button"
                    onMouseDown={(e) => { e.preventDefault(); selectResult(r) }}
                    className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-[#f7f3ee] transition-colors text-left border-b border-[#f0ebe3] last:border-0"
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
                      <p className="text-[#aaa] text-xs truncate">
                        {r.artist}{r.year ? ` · ${r.year}` : ''}
                      </p>
                    </div>
                  </button>
                ))}
                {mbPending && (
                  <div className="flex items-center gap-2 px-3 py-2 text-[11px] text-[#a8998a] border-t border-[#f0ebe3] bg-[#fafafa]">
                    <Loader2 size={11} className="animate-spin shrink-0" />
                    Checking more sources…
                  </div>
                )}
              </div>
            )}
          </div>

          {noResults && !searching && query.trim().length >= 2 && (
            <p className="text-[#a8998a] text-xs text-center mt-3">
              No results — try another spelling or a different album.
            </p>
          )}

          {/* Selected album preview */}
          {selected && (
            <div className="flex items-center gap-3 bg-white rounded-xl px-3.5 py-3 border border-[#2d6a4f]/25 shadow-sm mt-4">
              {selected.cover_url ? (
                <img src={selected.cover_url} alt="" className="w-12 h-12 rounded-lg object-cover shrink-0" />
              ) : (
                <div className="w-12 h-12 rounded-lg bg-[#e8e2d9] shrink-0" />
              )}
              <div className="min-w-0">
                <p className="text-[#111] text-sm font-semibold truncate">{selected.album_name}</p>
                <p className="text-[#aaa] text-xs truncate">
                  {selected.artist}{selected.year ? ` · ${selected.year}` : ''} · {selected.total_tracks} tracks
                </p>
              </div>
            </div>
          )}

          {error && <p className="text-[#c0392b] text-xs text-center mt-3">{error}</p>}

          <button
            type="button"
            onClick={handleStart}
            disabled={!selected || importing}
            className="w-full mt-4 py-3 rounded-xl text-sm font-semibold bg-[#2d6a4f] hover:bg-[#245c43] active:bg-[#1e5238] text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#2d6a4f]"
          >
            {importing
              ? <><Loader2 size={14} className="animate-spin" /> Setting up…</>
              : <><Play size={12} fill="currentColor" strokeWidth={0} /> Start rating</>}
          </button>

          <button
            type="button"
            onClick={handleSkip}
            className="block mx-auto mt-5 text-[#a8998a] text-xs hover:text-[#78716c] transition-colors"
          >
            I'll explore first →
          </button>
        </div>
      </div>
    </div>
  )
}
