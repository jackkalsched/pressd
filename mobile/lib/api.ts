// Mobile binding for the shared API client. SecureStore is async, so the
// token is held in memory for synchronous reads and persisted in the
// background; `loadStoredToken()` hydrates it once at app launch.
import * as SecureStore from 'expo-secure-store'
import { configureApi } from '@pressd/shared/api'

const TOKEN_KEY = 'pressd_token'

let memoryToken: string | null = null
let unauthorizedHandler: () => void = () => {}

export function getToken(): string | null {
  return memoryToken
}

export function setToken(token: string | null): void {
  memoryToken = token
  if (token) {
    SecureStore.setItemAsync(TOKEN_KEY, token).catch(() => {})
  } else {
    SecureStore.deleteItemAsync(TOKEN_KEY).catch(() => {})
  }
}

/** Hydrate the in-memory token from the Keychain. Call once before rendering
 *  authed screens (the root layout awaits this behind the splash screen). */
export async function loadStoredToken(): Promise<string | null> {
  try {
    memoryToken = await SecureStore.getItemAsync(TOKEN_KEY)
  } catch {
    memoryToken = null
  }
  return memoryToken
}

/** The auth provider registers its sign-out routine here so a 401 anywhere
 *  drops the session and returns the user to the sign-in screen. */
export function setUnauthorizedHandler(fn: () => void): void {
  unauthorizedHandler = fn
}

export const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:8000'

configureApi({
  baseUrl: API_URL,
  getToken,
  setToken,
  onUnauthorized: () => unauthorizedHandler(),
})

export * from '@pressd/shared/api'
