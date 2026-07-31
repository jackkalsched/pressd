// Public landing page. Green field, cream type, and the Pressd mark spinning
// at the centre of a small scene of floating app UI.
//
// The old hero was a bespoke turntable drawing built from the previous logo,
// complete with a tonearm and groove lines. The current brand mark has neither,
// so that illustration is gone — the mark itself is now the hero, and the spin
// comes from PressdMark's highlight sweep rather than a rotating record.
import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Music, Loader2, Star, Apple } from 'lucide-react'
import { useGoogleLogin } from '@react-oauth/google'
import { signInWithGoogle } from '../api'
import { useUser } from '../context/UserContext'
import PressdMark from '../components/PressdMark'

function Stars({ filled }: { filled: number }) {
  return (
    <span className="card-stars" aria-hidden>
      {[0, 1, 2, 3, 4].map(i => (
        <Star
          key={i}
          size={11}
          className="star"
          style={{ animationDelay: `${1.7 + i * 0.09}s` }}
          fill={i < filled ? '#c8a84b' : 'none'}
          color={i < filled ? '#c8a84b' : '#d6cdc0'}
          strokeWidth={1.5}
        />
      ))}
    </span>
  )
}

function GoogleLogo() {
  return (
    <svg width="16" height="16" viewBox="0 0 18 18" aria-hidden>
      <path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.875 2.684-6.615z"/>
      <path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.258c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332C2.438 15.983 5.482 18 9 18z"/>
      <path fill="#FBBC05" d="M3.964 10.707c-.18-.54-.282-1.117-.282-1.707s.102-1.167.282-1.707V4.961H.957C.347 6.174 0 7.548 0 9s.348 2.826.957 4.039l3.007-2.332z"/>
      <path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0 5.482 0 2.438 2.017.957 4.961L3.964 7.293C4.672 5.166 6.656 3.58 9 3.58z"/>
    </svg>
  )
}

export default function LandingPage() {
  const { setActiveUser } = useUser()
  const navigate = useNavigate()
  const [authLoading, setAuthLoading] = useState(false)
  const [authError, setAuthError] = useState<string | null>(null)

  const login = useGoogleLogin({
    onSuccess: async (tokenResponse) => {
      try {
        const user = await signInWithGoogle(tokenResponse.access_token)
        setActiveUser({ id: user.id, name: user.name, avatarUrl: user.avatarUrl })
        navigate('/library', { replace: true })
      } catch {
        setAuthError('Sign in failed. Please try again.')
        setAuthLoading(false)
      }
    },
    onError: () => {
      setAuthError('Sign in was cancelled.')
      setAuthLoading(false)
    },
  })

  function handleSignIn() {
    setAuthLoading(true)
    setAuthError(null)
    login()
  }

  return (
    <>
      <style>{`
        .landing *, .landing *::before, .landing *::after { box-sizing: border-box; margin: 0; padding: 0; }

        .landing {
          min-height: 100vh;
          /* Brand green, deepened toward vinyl ink in the corners so the
             floating cards have something to sit against. */
          background:
            radial-gradient(120% 90% at 78% 45%, #47775E 0%, #3E6B54 42%, #2F5341 100%);
          color: #F4F2EC;
          font-family: 'DM Sans', system-ui, sans-serif;
          display: flex;
          flex-direction: column;
          overflow: hidden;
        }

        /* ── Nav ───────────────────────────────── */
        .landing-nav {
          position: sticky;
          top: 0;
          z-index: 100;
          background: rgba(47,83,65,0.72);
          backdrop-filter: blur(14px);
          -webkit-backdrop-filter: blur(14px);
          border-bottom: 1px solid rgba(244,242,236,0.14);
          padding: 0 32px;
          height: 64px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 20px;
        }

        .nav-logo {
          display: flex;
          align-items: center;
          gap: 9px;
          text-decoration: none;
          color: inherit;
          flex-shrink: 0;
        }
        .nav-logo svg { width: 30px; height: 30px; display: block; }

        .logo-text {
          font-family: 'Clash Display', 'Plus Jakarta Sans', system-ui, sans-serif;
          font-size: 20px;
          font-weight: 700;
          color: #F4F2EC;
          letter-spacing: -0.4px;
        }

        .nav-links {
          display: flex;
          align-items: center;
          gap: 26px;
          margin-left: auto;
          margin-right: 8px;
        }

        .nav-link {
          font-size: 14px;
          font-weight: 600;
          color: rgba(244,242,236,0.78);
          text-decoration: none;
          transition: color 0.15s;
          white-space: nowrap;
        }
        .nav-link:hover { color: #F4F2EC; }

        .btn-signin {
          display: flex;
          align-items: center;
          gap: 8px;
          background: #F4F2EC;
          color: #23372C;
          font-family: inherit;
          font-size: 13.5px;
          font-weight: 600;
          padding: 9px 16px;
          border-radius: 10px;
          border: none;
          cursor: pointer;
          transition: background 0.15s, transform 0.12s;
          white-space: nowrap;
          flex-shrink: 0;
        }
        .btn-signin:hover { background: #fff; transform: translateY(-1px); }
        .btn-signin:disabled { opacity: 0.6; cursor: not-allowed; transform: none; }
        .btn-signin:focus-visible, .btn-primary:focus-visible {
          outline: 2px solid #F4F2EC;
          outline-offset: 2px;
        }

        /* ── Hero ───────────────────────────────── */
        .hero {
          flex: 1;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: clamp(40px, 6vw, 96px);
          padding: 48px 64px 64px;
          min-height: calc(100vh - 64px);
          position: relative;
        }

        /* concentric rings echoing a record, now in cream on green */
        .hero::before {
          content: '';
          position: absolute;
          inset: 0;
          background:
            repeating-radial-gradient(circle at 74% 50%,
              rgba(244,242,236,0.05) 0 1px, transparent 1px 64px);
          pointer-events: none;
        }

        .hero-content { max-width: 540px; position: relative; z-index: 1; }

        .hero-eyebrow {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          font-size: 12px;
          font-weight: 700;
          color: #CFE3D6;
          background: rgba(244,242,236,0.12);
          padding: 5px 12px;
          border-radius: 100px;
          margin-bottom: 26px;
          letter-spacing: 0.06em;
          text-transform: uppercase;
        }

        .hero-headline {
          font-family: 'Clash Display', 'Plus Jakarta Sans', system-ui, sans-serif;
          font-size: clamp(46px, 6vw, 84px);
          font-weight: 700;
          color: #F4F2EC;
          line-height: 1.02;
          letter-spacing: -2.5px;
          margin-bottom: 22px;
        }

        .hero-sub {
          font-size: 17.5px;
          color: rgba(244,242,236,0.76);
          line-height: 1.6;
          margin-bottom: 36px;
          max-width: 430px;
        }

        .btn-primary {
          display: inline-flex;
          align-items: center;
          gap: 10px;
          background: #F4F2EC;
          color: #23372C;
          font-family: inherit;
          font-size: 15px;
          font-weight: 700;
          padding: 15px 28px;
          border-radius: 14px;
          border: none;
          cursor: pointer;
          box-shadow: 0 12px 28px -10px rgba(0,0,0,0.5);
          transition: background 0.15s, transform 0.12s, box-shadow 0.15s;
        }
        .btn-primary:hover {
          background: #fff;
          transform: translateY(-1px);
          box-shadow: 0 16px 32px -10px rgba(0,0,0,0.55);
        }
        .btn-primary:active { transform: translateY(0); }
        .btn-primary:disabled { opacity: 0.6; cursor: not-allowed; transform: none; }

        .btn-primary .google-chip {
          background: #fff;
          border-radius: 6px;
          width: 24px;
          height: 24px;
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
          box-shadow: inset 0 0 0 1px rgba(0,0,0,0.06);
        }

        .ios-note {
          display: inline-flex;
          align-items: center;
          gap: 7px;
          font-size: 13.5px;
          color: rgba(244,242,236,0.7);
          margin-top: 18px;
        }
        .ios-note svg { flex-shrink: 0; }

        .auth-error { font-size: 13px; color: #ffc9c2; margin-top: 12px; }

        /* entrance */
        .rise { opacity: 0; animation: rise 0.7s cubic-bezier(0.22, 1, 0.36, 1) forwards; }
        .rise.d1 { animation-delay: 0.1s; }
        .rise.d2 { animation-delay: 0.25s; }
        .rise.d3 { animation-delay: 0.4s; }
        .rise.d4 { animation-delay: 0.55s; }

        @keyframes rise {
          from { opacity: 0; transform: translateY(16px); }
          to   { opacity: 1; transform: translateY(0); }
        }

        /* ── Mark scene ────────────────────────── */
        .scene {
          position: relative;
          width: min(460px, 40vw);
          flex-shrink: 0;
          z-index: 1;
        }

        .scene .mark {
          width: 100%;
          height: auto;
          display: block;
          filter: drop-shadow(0 30px 50px rgba(0,0,0,0.42));
        }

        /* floating rating cards — a taste of the real app UI */
        .mini-card {
          position: absolute;
          display: flex;
          align-items: center;
          gap: 10px;
          background: #FAF8F5;
          border: 1px solid rgba(244,242,236,0.5);
          border-radius: 16px;
          padding: 10px 14px 10px 10px;
          box-shadow: 0 18px 40px -6px rgba(0,0,0,0.42);
          opacity: 0;
          animation:
            card-in 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) forwards,
            drift 6s ease-in-out infinite;
        }

        .mini-card.a { top: 2%; right: -12%; animation-delay: 1.0s, 1.5s; }
        .mini-card.b { bottom: 16%; left: -16%; animation-delay: 1.2s, 2.1s; }

        @keyframes card-in {
          from { opacity: 0; transform: scale(0.84) translateY(14px); }
          to   { opacity: 1; transform: scale(1) translateY(0); }
        }

        @keyframes drift {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-9px); }
        }

        .sleeve {
          width: 44px; height: 44px; border-radius: 10px;
          flex-shrink: 0; position: relative; overflow: hidden;
        }
        .sleeve::after {
          content: '';
          position: absolute;
          inset: 0;
          background: radial-gradient(circle at 50% 50%, rgba(255,255,255,0.22) 0 12%, transparent 13%);
        }
        .sleeve.amber { background: linear-gradient(135deg, #d97706, #7c2d12); }
        .sleeve.slate { background: linear-gradient(135deg, #64748b, #1e293b); }

        .card-title { font-size: 13px; font-weight: 700; color: #1c1917; line-height: 1.2; white-space: nowrap; }
        .card-artist { font-size: 11.5px; color: #78716c; margin-top: 1px; white-space: nowrap; }
        .card-stars { display: flex; gap: 2px; margin-top: 5px; }

        .star { opacity: 0; animation: star-in 0.3s cubic-bezier(0.34, 1.56, 0.64, 1) forwards; }
        @keyframes star-in {
          from { opacity: 0; transform: scale(0.4); }
          to   { opacity: 1; transform: scale(1); }
        }

        .score-badge {
          font-family: 'Playfair Display', Georgia, serif;
          font-size: 17px;
          font-weight: 700;
          color: #fff;
          background: #3E6B54;
          border-radius: 100px;
          padding: 5px 11px;
          margin-left: 6px;
          font-variant-numeric: tabular-nums;
          flex-shrink: 0;
        }

        .friend-chip {
          position: absolute;
          bottom: 7%;
          right: -9%;
          display: flex;
          align-items: center;
          gap: 8px;
          background: #fff;
          border: 1px solid rgba(244,242,236,0.5);
          border-radius: 100px;
          padding: 7px 14px 7px 8px;
          font-size: 12.5px;
          color: #57534e;
          box-shadow: 0 12px 30px -8px rgba(0,0,0,0.42);
          opacity: 0;
          animation:
            card-in 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) forwards,
            drift 7s ease-in-out infinite;
          animation-delay: 1.45s, 2.6s;
          white-space: nowrap;
        }

        .friend-chip .avatar {
          width: 22px; height: 22px; border-radius: 50%;
          background: #3E6B54; color: #fff; font-size: 11px; font-weight: 700;
          display: flex; align-items: center; justify-content: center; flex-shrink: 0;
        }
        .friend-chip strong { color: #1c1917; font-weight: 700; }
        .friend-chip .chip-score { color: #3E6B54; font-weight: 700; }

        @media (prefers-reduced-motion: reduce) {
          .mini-card, .friend-chip, .star, .rise { animation: none; opacity: 1; }
        }

        /* ── Responsive ─────────────────────────── */
        @media (max-width: 980px) {
          .landing-nav { padding: 0 20px; gap: 12px; }
          .nav-links { gap: 16px; margin-right: 4px; }
          .hero {
            flex-direction: column;
            padding: 48px 24px 72px;
            min-height: auto;
            gap: 64px;
          }
          .hero-content { max-width: 560px; }
          .scene { width: min(340px, 74vw); }
          .mini-card.a { right: -8%; }
          .mini-card.b { left: -8%; }
          .friend-chip { right: 0; }
        }

        @media (max-width: 620px) {
          .nav-links { display: none; }
          .hero-headline { letter-spacing: -1.4px; }
          .mini-card.a { right: -4%; }
          .mini-card.b { left: -4%; bottom: 8%; }
          .friend-chip { display: none; }
        }
      `}</style>

      <div className="landing">
        {/* ── Nav ── */}
        <nav className="landing-nav">
          <Link to="/" className="nav-logo">
            <PressdMark size={30} tone="onGreen" />
            <span className="logo-text">Pressd</span>
          </Link>

          {/* Charts is deliberately not offered here — the landing page points
              visitors at How it Works and sign-up, nothing else. The page still
              exists at /charts for anyone who has the link. */}
          <div className="nav-links">
            <Link to="/how-it-works" className="nav-link">How it Works</Link>
          </div>

          <button onClick={handleSignIn} disabled={authLoading} className="btn-signin">
            {authLoading ? <Loader2 size={14} className="animate-spin" /> : <GoogleLogo />}
            {authLoading ? 'Signing in…' : 'Log in / Sign up'}
          </button>
        </nav>

        {/* ── Hero ── */}
        <section className="hero">
          <div className="hero-content">
            <div className="hero-eyebrow rise d1">
              <Music size={11} />
              Music · Rated
            </div>

            <h1 className="hero-headline rise d2">Track your taste.</h1>

            <p className="hero-sub rise d3">
              Rate albums track by track, compare scores with friends,
              and find your next favorite record.
            </p>

            <div className="rise d4">
              <button onClick={handleSignIn} disabled={authLoading} className="btn-primary">
                <span className="google-chip">
                  {authLoading ? <Loader2 size={14} className="animate-spin" /> : <GoogleLogo />}
                </span>
                {authLoading ? 'Signing in…' : 'Get started with Google'}
              </button>
              <p className="ios-note">
                <Apple size={14} />
                Pressd is coming to iPhone — iOS beta starting soon.
              </p>
              {authError && <p className="auth-error">{authError}</p>}
            </div>
          </div>

          {/* ── Mark scene ── */}
          <div className="scene">
            <PressdMark className="mark" spinning tone="onGreen" />

            <div className="mini-card a" aria-hidden>
              <div className="sleeve amber" />
              <div>
                <p className="card-title">To Pimp a Butterfly</p>
                <p className="card-artist">Kendrick Lamar</p>
                <Stars filled={5} />
              </div>
              <span className="score-badge">9.8</span>
            </div>

            <div className="mini-card b" aria-hidden>
              <div className="sleeve slate" />
              <div>
                <p className="card-title">Rumours</p>
                <p className="card-artist">Fleetwood Mac</p>
                <Stars filled={4} />
              </div>
              <span className="score-badge">9.2</span>
            </div>

            <div className="friend-chip" aria-hidden>
              <span className="avatar">R</span>
              <span>
                <strong>Roxy</strong> just rated <strong>Blonde</strong>{' '}
                <span className="chip-score">9.5</span>
              </span>
            </div>
          </div>
        </section>
      </div>
    </>
  )
}
