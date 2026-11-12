// The shell the public legal pages share — Privacy, Terms of use and Community
// guidelines: Pressd's cream page, the bar with the wordmark, and the reading
// column's type. Public (no auth): App Review and anyone signed out opens them.
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'

export default function LegalPage({ children }: { children: ReactNode }) {
  return (
    <div className="legal">
      <style>{`
        .legal *, .legal *::before, .legal *::after { box-sizing: border-box; margin: 0; padding: 0; }

        .legal {
          min-height: 100vh;
          background: #f9f8f6;
          color: #1c1917;
          font-family: 'Plus Jakarta Sans', system-ui, sans-serif;
        }

        .legal-nav {
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
        .legal-logo { display: flex; align-items: center; gap: 10px; text-decoration: none; color: inherit; }
        .legal-logo img { height: 26px; width: auto; }
        .legal-logo span {
          font-family: 'Clash Display', 'Plus Jakarta Sans', system-ui, sans-serif;
          font-weight: 700;
          font-size: 20px;
          letter-spacing: -0.4px;
        }
        .legal-back {
          font-family: 'Plus Jakarta Sans', system-ui, sans-serif;
          font-size: 13.5px;
          font-weight: 600;
          color: #2d6a4f;
          text-decoration: none;
        }
        .legal-back:hover { text-decoration: underline; }

        .legal-body { max-width: 720px; margin: 0 auto; padding: 56px 24px 96px; }

        .legal h1 {
          font-family: 'Playfair Display', Georgia, serif;
          font-weight: 900;
          font-size: 44px;
          line-height: 1.1;
          letter-spacing: -0.5px;
        }
        .legal .updated {
          font-family: 'Plus Jakarta Sans', system-ui, sans-serif;
          font-size: 13.5px;
          color: #78716c;
          margin-top: 10px;
        }
        .legal .lede {
          font-size: 17px;
          line-height: 1.65;
          color: #57534e;
          margin-top: 28px;
        }

        .legal h2 {
          font-family: 'Playfair Display', Georgia, serif;
          font-weight: 700;
          font-size: 24px;
          margin-top: 44px;
          padding-top: 28px;
          border-top: 1px solid #e8e2d9;
        }
        .legal h3 {
          font-family: 'Plus Jakarta Sans', system-ui, sans-serif;
          font-weight: 700;
          font-size: 15px;
          margin-top: 24px;
        }
        .legal p, .legal li {
          font-size: 15.5px;
          line-height: 1.7;
          color: #44403c;
          margin-top: 12px;
        }
        /* Tailwind's preflight strips list markers globally, so restore them
           here — these lists are the substance of the page and need to scan. */
        .legal ul { margin-top: 8px; padding-left: 22px; list-style: disc outside; }
        .legal li { margin-top: 6px; }
        .legal li::marker { color: #a8998a; }
        .legal strong { color: #1c1917; font-weight: 600; }
        .legal a { color: #2d6a4f; }

        .legal .callout {
          margin-top: 20px;
          padding: 16px 18px;
          background: #ffffff;
          border: 1px solid #e8e2d9;
          border-radius: 12px;
        }
        .legal .callout p:first-child { margin-top: 0; }

        @media (max-width: 640px) {
          .legal-nav { padding: 0 20px; }
          .legal h1 { font-size: 34px; }
          .legal-body { padding: 40px 20px 72px; }
        }
      `}</style>

      <nav className="legal-nav">
        <Link to="/" className="legal-logo">
          <img src="/logo.png" alt="" />
          <span>Pressd</span>
        </Link>
        <Link to="/" className="legal-back">Back to Pressd</Link>
      </nav>

      <main className="legal-body">{children}</main>
    </div>
  )
}
