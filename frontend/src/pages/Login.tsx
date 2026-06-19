import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Music, Loader2 } from 'lucide-react'
import { useGoogleLogin } from '@react-oauth/google'
import { signInWithGoogle } from '../api'
import { useUser } from '../context/UserContext'

export default function Login() {
  const { setActiveUser } = useUser()
  const navigate = useNavigate()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const login = useGoogleLogin({
    onSuccess: async (tokenResponse) => {
      try {
        const user = await signInWithGoogle(tokenResponse.access_token)
        setActiveUser({ id: user.id, name: user.name, avatarUrl: user.avatarUrl })
        navigate('/library', { replace: true })
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Sign in failed. Please try again.')
        setLoading(false)
      }
    },
    onError: () => {
      setError('Google sign in was cancelled or failed.')
      setLoading(false)
    },
  })

  function handleSignIn() {
    setLoading(true)
    setError(null)
    login()
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
          onClick={handleSignIn}
          disabled={loading}
          className="w-full flex items-center justify-center gap-3 bg-[#000] hover:bg-[#1a1a1a] active:bg-[#333] text-white py-3.5 rounded-xl text-[15px] font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? (
            <Loader2 size={16} className="animate-spin" />
          ) : (
            <GoogleLogo />
          )}
          {loading ? 'Signing in…' : 'Sign in with Google'}
        </button>

        {error && (
          <p className="text-[#c0392b] text-xs text-center mt-4">{error}</p>
        )}
      </div>
    </div>
  )
}

function GoogleLogo() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden>
      <path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.875 2.684-6.615z"/>
      <path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.258c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332C2.438 15.983 5.482 18 9 18z"/>
      <path fill="#FBBC05" d="M3.964 10.707c-.18-.54-.282-1.117-.282-1.707s.102-1.167.282-1.707V4.961H.957C.347 6.174 0 7.548 0 9s.348 2.826.957 4.039l3.007-2.332z"/>
      <path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0 5.482 0 2.438 2.017.957 4.961L3.964 7.293C4.672 5.166 6.656 3.58 9 3.58z"/>
    </svg>
  )
}
