// Search on a bin's page (its records) and on the Bins page (the bins), folded
// into a round magnifier until it's wanted: a tap opens the field, focused; ✕
// clears and folds it, as leaving it empty does. On a bin's page the page holds
// `open`, because opening search squeezes the sort down to its icon and that
// icon folds search away again. One outer view in both states, so a layout
// animation grows and shrinks it rather than swapping one box for another.
// The matching rule is shared/src/binSort.ts's, once for both apps.
import { useState } from 'react'
import { Pressable, StyleSheet, TextInput, View, type StyleProp, type ViewStyle } from 'react-native'
import { Search, X } from 'lucide-react-native'
import { selection } from '../lib/haptics'
import { colors, fonts, radii, spacing, useColors } from '../theme/tokens'

export default function BinSearch({ value, onChange, placeholder, buttonStyle, fieldStyle, open: openProp, onOpenChange }: {
  value: string
  onChange: (v: string) => void
  placeholder: string
  /** Where the folded magnifier sits. */
  buttonStyle?: StyleProp<ViewStyle>
  /** How the open field sits. */
  fieldStyle?: StyleProp<ViewStyle>
  /** Held by the page, when something else opens or folds it. */
  open?: boolean
  onOpenChange?: (open: boolean) => void
}) {
  const tc = useColors()
  const [ownOpen, setOwnOpen] = useState(false)
  const open = openProp ?? (ownOpen || value !== '')
  const setOpen = (v: boolean) => (onOpenChange ? onOpenChange(v) : setOwnOpen(v))

  return (
    <View style={open ? [styles.field, { borderColor: tc.border }, fieldStyle] : [styles.button, { borderColor: tc.border }, buttonStyle]}>
      {open ? (
        <>
          <Search size={16} color={tc.inkTertiary} />
          <TextInput
            value={value}
            onChangeText={onChange}
            onBlur={() => { if (!value) setOpen(false) }}
            placeholder={placeholder}
            placeholderTextColor={tc.inkMuted}
            style={styles.input}
            autoFocus
            autoCorrect={false}
            autoCapitalize="none"
            returnKeyType="search"
            accessibilityLabel={placeholder}
          />
          <Pressable
            onPress={() => { onChange(''); setOpen(false) }}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel="Close search"
          >
            <X size={16} color={tc.inkTertiary} />
          </Pressable>
        </>
      ) : (
        <Pressable
          onPress={() => { selection(); setOpen(true) }}
          hitSlop={6}
          style={({ pressed }) => [styles.fill, pressed && { opacity: 0.6 }]}
          accessibilityRole="button"
          accessibilityLabel={placeholder}
        >
          <Search size={16} color={tc.ink} />
        </Pressable>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  button: {
    width: 36, height: 36, borderRadius: 18, borderWidth: 1, overflow: 'hidden',
  },
  fill: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  field: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm, overflow: 'hidden',
    height: 36, paddingHorizontal: spacing.md, borderRadius: radii.pill, borderWidth: 1,
    backgroundColor: colors.raised,
  },
  input: { flex: 1, minWidth: 0, fontFamily: fonts.bodyMedium, fontSize: 15, color: colors.ink, paddingVertical: 0 },
})
