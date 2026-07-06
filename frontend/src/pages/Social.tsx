import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Loader2, Music, Search, UserPlus, Check, Heart, X, Clock, MessageCircle, Star, BookOpen } from 'lucide-react'
import {
  fetchFeed, searchUsers, addFriend, toggleLike,
  fetchFriendRequests, acceptFriendRequest, declineFriendRequest,
  fetchFriendReviews,
} from '../api'
import type { FeedItem, UserSearchResult, FriendReview } from '../api'
import { useUser } from '../context/UserContext'
import CommentThread from '../components/CommentThread'

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
  const { activeUser, setViewingUser } = useUser()
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const isRec = item.type === 'recommendation'
  const isReview = item.type === 'review'
  const [liked, setLiked] = useState(!!item.liked_by_me)
  const [likeCount, setLikeCount] = useState(item.like_count ?? 0)
  const [liking, setLiking] = useState(false)
  const [showComments, setShowComments] = useState(false)

  function handleView() {
    if (isRec) {
      // A recommendation lands in your own library — view it as yourself.
      navigate(`/album/${item.album_id}`)
    } else {
      setViewingUser({ id: item.friend.id, name: item.friend.name, avatarUrl: item.friend.avatar_url })
      navigate(`/album/${item.album_id}`)
    }
  }

  async function handleLike() {
    if (!activeUser || liking) return
    setLiking(true)
    // optimistic update
    const wasLiked = liked
    setLiked(!wasLiked)
    setLikeCount(c => wasLiked ? c - 1 : c + 1)
    try {
      await toggleLike(activeUser.id, item.album_id)
      queryClient.invalidateQueries({ queryKey: ['feed'] })
    } catch {
      // revert
      setLiked(wasLiked)
      setLikeCount(c => wasLiked ? c + 1 : c - 1)
    } finally {
      setLiking(false)
    }
  }

  const timestamp = isRec ? item.recommended_at : isReview ? item.review_at : item.date_rated

  return (
    <div className="bg-white border border-[#e2e2e2] rounded-2xl p-5 hover:border-[#c8c8c8] transition-colors self-start">
      <div className="flex gap-5">
        {/* Album art */}
        <div className="w-24 h-24 shrink-0 rounded-xl overflow-hidden bg-[#e8e8e8] flex items-center justify-center text-[#aaa]">
          {item.album_art_url
            ? <img src={item.album_art_url} alt={item.album_name} className="w-full h-full object-cover" />
            : <Music size={30} />}
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2 mb-1">
            <div className="flex items-center gap-2 min-w-0">
              <FriendAvatar name={item.friend.name} avatarUrl={item.friend.avatar_url} size={22} />
              <span className="text-sm font-semibold text-[#111] truncate">{item.friend.name}</span>
            </div>
            {timestamp && (
              <span className="text-xs text-[#aaa] shrink-0">{timeAgo(timestamp)}</span>
            )}
          </div>

          {isRec ? (
            <p className="text-sm text-[#444] leading-snug mb-3 flex items-start gap-1.5">
              <Star size={13} className="text-[#ea7a2a] shrink-0 mt-0.5" fill="#ea7a2a" strokeWidth={0} />
              <span>
                recommended{' '}
                <span className="font-medium text-[#111]">{item.album_name}</span>
                {' '}by{' '}
                <span className="font-medium text-[#111]">{item.artist}</span>
                {' '}to you
              </span>
            </p>
          ) : isReview ? (
            <>
              <p className="text-sm text-[#444] leading-snug mb-2 flex items-start gap-1.5">
                <BookOpen size={13} className="text-[#2d6a4f] shrink-0 mt-0.5" strokeWidth={2} />
                <span>
                  reviewed{' '}
                  <span className="font-medium text-[#111]">{item.album_name}</span>
                  {' '}by{' '}
                  <span className="font-medium text-[#111]">{item.artist}</span>
                  {item.score != null && (
                    <>
                      {' · '}
                      <span className="font-bold tabular-nums" style={{ color: scoreColor(item.score) }}>
                        {item.score.toFixed(2)}
                      </span>
                    </>
                  )}
                </span>
              </p>
              {item.review_excerpt && (
                <p className="text-[13px] text-[#555] leading-relaxed mb-3 italic border-l-2 border-[#e2e2e2] pl-3">
                  {item.review_excerpt}
                </p>
              )}
            </>
          ) : (
            <p className="text-sm text-[#444] leading-snug mb-3">
              rated{' '}
              <span className="font-medium text-[#111]">{item.album_name}</span>
              {' '}by{' '}
              <span className="font-medium text-[#111]">{item.artist}</span>
              {' '}a{' '}
              <span className="font-bold tabular-nums" style={{ color: scoreColor(item.score ?? 0) }}>
                {(item.score ?? 0).toFixed(2)}
              </span>
            </p>
          )}

          <div className="flex items-center justify-between">
            <button
              onClick={handleView}
              className="text-xs font-medium text-[#2d6a4f] hover:text-[#245c43] transition-colors"
            >
              {isRec ? 'View album →' : isReview ? 'Read full review →' : 'View full rating →'}
            </button>

            {!isRec && (
              <div className="flex items-center gap-4">
                <button
                  onClick={() => setShowComments(s => !s)}
                  className={`flex items-center gap-1.5 text-xs font-medium transition-colors ${
                    showComments ? 'text-[#2d6a4f]' : 'text-[#bbb] hover:text-[#2d6a4f]'
                  }`}
                  aria-label="Comments"
                >
                  <MessageCircle size={14} strokeWidth={1.75} />
                  {(item.comment_count ?? 0) > 0 && <span>{item.comment_count}</span>}
                </button>

                <button
                  onClick={handleLike}
                  disabled={liking}
                  className={`flex items-center gap-1.5 text-xs font-medium transition-colors ${
                    liked ? 'text-[#e05555]' : 'text-[#bbb] hover:text-[#e05555]'
                  }`}
                  aria-label={liked ? 'Unlike' : 'Like'}
                >
                  <Heart
                    size={14}
                    className="transition-transform active:scale-125"
                    fill={liked ? 'currentColor' : 'none'}
                    strokeWidth={liked ? 0 : 1.75}
                  />
                  {likeCount > 0 && <span>{likeCount}</span>}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {!isRec && showComments && (
        <div className="mt-3 pt-3 border-t border-[#f0f0f0]">
          <CommentThread albumId={item.album_id} />
        </div>
      )}
    </div>
  )
}

function FriendRequests() {
  const { activeUser } = useUser()
  const queryClient = useQueryClient()
  const [busy, setBusy] = useState<Set<number>>(new Set())

  const { data } = useQuery({
    queryKey: ['friend-requests', activeUser?.id],
    queryFn: () => fetchFriendRequests(activeUser!.id),
    enabled: !!activeUser,
    staleTime: 30_000,
  })
  const incoming = data?.incoming ?? []
  const outgoing = data?.outgoing ?? []
  if (incoming.length === 0 && outgoing.length === 0) return null

  function refresh() {
    queryClient.invalidateQueries({ queryKey: ['friend-requests'] })
    queryClient.invalidateQueries({ queryKey: ['friends'] })
    queryClient.invalidateQueries({ queryKey: ['feed'] })
  }

  async function act(otherId: number, fn: (uid: number, oid: number) => Promise<void>) {
    if (busy.has(otherId)) return
    setBusy(prev => new Set(prev).add(otherId))
    try {
      await fn(activeUser!.id, otherId)
      refresh()
    } finally {
      setBusy(prev => { const n = new Set(prev); n.delete(otherId); return n })
    }
  }

  return (
    <div className="mb-8">
      <h2 className="text-sm font-semibold text-[#777] mb-3">Friend Requests</h2>
      <div className="border border-[#e2e2e2] rounded-xl overflow-hidden divide-y divide-[#f0f0f0]">
        {incoming.map(u => (
          <div key={`in-${u.id}`} className="flex items-center gap-3 px-4 py-3 bg-white">
            <FriendAvatar name={u.name} avatarUrl={u.avatarUrl} size={32} />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-[#111] truncate">{u.name}</p>
              <p className="text-[11px] text-[#aaa]">wants to be friends</p>
            </div>
            <button
              onClick={() => act(u.id, acceptFriendRequest)}
              disabled={busy.has(u.id)}
              className="flex items-center gap-1 text-xs font-semibold text-white bg-[#2d6a4f] hover:bg-[#245c43] px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50"
            >
              <Check size={12} /> Accept
            </button>
            <button
              onClick={() => act(u.id, declineFriendRequest)}
              disabled={busy.has(u.id)}
              className="flex items-center gap-1 text-xs font-medium text-[#999] hover:text-[#c0392b] px-2 py-1.5 transition-colors disabled:opacity-50"
              aria-label="Decline"
            >
              <X size={14} />
            </button>
          </div>
        ))}
        {outgoing.map(u => (
          <div key={`out-${u.id}`} className="flex items-center gap-3 px-4 py-3 bg-white">
            <FriendAvatar name={u.name} avatarUrl={u.avatarUrl} size={32} />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-[#111] truncate">{u.name}</p>
              <p className="text-[11px] text-[#aaa] flex items-center gap-1"><Clock size={10} /> request sent</p>
            </div>
            <button
              onClick={() => act(u.id, declineFriendRequest)}
              disabled={busy.has(u.id)}
              className="text-xs font-medium text-[#999] hover:text-[#c0392b] px-2 py-1.5 transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        ))}
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
  const [sent, setSent] = useState<Set<number>>(new Set())
  const [becameFriends, setBecameFriends] = useState<Set<number>>(new Set())
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
    const r = await addFriend(activeUser!.id, user.id)
    if (r.status === 'accepted') {
      setBecameFriends(prev => new Set(prev).add(user.id))
    } else {
      setSent(prev => new Set(prev).add(user.id))
    }
    queryClient.invalidateQueries({ queryKey: ['friends'] })
    queryClient.invalidateQueries({ queryKey: ['feed'] })
    queryClient.invalidateQueries({ queryKey: ['friend-requests'] })
  }

  return (
    <div className="relative w-44 sm:w-64 md:w-72 shrink-0">
      <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#bbb] pointer-events-none" />
      <input
        value={query}
        onChange={e => setQuery(e.target.value)}
        placeholder="Find people…"
        className="w-full pl-8 pr-8 py-2.5 bg-[#f5f5f5] border border-[#e2e2e2] rounded-xl text-sm text-[#111] placeholder:text-[#bbb] focus:outline-none focus:border-[#2d6a4f] transition-colors"
      />
      {searching && <Loader2 size={13} className="absolute right-3 top-1/2 -translate-y-1/2 text-[#bbb] animate-spin" />}

      {results.length > 0 && (
        <div className="absolute top-full right-0 mt-2 w-80 max-w-[90vw] bg-white border border-[#e2e2e2] rounded-xl overflow-hidden divide-y divide-[#f0f0f0] shadow-lg z-20">
          {results.map(u => {
            const isFriend = u.already_friends || becameFriends.has(u.id)
            const requested = !isFriend && (u.request_sent || sent.has(u.id))
            const theyAsked = !isFriend && !requested && u.request_received
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
                ) : requested ? (
                  <span className="flex items-center gap-1 text-xs text-[#aaa] font-medium">
                    <Clock size={12} /> Requested
                  </span>
                ) : (
                  <button
                    onClick={() => handleAdd(u)}
                    className="flex items-center gap-1.5 text-xs font-semibold text-white bg-[#2d6a4f] hover:bg-[#245c43] px-3 py-1.5 rounded-lg transition-colors"
                  >
                    {theyAsked ? <><Check size={12} /> Accept</> : <><UserPlus size={12} /> Add</>}
                  </button>
                )}
              </div>
            )
          })}
        </div>
      )}

      {query.trim() && !searching && results.length === 0 && (
        <div className="absolute top-full right-0 mt-2 w-80 max-w-[90vw] bg-white border border-[#e2e2e2] rounded-xl px-4 py-3 shadow-lg z-20">
          <p className="text-xs text-[#bbb]">No users found.</p>
        </div>
      )}
    </div>
  )
}

function ReviewCard({ review }: { review: FriendReview }) {
  const { activeUser, setViewingUser } = useUser()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [liked, setLiked] = useState(review.liked_by_me)
  const [likeCount, setLikeCount] = useState(review.like_count)
  const [liking, setLiking] = useState(false)
  const [showComments, setShowComments] = useState(false)
  const [expanded, setExpanded] = useState(false)

  const isLong = review.review.length > 420
  const shown = isLong && !expanded ? review.review.slice(0, 420).trimEnd() + '…' : review.review

  function handleView() {
    setViewingUser({ id: review.friend.id, name: review.friend.name, avatarUrl: review.friend.avatar_url })
    navigate(`/album/${review.album_id}`)
  }

  async function handleLike() {
    if (!activeUser || liking) return
    setLiking(true)
    const wasLiked = liked
    setLiked(!wasLiked)
    setLikeCount(c => wasLiked ? c - 1 : c + 1)
    try {
      await toggleLike(activeUser.id, review.album_id)
      queryClient.invalidateQueries({ queryKey: ['friend-reviews'] })
    } catch {
      setLiked(wasLiked)
      setLikeCount(c => wasLiked ? c + 1 : c - 1)
    } finally {
      setLiking(false)
    }
  }

  return (
    <div className="bg-white border border-[#e2e2e2] rounded-2xl p-5 hover:border-[#c8c8c8] transition-colors self-start">
      <div className="flex gap-4 mb-3">
        <div className="w-16 h-16 shrink-0 rounded-lg overflow-hidden bg-[#e8e8e8] flex items-center justify-center text-[#aaa]">
          {review.album_art_url
            ? <img src={review.album_art_url} alt={review.album_name} className="w-full h-full object-cover" />
            : <Music size={22} />}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 min-w-0">
            <FriendAvatar name={review.friend.name} avatarUrl={review.friend.avatar_url} size={20} />
            <span className="text-sm font-semibold text-[#111] truncate">{review.friend.name}</span>
            {review.review_at && <span className="text-xs text-[#aaa] shrink-0 ml-auto">{timeAgo(review.review_at)}</span>}
          </div>
          <p className="text-xs text-[#666] mt-1 truncate">
            <span className="font-medium text-[#111]">{review.album_name}</span>
            {' · '}{review.artist}
            {review.score != null && (
              <>{' · '}<span className="font-bold tabular-nums" style={{ color: scoreColor(review.score) }}>{review.score.toFixed(2)}</span></>
            )}
          </p>
        </div>
      </div>

      <p className="text-[13px] text-[#3c3530] leading-relaxed whitespace-pre-wrap break-words mb-1">{shown}</p>
      {isLong && (
        <button onClick={() => setExpanded(e => !e)} className="text-xs font-medium text-[#2d6a4f] hover:text-[#245c43] mb-2">
          {expanded ? 'Show less' : 'Read more'}
        </button>
      )}

      <div className="flex items-center justify-between mt-2">
        <button onClick={handleView} className="text-xs font-medium text-[#2d6a4f] hover:text-[#245c43] transition-colors">
          View album →
        </button>
        <div className="flex items-center gap-4">
          <button
            onClick={() => setShowComments(s => !s)}
            className={`flex items-center gap-1.5 text-xs font-medium transition-colors ${showComments ? 'text-[#2d6a4f]' : 'text-[#bbb] hover:text-[#2d6a4f]'}`}
            aria-label="Comments"
          >
            <MessageCircle size={14} strokeWidth={1.75} />
            {review.comment_count > 0 && <span>{review.comment_count}</span>}
          </button>
          <button
            onClick={handleLike}
            disabled={liking}
            className={`flex items-center gap-1.5 text-xs font-medium transition-colors ${liked ? 'text-[#e05555]' : 'text-[#bbb] hover:text-[#e05555]'}`}
            aria-label={liked ? 'Unlike' : 'Like'}
          >
            <Heart size={14} className="transition-transform active:scale-125" fill={liked ? 'currentColor' : 'none'} strokeWidth={liked ? 0 : 1.75} />
            {likeCount > 0 && <span>{likeCount}</span>}
          </button>
        </div>
      </div>

      {showComments && (
        <div className="mt-3 pt-3 border-t border-[#f0f0f0]">
          <CommentThread albumId={review.album_id} />
        </div>
      )}
    </div>
  )
}

function ReviewsTab() {
  const { activeUser } = useUser()
  const [sort, setSort] = useState<'recent' | 'top'>('recent')

  const { data: reviews = [], isLoading } = useQuery({
    queryKey: ['friend-reviews', sort, activeUser?.id],
    queryFn: () => fetchFriendReviews(sort),
    enabled: !!activeUser,
    staleTime: 60_000,
  })

  const sortBtn = (key: 'recent' | 'top', label: string) => (
    <button
      onClick={() => setSort(key)}
      className={`text-xs font-medium px-3 py-1.5 rounded-full transition-colors ${
        sort === key ? 'bg-[#2d6a4f] text-white' : 'bg-[#f0f0f0] text-[#777] hover:bg-[#e8e8e8]'
      }`}
    >
      {label}
    </button>
  )

  return (
    <div>
      <div className="flex items-center gap-2 mb-4">
        {sortBtn('recent', 'Recent')}
        {sortBtn('top', 'Most liked')}
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 text-[#aaa]">
          <Loader2 size={16} className="animate-spin" /> Loading…
        </div>
      ) : reviews.length === 0 ? (
        <div className="text-center py-16">
          <p className="text-[#bbb] text-sm">No reviews yet.</p>
          <p className="text-[#ccc] text-xs mt-1">When your friends write reviews, they'll show up here.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 items-start">
          {reviews.map(r => <ReviewCard key={r.album_id} review={r} />)}
        </div>
      )}
    </div>
  )
}

export default function Social() {
  const { activeUser } = useUser()
  const [tab, setTab] = useState<'activity' | 'reviews'>('activity')

  const { data: feed = [], isLoading } = useQuery({
    queryKey: ['feed', activeUser?.id],
    queryFn: () => fetchFeed(activeUser!.id),
    enabled: !!activeUser,
    staleTime: 60_000,
  })

  const tabBtn = (key: 'activity' | 'reviews', label: string) => (
    <button
      onClick={() => setTab(key)}
      className={`text-sm font-semibold px-1 py-2 border-b-2 transition-colors ${
        tab === key ? 'border-[#2d6a4f] text-[#111]' : 'border-transparent text-[#999] hover:text-[#555]'
      }`}
    >
      {label}
    </button>
  )

  return (
    <div className="p-4 md:p-8">
      <div className="flex items-center justify-between gap-3 mb-6">
        <h1 className="font-display text-3xl font-bold text-[#111]">Friends</h1>
        <FindPeople />
      </div>
      <div className="max-w-lg">
        <FriendRequests />
      </div>

      <div className="flex items-center gap-5 border-b border-[#eee] mb-6">
        {tabBtn('activity', 'Activity')}
        {tabBtn('reviews', 'Reviews')}
      </div>

      {tab === 'reviews' ? (
        <ReviewsTab />
      ) : isLoading ? (
        <div className="flex items-center gap-2 text-[#aaa]">
          <Loader2 size={16} className="animate-spin" /> Loading…
        </div>
      ) : feed.length === 0 ? (
        <div className="text-center py-16">
          <p className="text-[#bbb] text-sm">No activity yet.</p>
          <p className="text-[#ccc] text-xs mt-1">Ratings, reviews, and recommendations from your friends will show up here.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 items-start">
          {feed.map((item) => (
            <FeedCard key={`${item.type}-${item.friend.id}-${item.album_id}`} item={item} />
          ))}
        </div>
      )}
    </div>
  )
}
