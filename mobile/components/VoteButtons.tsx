// A post's heart (the like, an up-vote) and, beside it, its speech bubble for
// replies. Mirror of frontend/src/components/VoteButtons. There's no down-vote
// to give (Jack, November 2026): the thread's order still reads stored
// dislikes, and a heart on a post you'd thumbed down replaces that vote.
//
// The count moves on tap and rolls back if the write fails, because a vote that
// waits on the network reads as a dead button. The server is the authority on
// what a tap means — pressing the vote you already hold clears it — so the
// reply it sends replaces the guess rather than being merged with it.
import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Pressable, StyleSheet, Text } from 'react-native'
import * as haptics from '../lib/haptics'
import { Heart, MessageCircle } from 'lucide-react-native'
import { votePost } from '../lib/api'
import { colors, fonts, radii, useColors } from '../theme/tokens'

// Red when given: the same like the feed's heart gives (a review's like is its
// thread post's up-vote, backend/likes.py).
const UP = '#c0392b'

export default function VoteButtons({
  postId,
  likes,
  myVote,
  compact = false,
}: {
  postId: number
  likes: number
  myVote: number
  /** Replies sit indented under their parent and get the smaller treatment. */
  compact?: boolean
}) {
  const tc = useColors()
  const [vote, setVote] = useState(myVote)
  const [up, setUp] = useState(likes)

  // A refetch can land with newer numbers than the optimistic ones. Adjusted
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
    haptics.selection()
    try {
      const r = await votePost(postId, 1)
      setVote(r.myVote); setUp(r.likeCount)
      // An up-vote on a review is its like in the feeds: refresh them (not the
      // thread itself, whose order would jump under the reader).
      for (const queryKey of [['feed'], ['top-reviews'], ['friend-reviews']]) queryClient.invalidateQueries({ queryKey })
    } catch {
      setVote(prev.vote); setUp(prev.up)
    }
  }

  const liked = vote === 1
  return (
    <Pressable
      onPress={like}
      hitSlop={{ top: 10, bottom: 10, left: 8, right: 8 }}
      accessibilityRole="button"
      accessibilityLabel={`Like, ${up}`}
      accessibilityState={{ selected: liked }}
      style={({ pressed }) => [styles.btn, compact && styles.btnCompact, liked && styles.onUp, pressed && { opacity: 0.6 }]}
    >
      <Heart size={compact ? 14 : 16} color={liked ? UP : tc.inkTertiary} fill={liked ? UP : 'transparent'} />
      <Text style={[styles.count, compact && styles.countCompact, liked && { color: UP }]}>{up}</Text>
    </Pressable>
  )
}

/** A post's replies: the bubble and how many. Green while they're open. */
export function ReplyBubble({ count, open, onPress }: { count: number; open: boolean; onPress: () => void }) {
  const tc = useColors()
  return (
    <Pressable
      onPress={onPress}
      hitSlop={{ top: 10, bottom: 10, left: 8, right: 8 }}
      accessibilityRole="button"
      accessibilityLabel={count > 0 ? `${count} ${count === 1 ? 'reply' : 'replies'}` : 'Reply'}
      accessibilityState={{ expanded: count > 0 ? open : undefined }}
      style={({ pressed }) => [styles.btn, open && styles.onOpen, pressed && { opacity: 0.6 }]}
    >
      <MessageCircle size={16} color={open ? tc.green : tc.inkTertiary} />
      <Text style={[styles.count, open && { color: colors.green }]}>{count}</Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  btn: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingVertical: 6, paddingHorizontal: 10,
    borderRadius: radii.pill, backgroundColor: colors.inset,
  },
  btnCompact: { paddingVertical: 4, paddingHorizontal: 8 },
  onUp: { backgroundColor: 'rgba(192, 57, 43, 0.10)' },
  onOpen: { backgroundColor: colors.greenSoft },
  count: { fontFamily: fonts.bodyMedium, fontSize: 12, color: colors.inkSecondary },
  countCompact: { fontSize: 11 },
})
