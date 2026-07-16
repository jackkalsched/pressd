// A 0–10 score picker (0.1 granularity, matching the web ScoreInput's rounding).
// Drag to set; the value reads out in the score's own gradient color. A light
// haptic tick fires as the rounded value changes so scoring feels physical.
import { useRef } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import Slider from '@react-native-community/slider'
import * as Haptics from 'expo-haptics'
import { songScoreColor } from '@pressd/shared/types'
import { colors, fonts, radii, spacing } from '../theme/tokens'

export default function ScoreSlider({
  value,
  onChange,
  disabled,
}: {
  value: number | null
  onChange: (v: number | null) => void
  disabled?: boolean
}) {
  const lastTick = useRef<number | null>(value)

  function handleChange(raw: number) {
    const rounded = Math.round(raw * 10) / 10
    if (rounded !== lastTick.current) {
      lastTick.current = rounded
      Haptics.selectionAsync().catch(() => {})
    }
    onChange(rounded)
  }

  return (
    <View style={[styles.wrap, disabled && styles.disabled]}>
      <View style={styles.readout}>
        <Text
          style={[styles.value, { color: value !== null ? songScoreColor(value) : colors.inkMuted }]}
        >
          {value !== null ? value.toFixed(1) : '—'}
        </Text>
        {value !== null && !disabled && (
          <Pressable onPress={() => { lastTick.current = null; onChange(null) }} hitSlop={8}>
            <Text style={styles.clear}>clear</Text>
          </Pressable>
        )}
      </View>
      <Slider
        style={styles.slider}
        minimumValue={0}
        maximumValue={10}
        step={0.1}
        value={value ?? 0}
        disabled={disabled}
        onValueChange={handleChange}
        minimumTrackTintColor={value !== null ? songScoreColor(value) : colors.green}
        maximumTrackTintColor={colors.border}
        thumbTintColor={value !== null ? songScoreColor(value) : colors.green}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: { gap: 2 },
  disabled: { opacity: 0.4 },
  readout: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  value: { fontFamily: fonts.bodyBold, fontSize: 18, minWidth: 40 },
  clear: {
    fontFamily: fonts.bodyMedium,
    fontSize: 11,
    color: colors.inkMuted,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    backgroundColor: colors.inset,
    borderRadius: radii.sm,
    overflow: 'hidden',
  },
  slider: { width: '100%', height: 32 },
})
