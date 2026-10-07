import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Check, Clock, Loader2, UserPlus } from 'lucide-react'
import { acceptFriendRequest, addFriend, fetchFriendRequests, fetchFriends, fetchProfile, fetchSummary, fetchAlbums, removeFriend } from '../api'
import { useUser } from '../context/UserContext'
import Library from './Library'
import Stats from './Stats'
import Ratings from './Ratings'

type Tab = 'library' | 'stats' | 'ratings'

function avatarColor(name: string): string {
  const colors = ['#2d6a4f', '#1d4ed8', '#7c3aed', '#b45309', '#0f766e', '#be185d', '#c2410c']
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % colors.length
  return colors[h]
}

function Avatar({ name, avatarUrl, size }: { name: string; avatarUrl?: string; size: number }) {
  if (avatarUrl) {
    return (
      <img
        src={avatarUrl}
        alt={name}
        style={{ width: size, height: size, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }}
      />
    )
  }
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%', background: avatarColor(name),
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      color: '#fff', fontSize: size * 0.4, fontWeight: 700, flexShrink: 0,
    }}>
      {name[0].toUpperCase()}
    </div>
  )
}

function InlineStat({ value, label }: { value: string; label: string }) {
  return (
    <span className="text-sm text-[#78716c] whitespace-nowrap">
      <span className="font-semibold text-[#1c1917] tabular-nums">{value}</span> {label}
    </span>
  )
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
  const valid = Number.isFinite(fid)

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
  const weekAgo = Date.now() - 7 * 86_400_000
  const thisWeek = rated.filter(a => a.dateRated && new Date(a.dateRated).getTime() >= weekAgo).length

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
    <div className="min-h-screen bg-[#f9f8f6] p-4 md:p-8">
      <div className="mb-6">{backToFriends}</div>

      {/* ── Identity + stats ─────────────────────────────────────── */}
      <div className="flex items-start gap-5 md:gap-6 mb-8">
        <Avatar name={person.name} avatarUrl={person.avatarUrl} size={104} />

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="font-display text-3xl md:text-4xl font-bold text-[#1c1917] tracking-tight">
              {person.name}
            </h1>
            {mutualCount > 0 && (
              <span className="text-[13px] font-semibold text-[#2d6a4f] bg-[#2d6a4f]/10 px-3 py-1 rounded-full">
                {mutualCount} mutual friend{mutualCount === 1 ? '' : 's'}
              </span>
            )}
          </div>

          {/* Leading metrics — plain inline stats (friendships are mutual,
              so followers and following are the same set) */}
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 mt-3">
            <InlineStat value={String(theirFriends.length)} label="followers" />
            <InlineStat value={String(theirFriends.length)} label="following" />
            <InlineStat value={String(summary?.total_albums_rated ?? '—')} label="albums rated" />
            <InlineStat
              value={summary?.avg_album_score != null ? summary.avg_album_score.toFixed(2) : '—'}
              label="avg score"
            />
            <InlineStat value={String(summary?.longest_streak ?? 0)} label="day streak" />
            <InlineStat value={String(thisWeek)} label="this week" />
          </div>

          {person.bio && (
            <p className="text-sm text-[#57534e] mt-3 max-w-xl whitespace-pre-line leading-relaxed">
              {person.bio}
            </p>
          )}

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
      </div>

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
  )
}
