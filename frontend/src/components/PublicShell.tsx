// Chrome for the pages a logged-out visitor can reach: the green field, the
// nav, and the sign-in button. Charts and How it Works both sit inside this so
// the marketing surface reads as one place rather than three.
//
// Sign-in is duplicated from the landing page rather than shared, because the
// landing page redirects into /library on success while these pages should send
// you where you already were heading. Keep the two flows in sync if either moves.
import { useState, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useGoogleLogin } from '@react-oauth/google'
import { Loader2 } from 'lucide-react'
import { signInWithGoogle } from '../api'
import { useUser } from '../context/UserContext'
import PressdMark from './PressdMark'

export const PUBLIC_SHELL_CSS = `
  .pub *, .pub *::before, .pub *::after { box-sizing: border-box; margin: 0; padding: 0; }

  .pub {
    min-height: 100vh;
    background: radial-gradient(120% 80% at 60% 0%, #47775E 0%, #3E6B54 45%, #2F5341 100%);
    background-attachment: fixed;
    color: #F4F2EC;
    font-family: 'DM Sans', system-ui, sans-serif;
  }

  .pub-nav {
    position: sticky;
    top: 0;
    z-index: 100;
    background: rgba(47,83,65,0.78);
    backdrop-filter: blur(14px);
    -webkit-backdrop-filter: blur(14px);
    border-bottom: 1px solid rgba(244,242,236,0.14);
    padding: 0 32px;
    height: 64px;
    display: flex;
    align-items: center;
    gap: 20px;
  }

  .pub-logo { display: flex; align-items: center; gap: 9px; text-decoration: none; color: inherit; flex-shrink: 0; }
  .pub-logo svg { width: 30px; height: 30px; display: block; }
  .pub-logo span {
    font-family: 'Clash Display', 'Plus Jakarta Sans', system-ui, sans-serif;
    font-size: 20px;
    font-weight: 700;
    letter-spacing: -0.4px;
    color: #F4F2EC;
  }

  .pub-links { display: flex; align-items: center; gap: 26px; margin-left: auto; margin-right: 8px; }
  .pub-link {
    font-size: 14px; font-weight: 600; text-decoration: none;
    color: rgba(244,242,236,0.78); transition: color 0.15s; white-space: nowrap;
  }
  .pub-link:hover { color: #F4F2EC; }
  .pub-link.active { color: #F4F2EC; }

  .pub-cta {
    display: flex; align-items: center; gap: 8px;
    background: #F4F2EC; color: #23372C;
    font-family: inherit; font-size: 13.5px; font-weight: 600;
    padding: 9px 16px; border-radius: 10px; border: none; cursor: pointer;
    transition: background 0.15s, transform 0.12s; white-space: nowrap; flex-shrink: 0;
  }
  .pub-cta:hover { background: #fff; transform: translateY(-1px); }
  .pub-cta:disabled { opacity: 0.6; cursor: not-allowed; transform: none; }

  .pub-body { max-width: 1000px; margin: 0 auto; padding: 52px 24px 96px; }

  .pub-title {
    font-family: 'Clash Display', 'Plus Jakarta Sans', system-ui, sans-serif;
    font-size: clamp(38px, 5vw, 60px);
    font-weight: 700;
    letter-spacing: -1.8px;
    line-height: 1.03;
  }
  .pub-lede {
    font-size: 17px;
    line-height: 1.6;
    color: rgba(244,242,236,0.74);
    margin-top: 14px;
    max-width: 620px;
  }

  @media (max-width: 700px) {
    .pub-nav { padding: 0 18px; gap: 12px; }
    .pub-links { gap: 14px; }
    .pub-body { padding: 36px 18px 72px; }
  }
  @media (max-width: 520px) {
    .pub-links { display: none; }
  }
`

export default function PublicShell({
  active,
  children,
}: {
  active?: 'charts' | 'how'
  children: ReactNode
}) {
  const { setActiveUser } = useUser()
  const navigate = useNavigate()
  const [loading, setLoading] = useState(false)

  const login = useGoogleLogin({
    onSuccess: async (tokenResponse) => {
      try {
        const user = await signInWithGoogle(tokenResponse.access_token)
        setActiveUser({ id: user.id, name: user.name, avatarUrl: user.avatarUrl })
        navigate('/for-you', { replace: true })
      } catch {
        setLoading(false)
      }
    },
    onError: () => setLoading(false),
  })

  return (
    <div className="pub">
      <style>{PUBLIC_SHELL_CSS}</style>

      <nav className="pub-nav">
        <Link to="/" className="pub-logo">
          <PressdMark size={30} tone="onGreen" />
          <span>Pressd</span>
        </Link>

        <div className="pub-links">
          <Link to="/charts" className={`pub-link${active === 'charts' ? ' active' : ''}`}>Charts</Link>
          <Link to="/how-it-works" className={`pub-link${active === 'how' ? ' active' : ''}`}>How it Works</Link>
        </div>

        <button
          className="pub-cta"
          disabled={loading}
          onClick={() => { setLoading(true); login() }}
        >
          {loading ? <Loader2 size={14} className="animate-spin" /> : null}
          {loading ? 'Signing in…' : 'Log in / Sign up'}
        </button>
      </nav>

      {children}
    </div>
  )
}
