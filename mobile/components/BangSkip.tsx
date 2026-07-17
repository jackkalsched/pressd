// BANG / SKIP tag for a song score. A song at or above the bang threshold is a
// standout; below the skip threshold it's one you'd skip. Colored in the
// score's own gradient hue, matching the web track list.
import { StyleSheet, Text } from 'react-native'
import { songScoreColor, BANG_THRESHOLD, SKIP_THRESHOLD } from '@pressd/shared/types'
import { fonts } from '../theme/tokens'

export default function BangSkip({ score }: { score: number | null }) {
  if (score == null) return null
  const label = score >= BANG_THRESHOLD ? 'BANG' : score < SKIP_THRESHOLD ? 'SKIP' : null
  if (!label) return null
  return <Text style={[styles.tag, { color: songScoreColor(score) }]}>{label}</Text>
}

const styles = StyleSheet.create({
  tag: { fontFamily: fonts.bodyBold, fontSize: 9, letterSpacing: 1 },
})
