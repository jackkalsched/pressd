// The one-time ask for notifications, at launch, after every other first-run
// screen and prompt has had its turn (app/_layout.tsx).
//
// Until November 2026 the app never asked: the only way in was Settings →
// Notifications → Turn on, so two accounts of 110 had a device registered. iOS
// shows its own permission dialog once per install and never again, so this
// sheet says what the notifications are for first and only then lets iOS ask.
// It is shown only while iOS still hasn't asked (`pushPermissionStatus`
// 'undetermined'), and once per device either way (`prefs.pushPromptAnswered`):
// Not now is an answer too, and Settings stays the way back.
import { useState } from 'react'
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Bell } from 'lucide-react-native'
import { enablePush } from '../lib/push'
import { setPref } from '../lib/prefs'
import { success } from '../lib/haptics'
import { colors, fonts, radii, spacing, useColors } from '../theme/tokens'
import VinylSpinner from './VinylSpinner'

export default function NotifyPromptSheet({ visible }: { visible: boolean }) {
  const tc = useColors()
  const insets = useSafeAreaInsets()
  const [busy, setBusy] = useState(false)

  async function turnOn() {
    setBusy(true)
    try {
      // iOS's own dialog. Whatever's chosen there, this sheet's question has
      // been answered and doesn't come back.
      if (await enablePush()) success()
    } finally {
      setPref('pushPromptAnswered', true)
      setBusy(false)
    }
  }

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={() => {}}>
      <View style={styles.backdrop}>
        <View style={[styles.sheet, { paddingBottom: insets.bottom + spacing.lg }]}>
          <View style={[styles.grabber, { backgroundColor: tc.border }]} />
          <View style={styles.icon}>
            <Bell size={18} color={tc.green} />
          </View>
          <Text style={styles.title}>Want to receive notifications?</Text>
          <Text style={styles.body}>
            Get notified when a friend recommends you an album, reviews one you’ve already rated,
            or tells you your takes are terrible.
          </Text>
          <Pressable
            style={[styles.primary, busy && styles.primaryOff]}
            onPress={turnOn}
            disabled={busy}
            accessibilityRole="button"
          >
            {busy ? <VinylSpinner /> : <Text style={styles.primaryText}>Turn on notifications</Text>}
          </Pressable>
          <Pressable
            style={styles.secondary}
            onPress={() => setPref('pushPromptAnswered', true)}
            disabled={busy}
            accessibilityRole="button"
          >
            <Text style={styles.secondaryText}>Not now</Text>
          </Pressable>
        </View>
      </View>
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
  grabber: { alignSelf: 'center', width: 38, height: 4, borderRadius: 2, marginBottom: spacing.lg },
  icon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.greenSoft,
  },
  title: { fontFamily: fonts.display, fontSize: 28, lineHeight: 34, color: colors.ink, marginTop: spacing.md },
  body: { fontFamily: fonts.body, fontSize: 14.5, lineHeight: 21, color: colors.inkSecondary, marginTop: 6 },
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
})
