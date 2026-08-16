// The "New Recommendation!" cell on For You — a soft orange card that only
// exists when a friend has actually sent you something.
//
// It carries the same weight as Rate This Next: a 10% wash of its accent on
// cream rather than a saturated fill. Everything else on this page is a tinted
// cell, and a solid block of orange read as an ad rather than as part of the
// app. The accent does the work instead — orange type, orange star, orange
// arrow.
//
// The only thing that moves is the star field drifting across behind the text.
// The words and the arrow hold still: a headline that breathes is hard to read
// and gives you something to wait out before you can act on it.
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  AccessibilityInfo,
  Animated,
  Easing,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import { ArrowRight, Star } from 'lucide-react-native'
import { colors, fonts, radii, spacing } from '../theme/tokens'

// The recommendation orange, matching the star on a recommended cover and the
// recommend control on the album page.
const ORANGE = '#f97316'
const ORANGE_DEEP = '#c2410c'
// The same 10% weight Rate This Next carries in green.
const ORANGE_SOFT = 'rgba(249, 115, 22, 0.10)'

/** One star crossing the card, looping forever on its own clock. */
interface Shot {
  key: number
  /** vertical position as a fraction of the card */
  top: number
  size: number
  /** ms for one crossing */
  duration: number
  delay: number
  opacity: number
  /** 1 travels right-to-left, -1 left-to-right. Mixed on purpose — a field all
   *  going one way reads as the card itself sliding. */
  dir: 1 | -1
}

// Fixed rather than random-per-render: a useMemo'd random set still reshuffles
// on remount, and a decorative field that rearranges as you scroll back to it
// reads as a glitch. Scattered by hand, and deliberately not symmetric — four
// one way, four the other, at different heights and speeds.
const SHOTS: Shot[] = [
  { key: 0, top: 0.10, size: 10, duration: 2600, delay: 0,    opacity: 0.34, dir:  1 },
  { key: 1, top: 0.30, size: 7,  duration: 3400, delay: 700,  opacity: 0.26, dir: -1 },
  { key: 2, top: 0.52, size: 13, duration: 2200, delay: 300,  opacity: 0.30, dir:  1 },
  { key: 3, top: 0.74, size: 8,  duration: 3000, delay: 1400, opacity: 0.28, dir: -1 },
  { key: 4, top: 0.88, size: 6,  duration: 3800, delay: 900,  opacity: 0.22, dir:  1 },
  { key: 5, top: 0.20, size: 6,  duration: 2900, delay: 1900, opacity: 0.20, dir: -1 },
  { key: 6, top: 0.63, size: 9,  duration: 3200, delay: 2400, opacity: 0.26, dir:  1 },
  { key: 7, top: 0.40, size: 7,  duration: 2700, delay: 3000, opacity: 0.24, dir: -1 },
]

/** A star and the streak trailing it. */
function ShootingStar({ shot, width, animate }: { shot: Shot; width: number; animate: boolean }) {
  const t = useRef(new Animated.Value(0)).current

  // Driven by explicit recursion rather than Animated.loop over a
  // sequence([delay, timing]). That combination leaves the value parked at 1
  // once the first crossing ends and never returns it to 0, so every star
  // finishes translated off the edge, clipped by the card's overflow, and the
  // field runs exactly once before going dark for good — which is what it did.
  useEffect(() => {
    if (!animate) return
    let cancelled = false
    let anim: Animated.CompositeAnimation | null = null

    const cross = () => {
      if (cancelled) return
      t.setValue(0)
      anim = Animated.timing(t, {
        toValue: 1,
        duration: shot.duration,
        easing: Easing.linear,
        useNativeDriver: true,
      })
      anim.start(({ finished }) => {
        // Only re-arm on a natural finish; stop() during unmount reports false
        // and must not schedule another pass.
        if (finished && !cancelled) cross()
      })
    }

    const timer = setTimeout(cross, shot.delay)
    return () => {
      cancelled = true
      clearTimeout(timer)
      anim?.stop()
    }
  }, [animate, shot.delay, shot.duration, t])

  if (!animate) return null

  // Enters and leaves rather than popping into existence mid-card.
  const off = 90
  const from = shot.dir === 1 ? width + off : -off
  const to = shot.dir === 1 ? -off : width + off
  const translateX = t.interpolate({ inputRange: [0, 1], outputRange: [from, to] })
  // A shallow drift — a dead-horizontal streak reads as a scrollbar.
  const translateY = t.interpolate({ inputRange: [0, 1], outputRange: [-8, 12] })
  const opacity = t.interpolate({
    inputRange: [0, 0.12, 0.85, 1],
    outputRange: [0, shot.opacity, shot.opacity, 0],
  })

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.shot,
        // The star leads and the streak trails, so the row order flips with the
        // direction of travel. Getting this backwards points every streak the
        // wrong way and the field looks like it's being sucked in.
        { flexDirection: shot.dir === 1 ? 'row' : 'row-reverse' },
        { top: `${shot.top * 100}%`, opacity, transform: [{ translateX }, { translateY }] },
      ]}
    >
      <Star size={shot.size} color={ORANGE} fill={ORANGE} />
      <View style={[styles.streak, { width: shot.size * 5, height: Math.max(1.5, shot.size / 6) }]} />
    </Animated.View>
  )
}

export interface RecommendationBannerProps {
  /** Who sent it. */
  from: string
  albumName: string
  /** How many are waiting in total, so a second one isn't hidden by the first. */
  count: number
  onPress: () => void
}

export default function RecommendationBanner({
  from,
  albumName,
  count,
  onPress,
}: RecommendationBannerProps) {
  const [width, setWidth] = useState(0)
  const [animate, setAnimate] = useState(false)

  // Default off and switch on once the setting has been read, so the first
  // frame is never one we'd have to take back.
  //
  // The catch matters: without it a rejected query leaves the field frozen for
  // good, which is the failure nobody reports as a bug — it just looks like a
  // flat cell. Motion is what the design assumes, so fail to it.
  useEffect(() => {
    let alive = true
    AccessibilityInfo.isReduceMotionEnabled()
      .then((reduced) => {
        if (alive) setAnimate(!reduced)
      })
      .catch(() => {
        if (alive) setAnimate(true)
      })
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', (reduced) =>
      setAnimate(!reduced),
    )
    return () => {
      alive = false
      sub?.remove()
    }
  }, [])

  const label = useMemo(
    () =>
      count > 1
        ? `${count} new recommendations, latest ${albumName} from ${from}`
        : `New recommendation: ${albumName} from ${from}`,
    [count, albumName, from],
  )

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
    >
      {/* Behind everything, and never intercepting the tap. */}
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        {SHOTS.map((s) => (
          <ShootingStar key={s.key} shot={s} width={width || 360} animate={animate} />
        ))}
      </View>

      <View style={styles.body}>
        <View style={styles.headRow}>
          <Star size={15} color={ORANGE} fill={ORANGE} />
          <Text style={styles.title} numberOfLines={1}>
            New Recommendation!
          </Text>
        </View>

        {/* The line that says what it actually is. */}
        <Text style={styles.line} numberOfLines={1}>
          <Text style={styles.lineName}>{from}</Text>
          <Text> sent you </Text>
          <Text style={styles.lineAlbum}>{albumName}</Text>
        </Text>

        {count > 1 && <Text style={styles.more}>+{count - 1} more waiting</Text>}
      </View>

      <View style={styles.arrowWrap}>
        <ArrowRight size={20} color={ORANGE_DEEP} />
      </View>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  // Geometry matched to Rate This Next's cell so the two sit as siblings.
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing.lg,
    marginHorizontal: -spacing.sm,
    padding: spacing.lg,
    borderRadius: radii.lg,
    backgroundColor: ORANGE_SOFT,
    overflow: 'hidden',
  },
  cardPressed: { opacity: 0.7 },

  body: { flex: 1, minWidth: 0, gap: 3 },
  headRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  title: {
    flexShrink: 1,
    fontFamily: fonts.displayBlack,
    fontSize: 19,
    letterSpacing: 0.3,
    color: ORANGE_DEEP,
  },
  line: { fontFamily: fonts.body, fontSize: 13.5, color: colors.inkSecondary, marginTop: 1 },
  lineName: { fontFamily: fonts.bodyBold, color: colors.ink },
  lineAlbum: { fontFamily: fonts.bodySemiBold, color: colors.ink },
  more: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 11,
    letterSpacing: 0.4,
    color: ORANGE_DEEP,
    opacity: 0.8,
    marginTop: 2,
  },

  arrowWrap: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(249,115,22,0.16)',
    marginLeft: spacing.sm,
  },

  shot: { position: 'absolute', left: 0, alignItems: 'center', gap: 2 },
  streak: { borderRadius: 99, backgroundColor: ORANGE, opacity: 0.5 },
})
