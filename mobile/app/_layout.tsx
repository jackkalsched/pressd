import { useEffect } from 'react'
import { Stack } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import * as SplashScreen from 'expo-splash-screen'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  useFonts,
  PlayfairDisplay_400Regular,
  PlayfairDisplay_700Bold,
  PlayfairDisplay_900Black,
} from '@expo-google-fonts/playfair-display'
import {
  PlusJakartaSans_400Regular,
  PlusJakartaSans_500Medium,
  PlusJakartaSans_600SemiBold,
  PlusJakartaSans_700Bold,
} from '@expo-google-fonts/plus-jakarta-sans'
import '../lib/api' // configure the shared client before anything fetches
import { AuthProvider, useAuth } from '../lib/auth'
import { loadSocialSeen } from '../lib/socialSeen'
import { colors } from '../theme/tokens'

SplashScreen.preventAutoHideAsync().catch(() => {})
loadSocialSeen() // hydrate the Social "new activity" marker once at launch

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 60_000, retry: 1 } },
})

function RootNavigator() {
  const { user, ready } = useAuth()

  const [fontsLoaded] = useFonts({
    PlayfairDisplay_400Regular,
    PlayfairDisplay_700Bold,
    PlayfairDisplay_900Black,
    PlusJakartaSans_400Regular,
    PlusJakartaSans_500Medium,
    PlusJakartaSans_600SemiBold,
    PlusJakartaSans_700Bold,
    // Clash Display isn't on Google Fonts, so it ships as a local file
    // (Fontshare EULA permits app embedding — see assets/fonts/ClashDisplay-LICENSE.txt).
    ClashDisplay_700Bold: require('../assets/fonts/ClashDisplay-Bold.ttf'),
    ClashDisplay_600SemiBold: require('../assets/fonts/ClashDisplay-Semibold.ttf'),
  })

  useEffect(() => {
    if (fontsLoaded && ready) SplashScreen.hideAsync().catch(() => {})
  }, [fontsLoaded, ready])

  if (!fontsLoaded || !ready) return null // splash stays up

  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }}>
      <Stack.Protected guard={!!user}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="welcome" />
        <Stack.Screen name="add" options={{ presentation: 'modal' }} />
        <Stack.Screen name="first-album" options={{ presentation: 'modal' }} />
        <Stack.Screen name="rate/[id]" />
        <Stack.Screen name="album/[id]" />
        <Stack.Screen name="friend/[id]" />
        <Stack.Screen name="artist/[name]" />
      </Stack.Protected>
      <Stack.Protected guard={!user}>
        <Stack.Screen name="sign-in" />
      </Stack.Protected>
    </Stack>
  )
}

export default function RootLayout() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <StatusBar style="dark" />
        <RootNavigator />
      </AuthProvider>
    </QueryClientProvider>
  )
}
