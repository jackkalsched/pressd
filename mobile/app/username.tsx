// Username — the first screen a new account meets, before the tutorial. The
// server starts every account on a suggestion made from the provider's name
// or email (backend/usernames.py), so this opens prefilled; Continue saves it,
// changed or not, and saving is what stamps PressUser.username_chosen_at.
//
// The gate in (tabs)/_layout sends only an explicit usernameChosen === false
// here, so accounts from before this step never see it.
import { useState } from 'react'
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { cleanUsername, USERNAME_RE } from '@pressd/shared/types'
import { useAuth } from '../lib/auth'
import { colors, fonts, radii, spacing } from '../theme/tokens'

export default function UsernameScreen() {
  const router = useRouter()
  const { user, updateProfile } = useAuth()
  const [value, setValue] = useState(() => cleanUsername(user?.name ?? ''))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const valid = USERNAME_RE.test(value)

  async function save() {
    if (!valid || saving) return
    setSaving(true)
    setError(null)
    try {
      await updateProfile({ name: value })
      router.replace('/(tabs)')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save your username')
      setSaving(false)
    }
  }

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      <KeyboardAvoidingView style={styles.body} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.top}>
          <Text style={styles.eyebrow}>WELCOME TO PRESSD</Text>
          <Text style={styles.title}>Pick a username.</Text>

          <View style={[styles.field, error ? styles.fieldError : valid && styles.fieldActive]}>
            <Text style={styles.at}>@</Text>
            <TextInput
              style={styles.input}
              value={value}
              onChangeText={(t) => {
                setValue(cleanUsername(t))
                setError(null)
              }}
              autoFocus
              autoCapitalize="none"
              autoCorrect={false}
              spellCheck={false}
              textContentType="username"
              returnKeyType="done"
              onSubmitEditing={save}
              maxLength={20}
              placeholder="username"
              placeholderTextColor={colors.inkMuted}
              accessibilityLabel="Username"
            />
          </View>
          {error ? <Text style={styles.error}>{error}</Text> : null}
        </View>

        <Pressable
          onPress={save}
          disabled={!valid || saving}
          accessibilityRole="button"
          style={({ pressed }) => [
            styles.cta,
            (!valid || saving) && styles.ctaDisabled,
            pressed && valid && { backgroundColor: colors.greenPressed },
          ]}
        >
          {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.ctaText}>Continue</Text>}
        </Pressable>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  body: { flex: 1, paddingHorizontal: spacing.xl, paddingBottom: spacing.lg },
  top: { flex: 1, justifyContent: 'center' },
  eyebrow: {
    fontFamily: fonts.bodyBold,
    fontSize: 11,
    color: colors.green,
    letterSpacing: 1.9,
    textAlign: 'center',
  },
  title: {
    fontFamily: fonts.bodyBold,
    fontSize: 31,
    lineHeight: 37,
    letterSpacing: -0.6,
    color: colors.ink,
    textAlign: 'center',
    marginTop: spacing.sm,
  },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    marginTop: spacing.xl,
    paddingHorizontal: spacing.md,
    height: 52,
    backgroundColor: colors.raised,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  fieldActive: { borderColor: colors.green },
  fieldError: { borderColor: '#c0392b' },
  at: { fontFamily: fonts.bodySemiBold, fontSize: 16, color: colors.inkMuted },
  input: { flex: 1, fontFamily: fonts.bodySemiBold, fontSize: 16, color: colors.ink, paddingVertical: 0 },
  error: { fontFamily: fonts.body, fontSize: 12.5, color: '#c0392b', textAlign: 'center', marginTop: spacing.sm },
  cta: {
    alignItems: 'center',
    justifyContent: 'center',
    height: 52,
    borderRadius: radii.md,
    backgroundColor: colors.green,
  },
  ctaDisabled: { opacity: 0.4 },
  ctaText: { fontFamily: fonts.bodySemiBold, fontSize: 15.5, color: '#fff' },
})
