import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Music, Loader2, Star } from 'lucide-react'
import { useGoogleLogin } from '@react-oauth/google'
import { signInWithGoogle } from '../api'
import { useUser } from '../context/UserContext'

/* The hero is the Press'd mark itself, enlarged and brought to life:
   the disc spins, the tonearm drops the needle on load, and the copy
   rises in as it lands. Geometry comes straight from
   pressd_logos/pressd-pd-primary.svg (viewBox 0 0 170 206). */
function Turntable() {
  return (
    <svg
      className="turntable"
      viewBox="0 0 170 206"
      role="img"
      aria-label="Press'd turntable logo, spinning"
    >
      {/* Green P / d frame shapes */}
      <path d="M127 14 L141 14 Q146 14 146 19 L146.00 80.56 L146.65 84.06 L147.10 87.57 L147.36 91.07 L147.42 94.55 L147.30 98.00 L147.00 101.41 L146.52 104.78 L145.86 108.09 L145.03 111.33 L144.04 114.50 L142.89 117.59 L141.59 120.59 L140.15 123.50 L138.57 126.30 L136.86 129.01 L135.04 131.61 L133.11 134.10 L131.11 136.50 L131.11 136.50 A57.0 57.0 0 0 0 122.00 59.64 L122 19 Q122 14 127 14 Z" fill="#3E6B54" />
      <path d="M43 192 L29 192 Q24 192 24 187 L24.00 125.44 L23.35 121.94 L22.90 118.43 L22.64 114.93 L22.58 111.45 L22.70 108.00 L23.00 104.59 L23.48 101.22 L24.14 97.91 L24.97 94.67 L25.96 91.50 L27.11 88.41 L28.41 85.41 L29.85 82.50 L31.43 79.70 L33.14 76.99 L34.96 74.39 L36.89 71.90 L38.89 69.50 L38.89 69.50 A57.0 57.0 0 0 0 48.00 146.36 L48 187 Q48 192 43 192 Z" fill="#3E6B54" />

      {/* Spinning disc: grooves, glint arc, and label rotate together */}
      <g className="disc-rot">
        <circle cx="85" cy="103" r="50" fill="#212220" />
        <circle cx="85" cy="103" r="42" fill="none" stroke="#FFFFFF" strokeOpacity="0.16" strokeWidth="1.4" />
        <circle cx="85" cy="103" r="33" fill="none" stroke="#FFFFFF" strokeOpacity="0.1" strokeWidth="1.1" />
        <circle cx="85" cy="103" r="24" fill="none" stroke="#FFFFFF" strokeOpacity="0.06" strokeWidth="0.9" />
        {/* glint so the spin reads */}
        <circle cx="85" cy="103" r="46" fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth="9" strokeDasharray="46 243" strokeLinecap="round" />
        {/* record label */}
        <circle cx="85" cy="103" r="13.5" fill="#F4F2EC" />
        <circle cx="85" cy="103" r="13.5" fill="none" stroke="#3E6B54" strokeOpacity="0.35" strokeWidth="0.5" />
        <defs>
          <path id="label-ring" d="M 85 94.6 A 8.4 8.4 0 1 1 84.99 94.6" />
        </defs>
        <text fontSize="3.1" fill="#3E6B54" fontWeight="700" letterSpacing="0.9" fontFamily="'Plus Jakarta Sans', sans-serif">
          <textPath href="#label-ring">PRESS'D · PRESS'D ·</textPath>
        </text>
        <circle cx="85" cy="103" r="3.3" fill="#212220" />
      </g>

      {/* Tonearm: starts lifted, drops the needle after load */}
      <g className="tonearm">
        <g fill="#3E6B54" transform="translate(29,10)">
          <circle cx="48" cy="16" r="5" />
          <line x1="48" y1="16" x2="30" y2="52" stroke="#3E6B54" strokeWidth="4.5" strokeLinecap="round" />
          <rect x="19.5" y="49" width="15" height="18" rx="3" transform="rotate(24 27 58)" />
          <path d="M26 65 L17.5 75.5 L30 70 Z" />
        </g>
      </g>
    </svg>
  )
}

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
          background: #f9f8f6;
          color: #1c1917;
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
          background: rgba(249,248,246,0.88);
          backdrop-filter: blur(12px);
          -webkit-backdrop-filter: blur(12px);
          border-bottom: 1px solid #e8e2d9;
          padding: 0 32px;
          height: 64px;
          display: flex;
          align-items: center;
          justify-content: space-between;
        }

        .nav-logo {
          display: flex;
          align-items: center;
          gap: 10px;
          text-decoration: none;
        }

        .nav-logo img { height: 34px; width: auto; display: block; }

        .logo-text {
          font-family: 'Plus Jakarta Sans', system-ui, sans-serif;
          font-size: 18px;
          font-weight: 800;
          color: #1c1917;
          letter-spacing: -0.5px;
        }

        .btn-signin {
          display: flex;
          align-items: center;
          gap: 8px;
          background: #fff;
          color: #1c1917;
          font-family: inherit;
          font-size: 13.5px;
          font-weight: 600;
          padding: 9px 16px;
          border-radius: 10px;
          border: 1px solid #e8e2d9;
          cursor: pointer;
          transition: background 0.15s, border-color 0.15s;
          white-space: nowrap;
        }

        .btn-signin:hover { background: #f7f3ee; border-color: #ddd5c9; }
        .btn-signin:disabled { opacity: 0.6; cursor: not-allowed; }
        .btn-signin:focus-visible, .btn-primary:focus-visible {
          outline: 2px solid #2d6a4f;
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

        /* faint oversized groove rings behind the turntable */
        .hero::before {
          content: '';
          position: absolute;
          inset: 0;
          background:
            repeating-radial-gradient(circle at 74% 52%,
              rgba(45,106,79,0.055) 0 1px, transparent 1px 64px);
          pointer-events: none;
        }

        .hero-content {
          max-width: 520px;
          position: relative;
          z-index: 1;
        }

        .hero-eyebrow {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          font-size: 12px;
          font-weight: 700;
          color: #2d6a4f;
          background: rgba(45,106,79,0.09);
          padding: 5px 12px;
          border-radius: 100px;
          margin-bottom: 26px;
          letter-spacing: 0.06em;
          text-transform: uppercase;
        }

        .hero-headline {
          font-family: 'Plus Jakarta Sans', system-ui, sans-serif;
          font-size: clamp(40px, 4.8vw, 66px);
          font-weight: 800;
          color: #1c1917;
          line-height: 1.04;
          letter-spacing: -2px;
          margin-bottom: 22px;
        }

        .hero-headline .on-record {
          font-family: 'Playfair Display', Georgia, serif;
          font-style: italic;
          font-weight: 600;
          color: #2d6a4f;
          letter-spacing: -1px;
        }

        .hero-sub {
          font-size: 17px;
          color: #78716c;
          line-height: 1.6;
          margin-bottom: 36px;
          max-width: 420px;
        }

        .btn-primary {
          display: inline-flex;
          align-items: center;
          gap: 10px;
          background: #2d6a4f;
          color: #fff;
          font-family: inherit;
          font-size: 15px;
          font-weight: 600;
          padding: 15px 28px;
          border-radius: 14px;
          border: none;
          cursor: pointer;
          box-shadow: 0 10px 24px -8px rgba(45,106,79,0.45);
          transition: background 0.15s, transform 0.12s, box-shadow 0.15s;
        }

        .btn-primary:hover {
          background: #245c43;
          transform: translateY(-1px);
          box-shadow: 0 14px 28px -8px rgba(45,106,79,0.5);
        }
        .btn-primary:active { background: #1e5238; transform: translateY(0); }
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
        }

        .cta-note {
          font-size: 13px;
          color: #a8998a;
          margin-top: 14px;
        }

        .auth-error {
          font-size: 13px;
          color: #c0392b;
          margin-top: 12px;
        }

        /* entrance: copy rises as the needle drops */
        .rise {
          opacity: 0;
          animation: rise 0.7s cubic-bezier(0.22, 1, 0.36, 1) forwards;
        }
        .rise.d1 { animation-delay: 0.1s; }
        .rise.d2 { animation-delay: 0.25s; }
        .rise.d3 { animation-delay: 0.4s; }
        .rise.d4 { animation-delay: 0.55s; }

        @keyframes rise {
          from { opacity: 0; transform: translateY(16px); }
          to   { opacity: 1; transform: translateY(0); }
        }

        /* ── Turntable scene (signature) ───────── */
        .scene {
          position: relative;
          width: min(500px, 42vw);
          flex-shrink: 0;
          z-index: 1;
        }

        .turntable {
          width: 100%;
          height: auto;
          display: block;
          filter: drop-shadow(0 30px 45px rgba(35,45,35,0.22));
        }

        .disc-rot {
          transform-origin: 85px 103px;
          transform-box: view-box;
          animation: disc-spin 5s linear infinite;
        }

        @keyframes disc-spin { to { transform: rotate(360deg); } }

        .tonearm {
          transform-origin: 77px 26px;
          transform-box: view-box;
          transform: rotate(-13deg);
          animation: needle-drop 1.25s cubic-bezier(0.34, 1.2, 0.5, 1) 0.5s forwards;
        }

        @keyframes needle-drop {
          from { transform: rotate(-13deg); }
          to   { transform: rotate(0deg); }
        }

        /* floating rating cards — a taste of the real app UI */
        .mini-card {
          position: absolute;
          display: flex;
          align-items: center;
          gap: 10px;
          background: #faf8f5;
          border: 1px solid #e8e2d9;
          border-radius: 16px;
          padding: 10px 14px 10px 10px;
          box-shadow: 0 14px 36px -4px rgba(50,30,10,0.14), 0 4px 10px -2px rgba(50,30,10,0.08);
          opacity: 0;
          animation:
            card-in 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) forwards,
            drift 6s ease-in-out infinite;
        }

        .mini-card.a { top: 2%; right: -12%; animation-delay: 1.35s, 1.85s; }
        .mini-card.b { bottom: 16%; left: -16%; animation-delay: 1.55s, 2.4s; }

        @keyframes card-in {
          from { opacity: 0; transform: scale(0.84) translateY(14px); }
          to   { opacity: 1; transform: scale(1) translateY(0); }
        }

        @keyframes drift {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-9px); }
        }

        .sleeve {
          width: 44px;
          height: 44px;
          border-radius: 10px;
          flex-shrink: 0;
          position: relative;
          overflow: hidden;
        }

        .sleeve::after {
          content: '';
          position: absolute;
          inset: 0;
          background: radial-gradient(circle at 50% 50%, rgba(255,255,255,0.22) 0 12%, transparent 13%);
        }

        .sleeve.amber { background: linear-gradient(135deg, #d97706, #7c2d12); }
        .sleeve.slate { background: linear-gradient(135deg, #64748b, #1e293b); }

        .card-title {
          font-size: 13px;
          font-weight: 700;
          color: #1c1917;
          line-height: 1.2;
          white-space: nowrap;
        }

        .card-artist {
          font-size: 11.5px;
          color: #78716c;
          margin-top: 1px;
          white-space: nowrap;
        }

        .card-stars { display: flex; gap: 2px; margin-top: 5px; }

        .star {
          opacity: 0;
          animation: star-in 0.3s cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
        }

        @keyframes star-in {
          from { opacity: 0; transform: scale(0.4); }
          to   { opacity: 1; transform: scale(1); }
        }

        .score-badge {
          font-family: 'Playfair Display', Georgia, serif;
          font-size: 17px;
          font-weight: 700;
          color: #fff;
          background: #2d6a4f;
          border-radius: 100px;
          padding: 5px 11px;
          margin-left: 6px;
          font-variant-numeric: tabular-nums;
          flex-shrink: 0;
        }

        /* friend-activity chip */
        .friend-chip {
          position: absolute;
          bottom: 7%;
          right: -9%;
          display: flex;
          align-items: center;
          gap: 8px;
          background: #fff;
          border: 1px solid #e8e2d9;
          border-radius: 100px;
          padding: 7px 14px 7px 8px;
          font-size: 12.5px;
          color: #57534e;
          box-shadow: 0 8px 24px -6px rgba(50,30,10,0.14);
          opacity: 0;
          animation:
            card-in 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) forwards,
            drift 7s ease-in-out infinite;
          animation-delay: 1.8s, 2.9s;
          white-space: nowrap;
        }

        .friend-chip .avatar {
          width: 22px;
          height: 22px;
          border-radius: 50%;
          background: #2d6a4f;
          color: #fff;
          font-size: 11px;
          font-weight: 700;
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
        }

        .friend-chip strong { color: #1c1917; font-weight: 700; }
        .friend-chip .chip-score { color: #2d6a4f; font-weight: 700; }

        /* ── Responsive ─────────────────────────── */
        @media (max-width: 980px) {
          .landing-nav { padding: 0 20px; }
          .hero {
            flex-direction: column;
            padding: 48px 24px 72px;
            min-height: auto;
            gap: 64px;
          }
          .hero-content { max-width: 560px; }
          .scene { width: min(360px, 78vw); }
          .mini-card.a { right: -8%; }
          .mini-card.b { left: -8%; }
          .friend-chip { right: 0; }
        }

        @media (max-width: 560px) {
          .hero-headline { letter-spacing: -1px; }
          .mini-card.a { right: -4%; }
          .mini-card.b { left: -4%; bottom: 8%; }
          .friend-chip { display: none; }
        }

        @media (prefers-reduced-motion: reduce) {
          .disc-rot, .tonearm, .mini-card, .friend-chip, .star, .rise {
            animation: none;
          }
          .tonearm { transform: rotate(0deg); }
          .mini-card, .friend-chip, .star, .rise { opacity: 1; }
        }
      `}</style>

      <div className="landing">
        {/* ── Nav ── */}
        <nav className="landing-nav">
          <a href="/" className="nav-logo">
            <img src="/logo.png" alt="Press'd logo" />
            <span className="logo-text">Press'd</span>
          </a>

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

            <h1 className="hero-headline rise d2">
              Your music taste,<br />
              <span className="on-record">on the record.</span>
            </h1>

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
              <p className="cta-note">Free to use — all you need is a Google account.</p>
              {authError && <p className="auth-error">{authError}</p>}
            </div>
          </div>

          {/* ── Turntable scene ── */}
          <div className="scene" aria-hidden>
            <Turntable />

            <div className="mini-card a">
              <div className="sleeve amber" />
              <div>
                <p className="card-title">To Pimp a Butterfly</p>
                <p className="card-artist">Kendrick Lamar</p>
                <Stars filled={5} />
              </div>
              <span className="score-badge">9.8</span>
            </div>

            <div className="mini-card b">
              <div className="sleeve slate" />
              <div>
                <p className="card-title">Rumours</p>
                <p className="card-artist">Fleetwood Mac</p>
                <Stars filled={4} />
              </div>
              <span className="score-badge">9.2</span>
            </div>

            <div className="friend-chip">
              <span className="avatar">M</span>
              <span>
                <strong>Maya</strong> just rated <strong>Blonde</strong>{' '}
                <span className="chip-score">9.5</span>
              </span>
            </div>
          </div>
        </section>
      </div>
    </>
  )
}
