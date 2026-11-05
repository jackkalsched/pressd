// The app's loading indicator: the record from the Pressd mark, spinning. It
// stands in for ActivityIndicator everywhere and takes the same props, so a
// call site only changes its tag: `size` "small" (20) / "large" (36) / points,
// and `color`, which it ignores — the record has its own colours.
//
// A flat disc turning on its own looks still, so it's the light that moves: the
// record holds still and its reflections sweep round it. Black in both themes,
// as a record is; the light holds still under Reduce Motion.
//
// frontend/src/components/VinylSpinner.tsx is the same drawing; change both.
import { useEffect, useState } from 'react'
import { AccessibilityInfo, Animated, Easing, View, type ColorValue, type StyleProp, type ViewStyle } from 'react-native'
import Svg, { Circle, Path } from 'react-native-svg'

const C = 50 // the disc's centre in a 100-unit box
const SIZES = { small: 20, large: 36 } as const

export default function VinylSpinner({
  size = 'small',
  style,
  accessibilityLabel = 'Loading',
}: {
  size?: 'small' | 'large' | number
  /** Accepted for ActivityIndicator's sake; the record keeps its own colours. */
  color?: ColorValue
  style?: StyleProp<ViewStyle>
  accessibilityLabel?: string
}) {
  const px = typeof size === 'number' ? size : SIZES[size]
  const [turn] = useState(() => new Animated.Value(0))

  useEffect(() => {
    let loop: Animated.CompositeAnimation | null = null
    let cancelled = false
    AccessibilityInfo.isReduceMotionEnabled().then((reduce) => {
      if (cancelled || reduce) return
      loop = Animated.loop(
        Animated.timing(turn, { toValue: 1, duration: 1600, easing: Easing.linear, useNativeDriver: true }),
      )
      loop.start()
    })
    return () => {
      cancelled = true
      loop?.stop()
    }
  }, [turn])

  const rotate = turn.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] })

  return (
    // Centred in whatever room it's given, as ActivityIndicator is: a screen's
    // loading state leans on that to sit in the middle.
    <View
      style={[{ minWidth: px, minHeight: px, alignItems: 'center', justifyContent: 'center' }, style]}
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={accessibilityLabel}
    >
      <View style={{ width: px, height: px }}>
      <Svg width={px} height={px} viewBox="0 0 100 100" style={{ position: 'absolute' }}>
          <Circle cx={C} cy={C} r="49" fill="#212220" />
          {/* Grooves: barely there, so the disc reads as vinyl, not a dot. */}
          {[42, 35, 28].map((r) => (
            <Circle key={r} cx={C} cy={C} r={r} fill="none" stroke="#f4f2ec" strokeOpacity={0.09} strokeWidth={1.2} />
          ))}
      </Svg>
      {/* The reflections: what moves. */}
      <Animated.View style={{ position: 'absolute', width: px, height: px, transform: [{ rotate }] }}>
        <Svg width={px} height={px} viewBox="0 0 100 100">
          <Path d="M 18 30 A 38 38 0 0 1 36 15" fill="none" stroke="#f4f2ec" strokeOpacity={0.38} strokeWidth={5} strokeLinecap="round" />
          <Path d="M 82 70 A 38 38 0 0 1 64 85" fill="none" stroke="#f4f2ec" strokeOpacity={0.18} strokeWidth={5} strokeLinecap="round" />
        </Svg>
      </Animated.View>
      {/* Label and spindle above the light, so it passes behind them. */}
      <Svg width={px} height={px} viewBox="0 0 100 100" style={{ position: 'absolute' }}>
        <Circle cx={C} cy={C} r="17" fill="#f4f2ec" />
        <Circle cx={C} cy={C} r="3.4" fill="#212220" />
      </Svg>
      </View>
    </View>
  )
}
