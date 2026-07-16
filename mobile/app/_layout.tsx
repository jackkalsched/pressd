import { useEffect } from 'react'
import { Stack } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import * as SplashScreen from 'expo-splash-screen'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  useFonts,
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
import { colors } from '../theme/tokens'

SplashScreen.preventAutoHideAsync().catch(() => {})

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 60_000, retry: 1 } },
})

function RootNavigator() {
  const { user, ready } = useAuth()

  const [fontsLoaded] = useFonts({
    PlayfairDisplay_700Bold,
    PlayfairDisplay_900Black,
    PlusJakartaSans_400Regular,
    PlusJakartaSans_500Medium,
    PlusJakartaSans_600SemiBold,
    PlusJakartaSans_700Bold,
  })

  useEffect(() => {
    if (fontsLoaded && ready) SplashScreen.hideAsync().catch(() => {})
  }, [fontsLoaded, ready])

  if (!fontsLoaded || !ready) return null // splash stays up

  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }}>
      <Stack.Protected guard={!!user}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="add" options={{ presentation: 'modal' }} />
        <Stack.Screen name="rate/[id]" />
        <Stack.Screen name="album/[id]" />
        <Stack.Screen name="friend/[id]" />
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
