// The side menu — opened by the ≡ beside the search icon in For You's
// masthead, sliding in from the right (the side the button is on) over a
// dimmed page. Its entries: Bins, Getting Started (the tutorial, replayed) and
// Settings. Tapping outside, swiping it back to the right, or tapping its own
// ≡ — drawn exactly where the masthead's was (`anchor`, measured on the tap),
// so the same finger opens and closes it — closes it.
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
import { Image } from 'expo-image'
import { useRouter, type Href } from 'expo-router'
import { ChevronRight, Compass, Menu, Package, Settings, type LucideIcon } from 'lucide-react-native'
import { selection } from '../lib/haptics'
import { colors, fonts, spacing, useColors } from '../theme/tokens'

// An entry goes somewhere (`href`) or opens a sheet its host owns (`action`):
// Settings is the profile's SettingsSheet, which For You mounts too.
type Item = { label: string; icon: LucideIcon } & ({ href: Href } | { action: 'settings' })

const ITEMS: Item[] = [
  { label: 'Bins', icon: Package, href: '/bins' },
  // The first-run tutorial, replayed: `replay` records nothing and goes
  // back to For You when done, as Settings → How Pressd works opens it.
  { label: 'Getting Started', icon: Compass, href: { pathname: '/tutorial', params: { replay: '1' } } },
  { label: 'Settings', icon: Settings, action: 'settings' },
]

const HEAD_HEIGHT = 36
const MARK_W = 44 // the mark is 232×126

type Anchor = { x: number; y: number; width: number; height: number }

export default function SideMenu({ visible, anchor, onClose, onSettings }: {
  visible: boolean
  anchor?: Anchor | null
  onClose: () => void
  /** Opens Settings once the menu has slid away. */
  onSettings: () => void
}) {
  const tc = useColors()
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { width } = useWindowDimensions()
  const panel = Math.min(320, width * 0.78)
  // The header row — the mark and "Pressd" — sits on the ≡'s line, centred on
  // it, when the masthead's position is known; otherwise under the status bar.
  const headTop = anchor ? anchor.y : insets.top + spacing.lg
  const headHeight = anchor ? anchor.height : HEAD_HEIGHT
  const [x] = useState(() => new Animated.Value(panel))

  // Opened from the Modal's onShow, so the slide starts once it is on screen.
  function slideIn() {
    x.setValue(panel)
    Animated.timing(x, { toValue: 0, duration: 260, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start()
  }

  function close(then?: () => void) {
    Animated.timing(x, { toValue: panel, duration: 200, easing: Easing.in(Easing.cubic), useNativeDriver: true }).start(() => {
      onClose()
      then?.()
    })
  }

  const [pan] = useState(() =>
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) => g.dx > 8 && Math.abs(g.dx) > Math.abs(g.dy),
      onPanResponderMove: (_, g) => x.setValue(Math.max(0, g.dx)),
      onPanResponderRelease: (_, g) => {
        if (g.dx > panel / 3 || g.vx > 0.5) close()
        else Animated.spring(x, { toValue: 0, useNativeDriver: true, bounciness: 0 }).start()
      },
    }),
  )

  const backdrop = x.interpolate({ inputRange: [0, panel], outputRange: [1, 0], extrapolate: 'clamp' })

  return (
    <Modal visible={visible} transparent animationType="none" onShow={slideIn} onRequestClose={() => close()} statusBarTranslucent>
      <Animated.View style={[StyleSheet.absoluteFill, styles.backdrop, { opacity: backdrop }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={() => close()} accessibilityLabel="Close menu" />
      </Animated.View>
      <Animated.View
        {...pan.panHandlers}
        style={[
          styles.panel,
          { width: panel, paddingTop: headTop + headHeight + spacing.md, paddingBottom: insets.bottom + spacing.lg, transform: [{ translateX: x }] },
        ]}
      >
        <View style={[styles.head, { top: headTop, height: headHeight }]}>
          <Image source={require('../assets/pressd-mark.png')} style={styles.mark} contentFit="contain" />
          <Text style={styles.wordmark}>Pressd</Text>
        </View>
        {anchor && (
          // In the panel, so it slides in with it and comes to rest on the
          // masthead's ≡: the panel's left edge is the screen width less its own.
          <Pressable
            onPress={() => { selection(); close() }}
            hitSlop={8}
            style={({ pressed }) => [
              styles.closeBtn,
              { left: anchor.x - (width - panel), top: anchor.y, width: anchor.width, height: anchor.height },
              pressed && { opacity: 0.5 },
            ]}
            accessibilityRole="button"
            accessibilityLabel="Close menu"
          >
            <Menu size={24} color={tc.ink} strokeWidth={2.2} />
          </Pressable>
        )}
        <View style={styles.items}>
          {ITEMS.map((item) => {
            const { label, icon: Icon } = item
            return (
              <Pressable
                key={label}
                onPress={() => {
                  selection()
                  close(() => ('href' in item ? router.push(item.href) : onSettings()))
                }}
                style={({ pressed }) => [styles.item, pressed && { opacity: 0.6 }]}
                accessibilityRole="button"
              >
                <Icon size={22} color={tc.ink} strokeWidth={2} />
                <Text style={styles.itemText}>{label}</Text>
                <ChevronRight size={18} color={tc.inkTertiary} />
              </Pressable>
            )
          })}
        </View>
      </Animated.View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  backdrop: { backgroundColor: colors.scrim },
  panel: {
    position: 'absolute', top: 0, bottom: 0, right: 0,
    backgroundColor: colors.bg, paddingHorizontal: spacing.lg,
    shadowColor: '#000', shadowOpacity: 0.18, shadowRadius: 18, shadowOffset: { width: -4, height: 0 },
  },
  closeBtn: { position: 'absolute', alignItems: 'center', justifyContent: 'center' },
  head: { position: 'absolute', left: spacing.lg, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  mark: { width: MARK_W, height: MARK_W * (126 / 232) },
  wordmark: { fontFamily: fonts.wordmark, fontSize: 28, lineHeight: 32, color: colors.ink },
  items: { marginTop: spacing.xl },
  item: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.md },
  itemText: { flex: 1, fontFamily: fonts.bodyBold, fontSize: 17, color: colors.ink },
})
