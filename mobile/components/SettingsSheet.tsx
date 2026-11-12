// Settings and Edit profile — one bottom sheet off the Profile banner, opened in
// one of two modes. Edit profile (the pencil) carries the profile itself:
// picture, banner, username, location, bio and the shelf. Settings (the
// gear) carries everything about the app and the account, chief among them
// sign-in methods: an account reached only through Apple and one reached only through
// Google are two different accounts, so linking both here is what lets someone
// come back either way (see the Hide My Email note in mobile/TESTFLIGHT.md).
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Alert,
  Animated,
  Easing,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native'
import VinylSpinner from './VinylSpinner'
import * as Google from 'expo-auth-session/providers/google'
import * as AppleAuthentication from 'expo-apple-authentication'
import * as ImagePicker from 'expo-image-picker'
import * as Linking from 'expo-linking'
import * as WebBrowser from 'expo-web-browser'
import Constants from 'expo-constants'
import { Image } from 'expo-image'
import { useRouter } from 'expo-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, LogOut, Trash2, X } from 'lucide-react-native'
import { fetchLinkedProviders, unlinkProvider, deleteOwnAccount, uploadBanner, deleteBanner, type Profile } from '../lib/api'
import { SHELF_SIZE, fetchBlockedUsers, fetchNotificationPrefs, unblockUser, updateNotificationPrefs, type NotificationPrefs } from '@pressd/shared/api'
import Avatar from './Avatar'
import { cleanUsername, type AlbumStatus } from '@pressd/shared/types'
import { setPref, usePrefs, type AppearancePref } from '../lib/prefs'
import { currentPushToken, enablePush, pushPermissionStatus } from '../lib/push'
import { useAuth } from '../lib/auth'
import { requestAppleCredential } from '../lib/appleSignIn'
import AppleLogo from './AppleLogo'
import PhoneSheet from './PhoneSheet'
import { profileKey, useProfile } from '../lib/picks'
import { colors, fonts, radii, spacing, NUM_SCALE_CAP, useColors } from '../theme/tokens'

// The server owns the avatar's final shape — it crops, resizes to 512², strips
// EXIF and re-encodes — so this only has to hand it something reasonable.
// `quality` is the one lever worth pulling here: uploads travel as base64, so
// every byte costs a third more on the wire, and a camera-roll original is
// several megabytes before compression.
const AVATAR_UPLOAD_QUALITY = 0.8
// The banner is stored 24:5 at 1920×400 and shown sharp across the top of the
// web profile (backend/routers/users.py, BANNER_SIZE), so it gets the avatar's
// quality rather than the rougher one a blurred-only banner could afford.
const BANNER_UPLOAD_QUALITY = 0.8

// The published pages (frontend/src/pages/Privacy.tsx, Terms.tsx,
// Guidelines.tsx), the support inbox, and the App Store's write-a-review page
// for this listing (frontend/src/lib/iosApp.ts has the same id).
const PRIVACY_URL = 'https://pressdmusic.com/privacy'
const TERMS_URL = 'https://pressdmusic.com/terms'
const GUIDELINES_URL = 'https://pressdmusic.com/guidelines'
const SUPPORT_EMAIL = 'pressdmusicapp@gmail.com'
const RATE_URL = 'itms-apps://apps.apple.com/app/id6796907083?action=write-review'

const NOTIFY_ROWS: { key: keyof NotificationPrefs; label: string }[] = [
  { key: 'recommendations', label: 'Recommendations' },
  { key: 'friends', label: 'Friend requests' },
  { key: 'replies', label: 'Replies to your posts' },
  { key: 'reviews', label: 'Friends reviewing records you’ve rated' },
  { key: 'ratings', label: 'Friends rating records you have' },
]

const APPEARANCES: { key: AppearancePref; label: string }[] = [
  { key: 'system', label: 'System' },
  { key: 'light', label: 'Light' },
  { key: 'dark', label: 'Dark' },
]

const SHELVES: { key: AlbumStatus; label: string }[] = [
  { key: 'rated', label: 'Rated' },
  { key: 'listening', label: 'Listening' },
  { key: 'to_listen', label: 'To Listen' },
]

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

export type SheetMode = 'profile' | 'settings'

export default function SettingsSheet({ visible, mode, onClose }: { visible: boolean; mode: SheetMode; onClose: () => void }) {
  const tc = useColors()
  const editing = mode === 'profile'
  // Blocked users opens as a page inside the sheet, with a way back.
  const [blockedOpen, setBlockedOpen] = useState(false)
  const title = editing ? 'Edit profile' : blockedOpen ? 'Blocked users' : 'Settings'
  const close = () => { setBlockedOpen(false); onClose() }
  const { user, signOut, linkGoogleToken, linkAppleToken, updateProfile, uploadAvatarImage, removeAvatar, removePhoneNumber } = useAuth()
  const [phoneOpen, setPhoneOpen] = useState(false)
  const [phoneBusy, setPhoneBusy] = useState(false)

  function confirmRemovePhone() {
    Alert.alert('Remove phone number?', 'Friends won’t be able to find you by your number.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          setPhoneBusy(true)
          try {
            await removePhoneNumber()
          } catch (e) {
            setError(e instanceof Error ? e.message : 'Couldn’t remove that number')
          } finally {
            setPhoneBusy(false)
          }
        },
      },
    ])
  }
  const [pushState, setPushState] = useState<'granted' | 'denied' | 'undetermined'>('undetermined')
  const [pushBusy, setPushBusy] = useState(false)
  const [pushToken, setPushToken] = useState<string | null>(null)

  // The Modal's own "slide" carried the dim layer up with the sheet, so a grey
  // slab rose from the bottom of the screen. Instead the Modal doesn't animate:
  // the dim fades in where it is and only the sheet slides. `mounted` holds
  // the Modal open through the closing animation, so the sheet can leave as
  // it arrived instead of vanishing. It travels the screen's height (screenH,
  // below), so it starts fully off-screen whatever the sheet's size.
  const [progress] = useState(() => new Animated.Value(0))
  const [mounted, setMounted] = useState(visible)
  if (visible && !mounted) setMounted(true)
  useEffect(() => {
    if (!mounted) return
    const anim = Animated.timing(progress, {
      toValue: visible ? 1 : 0,
      duration: visible ? 320 : 240,
      easing: visible ? Easing.out(Easing.cubic) : Easing.in(Easing.cubic),
      useNativeDriver: true,
    })
    anim.start(({ finished }) => {
      if (finished && !visible) setMounted(false)
    })
    return () => anim.stop()
  }, [visible, mounted, progress])

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
  // Whether the per-kind notification switches are showing.
  const [notifyOpen, setNotifyOpen] = useState(false)
  const [locationDraft, setLocationDraft] = useState<string | null>(null) // non-null while editing
  const [savingLocation, setSavingLocation] = useState(false)
  const [bioDraft, setBioDraft] = useState<string | null>(null) // non-null while editing
  const [savingBio, setSavingBio] = useState(false)
  const [avatarBusy, setAvatarBusy] = useState(false)
  const [bannerBusy, setBannerBusy] = useState(false)
  // Reset each time the sheet comes back up; see openShelfSlot.
  const navigatingRef = useRef(false)

  const devicePrefs = usePrefs()
  // Per-kind switches live on the account, because the server is what sends.
  const { data: notifyPrefs } = useQuery({
    queryKey: ['notification-prefs'],
    queryFn: fetchNotificationPrefs,
    enabled: visible && !!user,
  })
  /** Flipped at once and saved behind it; put back if the save fails, so the
   *  switch never claims a setting the server doesn't hold. */
  async function setNotify(key: keyof NotificationPrefs, value: boolean) {
    const before = qc.getQueryData<NotificationPrefs>(['notification-prefs'])
    if (before) qc.setQueryData(['notification-prefs'], { ...before, [key]: value })
    try {
      qc.setQueryData(['notification-prefs'], await updateNotificationPrefs({ [key]: value }))
    } catch {
      if (before) qc.setQueryData(['notification-prefs'], before)
      setError('Couldn’t save that notification setting')
    }
  }
  const version = Constants.expoConfig?.version
  const build = Constants.expoConfig?.ios?.buildNumber
  useEffect(() => {
    if (visible) navigatingRef.current = false
  }, [visible])
  const { data: profile } = useProfile(visible ? user?.id : undefined)
  // Sized to the device rather than a fixed height: a constant cap pushed the
  // foot of the sheet below the fold on every phone.
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
      const { identityToken, fullName } = await requestAppleCredential()
      setBusy('apple')
      await linkAppleToken(identityToken, fullName)
      refresh()
    } catch (e) {
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
      setError(e instanceof Error ? e.message : 'Could not save your username')
    } finally {
      setSavingName(false)
    }
  }

  async function saveLocation() {
    const next = (locationDraft ?? '').trim()
    if (!user || next === (profile?.location ?? '')) {
      setLocationDraft(null)
      return
    }
    setSavingLocation(true)
    setError(null)
    try {
      // Empty clears it. The profile query is where the header reads it from.
      const updated = await updateProfile({ location: next })
      qc.setQueryData(profileKey(user.id), updated)
      setLocationDraft(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save your location')
    } finally {
      setSavingLocation(false)
    }
  }

  async function saveBio() {
    const next = (bioDraft ?? '').trim()
    if (!user || next === (profile?.bio ?? user.bio ?? '')) {
      setBioDraft(null)
      return
    }
    setSavingBio(true)
    setError(null)
    try {
      // Empty clears it, as on web.
      const updated = await updateProfile({ bio: next })
      qc.setQueryData(profileKey(user.id), updated)
      setBioDraft(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save your bio')
    } finally {
      setSavingBio(false)
    }
  }

  /** Ask for the photo library before opening it. iOS's picker runs out of
   *  process and would open without asking, but asking first means the
   *  choice is the user's and shows up under Pressd in Settings. Limited
   *  access counts as yes — the picker shows whatever was shared. Once
   *  refused, iOS won't ask again, so the only way back is Settings. */
  async function ensurePhotoAccess(): Promise<boolean> {
    let perm = await ImagePicker.getMediaLibraryPermissionsAsync()
    if (!perm.granted && perm.canAskAgain) perm = await ImagePicker.requestMediaLibraryPermissionsAsync()
    if (perm.granted) return true
    Alert.alert(
      'Allow access to your photos',
      'Pressd needs your photos to set a profile picture or banner.',
      [
        { text: 'Not now', style: 'cancel' },
        { text: 'Open Settings', onPress: () => Linking.openSettings().catch(() => {}) },
      ],
    )
    return false
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
    if (!(await ensurePhotoAccess())) return
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

  /** The profile header reads banner_url off the shared profile query, so
   *  the new URL goes straight into that cache and the header swaps at once. */
  function setBannerUrl(url: string | null) {
    if (!user) return
    qc.setQueryData<Profile>(profileKey(user.id), (old) => (old ? { ...old, banner_url: url } : old))
  }

  async function pickBanner() {
    if (!user) return
    setError(null)
    if (!(await ensurePhotoAccess())) return
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      // The stored shape — web frames the same 24:5, so a banner set here fits there.
      aspect: [24, 5],
      quality: BANNER_UPLOAD_QUALITY,
      base64: true,
    })
    if (result.canceled || !result.assets[0]) return
    const asset = result.assets[0]
    if (!asset.base64) {
      setError('Could not read that image')
      return
    }
    setBannerBusy(true)
    try {
      const { banner_url } = await uploadBanner(user.id, {
        base64: asset.base64,
        contentType: asset.mimeType ?? 'image/jpeg',
      })
      setBannerUrl(banner_url)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not set your banner')
    } finally {
      setBannerBusy(false)
    }
  }

  async function clearBanner() {
    if (!user) return
    setBannerBusy(true)
    setError(null)
    try {
      await deleteBanner(user.id)
      setBannerUrl(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not remove your banner')
    } finally {
      setBannerBusy(false)
    }
  }

  /** The pickers are full screens, and this sheet sits above the navigator —
   *  so it has to get out of the way before the push lands, and it has to stop
   *  taking taps in the gap while it animates out. Without the guard a second
   *  tap opens a second picker behind the first. */
  /** One shelf slot's picker, a full screen: the sheet closes first. */
  function openShelfSlot(slot: number) {
    if (navigatingRef.current) return
    navigatingRef.current = true
    onClose()
    router.push(`/favorite/album?slot=${slot}`)
  }

  /** Same hand-off as openShelfSlot: the tutorial is a full screen too. */
  function openTutorial() {
    if (navigatingRef.current) return
    navigatingRef.current = true
    onClose()
    router.push({ pathname: '/tutorial', params: { replay: '1' } })
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
      // The alert is the confirmation that it happened — without it the person
      // lands on sign-in with no word that anything was deleted. It waits for
      // the sheet's modal to finish closing, since iOS won't present an alert
      // over a view controller that is being dismissed.
      onClose()
      signOut()
      setTimeout(() => {
        Alert.alert('Account deleted', 'Your account and everything in it have been permanently deleted.')
      }, 500)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete account')
    } finally {
      setDeleting(false)
    }
  }

  const linkedCount = (providers?.google ? 1 : 0) + (providers?.apple ? 1 : 0)

  return (
    <Modal visible={mounted} transparent animationType="none" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Animated.View style={[styles.dim, { opacity: progress }]}>
          <Pressable style={styles.fill} onPress={close} accessibilityLabel={`Close ${title.toLowerCase()}`} />
        </Animated.View>
        <Animated.View
          style={{
            transform: [{ translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [screenH, 0] }) }],
          }}
        >
        <Pressable style={styles.sheet}>
          <View style={styles.sheetHead}>
            {blockedOpen && !editing ? (
              <Pressable onPress={() => setBlockedOpen(false)} hitSlop={12} style={styles.backBtn} accessibilityLabel="Back to Settings">
                <ChevronLeft size={22} color={tc.ink} />
              </Pressable>
            ) : null}
            <Text style={[styles.sheetTitle, { flex: 1 }]}>{title}</Text>
            <Pressable onPress={close} hitSlop={12} accessibilityLabel={`Close ${title.toLowerCase()}`}>
              <X size={20} color={tc.inkTertiary} />
            </Pressable>
          </View>

          <ScrollView style={{ maxHeight: screenH * 0.68 }} showsVerticalScrollIndicator={false}>
            {editing && (<>
            <Text style={styles.sectionLabel}>PROFILE</Text>

            <View style={[styles.avatarRow, { borderColor: tc.border }]}>
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
              </View>
              {avatarBusy ? (
                <VinylSpinner color={tc.green} />
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

            <View style={[styles.avatarRow, { borderColor: tc.border }]}>
              <Pressable onPress={pickBanner} disabled={bannerBusy} accessibilityLabel="Change profile banner">
                <View style={styles.bannerThumb}>
                  {profile?.banner_url ? (
                    <Image
                      source={{ uri: profile.banner_url }}
                      style={styles.avatarImg}
                      contentFit="cover"
                      cachePolicy="memory-disk"
                      recyclingKey={profile.banner_url}
                    />
                  ) : null}
                </View>
              </Pressable>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.providerLabel}>Banner</Text>
              </View>
              {bannerBusy ? (
                <VinylSpinner color={tc.green} />
              ) : (
                <View style={styles.avatarActions}>
                  <Pressable onPress={pickBanner} hitSlop={8}>
                    <Text style={styles.linkAction}>{profile?.banner_url ? 'Change' : 'Add'}</Text>
                  </Pressable>
                  {profile?.banner_url ? (
                    <Pressable onPress={clearBanner} hitSlop={8}>
                      <Text style={styles.removeText}>Remove</Text>
                    </Pressable>
                  ) : null}
                </View>
              )}
            </View>

            {/* Username edits in place rather than on its own screen — it's
                one field, and the name is right there to check against. */}
            <View style={[styles.settingRow, { borderColor: tc.border }]}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.providerLabel}>Username</Text>
                {nameDraft === null ? (
                  <Text style={styles.settingValue} numberOfLines={1}>{user?.name}</Text>
                ) : (
                  <TextInput
                    style={[styles.nameInput, { borderColor: tc.border }]}
                    value={nameDraft}
                    onChangeText={(t) => setNameDraft(cleanUsername(t))}
                    autoFocus
                    autoCapitalize="none"
                    autoCorrect={false}
                    spellCheck={false}
                    maxLength={20}
                    returnKeyType="done"
                    onSubmitEditing={saveName}
                    placeholder="Username"
                    placeholderTextColor={tc.inkTertiary}
                  />
                )}
              </View>
              {savingName ? (
                <VinylSpinner color={tc.green} />
              ) : nameDraft === null ? (
                <Pressable onPress={() => setNameDraft(cleanUsername(user?.name ?? ''))} hitSlop={8}>
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

            {/* Typed, never read from the phone: people choose how specific to be. */}
            <View style={[styles.settingRow, { borderColor: tc.border }]}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.providerLabel}>Location</Text>
                {locationDraft === null ? (
                  <Text style={[styles.settingValue, !profile?.location && { color: colors.inkTertiary }]} numberOfLines={1}>
                    {profile?.location || 'Not set'}
                  </Text>
                ) : (
                  <TextInput
                    style={[styles.nameInput, { borderColor: tc.border }]}
                    value={locationDraft}
                    onChangeText={setLocationDraft}
                    autoFocus
                    autoCapitalize="words"
                    maxLength={40}
                    returnKeyType="done"
                    onSubmitEditing={saveLocation}
                  />
                )}
              </View>
              {savingLocation ? (
                <VinylSpinner color={tc.green} />
              ) : locationDraft === null ? (
                <Pressable onPress={() => setLocationDraft(profile?.location ?? '')} hitSlop={8} disabled={!profile}>
                  <Text style={styles.linkAction}>{profile?.location ? 'Edit' : 'Add'}</Text>
                </Pressable>
              ) : (
                <View style={styles.avatarActions}>
                  <Pressable onPress={() => setLocationDraft(null)} hitSlop={8}>
                    <Text style={styles.removeText}>Cancel</Text>
                  </Pressable>
                  <Pressable onPress={saveLocation} hitSlop={8}>
                    <Text style={styles.linkAction}>Save</Text>
                  </Pressable>
                </View>
              )}
            </View>

            {/* The bio edits in place too, a few lines tall. */}
            <View style={[styles.settingRow, { borderColor: tc.border }]}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.providerLabel}>Bio</Text>
                {bioDraft === null ? (
                  <Text style={[styles.settingValue, !(profile?.bio ?? user?.bio) && { color: colors.inkTertiary }]} numberOfLines={3}>
                    {profile?.bio || user?.bio || 'Not set'}
                  </Text>
                ) : (
                  <>
                    <TextInput
                      style={[[styles.nameInput, { borderColor: tc.border }], styles.bioInput]}
                      value={bioDraft}
                      onChangeText={setBioDraft}
                      autoFocus
                      multiline
                      maxLength={240}
                      textAlignVertical="top"
                    />
                    <Text style={styles.bioCount}>{bioDraft.length}/240</Text>
                  </>
                )}
              </View>
              {savingBio ? (
                <VinylSpinner color={tc.green} />
              ) : bioDraft === null ? (
                <Pressable onPress={() => setBioDraft(profile?.bio ?? user?.bio ?? '')} hitSlop={8}>
                  <Text style={styles.linkAction}>{profile?.bio || user?.bio ? 'Edit' : 'Add'}</Text>
                </Pressable>
              ) : (
                <View style={styles.avatarActions}>
                  <Pressable onPress={() => setBioDraft(null)} hitSlop={8}>
                    <Text style={styles.removeText}>Cancel</Text>
                  </Pressable>
                  <Pressable onPress={saveBio} hitSlop={8}>
                    <Text style={styles.linkAction}>Save</Text>
                  </Pressable>
                </View>
              )}
            </View>

            <Text style={styles.sectionLabel}>SHELF</Text>
            {/* Nothing is offered until the lock state is known: the rows would
                otherwise flash as tappable and then 403 on save. */}
            {!profile ? (
              <VinylSpinner size={32} style={{ marginVertical: spacing.lg }} />
            ) : !profile.picks_unlocked ? (
              <Text style={styles.sectionHint}>
                Rate {Math.max(0, profile.picks_required - profile.picks_rated_count)} more{' '}
                {profile.picks_required - profile.picks_rated_count === 1 ? 'album' : 'albums'} to
                fill your shelf.
              </Text>
            ) : (
              Array.from({ length: SHELF_SIZE }, (_, slot) => (
                <PickSettingRow
                  key={slot}
                  label={`Shelf ${slot + 1}`}
                  value={profile.shelf?.[slot]?.album_name}
                  onPress={() => openShelfSlot(slot)}
                />
              ))
            )}

            </>)}

            {!editing && blockedOpen && <BlockedList />}

            {!editing && !blockedOpen && (<>
            <Text style={styles.sectionLabel}>NOTIFICATIONS</Text>
            <Text style={styles.sectionHint}>
              Get told when a friend sends you a record. iOS only asks once, so if you
              turn this down you&rsquo;ll have to re-enable it in the Settings app.
            </Text>
            {/* Once iOS will deliver, the row is a dropdown: it opens onto a
                switch per kind, and stays shut by default so the four don't
                fill the sheet. */}
            <Pressable
              style={[styles.pushRow, { borderColor: tc.border }]}
              onPress={pushState === 'granted' && notifyPrefs ? () => setNotifyOpen((v) => !v) : undefined}
              disabled={!(pushState === 'granted' && notifyPrefs)}
              accessibilityRole={pushState === 'granted' ? 'button' : undefined}
              accessibilityState={pushState === 'granted' ? { expanded: notifyOpen } : undefined}
            >
              <Text style={styles.pushLabel}>
                {pushState === 'granted'
                  ? 'On'
                  : pushState === 'denied'
                    ? 'Blocked in iOS Settings'
                    : 'Off'}
              </Text>
              {pushBusy ? (
                <VinylSpinner color={tc.green} />
              ) : pushState === 'undetermined' ? (
                <Pressable onPress={turnOnPush} hitSlop={8}>
                  <Text style={styles.linkAction}>Turn on</Text>
                </Pressable>
              ) : pushState === 'granted' && notifyPrefs ? (
                // Up while open, to fold the switches away again.
                notifyOpen ? <ChevronUp size={18} color={tc.inkTertiary} /> : <ChevronDown size={18} color={tc.inkTertiary} />
              ) : null}
            </Pressable>
            {__DEV__ && pushToken ? (
              // Dev only. Reading a token out of a log is miserable, and this is
              // the value a Firebase test send needs.
              <Pressable onPress={() => Share.share({ message: pushToken })}>
                <Text style={styles.sectionHint} numberOfLines={2}>
                  tap to send FCM token: {pushToken.slice(0, 24)}…
                </Text>
              </Pressable>
            ) : null}
            {/* Only once iOS will deliver anything: before that, a switch per
                kind would be a promise the phone can't keep. */}
            {pushState === 'granted' && notifyPrefs && notifyOpen
              ? NOTIFY_ROWS.map((r) => (
                  <ToggleRow
                    key={r.key}
                    label={r.label}
                    value={notifyPrefs[r.key]}
                    onChange={(v) => setNotify(r.key, v)}
                  />
                ))
              : null}

            <Text style={styles.sectionLabel}>PREFERENCES</Text>
            <ToggleRow label="Haptics" value={devicePrefs.haptics} onChange={(v) => setPref('haptics', v)} />
            {/* System follows the phone, including its automatic sunset switch;
                the other two hold regardless of it. */}
            <View style={[styles.settingRow, { borderColor: tc.border }]}>
              <Text style={[styles.providerLabel, { flex: 1 }]} numberOfLines={1}>Appearance</Text>
              <View style={styles.shelves}>
                {APPEARANCES.map((ap) => {
                  const on = devicePrefs.appearance === ap.key
                  return (
                    <Pressable
                      key={ap.key}
                      onPress={() => setPref('appearance', ap.key)}
                      style={[styles.shelf, on && styles.shelfOn]}
                      accessibilityRole="button"
                      accessibilityState={{ selected: on }}
                    >
                      <Text style={[styles.shelfText, on && styles.shelfTextOn]} maxFontSizeMultiplier={NUM_SCALE_CAP}>
                        {ap.label}
                      </Text>
                    </Pressable>
                  )
                })}
              </View>
            </View>
            <View style={[styles.settingRow, { borderColor: tc.border }]}>
              <Text style={[styles.providerLabel, { flex: 1 }]} numberOfLines={1}>Library opens on</Text>
              <View style={styles.shelves}>
                {SHELVES.map((sh) => {
                  const on = devicePrefs.libraryStart === sh.key
                  return (
                    <Pressable
                      key={sh.key}
                      onPress={() => setPref('libraryStart', sh.key)}
                      style={[styles.shelf, on && styles.shelfOn]}
                      accessibilityRole="button"
                      accessibilityState={{ selected: on }}
                    >
                      <Text style={[styles.shelfText, on && styles.shelfTextOn]} maxFontSizeMultiplier={NUM_SCALE_CAP}>
                        {sh.label}
                      </Text>
                    </Pressable>
                  )
                })}
              </View>
            </View>

            <Text style={styles.sectionLabel}>SIGN-IN METHODS</Text>
            <Text style={styles.sectionHint}>
              Connect both and you can sign back in with either one. With only one connected,
              signing in the other way creates a separate, empty account.
            </Text>

            {isLoading ? (
              <VinylSpinner size={32} style={{ marginVertical: spacing.lg }} />
            ) : (
              <>
                <ProviderRow
                  icon={<AppleLogo size={19} color={tc.ink} />}
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

            <Text style={styles.sectionLabel}>ACCOUNT</Text>
            {providers?.email ? (
              <>
                <View style={[styles.emailRow, { borderColor: tc.border }]}>
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
            {/* Only the last four digits ever come back from the server: the
                number itself is stored as a keyed hash (backend/phone.py). */}
            <View style={[styles.settingRow, { borderColor: tc.border }]}>
              <Text style={[styles.providerLabel, { flex: 1 }]} numberOfLines={1}>Phone number</Text>
              {phoneBusy ? (
                <VinylSpinner color={tc.green} />
              ) : user?.phoneLast4 ? (
                <View style={styles.phoneOnFile}>
                  <Text style={styles.phoneDigits} maxFontSizeMultiplier={NUM_SCALE_CAP}>•••• {user.phoneLast4}</Text>
                  <Pressable onPress={confirmRemovePhone} hitSlop={8} accessibilityLabel="Remove phone number">
                    <Text style={styles.phoneRemove}>Remove</Text>
                  </Pressable>
                </View>
              ) : (
                <Pressable style={styles.connectBtn} onPress={() => setPhoneOpen(true)}>
                  <Text style={styles.connectBtnText}>Add</Text>
                </Pressable>
              )}
            </View>
            <PhoneSheet visible={phoneOpen} mode="settings" onClose={() => setPhoneOpen(false)} />
            <LinkRow label="Blocked users" onPress={() => setBlockedOpen(true)} />

            <Text style={styles.sectionLabel}>ABOUT</Text>
            <LinkRow label="How Pressd works" onPress={openTutorial} />
            <LinkRow label="Rate Pressd" onPress={() => Linking.openURL(RATE_URL).catch(() => {})} />
            <LinkRow
              label="Contact support"
              onPress={() =>
                Linking.openURL(`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent('Pressd support')}`).catch(() =>
                  setError(`Write to ${SUPPORT_EMAIL}`),
                )
              }
            />
            <LinkRow label="Privacy policy" onPress={() => WebBrowser.openBrowserAsync(PRIVACY_URL).catch(() => {})} />
            {/* The last links before Sign out and Delete account, by request. */}
            <LinkRow label="Terms of use" onPress={() => WebBrowser.openBrowserAsync(TERMS_URL).catch(() => {})} />
            <LinkRow label="Community guidelines" onPress={() => WebBrowser.openBrowserAsync(GUIDELINES_URL).catch(() => {})} />

            {error ? <Text style={styles.error}>{error}</Text> : null}

            <Pressable
              style={[styles.signOutBtn, { borderColor: tc.dangerBorder }]}
              onPress={() => {
                onClose()
                signOut()
              }}
            >
              <LogOut size={17} color={tc.danger} />
              <Text style={styles.signOutText}>Sign out</Text>
            </Pressable>
            {/* Beside Sign out rather than at the foot of the sheet: App Review
                rejected build 6 (Guideline 5.1.1(v)) without finding it there. */}
            <Pressable style={[styles.deleteBtn, { borderColor: tc.dangerBorder }]} onPress={confirmDelete} disabled={deleting} accessibilityLabel="Delete account">
              {deleting ? (
                <VinylSpinner color={tc.danger} />
              ) : (
                <>
                  <Trash2 size={16} color={tc.danger} />
                  <Text style={styles.deleteText}>Delete account</Text>
                </>
              )}
            </Pressable>

            {version ? (
              <Text style={styles.versionLine}>
                Pressd {version}{build ? ` (${build})` : ''}
              </Text>
            ) : null}

            {user ? <Text style={styles.idHint}>Signed in as {user.name}</Text> : null}
            </>)}
          </ScrollView>
        </Pressable>
        </Animated.View>
      </View>
    </Modal>
  )
}

/** Settings → Blocked users: everyone you've blocked, newest first, each with
 *  Unblock. Unblocking doesn't bring back a friendship the block ended. */
function BlockedList() {
  const tc = useColors()
  const qc = useQueryClient()
  const [busy, setBusy] = useState<number | null>(null)
  const { data, isLoading, isError } = useQuery({ queryKey: ['blocked'], queryFn: fetchBlockedUsers })

  async function unblock(id: number) {
    setBusy(id)
    try {
      await unblockUser(id)
      qc.invalidateQueries({ queryKey: ['blocked'] })
      qc.invalidateQueries({ queryKey: ['profile', id] })
    } catch {
      Alert.alert('Couldn’t unblock', 'Try again in a moment.')
    } finally {
      setBusy(null)
    }
  }

  if (isLoading) return <VinylSpinner size={32} style={{ marginVertical: spacing.xl }} />
  if (isError) return <Text style={styles.blockedEmpty}>Couldn’t load blocked users.</Text>
  if (!data?.length) return <Text style={styles.blockedEmpty}>You haven’t blocked anyone.</Text>
  return (
    <View style={{ marginTop: spacing.sm }}>
      {data.map((u) => (
        <View key={u.id} style={[styles.settingRow, { borderColor: tc.border }]}>
          <Avatar name={u.name} avatarUrl={u.avatarUrl} size={36} />
          <Text style={[styles.providerLabel, { flex: 1, marginLeft: spacing.md }]} numberOfLines={1}>{u.name}</Text>
          {busy === u.id ? (
            <VinylSpinner color={tc.green} />
          ) : (
            <Pressable style={styles.connectBtn} onPress={() => unblock(u.id)} accessibilityLabel={`Unblock ${u.name}`}>
              <Text style={styles.connectBtnText}>Unblock</Text>
            </Pressable>
          )}
        </View>
      ))}
    </View>
  )
}

/** A labelled switch, in the sheet's card row. */
function ToggleRow({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  const tc = useColors()
  return (
    <View style={[styles.settingRow, { borderColor: tc.border }]}>
      <Text style={[styles.providerLabel, { flex: 1 }]} numberOfLines={1}>{label}</Text>
      <Switch
        value={value}
        onValueChange={onChange}
        trackColor={{ true: colors.green, false: colors.inset }}
        accessibilityLabel={label}
      />
    </View>
  )
}

/** A row that goes somewhere: a label and a chevron. */
function LinkRow({ label, onPress }: { label: string; onPress: () => void }) {
  const tc = useColors()
  return (
    <Pressable style={[styles.settingRow, { borderColor: tc.border }]} onPress={onPress} accessibilityRole="button">
      <Text style={[styles.providerLabel, { flex: 1 }]} numberOfLines={1}>{label}</Text>
      <ChevronRight size={17} color={tc.inkMuted} />
    </Pressable>
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
  const tc = useColors()
  return (
    <Pressable style={[styles.settingRow, { borderColor: tc.border }]} onPress={onPress} accessibilityRole="button">
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={styles.providerLabel}>{label}</Text>
        <Text style={[styles.settingValue, !value && styles.settingValueEmpty]} numberOfLines={1}>
          {value || 'Not set'}
        </Text>
      </View>
      <ChevronRight size={17} color={tc.inkMuted} />
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
  const tc = useColors()
  return (
    <View style={[styles.providerRow, { borderColor: tc.border }]}>
      <View style={styles.providerIcon}>{icon}</View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={styles.providerLabel}>{label}</Text>
        {linked ? (
          <View style={styles.connectedRow}>
            <Check size={13} color={tc.green} />
            <Text style={styles.connectedText}>Connected</Text>
          </View>
        ) : (
          <Text style={styles.notConnectedText}>Not connected</Text>
        )}
      </View>
      {busy ? (
        <VinylSpinner color={tc.green} />
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
  bioInput: { minHeight: 72, paddingTop: 8 },
  bioCount: { fontFamily: fonts.body, fontSize: 11, color: colors.inkTertiary, textAlign: 'right', marginTop: 4 },
  backdrop: { flex: 1, justifyContent: 'flex-end' },
  dim: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(28,25,23,0.35)' },
  fill: { flex: 1 },
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
    borderRadius: radii.md,
    padding: spacing.md,
    marginTop: spacing.sm,
  },
  settingValue: { fontFamily: fonts.body, fontSize: 12.5, color: colors.inkSecondary, marginTop: 1 },
  settingValueEmpty: { color: colors.inkTertiary },
  shelves: { flexDirection: 'row', gap: 4 },
  shelf: { borderRadius: radii.pill, paddingHorizontal: 9, paddingVertical: 5 },
  shelfOn: { backgroundColor: colors.greenSoft },
  shelfText: { fontFamily: fonts.bodyMedium, fontSize: 12.5, color: colors.inkTertiary },
  shelfTextOn: { fontFamily: fonts.bodySemiBold, color: colors.green },
  backBtn: { marginRight: spacing.sm },
  blockedEmpty: { fontFamily: fonts.bodyMedium, fontSize: 14, color: colors.inkSecondary, textAlign: 'center', marginVertical: spacing.xl },
  versionLine: { fontFamily: fonts.body, fontSize: 12, color: colors.inkMuted, marginTop: spacing.md, textAlign: 'center' },
  nameInput: {
    fontFamily: fonts.body,
    fontSize: 14,
    color: colors.ink,
    paddingVertical: 2,
    marginTop: 1,
    borderBottomWidth: 1,
  },
  avatarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.raised,
    borderWidth: 1,
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
  bannerThumb: {
    width: 44,
    height: 44,
    borderRadius: radii.sm,
    backgroundColor: colors.inset,
    overflow: 'hidden',
  },
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
  phoneOnFile: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  phoneDigits: { fontFamily: fonts.bodyMedium, fontSize: 14, color: colors.inkSecondary, fontVariant: ['tabular-nums'] },
  phoneRemove: { fontFamily: fonts.bodySemiBold, fontSize: 13.5, color: colors.danger },
  unavailable: { fontFamily: fonts.body, fontSize: 12, color: colors.inkMuted },

  emailRow: {
    backgroundColor: colors.raised,
    borderWidth: 1,
    borderRadius: radii.md,
    padding: spacing.md,
  },
  emailText: { fontFamily: fonts.body, fontSize: 13.5, color: colors.inkSecondary },

  error: {
    fontFamily: fonts.bodyMedium,
    fontSize: 13,
    color: colors.danger,
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
    backgroundColor: colors.dangerSoft,
  },
  signOutText: { fontFamily: fonts.bodySemiBold, fontSize: 15, color: colors.danger },

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
  },
  deleteText: { fontFamily: fonts.bodySemiBold, fontSize: 14.5, color: colors.danger },
  idHint: {
    fontFamily: fonts.body,
    fontSize: 11.5,
    color: colors.inkMuted,
    textAlign: 'center',
    marginTop: spacing.md,
  },
})
