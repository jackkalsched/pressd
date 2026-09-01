// Thumbs up and thumbs down on one post.
//
// The counts move on tap and roll back if the write fails, because a vote that
// waits on the network reads as a dead button. The server is the authority on
// what a tap means — pressing the vote you already hold clears it — so the
// reply it sends replaces the guess rather than being merged with it.
import { useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import * as Haptics from 'expo-haptics'
import { ThumbsDown, ThumbsUp } from 'lucide-react-native'
import { votePost } from '../lib/api'
import { colors, fonts, radii, spacing } from '../theme/tokens'

const UP = '#2d6a4f'
const DOWN = '#c0392b'

export default function VoteButtons({
  postId,
  likes,
  dislikes,
  myVote,
  compact = false,
}: {
  postId: number
  likes: number
  dislikes: number
  myVote: number
  /** Replies sit indented under their parent and get the smaller treatment. */
  compact?: boolean
}) {
  const [vote, setVote] = useState(myVote)
  const [up, setUp] = useState(likes)
  const [down, setDown] = useState(dislikes)

  // A refetch can land with newer numbers than the optimistic ones. Adjusted
  // during render rather than in an effect: an effect would paint the stale
  // count first and correct it a frame later, and the sync is a pure function
  // of props that already changed.
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
    Haptics.selectionAsync().catch(() => {})
    try {
      const r = await votePost(postId, value)
      setVote(r.myVote); setUp(r.likeCount); setDown(r.dislikeCount)
    } catch {
      setVote(prev.vote); setUp(prev.up); setDown(prev.down)
    }
  }

  const size = compact ? 14 : 16
  return (
    <View style={styles.row}>
      <Pressable
        onPress={() => cast(1)}
        hitSlop={{ top: 10, bottom: 10, left: 8, right: 8 }}
        accessibilityRole="button"
        accessibilityLabel={`Thumbs up, ${up}`}
        accessibilityState={{ selected: vote === 1 }}
        style={({ pressed }) => [styles.btn, compact && styles.btnCompact,
          vote === 1 && styles.onUp, pressed && { opacity: 0.6 }]}
      >
        <ThumbsUp size={size} color={vote === 1 ? UP : colors.inkTertiary}
          fill={vote === 1 ? UP : 'transparent'} />
        <Text style={[styles.count, compact && styles.countCompact, vote === 1 && { color: UP }]}>{up}</Text>
      </Pressable>

      <Pressable
        onPress={() => cast(-1)}
        hitSlop={{ top: 10, bottom: 10, left: 8, right: 8 }}
        accessibilityRole="button"
        accessibilityLabel={`Thumbs down, ${down}`}
        accessibilityState={{ selected: vote === -1 }}
        style={({ pressed }) => [styles.btn, compact && styles.btnCompact,
          vote === -1 && styles.onDown, pressed && { opacity: 0.6 }]}
      >
        <ThumbsDown size={size} color={vote === -1 ? DOWN : colors.inkTertiary}
          fill={vote === -1 ? DOWN : 'transparent'} />
        <Text style={[styles.count, compact && styles.countCompact, vote === -1 && { color: DOWN }]}>{down}</Text>
      </Pressable>
    </View>
  )
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  btn: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingVertical: 6, paddingHorizontal: 10,
    borderRadius: radii.pill, backgroundColor: colors.inset,
  },
  btnCompact: { paddingVertical: 4, paddingHorizontal: 8 },
  onUp: { backgroundColor: 'rgba(45, 106, 79, 0.12)' },
  onDown: { backgroundColor: 'rgba(192, 57, 43, 0.10)' },
  count: { fontFamily: fonts.bodyMedium, fontSize: 12, color: colors.inkSecondary },
  countCompact: { fontSize: 11 },
})
