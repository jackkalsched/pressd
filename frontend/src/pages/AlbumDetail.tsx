// One copy of an album — yours, or another user's — with its rating: the
// score, the four factors, every track, the review, and the copy's comments.
//
// Drawn from the same pieces as the community view (components/albumView) and
// laid out the same way: the record in a sticky column, the numbers beside it
// with nothing boxed, a faint wash of the cover behind the top, staggered
// entrances, and track rows that pop up as they scroll into view. It was the
// older page and looked it until October 2026 — a boxed hero, a row of
// rectangular buttons, a gradient keyed to an extracted accent colour. Moving
// between Your rating, Average rating and Compare should feel like turning
// pages of one thing, so all three now share a top bar and a type scale.
//
// Profiles are public, so this page opens on anyone's copy. What isn't public
// is the copy's comment thread, which is friends-only on the server
// (deps.authorize_friend) and hidden here for anyone else.
import { useState } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Check, Loader2, Pencil, Play, Plus, Share2, Star, Trash2 } from 'lucide-react'
import { fetchAlbum, deleteAlbum, fetchFriendRatings, fetchFriends, importAlbum, saveReview, deleteReview } from '../api'
import { useUser } from '../context/UserContext'
import { songScoreColor, BANG_THRESHOLD, SKIP_THRESHOLD, EP_MAX_TRACKS } from '../types'
import type { Album } from '../types'
import RecommendModal from '../components/RecommendModal'
import CommentThread from '../components/CommentThread'
import AlbumThoughts from '../components/AlbumThoughts'
import ShareCardModal from '../components/ShareCard'
import CoverImg from '../components/CoverImg'
import { Cover } from '../components/covers'
import {
  BangSkip, CoverWash, DANGER, GREEN, PILL, RECOMMEND, RevealRow, SECTION_LABEL, StatFigure,
} from '../components/albumView'
import { stagger } from '../lib/format'

function possessive(name: string): string {
  return name.endsWith('s') ? `${name}’` : `${name}’s`
}

function formatDay(iso: string | null): string | null {
  if (!iso) return null
  const d = new Date(iso.length <= 10 ? `${iso}T00:00:00` : iso)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
}

// ── Review ────────────────────────────────────────────────────────────────────

function ReviewSection({ album, editable, authorName, index, inRail = false }: {
  album: Album
  editable: boolean
  authorName: string
  index: number
  /** Under the title in the record's column, rather than after the tracks. */
  inRail?: boolean
}) {
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

  if (!editable && !album.review) return null

  return (
    <section className={`${inRail ? 'mt-8' : 'mt-12'} rise-in`} style={stagger(index)}>
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <p className={SECTION_LABEL}>{editable ? 'YOUR REVIEW' : `${possessive(authorName).toUpperCase()} REVIEW`}</p>
        {editable && album.review && !editing && (
          <button
            onClick={() => { setDraft(album.review ?? ''); setEditing(true) }}
            className="flex items-center gap-1.5 text-[12.5px] font-semibold text-[#2d6a4f] hover:text-[#245c43]"
          >
            <Pencil size={12} /> Edit
          </button>
        )}
      </div>

      {editing ? (
        <div className="rounded-2xl border border-[#e2dbd0] bg-white/80 p-4 pop-in">
          <textarea
            value={draft}
            onChange={e => setDraft(e.target.value)}
            autoFocus
            rows={8}
            placeholder="What worked, what didn't, the tracks that stayed with you…"
            className="w-full resize-y bg-transparent text-[15px] leading-relaxed text-[#1c1917] placeholder:text-[#b8ada0] focus:outline-none"
          />
          <div className="mt-3 flex items-center justify-end gap-2 border-t border-[#ece5da] pt-3">
            {album.review && (
              <button
                onClick={handleDelete}
                disabled={saving}
                className="mr-auto flex items-center gap-1.5 text-[13px] font-medium text-[#a8998a] hover:text-[#c0392b] disabled:opacity-50"
              >
                <Trash2 size={13} /> Delete
              </button>
            )}
            <button
              onClick={() => { setDraft(album.review ?? ''); setEditing(false) }}
              disabled={saving}
              className="px-3 py-1.5 text-[13px] font-medium text-[#78716c] hover:text-[#1c1917] disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving || !draft.trim()}
              className="flex items-center gap-1.5 rounded-full bg-[#2d6a4f] px-4 py-1.5 text-[13px] font-semibold text-white hover:bg-[#245c43] disabled:opacity-50"
            >
              {saving && <Loader2 size={13} className="animate-spin" />} Save
            </button>
          </div>
        </div>
      ) : album.review ? (
        <p className={`font-display m-0 max-w-2xl whitespace-pre-wrap break-words border-l-2 border-[#2d6a4f]/30 leading-relaxed text-[#1c1917] ${inRail ? 'pl-4 text-[15.5px]' : 'pl-5 text-[17px]'}`}>
          {album.review}
        </p>
      ) : (
        <button
          onClick={() => { setDraft(''); setEditing(true) }}
          className="inline-flex items-center gap-2 rounded-full border border-dashed border-[#cfc6b9] px-4 py-2 text-[13.5px] font-semibold text-[#8a7f72] hover:border-[#2d6a4f] hover:text-[#2d6a4f]"
        >
          <Pencil size={13} /> Write a review
        </button>
      )}
    </section>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function AlbumDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { isViewingFriend, viewingUser, activeUser, setViewingUser } = useUser()
  const [showRecommend, setShowRecommend] = useState(false)
  const [showShareCard, setShowShareCard] = useState(false)
  const [busy, setBusy] = useState<'rate' | 'queue' | 'delete' | null>(null)
  const [addedToLibrary, setAddedToLibrary] = useState(false)

  const { data: album, isLoading, error } = useQuery({
    queryKey: ['album', Number(id)],
    queryFn: () => fetchAlbum(Number(id)),
  })

  const { data: friendRatings = [] } = useQuery({
    queryKey: ['friend-ratings', album?.albumName, album?.artist, activeUser?.id],
    queryFn: () => fetchFriendRatings(album!.albumName, album!.artist, activeUser!.id),
    enabled: !!album && !isViewingFriend,
    staleTime: 60_000,
  })

  // Whether the owner of someone else's copy is your friend — the copy's
  // comments are only theirs and their friends' to read.
  const { data: myFriends = [] } = useQuery({
    queryKey: ['friends', activeUser?.id],
    queryFn: () => fetchFriends(activeUser!.id),
    enabled: !!activeUser && isViewingFriend,
    staleTime: 60_000,
  })

  function leave() {
    if (window.history.state?.idx > 0) navigate(-1)
    else navigate('/library')
  }

  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#f9f8f6] flex items-center justify-center gap-2 text-[#a8998a]">
        <Loader2 size={16} className="animate-spin" /> Loading…
      </div>
    )
  }
  if (error || !album) {
    return (
      <div className="min-h-screen bg-[#f9f8f6] flex flex-col items-center justify-center gap-3 px-6 text-center">
        <p className="font-display m-0 text-2xl font-bold text-[#1c1917]">Couldn&rsquo;t load this album</p>
        <button onClick={leave} className="text-sm font-semibold text-[#2d6a4f] hover:text-[#245c43]">Go back</button>
      </div>
    )
  }

  const own = !isViewingFriend
  const ownerName = own ? (activeUser?.name ?? 'You') : (viewingUser?.name ?? 'Their')
  const canSeeComments = own || myFriends.some(f => f.id === viewingUser?.id)
  const rated = album.status === 'rated'
  const ratedSongs = album.songs.filter((s) => s.score !== null)
  const songMean = ratedSongs.length > 0
    ? ratedSongs.reduce((sum, song) => sum + song.score!, 0) / ratedSongs.length
    : null
  const bangPct = ratedSongs.length ? (ratedSongs.filter(s => s.score! >= BANG_THRESHOLD).length / ratedSongs.length) * 100 : null
  const skipPct = ratedSongs.length ? (ratedSongs.filter(s => s.score! < SKIP_THRESHOLD).length / ratedSongs.length) * 100 : null
  const sortedSongs = [...album.songs].sort((a, b) => (a.trackNumber ?? 0) - (b.trackNumber ?? 0))
  const artists = [album.artist, ...album.extraArtists]
  const isEP = album.songs.length <= EP_MAX_TRACKS
  const subs = [album.subGenre1, album.subGenre2, album.subGenre3].filter(Boolean) as string[]
  // The track this rating rates highest: the tie-break pick when there was one.
  const topSong = album.topSongId != null
    ? album.songs.find(s => s.id === album.topSongId) ?? null
    : ratedSongs.reduce<typeof ratedSongs[number] | null>((best, s) => (best == null || s.score! > best.score! ? s : best), null)
  const ratedOn = formatDay(album.dateRated)
  const factors = [
    { label: 'Theme', value: album.theme },
    { label: 'Replay', value: album.replayValue },
    { label: 'Production', value: album.production },
    { label: 'Distinctness', value: album.distinctness },
  ]
  // The Pressd average only reads differently from this copy once someone
  // other than you has rated it; from someone else's copy it always does.
  const showAverage = rated && (!own || album.othersRaterCount > 0)
  // Someone else's finished rating reads as their take on the record, so the
  // review sits with the record — under its title — rather than after the
  // tracks. Yours stays below, where you write and edit it.
  const reviewInRail = !own && rated && !!album.review

  /** Someone else's copy into your library, at `status`. */
  async function importToLibrary(status: 'to_listen' | 'listening') {
    return importAlbum(
      {
        spotify_id: album!.spotifyId ?? null,
        album_name: album!.albumName,
        artist: album!.artist,
        year: album!.year ?? null,
        cover_url: album!.albumArtUrl ?? null,
        total_tracks: album!.totalTracks ?? album!.songs.length,
        tracks: album!.songs.map(s => ({
          title: s.title,
          track_number: s.trackNumber ?? null,
          duration_ms: null,
          explicit: false,
          spotify_id: s.spotifyId ?? null,
          artist: album!.artist,
        })),
        genre: album!.genre ?? null,
      },
      status,
      activeUser!.id,
    )
  }

  async function rateYourself() {
    if (busy) return
    setBusy('rate')
    try {
      const result = await importToLibrary('listening')
      queryClient.invalidateQueries({ queryKey: ['albums'] })
      setViewingUser(activeUser)
      navigate(`/rate/${result.id}`)
    } catch { setBusy(null) }
  }

  async function addToLibrary() {
    if (busy || addedToLibrary) return
    setBusy('queue')
    try {
      await importToLibrary('to_listen')
      queryClient.invalidateQueries({ queryKey: ['albums'] })
      setAddedToLibrary(true)
    } catch { /* the button stays as it was */ } finally {
      setBusy(null)
    }
  }

  async function remove() {
    if (busy) return
    if (!confirm(`Delete "${album!.albumName}" by ${album!.artist}? This cannot be undone.`)) return
    setBusy('delete')
    try {
      await deleteAlbum(album!.id)
      await queryClient.invalidateQueries({ queryKey: ['albums'] })
      queryClient.removeQueries({ queryKey: ['album', album!.id] })
      navigate('/library')
    } catch {
      setBusy(null)
      alert('Failed to delete album. Please try again.')
    }
  }

  return (
    <div className="relative min-h-screen overflow-x-hidden bg-[#f9f8f6]">
      <CoverWash url={album.albumArtUrl} />

      <div className="relative mx-auto w-full max-w-[1400px] px-4 pb-24 md:px-12">
        {/* ── Top bar ──────────────────────────────────────────────── */}
        <div className="flex flex-wrap items-center justify-between gap-3 py-6">
          <button onClick={leave} className="flex items-center gap-1.5 text-[13px] font-medium text-[#57534e] hover:text-[#111]">
            <ArrowLeft size={16} /> Back
          </button>
          <div className="flex flex-wrap items-center justify-end gap-2">
            {/* The three views of a record, in the same corner on all three. */}
            {showAverage && (
              <Link to={`/album/${album.id}/community`} className={PILL}>Average rating</Link>
            )}
            {own && rated && album.othersRaterCount > 0 && (
              <Link to={`/album/${album.id}/community?compare=1`} className={PILL}>Compare</Link>
            )}
            {rated && (
              <button onClick={() => setShowShareCard(true)} className={PILL}>
                <Share2 size={13} /> Share card
              </button>
            )}
            {own && rated && (
              <button
                onClick={() => setShowRecommend(true)}
                className={PILL}
                style={{ color: RECOMMEND }}
              >
                <Star size={12} fill={RECOMMEND} strokeWidth={0} /> Recommend
              </button>
            )}
            {own && (
              <button onClick={() => navigate(`/rate/${album.id}`)} className={PILL}>
                <Pencil size={12} /> {rated ? 'Edit rating' : 'Rate'}
              </button>
            )}
            {own && (
              <button
                onClick={remove}
                disabled={busy === 'delete'}
                aria-label={`Delete ${album.albumName}`}
                className="ml-1 flex h-9 w-9 items-center justify-center rounded-full hover:bg-red-50 disabled:opacity-50"
                style={{ color: DANGER }}
              >
                {busy === 'delete' ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={16} />}
              </button>
            )}
          </div>
        </div>

        <div className="grid gap-10 lg:grid-cols-[380px_minmax(0,1fr)] xl:gap-16">
          {/* ── The record ─────────────────────────────────────────── */}
          <aside>
            {/* Pinned while you scroll the tracks — unless a review sits in it,
                which can run past the bottom of the window and be unreachable
                while pinned. */}
            <div className={reviewInRail ? '' : 'lg:sticky lg:top-8'}>
              <div className="mx-auto w-full max-w-[380px] overflow-hidden rounded-[28px] shadow-[0_28px_60px_-28px_rgba(40,25,10,0.6)] pop-in">
                {album.albumArtUrl ? (
                  <CoverImg url={album.albumArtUrl} displayPx={380} loading="eager" alt="" className="block aspect-square w-full object-cover" />
                ) : (
                  <Cover artUrl={null} seed={album.artist} size={380} radius={0} fontSize={120} />
                )}
              </div>
              <h1 className="font-display m-0 mt-6 text-[34px] font-bold leading-tight text-[#1c1917]">{album.albumName}</h1>
              <p className="m-0 mt-1.5 text-[15px] text-[#57534e]">
                {artists.map((name, i, arr) => (
                  <span key={name}>
                    <Link to={`/artist/${encodeURIComponent(name)}`} className="font-semibold text-[#1c1917] hover:text-[#2d6a4f] hover:underline underline-offset-2">
                      {name}
                    </Link>
                    {i < arr.length - 1 ? ', ' : ''}
                  </span>
                ))}
                {album.year ? ` · ${album.year}` : ''}
              </p>
              {(album.genre || subs.length > 0) && (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {album.genre && (
                    <span className="rounded-full bg-[#2d6a4f]/10 px-2.5 py-1 text-[11.5px] font-semibold text-[#2d6a4f]">{album.genre}</span>
                  )}
                  {subs.map((s) => (
                    <span key={s} className="rounded-full bg-[#efebe5] px-2.5 py-1 text-[11.5px] font-medium text-[#78716c]">{s}</span>
                  ))}
                </div>
              )}
              {reviewInRail && (
                <ReviewSection album={album} editable={false} authorName={ownerName} index={1} inRail />
              )}
            </div>
          </aside>

          {/* ── The rating ─────────────────────────────────────────── */}
          <main className="min-w-0">
            <div className="rise-in py-2" style={stagger(0)}>
              {album.score != null ? (
                <>
                  <p className="font-display m-0 text-[64px] font-bold leading-none tabular-nums" style={{ color: songScoreColor(album.score) }}>
                    {album.score.toFixed(2)}
                  </p>
                  <p className="m-0 mt-2 text-[11px] font-bold tracking-[0.16em] text-[#44403c]">
                    {own ? 'YOUR SCORE' : `${possessive(ownerName).toUpperCase()} SCORE`}
                  </p>
                  {ratedOn && <p className="m-0 mt-0.5 text-[13px] text-[#8a7f72]">Rated {ratedOn}</p>}
                </>
              ) : album.predictedScore != null ? (
                <>
                  {/* Hollow, as on the community page: estimated, not measured. */}
                  <p className="font-display m-0 text-[64px] font-bold leading-none tabular-nums text-transparent [-webkit-text-stroke:2px_#2d6a4f]">
                    {album.predictedScore.toFixed(2)}
                  </p>
                  <p className="m-0 mt-2 flex items-center gap-1 text-[11px] font-bold tracking-[0.16em] text-[#2d6a4f]">
                    <Star size={11} fill={GREEN} strokeWidth={0} /> {own ? 'FOR YOU' : `FOR ${ownerName.toUpperCase()}`}
                  </p>
                  <p className="m-0 mt-0.5 text-[13px] text-[#8a7f72]">predicted</p>
                </>
              ) : (
                <>
                  <p className="font-display m-0 text-[64px] font-bold leading-none text-[#c8c0b4]">—</p>
                  <p className="m-0 mt-2 text-[11px] font-bold tracking-[0.16em] text-[#a8998a]">NOT RATED YET</p>
                </>
              )}
            </div>

            {/* Why it's on your shelf. The note is blanked by the server for
                anyone but you, so only the sender's name shows on a friend's. */}
            {album.recommendedByName && (
              <div className="mt-6 border-l-2 border-[#f3b98a] pl-4 rise-in" style={stagger(1)}>
                <p className="m-0 flex items-center gap-1.5 text-[13.5px] font-semibold" style={{ color: RECOMMEND }}>
                  <Star size={13} fill={RECOMMEND} strokeWidth={0} /> Recommended by {album.recommendedByName}
                </p>
                {album.recommendationNote && (
                  <p className="font-display m-0 mt-1.5 text-[15px] leading-relaxed text-[#1c1917]">&ldquo;{album.recommendationNote}&rdquo;</p>
                )}
              </div>
            )}

            {!isEP && factors.some(f => f.value != null) && (
              <div className="mt-8 grid grid-cols-2 gap-y-5 sm:grid-cols-4">
                {factors.map((f, i) => (
                  <StatFigure key={f.label} label={f.label} value={f.value} index={2 + i} />
                ))}
              </div>
            )}
            {ratedSongs.length > 0 && (
              <div className="mt-6 grid grid-cols-2 gap-y-5 sm:grid-cols-4">
                <StatFigure label="Song average" value={songMean} digits={2} index={6} />
                <StatFigure label="Bang rate" value={bangPct} digits={0} suffix="%" color={GREEN} index={7} />
                <StatFigure label="Skip rate" value={skipPct} digits={0} suffix="%" color="#c0392b" index={8} />
              </div>
            )}

            {/* Someone else's copy: the same two ways in as the community page. */}
            {!own && (
              <div className="mt-7 flex gap-2.5 rise-in" style={stagger(9)}>
                <button
                  onClick={rateYourself}
                  disabled={busy === 'rate'}
                  className="flex h-12 flex-1 items-center justify-center gap-2 rounded-xl bg-[#2d6a4f] text-[15px] font-semibold text-white hover:bg-[#245c43] disabled:opacity-70"
                >
                  {busy === 'rate' ? <Loader2 size={16} className="animate-spin" /> : <Play size={14} fill="currentColor" />}
                  Rate it yourself
                </button>
                <button
                  onClick={addToLibrary}
                  disabled={busy === 'queue' || addedToLibrary}
                  className={`flex h-12 flex-1 items-center justify-center gap-2 rounded-xl text-[15px] font-semibold ${
                    addedToLibrary ? 'bg-[#2d6a4f]/10 text-[#2d6a4f]' : 'border border-[#d7cfc3] bg-white text-[#1c1917] hover:border-[#2d6a4f]'
                  }`}
                >
                  {busy === 'queue' ? <Loader2 size={16} className="animate-spin" /> : addedToLibrary ? <Check size={16} className="pop" /> : <Plus size={16} />}
                  {addedToLibrary ? 'Added' : 'Add to Library'}
                </button>
              </div>
            )}
            {own && album.status === 'listening' && (
              <button
                onClick={() => navigate(`/rate/${album.id}`)}
                className="mt-7 flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#2d6a4f] text-[15px] font-semibold text-white hover:bg-[#245c43] rise-in"
                style={stagger(9)}
              >
                <Play size={14} fill="currentColor" /> Continue rating
              </button>
            )}

            {/* ── Tracks ─────────────────────────────────────────────── */}
            <p className={`${SECTION_LABEL} mb-2 mt-10`}>TRACKS</p>
            <ol className="m-0 -mx-4 list-none p-0">
              {sortedSongs.map((song, i) => {
                const top = topSong != null && song.id === topSong.id && song.score != null
                return (
                  <RevealRow key={song.id} index={i}>
                    <div className={`flex items-center gap-4 rounded-2xl px-4 py-3 transition-colors hover:bg-[#f2eee7] ${top ? 'bg-[#2d6a4f]/[0.07]' : ''}`}>
                      <span className="w-6 shrink-0 text-right text-[12.5px] text-[#b5aa9c] tabular-nums">{song.trackNumber}</span>
                      <span className={`min-w-0 flex-1 truncate text-[14.5px] text-[#1c1917] ${top ? 'font-semibold' : ''}`}>
                        {song.title}
                        {top && <Star size={11} fill="#c8a84b" strokeWidth={0} className="ml-1.5 inline -translate-y-px" aria-label="Top track" />}
                      </span>
                      <BangSkip score={song.score} />
                      <span
                        className="font-display w-10 text-right text-[16px] font-bold tabular-nums"
                        style={{ color: song.score != null ? songScoreColor(song.score) : '#c8c0b4' }}
                      >
                        {song.score != null ? song.score.toFixed(1) : '—'}
                      </span>
                    </div>
                  </RevealRow>
                )
              })}
            </ol>

            {/* ── Friends who rated it ───────────────────────────────── */}
            {own && friendRatings.length > 0 && (
              <section className="mt-12">
                <p className={`${SECTION_LABEL} mb-2`}>YOUR FRIENDS</p>
                <ul className="m-0 -mx-4 list-none p-0">
                  {friendRatings.map(({ friend, album: fa }, i) => {
                    const theirRated = fa.songs.filter(s => s.score !== null)
                    const fav = theirRated.length ? theirRated.reduce((a, b) => (b.score! > a.score! ? b : a)) : null
                    return (
                      <li key={friend.id} className="rise-in" style={stagger(i)}>
                        <button
                          type="button"
                          onClick={() => {
                            setViewingUser({ id: friend.id, name: friend.name, avatarUrl: friend.avatarUrl })
                            navigate(`/album/${fa.id}`)
                          }}
                          aria-label={`See ${possessive(friend.name)} rating`}
                          className="flex w-full items-center gap-4 rounded-2xl px-4 py-3 text-left transition-colors hover:bg-[#f2eee7]"
                        >
                          {friend.avatarUrl ? (
                            <img src={friend.avatarUrl} alt="" className="h-9 w-9 shrink-0 rounded-full object-cover" />
                          ) : (
                            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#2d6a4f] text-[13px] font-bold text-white">
                              {friend.name[0].toUpperCase()}
                            </span>
                          )}
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[14.5px] font-semibold text-[#1c1917]">{friend.name}</span>
                            {fav && (
                              <span className="mt-0.5 flex items-center gap-1 truncate text-[12.5px] text-[#8a7f72]">
                                <Star size={10} fill="#c8a84b" strokeWidth={0} className="shrink-0" />
                                <span className="truncate">{fav.title}</span>
                                <span className="shrink-0 tabular-nums">· {fav.score!.toFixed(1)}</span>
                              </span>
                            )}
                          </span>
                          {fa.score != null && (
                            <span className="font-display text-[20px] font-bold tabular-nums" style={{ color: songScoreColor(fa.score) }}>
                              {fa.score.toFixed(2)}
                            </span>
                          )}
                        </button>
                      </li>
                    )
                  })}
                </ul>
              </section>
            )}

            {!reviewInRail && (
              <ReviewSection album={album} editable={own} authorName={ownerName} index={1} />
            )}

            {/* The record's discussion: the step out from this copy to what
                the whole userbase said. */}
            <AlbumThoughts album={album.albumName} artist={album.artist} />

            {canSeeComments && (
              <section className="mt-12">
                <p className={`${SECTION_LABEL} mb-4`}>COMMENTS</p>
                <CommentThread albumId={album.id} />
              </section>
            )}
          </main>
        </div>
      </div>

      {showRecommend && (
        <RecommendModal album={album} onClose={() => setShowRecommend(false)} />
      )}
      {showShareCard && (
        <ShareCardModal album={album} onClose={() => setShowShareCard(false)} />
      )}
    </div>
  )
}
