// A horizontal rail that drifts on its own and loops, until someone touches it
// (For You's New & Popular and Heated Discussions, November 2026) — web's
// components/AutoCarousel.tsx, in iPhone's manner: no arrows, the finger is
// the control. The items are drawn twice, the second copy hidden from
// VoiceOver, so the scroll wraps from the end of the first back to its start
// without a jump.
//
// The drift eases to a stop when a finger lands and eases back up RESUME_MS
// after the rail comes to rest; scrolled by hand, it carries on from where it
// was left. It holds still under Reduce Motion and when the screen isn't
// focused (another tab or a pushed page).
import { useEffect, useRef, type ReactNode } from 'react'
import { AccessibilityInfo, ScrollView, View, type StyleProp, type ViewStyle } from 'react-native'
import { useIsFocused } from 'expo-router'

const SPEED = 24 // pt per second, at full drift
const EASE_MS = 420
const RESUME_MS = 1800

export default function AutoRail({ items, gap = 0, style, contentContainerStyle }: {
  items: ReactNode[]
  /** pt between items (0 when the items carry their own margin). */
  gap?: number
  style?: StyleProp<ViewStyle>
  contentContainerStyle?: StyleProp<ViewStyle>
}) {
  const scroll = useRef<ScrollView>(null)
  const x = useRef(0)
  const period = useRef(0) // one copy's length, gap included
  const viewport = useRef(0)
  const held = useRef(false)
  const resumeAt = useRef(0)
  const focused = useIsFocused()

  useEffect(() => {
    if (!focused) return
    let frame = 0
    let cancelled = false
    let vel = 0
    let last = performance.now()
    let reduce = false
    AccessibilityInfo.isReduceMotionEnabled().then((r) => { reduce = r }).catch(() => {})

    const tick = (now: number) => {
      if (cancelled) return
      const dt = Math.min(64, now - last)
      last = now
      const p = period.current
      const running = !reduce && !held.current && now >= resumeAt.current && p > viewport.current
      const target = running ? SPEED : 0
      vel += (target - vel) * (1 - Math.exp(-dt / (EASE_MS / 3)))
      if (!held.current && p > 0) {
        let next = x.current + (vel * dt) / 1000
        // Wrap within the first copy, so the rail never runs out.
        while (next >= p) next -= p
        if (next !== x.current) {
          x.current = next
          scroll.current?.scrollTo({ x: next, animated: false })
        }
      }
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => { cancelled = true; cancelAnimationFrame(frame) }
  }, [focused])

  const hold = () => { held.current = true }
  const letGo = () => { held.current = false; resumeAt.current = performance.now() + RESUME_MS }

  return (
    <ScrollView
      ref={scroll}
      horizontal
      showsHorizontalScrollIndicator={false}
      scrollEventThrottle={16}
      style={style}
      contentContainerStyle={contentContainerStyle}
      onLayout={(e) => { viewport.current = e.nativeEvent.layout.width }}
      onScroll={(e) => { if (held.current) x.current = e.nativeEvent.contentOffset.x }}
      onTouchStart={hold}
      onScrollBeginDrag={hold}
      onTouchEnd={letGo}
      onScrollEndDrag={letGo}
      onMomentumScrollBegin={hold}
      onMomentumScrollEnd={(e) => { x.current = e.nativeEvent.contentOffset.x; letGo() }}
    >
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
    </ScrollView>
  )
}
