import { useEffect, useState } from 'react'
import { Stack, useRouter } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import * as SplashScreen from 'expo-splash-screen'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  useFonts,
  PlayfairDisplay_400Regular,
  PlayfairDisplay_700Bold,
  PlayfairDisplay_700Bold_Italic,
  PlayfairDisplay_900Black,
} from '@expo-google-fonts/playfair-display'
import { Unbounded_700Bold } from '@expo-google-fonts/unbounded'
import {
  PlusJakartaSans_400Regular,
  PlusJakartaSans_500Medium,
  PlusJakartaSans_600SemiBold,
  PlusJakartaSans_700Bold,
} from '@expo-google-fonts/plus-jakarta-sans'
import '../lib/api' // configure the shared client before anything fetches
import { AuthProvider, useAuth } from '../lib/auth'
import { loadSocialSeen } from '../lib/socialSeen'
import { loadRecsSeen } from '../lib/recsSeen'
import { loadPassItOn } from '../lib/passItOn'
import { attachPushListeners, pushPermissionStatus, syncPushToken } from '../lib/push'
import { usePrefs } from '../lib/prefs'
import NotifyPromptSheet from '../components/NotifyPromptSheet'
import { useOnHeldScreen } from '../lib/onboarding'
import { wireAppStateFocus } from '../lib/refresh'
import { getMessaging, setBackgroundMessageHandler } from '@react-native-firebase/messaging'
import PhoneSheet from '../components/PhoneSheet'
import { PeopleSheetHost } from '../components/PeopleSheet'
import { colors } from '../theme/tokens'

SplashScreen.preventAutoHideAsync().catch(() => {})
loadSocialSeen() // hydrate the Social "new activity" marker once at launch
loadRecsSeen()   // and the watermark that keeps the recommendation banner to one showing
loadPassItOn()   // and count this launch toward the next "Pass it on" suggestion
// Without this React Query never learns the app came back to the foreground —
// refetchOnWindowFocus is a browser concept and no-ops in React Native.
wireAppStateFocus()

// Registered at module scope, deliberately: iOS runs this in a fresh JS context
// with no React tree, so anything inside a component would never be reached.
// Returning a resolved promise is enough — the notification is displayed by the
// system, and this exists so the app can do work alongside it later.
setBackgroundMessageHandler(getMessaging(), async () => {})

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 60_000, retry: 1 } },
})

function RootNavigator() {
  const { user, ready } = useAuth()
  const router = useRouter()
  // Whether iOS has yet to ask this device about notifications: the launch
  // prompt is only worth showing before it has. null until iOS answers.
  const [pushUnasked, setPushUnasked] = useState<boolean | null>(null)
  const { pushPromptAnswered } = usePrefs()
  // The first run and the rating flow have the floor: no prompt opens over them.
  const onHeldScreen = useOnHeldScreen()
  useEffect(() => {
    if (!user) return
    pushPermissionStatus().then((s) => setPushUnasked(s === 'undetermined')).catch(() => setPushUnasked(false))
  }, [user])

  const [fontsLoaded] = useFonts({
    PlayfairDisplay_400Regular,
    PlayfairDisplay_700Bold,
    PlayfairDisplay_700Bold_Italic,
    PlayfairDisplay_900Black,
    Unbounded_700Bold,
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

  // Re-register on every signed-in launch. FCM rotates a token after a
  // reinstall, a restore, or a long silence, and a stale one on the server
  // fails silently — the send succeeds and nothing arrives. No-ops when
  // permission has not been granted, so it is not a back-door prompt.
  useEffect(() => {
    if (!user) return
    syncPushToken().catch(() => {})
    // Tapping a notification should land on the thing it was about.
    //
    // The server names the *event* and the client decides where that goes,
    // rather than the server sending a path to push. Destinations stay
    // type-checked against the router here, and a payload can never talk the
    // app into navigating somewhere it was not built to go.
    return attachPushListeners((data) => {
      switch (data?.kind) {
        case 'reply':
        // A friend's review opens the record's room, as a reply does.
        case 'review':
          if (!data.subject_type) return
          router.push({
            pathname: '/thread/[subject]',
            params: {
              subject: data.subject_type,
              artist: data.artist ?? '',
              album: data.album ?? '',
              title: data.title ?? '',
            },
          })
          return
        // For You, where the recommendation cell is waiting.
        case 'recommendation':
          router.push('/(tabs)')
          return
        case 'friend_request':
          router.push('/(tabs)/social')
          return
        // Their copy of the record, where your rating sits beside theirs.
        case 'rating':
          if (!data.album_id) return
          router.push({ pathname: '/album/[id]', params: { id: data.album_id } })
          return
      }
    })
  }, [user, router])

  if (!fontsLoaded || !ready) return null // splash stays up

  const pastFirstRun = !!user && user.tutorialSeen !== false
  // The notifications ask comes after the username, the tutorial and the phone
  // prompt, and before the people sheet. Owed while iOS
  // hasn't answered whether it has asked, so the sheet can't slip in first.
  const otherPromptsDone =
    pastFirstRun && user.usernameChosen !== false && user.phonePromptDone === true
  const notifyOwed = !pushPromptAnswered && pushUnasked !== false
  return (
    <>
    {/* The one-time phone-number ask for an account older than the username
        page's phone step, after the tutorial. An explicit false: a session that hasn't heard of the field yet waits
        for the launch refresh in lib/auth rather than asking twice. */}
    <PhoneSheet
      mode="prompt"
      visible={pastFirstRun && !onHeldScreen && user.phonePromptDone === false}
      onClose={() => {}}
    />
    {/* The people sheet a first rating owes, asked for at launch and again as
        the rating flow's share card closes. Last in line: the username page,
        the tutorial, the phone prompt and the notifications ask each go first.
        Held until the phone answer is known to be in, so a session that
        learns from the launch refresh that the prompt is owed can't have
        the sheet already up underneath it. */}
    <NotifyPromptSheet visible={otherPromptsDone && !onHeldScreen && notifyOwed && pushUnasked === true} />
    <PeopleSheetHost
      held={
        !pastFirstRun || user.usernameChosen === false ||
        user.phonePromptDone !== true || notifyOwed
      }
    />
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }}>
      <Stack.Protected guard={!!user}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="username" options={{ gestureEnabled: false }} />
        <Stack.Screen name="tutorial" options={{ gestureEnabled: false }} />
        <Stack.Screen name="welcome" />
        <Stack.Screen name="add" options={{ presentation: 'modal' }} />
        <Stack.Screen name="search" />
        <Stack.Screen name="upcoming" />
        <Stack.Screen name="bins/index" />
        <Stack.Screen name="bins/[slug]" />
        <Stack.Screen name="first-album" options={{ presentation: 'modal' }} />
        <Stack.Screen name="rate/[id]" />
        <Stack.Screen name="album/[id]" />
        <Stack.Screen name="friend/[id]" />
        <Stack.Screen name="artist/[name]" />
        <Stack.Screen name="thread/[subject]" />
        <Stack.Screen name="splits/[name]" />
        <Stack.Screen name="favorite/song" />
        <Stack.Screen name="favorite/album" />
        <Stack.Screen name="favorite/artist" />
      </Stack.Protected>
      <Stack.Protected guard={!user}>
        <Stack.Screen name="sign-in" />
      </Stack.Protected>
    </Stack>
    </>
  )
}

export default function RootLayout() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        {/* Dark text on the cream page, light on the dark one. */}
        <StatusBar style="auto" />
        <RootNavigator />
      </AuthProvider>
    </QueryClientProvider>
  )
}
