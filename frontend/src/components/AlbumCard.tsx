import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Play, ChevronRight, Star, Trash2 } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import type { Album } from '../types'
import RecommendModal from './RecommendModal'
import { deleteAlbum } from '../api'

interface Props {
  album: Album
  showActions?: boolean
}

export default function AlbumCard({ album, showActions = true }: Props) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [showRecommend, setShowRecommend] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  async function handleDiscard(e: React.MouseEvent) {
    e.stopPropagation()
    if (!confirmDelete) { setConfirmDelete(true); return }
    await deleteAlbum(album.id)
    queryClient.invalidateQueries({ queryKey: ['albums'] })
  }

  return (
    <>
      <div
        className="bg-[#f5f5f5] rounded-xl overflow-hidden border border-[#e2e2e2] hover:border-[#c8c8c8] transition-colors cursor-pointer group"
        onClick={() => (album.status === 'rated' || album.status === 'to_listen') && navigate(`/album/${album.id}`)}
      >
        <div className="aspect-square bg-[#e8e8e8] relative">
          {album.albumArtUrl ? (
            <img src={album.albumArtUrl} alt={album.albumName} className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-[#aaa] text-4xl font-bold select-none">
              {album.albumName[0]}
            </div>
          )}

          {/* Recommended badge */}
          {album.recommendedBy !== null && (
            <div
              className="absolute top-2 left-2"
              title={album.recommendedByName ? `Recommended by ${album.recommendedByName}` : 'Recommended'}
            >
              <Star size={20} fill="#f97316" color="#f97316" />
            </div>
          )}

          {album.score !== null && (
            <div className="absolute top-2 right-2 bg-white/70 backdrop-blur-md text-[#2d6a4f] text-sm font-semibold px-2 py-0.5 rounded-md border border-white/40 shadow-sm">
              {album.score.toFixed(2)}
            </div>
          )}
          {album.score === null && album.predictedScore !== null && (
            <div className="absolute top-2 right-2 bg-white/70 backdrop-blur-md text-[#888] text-sm font-semibold px-2 py-0.5 rounded-md border border-white/40 shadow-sm" title="Predicted score">
              ~{album.predictedScore.toFixed(2)}
            </div>
          )}
          {album.status === 'listening' && (
            <div className="absolute bottom-2 left-2 right-2">
              <div className="bg-white/85 backdrop-blur-sm rounded-md px-2 py-1 border border-[#e2e2e2]">
                <div className="text-[#777] text-xs mb-1">
                  {album.songs.filter(s => s.score !== null).length} / {album.totalTracks} rated
                </div>
                <div className="h-1 bg-[#ddd] rounded-full">
                  <div
                    className="h-1 bg-[#2d6a4f] rounded-full transition-all"
                    style={{
                      width: `${(album.songs.filter(s => s.score !== null).length / (album.totalTracks ?? 1)) * 100}%`,
                    }}
                  />
                </div>
              </div>
            </div>
          )}
        </div>
        <div className="p-3">
          <p className="text-[#111] text-sm font-medium truncate">{album.albumName}</p>
          <p className="text-[#777] text-xs truncate mt-0.5">
            {[album.artist, ...album.extraArtists].join(', ')} · {album.year}
          </p>
          {album.genre && (
            <p className="text-[#aaa] text-xs mt-1 truncate">{album.genre}</p>
          )}
          {album.recommendedBy !== null && album.recommendedByName && (
            <p className="text-[#f97316] text-xs mt-1 truncate">★ rec. by {album.recommendedByName}</p>
          )}
          {showActions && (
            <div className="mt-3 flex gap-2">
              {album.status === 'to_listen' && (
                <button
                  onClick={(e) => { e.stopPropagation(); navigate(`/rate/${album.id}`) }}
                  className="flex-1 flex items-center justify-center gap-1.5 bg-[#2d6a4f]/10 hover:bg-[#2d6a4f]/20 text-[#2d6a4f] text-xs font-medium py-1.5 rounded-lg transition-colors"
                >
                  <Play size={12} /> Start Rating
                </button>
              )}
              {album.status === 'listening' && (
                <button
                  onClick={(e) => { e.stopPropagation(); navigate(`/rate/${album.id}`) }}
                  className="flex-1 flex items-center justify-center gap-1.5 bg-[#2d6a4f]/10 hover:bg-[#2d6a4f]/20 text-[#2d6a4f] text-xs font-medium py-1.5 rounded-lg transition-colors"
                >
                  <ChevronRight size={12} /> Continue
                </button>
              )}
              {album.status === 'listening' && (
                <button
                  onClick={handleDiscard}
                  onMouseLeave={() => setConfirmDelete(false)}
                  className={`flex items-center justify-center gap-1 text-xs font-medium py-1.5 px-2.5 rounded-lg transition-colors border ${
                    confirmDelete
                      ? 'bg-red-50 hover:bg-red-100 text-red-600 border-red-200'
                      : 'bg-[#f5f5f5] hover:bg-[#ebebeb] text-[#999] border-[#e2e2e2]'
                  }`}
                  title={confirmDelete ? 'Click to confirm delete' : 'Discard album'}
                >
                  <Trash2 size={12} />
                </button>
              )}
              {album.status === 'rated' && (
                <button
                  onClick={(e) => { e.stopPropagation(); navigate(`/album/${album.id}`) }}
                  className="flex-1 flex items-center justify-center gap-1.5 bg-[#e8e8e8] hover:bg-[#ddd] text-[#333] text-xs font-medium py-1.5 rounded-lg transition-colors"
                >
                  View
                </button>
              )}
              {album.status === 'rated' && (
                <button
                  onClick={(e) => { e.stopPropagation(); setShowRecommend(true) }}
                  className="flex items-center justify-center gap-1 bg-[#fff7ed] hover:bg-[#ffedd5] text-[#f97316] text-xs font-medium py-1.5 px-2.5 rounded-lg transition-colors border border-[#fed7aa]"
                  title="Recommend to a friend"
                >
                  <Star size={12} fill="#f97316" />
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {showRecommend && (
        <RecommendModal album={album} onClose={() => setShowRecommend(false)} />
      )}
    </>
  )
}
