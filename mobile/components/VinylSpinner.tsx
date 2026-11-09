// The app's loading indicator: a record, from the vinyl-loader design handoff
// (November 2026), whose geometry, colours and timings are kept here. It
// stands in for ActivityIndicator everywhere and takes the same props, so a
// call site only changes its tag: `size` "small" (20) / "large" (36) / points,
// and `color`, which it ignores — the record has its own colours.
//
// Five ways of playing it (the handoff's 1b–1f), one picked at random each
// time a spinner appears, so a wait isn't the same picture every time:
//   1b  the record turns under a light that stays put, as on a real deck
//   1c  a tonearm swings on, tracks inward and lifts off
//   1d  a plate presses the disc, which squashes and sends out a ring
//   1e  green grooves fill from the label outward
//   1f  the record slides out of a Pressd sleeve, spinning, and tucks back in
// At or below SMALL_MAX (a button's or a row's spinner) it is always 1b: a
// tonearm or a sleeve at 20pt is a smudge. Under Reduce Motion it is 1b, still.
//
// Each variant is drawn at the handoff's reference disc (S = 120) and scaled
// into a `size` square, so a spinner keeps the footprint it always had and the
// timings keep the handoff's own numbers. A CSS keyframe list becomes one
// Animated value that runs through the keyframe offsets with the keyframes'
// easing between each pair (`useCycle`), and each property interpolates over
// it — so every segment eases as the web's does.
//
// frontend/src/components/VinylSpinner.tsx is the same drawing; change both.
import { useEffect, useState, type ReactNode } from 'react'
import {
  AccessibilityInfo,
  Animated,
  Easing,
  StyleSheet,
  Text,
  View,
  type ColorValue,
  type EasingFunction,
  type StyleProp,
  type ViewStyle,
} from 'react-native'
import Svg, { Circle, G, Path } from 'react-native-svg'
import { fonts, useIsDark } from '../theme/tokens'

export type VinylVariant = '1b' | '1c' | '1d' | '1e' | '1f'
const VARIANTS: VinylVariant[] = ['1b', '1c', '1d', '1e', '1f']
/** At or below this, always 1b. */
export const SMALL_MAX = 28
const SIZES = { small: 20, large: 36 } as const

const S = 120 // the handoff's reference disc
const R = S / 2
// Each variant's whole picture, in reference units.
const BOX: Record<VinylVariant, [number, number]> = {
  '1b': [S, S],
  '1c': [S + 40, S + 4], // the tonearm's pivot sits 4 above the disc
  '1d': [S + 20, S + 30], // the plate overhangs 10 each side and drops from above
  '1e': [S, S],
  '1f': [S * 1.5, S + 10], // the sleeve, and room for the record to slide out
}

const GREEN = '#2d6a4f'
const CREAM = '#F4F2EC'
// CSS's named curves, for the keyframes that use them.
const EASE_OUT = Easing.bezier(0, 0, 0.58, 1)
const EASE_IN_OUT = Easing.bezier(0.42, 0, 0.58, 1)
const SWING = Easing.bezier(0.6, 0, 0.3, 1)
const PRESS = Easing.bezier(0.5, 0, 0.3, 1)

// Reduce Motion, read once and kept current, so a spinner can choose its
// variant the moment it appears rather than after an async check.
let reduceMotion = false
AccessibilityInfo.isReduceMotionEnabled().then((v) => { reduceMotion = v }).catch(() => {})
AccessibilityInfo.addEventListener?.('reduceMotionChanged', (v) => { reduceMotion = v })

function pick(px: number): VinylVariant {
  if (px <= SMALL_MAX || reduceMotion) return '1b'
  return VARIANTS[Math.floor(Math.random() * VARIANTS.length)]
}

/** A value that runs through `offsets` (0…1) once per `duration`, forever,
 *  easing between each pair as a CSS keyframe list does. Interpolate each
 *  property over `offsets`. Still under Reduce Motion. */
function useCycle(offsets: number[], duration: number, easing: EasingFunction): Animated.Value {
  const [t] = useState(() => new Animated.Value(0))
  useEffect(() => {
    if (reduceMotion) return
    const steps = offsets.slice(1).map((o, i) =>
      Animated.timing(t, { toValue: o, duration: (o - offsets[i]) * duration, easing, useNativeDriver: true }),
    )
    const loop = Animated.loop(Animated.sequence(steps))
    loop.start()
    return () => loop.stop()
    // The offsets are constants at each call site.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t, duration, easing])
  return t
}

/** A full turn every `duration` ms. */
function useTurn(duration: number) {
  const t = useCycle([0, 1], duration, Easing.linear)
  return t.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] })
}

// ---------------------------------------------------------------- the record

const GROOVES = Array.from({ length: Math.floor(R / 3) }, (_, i) => 3 * (i + 1) - 0.5)

/** The disc: black, finely grooved, with a soft shadow on a light page and a
 *  faint ring on a dark one. Children sit on it and are clipped to it. */
function Disc({ children }: { children?: ReactNode }) {
  const dark = useIsDark()
  return (
    <View
      style={[
        StyleSheet.absoluteFill,
        { borderRadius: R, backgroundColor: '#1b1a19' },
        dark
          ? { borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' }
          : { shadowColor: '#1c1917', shadowOpacity: 0.18, shadowRadius: 10, shadowOffset: { width: 0, height: 8 } },
      ]}
    >
      <View style={[StyleSheet.absoluteFill, { borderRadius: R, overflow: 'hidden' }]}>
        <Svg width={S} height={S} style={StyleSheet.absoluteFill}>
          {GROOVES.map((r) => (
            <Circle key={r} cx={R} cy={R} r={r} fill="none" stroke="#222120" strokeWidth={1} />
          ))}
        </Svg>
        {children}
      </View>
    </View>
  )
}

/** The label, with its green band (which is what shows it turning) and the
 *  spindle hole. */
function Label() {
  const d = S * 0.34
  return (
    <View style={{ position: 'absolute', left: R - d / 2, top: R - d / 2, width: d, height: d, borderRadius: d / 2, backgroundColor: CREAM, overflow: 'hidden' }}>
      <View style={{ position: 'absolute', left: 0, right: 0, top: 0, height: d * 0.38, backgroundColor: GREEN }} />
      <View style={{ position: 'absolute', left: d * 0.42, top: d * 0.42, width: d * 0.16, height: d * 0.16, borderRadius: d * 0.08, backgroundColor: '#1c1917' }} />
    </View>
  )
}

// The sheen: the web's conic gradient (two wedges, 28°–72° and 208°–252° from
// the top, clockwise), on the groove ring only. Drawn as thin slices whose
// opacity follows the gradient's stops.
const SHEEN_IN = 33 // 39% of the gradient's reach (the square's corner)
const SHEEN_OUT = R
function sheenAlpha(a: number): number {
  const x = a % 180
  if (x < 28 || x >= 72) return 0
  if (x < 40) return (0.22 * (x - 28)) / 12
  if (x < 62) return 0.22 - (0.16 * (x - 40)) / 22
  return 0.06 - (0.06 * (x - 62)) / 10
}
function sector(a1: number, a2: number): string {
  const p = (r: number, a: number) => {
    const rad = (a * Math.PI) / 180
    return `${(R + r * Math.sin(rad)).toFixed(2)} ${(R - r * Math.cos(rad)).toFixed(2)}`
  }
  return `M ${p(SHEEN_IN, a1)} L ${p(SHEEN_OUT, a1)} A ${SHEEN_OUT} ${SHEEN_OUT} 0 0 1 ${p(SHEEN_OUT, a2)} L ${p(SHEEN_IN, a2)} A ${SHEEN_IN} ${SHEEN_IN} 0 0 0 ${p(SHEEN_IN, a1)} Z`
}
const SHEEN_SLICES = [28, 208].flatMap((start) =>
  Array.from({ length: 22 }, (_, i) => {
    const a = start + i * 2
    return { d: sector(a, a + 2.15), alpha: sheenAlpha(a + 1) }
  }),
)

/** The light on the record. Never turns: the record does. */
function Sheen({ rotate = 0 }: { rotate?: number }) {
  return (
    <Svg width={S} height={S} style={StyleSheet.absoluteFill} pointerEvents="none">
      <G rotation={rotate} origin={`${R}, ${R}`}>
        {SHEEN_SLICES.map((s, i) => (
          <Path key={i} d={s.d} fill="#ffffff" fillOpacity={s.alpha} />
        ))}
      </G>
    </Svg>
  )
}

const DISC_BOX = { position: 'absolute', width: S, height: S, borderRadius: R } as const

// ---------------------------------------------------------------- the variants

function TurnsUnderLight({ top = 0 }: { top?: number }) {
  const rotate = useTurn(1800)
  return (
    <>
      <Animated.View style={[DISC_BOX, { left: 0, top, transform: [{ rotate }] }]}>
        <Disc><Label /></Disc>
      </Animated.View>
      <View style={[DISC_BOX, { left: 0, top }]} pointerEvents="none"><Sheen rotate={-20} /></View>
    </>
  )
}

function Tonearm() {
  const dark = useIsDark()
  const t = useCycle([0, 0.08, 0.22, 0.78, 0.92, 1], 4000, SWING)
  const rotate = t.interpolate({ inputRange: [0, 0.08, 0.22, 0.78, 0.92, 1], outputRange: ['-28deg', '-28deg', '0deg', '9deg', '-28deg', '-28deg'] })
  return (
    <>
      <TurnsUnderLight top={4} />
      <Animated.View style={{ position: 'absolute', left: S + 40 - 6 - 14, top: 0, width: 14, height: 14, borderRadius: 7, backgroundColor: dark ? '#A8998A' : '#8a7f74', transform: [{ rotate }] }}>
        <View style={{ position: 'absolute', left: 5, top: 7, width: 4, height: S * 0.62, borderRadius: 2, backgroundColor: dark ? '#CFC6BC' : '#6b625a', transformOrigin: 'top', transform: [{ rotate: '22deg' }] }}>
          <View style={{ position: 'absolute', left: -3, bottom: -6, width: 10, height: 12, borderRadius: 2, backgroundColor: GREEN }} />
        </View>
      </Animated.View>
    </>
  )
}

function Pressing() {
  const dark = useIsDark()
  const plateT = useCycle([0, 0.2, 0.34, 0.4, 0.56, 1], 1800, PRESS)
  const squashT = useCycle([0, 0.38, 0.43, 0.52, 0.6, 1], 1800, EASE_OUT)
  const rippleT = useCycle([0, 0.4, 0.43, 0.85, 1], 1800, EASE_OUT)
  const plateIn = [0, 0.2, 0.34, 0.4, 0.56, 1]
  const squashIn = [0, 0.38, 0.43, 0.52, 0.6, 1]
  const rippleIn = [0, 0.4, 0.43, 0.85, 1]
  return (
    <>
      <Animated.View
        style={{
          position: 'absolute', left: 10, top: 30, width: S, height: S, borderRadius: R,
          borderWidth: 2, borderColor: GREEN,
          opacity: rippleT.interpolate({ inputRange: rippleIn, outputRange: [0, 0, 0.55, 0, 0] }),
          transform: [{ scale: rippleT.interpolate({ inputRange: rippleIn, outputRange: [0.45, 0.45, 0.55, 1.35, 1.35] }) }],
        }}
      />
      <Animated.View
        style={[DISC_BOX, {
          left: 10, top: 30,
          transform: [
            { scaleX: squashT.interpolate({ inputRange: squashIn, outputRange: [1, 1, 1.07, 0.98, 1, 1] }) },
            { scaleY: squashT.interpolate({ inputRange: squashIn, outputRange: [1, 1, 0.9, 1.02, 1, 1] }) },
          ],
        }]}
      >
        <Disc><Sheen /><Label /></Disc>
      </Animated.View>
      <Animated.View
        style={{
          position: 'absolute', left: 0, top: 18, width: S + 20, height: 12, borderRadius: 6,
          backgroundColor: dark ? '#CFC6BC' : '#3a3632',
          opacity: plateT.interpolate({ inputRange: plateIn, outputRange: [0, 0, 1, 1, 0, 0] }),
          transform: [{ translateY: plateT.interpolate({ inputRange: plateIn, outputRange: [-46, -46, -6, 0, -46, -46] }) }],
        }}
      />
    </>
  )
}

// The green grooves' reach: the web's radial mask is a circle out to the
// square's corner, from 22% of it to all of it.
const FILL_R = R * Math.SQRT2

function GroovesFill({ k }: { k: number }) {
  const rotate = useTurn(3000)
  const t = useCycle([0, 0.85, 1], 2400, EASE_IN_OUT)
  const reach = t.interpolate({ inputRange: [0, 0.85, 1], outputRange: [0.22, 1, 1] })
  const unscale = Animated.divide(1, reach)
  // The handoff's 1px every 4px, spread out as the spinner shrinks so they stay
  // 3pt apart on screen — closer, they shimmer.
  const gap = Math.max(4, 3 / k)
  const width = Math.max(1, 0.75 / k)
  const rings = Array.from({ length: Math.floor(FILL_R / gap) + 1 }, (_, i) => i * gap + width / 2)
  return (
    <Animated.View style={[DISC_BOX, { left: 0, top: 0, transform: [{ rotate }] }]}>
      <Disc>
        {/* A circle that grows from the label outward and clips the grooves;
            the grooves inside it are scaled back, so only the edge moves. */}
        <Animated.View
          style={{
            position: 'absolute', left: R - FILL_R, top: R - FILL_R, width: FILL_R * 2, height: FILL_R * 2,
            borderRadius: FILL_R, overflow: 'hidden',
            opacity: t.interpolate({ inputRange: [0, 0.85, 1], outputRange: [1, 1, 0] }),
            transform: [{ scale: reach }],
          }}
        >
          <Animated.View style={{ width: FILL_R * 2, height: FILL_R * 2, transform: [{ scale: unscale }] }}>
            <Svg width={FILL_R * 2} height={FILL_R * 2}>
              {rings.map((r) => (
                <Circle key={r} cx={FILL_R} cy={FILL_R} r={r} fill="none" stroke="rgba(111,191,142,0.7)" strokeWidth={width} />
              ))}
            </Svg>
          </Animated.View>
        </Animated.View>
        <Label />
      </Disc>
    </Animated.View>
  )
}

function OutOfTheSleeve() {
  const rotate = useTurn(1600)
  const t = useCycle([0, 0.06, 0.28, 0.72, 0.94, 1], 3200, SWING)
  const slide = t.interpolate({ inputRange: [0, 0.06, 0.28, 0.72, 0.94, 1], outputRange: [0, 0, S * 0.42, S * 0.42, 0, 0] })
  return (
    <>
      <Animated.View style={[DISC_BOX, { left: 5, top: 5, transform: [{ translateX: slide }, { rotate }] }]}>
        <Disc><Sheen /><Label /></Disc>
      </Animated.View>
      <View
        style={{
          position: 'absolute', left: 0, top: 0, width: S + 10, height: S + 10, borderRadius: 6,
          backgroundColor: GREEN, justifyContent: 'flex-end', padding: 12,
          shadowColor: '#1c1917', shadowOpacity: 0.18, shadowRadius: 10, shadowOffset: { width: 0, height: 8 },
        }}
      >
        <Text style={{ fontFamily: fonts.wordmarkSemiBold, fontSize: S * 0.17, lineHeight: S * 0.17 * 1.1, color: CREAM }} allowFontScaling={false}>
          Pressd
        </Text>
      </View>
    </>
  )
}

function Stage({ variant, k }: { variant: VinylVariant; k: number }) {
  switch (variant) {
    case '1b': return <TurnsUnderLight />
    case '1c': return <Tonearm />
    case '1d': return <Pressing />
    case '1e': return <GroovesFill k={k} />
    case '1f': return <OutOfTheSleeve />
  }
}

export default function VinylSpinner({
  size = 'small',
  style,
  accessibilityLabel = 'Loading',
  variant,
}: {
  size?: 'small' | 'large' | number
  /** Accepted for ActivityIndicator's sake; the record keeps its own colours. */
  color?: ColorValue
  style?: StyleProp<ViewStyle>
  accessibilityLabel?: string
  /** A fixed variant; otherwise one is picked at random when it appears. */
  variant?: VinylVariant
}) {
  const px = typeof size === 'number' ? size : SIZES[size]
  const [picked] = useState(() => variant ?? pick(px))
  const [w, h] = BOX[picked]
  const k = px / Math.max(w, h)

  return (
    // Centred in whatever room it's given, as ActivityIndicator is: a screen's
    // loading state leans on that to sit in the middle.
    <View
      style={[{ minWidth: px, minHeight: px, alignItems: 'center', justifyContent: 'center' }, style]}
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={accessibilityLabel}
    >
      <View style={{ width: px, height: px }} pointerEvents="none">
        {/* The picture at the handoff's size, scaled about its centre into the box. */}
        <View style={{ position: 'absolute', left: (px - w) / 2, top: (px - h) / 2, width: w, height: h, transform: [{ scale: k }] }}>
          <Stage variant={picked} k={k} />
        </View>
      </View>
    </View>
  )
}
