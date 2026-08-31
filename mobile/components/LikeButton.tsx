// The like control, shared by the Social feed and For You.
//
// It was a bare 15pt heart with hitSlop 6 — a ~27pt target against Apple's
// 44pt minimum — tinted the same grey as the text beside it, with no press
// feedback. It read as a label that happened to have an icon, and people
// missed it or thought the tap had not registered.
//
// Three changes, in order of how much they matter:
//   1. a real tap target, padded out to 44pt without moving the layout
//   2. a filled pill once liked, so state is legible at a glance
//   3. a spring on the heart, so a tap is visibly acknowledged
//
// The count moves optimistically. A like is a one-byte opinion; waiting for a
// round trip to redraw it is what made this feel unresponsive on a slow
// connection, and the parent still reconciles from the server afterwards.
import { useEffect, useRef, useState } from 'react'
import { Animated, Pressable, StyleSheet, Text } from 'react-native'
import * as Haptics from 'expo-haptics'
import { Heart } from 'lucide-react-native'
import { colors, fonts, radii, spacing, NUM_SCALE_CAP } from '../theme/tokens'

const LIKED = '#c0392b'

export default function LikeButton({
  liked,
  count,
  onToggle,
  size = 15,
}: {
  liked: boolean
  count: number
  /** Fire-and-forget; the parent refetches. Errors roll the optimism back. */
  onToggle: () => Promise<unknown> | void
  size?: number
}) {
  // Local mirror so the tap paints immediately, resynced whenever the server
  // answer arrives and changes what the parent passes down.
  const [on, setOn] = useState(liked)
  const [n, setN] = useState(count)
  useEffect(() => { setOn(liked); setN(count) }, [liked, count])

  const scale = useRef(new Animated.Value(1)).current

  function press() {
    const next = !on
    setOn(next)
    setN((c) => Math.max(0, c + (next ? 1 : -1)))

    // Only on the way in. A pop when you *un*like reads as the app celebrating
    // a thing you just took back.
    if (next) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {})
      scale.setValue(0.8)
      Animated.spring(scale, {
        toValue: 1,
        friction: 3.2,
        tension: 180,
        useNativeDriver: true,
      }).start()
    }

    Promise.resolve(onToggle()).catch(() => {
      // Put it back rather than leaving a like that never landed.
      setOn(!next)
      setN((c) => Math.max(0, c + (next ? -1 : 1)))
    })
  }

  return (
    <Pressable
      onPress={press}
      // Padded to a real target without pushing the row around: the negative
      // margin gives the padding back to the layout.
      hitSlop={{ top: 10, bottom: 10, left: 8, right: 8 }}
      accessibilityRole="button"
      accessibilityLabel={on ? `Unlike, ${n} likes` : `Like, ${n} likes`}
      style={({ pressed }) => [styles.btn, on && styles.btnOn, pressed && styles.pressed]}
    >
      <Animated.View style={{ transform: [{ scale }] }}>
        <Heart size={size} color={on ? LIKED : colors.inkTertiary} fill={on ? LIKED : 'transparent'} />
      </Animated.View>
      <Text
        style={[styles.count, on && styles.countOn]}
        numberOfLines={1}
        maxFontSizeMultiplier={NUM_SCALE_CAP}
      >
        {n}
      </Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 6,
    paddingHorizontal: 10,
    marginVertical: -6,
    marginHorizontal: -10,
    borderRadius: radii.pill,
    // A faint ground even when unliked: without it there is nothing to say the
    // heart is a control rather than a bullet.
    backgroundColor: 'rgba(120,113,108,0.07)',
  },
  btnOn: { backgroundColor: 'rgba(192,57,43,0.10)' },
  pressed: { opacity: 0.65 },
  count: { fontFamily: fonts.bodyMedium, fontSize: 13, color: colors.inkTertiary },
  countOn: { fontFamily: fonts.bodySemiBold, color: LIKED },
})
