// A dropdown that opens where you tapped.
//
// These menus used to be bottom sheets: the whole screen dimmed behind a 40%
// wash and a panel slid up from the bottom edge. That is the right treatment
// for a sheet you work in — settings, a tracklist, a review — but it is a lot
// of ceremony for picking one of three words, and it moves your attention to
// the opposite end of the screen from the control you just pressed.
//
// This anchors to the trigger instead: no dim, a short fade and rise, and the
// list appears directly under the chip. The full-screen pressable stays, but
// only to catch an outside tap — it paints nothing.
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Animated,
  Easing,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  type View as RNView,
} from 'react-native'
import { Check } from 'lucide-react-native'
import { colors, fonts, radii, screenHeight, screenWidth, spacing } from '../theme/tokens'

export interface MenuOption {
  key: string
  label: string
  value: string | number
  selected: boolean
}

// Gap between the chip and the menu below it, and the margin the menu keeps
// from the screen edges.
const OFFSET = 6
const EDGE = spacing.md
const MIN_W = 190

interface Anchor { x: number; y: number; width: number; height: number }

export default function AnchoredMenu({
  visible,
  anchorRef,
  options,
  onSelect,
  onClose,
  align = 'left',
}: {
  visible: boolean
  anchorRef: React.RefObject<RNView | null>
  options: MenuOption[]
  onSelect: (value: string | number) => void
  onClose: () => void
  /** Which edge of the menu lines up with the trigger. Right-align a chip that
   *  sits near the end of a row, so the menu opens inward. */
  align?: 'left' | 'right'
}) {
  const [anchor, setAnchor] = useState<Anchor | null>(null)
  // Kept mounted through the closing animation, so the menu fades out instead
  // of vanishing between frames.
  const [mounted, setMounted] = useState(false)
  const anim = useRef(new Animated.Value(0)).current

  const run = useCallback(
    (to: number, done?: () => void) =>
      Animated.timing(anim, {
        toValue: to,
        duration: to ? 140 : 110,
        easing: to ? Easing.out(Easing.quad) : Easing.in(Easing.quad),
        useNativeDriver: true,
      }).start(done),
    [anim],
  )

  useEffect(() => {
    if (visible) {
      // Measured at open rather than on layout: the chips live in a horizontal
      // scroller, so where one sits on screen depends on how far it's scrolled.
      anchorRef.current?.measureInWindow((x, y, width, height) => {
        setAnchor({ x, y, width, height })
        setMounted(true)
        anim.setValue(0)
        run(1)
      })
    } else if (mounted) {
      run(0, () => setMounted(false))
    }
  }, [visible, anchorRef, anim, run, mounted])

  if (!mounted || !anchor) return null

  const width = Math.min(Math.max(anchor.width, MIN_W), screenWidth - EDGE * 2)
  const rawLeft = align === 'right' ? anchor.x + anchor.width - width : anchor.x
  const left = Math.max(EDGE, Math.min(rawLeft, screenWidth - width - EDGE))
  const top = anchor.y + anchor.height + OFFSET
  // Never runs past the bottom of the screen, however many genres there are.
  const maxHeight = Math.max(120, screenHeight - top - spacing.xxl)

  return (
    <Modal visible transparent animationType="none" onRequestClose={onClose}>
      {/* Catches the outside tap and nothing else — no wash over the page. */}
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
      <Animated.View
        style={[
          styles.menu,
          {
            top,
            left,
            width,
            maxHeight,
            opacity: anim,
            transform: [{ translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [-6, 0] }) }],
          },
        ]}
      >
        <ScrollView bounces={false} keyboardShouldPersistTaps="handled">
          {options.map((o) => (
            <Pressable
              key={o.key}
              style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
              onPress={() => {
                onSelect(o.value)
                onClose()
              }}
              accessibilityRole="button"
              accessibilityState={{ selected: o.selected }}
            >
              <Text style={[styles.label, o.selected && styles.labelOn]} numberOfLines={1}>
                {o.label}
              </Text>
              {o.selected && <Check size={15} color={colors.green} />}
            </Pressable>
          ))}
        </ScrollView>
      </Animated.View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  menu: {
    position: 'absolute',
    backgroundColor: colors.raised,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: spacing.xs,
    overflow: 'hidden',
    // Carries the menu off the page on its own, now that nothing dims behind it.
    shadowColor: '#1c1917',
    shadowOpacity: 0.16,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    paddingVertical: 11,
    paddingHorizontal: spacing.md,
  },
  rowPressed: { backgroundColor: colors.inset },
  label: { flex: 1, minWidth: 0, fontFamily: fonts.bodyMedium, fontSize: 14.5, color: colors.ink },
  labelOn: { fontFamily: fonts.bodySemiBold, color: colors.green },
})
