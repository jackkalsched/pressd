// A horizontal rail that drifts on its own and loops (For You's New & Popular
// and Heated Discussions, November 2026) — web's components/AutoCarousel.tsx,
// in iPhone's manner: no arrows, the finger is the control. The items are
// drawn twice, the second copy hidden from VoiceOver, so the rail wraps from
// the end of the first back to its start without a jump.
//
// It is a row slid by a transform, not a ScrollView. A ScrollView moved by
// scrollTo every frame counts as "still scrolling" to iOS, which then keeps
// every touch for itself to stop the scroll — so no card could be tapped and a
// drag fought the drift. Here a tap goes straight to the card under it, and
// only a sideways drag is the rail's (a PanResponder that claims horizontal
// moves and never gives them up, so the page's vertical scroll keeps the rest).
//
// It moves like something with weight: a finger on it holds it still and
// drags it; let go, it carries on at the speed it was thrown — either way —
// and settles back to the idle drift over SETTLE_MS, never stopping dead. A
// tap lets it ease back up from rest. It holds still under Reduce Motion (a
// throw still coasts out) and when the screen isn't focused (another tab or a
// pushed page).
//
// `fade` (pt) masks the rail's two ends to nothing, as web's carousel fades its
// edges: records drift in out of the page rather than being cut at its margin.
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { AccessibilityInfo, Animated, PanResponder, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native'
import { useIsFocused } from 'expo-router'
import MaskedView from '@react-native-masked-view/masked-view'
import { LinearGradient } from 'expo-linear-gradient'

const SPEED = 24 // pt per second, the idle drift
const EASE_MS = 420 // rest → idle drift
const SETTLE_MS = 2100 // a throw → idle drift: the rail's weight
const MAX_THROW = 5000 // pt per second

export default function AutoRail({ items, gap = 0, fade = 0, style, contentContainerStyle }: {
  items: ReactNode[]
  /** pt between items (0 when the items carry their own margin). */
  gap?: number
  /** pt over which each end fades out (0: a hard edge). */
  fade?: number
  /** The rail's box: margins place it, padding pads the row (as a ScrollView's would). */
  style?: StyleProp<ViewStyle>
  /** The row's own padding. */
  contentContainerStyle?: StyleProp<ViewStyle>
}) {
  const [shift] = useState(() => new Animated.Value(0))
  const x = useRef(0) // how far the row has slid, within one copy
  const period = useRef(0) // one copy's length, gap included
  const viewport = useRef(0)
  const held = useRef(false)
  const dragging = useRef(false)
  const vel = useRef(0) // pt per second; the rail's current speed
  const dragFrom = useRef(0)
  const focused = useIsFocused()
  const [width, setWidth] = useState(0)

  const wrapTo = (next: number) => {
    const p = period.current
    if (p > 0) {
      while (next >= p) next -= p
      while (next < 0) next += p
    }
    x.current = next
    shift.setValue(-next)
  }

  useEffect(() => {
    if (!focused) return
    let frame = 0
    let cancelled = false
    let last = performance.now()
    let reduce = false
    AccessibilityInfo.isReduceMotionEnabled().then((r) => { reduce = r }).catch(() => {})

    const tick = (now: number) => {
      if (cancelled) return
      const dt = Math.min(64, now - last)
      last = now
      const target = !reduce && period.current > viewport.current ? SPEED : 0
      if (!held.current) {
        let v = vel.current
        // Faster than the drift (or thrown backwards), it settles slowly; from
        // rest it eases up quickly.
        const tau = v > target * 1.25 + 1 || v < 0 ? SETTLE_MS / 3 : EASE_MS / 3
        v += (target - v) * (1 - Math.exp(-dt / tau))
        vel.current = v
        if (Math.abs(v) > 0.01) wrapTo(x.current + (v * dt) / 1000)
      }
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => { cancelled = true; cancelAnimationFrame(frame) }
    // wrapTo reads only the rail's state and the stable Animated value.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focused])

  // The handlers read and write the refs only when a gesture fires, never while
  // rendering; the rule can't see that through PanResponder.create.
  // eslint-disable-next-line react-hooks/refs
  const [pan] = useState(() => PanResponder.create({
    // Taps never become the rail's: only a drag that is more sideways than not.
    onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > 6 && Math.abs(g.dx) > Math.abs(g.dy) * 1.2,
    onMoveShouldSetPanResponderCapture: (_, g) => Math.abs(g.dx) > 6 && Math.abs(g.dx) > Math.abs(g.dy) * 1.2,
    onPanResponderTerminationRequest: () => false,
    onPanResponderGrant: () => {
      held.current = true
      dragging.current = true
      vel.current = 0
      dragFrom.current = x.current
    },
    onPanResponderMove: (_, g) => {
      x.current = dragFrom.current - g.dx
      // Keep the start point inside the copy as the row wraps under the finger.
      const before = x.current
      wrapTo(x.current)
      dragFrom.current += x.current - before
    },
    onPanResponderRelease: (_, g) => {
      dragging.current = false
      held.current = false
      // vx is pt per ms; the row moves against the finger.
      vel.current = Math.max(-MAX_THROW, Math.min(MAX_THROW, -g.vx * 1000))
    },
    onPanResponderTerminate: (_, g) => {
      dragging.current = false
      held.current = false
      vel.current = Math.max(-MAX_THROW, Math.min(MAX_THROW, -g.vx * 1000))
    },
  }))

  // A finger landing anywhere holds the rail still, so a card can be read and
  // tapped; lifting it (a tap, not a drag) lets the drift ease back up.
  const touchDown = () => { held.current = true; vel.current = 0 }
  const touchUp = () => { if (!dragging.current) held.current = false }

  // The box's margins place it (and, faded, the mask); its padding and the
  // row's own pad the sliding row.
  const flat = StyleSheet.flatten(style) ?? {}
  const {
    padding, paddingHorizontal, paddingLeft, paddingRight, paddingTop, paddingBottom, paddingVertical,
    margin, marginHorizontal, marginLeft, marginRight, marginTop, marginBottom, marginVertical,
    ...box
  } = flat
  const outer = { margin, marginHorizontal, marginLeft, marginRight, marginTop, marginBottom, marginVertical }
  const pad = { padding, paddingHorizontal, paddingLeft, paddingRight, paddingTop, paddingBottom, paddingVertical }

  const row = (
    <View
      style={[box, { overflow: 'hidden' }, fade > 0 ? null : outer]}
      onLayout={(e) => { viewport.current = e.nativeEvent.layout.width; setWidth(e.nativeEvent.layout.width) }}
      onTouchStart={touchDown}
      onTouchEnd={touchUp}
      onTouchCancel={touchUp}
      {...pan.panHandlers}
    >
      <Animated.View style={[{ flexDirection: 'row', alignSelf: 'flex-start', transform: [{ translateX: shift }] }, pad, contentContainerStyle]}>
        <View
          style={{ flexDirection: 'row', gap, marginRight: gap }}
          onLayout={(e) => { period.current = e.nativeEvent.layout.width + gap }}
        >
          {items}
        </View>
        {/* The loop's second copy: for the eye only. */}
        <View style={{ flexDirection: 'row', gap }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          {items}
        </View>
      </Animated.View>
    </View>
  )

  if (fade <= 0) return row
  const edge = width > 0 ? Math.min(0.45, fade / width) : 0.1
  return (
    <MaskedView
      style={outer}
      maskElement={
        <LinearGradient
          style={StyleSheet.absoluteFill}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          colors={['transparent', 'black', 'black', 'transparent']}
          locations={[0, edge, 1 - edge, 1]}
        />
      }
    >
      {row}
    </MaskedView>
  )
}
