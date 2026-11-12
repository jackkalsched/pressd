// The side menu — opened by the ≡ beside the search icon in For You's
// masthead, sliding in from the right (the side the button is on) over a
// dimmed page. Its entries, in sections split by hairlines: Getting Started
// (the tutorial, replayed) on its own at the top; the four tabs in the tab
// bar's order and words (For You, Library, Social, Charts); Bins and Upcoming;
// and, pinned to the foot of the panel, Settings and Contact support. Tapping
// outside, swiping it back to the right, or tapping its own
// ≡ — drawn exactly where the masthead's was (`anchor`, measured on the tap),
// so the same finger opens and closes it — closes it.
import { useState } from 'react'
import {
  Animated,
  Easing,
  Linking,
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
import { BarChart3, CalendarDays, ChevronRight, CircleUser, Compass, ListMusic, Mail, Menu, Package, Settings, Users, type LucideIcon } from 'lucide-react-native'
import { selection } from '../lib/haptics'
import { colors, fonts, spacing, useColors } from '../theme/tokens'

// An entry switches to a tab (`tab`), goes to a page (`href`), or does
// something its host or the phone owns (`action`): Settings is the profile's
// SettingsSheet, which For You mounts too; Contact support opens a mail to
// the address Settings → About uses, or, with no mail app, Settings scrolled
// to that row.
type Item = { label: string; icon: LucideIcon } & (
  | { tab: 'index' | 'profile' | 'social' | 'charts' }
  | { href: Href }
  | { action: 'settings' | 'contact' }
)

const SUPPORT_EMAIL = 'pressdmusicapp@gmail.com'

// Each inner array is a section, hairlines between. The tabs keep the tab
// bar's own icons, labels and order (components/TabBar.tsx); web's sidebar
// uses the same icons (frontend/src/components/Layout.tsx).
const SECTIONS: Item[][] = [
  // The first-run tutorial, replayed: `replay` records nothing and goes
  // back to For You when done, as Settings → How Pressd works opens it.
  [{ label: 'Getting Started', icon: Compass, href: { pathname: '/tutorial', params: { replay: '1' } } }],
  [
    { label: 'For You', icon: ListMusic, tab: 'index' },
    { label: 'Library', icon: CircleUser, tab: 'profile' },
    { label: 'Social', icon: Users, tab: 'social' },
    { label: 'Charts', icon: BarChart3, tab: 'charts' },
  ],
  [
    { label: 'Bins', icon: Package, href: '/bins' },
    { label: 'Upcoming', icon: CalendarDays, href: '/upcoming' },
  ],
]

// Pinned to the foot of the panel.
const FOOT: Item[] = [
  { label: 'Settings', icon: Settings, action: 'settings' },
  { label: 'Contact support', icon: Mail, action: 'contact' },
]

const HEAD_HEIGHT = 36
const MARK_W = 44 // the mark is 232×126

type Anchor = { x: number; y: number; width: number; height: number }

export default function SideMenu({ visible, anchor, onClose, onSettings }: {
  visible: boolean
  anchor?: Anchor | null
  onClose: () => void
  /** Opens Settings once the menu has slid away; with `contact`, scrolled to
   *  its Contact support row (the fallback when there's no mail app). */
  onSettings: (focus?: 'contact') => void
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

  function go(item: Item) {
    selection()
    close(() => {
      // A tab is switched to, not pushed, so the stack doesn't grow; the
      // menu only opens on For You, so that one just closes.
      if ('tab' in item) {
        if (item.tab !== 'index') router.navigate(`/${item.tab}` as Href)
      } else if ('href' in item) router.push(item.href)
      else if (item.action === 'settings') onSettings()
      // openURL rejects when nothing handles mailto: (no Mail app, or the
      // simulator). canOpenURL isn't asked first: it answers truthfully only
      // for schemes in Info.plist's LSApplicationQueriesSchemes, which would
      // take a native rebuild.
      else Linking.openURL(`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent('Pressd support')}`).catch(() => onSettings('contact'))
    })
  }

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
          {SECTIONS.map((section, i) => (
            <View key={i} style={i > 0 && [styles.rule, { borderTopColor: tc.border }]}>
              {section.map((item) => <Entry key={item.label} item={item} onPress={() => go(item)} />)}
            </View>
          ))}
        </View>
        <View style={[styles.foot, { borderTopColor: tc.border }]}>
          {FOOT.map((item) => <Entry key={item.label} item={item} onPress={() => go(item)} />)}
        </View>
      </Animated.View>
    </Modal>
  )
}

function Entry({ item, onPress }: { item: Item; onPress: () => void }) {
  const tc = useColors()
  const { label, icon: Icon } = item
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.item, pressed && { opacity: 0.6 }]}
      accessibilityRole="button"
    >
      <Icon size={22} color={tc.ink} strokeWidth={2} />
      <Text style={styles.itemText}>{label}</Text>
      <ChevronRight size={18} color={tc.inkTertiary} />
    </Pressable>
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
  items: { flex: 1, marginTop: spacing.xl },
  foot: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: spacing.sm },
  item: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.md },
  rule: { borderTopWidth: StyleSheet.hairlineWidth, marginTop: spacing.sm, paddingTop: spacing.md + spacing.sm },
  itemText: { flex: 1, fontFamily: fonts.bodyBold, fontSize: 17, color: colors.ink },
})
