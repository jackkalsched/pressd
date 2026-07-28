// Floating pill tab bar with a raised center "+" button, per the mobile
// design mockups. Used as the custom tabBar for the (tabs) navigator.
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { useQuery } from '@tanstack/react-query'
import { ListMusic, BarChart3, Users, CircleUser, Plus } from 'lucide-react-native'
import { fetchFeed } from '../lib/api'
import { useAuth } from '../lib/auth'
import { useSocialSeen, latestFeedTime } from '../lib/socialSeen'
import { colors, fonts, radii } from '../theme/tokens'

// Minimal structural slice of react-navigation's BottomTabBarProps — the
// vendored expo-router copy and the standalone package disagree on exact
// types, so we depend only on the fields this bar actually uses.
interface TabBarProps {
  state: { index: number; routes: { key: string; name: string }[] }
  navigation: {
    emit: (opts: { type: 'tabPress'; target: string; canPreventDefault: true }) => { defaultPrevented: boolean }
    navigate: (name: string) => void
  }
}

const TAB_META: Record<string, { label: string; Icon: typeof ListMusic }> = {
  index: { label: 'For You', Icon: ListMusic },
  charts: { label: 'Charts', Icon: BarChart3 },
  social: { label: 'Social', Icon: Users },
  profile: { label: 'Crate', Icon: CircleUser },
}

export default function TabBar({ state, navigation }: TabBarProps) {
  const insets = useSafeAreaInsets()
  const router = useRouter()
  const { user } = useAuth()

  // Friend-activity signal for the Social tab dot: newest feed timestamp vs the
  // last time the user opened Social. Shares the ['feed', id] cache with the
  // Social screen, so this adds no extra fetch once that screen has loaded.
  const { data: feed = [] } = useQuery({
    queryKey: ['feed', user?.id],
    queryFn: () => fetchFeed(user!.id),
    enabled: !!user,
  })
  const seen = useSocialSeen()
  const latest = latestFeedTime(feed)
  const socialHasNew = latest > 0 && latest > seen

  const left = state.routes.slice(0, 2)
  const right = state.routes.slice(2)

  const renderTab = (route: (typeof state.routes)[number]) => {
    const meta = TAB_META[route.name]
    if (!meta) return null
    const index = state.routes.findIndex((r) => r.key === route.key)
    const focused = state.index === index
    const color = focused ? colors.green : colors.inkMuted
    const showDot = route.name === 'social' && socialHasNew && !focused
    return (
      <Pressable
        key={route.key}
        style={styles.tab}
        onPress={() => {
          const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true })
          if (!focused && !event.defaultPrevented) navigation.navigate(route.name)
        }}
      >
        <View>
          <meta.Icon size={22} color={color} strokeWidth={focused ? 2.4 : 2} />
          {showDot && <View style={styles.dot} />}
        </View>
        <Text style={[styles.label, { color, fontFamily: focused ? fonts.bodyBold : fonts.bodyMedium }]}>
          {meta.label}
        </Text>
      </Pressable>
    )
  }

  return (
    <View pointerEvents="box-none" style={[styles.wrap, { paddingBottom: Math.max(insets.bottom, 12) }]}>
      <View style={styles.bar}>
        <View style={styles.side}>{left.map(renderTab)}</View>
        <View style={styles.fabGap} />
        <View style={styles.side}>{right.map(renderTab)}</View>
      </View>
      <Pressable
        style={({ pressed }) => [styles.fab, pressed && { backgroundColor: colors.greenPressed }]}
        onPress={() => router.push('/add')}
        accessibilityLabel="Add an album"
      >
        <Plus size={28} color="#ffffff" strokeWidth={2.6} />
      </Pressable>
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    backgroundColor: 'transparent',
  },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.raised,
    borderRadius: radii.pill,
    marginHorizontal: 16,
    paddingVertical: 10,
    paddingHorizontal: 8,
    shadowColor: '#1c1917',
    shadowOpacity: 0.1,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
  side: { flex: 1, flexDirection: 'row' },
  fabGap: { width: 72 },
  tab: { flex: 1, alignItems: 'center', gap: 3, paddingVertical: 2 },
  label: { fontSize: 11 },
  dot: {
    position: 'absolute',
    top: -2,
    right: -5,
    width: 9,
    height: 9,
    borderRadius: 4.5,
    backgroundColor: '#e0492b',
    borderWidth: 1.5,
    borderColor: colors.raised,
  },
  fab: {
    position: 'absolute',
    top: -26,
    alignSelf: 'center',
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: colors.green,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#1c1917',
    shadowOpacity: 0.18,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 10,
  },
})
