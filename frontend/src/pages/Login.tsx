import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Music, Loader2 } from 'lucide-react'
import { signInWithApple } from '../api'
import { useUser } from '../context/UserContext'

declare global {
  interface Window {
    AppleID?: {
      auth: {
        init(config: {
          clientId: string
          scope: string
          redirectURI: string
          usePopup: boolean
        }): void
        signIn(): Promise<{
          authorization: { id_token: string; code: string }
          user?: {
            name?: { firstName?: string; lastName?: string }
            email?: string
          }
        }>
      }
    }
  }
}

export default function Login() {
  const { activeUser, setActiveUser } = useUser()
  const navigate = useNavigate()
  const [sdkReady, setSdkReady] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (activeUser) {
      navigate('/library', { replace: true })
      return
    }
    if (window.AppleID) { setSdkReady(true); return }
    const script = document.createElement('script')
    script.src = 'https://appleid.cdn-apple.com/appleauth/static/jsapi/appleid/1/en_US/appleid.auth.js'
    script.async = true
    script.onload = () => setSdkReady(true)
    script.onerror = () => setError('Failed to load Apple Sign In SDK.')
    document.head.appendChild(script)
  }, [activeUser])

  useEffect(() => {
    if (!sdkReady || !window.AppleID) return
    window.AppleID.auth.init({
      clientId: import.meta.env.VITE_APPLE_CLIENT_ID ?? '',
      scope: 'name email',
      redirectURI: window.location.origin,
      usePopup: true,
    })
  }, [sdkReady])

  async function handleAppleSignIn() {
    if (!window.AppleID) return
    setLoading(true)
    setError(null)
    try {
      const response = await window.AppleID.auth.signIn()
      const { id_token } = response.authorization
      const appleUser = response.user
      const firstName = appleUser?.name?.firstName ?? ''
      const lastName = appleUser?.name?.lastName ?? ''
      const name = [firstName, lastName].filter(Boolean).join(' ') || undefined
      const user = await signInWithApple(id_token, name)
      setActiveUser({ id: user.id, name: user.name, avatarUrl: user.avatarUrl })
      navigate('/library', { replace: true })
    } catch (err: unknown) {
      if ((err as { error?: string })?.error === 'popup_closed_by_user') {
        setLoading(false)
        return
      }
      const msg = err instanceof Error ? err.message : 'Sign in failed. Please try again.'
      setError(msg)
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-white flex items-center justify-center px-4">
      <div className="w-full max-w-xs">

        <div className="flex items-center gap-2.5 mb-12 justify-center">
          <Music size={26} className="text-[#2d6a4f]" />
          <span className="text-[#111] font-bold tracking-wide text-2xl">Press'd</span>
        </div>

        <h1 className="text-xl font-semibold text-[#111] text-center mb-1">Sign in</h1>
        <p className="text-[#999] text-sm text-center mb-10">Your ratings, on every device.</p>

        <button
          onClick={handleAppleSignIn}
          disabled={loading || !sdkReady}
          className="w-full flex items-center justify-center gap-3 bg-[#000] hover:bg-[#1a1a1a] active:bg-[#333] text-white py-3.5 rounded-xl text-[15px] font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? (
            <Loader2 size={16} className="animate-spin" />
          ) : (
            <AppleLogo />
          )}
          {loading ? 'Signing in…' : 'Sign in with Apple'}
        </button>

        {!sdkReady && !error && (
          <p className="text-[#bbb] text-xs text-center mt-4">Loading…</p>
        )}
        {error && (
          <p className="text-[#c0392b] text-xs text-center mt-4">{error}</p>
        )}
      </div>
    </div>
  )
}

function AppleLogo() {
  return (
    <svg width="16" height="20" viewBox="0 0 16 20" fill="none" aria-hidden>
      <path
        d="M13.173 10.535c-.022-2.459 2.004-3.646 2.094-3.703-1.142-1.668-2.916-1.896-3.547-1.921-1.516-.156-2.963.896-3.732.896-.77 0-1.961-.872-3.222-.848-1.655.025-3.182.97-4.032 2.462C-.133 9.88 1.088 14.98 2.72 17.78c.814 1.178 1.784 2.502 3.063 2.455 1.228-.05 1.692-.793 3.178-.793s1.903.793 3.208.768c1.32-.025 2.157-1.2 2.97-2.38.94-1.364 1.325-2.691 1.349-2.76-.03-.014-2.585-1.002-2.615-3.535zM10.803 3.3c.674-.828 1.13-1.972.999-3.113-.968.04-2.146.651-2.842 1.467-.621.718-1.169 1.882-1.022 2.99 1.082.083 2.185-.553 2.865-1.344z"
        fill="currentColor"
      />
    </svg>
  )
}
