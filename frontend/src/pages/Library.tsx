import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { X, Loader2, Search } from 'lucide-react'
import { fetchAlbums } from '../api'
import { useNavigate } from 'react-router-dom'
import AlbumCard from '../components/AlbumCard'
import { useUser } from '../context/UserContext'
import type { AlbumStatus } from '../types'

const TABS: { key: AlbumStatus; label: string }[] = [
  { key: 'rated', label: 'Rated' },
  { key: 'listening', label: 'Listening' },
  { key: 'to_listen', label: 'To Listen' },
]


export default function Library() {
  const { activeUser, viewingUser, isViewingFriend } = useUser()
  const userId = viewingUser.id
  const [activeTab, setActiveTab] = useState<AlbumStatus>('rated')
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
<div className="mb-6">
        <h1 className="font-display text-3xl font-bold text-[#111]">
          {isViewingFriend ? `${viewingUser.name}'s Library` : 'Library'}
        </h1>
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
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4 items-start">
          {visibleAlbums.map((album) => (
            <AlbumCard key={album.id} album={album} />
          ))}
        </div>
      )}
    </div>
  )
}
