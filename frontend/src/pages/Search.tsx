import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { Search as SearchIcon, Plus, Play, Loader2, Check, Image } from 'lucide-react'
import { searchSpotify, searchMusicBrainz, importAlbum, backfillCovers } from '../api'
import type { SpotifyAlbumResult } from '../api'

type ActionState = 'idle' | 'loading' | 'done'
type Source = 'spotify' | 'mb'

function resultKey(r: SpotifyAlbumResult) {
  return r.spotify_id ?? r.mb_id ?? `${r.album_name}::${r.artist}`
}

export default function Search() {
  const [query, setQuery] = useState('')
  const [source, setSource] = useState<Source>('spotify')
  const [searching, setSearching] = useState(false)
  const [results, setResults] = useState<SpotifyAlbumResult[]>([])
  const [error, setError] = useState<string | null>(null)
  const [actions, setActions] = useState<Record<string, { add: ActionState; rate: ActionState }>>({})
  const [backfillState, setBackfillState] = useState<'idle' | 'loading' | 'done'>('idle')
  const [backfillResult, setBackfillResult] = useState<{ updated: number; skipped: number; failed: number } | null>(null)
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  async function handleBackfill() {
    setBackfillState('loading')
    setBackfillResult(null)
    try {
      const result = await backfillCovers()
      setBackfillResult(result)
      setBackfillState('done')
      queryClient.invalidateQueries({ queryKey: ['albums'] })
    } catch {
      setBackfillState('idle')
    }
  }

  async function handleSearch() {
    const q = query.trim()
    if (!q) return
    setSearching(true)
    setError(null)
    setResults([])
    setActions({})
    try {
      const data = source === 'mb' ? await searchMusicBrainz(q) : await searchSpotify(q)
      setResults(data)
      if (data.length === 0) setError('No results found.')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Search failed. Check that the backend is running.')
    } finally {
      setSearching(false)
    }
  }

  function setAction(key: string, field: 'add' | 'rate', state: ActionState) {
    setActions((prev) => ({
      ...prev,
      [key]: { add: 'idle', rate: 'idle', ...prev[key], [field]: state },
    }))
  }

  async function handleAdd(result: SpotifyAlbumResult) {
    const key = resultKey(result)
    setAction(key, 'add', 'loading')
    try {
      await importAlbum(result, 'to_listen')
      queryClient.invalidateQueries({ queryKey: ['albums'] })
      setAction(key, 'add', 'done')
    } catch {
      setAction(key, 'add', 'idle')
    }
  }

  async function handleRate(result: SpotifyAlbumResult) {
    const key = resultKey(result)
    setAction(key, 'rate', 'loading')
    try {
      const album = await importAlbum(result, 'listening')
      queryClient.invalidateQueries({ queryKey: ['albums'] })
      navigate(`/rate/${album.id}`)
    } catch {
      setAction(key, 'rate', 'idle')
    }
  }

  return (
    <div className="p-8 max-w-2xl">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold text-white">Search Albums</h1>
        <button
          onClick={handleBackfill}
          disabled={backfillState === 'loading'}
          className="flex items-center gap-1.5 text-xs text-[#888] hover:text-[#e8e8e8] px-3 py-1.5 bg-[#1a1a1a] border border-[#2a2a2a] hover:border-[#444] rounded-lg transition-colors disabled:opacity-40"
        >
          {backfillState === 'loading'
            ? <Loader2 size={12} className="animate-spin" />
            : <Image size={12} />}
          {backfillState === 'loading' ? 'Fetching covers…' : backfillState === 'done' ? `Done — ${backfillResult?.updated} updated` : 'Backfill covers'}
        </button>
      </div>

      {/* Source toggle */}
      <div className="flex gap-1 mb-4 bg-[#1a1a1a] border border-[#2a2a2a] rounded-lg p-1 w-fit">
        {(['spotify', 'mb'] as const).map((s) => (
          <button
            key={s}
            onClick={() => { setSource(s); setResults([]); setError(null) }}
            className={`text-xs font-medium px-3 py-1.5 rounded-md transition-colors ${
              source === s
                ? 'bg-[#c8a84b] text-black'
                : 'text-[#888] hover:text-[#e8e8e8]'
            }`}
          >
            {s === 'spotify' ? 'Spotify' : 'MusicBrainz'}
          </button>
        ))}
      </div>

      <div className="flex gap-3 mb-8">
        <div className="flex-1 relative">
          <SearchIcon size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#555]" />
          <input
            type="text"
            placeholder={source === 'mb' ? 'Album name or artist…' : 'Album name or Spotify URL…'}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            className="w-full bg-[#1a1a1a] border border-[#2a2a2a] text-[#e8e8e8] text-sm pl-9 pr-4 py-2.5 rounded-lg focus:outline-none focus:border-[#c8a84b] transition-colors placeholder:text-[#444]"
          />
        </div>
        <button
          onClick={handleSearch}
          disabled={searching}
          className="bg-[#c8a84b] hover:bg-[#d4b45e] disabled:opacity-50 text-black text-sm font-semibold px-5 rounded-lg transition-colors"
        >
          Search
        </button>
      </div>

      {searching && (
        <div className="flex flex-col items-center gap-1.5 text-[#888] text-sm py-8">
          <div className="flex items-center gap-2">
            <Loader2 size={16} className="animate-spin" />
            Fetching metadata…
          </div>
          {source === 'mb' && (
            <p className="text-[#555] text-xs">MusicBrainz may take a few seconds</p>
          )}
        </div>
      )}

      {error && !searching && (
        <div className="text-center py-12">
          <p className="text-[#888] text-sm">{error}</p>
          {error.includes('rate limit') && (
            <p className="text-[#555] text-xs mt-2">Spotify rate limit hit — paste a Spotify album URL to bypass the search API, or try again later.</p>
          )}
        </div>
      )}

      {!searching && results.length > 0 && (
        <div className="flex flex-col gap-3">
          {results.map((result) => {
            const key = resultKey(result)
            const state = actions[key] ?? { add: 'idle', rate: 'idle' }
            const busy = state.add === 'loading' || state.rate === 'loading'

            return (
              <div
                key={key}
                className="flex items-center gap-4 bg-[#1a1a1a] border border-[#2a2a2a] rounded-xl p-4"
              >
                <div className="w-14 h-14 shrink-0 bg-[#252525] rounded-lg overflow-hidden flex items-center justify-center text-[#444] text-xl font-bold">
                  {result.cover_url
                    ? <img src={result.cover_url} alt={result.album_name} className="w-full h-full object-cover" />
                    : result.album_name[0]}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[#e8e8e8] text-sm font-medium truncate">{result.album_name}</p>
                  <p className="text-[#888] text-xs mt-0.5">{result.artist}{result.year ? ` · ${result.year}` : ''}</p>
                  <p className="text-[#555] text-xs mt-0.5">{result.total_tracks} tracks</p>
                </div>
                <div className="flex gap-2 shrink-0">
                  {state.add === 'done' ? (
                    <span className="flex items-center gap-1.5 text-xs text-[#4caf6e] px-3 py-1.5">
                      <Check size={13} /> Added
                    </span>
                  ) : (
                    <button
                      onClick={() => handleAdd(result)}
                      disabled={busy}
                      className="flex items-center gap-1.5 text-xs text-[#888] hover:text-[#e8e8e8] px-3 py-1.5 bg-[#252525] hover:bg-[#2f2f2f] rounded-lg transition-colors disabled:opacity-40"
                    >
                      {state.add === 'loading'
                        ? <Loader2 size={13} className="animate-spin" />
                        : <Plus size={13} />}
                      Add to List
                    </button>
                  )}
                  <button
                    onClick={() => handleRate(result)}
                    disabled={busy}
                    className="flex items-center gap-1.5 text-xs text-[#c8a84b] font-medium px-3 py-1.5 bg-[#c8a84b]/10 hover:bg-[#c8a84b]/20 rounded-lg transition-colors disabled:opacity-40"
                  >
                    {state.rate === 'loading'
                      ? <Loader2 size={13} className="animate-spin" />
                      : <Play size={13} />}
                    Rate
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
