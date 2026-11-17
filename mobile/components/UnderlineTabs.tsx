// A row of text tabs with one green underline that springs to the tab pressed —
// a profile's Library / Stats / Rankings / Bins (November 2026; web's
// components/UnderlineTabs.tsx slides the same way). The underline is measured
// from the labels, so it fits each one's width. Under Reduce Motion it moves
// without the spring.
import { useEffect, useRef, useState } from 'react'
import { AccessibilityInfo, Animated, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native'
import { colors, fonts, spacing, NUM_SCALE_CAP, useColors } from '../theme/tokens'

export default function UnderlineTabs<K extends string>({ tabs, value, onChange, style }: {
  tabs: readonly { key: K; label: string }[]
  value: K
  onChange: (key: K) => void
  style?: StyleProp<ViewStyle>
}) {
  const tc = useColors()
  const [spots, setSpots] = useState<Partial<Record<K, { x: number; w: number }>>>({})
  const [x] = useState(() => new Animated.Value(0))
  const [w] = useState(() => new Animated.Value(0))
  // The first placement isn't a move: the measured tab puts it there directly.
  const placed = useRef(false)

  const spot = spots[value]
  useEffect(() => {
    if (!spot || !placed.current) return
    let stopped = false
    AccessibilityInfo.isReduceMotionEnabled().then((reduce) => {
      if (stopped) return
      if (reduce) { x.setValue(spot.x); w.setValue(spot.w); return }
      const spring = { useNativeDriver: false, damping: 22, stiffness: 260, mass: 0.9 }
      Animated.parallel([
        Animated.spring(x, { toValue: spot.x, ...spring }),
        Animated.spring(w, { toValue: spot.w, ...spring }),
      ]).start()
    }).catch(() => {})
    return () => { stopped = true }
  }, [spot, x, w])

  return (
    <View style={[styles.bar, style]} accessibilityRole="tablist">
      {tabs.map(({ key, label }) => (
        <Pressable
          key={key}
          onPress={() => onChange(key)}
          onLayout={(e) => {
            const { x: lx, width } = e.nativeEvent.layout
            if (key === value && !placed.current) {
              placed.current = true
              x.setValue(lx)
              w.setValue(width)
            }
            setSpots((s) => (s[key]?.x === lx && s[key]?.w === width ? s : { ...s, [key]: { x: lx, w: width } }))
          }}
          style={styles.tab}
          accessibilityRole="tab"
          accessibilityState={{ selected: value === key }}
        >
          <Text style={[styles.text, value === key && styles.textActive]} numberOfLines={1} maxFontSizeMultiplier={NUM_SCALE_CAP}>
            {label}
          </Text>
        </Pressable>
      ))}
      {spot && <Animated.View style={[styles.underline, { backgroundColor: tc.green, left: x, width: w }]} />}
    </View>
  )
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', gap: spacing.xl },
  tab: { paddingBottom: 8 },
  text: { fontFamily: fonts.bodySemiBold, fontSize: 15, color: colors.inkMuted },
  textActive: { color: colors.ink },
  underline: { position: 'absolute', bottom: 0, height: 2, borderRadius: 1 },
})
