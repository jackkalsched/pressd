import { useEffect, useRef, useState } from 'react'
import { Stack, useRouter } from 'expo-router'
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
import { loadRecsSeen } from '../lib/recsSeen'
import {
  currentBuild, loadWhatsNewSeen, markWhatsNewSeen,
  useWhatsNewHydrated, useWhatsNewSeen,
} from '../lib/whatsNew'
import { latestRelease, releaseFor } from '../lib/releaseNotes'
import { attachPushListeners, syncPushToken } from '../lib/push'
import { wireAppStateFocus } from '../lib/refresh'
import { getMessaging, setBackgroundMessageHandler } from '@react-native-firebase/messaging'
import WhatsNewSheet from '../components/WhatsNewSheet'
import { colors } from '../theme/tokens'

SplashScreen.preventAutoHideAsync().catch(() => {})
loadSocialSeen() // hydrate the Social "new activity" marker once at launch
loadRecsSeen()   // and the watermark that keeps the recommendation banner to one showing
loadWhatsNewSeen()  // and which build's release notes have already been read
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
      }
    })
  }, [user, router])

  if (!fontsLoaded || !ready) return null // splash stays up

  return (
    <>
    <WhatsNew signedIn={!!user} />
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

/** The release notes, once per build, for signed-in users only.
 *
 *  Gated on `signedIn` because notes describing recommendations and profile
 *  picks mean nothing to someone looking at the sign-in screen — and showing
 *  them there would spend the one appearance before the reader has an account.
 *
 *  Held until the Keychain has answered, so it never flashes up on a build
 *  whose notes were already read.
 */
function WhatsNew({ signedIn }: { signedIn: boolean }) {
  const seen = useWhatsNewSeen()
  const hydrated = useWhatsNewHydrated()
  const build = currentBuild()
  // Fall back to the newest notes we have when the binary reports a build we
  // shipped none for — better than a silent nothing on a build that shipped.
  const release = releaseFor(build) ?? latestRelease()

  const [dismissed, setDismissed] = useState(false)
  // Derived rather than pushed into state from an effect: the answer is a pure
  // function of what's already known, and setting state in an effect would
  // render once with the sheet closed and again with it open for no reason.
  const due = signedIn && hydrated && !!release && build > seen
  // Pinned the first time it comes due, so marking it read — which moves `seen`
  // and makes `due` false — doesn't yank the sheet out mid-read.
  const pinned = useRef(false)
  if (due) pinned.current = true

  if (!release) return null
  return (
    <WhatsNewSheet
      release={release}
      visible={pinned.current && !dismissed}
      onClose={() => {
        setDismissed(true)
        markWhatsNewSeen(build)
      }}
    />
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
