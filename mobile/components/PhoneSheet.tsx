// Adding a phone number: the number, then the texted code.
//
// Two ways in, one sheet. `prompt` is the one-time ask every account meets once
// (app/_layout.tsx) — it explains why and offers "Not now", which is recorded
// as a skip. `settings` is the same flow from Settings → Account, with a close
// button instead, because someone who opened it chose to.
//
// The number goes to Firebase, never to Pressd: Firebase texts the code and
// checks it, and the ID token it returns is what the server stores the number
// from (lib/phoneVerify.ts, backend/phone.py).
//
// Like What's New, the prompt can't be dismissed by a tap outside or a swipe —
// it appears once, and a stray tap would record a decision nobody made.
import { useRef, useState } from 'react'
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Phone, X } from 'lucide-react-native'
import { toE164 } from '@pressd/shared/api'
import { useAuth } from '../lib/auth'
import { success } from '../lib/haptics'
import { sendPhoneCode } from '../lib/phoneVerify'
import { colors, fonts, radii, spacing, NUM_SCALE_CAP } from '../theme/tokens'

type Step = 'number' | 'code'

/** +15551234567 → +1 (555) 123-4567, for saying where the code went. */
function pretty(e164: string): string {
  const m = e164.match(/^\+1(\d{3})(\d{3})(\d{4})$/)
  return m ? `+1 (${m[1]}) ${m[2]}-${m[3]}` : e164
}

export default function PhoneSheet({
  visible,
  mode,
  onClose,
}: {
  visible: boolean
  mode: 'prompt' | 'settings'
  onClose: () => void
}) {
  const insets = useSafeAreaInsets()
  const { addPhoneNumber, skipPhoneNumber } = useAuth()
  const [step, setStep] = useState<Step>('number')
  const [number, setNumber] = useState('')
  const [code, setCode] = useState('')
  const [sentTo, setSentTo] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const confirmRef = useRef<((code: string) => Promise<string>) | null>(null)

  // A fresh start each time it opens — reset while rendering the opening, so
  // the sheet never shows a frame of the last attempt.
  const [wasVisible, setWasVisible] = useState(visible)
  if (visible !== wasVisible) {
    setWasVisible(visible)
    if (visible) {
      setStep('number')
      setCode('')
      setError(null)
      setBusy(false)
    }
  }

  async function send(to: string) {
    setBusy(true)
    setError(null)
    try {
      confirmRef.current = await sendPhoneCode(to)
      setSentTo(to)
      setCode('')
      setStep('code')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Couldn’t send a code')
    } finally {
      setBusy(false)
    }
  }

  function submitNumber() {
    const e164 = toE164(number)
    if (!e164) {
      setError('Enter a 10-digit number, or start with + and the country code.')
      return
    }
    send(e164)
  }

  async function submitCode() {
    if (!confirmRef.current || code.trim().length < 6) return
    setBusy(true)
    setError(null)
    try {
      const token = await confirmRef.current(code)
      await addPhoneNumber(token)
      success()
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Couldn’t verify that code')
    } finally {
      setBusy(false)
    }
  }

  async function notNow() {
    onClose()
    await skipPhoneNumber()
  }

  const prompt = mode === 'prompt'

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={prompt ? () => {} : onClose}>
      <KeyboardAvoidingView style={styles.backdrop} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={[styles.sheet, { paddingBottom: insets.bottom + spacing.lg }]}>
          <View style={styles.grabber} />

          <View style={styles.headRow}>
            <View style={styles.icon}>
              <Phone size={18} color={colors.green} />
            </View>
            {!prompt && (
              <Pressable onPress={onClose} hitSlop={12} accessibilityLabel="Close">
                <X size={20} color={colors.inkTertiary} />
              </Pressable>
            )}
          </View>

          {step === 'number' ? (
            <>
              <Text style={styles.title}>{prompt ? 'Add your phone number' : 'Phone number'}</Text>
              <Text style={styles.body}>
                Pressd uses it to help your friends find you, and to make sharing records with them
                easier. It’s never shown on your profile.
              </Text>
              <TextInput
                style={styles.input}
                value={number}
                onChangeText={(t) => { setNumber(t); setError(null) }}
                placeholder="(555) 123-4567"
                placeholderTextColor={colors.inkMuted}
                keyboardType="phone-pad"
                textContentType="telephoneNumber"
                autoComplete="tel"
                autoFocus={!prompt}
                returnKeyType="send"
                onSubmitEditing={submitNumber}
                editable={!busy}
                maxFontSizeMultiplier={NUM_SCALE_CAP}
              />
              {error && <Text style={styles.error}>{error}</Text>}
              <Pressable
                style={[styles.primary, (busy || !number.trim()) && styles.primaryOff]}
                onPress={submitNumber}
                disabled={busy || !number.trim()}
                accessibilityRole="button"
              >
                {busy ? <ActivityIndicator color="#ffffff" /> : <Text style={styles.primaryText}>Text me a code</Text>}
              </Pressable>
              {prompt && (
                <Pressable style={styles.secondary} onPress={notNow} disabled={busy} accessibilityRole="button">
                  <Text style={styles.secondaryText}>Not now</Text>
                </Pressable>
              )}
            </>
          ) : (
            <>
              <Text style={styles.title}>Enter the code</Text>
              <Text style={styles.body}>We texted a 6-digit code to {sentTo ? pretty(sentTo) : 'your phone'}.</Text>
              <TextInput
                style={[styles.input, styles.codeInput]}
                value={code}
                onChangeText={(t) => {
                  setCode(t.replace(/\D/g, '').slice(0, 6))
                  setError(null)
                }}
                placeholder="000000"
                placeholderTextColor={colors.inkMuted}
                keyboardType="number-pad"
                textContentType="oneTimeCode"
                autoComplete="sms-otp"
                autoFocus
                returnKeyType="done"
                onSubmitEditing={submitCode}
                editable={!busy}
                maxFontSizeMultiplier={NUM_SCALE_CAP}
              />
              {error && <Text style={styles.error}>{error}</Text>}
              <Pressable
                style={[styles.primary, (busy || code.length < 6) && styles.primaryOff]}
                onPress={submitCode}
                disabled={busy || code.length < 6}
                accessibilityRole="button"
              >
                {busy ? <ActivityIndicator color="#ffffff" /> : <Text style={styles.primaryText}>Verify</Text>}
              </Pressable>
              <View style={styles.codeLinks}>
                <Pressable onPress={() => { setStep('number'); setError(null) }} disabled={busy} hitSlop={8}>
                  <Text style={styles.link}>Change number</Text>
                </Pressable>
                <Pressable onPress={() => sentTo && send(sentTo)} disabled={busy || !sentTo} hitSlop={8}>
                  <Text style={styles.link}>Send a new code</Text>
                </Pressable>
              </View>
            </>
          )}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  )
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(28,25,23,0.45)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.bg,
    borderTopLeftRadius: radii.xl,
    borderTopRightRadius: radii.xl,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
  },
  grabber: {
    alignSelf: 'center',
    width: 38,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.border,
    marginBottom: spacing.lg,
  },
  headRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  icon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.greenSoft,
  },
  title: { fontFamily: fonts.display, fontSize: 28, color: colors.ink, marginTop: spacing.md },
  body: { fontFamily: fonts.body, fontSize: 14.5, lineHeight: 21, color: colors.inkSecondary, marginTop: 6 },
  input: {
    marginTop: spacing.lg,
    height: 52,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.raised,
    paddingHorizontal: spacing.md,
    fontFamily: fonts.bodyMedium,
    fontSize: 17,
    color: colors.ink,
  },
  codeInput: { fontFamily: fonts.bodySemiBold, fontSize: 22, letterSpacing: 6, textAlign: 'center' },
  error: { fontFamily: fonts.body, fontSize: 13, color: '#b91c1c', marginTop: spacing.sm },
  primary: {
    marginTop: spacing.lg,
    height: 52,
    borderRadius: radii.pill,
    backgroundColor: colors.green,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryOff: { opacity: 0.5 },
  primaryText: { fontFamily: fonts.bodySemiBold, fontSize: 16, color: '#ffffff' },
  secondary: { height: 46, alignItems: 'center', justifyContent: 'center', marginTop: spacing.xs },
  secondaryText: { fontFamily: fonts.bodySemiBold, fontSize: 15, color: colors.inkTertiary },
  codeLinks: { flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing.md },
  link: { fontFamily: fonts.bodySemiBold, fontSize: 14, color: colors.green },
})
