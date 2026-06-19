import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Music } from 'lucide-react'
import { signInWithGoogle } from '../api'
import { useUser } from '../context/UserContext'

export default function Login() {
  const { activeUser, setActiveUser } = useUser()
  const navigate = useNavigate()
  const buttonRef = useRef<HTMLDivElement>(null)
  const [sdkReady, setSdkReady] = useState(!!window.google)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (activeUser) {
      navigate('/library', { replace: true })
    }
  }, [activeUser])

  useEffect(() => {
    if (window.google) { setSdkReady(true); return }
    const onLoad = () => setSdkReady(true)
    const scripts = document.querySelectorAll<HTMLScriptElement>(
      'script[src="https://accounts.google.com/gsi/client"]',
    )
    if (scripts.length) {
      scripts[0].addEventListener('load', onLoad)
      return () => scripts[0].removeEventListener('load', onLoad)
    }
  }, [])

  useEffect(() => {
    if (!sdkReady || !window.google || !buttonRef.current) return
    window.google.accounts.id.initialize({
      client_id: import.meta.env.VITE_GOOGLE_CLIENT_ID ?? '',
      auto_select: false,
      callback: async ({ credential }) => {
        setError(null)
        try {
          const user = await signInWithGoogle(credential)
          setActiveUser({ id: user.id, name: user.name, avatarUrl: user.avatarUrl })
          navigate('/library', { replace: true })
        } catch (err) {
          setError(err instanceof Error ? err.message : 'Sign in failed. Please try again.')
        }
      },
    })
    window.google.accounts.id.renderButton(buttonRef.current, {
      theme: 'filled_black',
      size: 'large',
      width: 320,
      text: 'signin_with',
      shape: 'rectangular',
    })
  }, [sdkReady])

  return (
    <div className="min-h-screen bg-white flex items-center justify-center px-4">
      <div className="w-full max-w-xs">

        <div className="flex items-center gap-2.5 mb-12 justify-center">
          <Music size={26} className="text-[#2d6a4f]" />
          <span className="text-[#111] font-bold tracking-wide text-2xl">Press'd</span>
        </div>

        <h1 className="text-xl font-semibold text-[#111] text-center mb-1">Sign in</h1>
        <p className="text-[#999] text-sm text-center mb-10">Your ratings, on every device.</p>

        <div ref={buttonRef} className="flex justify-center min-h-[44px]" />

        {!sdkReady && !error && (
          <p className="text-[#bbb] text-xs text-center mt-3">Loading…</p>
        )}
        {error && (
          <p className="text-[#c0392b] text-xs text-center mt-4">{error}</p>
        )}
      </div>
    </div>
  )
}
