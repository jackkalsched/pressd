import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Check, Clock, Image as ImageIcon, Loader2, Settings, UserPlus } from 'lucide-react'
import { acceptFriendRequest, addFriend, fetchFriendRequests, fetchFriends, fetchProfile, fetchSummary, fetchAlbums, getInviteLink, removeFriend } from '../api'
import { useUser } from '../context/UserContext'
import Library from './Library'
import { useBanner } from '../lib/useBanner'
import { stagger } from '../lib/format'
import { songScoreColor } from '../types'
import { ScoreHistogram } from '../components/histograms'
import ProfilePicks from '../components/ProfilePicks'
import SettingsDialog from '../components/SettingsDialog'
import Stats from './Stats'
import Ratings from './Ratings'

type Tab = 'library' | 'stats' | 'ratings'

function avatarColor(name: string): string {
  const colors = ['#2d6a4f', '#1d4ed8', '#7c3aed', '#b45309', '#0f766e', '#be185d', '#c2410c']
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % colors.length
  return colors[h]
}

/** Top-N values by frequency across a list of (possibly null) tags. */
function topTags(tags: (string | null)[], n: number): string[] {
  const counts = new Map<string, number>()
  for (const t of tags) {
    if (t) counts.set(t, (counts.get(t) ?? 0) + 1)
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([t]) => t)
}

export default function FriendProfile() {
  const { userId } = useParams()
  const fid = Number(userId)
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { activeUser, setViewingUser } = useUser()
  const [tab, setTab] = useState<Tab>('library')
  const [busy, setBusy] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [shared, setShared] = useState(false)
  const valid = Number.isFinite(fid)
  // Your own page: Settings instead of the friend button, and picks you can change.
  const isSelf = activeUser?.id === fid
  const banner = useBanner(isSelf ? fid : undefined)

  // Who this is. Profiles are public (backend/deps.py, authorize_view), so the
  // identity comes from the profile endpoint rather than from your friends
  // list — which is why a reviewer you hadn't friended used to read as
  // "This profile isn't available".
  const { data: profile, isLoading: profileLoading, isError: profileError } = useQuery({
    queryKey: ['profile', fid],
    queryFn: () => fetchProfile(fid),
    enabled: valid,
    staleTime: 60_000,
  })
  const person = profile
    ? { id: profile.id, name: profile.name, avatarUrl: profile.avatar_url ?? undefined, bio: profile.bio }
    : null

  // Mine — whether we're friends, and the mutual count.
  const { data: myFriends = [] } = useQuery({
    queryKey: ['friends', activeUser?.id],
    queryFn: () => fetchFriends(activeUser!.id),
    enabled: !!activeUser,
    staleTime: 60_000,
  })
  const isFriend = myFriends.some(f => f.id === fid)
  const { data: requests } = useQuery({
    queryKey: ['friend-requests', activeUser?.id],
    queryFn: () => fetchFriendRequests(activeUser!.id),
    enabled: !!activeUser && !isFriend,
    staleTime: 60_000,
  })
  const requested = !!requests?.outgoing.some(u => u.id === fid)
  const theyAsked = !!requests?.incoming.some(u => u.id === fid)

  // Their friends → mutual = intersection with mine (excluding myself).
  const { data: theirFriends = [] } = useQuery({
    queryKey: ['friends', fid],
    queryFn: () => fetchFriends(fid),
    enabled: valid && !!person,
    staleTime: 60_000,
  })
  const myIds = new Set(myFriends.map(f => f.id))
  const mutualCount = theirFriends.filter(f => f.id !== activeUser?.id && myIds.has(f.id)).length

  const { data: summary } = useQuery({
    queryKey: ['stats', 'summary', fid],
    queryFn: () => fetchSummary(fid),
    enabled: valid && !!person,
    staleTime: 60_000,
  })

  // Rated albums → "this week" count. Shares its query key with the embedded
  // Library, so React Query serves both from one fetch.
  const { data: rated = [] } = useQuery({
    queryKey: ['albums', 'rated', fid],
    queryFn: () => fetchAlbums({ status: 'rated', userId: fid }),
    enabled: valid && !!person,
  })
  // The stat row's figures, counted as mobile's ProfileBanner counts them.
  // Artists are folded on case and spacing, so one artist's records don't count twice.
  const artistCount = new Set(rated.map((a) => a.artist.trim().toLowerCase())).size
  const albumScores = rated.flatMap((a) => (a.score != null ? [a.score] : []))

  // "Pressing since" — the month of the earliest album in the library, as on mobile.
  const since = (() => {
    const dates = rated.map((a) => a.dateAdded ?? a.dateRated).filter(Boolean) as string[]
    if (dates.length === 0) return null
    const min = dates.reduce((a, b) => (a < b ? a : b))
    return new Date(min.length <= 10 ? `${min}T00:00:00` : min).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
  })()

  /** Your invite link, not this page's address: a profile is behind sign-in,
   *  and the invite both signs someone up and makes you friends. The system
   *  share sheet where there is one, else the clipboard. */
  async function shareProfile() {
    if (!activeUser) return
    try {
      const { link } = await getInviteLink(activeUser.id)
      const text = `Compare music taste with me on Pressd`
      if (navigator.share) {
        await navigator.share({ title: 'Pressd', text, url: link })
      } else {
        await navigator.clipboard.writeText(link)
        setShared(true)
        setTimeout(() => setShared(false), 2000)
      }
    } catch { /* dismissed, or no clipboard — nothing to undo */ }
  }

  // Favorite genres: most common genre / subgenre tags across rated albums
  const topGenres = topTags(rated.map(a => a.genre), 3)
  const topSubgenres = topTags(rated.flatMap(a => [a.subGenre1, a.subGenre2, a.subGenre3]), 3)

  // Drive the global "view-as" context so the embedded pages and album detail
  // render this friend's data (read-only).
  const personId = person?.id
  const personName = person?.name
  const personAvatar = person?.avatarUrl
  useEffect(() => {
    if (personId != null && personName) setViewingUser({ id: personId, name: personName, avatarUrl: personAvatar })
  }, [personId, personName, personAvatar, setViewingUser])

  async function handleFriendButton() {
    if (!person || busy || requested) return
    if (isFriend && !confirm(`Remove ${person.name} as a friend?`)) return
    setBusy(true)
    try {
      if (isFriend) await removeFriend(activeUser!.id, fid)
      else if (theyAsked) await acceptFriendRequest(activeUser!.id, fid)
      else await addFriend(activeUser!.id, fid)
      queryClient.invalidateQueries({ queryKey: ['friends'] })
      queryClient.invalidateQueries({ queryKey: ['friend-requests'] })
      queryClient.invalidateQueries({ queryKey: ['feed'] })
    } catch { /* the button stays as it was */ } finally {
      setBusy(false)
    }
  }

  // Back to wherever you came from — For You, a thread, Social — now that a
  // profile can be reached from more than the friends list.
  function goBack() {
    setViewingUser(activeUser)
    if (window.history.state?.idx > 0) navigate(-1)
    else navigate('/social')
  }

  const backToFriends = (
    <button
      onClick={goBack}
      className="flex items-center gap-1.5 text-[#57534e] hover:text-[#1c1917] text-sm transition-colors"
    >
      <ArrowLeft size={16} /> Back
    </button>
  )

  if (!valid || profileError || (!profileLoading && !person)) {
    return (
      <div className="min-h-screen bg-[#f9f8f6] p-4 md:p-8">
        {backToFriends}
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <p className="text-[#78716c] text-sm">This profile isn't available.</p>
        </div>
      </div>
    )
  }

  if (!person) {
    return (
      <div className="min-h-screen bg-[#f9f8f6] p-4 md:p-8">
        {backToFriends}
        <div className="flex items-center justify-center py-24 text-[#a8998a] gap-2">
          <Loader2 size={16} className="animate-spin" /> <span className="text-sm">Loading…</span>
        </div>
      </div>
    )
  }

  const tabs: { key: Tab; label: string }[] = [
    { key: 'library', label: 'Library' },
    { key: 'stats', label: 'Stats' },
    { key: 'ratings', label: 'Ratings' },
  ]

  return (
    <div className="relative min-h-screen overflow-x-hidden bg-[#f9f8f6]">
      <div className="relative p-4 md:p-8">
      <div className="mb-5">{backToFriends}</div>

      {/* ── Banner ──────────────────────────────────────────────────
          Their picture, sharp, in the shape both apps crop to and the server
          stores (24:5, BANNER_SIZE) — so this is exactly what was framed.
          Without one, Pressd green. */}
      <div className="relative aspect-[24/5] w-full overflow-hidden rounded-[28px] bg-[linear-gradient(120deg,#245c43_0%,#2d6a4f_45%,#3d8463_100%)] fade-in">
        {profile?.banner_url && (
          <img src={profile.banner_url} alt="" className="absolute inset-0 h-full w-full object-cover" />
        )}
        {isSelf && (
          <label className="absolute right-4 top-4 flex cursor-pointer items-center gap-2 rounded-full bg-black/55 px-4 py-2 text-[13.5px] font-semibold text-white backdrop-blur-sm transition-colors hover:bg-black/70 md:right-6 md:top-5">
            {banner.busy ? <Loader2 size={15} className="animate-spin" /> : <ImageIcon size={15} />}
            Edit banner
            <input type="file" accept="image/*" className="hidden" onChange={banner.onFile} disabled={banner.busy} />
          </label>
        )}
      </div>
      {banner.error && <p className="m-0 mt-2 text-[13px] text-[#b91c1c]">{banner.error}</p>}

      {/* ── Identity ────────────────────────────────────────────────
          The avatar rides up over the banner's edge, ringed in the page's
          cream so it reads as lifted off it. Its own layer (relative z-10):
          the banner is positioned, and would otherwise paint over it. */}
      <div className="flex flex-wrap items-start gap-x-6 gap-y-4 px-2 md:px-6">
        {/* The avatar, and under it the shape of every album score — mobile
            draws the same histogram beneath its average. */}
        <div className="-mt-14 flex w-[122px] shrink-0 flex-col self-stretch md:-mt-24 md:w-[186px]">
          <div className="relative z-10 rounded-full bg-[#f9f8f6] p-[5px] shadow-[0_18px_40px_-18px_rgba(40,25,10,0.55)] md:p-[7px]">
            <div
              className="flex h-[112px] w-[112px] items-center justify-center overflow-hidden rounded-full text-[44px] font-bold text-white md:h-[172px] md:w-[172px] md:text-[68px]"
              style={{ background: person.avatarUrl ? '#ebe5dc' : avatarColor(person.name) }}
            >
              {person.avatarUrl
                ? <img src={person.avatarUrl} alt={person.name} className="h-full w-full object-cover" />
                : person.name[0]?.toUpperCase()}
            </div>
          </div>
          {albumScores.length > 0 && (
            // Pushed to the column's foot, which the row stretches to the
            // name block's — so the bars end level with the bio's last line.
            <div className="mt-auto px-2 pt-4 rise-in" style={stagger(1)}>
              <ScoreHistogram scores={albumScores} height={34} axis={false} />
            </div>
          )}
        </div>

        {/* Top-aligned, with its own gap under the banner: aligned to the
            bottom, room above the name would also drag the avatar down. */}
        <div className="min-w-0 flex-1 pt-4 md:pt-6">
          {/* Line height 1.2, not 1: `truncate` clips to the line box, and
              Playfair's descenders (the j, g, y) hang below a 1.0 line. */}
          <h1 className="font-display m-0 truncate pb-[0.06em] text-[40px] font-bold leading-[1.2] tracking-tight text-[#1c1917] md:text-[56px]">
            {person.name}
          </h1>
          <p className="m-0 mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[15px] text-[#8a7f72]">
            {[
              `@${person.name}`,
              since && `Pressing since ${since}`,
              !isSelf && mutualCount > 0 && `${mutualCount} mutual friend${mutualCount === 1 ? '' : 's'}`,
            ].filter(Boolean).map((part, i) => (
              <span key={i} className="flex items-center gap-2.5">
                {i > 0 && <span aria-hidden className="text-[#c8c0b4]">•</span>}
                <span>{part}</span>
              </span>
            ))}
          </p>
          {/* The bio on its own line, wrapping to three before it's cut —
              inline beside the handle it truncated after a few words. */}
          {person.bio && (
            <p className="m-0 mt-2 max-w-2xl whitespace-pre-line text-[15px] leading-relaxed text-[#57534e] line-clamp-3">
              {person.bio}
            </p>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-2.5 pt-4 md:pt-8">
          {isSelf ? (
            <>
              <button
                onClick={shareProfile}
                className="flex h-11 items-center gap-2 rounded-full bg-[#2d6a4f] px-5 text-[14.5px] font-semibold text-white shadow-[0_10px_24px_-10px_rgba(45,106,79,0.75)] hover:bg-[#245c43]"
              >
                {shared ? <><Check size={16} className="pop" /> Link copied</> : 'Share profile'}
              </button>
              <button
                onClick={() => setSettingsOpen(true)}
                className="flex h-11 items-center gap-2 rounded-full border border-[#e2dbd0] bg-white px-5 text-[14.5px] font-semibold text-[#2d6a4f] hover:border-[#2d6a4f]"
              >
                <Settings size={16} /> Settings
              </button>
            </>
          ) : (
            <button
              onClick={handleFriendButton}
              disabled={busy || requested}
              title={isFriend ? "You're friends — click to remove" : undefined}
              // Adding someone is the thing this page should invite, so it gets the
              // loud green; already being friends is the settled, quieter state.
              className={`shrink-0 flex items-center gap-2 font-semibold text-sm px-5 py-2.5 rounded-xl transition-[background-color,transform,box-shadow] duration-200 ease-out disabled:opacity-60 ${
                isFriend || requested
                  ? 'bg-[#2d6a4f]/10 text-[#2d6a4f] hover:bg-[#2d6a4f]/15'
                  : 'bg-[#2d6a4f] text-white shadow-[0_10px_24px_-10px_rgba(45,106,79,0.75)] hover:bg-[#245c43] hover:-translate-y-px hover:shadow-[0_14px_28px_-10px_rgba(45,106,79,0.8)]'
              }`}
            >
              {busy ? <Loader2 size={15} className="animate-spin" />
                : isFriend ? <Check size={16} />
                : requested ? <Clock size={15} />
                : <UserPlus size={16} />}
              {isFriend ? 'Friends' : requested ? 'Requested' : theyAsked ? 'Accept request' : 'Add friend'}
            </button>
          )}
        </div>
      </div>

      {/* ── Headline numbers, between two rules ─────────────────
          The average and the four counts, in mobile's order. */}
      <div className="mt-8 grid grid-cols-3 items-end gap-x-6 gap-y-6 border-y border-[#e8e2d9] px-2 py-6 md:grid-cols-5 md:px-6">
        {[
          { value: summary?.avg_album_score != null ? summary.avg_album_score.toFixed(2) : '—', label: 'Avg score',
            color: summary?.avg_album_score != null ? songScoreColor(summary.avg_album_score) : undefined },
          { value: rated.length.toLocaleString(), label: 'Albums' },
          { value: artistCount.toLocaleString(), label: 'Artists' },
          { value: summary?.total_songs_rated != null ? summary.total_songs_rated.toLocaleString() : '—', label: 'Songs' },
          { value: theirFriends.length.toLocaleString(), label: 'Friends' },
        ].map((st, i) => (
          <div key={st.label} className="rise-in" style={stagger(i)}>
            <p className="font-display m-0 text-[30px] font-bold leading-none tabular-nums md:text-[36px]" style={{ color: st.color ?? '#1c1917' }}>
              {st.value}
            </p>
            <p className="m-0 mt-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-[#a8998a]">{st.label}</p>
          </div>
        ))}
      </div>

      {/* Favourite genres, then the picks. */}
      <div className="mt-6 mb-2 px-2 md:px-6">
            {(topGenres.length > 0 || topSubgenres.length > 0) && (
              <div className="mt-4">
                <p className="text-[10px] font-semibold text-[#a8998a] uppercase tracking-[0.1em] mb-1.5">
                  Favorite genres
                </p>
                <div className="flex flex-wrap items-center gap-1.5">
                  {topGenres.map((g) => (
                    <span key={g} className="text-xs font-semibold text-[#2d6a4f] bg-[#2d6a4f]/10 px-2.5 py-1 rounded-full">
                      {g}
                    </span>
                  ))}
                  {topSubgenres.map((g) => (
                    <span key={g} className="text-xs font-medium text-[#78716c] bg-[#efe9e0] px-2.5 py-1 rounded-full">
                      {g}
                    </span>
                  ))}
                </div>
              </div>
            )}
      </div>

      {/* Favourite song, album and artist — editable on your own page. */}
      {/* Same inset as the genres above, so the two share a left edge. */}
      {profile && (
        <div className="px-2 md:px-6">
          <ProfilePicks profile={profile} editable={isSelf} />
        </div>
      )}

      {/* ── Tab switcher ─────────────────────────────────────────── */}
      <div className="flex items-center border-t border-[#e8e2d9] pt-5 mb-6">
        <div className="flex items-center gap-1 bg-[#efe9e0] rounded-xl p-1 shrink-0">
          {tabs.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`text-sm font-semibold px-4 py-1.5 rounded-lg transition-colors ${
                tab === key ? 'bg-white text-[#1c1917] shadow-sm' : 'text-[#78716c] hover:text-[#1c1917]'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Tab content (read-only, driven by viewing context) ───── */}
      {tab === 'library' && <Library embedded />}
      {tab === 'stats' && <Stats embedded />}
      {tab === 'ratings' && <Ratings embedded />}
      </div>
      {settingsOpen && <SettingsDialog onClose={() => setSettingsOpen(false)} />}
      {banner.cropper}
    </div>
  )
}
