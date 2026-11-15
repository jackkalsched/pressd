// A post's heart (the like, an up-vote) and, beside it, its speech bubble for
// replies. Mirror of mobile/components/VoteButtons. There's no down-vote to give
// (Jack, November 2026): the thread's order still reads stored dislikes, and a
// heart on a post you'd thumbed down replaces that vote.
//
// The count moves on click and rolls back if the write fails, because a vote
// that waits on the network reads as a dead button. The server is the authority
// on what a click means — sending the vote you already hold clears it — so its
// reply replaces the guess rather than being merged with it.
import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Heart, MessageCircle } from 'lucide-react'
import { votePost } from '../api'

// Red when given: the same like the feed's heart gives (a review's like is its
// thread post's up-vote, backend/likes.py).
const UP = 'var(--c-c0392b)'

const pill = (compact: boolean) => `flex items-center gap-1.5 rounded-full transition-colors ${compact ? 'px-2 py-1' : 'px-2.5 py-1.5'}`
const countCls = (compact: boolean) => `${compact ? 'text-[11px]' : 'text-[12px]'} font-medium tabular-nums`

export default function VoteButtons({
  postId, likes, myVote, compact = false, onVoted,
}: {
  postId: number
  likes: number
  myVote: number
  /** Replies sit indented under their parent and get the smaller treatment. */
  compact?: boolean
  onVoted?: () => void
}) {
  const [vote, setVote] = useState(myVote)
  const [up, setUp] = useState(likes)

  // A refetch can land with newer numbers than the optimistic ones. Synced
  // during render rather than in an effect: an effect would paint the stale
  // count first and correct it a frame later.
  const [seen, setSeen] = useState({ myVote, likes })
  if (seen.myVote !== myVote || seen.likes !== likes) {
    setSeen({ myVote, likes })
    setVote(myVote); setUp(likes)
  }

  const queryClient = useQueryClient()
  async function like() {
    const prev = { vote, up }
    const next = vote === 1 ? 0 : 1
    setVote(next)
    setUp(up + (next === 1 ? 1 : -1))
    try {
      const r = await votePost(postId, 1)
      setVote(r.myVote); setUp(r.likeCount)
      // An up-vote on a review is its like in the feeds: refresh them (not the
      // thread itself, whose order would jump under the reader).
      for (const queryKey of [['feed'], ['top-reviews'], ['friend-reviews']]) queryClient.invalidateQueries({ queryKey })
      onVoted?.()
    } catch {
      setVote(prev.vote); setUp(prev.up)
    }
  }

  const liked = vote === 1
  return (
    <button
      type="button"
      onClick={like}
      aria-label={`Like, ${up}`}
      aria-pressed={liked}
      className={`${pill(compact)} ${liked ? 'bg-(--c-c0392b)/10' : 'bg-(--c-f5f5f5) hover:bg-(--c-ececec)'}`}
    >
      {/* Keyed on the state so turning it on replays the pop. */}
      <Heart key={`u${liked}`} className={liked ? 'pop' : undefined} size={compact ? 13 : 15} color={liked ? UP : 'var(--c-a8998a)'} fill={liked ? UP : 'transparent'} />
      <span className={countCls(compact)} style={{ color: liked ? UP : 'var(--c-666)' }}>{up}</span>
    </button>
  )
}

/** A post's replies: the bubble and how many. Green while they're open. */
export function ReplyBubble({ count, open, onClick }: { count: number; open: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={count > 0 ? `${count} ${count === 1 ? 'reply' : 'replies'}` : 'Reply'}
      aria-expanded={count > 0 ? open : undefined}
      className={`${pill(false)} ${open ? 'bg-(--c-2d6a4f)/10' : 'bg-(--c-f5f5f5) hover:bg-(--c-ececec)'}`}
    >
      <MessageCircle size={15} color={open ? 'var(--c-2d6a4f)' : 'var(--c-a8998a)'} />
      <span className={countCls(false)} style={{ color: open ? 'var(--c-2d6a4f)' : 'var(--c-666)' }}>{count}</span>
    </button>
  )
}
