// Settings — a bottom sheet off the Profile banner. It carries the profile
// itself (name, picture, the three picks) and, its other main job, sign-in
// methods: an account reached only through Apple and one reached only through
// Google are two different accounts, so linking both here is what lets someone
// come back either way (see the Hide My Email note in mobile/TESTFLIGHT.md).
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native'
import * as Google from 'expo-auth-session/providers/google'
import * as AppleAuthentication from 'expo-apple-authentication'
import * as ImagePicker from 'expo-image-picker'
import { Image } from 'expo-image'
import { useRouter } from 'expo-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Apple, Check, ChevronRight, LogOut, Trash2, X } from 'lucide-react-native'
import { fetchLinkedProviders, unlinkProvider, deleteOwnAccount } from '../lib/api'
import { currentPushToken, enablePush, pushPermissionStatus } from '../lib/push'
import { useAuth } from '../lib/auth'
import { useProfile } from '../lib/picks'
import { colors, fonts, radii, spacing, NUM_SCALE_CAP } from '../theme/tokens'

// The server owns the avatar's final shape — it crops, resizes to 512², strips
// EXIF and re-encodes — so this only has to hand it something reasonable.
// `quality` is the one lever worth pulling here: uploads travel as base64, so
// every byte costs a third more on the wire, and a camera-roll original is
// several megabytes before compression.
const AVATAR_UPLOAD_QUALITY = 0.8

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
  const { user, signOut, linkGoogleToken, linkAppleToken, updateProfile, uploadAvatarImage, removeAvatar } = useAuth()
  const [pushState, setPushState] = useState<'granted' | 'denied' | 'undetermined'>('undetermined')
  const [pushBusy, setPushBusy] = useState(false)
  const [pushToken, setPushToken] = useState<string | null>(null)

  useEffect(() => {
    if (!visible) return
    pushPermissionStatus().then((st) => {
      setPushState(st)
      setPushToken(currentPushToken())
    })
  }, [visible])

  async function turnOnPush() {
    setPushBusy(true)
    try {
      const ok = await enablePush()
      setPushState(ok ? 'granted' : 'denied')
      setPushToken(currentPushToken())
    } finally {
      setPushBusy(false)
    }
  }
  const router = useRouter()
  const qc = useQueryClient()
  const [busy, setBusy] = useState<'google' | 'apple' | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [appleAvailable, setAppleAvailable] = useState(false)
  const [nameDraft, setNameDraft] = useState<string | null>(null) // non-null while editing
  const [savingName, setSavingName] = useState(false)
  const [avatarBusy, setAvatarBusy] = useState(false)
  // Reset each time the sheet comes back up; see openPicker.
  const navigatingRef = useRef(false)
  useEffect(() => {
    if (visible) navigatingRef.current = false
  }, [visible])
  const { data: profile } = useProfile(visible ? user?.id : undefined)
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

  async function saveName() {
    const next = (nameDraft ?? '').trim()
    if (!next || next === user?.name) {
      setNameDraft(null)
      return
    }
    setSavingName(true)
    setError(null)
    try {
      await updateProfile({ name: next })
      setNameDraft(null)
    } catch (e) {
      // Names are unique, so this is usually "already taken" — worth showing
      // verbatim rather than flattening to a generic failure.
      setError(e instanceof Error ? e.message : 'Could not save your name')
    } finally {
      setSavingName(false)
    }
  }

  /** Pick a square from the library and send it up.
   *
   *  `allowsEditing` gives the user the crop rather than letting the server
   *  guess at one — the server's centre-crop is the fallback for whatever it
   *  receives, not the intended framing. Asking the picker for base64 avoids
   *  reading the file back off disk separately.
   */
  async function pickAvatar() {
    setError(null)
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: AVATAR_UPLOAD_QUALITY,
      base64: true,
    })
    if (result.canceled || !result.assets[0]) return
    const asset = result.assets[0]
    if (!asset.base64) {
      setError('Could not read that image')
      return
    }
    setAvatarBusy(true)
    try {
      await uploadAvatarImage({
        base64: asset.base64,
        contentType: asset.mimeType ?? 'image/jpeg',
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not set your picture')
    } finally {
      setAvatarBusy(false)
    }
  }

  async function clearAvatar() {
    setAvatarBusy(true)
    setError(null)
    try {
      await removeAvatar()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not remove your picture')
    } finally {
      setAvatarBusy(false)
    }
  }

  /** The pickers are full screens, and this sheet sits above the navigator —
   *  so it has to get out of the way before the push lands, and it has to stop
   *  taking taps in the gap while it animates out. Without the guard a second
   *  tap opens a second picker behind the first. */
  function openPicker(kind: 'song' | 'album' | 'artist') {
    if (navigatingRef.current) return
    navigatingRef.current = true
    onClose()
    router.push(`/favorite/${kind}`)
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
            <Text style={styles.sectionLabel}>PROFILE</Text>

            <View style={styles.avatarRow}>
              <Pressable onPress={pickAvatar} disabled={avatarBusy} accessibilityLabel="Change profile picture">
                <View style={styles.avatar}>
                  {user?.avatarUrl ? (
                    <Image
                      source={{ uri: user.avatarUrl }}
                      style={styles.avatarImg}
                      contentFit="cover"
                      cachePolicy="memory-disk"
                      // Keyed on the URL so a fresh upload's ?v= stamp swaps the
                      // picture instead of the old one lingering in the cache.
                      recyclingKey={user.avatarUrl}
                    />
                  ) : (
                    <Text style={styles.avatarInitial} numberOfLines={1} adjustsFontSizeToFit maxFontSizeMultiplier={NUM_SCALE_CAP}>{user?.name[0]?.toUpperCase()}</Text>
                  )}
                </View>
              </Pressable>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.providerLabel}>Profile picture</Text>
                <Text style={styles.notConnectedText}>
                  {user?.avatarUrl ? 'Shown on your profile and in the feed' : 'No picture set'}
                </Text>
              </View>
              {avatarBusy ? (
                <ActivityIndicator color={colors.green} />
              ) : (
                <View style={styles.avatarActions}>
                  <Pressable onPress={pickAvatar} hitSlop={8}>
                    <Text style={styles.linkAction}>{user?.avatarUrl ? 'Change' : 'Add'}</Text>
                  </Pressable>
                  {user?.avatarUrl ? (
                    <Pressable onPress={clearAvatar} hitSlop={8}>
                      <Text style={styles.removeText}>Remove</Text>
                    </Pressable>
                  ) : null}
                </View>
              )}
            </View>

            {/* Display name edits in place rather than on its own screen — it's
                one field, and the name is right there to check against. */}
            <View style={styles.settingRow}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.providerLabel}>Display name</Text>
                {nameDraft === null ? (
                  <Text style={styles.settingValue} numberOfLines={1}>{user?.name}</Text>
                ) : (
                  <TextInput
                    style={styles.nameInput}
                    value={nameDraft}
                    onChangeText={setNameDraft}
                    autoFocus
                    autoCorrect={false}
                    maxLength={40}
                    returnKeyType="done"
                    onSubmitEditing={saveName}
                    placeholder="Your name"
                    placeholderTextColor={colors.inkTertiary}
                  />
                )}
              </View>
              {savingName ? (
                <ActivityIndicator color={colors.green} />
              ) : nameDraft === null ? (
                <Pressable onPress={() => setNameDraft(user?.name ?? '')} hitSlop={8}>
                  <Text style={styles.linkAction}>Edit</Text>
                </Pressable>
              ) : (
                <View style={styles.avatarActions}>
                  <Pressable onPress={() => setNameDraft(null)} hitSlop={8}>
                    <Text style={styles.removeText}>Cancel</Text>
                  </Pressable>
                  <Pressable onPress={saveName} hitSlop={8}>
                    <Text style={styles.linkAction}>Save</Text>
                  </Pressable>
                </View>
              )}
            </View>

            <Text style={styles.sectionLabel}>MY PICKS</Text>
            {/* Nothing is offered until the lock state is known: the rows would
                otherwise flash as tappable and then 403 on save. */}
            {!profile ? (
              <ActivityIndicator color={colors.green} style={{ marginVertical: spacing.lg }} />
            ) : !profile.picks_unlocked ? (
              <Text style={styles.sectionHint}>
                Rate {Math.max(0, profile.picks_required - profile.picks_rated_count)} more{' '}
                {profile.picks_required - profile.picks_rated_count === 1 ? 'album' : 'albums'} to
                choose your favourite song, album and artist.
              </Text>
            ) : (
              <>
                <PickSettingRow
                  label="Favourite song"
                  value={profile?.favorite_song?.title}
                  onPress={() => openPicker('song')}
                />
                <PickSettingRow
                  label="Favourite album"
                  value={profile?.favorite_album?.album_name}
                  onPress={() => openPicker('album')}
                />
                <PickSettingRow
                  label="Favourite artist"
                  value={profile?.favorite_artist}
                  onPress={() => openPicker('artist')}
                />
              </>
            )}

            <Text style={styles.sectionLabel}>NOTIFICATIONS</Text>
            <Text style={styles.sectionHint}>
              Get told when a friend sends you a record. iOS only asks once, so if you
              turn this down you&rsquo;ll have to re-enable it in the Settings app.
            </Text>
            <View style={styles.pushRow}>
              <Text style={styles.pushLabel}>
                {pushState === 'granted'
                  ? 'On'
                  : pushState === 'denied'
                    ? 'Blocked in iOS Settings'
                    : 'Off'}
              </Text>
              {pushBusy ? (
                <ActivityIndicator color={colors.green} />
              ) : pushState === 'undetermined' ? (
                <Pressable onPress={turnOnPush} hitSlop={8}>
                  <Text style={styles.linkAction}>Turn on</Text>
                </Pressable>
              ) : null}
            </View>
            {__DEV__ && pushToken ? (
              // Dev only. Reading a token out of a log is miserable, and this is
              // the value a Firebase test send needs.
              <Pressable onPress={() => Share.share({ message: pushToken })}>
                <Text style={styles.sectionHint} numberOfLines={2}>
                  tap to send FCM token: {pushToken.slice(0, 24)}…
                </Text>
              </Pressable>
            ) : null}

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

/** One pick, showing what's currently set and opening its picker. The picks
 *  row on the banner is the other way in; this is the one you find by looking. */
function PickSettingRow({
  label,
  value,
  onPress,
}: {
  label: string
  value?: string | null
  onPress: () => void
}) {
  return (
    <Pressable style={styles.settingRow} onPress={onPress} accessibilityRole="button">
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={styles.providerLabel}>{label}</Text>
        <Text style={[styles.settingValue, !value && styles.settingValueEmpty]} numberOfLines={1}>
          {value || 'Not set'}
        </Text>
      </View>
      <ChevronRight size={17} color={colors.inkMuted} />
    </Pressable>
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

  // Matches providerRow's shape so the two sections read as siblings.
  pushRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    backgroundColor: colors.raised,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    marginBottom: spacing.sm,
  },
  pushLabel: { flex: 1, minWidth: 0, fontFamily: fonts.bodyMedium, fontSize: 15, color: colors.ink },

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

  // Profile rows share the provider row's card so the sheet reads as one list.
  settingRow: {
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
  settingValue: { fontFamily: fonts.body, fontSize: 12.5, color: colors.inkSecondary, marginTop: 1 },
  settingValueEmpty: { color: colors.inkTertiary },
  nameInput: {
    fontFamily: fonts.body,
    fontSize: 14,
    color: colors.ink,
    paddingVertical: 2,
    marginTop: 1,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  avatarRow: {
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
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.inset,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  avatarImg: { width: '100%', height: '100%' },
  avatarInitial: { fontFamily: fonts.display, fontSize: 20, color: colors.green },
  avatarActions: { alignItems: 'flex-end', gap: 4 },
  linkAction: { fontFamily: fonts.bodySemiBold, fontSize: 13, color: colors.green },
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
