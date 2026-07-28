import { Tabs, Redirect } from 'expo-router'
import { useQuery } from '@tanstack/react-query'
import TabBar from '../../components/TabBar'
import { fetchAlbums } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { isOnboardingSkipped } from '../../lib/onboarding'
import { colors } from '../../theme/tokens'

export default function TabsLayout() {
  const { user } = useAuth()

  // New users (no rated albums) meet the welcome screen first, unless they've
  // chosen to explore. Once they rate one, this query returns a non-empty list
  // and the gate stops firing.
  const { data: rated, isLoading } = useQuery({
    queryKey: ['albums', 'rated', user?.id],
    queryFn: () => fetchAlbums({ status: 'rated', userId: user!.id }),
    enabled: !!user,
  })

  if (user && !isOnboardingSkipped() && !isLoading && rated?.length === 0) {
    return <Redirect href="/welcome" />
  }

  return (
    <Tabs
      tabBar={({ state, navigation }) => <TabBar state={state} navigation={navigation} />}
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: colors.bg },
      }}
    >
      {/* Declaration order drives the pill: the first two sit left of the
          add button, the last two right of it. */}
      <Tabs.Screen name="index" />
      <Tabs.Screen name="profile" />
      <Tabs.Screen name="social" />
      <Tabs.Screen name="charts" />
    </Tabs>
  )
}
