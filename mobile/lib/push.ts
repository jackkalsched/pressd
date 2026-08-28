// Push registration and the FCM message handlers.
//
// Three things live here because they have to agree with each other: asking for
// permission, getting the token to the backend, and reacting to a message in
// each of the three states iOS can deliver one in (foreground, background, and
// launched-from-quit).
//
// Nothing here runs on a simulator. APNs issues no token to one, so
// getToken() rejects and registration no-ops — which is why the whole module is
// written to fail quietly rather than throw into the render tree.
import { Platform } from 'react-native'
// The modular API. v22 dropped the `messaging()` namespace default export, and
// the compat shim it replaced logs a deprecation on every call.
import {
  AuthorizationStatus,
  getInitialNotification,
  getMessaging,
  getToken,
  hasPermission,
  onMessage,
  onNotificationOpenedApp,
  onTokenRefresh,
  requestPermission,
  type RemoteMessage,
} from '@react-native-firebase/messaging'
import { registerPushToken, unregisterPushToken } from './api'

/** The token this install last reported, so sign-out can unregister it without
 *  asking FCM again — getToken() after the user signs out can hang. */
let lastToken: string | null = null

export function currentPushToken(): string | null {
  return lastToken
}

/** Has the user already answered the OS prompt? iOS only ever asks once, so
 *  this is what decides whether showing our own explanation is worth it. */
export async function pushPermissionStatus(): Promise<'granted' | 'denied' | 'undetermined'> {
  try {
    const status = await hasPermission(getMessaging())
    if (status === AuthorizationStatus.AUTHORIZED ||
        status === AuthorizationStatus.PROVISIONAL) return 'granted'
    if (status === AuthorizationStatus.DENIED) return 'denied'
    return 'undetermined'
  } catch {
    return 'undetermined'
  }
}

/**
 * Ask for permission and register the resulting token.
 *
 * Deliberately not called on first launch. iOS shows the system prompt exactly
 * once per install — decline it and the only way back is Settings, which nobody
 * does. So this is user-initiated, from a control that has already explained
 * what the notifications are for.
 */
export async function enablePush(): Promise<boolean> {
  try {
    const status = await requestPermission(getMessaging())
    const ok = status === AuthorizationStatus.AUTHORIZED ||
               status === AuthorizationStatus.PROVISIONAL
    if (!ok) return false
    return await syncPushToken()
  } catch {
    return false
  }
}

/**
 * Push the current token to the backend. Safe to call on every launch: the
 * server upserts on the token, and FCM reissues after a reinstall, a restore,
 * or a long silence — re-registering is the only way to notice that happened.
 */
export async function syncPushToken(): Promise<boolean> {
  try {
    if ((await pushPermissionStatus()) !== 'granted') return false
    const token = await getToken(getMessaging())
    if (!token) return false
    lastToken = token
    return await registerPushToken(token, Platform.OS === 'android' ? 'android' : 'ios')
  } catch {
    // No APNs on a simulator, no network, not signed in — none of which are
    // worth surfacing. Push is additive; the app works without it.
    return false
  }
}

/** Drop this device's token on sign-out. Without it the next account on this
 *  phone inherits the last one's notifications. */
export async function disablePush(): Promise<void> {
  try {
    const token = lastToken ?? (await getToken(getMessaging()))
    if (token) await unregisterPushToken(token)
  } catch {
    /* best effort — the server also clears tokens on account deletion */
  } finally {
    lastToken = null
  }
}

/**
 * Wire the listeners. Returns an unsubscribe for the ones that need it.
 *
 * `onTokenRefresh` is the one people forget: FCM can rotate a token at any
 * time, and a stale one on the server fails silently — the send succeeds and
 * nothing arrives.
 */
export function attachPushListeners(onOpen?: (data: Record<string, string>) => void): () => void {
  const fcm = getMessaging()

  const unsubRefresh = onTokenRefresh(fcm, async (token: string) => {
    lastToken = token
    try {
      await registerPushToken(token, Platform.OS === 'android' ? 'android' : 'ios')
    } catch { /* retried on next launch by syncPushToken */ }
  })

  // Delivered while the app is open. iOS does not show a banner for these on
  // its own, which is the point: a notification about something already on
  // screen should be handled, not announced.
  const unsubMessage = onMessage(fcm, async () => {
    // Intentionally quiet for now. When there is somewhere to put it, this is
    // where an in-app banner or a badge would go.
  })

  // The app was in the background and the user tapped the notification.
  const unsubOpened = onNotificationOpenedApp(fcm, (msg: RemoteMessage) => {
    if (msg?.data) onOpen?.(msg.data as Record<string, string>)
  })

  // The app was not running at all. This resolves once with the message that
  // launched it, and null every other time.
  getInitialNotification(fcm)
    .then((msg: RemoteMessage | null) => {
      if (msg?.data) onOpen?.(msg.data as Record<string, string>)
    })
    .catch(() => {})

  return () => {
    unsubRefresh()
    unsubMessage()
    unsubOpened()
  }
}
