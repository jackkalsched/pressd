// Settings — a bottom sheet off the Profile banner. Its main job is sign-in
// methods: an account reached only through Apple and one reached only through
// Google are two different accounts, so linking both here is what lets someone
// come back either way (see the Hide My Email note in mobile/TESTFLIGHT.md).
import { useCallback, useEffect, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native'
import * as Google from 'expo-auth-session/providers/google'
import * as AppleAuthentication from 'expo-apple-authentication'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Apple, Check, LogOut, Trash2, X } from 'lucide-react-native'
import { fetchLinkedProviders, unlinkProvider, deleteOwnAccount } from '../lib/api'
import { useAuth } from '../lib/auth'
import { colors, fonts, radii, spacing } from '../theme/tokens'

const GOOGLE_IOS_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID

/** Mirrors the sign-in screen: `Google.useAuthRequest` throws on native when no
 *  platform client id is configured, so it may only mount once one exists. */
function GoogleConnectButton({
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
    <Pressable style={styles.connectBtn} disabled={!request} onPress={() => promptAsync()}>
      <Text style={styles.connectBtnText}>Connect</Text>
    </Pressable>
  )
}

export default function SettingsSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { user, signOut, linkGoogleToken, linkAppleToken } = useAuth()
  const qc = useQueryClient()
  const [busy, setBusy] = useState<'google' | 'apple' | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [appleAvailable, setAppleAvailable] = useState(false)
  // Sized to the device rather than a fixed height: with the danger zone added,
  // a constant cap pushed "Delete my account" below the fold on every phone.
  const { height: screenH } = useWindowDimensions()

  useEffect(() => {
    if (Platform.OS === 'ios') AppleAuthentication.isAvailableAsync().then(setAppleAvailable).catch(() => {})
  }, [])

  // Only fetched while open — a closed sheet should not poll the account.
  const { data: providers, isLoading } = useQuery({
    queryKey: ['linked-providers'],
    queryFn: fetchLinkedProviders,
    enabled: visible,
  })

  const refresh = useCallback(() => {
    qc.invalidateQueries({ queryKey: ['linked-providers'] })
  }, [qc])

  const handleGoogleToken = useCallback(
    (accessToken: string) => {
      setBusy('google')
      setError(null)
      linkGoogleToken(accessToken)
        .then(refresh)
        .catch((e: Error) => setError(e.message))
        .finally(() => setBusy(null))
    },
    [linkGoogleToken, refresh],
  )

  async function handleAppleConnect() {
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
      setBusy('apple')
      await linkAppleToken(cred.identityToken, fullName)
      refresh()
    } catch (e) {
      if (e instanceof Error && e.message.includes('canceled')) return
      setError(e instanceof Error ? e.message : 'Apple sign-in failed')
    } finally {
      setBusy(null)
    }
  }

  async function handleUnlink(provider: 'google' | 'apple') {
    setBusy(provider)
    setError(null)
    try {
      await unlinkProvider(provider)
      refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to remove')
    } finally {
      setBusy(null)
    }
  }

  /** Two taps and a destructive-styled native alert stand between a stray tap
   *  and an irreversible delete. Nothing is sent until "Delete" is chosen. */
  function confirmDelete() {
    Alert.alert(
      'Delete account?',
      'Are you sure you want to delete your account? This is a permanent action and your data will be unretrievable.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: runDelete },
      ],
    )
  }

  async function runDelete() {
    setDeleting(true)
    setError(null)
    try {
      await deleteOwnAccount()
      // The token is dead server-side; drop the local session so the app
      // returns to the sign-in screen rather than 401-ing on every screen.
      onClose()
      signOut()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete account')
    } finally {
      setDeleting(false)
    }
  }

  const linkedCount = (providers?.google ? 1 : 0) + (providers?.apple ? 1 : 0)

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet}>
          <View style={styles.sheetHead}>
            <Text style={styles.sheetTitle}>Settings</Text>
            <Pressable onPress={onClose} hitSlop={12} accessibilityLabel="Close settings">
              <X size={20} color={colors.inkTertiary} />
            </Pressable>
          </View>

          <ScrollView style={{ maxHeight: screenH * 0.68 }} showsVerticalScrollIndicator={false}>
            <Text style={styles.sectionLabel}>SIGN-IN METHODS</Text>
            <Text style={styles.sectionHint}>
              Connect both and you can sign back in with either one. With only one connected,
              signing in the other way creates a separate, empty account.
            </Text>

            {isLoading ? (
              <ActivityIndicator color={colors.green} style={{ marginVertical: spacing.lg }} />
            ) : (
              <>
                <ProviderRow
                  icon={<Apple size={19} color={colors.ink} fill={colors.ink} />}
                  label="Apple"
                  linked={!!providers?.apple}
                  busy={busy === 'apple'}
                  // Unlinking the only remaining method would lock the account
                  // out for good, so the control disappears rather than erroring.
                  canUnlink={linkedCount > 1}
                  onUnlink={() => handleUnlink('apple')}
                  connect={
                    appleAvailable ? (
                      <Pressable style={styles.connectBtn} onPress={handleAppleConnect}>
                        <Text style={styles.connectBtnText}>Connect</Text>
                      </Pressable>
                    ) : (
                      <Text style={styles.unavailable}>Unavailable</Text>
                    )
                  }
                />

                <ProviderRow
                  icon={<Text style={styles.googleGlyph}>G</Text>}
                  label="Google"
                  linked={!!providers?.google}
                  busy={busy === 'google'}
                  canUnlink={linkedCount > 1}
                  onUnlink={() => handleUnlink('google')}
                  connect={
                    GOOGLE_IOS_CLIENT_ID ? (
                      <GoogleConnectButton onToken={handleGoogleToken} onError={setError} />
                    ) : (
                      <Text style={styles.unavailable}>Not set up</Text>
                    )
                  }
                />
              </>
            )}

            {providers?.email ? (
              <>
                <Text style={styles.sectionLabel}>ACCOUNT</Text>
                <View style={styles.emailRow}>
                  <Text style={styles.emailText} numberOfLines={1}>{providers.email}</Text>
                </View>
                {providers.email.endsWith('privaterelay.appleid.com') ? (
                  <Text style={styles.sectionHint}>
                    Apple is forwarding a private address. Connecting Google will not match it
                    automatically, so link it here rather than signing in with it.
                  </Text>
                ) : null}
              </>
            ) : null}

            {error ? <Text style={styles.error}>{error}</Text> : null}

            <Pressable
              style={styles.signOutBtn}
              onPress={() => {
                onClose()
                signOut()
              }}
            >
              <LogOut size={17} color="#b91c1c" />
              <Text style={styles.signOutText}>Sign out</Text>
            </Pressable>

            <Text style={styles.sectionLabel}>DANGER ZONE</Text>
            <Text style={styles.sectionHint}>
              Deleting removes your ratings, reviews, comments, and friend connections for good.
              There is no way to undo it or get the data back.
            </Text>
            <Pressable style={styles.deleteBtn} onPress={confirmDelete} disabled={deleting}>
              {deleting ? (
                <ActivityIndicator color="#b91c1c" />
              ) : (
                <>
                  <Trash2 size={16} color="#b91c1c" />
                  <Text style={styles.deleteText}>Delete my account</Text>
                </>
              )}
            </Pressable>

            {user ? <Text style={styles.idHint}>Signed in as {user.name}</Text> : null}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  )
}

function ProviderRow({
  icon,
  label,
  linked,
  busy,
  canUnlink,
  onUnlink,
  connect,
}: {
  icon: React.ReactNode
  label: string
  linked: boolean
  busy: boolean
  canUnlink: boolean
  onUnlink: () => void
  connect: React.ReactNode
}) {
  return (
    <View style={styles.providerRow}>
      <View style={styles.providerIcon}>{icon}</View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={styles.providerLabel}>{label}</Text>
        {linked ? (
          <View style={styles.connectedRow}>
            <Check size={13} color={colors.green} />
            <Text style={styles.connectedText}>Connected</Text>
          </View>
        ) : (
          <Text style={styles.notConnectedText}>Not connected</Text>
        )}
      </View>
      {busy ? (
        <ActivityIndicator color={colors.green} />
      ) : linked ? (
        canUnlink ? (
          <Pressable onPress={onUnlink} hitSlop={8}>
            <Text style={styles.removeText}>Remove</Text>
          </Pressable>
        ) : (
          <Text style={styles.onlyMethod}>Only method</Text>
        )
      ) : (
        connect
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(28,25,23,0.35)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.bg,
    borderTopLeftRadius: radii.xl,
    borderTopRightRadius: radii.xl,
    padding: spacing.xl,
    paddingBottom: spacing.xxl + spacing.lg,
  },
  sheetHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sheetTitle: { fontFamily: fonts.display, fontSize: 22, color: colors.ink },

  sectionLabel: {
    fontFamily: fonts.bodyBold,
    fontSize: 10,
    letterSpacing: 1,
    color: colors.inkMuted,
    marginTop: spacing.xl,
    marginBottom: spacing.xs,
  },
  sectionHint: {
    fontFamily: fonts.body,
    fontSize: 12.5,
    lineHeight: 18,
    color: colors.inkTertiary,
    marginBottom: spacing.sm,
  },

  providerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.raised,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    padding: spacing.md,
    marginTop: spacing.sm,
  },
  providerIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.inset,
    alignItems: 'center',
    justifyContent: 'center',
  },
  googleGlyph: { fontFamily: fonts.bodyBold, fontSize: 17, color: colors.ink },
  providerLabel: { fontFamily: fonts.bodySemiBold, fontSize: 15, color: colors.ink },
  connectedRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 1 },
  connectedText: { fontFamily: fonts.bodyMedium, fontSize: 12.5, color: colors.green },
  notConnectedText: { fontFamily: fonts.body, fontSize: 12.5, color: colors.inkTertiary, marginTop: 1 },

  connectBtn: {
    backgroundColor: colors.green,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.lg,
    paddingVertical: 8,
  },
  connectBtnText: { fontFamily: fonts.bodySemiBold, fontSize: 13, color: '#ffffff' },
  removeText: { fontFamily: fonts.bodyMedium, fontSize: 13, color: colors.inkTertiary },
  onlyMethod: { fontFamily: fonts.body, fontSize: 12, color: colors.inkMuted },
  unavailable: { fontFamily: fonts.body, fontSize: 12, color: colors.inkMuted },

  emailRow: {
    backgroundColor: colors.raised,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    padding: spacing.md,
  },
  emailText: { fontFamily: fonts.body, fontSize: 13.5, color: colors.inkSecondary },

  error: {
    fontFamily: fonts.bodyMedium,
    fontSize: 13,
    color: '#b91c1c',
    marginTop: spacing.md,
  },

  signOutBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    marginTop: spacing.xl,
    paddingVertical: 14,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: '#f0d5d5',
    backgroundColor: '#fdf5f5',
  },
  signOutText: { fontFamily: fonts.bodySemiBold, fontSize: 15, color: '#b91c1c' },

  // Outlined rather than filled: destructive, but it should not compete with
  // Sign out for attention.
  deleteBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    marginTop: spacing.sm,
    paddingVertical: 13,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: '#e7cccc',
  },
  deleteText: { fontFamily: fonts.bodySemiBold, fontSize: 14.5, color: '#b91c1c' },
  idHint: {
    fontFamily: fonts.body,
    fontSize: 11.5,
    color: colors.inkMuted,
    textAlign: 'center',
    marginTop: spacing.md,
  },
})
