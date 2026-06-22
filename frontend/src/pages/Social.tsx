import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Loader2, Music, Search, UserPlus, Check } from 'lucide-react'
import { fetchFeed, searchUsers, addFriend } from '../api'
import type { FeedItem, UserSearchResult } from '../api'
import { useUser } from '../context/UserContext'

function timeAgo(dateStr?: string): string {
  if (!dateStr) return ''
  const diff = Date.now() - new Date(dateStr).getTime()
  const days = Math.floor(diff / 86400000)
  if (days === 0) return 'today'
  if (days === 1) return '1 day ago'
  if (days < 30) return `${days} days ago`
  const months = Math.floor(days / 30)
  if (months === 1) return '1 month ago'
  return `${months} months ago`
}

function avatarColor(name: string): string {
  const colors = ['#2d6a4f', '#1d4ed8', '#7c3aed', '#b45309', '#0f766e', '#be185d', '#c2410c']
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % colors.length
  return colors[h]
}

function FriendAvatar({ name, avatarUrl, size = 32 }: { name: string; avatarUrl?: string; size?: number }) {
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
      color: '#fff', fontSize: size * 0.42, fontWeight: 700, flexShrink: 0,
    }}>
      {name[0].toUpperCase()}
    </div>
  )
}

function scoreColor(score: number): string {
  if (score >= 8.5) return '#1a7a3c'
  if (score >= 7) return '#2d6a4f'
  if (score >= 5.5) return '#b45309'
  return '#c0392b'
}

function FeedCard({ item }: { item: FeedItem }) {
  const { setViewingUser } = useUser()
  const navigate = useNavigate()

  function handleView() {
    setViewingUser({ id: item.friend.id, name: item.friend.name, avatarUrl: item.friend.avatar_url })
    navigate(`/album/${item.album_id}`)
  }

  return (
    <div className="bg-white border border-[#e2e2e2] rounded-2xl p-5 flex gap-5 hover:border-[#c8c8c8] transition-colors">
      {/* Album art */}
      <div className="w-20 h-20 shrink-0 rounded-xl overflow-hidden bg-[#e8e8e8] flex items-center justify-center text-[#aaa]">
        {item.album_art_url
          ? <img src={item.album_art_url} alt={item.album_name} className="w-full h-full object-cover" />
          : <Music size={28} />}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2 mb-1">
          <div className="flex items-center gap-2 min-w-0">
            <FriendAvatar name={item.friend.name} avatarUrl={item.friend.avatar_url} size={22} />
            <span className="text-sm font-semibold text-[#111] truncate">{item.friend.name}</span>
          </div>
          {item.date_rated && (
            <span className="text-xs text-[#aaa] shrink-0">{timeAgo(item.date_rated)}</span>
          )}
        </div>

        <p className="text-sm text-[#444] leading-snug mb-3">
          rated{' '}
          <span className="font-medium text-[#111]">{item.album_name}</span>
          {' '}by{' '}
          <span className="font-medium text-[#111]">{item.artist}</span>
          {' '}a{' '}
          <span className="font-bold tabular-nums" style={{ color: scoreColor(item.score) }}>
            {item.score.toFixed(2)}
          </span>
        </p>

        <button
          onClick={handleView}
          className="text-xs font-medium text-[#2d6a4f] hover:text-[#245c43] transition-colors"
        >
          View full rating →
        </button>
      </div>
    </div>
  )
}

function FindPeople() {
  const { activeUser } = useUser()
  const queryClient = useQueryClient()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<UserSearchResult[]>([])
  const [searching, setSearching] = useState(false)
  const [added, setAdded] = useState<Set<number>>(new Set())
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (debounce.current) clearTimeout(debounce.current)
    if (!query.trim()) { setResults([]); return }
    debounce.current = setTimeout(async () => {
      setSearching(true)
      const res = await searchUsers(query, activeUser!.id)
      setResults(res)
      setSearching(false)
    }, 300)
    return () => { if (debounce.current) clearTimeout(debounce.current) }
  }, [query, activeUser])

  async function handleAdd(user: UserSearchResult) {
    await addFriend(activeUser!.id, user.id)
    setAdded(prev => new Set(prev).add(user.id))
    queryClient.invalidateQueries({ queryKey: ['friends'] })
    queryClient.invalidateQueries({ queryKey: ['feed'] })
  }

  return (
    <div className="mb-8">
      <h2 className="text-sm font-semibold text-[#777] mb-3">Find People</h2>
      <div className="relative">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#bbb] pointer-events-none" />
        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search by username…"
          className="w-full pl-8 pr-4 py-2.5 bg-[#f5f5f5] border border-[#e2e2e2] rounded-xl text-sm text-[#111] placeholder:text-[#bbb] focus:outline-none focus:border-[#2d6a4f] transition-colors"
        />
        {searching && <Loader2 size={13} className="absolute right-3 top-1/2 -translate-y-1/2 text-[#bbb] animate-spin" />}
      </div>

      {results.length > 0 && (
        <div className="mt-2 border border-[#e2e2e2] rounded-xl overflow-hidden divide-y divide-[#f0f0f0]">
          {results.map(u => {
            const isFriend = u.already_friends || added.has(u.id)
            return (
              <div key={u.id} className="flex items-center gap-3 px-4 py-3 bg-white">
                <div
                  className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0"
                  style={{ background: '#2d6a4f' }}
                >
                  {u.name[0].toUpperCase()}
                </div>
                <span className="flex-1 text-sm font-medium text-[#111]">{u.name}</span>
                {isFriend ? (
                  <span className="flex items-center gap-1 text-xs text-[#2d6a4f] font-medium">
                    <Check size={13} /> Friends
                  </span>
                ) : (
                  <button
                    onClick={() => handleAdd(u)}
                    className="flex items-center gap-1.5 text-xs font-semibold text-white bg-[#2d6a4f] hover:bg-[#245c43] px-3 py-1.5 rounded-lg transition-colors"
                  >
                    <UserPlus size={12} /> Add
                  </button>
                )}
              </div>
            )
          })}
        </div>
      )}

      {query.trim() && !searching && results.length === 0 && (
        <p className="text-xs text-[#bbb] mt-3 px-1">No users found.</p>
      )}
    </div>
  )
}

export default function Social() {
  const { activeUser } = useUser()

  const { data: feed = [], isLoading } = useQuery({
    queryKey: ['feed', activeUser?.id],
    queryFn: () => fetchFeed(activeUser!.id),
    enabled: !!activeUser,
    staleTime: 60_000,
  })

  return (
    <div className="p-4 md:p-8 max-w-2xl">
      <h1 className="text-xl font-semibold text-[#111] mb-6">Friends' Activity</h1>
      <FindPeople />

      {isLoading ? (
        <div className="flex items-center gap-2 text-[#aaa]">
          <Loader2 size={16} className="animate-spin" /> Loading…
        </div>
      ) : feed.length === 0 ? (
        <div className="text-center py-16">
          <p className="text-[#bbb] text-sm">No activity yet.</p>
          <p className="text-[#ccc] text-xs mt-1">Ratings from your friends will show up here.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {feed.map((item) => (
            <FeedCard key={`${item.friend.id}-${item.album_id}`} item={item} />
          ))}
        </div>
      )}
    </div>
  )
}
