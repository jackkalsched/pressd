import { useState } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Loader2, Pencil, Trash2, MessageCircle, Star } from 'lucide-react'
import { fetchAlbum, deleteAlbum, fetchFriendRatings, importAlbum } from '../api'
import { useUser } from '../context/UserContext'
import { BANG_THRESHOLD, SKIP_THRESHOLD, songScoreColor } from '../types'
import RecommendModal from '../components/RecommendModal'

function shareRatingViaIMessage(albumName: string, artist: string, score: number | null, viewingName?: string) {
  const who = viewingName ? `${viewingName} rated` : 'I rated'
  const scoreStr = score != null ? `${score}/10` : 'unscored'
  const msg = `${who} "${albumName}" by ${artist} — ${scoreStr} on Press'd 🎵`
  window.location.href = `sms:?body=${encodeURIComponent(msg)}`
}

const BASE = 'http://localhost:8000'

function lightenHsl(hsl: string, l: number): string {
  return hsl.replace(/,\s*\d+%\)$/, `, ${l}%)`)
}

function useAlbumColors(album: string | null, artist: string | null): { color: string | null; color2: string | null } {
  const { data } = useQuery({
    queryKey: ['album-color', album, artist],
    queryFn: async () => {
      const res = await fetch(
        `${BASE}/util/album-color?album=${encodeURIComponent(album!)}&artist=${encodeURIComponent(artist!)}`,
      )
      const json = await res.json() as { color: string | null; color2: string | null }
      return { color: json.color ?? null, color2: json.color2 ?? null }
    },
    enabled: !!album && !!artist,
    staleTime: Infinity,
  })
  return data ?? { color: null, color2: null }
}

export default function AlbumDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { isViewingFriend, viewingUser, activeUser } = useUser()
  const [showRecommend, setShowRecommend] = useState(false)
  const [ratingItYourself, setRatingItYourself] = useState(false)
  const [addingToLibrary, setAddingToLibrary] = useState(false)
  const [addedToLibrary, setAddedToLibrary] = useState(false)

  async function handleAddToLibrary() {
    if (!album) return
    setAddingToLibrary(true)
    try {
      await importAlbum(
        {
          spotify_id: album.spotifyId ?? null,
          album_name: album.albumName,
          artist: album.artist,
          year: album.year ?? null,
          cover_url: album.albumArtUrl ?? null,
          total_tracks: album.totalTracks ?? album.songs.length,
          tracks: album.songs.map(s => ({
            title: s.title,
            track_number: s.trackNumber ?? null,
            duration_ms: null,
            explicit: false,
            spotify_id: s.spotifyId ?? null,
            artist: album.artist,
          })),
          genre: album.genre ?? null,
        },
        'to_listen',
        activeUser.id,
      )
      setAddedToLibrary(true)
    } catch {
      /* silently fail */
    } finally {
      setAddingToLibrary(false)
    }
  }

  async function handleRateItYourself() {
    if (!album) return
    setRatingItYourself(true)
    try {
      const result = await importAlbum(
        {
          spotify_id: album.spotifyId ?? null,
          album_name: album.albumName,
          artist: album.artist,
          year: album.year ?? null,
          cover_url: album.albumArtUrl ?? null,
          total_tracks: album.totalTracks ?? album.songs.length,
          tracks: album.songs.map(s => ({
            title: s.title,
            track_number: s.trackNumber ?? null,
            duration_ms: null,
            explicit: false,
            spotify_id: s.spotifyId ?? null,
            artist: album.artist,
          })),
          genre: album.genre ?? null,
        },
        'listening',
        activeUser.id,
      )
      navigate(`/rate/${result.id}`)
    } catch {
      setRatingItYourself(false)
    }
  }

  const { data: album, isLoading, error } = useQuery({
    queryKey: ['album', Number(id)],
    queryFn: () => fetchAlbum(Number(id)),
  })

  const { color: accentColor, color2 } = useAlbumColors(album?.albumName ?? null, album?.artist ?? null)

  const { data: friendRatings = [] } = useQuery({
    queryKey: ['friend-ratings', album?.albumName, album?.artist, activeUser.id],
    queryFn: () => fetchFriendRatings(album!.albumName, album!.artist, activeUser.id),
    enabled: !!album && !isViewingFriend,
    staleTime: 60_000,
  })

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64 text-[#aaa] gap-2">
        <Loader2 size={16} className="animate-spin" /> Loading…
      </div>
    )
  }

  if (error || !album) return <div className="p-8 text-[#aaa]">Album not found.</div>

  const ratedSongs = album.songs.filter((s) => s.score !== null)
  const bangs = ratedSongs.filter((s) => s.score! >= BANG_THRESHOLD)
  const skips = ratedSongs.filter((s) => s.score! < SKIP_THRESHOLD)
  const avgScore = ratedSongs.length > 0
    ? ratedSongs.reduce((s, song) => s + song.score!, 0) / ratedSongs.length
    : null

  const sortedSongs = [...album.songs].sort((a, b) => (a.trackNumber ?? 0) - (b.trackNumber ?? 0))

  return (
    <div className="p-4 md:p-8 max-w-5xl">
      <div className="flex items-center justify-between mb-6">
        <button
          onClick={() => navigate(-1)}
          className="flex items-center gap-2 text-[#777] hover:text-[#111] text-sm transition-colors"
        >
          <ArrowLeft size={15} /> Back
        </button>
        <div className="flex items-center gap-2">
          {isViewingFriend && (
            <button
              onClick={handleAddToLibrary}
              disabled={addingToLibrary || addedToLibrary}
              className="flex items-center gap-1.5 text-sm font-medium bg-[#f5f5f5] border border-[#e2e2e2] hover:bg-[#ececec] text-[#555] px-3 py-1.5 rounded-lg transition-colors disabled:opacity-60"
            >
              {addingToLibrary ? <Loader2 size={13} className="animate-spin" /> : null}
              {addedToLibrary ? '✓ Added' : 'Add to Library'}
            </button>
          )}
          {isViewingFriend && (
            <button
              onClick={handleRateItYourself}
              disabled={ratingItYourself}
              className="flex items-center gap-1.5 text-sm font-medium bg-[#2d6a4f] hover:bg-[#245c43] text-white px-3 py-1.5 rounded-lg transition-colors disabled:opacity-60"
            >
              {ratingItYourself ? <Loader2 size={13} className="animate-spin" /> : <Pencil size={13} />}
              Rate it Yourself
            </button>
          )}
          {album.status === 'rated' && (
            <button
              onClick={() => shareRatingViaIMessage(album.albumName, album.artist, album.score, isViewingFriend ? viewingUser.name : undefined)}
              className="flex items-center gap-1.5 text-sm font-medium bg-[#f5f5f5] border border-[#e2e2e2] hover:bg-[#ececec] text-[#555] px-3 py-1.5 rounded-lg transition-colors"
            >
              <MessageCircle size={13} /> Share
            </button>
          )}
          {album.status === 'rated' && !isViewingFriend && (
            <button
              onClick={() => setShowRecommend(true)}
              className="flex items-center gap-1.5 text-sm font-medium bg-[#fff7ed] border border-[#fed7aa] hover:bg-[#ffedd5] text-[#f97316] px-3 py-1.5 rounded-lg transition-colors"
            >
              <Star size={13} fill="#f97316" /> Recommend
            </button>
          )}
          {!isViewingFriend && (
            <>
              <button
                onClick={() => navigate(`/rate/${album.id}`)}
                className="flex items-center gap-1.5 text-sm font-medium bg-[#f5f5f5] border border-[#e2e2e2] hover:border-[#c8c8c8] text-[#555] px-3 py-1.5 rounded-lg transition-colors"
              >
                <Pencil size={13} /> Edit Rating
              </button>
              <button
                onClick={async () => {
                  if (!confirm(`Delete "${album.albumName}" by ${album.artist}? This cannot be undone.`)) return
                  try {
                    await deleteAlbum(album.id)
                    await queryClient.invalidateQueries({ queryKey: ['albums'] })
                    queryClient.removeQueries({ queryKey: ['album', album.id] })
                    navigate('/library')
                  } catch (e) {
                    alert('Failed to delete album. Please try again.')
                  }
                }}
                className="flex items-center gap-1.5 text-sm font-medium bg-[#f5f5f5] border border-[#e2e2e2] hover:border-red-300 hover:text-red-500 text-[#555] px-3 py-1.5 rounded-lg transition-colors"
              >
                <Trash2 size={13} /> Delete
              </button>
            </>
          )}
        </div>
      </div>

      {/* Header */}
      <div className="flex items-start gap-6 mb-8">
        <div className="w-28 h-28 shrink-0 bg-[#e8e8e8] rounded-xl flex items-center justify-center text-[#aaa] text-5xl font-bold overflow-hidden">
          {album.albumArtUrl
            ? <img src={album.albumArtUrl} alt={album.albumName} className="w-full h-full object-cover" />
            : album.albumName[0]}
        </div>
        <div className="flex-1">
          <h1 className="text-2xl font-semibold" style={{ color: accentColor ?? '#111' }}>{album.albumName}</h1>
          <p className="text-[#777] mt-1">
            {[album.artist, ...album.extraArtists].map((name, i, arr) => (
              <span key={name}>
                <Link
                  to={`/artist/${encodeURIComponent(name)}`}
                  className="transition-colors"
                  style={{ color: 'inherit' }}
                  onMouseEnter={e => { if (color2) (e.currentTarget as HTMLElement).style.color = color2 }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = 'inherit' }}
                >
                  {name}
                </Link>
                {i < arr.length - 1 ? ', ' : ''}
              </span>
            ))}
            {' '}· {album.year}
          </p>
          {album.genre && (
            <p className="text-[#aaa] text-sm mt-1">
              {album.genre}{album.subGenre1 ? ` · ${album.subGenre1}` : ''}
            </p>
          )}
          {album.score !== null && (
            <div className="mt-3 inline-flex items-baseline gap-2">
              <span className="text-4xl font-bold tabular-nums" style={{ color: accentColor ?? '#2d6a4f' }}>{album.score?.toFixed(2)}</span>
              <span className="text-[#aaa] text-sm">/ 10</span>
            </div>
          )}
          {album.score === null && album.predictedScore !== null && (
            <div className="mt-3 inline-flex items-baseline gap-2">
              <span className="text-3xl font-bold tabular-nums text-[#aaa]">~{album.predictedScore.toFixed(2)}</span>
              <span className="text-[#bbb] text-xs">predicted</span>
            </div>
          )}
        </div>
        {avgScore !== null && ratedSongs.length > 0 && (
          <div className="flex flex-col items-end justify-start gap-1 text-sm shrink-0">
            <span className="text-[#777]">Avg <span className="font-semibold text-[#111]">{avgScore.toFixed(2)}</span></span>
            <span className="text-[#777]">Bang% <span className="font-semibold" style={{ color: accentColor ?? '#1a7a3c' }}>{Math.round(bangs.length / ratedSongs.length * 100)}%</span></span>
            <span className="text-[#777]">Skip% <span className="font-semibold text-[#c0392b]">{Math.round(skips.length / ratedSongs.length * 100)}%</span></span>
          </div>
        )}
      </div>

      {/* Factor breakdown — omitted for EPs (≤6 tracks) */}
      {album.songs.length > 6 && <div className="grid grid-cols-4 gap-3 mb-8">
        {[
          { label: 'Theme / Cohesion', value: album.theme },
          { label: 'Replay Value', value: album.replayValue },
          { label: 'Production', value: album.production },
          { label: 'Distinctness', value: album.distinctness },
        ].map(({ label, value }) => (
          <div
            key={label}
            className="p-5 text-center"
          >
            <p
              className="text-sm font-medium mb-1"
              style={{ color: color2 ? lightenHsl(color2, 48) : '#999' }}
            >
              {label}
            </p>
            <p
              className="font-bold text-4xl tabular-nums"
              style={{ color: accentColor ?? '#111' }}
            >
              {value ?? '—'}
            </p>
          </div>
        ))}
      </div>}

      {/* Track list */}
      <div className="flex flex-col gap-1">
        {sortedSongs.map((song) => (
          <div
            key={song.id}
            className="flex items-center gap-4 px-1 py-2"
          >
            <span className="text-[#aaa] text-xs w-5 text-right shrink-0">{song.trackNumber}</span>
            <span className="flex-1 text-base text-[#111] truncate">{song.title}</span>
            {song.score !== null && song.score >= BANG_THRESHOLD && (
              <span className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: songScoreColor(song.score) }}>bang</span>
            )}
            {song.score !== null && song.score < SKIP_THRESHOLD && (
              <span className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: songScoreColor(song.score) }}>skip</span>
            )}
            <span
              className="text-lg font-semibold tabular-nums w-12 text-right"
              style={{ color: song.score !== null ? songScoreColor(song.score) : '#ccc' }}
            >
              {song.score ?? '—'}
            </span>
          </div>
        ))}
      </div>

      {/* Friends' ratings */}
      {!isViewingFriend && friendRatings.length > 0 && (
        <div className="mt-10">
          <h2 className="text-xs font-semibold text-[#999] uppercase tracking-widest mb-4">Friends' Ratings</h2>
          <div className="flex flex-col gap-6">
            {friendRatings.map(({ friend, album: fa }) => {
              const friendSorted = [...fa.songs].sort((a, b) => (a.trackNumber ?? 0) - (b.trackNumber ?? 0))
              const friendRated = fa.songs.filter(s => s.score !== null)
              const friendAvg = friendRated.length > 0
                ? friendRated.reduce((s, s2) => s + s2.score!, 0) / friendRated.length
                : null
              const friendBangs = friendRated.filter(s => s.score! >= BANG_THRESHOLD)
              const friendSkips = friendRated.filter(s => s.score! < SKIP_THRESHOLD)
              return (
                <div key={friend.id} className="border border-[#e8e8e8] rounded-xl p-5">
                  {/* Friend header */}
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2">
                      <div
                        className="w-6 h-6 rounded-full flex items-center justify-center text-white text-xs font-semibold shrink-0"
                        style={{ backgroundColor: '#2d6a4f' }}
                      >
                        {friend.name[0].toUpperCase()}
                      </div>
                      <span className="text-sm font-semibold text-[#111]">{friend.name}</span>
                    </div>
                    <div className="flex items-center gap-4 text-sm text-[#777]">
                      {friendAvg !== null && <span>Avg <span className="font-semibold text-[#111]">{friendAvg.toFixed(2)}</span></span>}
                      {friendRated.length > 0 && <span>Bang% <span className="font-semibold text-[#2d6a4f]">{Math.round(friendBangs.length / friendRated.length * 100)}%</span></span>}
                      {friendRated.length > 0 && <span>Skip% <span className="font-semibold text-[#c0392b]">{Math.round(friendSkips.length / friendRated.length * 100)}%</span></span>}
                      {fa.score !== null && (
                        <span className="text-2xl font-bold tabular-nums text-[#2d6a4f]">{fa.score.toFixed(2)}</span>
                      )}
                    </div>
                  </div>

                  {/* Friend's factor ratings (LP only) */}
                  {fa.songs.length > 6 && (fa.theme ?? fa.replayValue ?? fa.production ?? fa.distinctness) && (
                    <div className="grid grid-cols-4 gap-2 mb-4">
                      {[
                        { label: 'Theme', value: fa.theme },
                        { label: 'Replay', value: fa.replayValue },
                        { label: 'Production', value: fa.production },
                        { label: 'Distinct', value: fa.distinctness },
                      ].map(({ label, value }) => (
                        <div key={label} className="bg-[#f8f8f8] rounded-lg p-3 text-center">
                          <p className="text-[10px] text-[#aaa] uppercase tracking-wide mb-1">{label}</p>
                          <p className="text-lg font-bold text-[#111] tabular-nums">{value ?? '—'}</p>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Friend's song scores */}
                  <div className="flex flex-col gap-0.5">
                    {friendSorted.map((song) => (
                      <div key={song.id} className="flex items-center gap-3 px-1 py-1.5">
                        <span className="text-[#bbb] text-xs w-5 text-right shrink-0">{song.trackNumber}</span>
                        <span className="flex-1 text-sm text-[#555] truncate">{song.title}</span>
                        {song.score !== null && song.score >= BANG_THRESHOLD && (
                          <span className="text-[9px] font-semibold uppercase tracking-wide" style={{ color: songScoreColor(song.score) }}>bang</span>
                        )}
                        {song.score !== null && song.score < SKIP_THRESHOLD && (
                          <span className="text-[9px] font-semibold uppercase tracking-wide" style={{ color: songScoreColor(song.score) }}>skip</span>
                        )}
                        <span
                          className="text-sm font-semibold tabular-nums w-10 text-right"
                          style={{ color: song.score !== null ? songScoreColor(song.score) : '#ddd' }}
                        >
                          {song.score ?? '—'}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {showRecommend && album && (
        <RecommendModal album={album} onClose={() => setShowRecommend(false)} />
      )}
    </div>
  )
}
