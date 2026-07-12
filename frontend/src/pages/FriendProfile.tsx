import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Check, Loader2 } from 'lucide-react'
import { fetchFriends, fetchSummary, fetchAlbums, removeFriend } from '../api'
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
  const [removing, setRemoving] = useState(false)

  // My friends — locates this friend's identity and feeds the mutual count.
  const { data: myFriends = [], isLoading: friendsLoading } = useQuery({
    queryKey: ['friends', activeUser?.id],
    queryFn: () => fetchFriends(activeUser!.id),
    enabled: !!activeUser,
    staleTime: 60_000,
  })
  const friend = myFriends.find(f => f.id === fid) ?? null

  // Their friends → mutual = intersection with mine (excluding myself).
  const { data: theirFriends = [] } = useQuery({
    queryKey: ['friends', fid],
    queryFn: () => fetchFriends(fid),
    enabled: Number.isFinite(fid) && !!friend,
    staleTime: 60_000,
  })
  const myIds = new Set(myFriends.map(f => f.id))
  const mutualCount = theirFriends.filter(f => f.id !== activeUser?.id && myIds.has(f.id)).length

  const { data: summary } = useQuery({
    queryKey: ['stats', 'summary', fid],
    queryFn: () => fetchSummary(fid),
    enabled: Number.isFinite(fid) && !!friend,
    staleTime: 60_000,
  })

  // Rated albums → "this week" count. Shares its query key with the embedded
  // Library, so React Query serves both from one fetch.
  const { data: rated = [] } = useQuery({
    queryKey: ['albums', 'rated', fid],
    queryFn: () => fetchAlbums({ status: 'rated', userId: fid }),
    enabled: Number.isFinite(fid) && !!friend,
  })
  const weekAgo = Date.now() - 7 * 86_400_000
  const thisWeek = rated.filter(a => a.dateRated && new Date(a.dateRated).getTime() >= weekAgo).length

  // Favorite genres: most common genre / subgenre tags across rated albums
  const topGenres = topTags(rated.map(a => a.genre), 3)
  const topSubgenres = topTags(rated.flatMap(a => [a.subGenre1, a.subGenre2, a.subGenre3]), 3)

  // Drive the global "view-as" context so the embedded pages and album detail
  // render this friend's data (read-only).
  useEffect(() => {
    if (friend) setViewingUser({ id: friend.id, name: friend.name, avatarUrl: friend.avatarUrl })
  }, [friend, setViewingUser])

  async function handleRemove() {
    if (!friend || removing) return
    if (!confirm(`Remove ${friend.name} as a friend?`)) return
    setRemoving(true)
    try {
      await removeFriend(activeUser!.id, fid)
      setViewingUser(activeUser)
      queryClient.invalidateQueries({ queryKey: ['friends'] })
      queryClient.invalidateQueries({ queryKey: ['feed'] })
      navigate('/social')
    } catch {
      setRemoving(false)
    }
  }

  function exitToFriends() {
    setViewingUser(activeUser)
    navigate('/social')
  }

  const backToFriends = (
    <button
      onClick={exitToFriends}
      className="flex items-center gap-1.5 text-[#57534e] hover:text-[#1c1917] text-sm transition-colors"
    >
      <ArrowLeft size={16} /> Friends
    </button>
  )

  if (!Number.isFinite(fid) || (!friendsLoading && !friend)) {
    return (
      <div className="min-h-screen bg-[#f9f8f6] p-4 md:p-8">
        {backToFriends}
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <p className="text-[#78716c] text-sm">This profile isn't available.</p>
          <p className="text-[#a8998a] text-xs mt-1">You can only view the profiles of your friends.</p>
        </div>
      </div>
    )
  }

  if (!friend) {
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
        <Avatar name={friend.name} avatarUrl={friend.avatarUrl} size={104} />

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="font-display text-3xl md:text-4xl font-bold text-[#1c1917] tracking-tight">
              {friend.name}
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

          {friend.bio && (
            <p className="text-sm text-[#57534e] mt-3 max-w-xl whitespace-pre-line leading-relaxed">
              {friend.bio}
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
          onClick={handleRemove}
          disabled={removing}
          title="You're friends — click to remove"
          className="shrink-0 flex items-center gap-2 bg-[#2d6a4f] hover:bg-[#245c43] text-white font-semibold text-sm px-5 py-2.5 rounded-xl transition-colors disabled:opacity-60"
        >
          {removing ? <Loader2 size={15} className="animate-spin" /> : <Check size={16} />}
          Friends
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
