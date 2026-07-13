// Session state for the mobile app. The JWT lives in lib/api's memory+Keychain
// store; this context owns the signed-in user's identity and exposes the
// sign-in / sign-out flows to screens.
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import * as SecureStore from 'expo-secure-store'
import { signInWithGoogle, fetchUsers, type UserInfo } from '@pressd/shared/api'
import { getToken, setToken, loadStoredToken, setUnauthorizedHandler } from './api'

const USER_KEY = 'pressd_user'

interface AuthContextValue {
  /** null until sign-in completes (or when signed out) */
  user: UserInfo | null
  /** false until the Keychain has been read at launch */
  ready: boolean
  signInWithGoogleToken: (accessToken: string) => Promise<void>
  signInWithDevToken: (jwt: string) => Promise<void>
  signOut: () => void
}

const AuthContext = createContext<AuthContextValue | null>(null)

function decodeJwtSub(token: string): number | null {
  try {
    const payload = token.split('.')[1]
    const json = JSON.parse(globalThis.atob(payload.replace(/-/g, '+').replace(/_/g, '/')))
    const sub = Number(json.sub)
    return Number.isFinite(sub) ? sub : null
  } catch {
    return null
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserInfo | null>(null)
  const [ready, setReady] = useState(false)

  const persistUser = useCallback((u: UserInfo | null) => {
    setUser(u)
    if (u) {
      SecureStore.setItemAsync(USER_KEY, JSON.stringify(u)).catch(() => {})
    } else {
      SecureStore.deleteItemAsync(USER_KEY).catch(() => {})
    }
  }, [])

  const signOut = useCallback(() => {
    setToken(null)
    persistUser(null)
  }, [persistUser])

  // Hydrate token + user from the Keychain once at launch.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const token = await loadStoredToken()
      if (token) {
        try {
          const raw = await SecureStore.getItemAsync(USER_KEY)
          if (!cancelled && raw) setUser(JSON.parse(raw))
        } catch { /* stale user blob — sign-in screen will show */ }
      }
      if (!cancelled) setReady(true)
    })()
    return () => { cancelled = true }
  }, [])

  // Any 401 from the shared client drops the session.
  useEffect(() => {
    setUnauthorizedHandler(signOut)
    return () => setUnauthorizedHandler(() => {})
  }, [signOut])

  const signInWithGoogleToken = useCallback(async (accessToken: string) => {
    const u = await signInWithGoogle(accessToken) // stores the JWT via configureApi
    persistUser(u)
  }, [persistUser])

  // Dev-only shortcut: paste a backend-minted JWT (EXPO_PUBLIC_DEV_TOKEN) to
  // test in Expo Go before the Google iOS client exists.
  const signInWithDevToken = useCallback(async (jwt: string) => {
    setToken(jwt)
    const id = decodeJwtSub(jwt)
    const users = await fetchUsers()
    const u = users.find((x) => x.id === id)
    if (!u) {
      setToken(null)
      throw new Error('Dev token did not match a user')
    }
    persistUser(u)
  }, [persistUser])

  const value = useMemo(
    () => ({ user, ready, signInWithGoogleToken, signInWithDevToken, signOut }),
    [user, ready, signInWithGoogleToken, signInWithDevToken, signOut],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}

export { getToken }
