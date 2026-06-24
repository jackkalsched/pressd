import { useState, useRef, useEffect } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { Search, Music, Loader2, ChevronRight, X } from 'lucide-react'
import { useGoogleLogin } from '@react-oauth/google'
import { signInWithGoogle } from '../api'
import { useUser } from '../context/UserContext'

const BASE = import.meta.env.VITE_API_BASE ?? 'http://localhost:8000'

function VinylRecord() {
  return (
    <div className="vinyl-wrap" aria-hidden>
      <div className="vinyl">
        {/* Grooves */}
        {[82, 74, 66, 58, 50, 42].map(r => (
          <div key={r} className="groove" style={{ width: `${r}%`, height: `${r}%` }} />
        ))}
        {/* Label */}
        <div className="label">
          <Music size={18} className="label-icon" />
          <span className="label-text">Press'd</span>
        </div>
        {/* Shine */}
        <div className="shine" />
      </div>
    </div>
  )
}

interface SearchResult {
  spotify_id: string | null
  album_name: string
  artist: string
  year: number | null
  cover_url: string | null
  total_tracks: number
}

function NavSearch() {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [])

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (!query.trim()) { setResults([]); setOpen(false); return }
    debounceRef.current = setTimeout(async () => {
      setLoading(true)
      try {
        const res = await fetch(`${BASE}/search/?q=${encodeURIComponent(query)}`)
        const data: SearchResult[] = await res.json()
        setResults(data.slice(0, 6))
        setOpen(data.length > 0)
      } catch {
        setResults([])
      } finally {
        setLoading(false)
      }
    }, 350)
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [query])

  return (
    <div ref={containerRef} className="nav-search">
      <div className="nav-search-input">
        <Search size={14} className="search-icon" />
        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          onFocus={() => results.length > 0 && setOpen(true)}
          placeholder="Search albums, artists…"
          className="search-field"
        />
        {loading && <Loader2 size={13} className="search-spin" />}
        {query && !loading && (
          <button onClick={() => { setQuery(''); setResults([]); setOpen(false) }}>
            <X size={13} className="search-clear" />
          </button>
        )}
      </div>

      {open && results.length > 0 && (
        <div className="search-dropdown">
          {results.map((album, i) => (
            <div key={i} className="search-result">
              <div className="result-art">
                {album.cover_url
                  ? <img src={album.cover_url} alt={album.album_name} />
                  : <Music size={14} className="result-art-fallback" />}
              </div>
              <div className="result-info">
                <p className="result-title">{album.album_name}</p>
                <p className="result-meta">{album.artist}{album.year ? ` · ${album.year}` : ''}</p>
              </div>
              <ChevronRight size={13} className="result-chevron" />
            </div>
          ))}
        </div>
      )}
    </div>
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
      } catch (err) {
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
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

        .landing {
          min-height: 100vh;
          background: #ffffff;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
          display: flex;
          flex-direction: column;
        }

        /* ── Nav ───────────────────────────────── */
        .landing-nav {
          position: sticky;
          top: 0;
          z-index: 100;
          background: rgba(255,255,255,0.92);
          backdrop-filter: blur(12px);
          -webkit-backdrop-filter: blur(12px);
          border-bottom: 1px solid #efefef;
          padding: 0 32px;
          height: 60px;
          display: flex;
          align-items: center;
          gap: 20px;
        }

        .nav-search {
          position: relative;
          flex: 1;
          max-width: 340px;
        }

        .nav-search-input {
          display: flex;
          align-items: center;
          gap: 8px;
          background: #f5f5f5;
          border: 1px solid #e8e8e8;
          border-radius: 12px;
          padding: 8px 12px;
          transition: border-color 0.15s;
        }

        .nav-search-input:focus-within {
          border-color: #5C8E74;
          background: #fff;
        }

        .search-icon { color: #bbb; flex-shrink: 0; }
        .search-spin { color: #bbb; flex-shrink: 0; animation: spin 0.8s linear infinite; }
        .search-clear { color: #bbb; cursor: pointer; flex-shrink: 0; }
        .search-clear:hover { color: #555; }

        @keyframes spin { to { transform: rotate(360deg); } }

        .search-field {
          background: transparent;
          border: none;
          outline: none;
          font-size: 13.5px;
          color: #111;
          width: 100%;
        }

        .search-field::placeholder { color: #bbb; }

        .search-dropdown {
          position: absolute;
          top: calc(100% + 8px);
          left: 0;
          width: 400px;
          background: #fff;
          border: 1px solid #e2e2e2;
          border-radius: 16px;
          box-shadow: 0 8px 32px rgba(0,0,0,0.10);
          overflow: hidden;
        }

        .search-result {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 10px 16px;
          cursor: pointer;
          border-bottom: 1px solid #f5f5f5;
          transition: background 0.1s;
        }

        .search-result:last-child { border-bottom: none; }
        .search-result:hover { background: #f8faf9; }

        .result-art {
          width: 40px;
          height: 40px;
          border-radius: 8px;
          overflow: hidden;
          background: #e8e8e8;
          flex-shrink: 0;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .result-art img { width: 100%; height: 100%; object-fit: cover; }
        .result-art-fallback { color: #bbb; }
        .result-info { flex: 1; min-width: 0; }
        .result-title { font-size: 13.5px; font-weight: 500; color: #111; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .result-meta { font-size: 12px; color: #888; margin-top: 1px; }
        .result-chevron { color: #ccc; flex-shrink: 0; }

        /* nav links */
        .nav-links {
          display: flex;
          align-items: center;
          gap: 4px;
          margin-left: auto;
        }

        .nav-link {
          padding: 6px 12px;
          font-size: 13.5px;
          font-weight: 500;
          color: #555;
          text-decoration: none;
          border-radius: 8px;
          transition: color 0.15s, background 0.15s;
        }

        .nav-link:hover { color: #111; background: #f5f5f5; }

        .nav-divider {
          width: 1px;
          height: 20px;
          background: #e8e8e8;
          margin: 0 4px;
        }

        .btn-signin {
          display: flex;
          align-items: center;
          gap: 8px;
          background: #111;
          color: #fff;
          font-size: 13.5px;
          font-weight: 600;
          padding: 8px 16px;
          border-radius: 10px;
          border: none;
          cursor: pointer;
          transition: background 0.15s;
          white-space: nowrap;
        }

        .btn-signin:hover { background: #333; }
        .btn-signin:disabled { opacity: 0.6; cursor: not-allowed; }

        .nav-logo {
          display: flex;
          align-items: center;
          gap: 8px;
          text-decoration: none;
          margin-left: 16px;
          flex-shrink: 0;
        }

        .logo-mark {
          width: 28px;
          height: 28px;
          background: #2D6A4F;
          border-radius: 8px;
          display: flex;
          align-items: center;
          justify-content: center;
          color: #fff;
        }

        .logo-text {
          font-size: 17px;
          font-weight: 800;
          color: #111;
          letter-spacing: -0.5px;
        }

        /* ── Hero ───────────────────────────────── */
        .hero {
          flex: 1;
          display: flex;
          align-items: center;
          padding: 0 80px;
          min-height: calc(100vh - 60px);
          background: linear-gradient(135deg, #ffffff 0%, #f4f8f5 50%, #edf4ef 100%);
          overflow: hidden;
          position: relative;
        }

        .hero-content {
          flex: 1;
          max-width: 560px;
          padding-right: 40px;
          z-index: 1;
        }

        .hero-eyebrow {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          font-size: 12px;
          font-weight: 600;
          color: #2D6A4F;
          background: #e8f2ed;
          padding: 5px 12px;
          border-radius: 100px;
          margin-bottom: 28px;
          letter-spacing: 0.04em;
          text-transform: uppercase;
        }

        .hero-headline {
          font-size: clamp(40px, 5vw, 64px);
          font-weight: 800;
          color: #5C8E74;
          line-height: 1.05;
          letter-spacing: -1.5px;
          margin-bottom: 20px;
        }

        .hero-sub {
          font-size: 17px;
          color: #6b7280;
          line-height: 1.6;
          margin-bottom: 40px;
          max-width: 420px;
          font-weight: 400;
        }

        .hero-actions {
          display: flex;
          align-items: center;
          gap: 12px;
          flex-wrap: wrap;
        }

        .btn-primary {
          display: flex;
          align-items: center;
          gap: 8px;
          background: #2D6A4F;
          color: #fff;
          font-size: 15px;
          font-weight: 600;
          padding: 14px 28px;
          border-radius: 14px;
          border: none;
          cursor: pointer;
          transition: background 0.15s, transform 0.1s;
        }

        .btn-primary:hover { background: #245c43; transform: translateY(-1px); }
        .btn-primary:active { transform: translateY(0); }
        .btn-primary:disabled { opacity: 0.6; cursor: not-allowed; transform: none; }

        .auth-error {
          font-size: 12px;
          color: #c0392b;
          margin-top: 12px;
        }

        /* ── Vinyl (signature element) ─────────── */
        .vinyl-wrap {
          flex-shrink: 0;
          width: min(420px, 40vw);
          aspect-ratio: 1;
          display: flex;
          align-items: center;
          justify-content: center;
          animation: float 6s ease-in-out infinite;
        }

        @keyframes float {
          0%, 100% { transform: translateY(0px) rotate(-3deg); }
          50% { transform: translateY(-18px) rotate(3deg); }
        }

        .vinyl {
          width: 100%;
          height: 100%;
          border-radius: 50%;
          background: radial-gradient(circle at 30% 30%, #2a2a2a 0%, #111111 60%, #0a0a0a 100%);
          position: relative;
          display: flex;
          align-items: center;
          justify-content: center;
          box-shadow:
            0 40px 80px rgba(0,0,0,0.35),
            0 0 0 2px rgba(255,255,255,0.04) inset;
        }

        .groove {
          position: absolute;
          border-radius: 50%;
          border: 1px solid rgba(255,255,255,0.06);
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
        }

        .label {
          width: 32%;
          height: 32%;
          border-radius: 50%;
          background: radial-gradient(circle at 40% 35%, #3d8b64, #2D6A4F 50%, #1e5038);
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 4px;
          box-shadow: 0 2px 8px rgba(0,0,0,0.4);
          position: relative;
          z-index: 1;
        }

        .label-icon { color: rgba(255,255,255,0.9); width: 22%; height: 22%; }
        .label-text {
          font-size: min(11px, 1.5vw);
          font-weight: 800;
          color: rgba(255,255,255,0.95);
          letter-spacing: 0.08em;
          text-transform: uppercase;
        }

        .shine {
          position: absolute;
          top: 8%;
          left: 12%;
          width: 30%;
          height: 30%;
          border-radius: 50%;
          background: radial-gradient(circle, rgba(255,255,255,0.07) 0%, transparent 70%);
          pointer-events: none;
        }

        /* ── Responsive ─────────────────────────── */
        @media (max-width: 900px) {
          .landing-nav { padding: 0 20px; }
          .nav-link { display: none; }
          .nav-divider { display: none; }
          .hero { padding: 60px 28px; flex-direction: column; align-items: flex-start; min-height: auto; gap: 48px; }
          .hero-content { max-width: 100%; padding-right: 0; }
          .vinyl-wrap { width: min(280px, 80vw); margin: 0 auto; }
        }

        @media (max-width: 560px) {
          .nav-search { max-width: 180px; }
          .hero-headline { letter-spacing: -0.5px; }
        }

        @media (prefers-reduced-motion: reduce) {
          .vinyl-wrap { animation: none; }
        }
      `}</style>

      <div className="landing">
        {/* ── Nav ── */}
        <nav className="landing-nav">
          <div className="nav-links">
            <Link to="/library" className="nav-link">Library</Link>
            <Link to="/ratings" className="nav-link">Ratings</Link>
            <Link to="/stats" className="nav-link">Stats</Link>
            <Link to="/social" className="nav-link">Social</Link>
            <div className="nav-divider" />
            <button onClick={handleSignIn} disabled={authLoading} className="btn-signin">
              {authLoading ? <Loader2 size={14} style={{ animation: 'spin 0.8s linear infinite' }} /> : <GoogleLogo />}
              {authLoading ? 'Signing in…' : 'Log in / Sign up'}
            </button>
          </div>

          <a href="/" className="nav-logo">
            <div className="logo-mark">
              <Music size={15} />
            </div>
            <span className="logo-text">Press'd</span>
          </a>
        </nav>

        {/* ── Hero ── */}
        <section className="hero">
          <div className="hero-content">
            <div className="hero-eyebrow">
              <Music size={11} />
              Music · Rated
            </div>

            <h1 className="hero-headline">
              Log your music taste and find new favorites!
            </h1>

            <p className="hero-sub">
              Recommendations based on you and your friends' listening habits.
            </p>

            <div className="hero-actions">
              <button onClick={handleSignIn} disabled={authLoading} className="btn-primary">
                {authLoading
                  ? <Loader2 size={16} style={{ animation: 'spin 0.8s linear infinite' }} />
                  : <GoogleLogo />}
                {authLoading ? 'Signing in…' : 'Get started with Google'}
              </button>
            </div>

            {authError && <p className="auth-error">{authError}</p>}
          </div>

          <VinylRecord />
        </section>
      </div>
    </>
  )
}
