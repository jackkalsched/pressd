import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, X, Loader2, Search } from 'lucide-react'
import { fetchAlbums, searchSpotify, searchMusicBrainz, searchItunes, importAlbum, createAlbum } from '../api'
import AlbumCard from '../components/AlbumCard'
import { useUser } from '../context/UserContext'
import type { AlbumStatus } from '../types'

const TABS: { key: AlbumStatus; label: string }[] = [
  { key: 'rated', label: 'Rated' },
  { key: 'listening', label: 'Listening' },
  { key: 'to_listen', label: 'To Listen' },
]

type SearchSource = 'spotify' | 'itunes' | 'musicbrainz' | 'manual'

const SOURCE_LABELS: Record<SearchSource, string> = {
  spotify: 'Spotify',
  itunes: 'iTunes',
  musicbrainz: 'MusicBrainz',
  manual: 'Manual',
}

function AddAlbumModal({ onClose, userId }: { onClose: () => void; userId: number }) {
  const [albumName, setAlbumName] = useState('')
  const [artist, setArtist] = useState('')
  const [source, setSource] = useState<SearchSource>('itunes')
  const [status, setStatus] = useState<'listening' | 'to_listen'>('listening')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!albumName.trim() || !artist.trim()) return
    setLoading(true)
    setError(null)
    try {
      if (source === 'manual') {
        await createAlbum({ albumName: albumName.trim(), artist: artist.trim(), status, userId })
        queryClient.invalidateQueries({ queryKey: ['albums'] })
        onClose()
        return
      }
      const q = source === 'spotify'
        ? `album:${albumName.trim()} artist:${artist.trim()}`
        : `${albumName.trim()} ${artist.trim()}`
      const search = source === 'spotify' ? searchSpotify
        : source === 'itunes' ? searchItunes
        : searchMusicBrainz
      const results = await search(q)
      if (!results.length) {
        setError(`Album not found on ${SOURCE_LABELS[source]}.`)
        setLoading(false)
        return
      }
      const album = await importAlbum(results[0], status, userId)
      queryClient.invalidateQueries({ queryKey: ['albums'] })
      if (status === 'listening') {
        navigate(`/rate/${album.id}`)
      } else {
        onClose()
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.')
      setLoading(false)
    }
  }

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

        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <input
            type="text"
            placeholder="Album name"
            value={albumName}
            onChange={(e) => setAlbumName(e.target.value)}
            autoFocus
            className="bg-[#f5f5f5] border border-[#e2e2e2] text-[#111] text-sm px-4 py-2.5 rounded-lg focus:outline-none focus:border-[#2d6a4f] transition-colors placeholder:text-[#bbb]"
          />
          <input
            type="text"
            placeholder="Artist"
            value={artist}
            onChange={(e) => setArtist(e.target.value)}
            className="bg-[#f5f5f5] border border-[#e2e2e2] text-[#111] text-sm px-4 py-2.5 rounded-lg focus:outline-none focus:border-[#2d6a4f] transition-colors placeholder:text-[#bbb]"
          />

          {/* Source selector */}
          <div className="flex gap-1.5">
            {(['itunes', 'spotify', 'musicbrainz', 'manual'] as SearchSource[]).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => { setSource(s); if (s === 'manual') setStatus('to_listen') }}
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
          {source === 'manual' && (
            <p className="text-[#aaa] text-[11px] -mt-1">
              Adds the album without track data — useful for unreleased albums.
            </p>
          )}

          <div className="flex gap-2">
            {(['listening', 'to_listen'] as const).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setStatus(s)}
                disabled={source === 'manual' && s === 'listening'}
                className={`flex-1 py-2 rounded-lg text-xs font-medium transition-colors ${
                  status === s
                    ? 'bg-[#2d6a4f]/10 border border-[#2d6a4f]/40 text-[#2d6a4f]'
                    : 'bg-[#f5f5f5] border border-[#e2e2e2] text-[#aaa] hover:text-[#555]'
                } disabled:opacity-30 disabled:cursor-not-allowed`}
              >
                {s === 'listening' ? 'Rate Now' : 'Add to List'}
              </button>
            ))}
          </div>

          {error && <p className="text-[#c0392b] text-xs mt-1">{error}</p>}

          <button
            type="submit"
            disabled={loading || !albumName.trim() || !artist.trim()}
            className="mt-1 w-full py-2.5 rounded-xl text-sm font-semibold bg-[#2d6a4f] hover:bg-[#245c43] text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {loading ? <><Loader2 size={14} className="animate-spin" /> Looking up…</> : 'Confirm'}
          </button>
        </form>
      </div>
    </div>
  )
}

export default function Library() {
  const { activeUser, viewingUser, isViewingFriend } = useUser()
  const userId = viewingUser.id
  const [activeTab, setActiveTab] = useState<AlbumStatus>('rated')
  const [showModal, setShowModal] = useState(false)
  const [toListenSearch, setToListenSearch] = useState('')

  const { data: albums = [], isLoading } = useQuery({
    queryKey: ['albums', activeTab, userId],
    queryFn: () => fetchAlbums({ status: activeTab, userId }),
  })

  const { data: rated = [] } = useQuery({ queryKey: ['albums', 'rated', userId], queryFn: () => fetchAlbums({ status: 'rated', userId }) })
  const { data: listening = [] } = useQuery({ queryKey: ['albums', 'listening', userId], queryFn: () => fetchAlbums({ status: 'listening', userId }) })
  const { data: toListen = [] } = useQuery({ queryKey: ['albums', 'to_listen', userId], queryFn: () => fetchAlbums({ status: 'to_listen', userId }) })

  const counts = { rated: rated.length, listening: listening.length, to_listen: toListen.length }

  const [toListenSort, setToListenSort] = useState<'predicted' | 'artist' | 'added'>('predicted')

  const q = toListenSearch.trim().toLowerCase()
  const filteredAlbums = activeTab === 'to_listen' && q
    ? albums.filter(a =>
        a.albumName.toLowerCase().includes(q) ||
        a.artist.toLowerCase().includes(q)
      )
    : albums

  const visibleAlbums = activeTab === 'to_listen'
    ? [...filteredAlbums].sort((a, b) => {
        if (toListenSort === 'predicted') {
          return (b.predictedScore ?? 0) - (a.predictedScore ?? 0)
        }
        if (toListenSort === 'artist') return a.artist.localeCompare(b.artist)
        return 0 // added: keep original order
      })
    : filteredAlbums

  return (
    <div className="p-4 md:p-8">
      {showModal && <AddAlbumModal onClose={() => setShowModal(false)} userId={activeUser.id} />}

      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold text-[#111]">
          {isViewingFriend ? `${viewingUser.name}'s Library` : 'Library'}
        </h1>
        {!isViewingFriend && (
          <button
            onClick={() => setShowModal(true)}
            className="flex items-center gap-1.5 text-sm font-medium bg-[#2d6a4f] hover:bg-[#245c43] text-white px-4 py-2 rounded-lg transition-colors"
          >
            <Plus size={15} /> Add Album
          </button>
        )}
      </div>

      <div className="flex gap-1 mb-8 border-b border-[#e2e2e2]">
        {TABS.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setActiveTab(key)}
            className={`px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px ${
              activeTab === key
                ? 'border-[#2d6a4f] text-[#2d6a4f]'
                : 'border-transparent text-[#777] hover:text-[#111]'
            }`}
          >
            {label}
            <span className="ml-2 text-xs bg-[#efefef] text-[#777] px-1.5 py-0.5 rounded-full">
              {counts[key]}
            </span>
          </button>
        ))}
      </div>

      {activeTab === 'to_listen' && (
        <div className="flex items-center gap-3 mb-6">
          <div className="relative max-w-sm flex-1">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#bbb] pointer-events-none" />
            <input
              type="text"
              placeholder="Search by album or artist…"
              value={toListenSearch}
              onChange={e => setToListenSearch(e.target.value)}
              className="w-full pl-8 pr-4 py-2 text-sm bg-[#f5f5f5] border border-[#e2e2e2] rounded-lg text-[#111] placeholder:text-[#bbb] focus:outline-none focus:border-[#2d6a4f] transition-colors"
            />
            {toListenSearch && (
              <button
                onClick={() => setToListenSearch('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-[#bbb] hover:text-[#555]"
              >
                <X size={13} />
              </button>
            )}
          </div>
          <select
            value={toListenSort}
            onChange={e => setToListenSort(e.target.value as typeof toListenSort)}
            className="text-xs border border-[#e2e2e2] rounded-lg px-2.5 py-2 bg-white text-[#555] focus:outline-none focus:border-[#2d6a4f] shrink-0"
          >
            <option value="predicted">Sort: Predicted Score</option>
            <option value="artist">Sort: Artist</option>
            <option value="added">Sort: Date Added</option>
          </select>
        </div>
      )}

      {isLoading ? (
        <div className="flex items-center justify-center py-24 text-[#aaa] gap-2">
          <Loader2 size={16} className="animate-spin" /> Loading…
        </div>
      ) : visibleAlbums.length === 0 ? (
        <div className="text-center py-24 text-[#aaa]">
          <p className="text-lg">{q ? 'No matches found.' : 'Nothing here yet.'}</p>
          {!q && activeTab === 'to_listen' && <p className="text-sm mt-2">Click "Add Album" to queue something up.</p>}
          {!q && activeTab === 'listening' && <p className="text-sm mt-2">Click "Add Album" and choose Rate Now.</p>}
          {!q && activeTab === 'rated' && <p className="text-sm mt-2">Finish rating an album to see it here.</p>}
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
          {visibleAlbums.map((album) => (
            <AlbumCard key={album.id} album={album} />
          ))}
        </div>
      )}
    </div>
  )
}
