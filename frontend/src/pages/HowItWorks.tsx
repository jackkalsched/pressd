// How it Works — the orientation page for someone who has just found Pressd and
// doesn't yet know what "rate an album track by track" actually involves.
//
// Written to be readable before signing up, so it explains the scoring model in
// plain terms rather than naming internals. If the scoring changes (factor
// weights, EP handling, the prediction model), this page has to change too —
// see backend/scoring.py and song_score_model.py.
import { Link } from 'react-router-dom'
import { ListMusic, Sliders, Sparkles, Users, BarChart3 } from 'lucide-react'
import PublicShell from '../components/PublicShell'
import AppleLogo from '../components/AppleLogo'

const STEPS = [
  {
    icon: ListMusic,
    title: 'Add an album',
    body: 'Search for any record across time. You will find niche favorites and new releases. Pick one and the full tracklist comes with it.',
  },
  {
    icon: Sliders,
    title: 'Score it track by track',
    body: 'Rate every song from 1 to 10. Skip the interludes and intros, but the more you score, the better Pressd gets at predicting your taste.',
  },
  {
    icon: Sparkles,
    title: 'Add the things a track average misses',
    body: 'Then score the album on theme, replay value, production and distinctness. Those combine with your song scores into one number. You can adjust how much each factor matters to you, and Pressd will learn from your choices!',
  },
  {
    icon: BarChart3,
    title: 'Watch your taste take shape',
    body: 'Once you have rated enough, Pressd builds a model of how you score and starts predicting what you will make of records you have not heard yet. Check out deeper, advanced stats in your Profile too!',
  },
  {
    icon: Users,
    title: 'Compare with friends',
    body: 'Follow people, see what they are rating, and compare scores album by album.',
  },
]

const FAQS = [
  {
    q: 'Do I have to rate every song?',
    a: 'Yes!!! Pressd is meant to encourage users to rate the WHOLE record, not just their favorites. The song scores are what the album score is built from.',
  },
  {
    q: 'What makes a good score?',
    a: 'Scores are relative to you as well as a global average. Pressd shows where each album sits against your own distribution, so a 7 from someone generous and a 7 from someone harsh are read differently.',
  },
  {
    q: 'Can other people see my ratings?',
    a: 'Yes! Find friends and see their ratings too. Ratings, reviews and comments appear on your profile and in the social feed. Do not fret though, your information is safe :)',
  },
  {
    q: 'Is it free?',
    a: 'Yes! You will not find ads on Pressd, either.',
  },
]

export default function HowItWorks() {
  return (
    <PublicShell active="how">
      <style>{`
        .steps { display: flex; flex-direction: column; gap: 2px; margin: 42px 0 56px; }
        .step {
          display: grid;
          grid-template-columns: 56px 1fr;
          gap: 20px;
          align-items: start;
          padding: 24px 22px;
          background: rgba(244,242,236,0.055);
          border: 1px solid rgba(244,242,236,0.12);
        }
        .step:first-child { border-radius: 16px 16px 0 0; }
        .step:last-child { border-radius: 0 0 16px 16px; }
        .step + .step { border-top: none; }

        .step-icon {
          width: 44px; height: 44px; border-radius: 12px;
          background: rgba(244,242,236,0.13);
          display: flex; align-items: center; justify-content: center;
          color: #CFE3D6; flex-shrink: 0;
        }
        .step-n {
          font-size: 11px; font-weight: 700; letter-spacing: 0.16em;
          color: rgba(244,242,236,0.5); text-transform: uppercase;
        }
        .step-title {
          font-family: 'Clash Display', 'Plus Jakarta Sans', system-ui, sans-serif;
          font-size: 21px; font-weight: 700; letter-spacing: -0.5px; margin-top: 5px;
        }
        .step-body { font-size: 15px; line-height: 1.65; color: rgba(244,242,236,0.76); margin-top: 8px; max-width: 640px; }

        .section-title {
          font-family: 'Clash Display', 'Plus Jakarta Sans', system-ui, sans-serif;
          font-size: 28px; font-weight: 700; letter-spacing: -0.8px; margin-bottom: 20px;
        }

        .faqs { display: grid; grid-template-columns: repeat(2, 1fr); gap: 18px; }
        .faq {
          background: rgba(244,242,236,0.055);
          border: 1px solid rgba(244,242,236,0.12);
          border-radius: 14px;
          padding: 20px;
        }
        .faq-q { font-size: 15.5px; font-weight: 700; }
        .faq-a { font-size: 14.5px; line-height: 1.6; color: rgba(244,242,236,0.74); margin-top: 7px; }

        .closer {
          margin-top: 56px;
          padding: 32px;
          border-radius: 18px;
          background: rgba(244,242,236,0.08);
          border: 1px solid rgba(244,242,236,0.16);
          display: flex; align-items: center; justify-content: space-between;
          gap: 24px; flex-wrap: wrap;
        }
        .closer-title {
          font-family: 'Clash Display', 'Plus Jakarta Sans', system-ui, sans-serif;
          font-size: 24px; font-weight: 700; letter-spacing: -0.6px;
        }
        .closer-sub { font-size: 14.5px; color: rgba(244,242,236,0.72); margin-top: 6px; }
        .closer-link {
          display: inline-flex; align-items: center; gap: 8px;
          background: #F4F2EC; color: #23372C;
          font-size: 14.5px; font-weight: 700;
          padding: 13px 22px; border-radius: 12px; text-decoration: none;
          transition: background 0.15s, transform 0.12s;
        }
        .closer-link:hover { background: #fff; transform: translateY(-1px); }

        .ios-line {
          display: inline-flex; align-items: center; gap: 8px;
          font-size: 14px; color: rgba(244,242,236,0.7); margin-top: 18px;
        }

        .contact-line {
          font-size: 14.5px; line-height: 1.6;
          color: rgba(244,242,236,0.72); margin-top: 22px;
        }
        .contact-line a {
          color: #CFE3D6; font-weight: 700; text-decoration: none;
          border-bottom: 1px solid rgba(207,227,214,0.35);
        }
        .contact-line a:hover { color: #fff; border-bottom-color: rgba(255,255,255,0.6); }

        @media (max-width: 700px) {
          .faqs { grid-template-columns: 1fr; }
          .step { grid-template-columns: 1fr; gap: 14px; padding: 20px 18px; }
        }
      `}</style>

      <main className="pub-body">
        <h1 className="pub-title">How it works</h1>
        <p className="pub-lede">
          Pressd turns listening into a record of your taste. You score albums song by song,
          and it works out what that says about you.
        </p>

        <div className="steps">
          {STEPS.map((s, i) => {
            const Icon = s.icon
            return (
              <div className="step" key={s.title}>
                <div className="step-icon"><Icon size={21} /></div>
                <div>
                  <p className="step-n">Step {i + 1}</p>
                  <h2 className="step-title">{s.title}</h2>
                  <p className="step-body">{s.body}</p>
                </div>
              </div>
            )
          })}
        </div>

        <h2 className="section-title">Common questions</h2>
        <div className="faqs">
          {FAQS.map((f) => (
            <div className="faq" key={f.q}>
              <p className="faq-q">{f.q}</p>
              <p className="faq-a">{f.a}</p>
            </div>
          ))}
        </div>

        {/* Also the App Store's support contact. Apple wants a support URL that
            leads somewhere a person can actually be reached, and this page is
            otherwise all answers and no way to ask. */}
        <p className="contact-line">
          Question we haven&apos;t answered, or something to tell us?{' '}
          <a href="mailto:pressdmusicapp@gmail.com">pressdmusicapp@gmail.com</a>
        </p>

        <div className="closer">
          <div>
            <p className="closer-title">Start with one album.</p>
            <p className="closer-sub">
              Rate something you know well — the model needs a few before it can predict anything.
            </p>
            <p className="ios-line">
              <AppleLogo size={14} />
              Pressd is coming to iPhone — iOS beta starting soon.
            </p>
          </div>
          <Link to="/charts" className="closer-link">See what people are rating</Link>
        </div>
      </main>
    </PublicShell>
  )
}
