// Tutorial — five cards explaining how Pressd works, shown once to a new
// account before the welcome page's first-album pick.
//
// The web port of mobile/app/tutorial.tsx: the same cards, copy and rule. "Once"
// is recorded on the account (PressUser.tutorial_seen_at), not the browser, so
// someone who met it on their phone doesn't meet it again here. The gate in
// App's AppGate sends only an explicit tutorialSeen === false here. Finishing or
// skipping both count as seen: a tutorial someone has chosen to skip is not one
// they want to meet again.
//
// The profile dialog reopens it with ?replay=1. A replay records nothing and
// goes back to where it came from instead of moving on to the welcome page.
//
// Mobile swipes between cards; here it's Next/Back, the arrow keys, the dots,
// and a swipe on touch screens.
import { useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { useUser } from '../context/UserContext'
import {
  FriendsScene,
  FrontToBackScene,
  LearnsYouScene,
  TheRecordScene,
  YourCatalogScene,
} from '../components/TutorialScenes'

// Word for word with mobile/app/tutorial.tsx — change both.
const CARDS = [
  {
    title: 'Front to back.',
    body: 'Rate every song in track order. Songs unlock one at a time on your first listen, and you can change any score afterwards.',
    Scene: FrontToBackScene,
  },
  {
    title: 'Then the record.',
    body: 'Your song average is the base. Four factors move it up or down, judged against your own taste.',
    Scene: TheRecordScene,
  },
  {
    title: 'Your catalog.',
    body: 'Albums you want to hear wait in To Listen. When a friend recommends one, it lands there with their note.',
    Scene: YourCatalogScene,
  },
  {
    title: 'Better with friends.',
    body: "See what friends are rating and compare your taste. Each album has its own discussion, which opens once you've rated it.",
    Scene: FriendsScene,
  },
  {
    // Ten is MIN_RATED_ALBUMS in backend/scoring.py — change both.
    title: 'It learns your taste.',
    body: "After 10 rated albums, Pressd starts predicting what you'll love, and the predictions sharpen with every record you rate.",
    Scene: LearnsYouScene,
  },
]

export default function Tutorial() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const { activeUser, completeTutorial } = useUser()
  // Someone who has seen it and typed the URL gets the replay behaviour too:
  // there is nothing to record and nowhere new to send them.
  const isReplay = params.get('replay') === '1' || activeUser?.tutorialSeen !== false

  const [page, setPage] = useState(0)
  const last = page === CARDS.length - 1
  const { title, body, Scene } = CARDS[page]

  function finish() {
    if (isReplay) {
      if (window.history.state?.idx > 0) navigate(-1)
      else navigate('/for-you', { replace: true })
      return
    }
    completeTutorial()
    navigate('/welcome', { replace: true })
  }

  function go(to: number) {
    setPage(Math.max(0, Math.min(CARDS.length - 1, to)))
  }

  function next() {
    if (last) finish()
    else go(page + 1)
  }

  // The arrow keys page through, the way a swipe does on mobile.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'ArrowRight') setPage((p) => Math.min(CARDS.length - 1, p + 1))
      else if (e.key === 'ArrowLeft') setPage((p) => Math.max(0, p - 1))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const touchX = useRef<number | null>(null)

  // One column on a phone-width window, like mobile. From lg up the scene and
  // the copy sit side by side across a 1200px stage, so a desktop window isn't
  // a narrow strip down the middle of an empty page.
  return (
    <div className="min-h-screen bg-[#faf8f5] flex flex-col">
      <div className="mx-auto w-full max-w-[1200px] flex-1 flex flex-col px-4 md:px-12 py-6 md:py-10">
        <div className="flex items-center justify-between h-11">
          <p className="m-0 text-[11px] font-bold tracking-[0.18em] text-[#2d6a4f]">HOW PRESSD WORKS</p>
          {/* The last card's button already does what Skip would. */}
          {!last && (
            <button onClick={finish} className="text-[14px] font-semibold text-[#a8a29e] hover:text-[#57534e] transition-colors">
              {isReplay ? 'Close' : 'Skip'}
            </button>
          )}
        </div>

        <div
          className="flex-1 flex items-center"
          onTouchStart={(e) => { touchX.current = e.touches[0].clientX }}
          onTouchEnd={(e) => {
            if (touchX.current == null) return
            const dx = e.changedTouches[0].clientX - touchX.current
            touchX.current = null
            if (dx < -50) go(page + 1)
            else if (dx > 50) go(page - 1)
          }}
        >
          {/* Keyed on the page, so a card come back to replays from the start
              instead of resuming mid-animation. */}
          <div
            key={page}
            className="tut-slide-in w-full max-w-[440px] lg:max-w-none mx-auto grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] items-center gap-6 lg:gap-20"
          >
            <div className="flex items-center justify-center min-h-[340px] lg:min-h-[520px] rounded-[28px] lg:bg-[#f2ede5] lg:p-10">
              <div className="w-full max-w-[440px] bg-white rounded-[20px] border border-[#ece6dc] p-5 lg:p-6 shadow-[0_8px_24px_-12px_rgba(50,30,10,0.18)]">
                <Scene />
              </div>
            </div>

            <div>
              <p className="hidden lg:block m-0 mb-3 text-[13px] font-semibold text-[#a8a29e] tabular-nums">
                {page + 1} / {CARDS.length}
              </p>
              <h1 className="font-display m-0 text-[34px] leading-[40px] lg:text-[52px] lg:leading-[58px] font-bold tracking-[-0.01em] text-[#1c1917]">{title}</h1>
              {/* Four lines' height, so the title holds still between cards. */}
              <p className="m-0 mt-2 lg:mt-4 text-[15.5px] leading-[23px] lg:text-[18px] lg:leading-[28px] text-[#78716c] min-h-[92px] lg:min-h-[112px] lg:max-w-[460px]">{body}</p>
              <div className="hidden lg:block mt-8 max-w-[460px]">{controls()}</div>
            </div>
          </div>
        </div>

        <div className="lg:hidden w-full max-w-[440px] mx-auto mt-2">{controls()}</div>
      </div>
    </div>
  )

  function controls() {
    return (
      <div className="flex flex-col gap-5">
        <div className="flex justify-center lg:justify-start gap-2.5" aria-label={`Card ${page + 1} of ${CARDS.length}`}>
          {CARDS.map((c, i) => (
            <button
              key={c.title}
              onClick={() => go(i)}
              aria-label={`Card ${i + 1}`}
              aria-current={i === page ? 'step' : undefined}
              className="w-[7px] h-[7px] rounded-full bg-[#2d6a4f] transition-[opacity,transform] duration-200"
              style={{ opacity: i === page ? 1 : 0.3, transform: i === page ? 'scale(1.35)' : undefined }}
            />
          ))}
        </div>

        <div className="flex gap-2">
          {page > 0 && (
            <button
              onClick={() => go(page - 1)}
              aria-label="Previous card"
              className="h-[52px] w-[52px] shrink-0 rounded-xl border border-[#e2dbd0] bg-white hover:bg-[#f5f1ea] text-[#57534e] flex items-center justify-center transition-colors"
            >
              <ArrowLeft size={18} />
            </button>
          )}
          <button
            onClick={next}
            className="flex-1 h-[52px] rounded-xl bg-[#2d6a4f] hover:bg-[#245c43] text-white text-[15.5px] font-semibold transition-colors"
          >
            {!last ? 'Next' : isReplay ? 'Done' : 'Pick your first album'}
          </button>
        </div>
      </div>
    )
  }
}
