// A score as a donut gauge: green arc filled to value/10 over a cream track,
// the number centred. Used for a predicted score, where the fill communicates
// "where this sits on the scale" in less space than a large numeral.
//
// The arc sweeps up from empty when the dial mounts — which is when the album's
// data arrives, so the fill reads as the page resolving. Animating an SVG prop
// rules out the native driver, but one interpolated value per dial is cheap.
import { useEffect, useRef, useState } from 'react'
import { AccessibilityInfo, Animated, Easing, StyleSheet, Text, View } from 'react-native'
import Svg, { Circle } from 'react-native-svg'
import { colors, fonts } from '../theme/tokens'

const AnimatedCircle = Animated.createAnimatedComponent(Circle)

export default function ScoreDial({
  value,
  size = 78,
  decimals = 2,
  max = 10,
  duration = 850,
}: {
  value: number
  size?: number
  decimals?: number
  max?: number
  duration?: number
}) {
  const stroke = Math.max(6, size * 0.13)
  const r = (size - stroke) / 2
  const circumference = 2 * Math.PI * r
  const frac = Math.max(0, Math.min(1, value / max))
  const mid = size / 2

  // Dash offset runs the full circumference (empty) down to the filled remainder.
  const filled = circumference * (1 - frac)
  const offset = useRef(new Animated.Value(circumference)).current
  const [reduceMotion, setReduceMotion] = useState<boolean | null>(null)

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled()
      .then(setReduceMotion)
      .catch(() => setReduceMotion(false))
  }, [])

  useEffect(() => {
    if (reduceMotion === null) return // still resolving the preference
    if (reduceMotion) {
      offset.setValue(filled) // no sweep — land on the value
      return
    }
    offset.setValue(circumference)
    const anim = Animated.timing(offset, {
      toValue: filled,
      duration,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false, // SVG attributes aren't supported natively
    })
    anim.start()
    return () => anim.stop()
  }, [filled, circumference, duration, offset, reduceMotion])

  return (
    <View style={{ width: size, height: size }}>
      <Svg width={size} height={size}>
        <Circle cx={mid} cy={mid} r={r} stroke={colors.inset} strokeWidth={stroke} fill="none" />
        <AnimatedCircle
          cx={mid}
          cy={mid}
          r={r}
          stroke={colors.green}
          strokeWidth={stroke}
          fill="none"
          strokeDasharray={`${circumference} ${circumference}`}
          strokeDashoffset={offset as unknown as number}
          strokeLinecap="round"
          // Start the arc at 12 o'clock rather than 3.
          transform={`rotate(-90 ${mid} ${mid})`}
        />
      </Svg>
      <View style={styles.center} pointerEvents="none">
        <Text style={[styles.value, { fontSize: size * 0.27 }]}>{value.toFixed(decimals)}</Text>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  center: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  value: { fontFamily: fonts.bodyBold, color: colors.green, letterSpacing: -0.3 },
})
