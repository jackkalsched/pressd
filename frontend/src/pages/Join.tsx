import { useState, useEffect } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { Loader2, Music } from 'lucide-react'
import { useGoogleLogin } from '@react-oauth/google'
import { fetchInvite, acceptInvite, signInWithGoogle } from '../api'
import { useUser } from '../context/UserContext'

export default function Join() {
  const [searchParams] = useSearchParams()
  const token = searchParams.get('token') ?? ''
  const navigate = useNavigate()
  const { setActiveUser, activeUser } = useUser()

  const [inviterName, setInviterName] = useState<string | null>(null)
  const [loadingInvite, setLoadingInvite] = useState(true)
  const [inviteError, setInviteError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!token) {
      setInviteError('No invite token found in URL.')
      setLoadingInvite(false)
      return
    }
    let cancelled = false
    async function load() {
      for (let attempt = 0; attempt < 4; attempt++) {
        try {
          const data = await fetchInvite(token)
          if (!cancelled) {
            setInviterName(data.inviter_name)
            setLoadingInvite(false)
          }
          return
        } catch (err) {
          const msg = err instanceof Error ? err.message : ''
          const isNetwork = msg === 'Failed to fetch' || msg === 'Load failed' || msg === 'NetworkError when attempting to fetch resource.'
          if (isNetwork && attempt < 3) {
            await new Promise(r => setTimeout(r, 4000))
            continue
          }
          if (!cancelled) {
            setInviteError(isNetwork
              ? 'Server is waking up — please wait a moment and refresh the page.'
              : (msg || 'Invalid invite link.'))
            setLoadingInvite(false)
          }
          return
        }
      }
    }
    load()
    return () => { cancelled = true }
  }, [token])

  async function finishJoin(userId: number) {
    try {
      await acceptInvite(token, undefined, userId)
    } catch {
      // Invite may already be used or friendship may already exist — that's fine
    }
    navigate('/library', { replace: true })
  }

  // If already logged in, just accept the invite and go
  useEffect(() => {
    if (activeUser && inviterName !== null) {
      finishJoin(activeUser.id)
    }
  }, [activeUser, inviterName])

  const googleLogin = useGoogleLogin({
    onSuccess: async (tokenResponse) => {
      setSubmitting(true)
      setError(null)
      try {
        const user = await signInWithGoogle(tokenResponse.access_token)
        // Log in first — invite accept is best-effort
        setActiveUser({ id: user.id, name: user.name, avatarUrl: user.avatarUrl })
        await finishJoin(user.id)
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Something went wrong.'
        setError(msg)
        setSubmitting(false)
      }
    },
    onError: () => setError('Google sign in was cancelled or failed.'),
  })

  return (
    <div className="min-h-screen bg-white flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="flex items-center gap-2 mb-8 justify-center">
          <Music size={22} className="text-[#2d6a4f]" />
          <span className="text-[#111] font-semibold tracking-wide text-xl">Press'd</span>
        </div>

        {loadingInvite ? (
          <div className="flex justify-center">
            <Loader2 size={20} className="animate-spin text-[#aaa]" />
          </div>
        ) : inviteError ? (
          <div className="text-center">
            <p className="text-[#c0392b] text-sm">{inviteError}</p>
          </div>
        ) : (
          <div className="bg-white border border-[#e2e2e2] rounded-2xl p-6 shadow-sm">
            <h1 className="text-[#111] font-semibold text-lg mb-1">You've been invited</h1>
            <p className="text-[#777] text-sm mb-6">
              <span className="font-medium text-[#111]">{inviterName}</span> invited you to join Press'd.
              Sign in with Google to create your account or pick up where you left off.
            </p>

            {error && <p className="text-[#c0392b] text-xs mb-3">{error}</p>}

            <button
              onClick={() => googleLogin()}
              disabled={submitting}
              className="w-full flex items-center justify-center gap-3 bg-[#111] hover:bg-[#222] text-white text-sm font-semibold py-2.5 px-4 rounded-xl transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {submitting ? (
                <><Loader2 size={14} className="animate-spin" /> Signing in…</>
              ) : (
                <>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                    <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
                    <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                  </svg>
                  Continue with Google
                </>
              )}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
