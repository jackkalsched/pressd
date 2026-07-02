import { useState } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Loader2, Pencil, Trash2, MessageCircle, Star, Music } from 'lucide-react'
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

function accentToPageGradient(hsl: string | null): string {
  if (!hsl) return '#faf8f5'
  const h = hsl.match(/hsl\((\d+)/)?.[1]
  if (!h) return '#faf8f5'
  return `linear-gradient(to bottom, hsl(${h}, 38%, 95%) 0%, #faf8f5 38%)`
}
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
    } catch { /* silently fail */ } finally {
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
    } catch { setRatingItYourself(false) }
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
      <div className="min-h-screen bg-[#faf8f5] flex items-center justify-center">
        <div className="flex items-center gap-2 text-[#a8998a]">
          <Loader2 size={16} className="animate-spin" />
          <span className="text-sm">Loading…</span>
        </div>
      </div>
    )
  }

  if (error || !album) {
    return (
      <div className="min-h-screen bg-[#faf8f5] flex items-center justify-center">
        <p className="text-[#a8998a] text-sm">Album not found.</p>
      </div>
    )
  }

  const ratedSongs = album.songs.filter((s) => s.score !== null)
  const bangs = ratedSongs.filter((s) => s.score! >= BANG_THRESHOLD)
  const skips = ratedSongs.filter((s) => s.score! < SKIP_THRESHOLD)
  const avgScore = ratedSongs.length > 0
    ? ratedSongs.reduce((s, song) => s + song.score!, 0) / ratedSongs.length
    : null
  const sortedSongs = [...album.songs].sort((a, b) => (a.trackNumber ?? 0) - (b.trackNumber ?? 0))
  const artists = [album.artist, ...album.extraArtists]
  const isLP = album.songs.length > 6

  // Warm neutral button class shared across the nav
  const btnBase = 'flex items-center gap-1.5 text-[13px] font-medium px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50'
  const btnNeutral = `${btnBase} bg-[#f0ebe3] border border-[#e8e2d9] hover:bg-[#e8e0d4] text-[#57534e]`
  const btnGreen = `${btnBase} bg-[#2d6a4f] hover:bg-[#245c43] text-white border border-transparent`
  const btnOrange = `${btnBase} bg-[#fff7ed] border border-[#fcd9a8] hover:bg-[#ffedd5] text-[#ea7a2a]`
  const btnDanger = `${btnBase} bg-[#f0ebe3] border border-[#e8e2d9] hover:border-red-300 hover:text-red-500 text-[#57534e]`

  return (
    <div className="min-h-screen" style={{ background: accentToPageGradient(accentColor) }}>
      <div className="p-4 md:p-8 max-w-5xl mx-auto">

        {/* ── Nav ──────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between mb-8">
          <button
            onClick={() => navigate(-1)}
            className="flex items-center gap-1.5 text-[#78716c] hover:text-[#1c1917] text-sm transition-colors"
          >
            <ArrowLeft size={15} /> Back
          </button>

          <div className="flex items-center gap-2 flex-wrap justify-end">
            {isViewingFriend && (
              <button onClick={handleAddToLibrary} disabled={addingToLibrary || addedToLibrary} className={btnNeutral}>
                {addingToLibrary && <Loader2 size={12} className="animate-spin" />}
                {addedToLibrary ? '✓ Added' : 'Add to Library'}
              </button>
            )}
            {isViewingFriend && (
              <button onClick={handleRateItYourself} disabled={ratingItYourself} className={btnGreen}>
                {ratingItYourself ? <Loader2 size={12} className="animate-spin" /> : <Pencil size={12} />}
                Rate it Yourself
              </button>
            )}
            {album.status === 'rated' && (
              <button
                onClick={() => shareRatingViaIMessage(album.albumName, album.artist, album.score, isViewingFriend ? viewingUser.name : undefined)}
                className={btnNeutral}
              >
                <MessageCircle size={12} /> Share
              </button>
            )}
            {album.status === 'rated' && !isViewingFriend && (
              <button onClick={() => setShowRecommend(true)} className={btnOrange}>
                <Star size={12} fill="#ea7a2a" strokeWidth={0} /> Recommend
              </button>
            )}
            {!isViewingFriend && (
              <>
                <button onClick={() => navigate(`/rate/${album.id}`)} className={btnNeutral}>
                  <Pencil size={12} /> Edit Rating
                </button>
                <button
                  onClick={async () => {
                    if (!confirm(`Delete "${album.albumName}" by ${album.artist}? This cannot be undone.`)) return
                    try {
                      await deleteAlbum(album.id)
                      await queryClient.invalidateQueries({ queryKey: ['albums'] })
                      queryClient.removeQueries({ queryKey: ['album', album.id] })
                      navigate('/library')
                    } catch {
                      alert('Failed to delete album. Please try again.')
                    }
                  }}
                  className={btnDanger}
                >
                  <Trash2 size={12} /> Delete
                </button>
              </>
            )}
          </div>
        </div>

        {/* ── Hero ─────────────────────────────────────────────────── */}
        <div className="flex gap-7 md:gap-10 mb-10 items-start">

          {/* Cover */}
          <div className="w-36 h-36 md:w-44 md:h-44 shrink-0 rounded-2xl overflow-hidden shadow-[0_10px_30px_rgba(50,30,10,0.15)] bg-[#ece6dc]">
            {album.albumArtUrl ? (
              <img src={album.albumArtUrl} alt={album.albumName} className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex flex-col items-center justify-center gap-3 bg-gradient-to-br from-[#e8dfd2] to-[#cfc3b0]">
                <Music size={32} className="text-[#b0a090]" strokeWidth={1.25} />
                <span className="text-[#b0a090] text-[10px] font-semibold tracking-[0.2em] uppercase select-none">
                  {album.albumName.slice(0, 3)}
                </span>
              </div>
            )}
          </div>

          {/* Meta + score */}
          <div className="flex-1 min-w-0 flex flex-col justify-start pt-1">
            <h1
              className="text-2xl md:text-3xl font-bold leading-tight"
              style={{ color: accentColor ?? '#1c1917' }}
            >
              {album.albumName}
            </h1>

            <p className="text-[#78716c] text-sm mt-1.5">
              {artists.map((name, i, arr) => (
                <span key={name}>
                  <Link
                    to={`/artist/${encodeURIComponent(name)}`}
                    className="hover:underline underline-offset-2 transition-colors"
                    style={{ color: 'inherit' }}
                    onMouseEnter={e => { if (color2) (e.currentTarget as HTMLElement).style.color = color2 }}
                    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = 'inherit' }}
                  >
                    {name}
                  </Link>
                  {i < arr.length - 1 ? ', ' : ''}
                </span>
              ))}
              {' · '}{album.year}
            </p>

            {album.genre && (
              <p className="text-[#a8a29e] text-[11px] mt-0.5 uppercase tracking-[0.08em]">
                {album.genre}{album.subGenre1 ? ` · ${album.subGenre1}` : ''}
              </p>
            )}

            {/* Score stamp */}
            {album.score !== null && (
              <div className="mt-4 flex items-baseline gap-1.5">
                <span
                  className="text-5xl md:text-6xl font-bold tabular-nums leading-none"
                  style={{ color: accentColor ?? '#2d6a4f' }}
                >
                  {album.score.toFixed(2)}
                </span>
                <span className="text-[#a8a29e] text-base self-end mb-1">/10</span>
              </div>
            )}
            {album.score === null && album.predictedScore !== null && (
              <div className="mt-4 flex items-baseline gap-1.5">
                <span className="text-4xl font-bold tabular-nums leading-none text-[#a8998a]">
                  ~{album.predictedScore.toFixed(2)}
                </span>
                <span className="text-[#c2b8ad] text-sm self-end mb-0.5">predicted</span>
              </div>
            )}
          </div>

          {/* Sidebar stats */}
          {avgScore !== null && ratedSongs.length > 0 && (
            <div className="hidden md:flex flex-col items-end gap-2 text-sm shrink-0 pt-1">
              <div className="text-right">
                <span className="text-[#a8a29e] text-[11px] uppercase tracking-[0.08em] block mb-0.5">Avg</span>
                <span className="font-bold text-[#1c1917] tabular-nums">{avgScore.toFixed(2)}</span>
              </div>
              <div className="text-right">
                <span className="text-[#a8a29e] text-[11px] uppercase tracking-[0.08em] block mb-0.5">Bang%</span>
                <span className="font-bold tabular-nums" style={{ color: accentColor ?? '#2d6a4f' }}>
                  {Math.round(bangs.length / ratedSongs.length * 100)}%
                </span>
              </div>
              <div className="text-right">
                <span className="text-[#a8a29e] text-[11px] uppercase tracking-[0.08em] block mb-0.5">Skip%</span>
                <span className="font-bold text-[#c0392b] tabular-nums">
                  {Math.round(skips.length / ratedSongs.length * 100)}%
                </span>
              </div>
            </div>
          )}
        </div>

        {/* ── Factor tiles (LP only) ───────────────────────────────── */}
        {isLP && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-10">
            {[
              { label: 'Theme / Cohesion', value: album.theme },
              { label: 'Replay Value',      value: album.replayValue },
              { label: 'Production',        value: album.production },
              { label: 'Distinctness',      value: album.distinctness },
            ].map(({ label, value }) => (
              <div
                key={label}
                className="px-5 py-5 text-center"
              >
                <p
                  className="text-[10px] uppercase tracking-[0.13em] mb-3 font-medium"
                  style={{ color: color2 ? lightenHsl(color2, 50) : '#a8998a' }}
                >
                  {label}
                </p>
                <p
                  className="text-5xl font-bold tabular-nums leading-none"
                  style={{ color: accentColor ?? '#1c1917' }}
                >
                  {value ?? '—'}
                </p>
              </div>
            ))}
          </div>
        )}

        {/* ── Track list ───────────────────────────────────────────── */}
        <div className="flex flex-col mb-10">
          {sortedSongs.map((song, idx) => (
            <div
              key={song.id}
              className={`flex items-center gap-3 py-3 ${idx < sortedSongs.length - 1 ? 'border-b border-[#f0ebe3]' : ''}`}
            >
              {/* Score-mapped left bar */}
              <div
                className="w-[3px] h-5 rounded-full shrink-0"
                style={{ backgroundColor: song.score !== null ? songScoreColor(song.score) : '#e8e2d9' }}
              />

              <span className="text-[#c2b8ad] text-xs w-4 text-right shrink-0 tabular-nums select-none">
                {song.trackNumber}
              </span>

              <span className="flex-1 text-[#1c1917] text-sm truncate">
                {song.title}
              </span>

              {song.score !== null && song.score >= BANG_THRESHOLD && (
                <span
                  className="text-[9px] font-bold uppercase tracking-[0.12em] shrink-0"
                  style={{ color: songScoreColor(song.score) }}
                >
                  bang
                </span>
              )}
              {song.score !== null && song.score < SKIP_THRESHOLD && (
                <span
                  className="text-[9px] font-bold uppercase tracking-[0.12em] shrink-0"
                  style={{ color: songScoreColor(song.score) }}
                >
                  skip
                </span>
              )}

              <span
                className="text-base font-semibold tabular-nums w-10 text-right shrink-0"
                style={{ color: song.score !== null ? songScoreColor(song.score) : '#d4ccc4' }}
              >
                {song.score ?? '—'}
              </span>
            </div>
          ))}
        </div>

        {/* ── Friends' ratings ─────────────────────────────────────── */}
        {!isViewingFriend && friendRatings.length > 0 && (
          <div className="mt-2">
            <p className="text-[10px] font-semibold text-[#a8998a] uppercase tracking-[0.14em] mb-5">
              Friends' Ratings
            </p>
            <div className="flex flex-col gap-4">
              {friendRatings.map(({ friend, album: fa }) => {
                const friendSorted = [...fa.songs].sort((a, b) => (a.trackNumber ?? 0) - (b.trackNumber ?? 0))
                const friendRated = fa.songs.filter(s => s.score !== null)
                const friendAvg = friendRated.length > 0
                  ? friendRated.reduce((s, s2) => s + s2.score!, 0) / friendRated.length
                  : null
                const friendBangs = friendRated.filter(s => s.score! >= BANG_THRESHOLD)
                const friendSkips = friendRated.filter(s => s.score! < SKIP_THRESHOLD)

                return (
                  <div key={friend.id} className="bg-[#f7f3ee] border border-[#e8e2d9] rounded-2xl p-5">
                    <div className="flex items-center justify-between mb-5">
                      <div className="flex items-center gap-2.5">
                        <div
                          className="w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0"
                          style={{ backgroundColor: '#2d6a4f' }}
                        >
                          {friend.name[0].toUpperCase()}
                        </div>
                        <span className="text-sm font-semibold text-[#1c1917]">{friend.name}</span>
                      </div>
                      <div className="flex items-center gap-4 text-sm">
                        {friendAvg !== null && (
                          <span className="text-[#78716c]">Avg <span className="font-semibold text-[#1c1917] tabular-nums">{friendAvg.toFixed(2)}</span></span>
                        )}
                        {friendRated.length > 0 && (
                          <span className="text-[#78716c]">Bang% <span className="font-semibold text-[#2d6a4f] tabular-nums">{Math.round(friendBangs.length / friendRated.length * 100)}%</span></span>
                        )}
                        {friendRated.length > 0 && (
                          <span className="text-[#78716c]">Skip% <span className="font-semibold text-[#c0392b] tabular-nums">{Math.round(friendSkips.length / friendRated.length * 100)}%</span></span>
                        )}
                        {fa.score !== null && (
                          <span className="text-2xl font-bold tabular-nums text-[#2d6a4f]">{fa.score.toFixed(2)}</span>
                        )}
                      </div>
                    </div>

                    {fa.songs.length > 6 && (fa.theme ?? fa.replayValue ?? fa.production ?? fa.distinctness) && (
                      <div className="grid grid-cols-4 gap-2 mb-4">
                        {[
                          { label: 'Theme',   value: fa.theme },
                          { label: 'Replay',  value: fa.replayValue },
                          { label: 'Prod.',   value: fa.production },
                          { label: 'Distinct',value: fa.distinctness },
                        ].map(({ label, value }) => (
                          <div key={label} className="bg-[#f0ebe3] border border-[#e8e2d9] rounded-xl p-3 text-center">
                            <p className="text-[9px] text-[#a8998a] uppercase tracking-[0.1em] mb-1.5">{label}</p>
                            <p className="text-xl font-bold text-[#1c1917] tabular-nums">{value ?? '—'}</p>
                          </div>
                        ))}
                      </div>
                    )}

                    <div className="flex flex-col">
                      {friendSorted.map((song, idx) => (
                        <div
                          key={song.id}
                          className={`flex items-center gap-3 py-2.5 ${idx < friendSorted.length - 1 ? 'border-b border-[#ece5da]' : ''}`}
                        >
                          <div
                            className="w-[3px] h-4 rounded-full shrink-0"
                            style={{ backgroundColor: song.score !== null ? songScoreColor(song.score) : '#e8e2d9' }}
                          />
                          <span className="text-[#c2b8ad] text-xs w-4 text-right shrink-0 tabular-nums">{song.trackNumber}</span>
                          <span className="flex-1 text-[#57534e] text-sm truncate">{song.title}</span>
                          {song.score !== null && song.score >= BANG_THRESHOLD && (
                            <span className="text-[9px] font-bold uppercase tracking-[0.12em]" style={{ color: songScoreColor(song.score) }}>bang</span>
                          )}
                          {song.score !== null && song.score < SKIP_THRESHOLD && (
                            <span className="text-[9px] font-bold uppercase tracking-[0.12em]" style={{ color: songScoreColor(song.score) }}>skip</span>
                          )}
                          <span
                            className="text-sm font-semibold tabular-nums w-10 text-right shrink-0"
                            style={{ color: song.score !== null ? songScoreColor(song.score) : '#d4ccc4' }}
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

      </div>

      {showRecommend && album && (
        <RecommendModal album={album} onClose={() => setShowRecommend(false)} />
      )}
    </div>
  )
}
