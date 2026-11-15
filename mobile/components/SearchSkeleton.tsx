// What search shows while it's answering: grey rows in the results' own shape —
// a cover or face and two lines — pulsing softly, instead of a spinner (Jack,
// November 2026). Still under Reduce Motion. Web's components/SearchSkeleton.tsx
// is the same idea.
import { useEffect, useState } from 'react'
import { AccessibilityInfo, Animated, Easing, StyleSheet, View } from 'react-native'
import { colors, radii, spacing } from '../theme/tokens'

const COVER = 48 // app/search.tsx's row cover

function usePulse() {
  const [v] = useState(() => new Animated.Value(1))
  useEffect(() => {
    let loop: Animated.CompositeAnimation | null = null
    let cancelled = false
    AccessibilityInfo.isReduceMotionEnabled().then((reduce) => {
      if (cancelled || reduce) return
      loop = Animated.loop(Animated.sequence([
        Animated.timing(v, { toValue: 0.45, duration: 700, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(v, { toValue: 1, duration: 700, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ]))
      loop.start()
    }).catch(() => {})
    return () => { cancelled = true; loop?.stop() }
  }, [v])
  return v
}

/** `count` placeholder rows; `round` for people. */
export function SkeletonRows({ count = 4, round = false }: { count?: number; round?: boolean }) {
  const opacity = usePulse()
  return (
    <Animated.View style={{ opacity }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {Array.from({ length: count }, (_, i) => (
        <View key={i} style={styles.row}>
          <View style={[styles.cover, round && styles.round]} />
          <View style={styles.text}>
            <View style={[styles.line, { width: `${72 - (i % 3) * 14}%` }]} />
            <View style={[styles.lineSmall, { width: `${46 - (i % 2) * 10}%` }]} />
          </View>
        </View>
      ))}
    </Animated.View>
  )
}

/** The whole results page before its first answer: a few groups' worth. */
export default function SearchSkeleton() {
  const opacity = usePulse()
  return (
    <View accessibilityRole="progressbar" accessibilityLabel="Searching">
      {[true, false, false].map((round, i) => (
        <View key={i} style={styles.section}>
          <Animated.View style={[styles.heading, { opacity }]} />
          <SkeletonRows count={i === 0 ? 2 : 3} round={round} />
        </View>
      ))}
    </View>
  )
}

const styles = StyleSheet.create({
  section: { marginTop: spacing.lg },
  heading: { width: 84, height: 11, borderRadius: 6, backgroundColor: colors.inset, marginBottom: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: 6 },
  cover: { width: COVER, height: COVER, borderRadius: radii.sm, backgroundColor: colors.inset },
  round: { borderRadius: COVER / 2 },
  text: { flex: 1, minWidth: 0, gap: 8 },
  line: { height: 12, borderRadius: 6, backgroundColor: colors.inset },
  lineSmall: { height: 10, borderRadius: 5, backgroundColor: colors.inset },
})
