import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { Play, ChevronRight, Star, Trash2, Music } from 'lucide-react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { Album } from '../types'
import RecommendModal from './RecommendModal'
import { deleteAlbum, fetchScoreRange } from '../api'
import { useUser } from '../context/UserContext'

interface Props {
  album: Album
  showActions?: boolean
}

function scoreBadgeColor(score: number, mu: number, sd: number): string {
  // Above average → amber (30°) to dark green (138°)
  // Below average → amber (30°) to dark red (0°)
  // Saturates at ±2.5 SD from mean
  const SD_RANGE = 2.5
  if (score >= mu) {
    const t = Math.min(1, (score - mu) / (SD_RANGE * sd))
    return `hsl(${Math.round(30 + t * 108)}, 70%, 30%)`
  } else {
    const t = Math.min(1, (mu - score) / (SD_RANGE * sd))
    return `hsl(${Math.round(30 - t * 30)}, 72%, 30%)`
  }
}

export default function AlbumCard({ album, showActions = true }: Props) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { isViewingFriend } = useUser()
  const { data: scoreRange } = useQuery({
    queryKey: ['score-range', 1],
    queryFn: () => fetchScoreRange(1),
    staleTime: 5 * 60 * 1000,
  })
  const [showRecommend, setShowRecommend] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [visible, setVisible] = useState(false)
  const [imgLoaded, setImgLoaded] = useState(false)
  const cardRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = cardRef.current
    if (!el) return
    const obs = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) { setVisible(true); obs.disconnect() } },
      { threshold: 0.1 },
    )
    obs.observe(el)
    return () => obs.disconnect()
  }, [])

  async function handleDiscard(e: React.MouseEvent) {
    e.stopPropagation()
    if (!confirmDelete) { setConfirmDelete(true); return }
    await deleteAlbum(album.id)
    queryClient.invalidateQueries({ queryKey: ['albums'] })
  }

  const artists = [album.artist, ...album.extraArtists].join(', ')
  const ratedSongs = album.songs.filter(s => s.score !== null).length

  return (
    <>
      <div
        ref={cardRef}
        className={`
          group relative flex flex-col bg-[#faf8f5] rounded-2xl overflow-hidden
          border border-[#e8e2d9] cursor-pointer
          transition-[transform,box-shadow] duration-[180ms] ease-out will-change-transform
          hover:-translate-y-[5px] hover:scale-[1.02]
          hover:shadow-[0_14px_36px_-4px_rgba(50,30,10,0.14),0_4px_10px_-2px_rgba(50,30,10,0.08)]
          motion-reduce:transition-none motion-reduce:hover:transform-none motion-reduce:hover:shadow-none
          ${visible ? 'card-pop' : 'opacity-0'}
        `}
        onClick={() => (album.status === 'rated' || album.status === 'to_listen') && navigate(`/album/${album.id}`)}
      >
        {/* ── Cover ─────────────────────────────────────────────────── */}
        <div className="aspect-square relative overflow-hidden bg-[#ece6dc] shrink-0">

          {/* Skeleton shimmer while image loads */}
          {!imgLoaded && album.albumArtUrl && (
            <div className="absolute inset-0 skeleton-shimmer" />
          )}

          {album.albumArtUrl ? (
            <img
              src={album.albumArtUrl}
              alt={album.albumName}
              className={`w-full h-full object-cover transition-opacity duration-300 ${imgLoaded ? 'opacity-100' : 'opacity-0'}`}
              onLoad={() => setImgLoaded(true)}
            />
          ) : (
            <div className="w-full h-full flex flex-col items-center justify-center gap-3 bg-gradient-to-br from-[#e8dfd2] to-[#cfc3b0]">
              <Music size={34} className="text-[#b0a090]" strokeWidth={1.25} />
              <span className="text-[#b0a090] text-[10px] font-semibold tracking-[0.2em] uppercase select-none">
                {album.albumName.slice(0, 3)}
              </span>
            </div>
          )}

          {/* Bottom vignette — adds depth & helps badge legibility */}
          <div className="absolute inset-0 bg-gradient-to-t from-black/25 via-transparent to-transparent pointer-events-none" />

          {/* Recommended star */}
          {album.recommendedBy !== null && (
            <div
              className="absolute top-2.5 left-2.5 bg-white/80 backdrop-blur-sm rounded-full p-1 shadow-sm"
              title={album.recommendedByName ? `Recommended by ${album.recommendedByName}` : 'Recommended'}
            >
              <Star size={12} fill="#f97316" color="#f97316" />
            </div>
          )}

          {/* Score badge */}
          {album.score !== null && (
            <div
              className="absolute top-2.5 right-2.5 text-[13px] font-bold px-3 py-1 rounded-full shadow-md tracking-tight select-none bg-white"
              style={{
                color: scoreRange
                  ? scoreBadgeColor(album.score, scoreRange.mu, scoreRange.sd)
                  : scoreBadgeColor(album.score, 7.0, 1.0),
                border: `1.5px solid ${scoreRange
                  ? scoreBadgeColor(album.score, scoreRange.mu, scoreRange.sd)
                  : scoreBadgeColor(album.score, 7.0, 1.0)}`,
              }}
            >
              {album.score.toFixed(2)}
            </div>
          )}

          {/* Predicted score badge */}
          {album.score === null && album.predictedScore !== null && (
            <div
              className="absolute top-2.5 right-2.5 bg-black/50 backdrop-blur-md text-white/80 text-[13px] font-bold px-3 py-1 rounded-full shadow-lg tracking-tight select-none"
              title="Predicted score"
            >
              ~{album.predictedScore.toFixed(2)}
            </div>
          )}

          {/* In-progress bar */}
          {album.status === 'listening' && (
            <div className="absolute bottom-0 left-0 right-0 px-2.5 pb-2.5">
              <div className="bg-black/35 backdrop-blur-sm rounded-xl px-2.5 py-2">
                <div className="flex justify-between items-center mb-1.5">
                  <span className="text-white/65 text-[10px] font-medium tracking-wide uppercase">In progress</span>
                  <span className="text-white/65 text-[10px] tabular-nums">{ratedSongs}/{album.totalTracks}</span>
                </div>
                <div className="h-[3px] bg-white/15 rounded-full">
                  <div
                    className="h-[3px] bg-[#6ee7b7] rounded-full transition-all duration-500"
                    style={{ width: `${(ratedSongs / (album.totalTracks ?? 1)) * 100}%` }}
                  />
                </div>
              </div>
            </div>
          )}
        </div>

        {/* ── Metadata ──────────────────────────────────────────────── */}
        <div className={`px-3 pt-2.5 ${showActions ? 'pb-1.5' : 'pb-3'}`}>
          <p className="text-[#1c1917] text-[13px] font-semibold leading-snug line-clamp-2">
            {album.albumName}
          </p>
          <p className="text-[#78716c] text-[11px] mt-0.5 truncate">
            {artists} · {album.year}
          </p>
          {album.genre && (
            <p className="text-[#a8a29e] text-[10px] mt-0.5 truncate uppercase tracking-[0.08em]">
              {album.genre}
            </p>
          )}
          {album.recommendedBy !== null && album.recommendedByName && (
            <p className="text-[#ea7a2a] text-[10px] mt-1 truncate font-medium">
              ★ rec. by {album.recommendedByName}
            </p>
          )}
        </div>

        {/* ── Action row — hidden at rest, slides in on hover ───────── */}
        {showActions && !(isViewingFriend && (album.status === 'to_listen' || album.status === 'listening')) && (
          <div
            className="
              card-action-row
              overflow-hidden max-h-0
              group-hover:max-h-[52px]
              transition-[max-height] duration-150 ease-out
              px-3 pb-3 pt-1 flex gap-1.5
            "
          >
            {album.status === 'to_listen' && !isViewingFriend && (
              <button
                onClick={(e) => { e.stopPropagation(); navigate(`/rate/${album.id}`) }}
                className="flex-1 flex items-center justify-center gap-1.5 bg-[#2d6a4f] hover:bg-[#245c43] active:bg-[#1e5238] text-white text-[11px] font-semibold py-2 rounded-lg transition-colors min-h-[36px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#2d6a4f]"
              >
                <Play size={10} fill="currentColor" strokeWidth={0} /> Start Rating
              </button>
            )}

            {album.status === 'listening' && (
              <>
                {!isViewingFriend && (
                  <button
                    onClick={(e) => { e.stopPropagation(); navigate(`/rate/${album.id}`) }}
                    className="flex-1 flex items-center justify-center gap-1.5 bg-[#2d6a4f] hover:bg-[#245c43] active:bg-[#1e5238] text-white text-[11px] font-semibold py-2 rounded-lg transition-colors min-h-[36px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#2d6a4f]"
                  >
                    <ChevronRight size={12} /> Continue
                  </button>
                )}
                {!isViewingFriend && (
                  <button
                    onClick={handleDiscard}
                    onBlur={() => setConfirmDelete(false)}
                    className={`flex items-center justify-center px-3 text-[11px] font-medium rounded-lg transition-colors border min-h-[36px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 ${
                      confirmDelete
                        ? 'bg-red-50 hover:bg-red-100 text-red-600 border-red-200 focus-visible:outline-red-400'
                        : 'bg-[#f0ebe3] hover:bg-[#e5ddd2] text-[#a8998a] border-[#ddd5c8] focus-visible:outline-[#a8998a]'
                    }`}
                    title={confirmDelete ? 'Click to confirm' : 'Discard'}
                  >
                    <Trash2 size={12} />
                  </button>
                )}
              </>
            )}

            {album.status === 'rated' && (
              <>
                <button
                  onClick={(e) => { e.stopPropagation(); navigate(`/album/${album.id}`) }}
                  className="flex-1 flex items-center justify-center bg-[#f0ebe3] hover:bg-[#e5ddd2] active:bg-[#d9d0c4] text-[#57534e] text-[11px] font-semibold py-2 rounded-lg transition-colors min-h-[36px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#78716c]"
                >
                  View
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); setShowRecommend(true) }}
                  className="w-9 flex items-center justify-center bg-[#fff7ed] hover:bg-[#ffedd5] active:bg-[#fed7aa] text-[#f97316] rounded-lg transition-colors border border-[#fcd9a8] min-h-[36px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#f97316]"
                  title="Recommend to a friend"
                >
                  <Star size={13} fill="#f97316" strokeWidth={0} />
                </button>
              </>
            )}
          </div>
        )}
      </div>

      {showRecommend && (
        <RecommendModal album={album} onClose={() => setShowRecommend(false)} />
      )}
    </>
  )
}
