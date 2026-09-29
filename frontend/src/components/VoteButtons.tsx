// Thumbs up and thumbs down on one post. Mirror of mobile/components/VoteButtons.
//
// The counts move on click and roll back if the write fails, because a vote
// that waits on the network reads as a dead button. The server is the authority
// on what a click means — sending the vote you already hold clears it — so its
// reply replaces the guess rather than being merged with it.
import { useState } from 'react'
import { ThumbsDown, ThumbsUp } from 'lucide-react'
import { votePost } from '../api'

const UP = '#2d6a4f'
const DOWN = '#c0392b'

export default function VoteButtons({
  postId, likes, dislikes, myVote, compact = false, onVoted,
}: {
  postId: number
  likes: number
  dislikes: number
  myVote: number
  /** Replies sit indented under their parent and get the smaller treatment. */
  compact?: boolean
  onVoted?: () => void
}) {
  const [vote, setVote] = useState(myVote)
  const [up, setUp] = useState(likes)
  const [down, setDown] = useState(dislikes)

  // A refetch can land with newer numbers than the optimistic ones. Synced
  // during render rather than in an effect: an effect would paint the stale
  // count first and correct it a frame later, and this is a pure function of
  // props that already changed.
  const [seen, setSeen] = useState({ myVote, likes, dislikes })
  if (seen.myVote !== myVote || seen.likes !== likes || seen.dislikes !== dislikes) {
    setSeen({ myVote, likes, dislikes })
    setVote(myVote); setUp(likes); setDown(dislikes)
  }

  async function cast(value: 1 | -1) {
    const prev = { vote, up, down }
    const next = vote === value ? 0 : value
    setVote(next)
    setUp(up - (vote === 1 ? 1 : 0) + (next === 1 ? 1 : 0))
    setDown(down - (vote === -1 ? 1 : 0) + (next === -1 ? 1 : 0))
    try {
      const r = await votePost(postId, value)
      setVote(r.myVote); setUp(r.likeCount); setDown(r.dislikeCount)
      onVoted?.()
    } catch {
      setVote(prev.vote); setUp(prev.up); setDown(prev.down)
    }
  }

  const size = compact ? 13 : 15
  const pad = compact ? 'px-2 py-1' : 'px-2.5 py-1.5'
  const countSize = compact ? 'text-[11px]' : 'text-[12px]'

  return (
    <div className="flex items-center gap-1.5">
      <button
        type="button"
        onClick={() => cast(1)}
        aria-label={`Thumbs up, ${up}`}
        aria-pressed={vote === 1}
        className={`flex items-center gap-1.5 rounded-full transition-colors ${pad} ${
          vote === 1 ? 'bg-[#2d6a4f]/12' : 'bg-[#f5f5f5] hover:bg-[#ececec]'
        }`}
      >
        {/* Keyed on the state so turning it on replays the pop. */}
        <ThumbsUp key={`u${vote === 1}`} className={vote === 1 ? 'pop' : undefined} size={size} color={vote === 1 ? UP : '#a8998a'} fill={vote === 1 ? UP : 'transparent'} />
        <span className={`${countSize} font-medium tabular-nums`} style={{ color: vote === 1 ? UP : '#666' }}>{up}</span>
      </button>

      <button
        type="button"
        onClick={() => cast(-1)}
        aria-label={`Thumbs down, ${down}`}
        aria-pressed={vote === -1}
        className={`flex items-center gap-1.5 rounded-full transition-colors ${pad} ${
          vote === -1 ? 'bg-[#c0392b]/10' : 'bg-[#f5f5f5] hover:bg-[#ececec]'
        }`}
      >
        <ThumbsDown key={`d${vote === -1}`} className={vote === -1 ? 'pop' : undefined} size={size} color={vote === -1 ? DOWN : '#a8998a'} fill={vote === -1 ? DOWN : 'transparent'} />
        <span className={`${countSize} font-medium tabular-nums`} style={{ color: vote === -1 ? DOWN : '#666' }}>{down}</span>
      </button>
    </div>
  )
}
