// Public landing page. Green field, cream type, and the Pressd mark spinning
// at the centre of a small scene of floating app UI.
//
// The old hero was a bespoke turntable drawing built from the previous logo,
// complete with a tonearm and groove lines. The current brand mark has neither,
// so that illustration is gone — the mark itself is now the hero, and the spin
// comes from PressdMark's highlight sweep rather than a rotating record.
import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ChevronLeft, ChevronRight, Loader2, Star } from 'lucide-react'
import { useGoogleLogin } from '@react-oauth/google'
import { signInWithGoogle } from '../api'
import { useUser } from '../context/UserContext'
import PressdMark from '../components/PressdMark'
import AppleLogo from '../components/AppleLogo'
import { IOS_APP_LINK } from '../lib/iosApp'

// Real artwork, from the same iTunes artwork CDN the app already uses for
// album covers. 200px renders crisply at the card's 44px on a 2x display.
const ART = {
  tpab: 'https://is1-ssl.mzstatic.com/image/thumb/Music112/v4/b5/a6/91/b5a69171-5232-3d5b-9c15-8963802f83dd/15UMGIM15814.rgb.jpg/200x200bb.jpg',
  rumours: 'https://is1-ssl.mzstatic.com/image/thumb/Music124/v4/4d/13/ba/4d13bac3-d3d5-7581-2c74-034219eadf2b/081227970949.jpg/200x200bb.jpg',
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
          fill={i < filled ? 'var(--c-c8a84b)' : 'none'}
          color={i < filled ? 'var(--c-c8a84b)' : 'var(--c-d6cdc0)'}
          strokeWidth={1.5}
        />
      ))}
    </span>
  )
}

function GoogleLogo() {
  return (
    <svg width="16" height="16" viewBox="0 0 18 18" aria-hidden>
      <path fill="#4285f4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.875 2.684-6.615z"/>
      <path fill="#34a853" d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.258c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332C2.438 15.983 5.482 18 9 18z"/>
      <path fill="#fbbc05" d="M3.964 10.707c-.18-.54-.282-1.117-.282-1.707s.102-1.167.282-1.707V4.961H.957C.347 6.174 0 7.548 0 9s.348 2.826.957 4.039l3.007-2.332z"/>
      <path fill="#ea4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0 5.482 0 2.438 2.017.957 4.961L3.964 7.293C4.672 5.166 6.656 3.58 9 3.58z"/>
    </svg>
  )
}

// Apple's badge shape drawn in CSS, sized to sit level with the Google button.
function StoreBadge() {
  return (
    <a {...IOS_APP_LINK} className="btn-store">
      <AppleLogo size={24} />
      <span className="store-text">
        <span className="store-small">Download on the</span>
        <span className="store-big">App Store</span>
      </span>
    </a>
  )
}

// Screens from the iPhone app (frontend/public/app/), 720px wide from the
// simulator's 1242, in the order the carousel shows them.
const APP_SCREENS = [
  { src: '/app/for-you.jpg', alt: 'Pressd on iPhone: the For You feed' },
  { src: '/app/profile.jpg', alt: 'Pressd on iPhone: a profile with picks and stats' },
  { src: '/app/compare.jpg', alt: 'Pressd on iPhone: comparing ratings with friends' },
  { src: '/app/thread.jpg', alt: 'Pressd on iPhone: the discussion for an album' },
  { src: '/app/charts.jpg', alt: 'Pressd on iPhone: the charts' },
  { src: '/app/stats.jpg', alt: 'Pressd on iPhone: bangs, skips and genres' },
  { src: '/app/library.jpg', alt: 'Pressd on iPhone: a library of rated albums' },
  { src: '/app/discussions.jpg', alt: 'Pressd on iPhone: heated discussions' },
  { src: '/app/share-card.jpg', alt: 'Pressd on iPhone: a rating share card' },
]

// The app's screens in a row that wraps around, scrolled by the arrows or by
// swipe. Three copies sit end to end and the row starts on the middle one;
// whenever scrolling settles outside it, the row jumps one copy's width back
// towards it. Every copy is identical, so the jump lands on the same picture
// and there is no end to reach in either direction. A press moves about one
// window of phones.
function ScreenCarousel() {
  const rowRef = useRef<HTMLDivElement>(null)
  const settle = useRef<number | undefined>(undefined)

  const recentre = useCallback(() => {
    const row = rowRef.current
    if (!row) return
    const copy = row.scrollWidth / 3
    if (row.scrollLeft < copy * 0.5) row.scrollLeft += copy
    else if (row.scrollLeft > copy * 1.5) row.scrollLeft -= copy
  }, [])

  useEffect(() => {
    const row = rowRef.current
    if (row) row.scrollLeft = row.scrollWidth / 3
    return () => window.clearTimeout(settle.current)
  }, [])

  function onScroll() {
    window.clearTimeout(settle.current)
    settle.current = window.setTimeout(recentre, 140)
  }

  function step(dir: 1 | -1) {
    const row = rowRef.current
    if (!row) return
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    row.scrollBy({ left: dir * row.clientWidth * 0.8, behavior: reduce ? 'auto' : 'smooth' })
  }

  return (
    <div className="app-carousel">
      <button type="button" className="app-arrow prev" onClick={() => step(-1)} aria-label="Previous screens">
        <ChevronLeft size={22} />
      </button>
      <div className="app-row" ref={rowRef} onScroll={onScroll}>
        {[0, 1, 2].map(copy => APP_SCREENS.map(screen => (
          <div key={`${copy}-${screen.src}`} className="app-slide" aria-hidden={copy !== 1 || undefined}>
            <img src={screen.src} alt={copy === 1 ? screen.alt : ''} width={720} height={1558} />
          </div>
        )))}
      </div>
      <button type="button" className="app-arrow next" onClick={() => step(1)} aria-label="Next screens">
        <ChevronRight size={22} />
      </button>
    </div>
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
        setActiveUser({ id: user.id, name: user.name, avatarUrl: user.avatarUrl, tutorialSeen: user.tutorialSeen, usernameChosen: user.usernameChosen })
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

  // Arriving at /#iphone from another page (How it Works links here): the
  // router changes the route but doesn't scroll to an anchor, so do it once.
  useEffect(() => {
    if (window.location.hash === '#iphone') {
      document.getElementById('iphone')?.scrollIntoView()
    }
  }, [])

  function handleSignIn() {
    setAuthLoading(true)
    setAuthError(null)
    login()
  }

  return (
    <>
      <style>{`
        .landing *, .landing *::before, .landing *::after { box-sizing: border-box; margin: 0; padding: 0; }

        /* The iPhone buttons jump to the showcase further down this page. */
        @media (prefers-reduced-motion: no-preference) { html { scroll-behavior: smooth; } }

        .landing {
          min-height: 100vh;
          /* Brand green, deepened toward vinyl ink in the corners so the
             floating cards have something to sit against. */
          background:
            radial-gradient(120% 90% at 78% 45%, #47775E 0%, #3E6B54 42%, #2F5341 100%);
          color: #F4F2EC;
          font-family: 'Plus Jakarta Sans', system-ui, sans-serif;
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

        /* real cover art, so no gradient stand-ins */
        .sleeve {
          width: 44px; height: 44px; border-radius: 10px;
          flex-shrink: 0; object-fit: cover; display: block;
          background: rgba(28,25,23,0.08);
        }

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


        /* ── Hero actions: web sign-in and the iPhone app, side by side ── */
        .hero-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; }

        .app-pill {
          display: inline-flex;
          align-items: center;
          gap: 7px;
          margin-bottom: 22px;
          padding: 7px 14px;
          border-radius: 999px;
          background: rgba(244,242,236,0.12);
          border: 1px solid rgba(244,242,236,0.28);
          color: #F4F2EC;
          font-size: 13.5px;
          font-weight: 700;
          text-decoration: none;
          transition: background 0.15s, border-color 0.15s, transform 0.12s;
        }
        .app-pill:hover { background: rgba(244,242,236,0.2); border-color: rgba(244,242,236,0.6); transform: translateY(-1px); }
        .app-pill:focus-visible { outline: 2px solid #F4F2EC; outline-offset: 2px; }

        /* The same 54px height, radius and shadow as .btn-primary, so neither
           way in outranks the other. */
        .btn-store {
          display: inline-flex;
          align-items: center;
          gap: 10px;
          height: 54px;
          padding: 0 24px 0 20px;
          border-radius: 14px;
          background: #000;
          color: #fff;
          border: 1px solid rgba(255,255,255,0.28);
          text-decoration: none;
          box-shadow: 0 12px 28px -10px rgba(0,0,0,0.5);
          transition: background 0.15s, transform 0.12s, box-shadow 0.15s;
        }
        .btn-store:hover { background: #161616; transform: translateY(-1px); box-shadow: 0 16px 32px -10px rgba(0,0,0,0.55); }
        .btn-store:active { transform: translateY(0); }
        .btn-store:focus-visible { outline: 2px solid #F4F2EC; outline-offset: 2px; }
        .store-text { display: flex; flex-direction: column; align-items: flex-start; line-height: 1; }
        .store-small { font-size: 11px; font-weight: 500; letter-spacing: 0.01em; }
        .store-big { font-size: 20px; font-weight: 700; letter-spacing: -0.3px; margin-top: 3px; }

        .nav-app {
          display: inline-flex;
          align-items: center;
          gap: 6px;
        }

        /* ── The iPhone app ─────────────────────────────────────────────
           Its own full-width band below the hero, so the app is a thing the
           page shows rather than a line it mentions. Under the badge, the
           app's own screens in a carousel (.app-carousel, below). */
        .app-band {
          position: relative;
          background: linear-gradient(180deg, #24382D 0%, #1B2A22 100%);
          padding: 96px 32px 0;
          text-align: center;
          scroll-margin-top: 64px;
        }
        .app-eyebrow {
          display: inline-flex;
          align-items: center;
          gap: 7px;
          font-size: 12px;
          font-weight: 700;
          letter-spacing: 0.16em;
          text-transform: uppercase;
          color: #9CC9B0;
        }
        .app-title {
          font-family: 'Clash Display', 'Plus Jakarta Sans', system-ui, sans-serif;
          font-size: clamp(36px, 4.6vw, 64px);
          font-weight: 700;
          line-height: 1.04;
          letter-spacing: -1.8px;
          color: #F4F2EC;
          margin-top: 14px;
        }
        .app-sub {
          max-width: 520px;
          margin: 18px auto 30px;
          font-size: 17px;
          line-height: 1.6;
          color: rgba(244,242,236,0.72);
        }
        .app-get {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 18px;
        }
        .app-qr {
          width: 92px;
          height: 92px;
          padding: 6px;
          border-radius: 12px;
          background: #fff;
          box-shadow: 0 12px 28px -12px rgba(0,0,0,0.6);
        }
        /* Nothing to scan with on the phone that's showing the page. */
        @media (max-width: 760px), (pointer: coarse) {
          .app-qr { display: none; }
        }

        /* A level row of phones that scrolls sideways: the arrows step it,
           and a swipe or trackpad moves it directly. The scrollbar is hidden
           because the arrows stand in for it. */
        .app-carousel {
          position: relative;
          max-width: 1240px;
          margin: 48px auto 0;
          padding: 0 72px;
        }
        .app-row {
          display: flex;
          gap: 28px;
          overflow-x: auto;
          scroll-snap-type: x mandatory;
          scrollbar-width: none;
          padding: 24px 4px 72px;
        }
        .app-row::-webkit-scrollbar { display: none; }
        /* Each screen sits in a dark bezel, so the row reads as phones
           rather than a strip of pictures. */
        .app-slide {
          width: clamp(180px, 17vw, 240px);
          flex-shrink: 0;
          scroll-snap-align: start;
          padding: 7px;
          border-radius: 34px;
          background: #0E1512;
          box-shadow: 0 30px 60px -20px rgba(0,0,0,0.65), 0 0 0 1px rgba(244,242,236,0.16);
          transition: transform 0.3s cubic-bezier(0.22, 1, 0.36, 1);
        }
        .app-slide img { display: block; width: 100%; height: auto; border-radius: 27px; }
        .app-slide:hover { transform: translateY(-4%); }
        .app-arrow {
          position: absolute;
          top: calc(50% - 24px);
          transform: translateY(-50%);
          width: 48px;
          height: 48px;
          border-radius: 999px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: #F4F2EC;
          color: #23372C;
          border: none;
          cursor: pointer;
          box-shadow: 0 12px 28px -10px rgba(0,0,0,0.6);
          transition: background 0.15s, opacity 0.15s, transform 0.12s;
          z-index: 2;
        }
        .app-arrow.prev { left: 12px; }
        .app-arrow.next { right: 12px; }
        .app-arrow:hover { background: #fff; }
        .app-arrow:active { transform: translateY(-50%) scale(0.94); }
        .app-arrow:focus-visible { outline: 2px solid #F4F2EC; outline-offset: 3px; }

        @media (max-width: 760px) {
          .app-band { padding: 72px 0 0; }
          .app-title, .app-sub, .app-eyebrow { margin-left: 24px; margin-right: 24px; }
          /* A phone swipes; the arrows would only crowd the screens. */
          .app-carousel { margin-top: 32px; padding: 0; }
          .app-row { gap: 16px; padding: 24px 24px 56px; scroll-padding: 0 24px; }
          .app-slide { width: 62vw; }
          .app-arrow { display: none; }
        }
        @media (prefers-reduced-motion: reduce) {
          .app-slide, .app-slide:hover { transition: none; transform: none; }
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

          <div className="nav-links">
            <Link to="/charts" className="nav-link">Charts</Link>
            <Link to="/how-it-works" className="nav-link">How it Works</Link>
            <a {...IOS_APP_LINK} className="nav-link nav-app">
              <AppleLogo size={13} /> iPhone app
            </a>
          </div>

          <button onClick={handleSignIn} disabled={authLoading} className="btn-signin">
            {authLoading ? <Loader2 size={14} className="animate-spin" /> : <GoogleLogo />}
            {authLoading ? 'Signing in…' : 'Log in / Sign up'}
          </button>
        </nav>

        {/* ── Hero ── */}
        <section className="hero">
          <div className="hero-content">
            <a {...IOS_APP_LINK} className="app-pill rise">
              <AppleLogo size={13} /> Now on the App Store!
            </a>

            <h1 className="hero-headline rise d1">Track your taste.</h1>

            <p className="hero-sub rise d2">
              Rate albums track by track, compare scores with friends,
              and find your next favorite record.
            </p>

            <div className="rise d3">
              <div className="hero-actions">
                <button onClick={handleSignIn} disabled={authLoading} className="btn-primary">
                  <span className="google-chip">
                    {authLoading ? <Loader2 size={14} className="animate-spin" /> : <GoogleLogo />}
                  </span>
                  {authLoading ? 'Signing in…' : 'Get started with Google'}
                </button>
                {/* Level with the web sign-in, not under it as a footnote:
                    the app is the other way in, not an aside — but the page
                    tells web visitors about it rather than steering them off. */}
                <StoreBadge />
              </div>
              {authError && <p className="auth-error">{authError}</p>}
            </div>
          </div>

          {/* ── Mark scene ── */}
          <div className="scene">
            <PressdMark className="mark" spinning tone="onGreen" />

            <div className="mini-card a" aria-hidden>
              <img className="sleeve" src={ART.tpab} alt="" loading="lazy" />
              <div>
                <p className="card-title">To Pimp a Butterfly</p>
                <p className="card-artist">Kendrick Lamar</p>
                <Stars filled={5} />
              </div>
              <span className="score-badge">9.80</span>
            </div>

            <div className="mini-card b" aria-hidden>
              <img className="sleeve" src={ART.rumours} alt="" loading="lazy" />
              <div>
                <p className="card-title">Rumours</p>
                <p className="card-artist">Fleetwood Mac</p>
                <Stars filled={4} />
              </div>
              <span className="score-badge">9.20</span>
            </div>

            <div className="friend-chip" aria-hidden>
              <span className="avatar">R</span>
              <span>
                <strong>Roxy</strong> just rated <strong>Blonde</strong>{' '}
                <span className="chip-score">9.50</span>
              </span>
            </div>
          </div>
        </section>

        {/* ── The iPhone app ── */}
        <section className="app-band" id="iphone">
          <p className="app-eyebrow"><AppleLogo size={13} /> Pressd for iPhone</p>
          <h2 className="app-title">Your record collection,<br />in your pocket.</h2>
          <p className="app-sub">
            Rate as you listen, settle scores with friends, and get told the
            moment someone sends you a record.
          </p>
          <div className="app-get">
            <StoreBadge />
            {/* Desktop only: a visitor on a computer can't install from this
                tab, but their phone can read the listing off the screen. */}
            <img
              className="app-qr"
              src="/app/qr-code.png"
              alt="QR code for Pressd on the App Store"
              width={400}
              height={400}
            />
          </div>

          <ScreenCarousel />
        </section>
      </div>
    </>
  )
}
