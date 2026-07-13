import { useEffect, useState } from 'react'
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Image } from 'expo-image'
import * as WebBrowser from 'expo-web-browser'
import * as Google from 'expo-auth-session/providers/google'
import { useAuth } from '../lib/auth'
import { colors, fonts, radii, spacing } from '../theme/tokens'

WebBrowser.maybeCompleteAuthSession()

const DEV_TOKEN = process.env.EXPO_PUBLIC_DEV_TOKEN

export default function SignIn() {
  const { signInWithGoogleToken, signInWithDevToken } = useAuth()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [request, response, promptAsync] = Google.useAuthRequest({
    iosClientId: process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID,
    webClientId: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID,
  })

  useEffect(() => {
    const accessToken = response?.type === 'success' ? response.authentication?.accessToken : null
    if (!accessToken) return
    setBusy(true)
    signInWithGoogleToken(accessToken)
      .catch((e: Error) => setError(e.message))
      .finally(() => setBusy(false))
  }, [response, signInWithGoogleToken])

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
        <Text style={styles.wordmark}>Press'd</Text>
        <Text style={styles.tagline}>Rate albums. Track your taste.</Text>
      </View>

      <View style={styles.actions}>
        {busy ? (
          <ActivityIndicator color={colors.green} />
        ) : (
          <>
            <Pressable
              style={({ pressed }) => [styles.googleBtn, pressed && { backgroundColor: colors.greenPressed }]}
              disabled={!request}
              onPress={() => promptAsync()}
            >
              <Text style={styles.googleBtnText}>Continue with Google</Text>
            </Pressable>

            {DEV_TOKEN ? (
              <Pressable style={styles.devBtn} onPress={handleDevToken}>
                <Text style={styles.devBtnText}>Continue with dev token</Text>
              </Pressable>
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
  wordmark: { fontFamily: fonts.displayBlack, fontSize: 44, color: colors.ink, letterSpacing: 0.5 },
  tagline: { fontFamily: fonts.bodyMedium, fontSize: 15, color: colors.inkTertiary },
  actions: { padding: spacing.xl, gap: spacing.md, alignItems: 'stretch' },
  googleBtn: {
    backgroundColor: colors.green,
    borderRadius: radii.lg,
    paddingVertical: 16,
    alignItems: 'center',
  },
  googleBtnText: { fontFamily: fonts.bodySemiBold, fontSize: 16, color: '#ffffff' },
  devBtn: {
    borderRadius: radii.lg,
    paddingVertical: 14,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.raised,
  },
  devBtnText: { fontFamily: fonts.bodyMedium, fontSize: 14, color: colors.inkSecondary },
  error: { fontFamily: fonts.body, fontSize: 13, color: '#b91c1c', textAlign: 'center' },
})
