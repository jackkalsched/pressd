import { useEffect, useState } from 'react'
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Image } from 'expo-image'
import * as WebBrowser from 'expo-web-browser'
import * as Google from 'expo-auth-session/providers/google'
import * as AppleAuthentication from 'expo-apple-authentication'
import { useAuth } from '../lib/auth'
import { colors, fonts, radii, spacing } from '../theme/tokens'

WebBrowser.maybeCompleteAuthSession()

// Gated on __DEV__, not just on the variable being set. Expo layers env files
// — .env is the base for every environment and .env.production only overrides
// individual keys — so a token left in .env is inlined into a release bundle
// even when the production file doesn't mention it. Metro strips this branch
// from a production build entirely, so neither the button nor the credential
// can reach a release binary by accident.
const DEV_TOKEN = __DEV__ ? process.env.EXPO_PUBLIC_DEV_TOKEN : undefined
const GOOGLE_IOS_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID

// `Google.useAuthRequest` throws on native when no platform client id is set,
// so it lives in a child that only mounts once the iOS client id exists. Until
// then the dev-token path below is the way in.
function GoogleButton({
  onToken,
  onError,
}: {
  onToken: (accessToken: string) => void
  onError: (message: string) => void
}) {
  const [request, response, promptAsync] = Google.useAuthRequest({
    iosClientId: GOOGLE_IOS_CLIENT_ID,
    webClientId: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID,
  })

  useEffect(() => {
    const accessToken = response?.type === 'success' ? response.authentication?.accessToken : null
    if (accessToken) onToken(accessToken)
    else if (response?.type === 'error') onError(response.error?.message ?? 'Google sign-in failed')
  }, [response, onToken, onError])

  return (
    <Pressable
      style={({ pressed }) => [styles.googleBtn, pressed && { backgroundColor: colors.greenPressed }]}
      disabled={!request}
      onPress={() => promptAsync()}
    >
      <Text style={styles.googleBtnText}>Continue with Google</Text>
    </Pressable>
  )
}

export default function SignIn() {
  const { signInWithGoogleToken, signInWithAppleToken, signInWithDevToken } = useAuth()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [appleAvailable, setAppleAvailable] = useState(false)

  useEffect(() => {
    if (Platform.OS === 'ios') AppleAuthentication.isAvailableAsync().then(setAppleAvailable).catch(() => {})
  }, [])

  function handleGoogleToken(accessToken: string) {
    setBusy(true)
    setError(null)
    signInWithGoogleToken(accessToken)
      .catch((e: Error) => setError(e.message))
      .finally(() => setBusy(false))
  }

  async function handleApple() {
    setError(null)
    try {
      const cred = await AppleAuthentication.signInAsync({
        requestedScopes: [
          AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
          AppleAuthentication.AppleAuthenticationScope.EMAIL,
        ],
      })
      if (!cred.identityToken) throw new Error('No identity token from Apple')
      const fullName = [cred.fullName?.givenName, cred.fullName?.familyName].filter(Boolean).join(' ') || undefined
      setBusy(true)
      await signInWithAppleToken(cred.identityToken, fullName)
    } catch (e) {
      if (e instanceof Error && e.message.includes('canceled')) return
      setError(e instanceof Error ? e.message : 'Apple sign-in failed')
    } finally {
      setBusy(false)
    }
  }

  async function handleDevToken() {
    if (!DEV_TOKEN) return
    setBusy(true)
    setError(null)
    try {
      await signInWithDevToken(DEV_TOKEN)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Dev sign-in failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.hero}>
        <Image source={require('../assets/splash-icon.png')} style={styles.logo} contentFit="contain" />
        <Text style={styles.wordmark}>Pressd</Text>
        <Text style={styles.tagline}>Track Your Taste</Text>
      </View>

      <View style={styles.actions}>
        {busy ? (
          <ActivityIndicator color={colors.green} />
        ) : (
          <>
            {appleAvailable ? (
              <AppleAuthentication.AppleAuthenticationButton
                buttonType={AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN}
                buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
                cornerRadius={radii.lg}
                style={styles.appleBtn}
                onPress={handleApple}
              />
            ) : null}

            {GOOGLE_IOS_CLIENT_ID ? (
              <GoogleButton onToken={handleGoogleToken} onError={setError} />
            ) : null}

            {DEV_TOKEN ? (
              <Pressable style={styles.devBtn} onPress={handleDevToken}>
                <Text style={styles.devBtnText}>Continue with dev token</Text>
              </Pressable>
            ) : null}

            {/* Release builds ship Apple as the only sign-in path, so this
                developer hint must stay out of a tester's way — it is only
                useful when there is genuinely no button on screen. */}
            {!appleAvailable && !GOOGLE_IOS_CLIENT_ID && !DEV_TOKEN ? (
              <Text style={styles.hint}>
                Set EXPO_PUBLIC_DEV_TOKEN or EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID in mobile/.env to sign in.
              </Text>
            ) : null}
          </>
        )}

        {error ? <Text style={styles.error}>{error}</Text> : null}
      </View>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg, justifyContent: 'space-between' },
  hero: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md },
  logo: { width: 96, height: 96 },
  // Clash Display is wider and tighter-fitting than Playfair, so it wants
  // negative tracking to match the mark's set width rather than Playfair's 0.5.
  wordmark: { fontFamily: fonts.wordmark, fontSize: 46, color: colors.ink, letterSpacing: -1 },
  tagline: { fontFamily: fonts.bodyMedium, fontSize: 15, color: colors.inkTertiary },
  actions: { padding: spacing.xl, gap: spacing.md, alignItems: 'stretch' },
  googleBtn: {
    backgroundColor: colors.green,
    borderRadius: radii.lg,
    paddingVertical: 16,
    alignItems: 'center',
  },
  googleBtnText: { fontFamily: fonts.bodySemiBold, fontSize: 16, color: '#ffffff' },
  appleBtn: { height: 52, width: '100%' },
  devBtn: {
    borderRadius: radii.lg,
    paddingVertical: 14,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.raised,
  },
  devBtnText: { fontFamily: fonts.bodyMedium, fontSize: 14, color: colors.inkSecondary },
  hint: { fontFamily: fonts.body, fontSize: 13, color: colors.inkTertiary, textAlign: 'center' },
  error: { fontFamily: fonts.body, fontSize: 13, color: '#b91c1c', textAlign: 'center' },
})
