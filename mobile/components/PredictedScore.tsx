// A predicted album score: the number filled with a slow gray → green → red →
// green → gray gradient, so an estimate never reads as a settled score (which is
// drawn in one flat colour), with a small sparkle that flashes at its corner.
//
// Layout is the plain Text's. The number is laid out once as an ordinary Text
// in the caller's style (transparent once measured), and the gradient sits over
// it in a MaskedView cut to the same Text — so swapping this in for a coloured
// Text moves nothing.
//
// Motion runs on the UI thread (Reanimated): the gradient, three times the
// number's width, pans 0 → 100% → 0 on a 6s ease-in-out loop; the sparkle
// scales up, turns 45° and fades every 3.4s. Both stop while the number is off
// screen, its screen isn't focused, or the app is in the background, and never
// start under Reduce Motion, which shows the gradient standing still and no
// sparkle.
import { useEffect, useRef, useState } from 'react'
import { AppState, Dimensions, StyleSheet, Text, View, type StyleProp, type TextStyle } from 'react-native'
import MaskedView from '@react-native-masked-view/masked-view'
import { LinearGradient } from 'expo-linear-gradient'
import Animated, {
  cancelAnimation,
  Easing,
  interpolate,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated'
import Svg, { Path } from 'react-native-svg'
import { useIsFocused } from 'expo-router'
import { useIsDark } from '../theme/tokens'

// Gray → green → red → green → gray, per appearance.
const STOPS = {
  light: ['#8a837c', '#4E8E2A', '#B3261E', '#4E8E2A', '#8a837c'],
  dark: ['#A8A29A', '#5E9A2E', '#E0675F', '#5E9A2E', '#A8A29A'],
} as const

/** How much wider than the number the gradient is; it pans across the extra. */
const SPAN = 3
const DRIFT_MS = 6000
const SPARKLE_EVERY_MS = 3400
const SPARKLE_FLASH_MS = 700
/** How often an on-screen check runs while the screen is focused and active. */
const VISIBILITY_POLL_MS = 1000

const AnimatedGradient = Animated.createAnimatedComponent(LinearGradient)

export default function PredictedScore({
  value,
  size,
  style,
  places = 2,
  prefix = '',
  sparkle = true,
  scheme,
  maxFontSizeMultiplier,
}: {
  value: number
  /** Font size; the caller's style's size when omitted. */
  size?: number
  /** The Text style the number had before (family, line height, spacing). Its colour is ignored. */
  style?: StyleProp<TextStyle>
  /** Two for an album score, which is every predicted score today. */
  places?: number
  /** Drawn before the number, inside the gradient ("~" on a library badge). */
  prefix?: string
  /** The flashing corner sparkle; off for very small numbers. */
  sparkle?: boolean
  /** Force a palette when the number sits on a fixed background (a dark pill over a cover). */
  scheme?: 'light' | 'dark'
  maxFontSizeMultiplier?: number
}) {
  const isDark = useIsDark()
  const palette = STOPS[scheme ?? (isDark ? 'dark' : 'light')]
  const reduceMotion = useReducedMotion()
  const focused = useIsFocused()
  const [box, setBox] = useState<{ w: number; h: number } | null>(null)
  const [active, setActive] = useState(AppState.currentState === 'active')
  const [onScreen, setOnScreen] = useState(true)
  const ref = useRef<View>(null)

  const textStyle: StyleProp<TextStyle> = [style, size != null && { fontSize: size }]
  const label = `${prefix}${value.toFixed(places)}`
  const fontSize = size ?? (StyleSheet.flatten(style)?.fontSize ?? 14)

  // App backgrounded → pause.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => setActive(s === 'active'))
    return () => sub.remove()
  }, [])

  // Scrolled out of the window → pause. A cheap poll, only while it could run.
  useEffect(() => {
    if (reduceMotion || !focused || !active) return
    const check = () => {
      ref.current?.measureInWindow((x, y, w, h) => {
        const win = Dimensions.get('window')
        setOnScreen(w > 0 && y + h > 0 && y < win.height && x + w > 0 && x < win.width)
      })
    }
    check()
    const id = setInterval(check, VISIBILITY_POLL_MS)
    return () => clearInterval(id)
  }, [reduceMotion, focused, active])

  const running = !reduceMotion && focused && active && onScreen && box != null

  // 0 → 1 → 0, eased, forever: the gradient's pan.
  const drift = useSharedValue(0.5)
  // 0 → 1 once per sparkle cycle, then held at 0 for the rest of it.
  const flash = useSharedValue(0)

  useEffect(() => {
    if (!running) {
      cancelAnimation(drift)
      cancelAnimation(flash)
      if (reduceMotion) drift.value = 0.5
      flash.value = 0
      return
    }
    drift.value = withRepeat(
      withTiming(drift.value < 0.5 ? 1 : 0, { duration: DRIFT_MS, easing: Easing.inOut(Easing.ease) }),
      -1,
      true,
    )
    if (sparkle) {
      flash.value = 0
      flash.value = withRepeat(
        withSequence(
          withDelay(SPARKLE_EVERY_MS - SPARKLE_FLASH_MS, withTiming(0, { duration: 0 })),
          withTiming(1, { duration: SPARKLE_FLASH_MS, easing: Easing.out(Easing.quad) }),
          withTiming(0, { duration: 0 }),
        ),
        -1,
        false,
      )
    }
    return () => {
      cancelAnimation(drift)
      cancelAnimation(flash)
    }
  }, [running, sparkle, reduceMotion, drift, flash])

  const w = box?.w ?? 0
  const panStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: -drift.value * w * (SPAN - 1) }],
  }))

  const spark = Math.max(6, Math.round(fontSize * 0.42))
  const sparkleStyle = useAnimatedStyle(() => ({
    opacity: interpolate(flash.value, [0, 0.15, 0.6, 1], [0, 1, 1, 0]),
    transform: [
      { scale: interpolate(flash.value, [0, 0.4, 1], [0.2, 1, 1.15]) },
      { rotate: `${interpolate(flash.value, [0, 1], [0, 45])}deg` },
    ],
  }))

  return (
    <View ref={ref} collapsable={false}>
      {/* The layout: exactly the Text the caller had. Shown in the gradient's
          first colour until it has been measured, then transparent. */}
      <Text
        style={[textStyle, { color: box ? 'transparent' : palette[0] }]}
        numberOfLines={1}
        maxFontSizeMultiplier={maxFontSizeMultiplier}
        onLayout={(e) => {
          const { width, height } = e.nativeEvent.layout
          if (!box || box.w !== width || box.h !== height) setBox({ w: width, h: height })
        }}
        accessibilityLabel={`Predicted ${label}`}
      >
        {label}
      </Text>
      {box && (
        <MaskedView
          pointerEvents="none"
          style={StyleSheet.absoluteFill}
          maskElement={
            <Text style={[textStyle, { color: '#000' }]} numberOfLines={1} maxFontSizeMultiplier={maxFontSizeMultiplier}>
              {label}
            </Text>
          }
        >
          <AnimatedGradient
            colors={[...palette]}
            start={{ x: 0, y: 0.5 }}
            end={{ x: 1, y: 0.5 }}
            style={[{ width: box.w * SPAN, height: box.h }, panStyle]}
          />
        </MaskedView>
      )}
      {sparkle && !reduceMotion && box && (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.sparkle,
            { width: spark, height: spark, top: -spark * 0.35, right: -spark * 0.55 },
            sparkleStyle,
          ]}
        >
          <Svg width={spark} height={spark} viewBox="0 0 24 24">
            {/* A four-point star: concave sides meeting at the four tips. */}
            <Path d="M12 0 C12.8 7.5 16.5 11.2 24 12 C16.5 12.8 12.8 16.5 12 24 C11.2 16.5 7.5 12.8 0 12 C7.5 11.2 11.2 7.5 12 0 Z" fill="#ffffff" />
          </Svg>
        </Animated.View>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  sparkle: {
    position: 'absolute',
    shadowColor: '#ffffff',
    shadowOpacity: 0.9,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 0 },
  },
})
