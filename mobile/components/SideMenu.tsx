// The side menu — opened by the ≡ beside the search icon in For You's
// masthead, sliding in from the left over a dimmed page. Bins is its first
// entry; it is built to take more. Tapping outside, or swiping it back left,
// closes it.
import { useState } from 'react'
import {
  Animated,
  Easing,
  Modal,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useRouter, type Href } from 'expo-router'
import { ChevronRight, Package, type LucideIcon } from 'lucide-react-native'
import { selection } from '../lib/haptics'
import { colors, fonts, spacing, useColors } from '../theme/tokens'

type Item = { label: string; icon: LucideIcon; href: Href }

const ITEMS: Item[] = [
  { label: 'Bins', icon: Package, href: '/bins' },
]

export default function SideMenu({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const tc = useColors()
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { width } = useWindowDimensions()
  const panel = Math.min(320, width * 0.78)
  const [x] = useState(() => new Animated.Value(-panel))

  // Opened from the Modal's onShow, so the slide starts once it is on screen.
  function slideIn() {
    x.setValue(-panel)
    Animated.timing(x, { toValue: 0, duration: 260, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start()
  }

  function close(then?: () => void) {
    Animated.timing(x, { toValue: -panel, duration: 200, easing: Easing.in(Easing.cubic), useNativeDriver: true }).start(() => {
      onClose()
      then?.()
    })
  }

  const [pan] = useState(() =>
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) => g.dx < -8 && Math.abs(g.dx) > Math.abs(g.dy),
      onPanResponderMove: (_, g) => x.setValue(Math.min(0, g.dx)),
      onPanResponderRelease: (_, g) => {
        if (g.dx < -panel / 3 || g.vx < -0.5) close()
        else Animated.spring(x, { toValue: 0, useNativeDriver: true, bounciness: 0 }).start()
      },
    }),
  )

  const backdrop = x.interpolate({ inputRange: [-panel, 0], outputRange: [0, 1], extrapolate: 'clamp' })

  return (
    <Modal visible={visible} transparent animationType="none" onShow={slideIn} onRequestClose={() => close()} statusBarTranslucent>
      <Animated.View style={[StyleSheet.absoluteFill, styles.backdrop, { opacity: backdrop }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={() => close()} accessibilityLabel="Close menu" />
      </Animated.View>
      <Animated.View
        {...pan.panHandlers}
        style={[
          styles.panel,
          { width: panel, paddingTop: insets.top + spacing.lg, paddingBottom: insets.bottom + spacing.lg, transform: [{ translateX: x }] },
        ]}
      >
        <Text style={styles.wordmark}>Pressd</Text>
        <View style={styles.items}>
          {ITEMS.map(({ label, icon: Icon, href }) => (
            <Pressable
              key={label}
              onPress={() => { selection(); close(() => router.push(href)) }}
              style={({ pressed }) => [styles.item, pressed && { opacity: 0.6 }]}
              accessibilityRole="button"
            >
              <Icon size={22} color={tc.ink} strokeWidth={2} />
              <Text style={styles.itemText}>{label}</Text>
              <ChevronRight size={18} color={tc.inkTertiary} />
            </Pressable>
          ))}
        </View>
      </Animated.View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  backdrop: { backgroundColor: colors.scrim },
  panel: {
    position: 'absolute', top: 0, bottom: 0, left: 0,
    backgroundColor: colors.bg, paddingHorizontal: spacing.lg,
    shadowColor: '#000', shadowOpacity: 0.18, shadowRadius: 18, shadowOffset: { width: 4, height: 0 },
  },
  wordmark: { fontFamily: fonts.wordmark, fontSize: 30, color: colors.ink },
  items: { marginTop: spacing.xl },
  item: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.md },
  itemText: { flex: 1, fontFamily: fonts.bodyBold, fontSize: 17, color: colors.ink },
})
