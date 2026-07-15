import { useState } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Loader2, Pencil, Trash2, MessageCircle, Star, Music, BookOpen, Users, Share2 } from 'lucide-react'
import { fetchAlbum, deleteAlbum, fetchFriendRatings, importAlbum, saveReview, deleteReview } from '../api'
import { useUser } from '../context/UserContext'
import { BANG_THRESHOLD, SKIP_THRESHOLD, songScoreColor } from '../types'
import type { Album } from '../types'
import RecommendModal from '../components/RecommendModal'
import CommentThread from '../components/CommentThread'
import ShareCardModal from '../components/ShareCard'

function shareRatingViaIMessage(albumName: string, artist: string, score: number | null, viewingName?: string) {
  const who = viewingName ? `${viewingName} rated` : 'I rated'
  const scoreStr = score != null ? `${score}/10` : 'unscored'
  const msg = `${who} "${albumName}" by ${artist} — ${scoreStr} on Press'd 🎵`
  window.location.href = `sms:?body=${encodeURIComponent(msg)}`
}

const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:8000'

function accentToPageGradient(hsl: string | null): string {
  if (!hsl) return '#faf8f5'
  const h = hsl.match(/hsl\((\d+)/)?.[1]
  if (!h) return '#faf8f5'
  return `linear-gradient(to bottom, hsl(${h}, 38%, 88%) 0%, hsl(${h}, 25%, 94%) 30%, #faf8f5 60%)`
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

function ReviewSection({ album, editable, authorName }: { album: Album; editable: boolean; authorName: string }) {
  const queryClient = useQueryClient()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(album.review ?? '')
  const [saving, setSaving] = useState(false)

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ['album', album.id] })
    queryClient.invalidateQueries({ queryKey: ['feed'] })
    queryClient.invalidateQueries({ queryKey: ['friend-reviews'] })
  }

  async function handleSave() {
    if (saving) return
    setSaving(true)
    try {
      await saveReview(album.id, draft)
      invalidate()
      setEditing(false)
    } catch { /* keep editing so the draft survives */ } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!confirm('Delete your review?')) return
    setSaving(true)
    try {
      await deleteReview(album.id)
      setDraft('')
      invalidate()
      setEditing(false)
    } catch { /* ignore */ } finally {
      setSaving(false)
    }
  }

  // Friend's review — read-only, only shown when one exists.
  if (!editable) {
    if (!album.review) return null
    return (
      <div className="mt-10 max-w-2xl">
        <p className="text-[10px] font-semibold text-[#a8998a] uppercase tracking-[0.14em] mb-4 flex items-center gap-1.5">
          <BookOpen size={12} /> {authorName}'s Review
        </p>
        <div className="bg-white/70 border border-[#e8e2d9] rounded-2xl p-6">
          <p className="text-[15px] text-[#3c3530] leading-relaxed whitespace-pre-wrap break-words">{album.review}</p>
        </div>
      </div>
    )
  }

  // Your own album — editable composer.
  return (
    <div className="mt-10 max-w-2xl">
      <p className="text-[10px] font-semibold text-[#a8998a] uppercase tracking-[0.14em] mb-4 flex items-center gap-1.5">
        <BookOpen size={12} /> Your Review
      </p>

      {editing ? (
        <div className="bg-white/70 border border-[#e8e2d9] rounded-2xl p-4">
          <textarea
            value={draft}
            onChange={e => setDraft(e.target.value)}
            autoFocus
            rows={8}
            placeholder="Write your thoughts on this album — what worked, what didn't, standout tracks, how it sits in the artist's catalog…"
            className="w-full resize-y bg-transparent text-[15px] text-[#3c3530] leading-relaxed placeholder:text-[#b8ada0] focus:outline-none"
          />
          <div className="flex items-center justify-end gap-2 mt-3 pt-3 border-t border-[#ece5da]">
            {album.review && (
              <button
                onClick={handleDelete}
                disabled={saving}
                className="mr-auto flex items-center gap-1.5 text-[13px] font-medium text-[#a8998a] hover:text-[#c0392b] transition-colors disabled:opacity-50"
              >
                <Trash2 size={13} /> Delete
              </button>
            )}
            <button
              onClick={() => { setDraft(album.review ?? ''); setEditing(false) }}
              disabled={saving}
              className="text-[13px] font-medium text-[#78716c] hover:text-[#1c1917] px-3 py-1.5 transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving || !draft.trim()}
              className="flex items-center gap-1.5 text-[13px] font-medium bg-[#2d6a4f] hover:bg-[#245c43] text-white px-4 py-1.5 rounded-lg transition-colors disabled:opacity-50"
            >
              {saving && <Loader2 size={13} className="animate-spin" />} Save
            </button>
          </div>
        </div>
      ) : album.review ? (
        <div className="bg-white/70 border border-[#e8e2d9] rounded-2xl p-6 group relative">
          <p className="text-[15px] text-[#3c3530] leading-relaxed whitespace-pre-wrap break-words">{album.review}</p>
          <button
            onClick={() => { setDraft(album.review ?? ''); setEditing(true) }}
            className="absolute top-4 right-4 flex items-center gap-1.5 text-[12px] font-medium text-[#a8998a] hover:text-[#2d6a4f] opacity-0 group-hover:opacity-100 transition-opacity"
          >
            <Pencil size={12} /> Edit
          </button>
        </div>
      ) : (
        <button
          onClick={() => { setDraft(''); setEditing(true) }}
          className="w-full flex items-center justify-center gap-2 py-6 border border-dashed border-[#d0c8be] rounded-2xl text-[#a8998a] hover:text-[#2d6a4f] hover:border-[#2d6a4f]/40 transition-colors text-sm"
        >
          <Pencil size={14} /> Write a review
        </button>
      )}
    </div>
  )
}

export default function AlbumDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { isViewingFriend, viewingUser, activeUser, setViewingUser } = useUser()
  const [showRecommend, setShowRecommend] = useState(false)
  const [showShareCard, setShowShareCard] = useState(false)
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
        activeUser!.id,
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
        activeUser!.id,
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
    queryKey: ['friend-ratings', album?.albumName, album?.artist, activeUser?.id],
    queryFn: () => fetchFriendRatings(album!.albumName, album!.artist, activeUser!.id),
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
  const btnNeutral = `${btnBase} bg-white border border-[#d0c8be] hover:bg-[#f5f2ee] text-[#3c3530] shadow-sm`
  const btnGreen = `${btnBase} bg-[#2d6a4f] hover:bg-[#245c43] text-white border border-transparent shadow-sm`
  const btnOrange = `${btnBase} bg-white border border-[#fcd9a8] hover:bg-[#fff7ed] text-[#ea7a2a] shadow-sm`
  const btnDanger = `${btnBase} bg-white border border-[#d0c8be] hover:border-red-300 hover:text-red-500 text-[#3c3530] shadow-sm`

  return (
    <div className="min-h-screen relative overflow-hidden" style={{ background: accentToPageGradient(accentColor) }}>
      {/* Faint album art watermark */}
      {album.albumArtUrl && (
        <div className="absolute inset-0 pointer-events-none select-none" aria-hidden="true">
          <img
            src={album.albumArtUrl}
            alt=""
            className="absolute top-0 right-0 w-[55vw] max-w-2xl object-cover rounded-none"
            style={{
              opacity: 0.18,
              filter: 'blur(1px) saturate(1.1)',
              transform: 'translate(10%, -5%)',
              maskImage: 'radial-gradient(ellipse 75% 75% at 55% 40%, black 20%, rgba(0,0,0,0.5) 50%, transparent 75%)',
              WebkitMaskImage: 'radial-gradient(ellipse 75% 75% at 55% 40%, black 20%, rgba(0,0,0,0.5) 50%, transparent 75%)',
            }}
          />
        </div>
      )}
      <div className="p-4 md:p-8 max-w-5xl mx-auto relative">

        {/* ── Nav ──────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between mb-8">
          <button
            onClick={() => navigate(-1)}
            className="flex items-center gap-1.5 text-[#44403c] hover:text-[#1c1917] text-sm transition-colors"
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
                onClick={() => shareRatingViaIMessage(album.albumName, album.artist, album.score, isViewingFriend ? viewingUser!.name : undefined)}
                className={btnNeutral}
              >
                <MessageCircle size={12} /> Share
              </button>
            )}
            {album.status === 'rated' && (
              <button onClick={() => setShowShareCard(true)} className={btnNeutral}>
                <Share2 size={12} /> Share Card
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
          <div className="w-36 h-36 md:w-44 md:h-44 shrink-0 rounded-2xl overflow-hidden shadow-[0_16px_48px_rgba(0,0,0,0.32),0_4px_12px_rgba(0,0,0,0.18)] bg-[#ece6dc]">
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
            <h1 className="text-2xl md:text-3xl font-bold leading-tight text-[#1c1917]">
              {album.albumName}
            </h1>

            <p className="text-[#44403c] text-sm mt-1.5">
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
              <p className="text-[#57534e] text-[11px] mt-0.5 uppercase tracking-[0.08em]">
                {album.genre}{album.subGenre1 ? ` · ${album.subGenre1}` : ''}
              </p>
            )}

            {/* Score stamp */}
            {album.score !== null && (
              <div className="mt-4 flex items-baseline gap-1.5">
                <span className="text-5xl md:text-6xl font-bold tabular-nums leading-none text-[#1c1917]">
                  {album.score.toFixed(2)}
                </span>
                <span className="text-[#57534e] text-base self-end mb-1">/10</span>
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

            {/* Whose rating this is — shown only when viewing a friend */}
            {isViewingFriend && album.score !== null && (
              <p className="text-[12px] text-[#78716c] mt-2">
                Rated by <span className="font-semibold text-[#2d6a4f]">{viewingUser!.name}</span>
              </p>
            )}
          </div>

          {/* Sidebar stats */}
          {avgScore !== null && ratedSongs.length > 0 && (
            <div className="hidden md:flex flex-col items-end gap-2 text-sm shrink-0 pt-1">
              <div className="text-right">
                <span className="text-[#57534e] text-[11px] uppercase tracking-[0.08em] block mb-0.5">Avg</span>
                <span className="font-bold text-[#1c1917] tabular-nums">{avgScore.toFixed(2)}</span>
              </div>
              <div className="text-right">
                <span className="text-[#57534e] text-[11px] uppercase tracking-[0.08em] block mb-0.5">Bang%</span>
                <span className="font-bold tabular-nums text-[#2d6a4f]">
                  {Math.round(bangs.length / ratedSongs.length * 100)}%
                </span>
              </div>
              <div className="text-right">
                <span className="text-[#57534e] text-[11px] uppercase tracking-[0.08em] block mb-0.5">Skip%</span>
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
                <p className="text-[10px] uppercase tracking-[0.13em] mb-3 font-medium text-[#57534e]">
                  {label}
                </p>
                <p className="text-5xl font-bold tabular-nums leading-none text-[#1c1917]">
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
                {song.score !== null ? song.score.toFixed(1) : '—'}
              </span>
            </div>
          ))}
        </div>

        {/* ── Friends' take — under the track list, above the review ── */}
        {!isViewingFriend && friendRatings.length > 0 && (
          <div className="flex items-center gap-4 mb-10 rounded-2xl border border-[#cfe0d6] px-5 py-4">
            <div className="w-9 h-9 rounded-full bg-[#2d6a4f]/12 flex items-center justify-center shrink-0">
              <Users size={17} className="text-[#2d6a4f]" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-[#1c1917] mb-2">
                Check out what your friends gave this album
              </p>
              <div className="flex flex-wrap items-center gap-2">
                {friendRatings.map(({ friend, album: fa }) => {
                  const rated = fa.songs.filter(s => s.score !== null)
                  const fav = rated.length ? rated.reduce((a, b) => (b.score! > a.score! ? b : a)) : null
                  return (
                    <button
                      key={friend.id}
                      type="button"
                      onClick={() => {
                        setViewingUser({ id: friend.id, name: friend.name, avatarUrl: friend.avatarUrl })
                        navigate(`/album/${fa.id}`)
                      }}
                      title={`See ${friend.name}'s full rating`}
                      className="inline-flex items-center gap-2 bg-white border border-[#e8e2d9] rounded-xl px-2.5 py-1.5 shadow-sm max-w-[16rem] text-left transition-colors hover:border-[#2d6a4f]/50 hover:bg-[#f7faf8]"
                    >
                      <span
                        className="w-6 h-6 rounded-full flex items-center justify-center text-white text-[10px] font-bold shrink-0"
                        style={{ backgroundColor: '#2d6a4f' }}
                      >
                        {friend.name[0].toUpperCase()}
                      </span>
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="text-[12px] font-medium text-[#57534e] truncate">{friend.name}</span>
                          {fa.score !== null && (
                            <span className="text-[13px] font-bold tabular-nums shrink-0" style={{ color: songScoreColor(fa.score) }}>
                              {fa.score.toFixed(2)}
                            </span>
                          )}
                        </div>
                        {fav && (
                          <div className="flex items-center gap-1 text-[11px] text-[#a8998a] min-w-0 mt-0.5" title={`${friend.name}'s favorite track`}>
                            <Star size={9} fill="#c8a84b" strokeWidth={0} className="shrink-0" />
                            <span className="truncate">{fav.title}</span>
                            <span className="font-semibold text-[#78716c] tabular-nums shrink-0">{fav.score!.toFixed(1)}</span>
                          </div>
                        )}
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>
          </div>
        )}

        {/* ── Review ───────────────────────────────────────────────── */}
        <ReviewSection album={album} editable={!isViewingFriend} authorName={isViewingFriend ? viewingUser!.name : (activeUser?.name ?? 'You')} />

        {/* ── Comments ─────────────────────────────────────────────── */}
        <div className="mt-10 max-w-2xl">
          <p className="text-[10px] font-semibold text-[#a8998a] uppercase tracking-[0.14em] mb-5">
            Comments
          </p>
          <div className="bg-white/70 border border-[#e8e2d9] rounded-2xl p-5">
            <CommentThread albumId={album.id} />
          </div>
        </div>

      </div>

      {showRecommend && album && (
        <RecommendModal album={album} onClose={() => setShowRecommend(false)} />
      )}
      {showShareCard && album && (
        <ShareCardModal album={album} onClose={() => setShowShareCard(false)} />
      )}
    </div>
  )
}
