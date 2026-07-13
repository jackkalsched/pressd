// Web binding for the shared API client (@pressd/shared). This module wires
// the browser's storage + navigation into the platform-agnostic client, then
// re-exports it, so the rest of the app keeps importing from '../api'.
import { configureApi } from '@pressd/shared/api'

const TOKEN_KEY = 'pressd_token'

export function getToken(): string | null {
  try { return localStorage.getItem(TOKEN_KEY) } catch { return null }
}

export function setToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token)
    else localStorage.removeItem(TOKEN_KEY)
  } catch { /* ignore */ }
}

configureApi({
  baseUrl: import.meta.env.VITE_API_URL ?? 'http://localhost:8000',
  getToken,
  setToken,
  onUnauthorized: () => {
    try { localStorage.removeItem('pressd_active_user') } catch { /* ignore */ }
    if (typeof window !== 'undefined' && window.location.pathname !== '/') {
      window.location.href = '/'
    }
  },
})

export * from '@pressd/shared/api'
