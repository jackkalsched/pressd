// The five small scenes on the first-run tutorial, one per card.
//
// The web port of mobile/components/TutorialScenes.tsx: the same five
// miniatures, the same fixed scores and names, and the same scripts, drawn with
// state and CSS transitions where mobile uses Animated. Each is a miniature of
// the real screen it describes rather than an icon, so the first time a new
// user meets the rating flow or their catalog it already looks familiar. The
// only thing fetched is the welcome screen's album-art strip, so the covers are
// real records rather than grey squares.
//
// The tutorial mounts one scene at a time and remounts it each time its card
// comes back, so every effect here starts from fresh state and none of them has
// to reset anything. Under prefers-reduced-motion every scene renders its
// finished state and never moves.
//
// Card 1's four songs average 8.48 and card 2 starts from that average, so the
// two read as one album. Change the numbers together, here and on mobile.
import { useEffect, useState, type CSSProperties } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ArrowRight, ArrowUp, MessageCircle } from 'lucide-react'
import { fetchArtStrip } from '../api'
import { songScoreColor } from '../types'
import { avatarColor } from '../lib/format'

const GREEN = '#2d6a4f'
const INSET = '#ece6dc'

function reducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/** Cover art from the welcome screen's strip — same query key, so the welcome
 *  screen that follows opens with its belts already loaded. */
function useArt(): string[] {
  const { data = [] } = useQuery({ queryKey: ['art-strip'], queryFn: fetchArtStrip, staleTime: 10 * 60 * 1000 })
  return data
}

function Cover({ url, size, seed }: { url?: string; size: number; seed: string }) {
  const box: CSSProperties = { width: size, height: size, borderRadius: 8, flexShrink: 0 }
  if (url) return <img src={url} alt="" style={{ ...box, objectFit: 'cover' }} />
  return <div style={{ ...box, background: avatarColor(seed), opacity: 0.55 }} />
}

/** Runs `script` while mounted, with a sleep that stops on unmount. The script
 *  checks `alive()` after every await and returns when it goes false. */
function useScript(script: (sleep: (ms: number) => Promise<void>, alive: () => boolean) => Promise<void>, enabled: boolean) {
  useEffect(() => {
    if (!enabled) return
    let live = true
    const timers = new Set<ReturnType<typeof setTimeout>>()
    const sleep = (ms: number) =>
      new Promise<void>((resolve) => {
        const t = setTimeout(() => { timers.delete(t); resolve() }, ms)
        timers.add(t)
      })
    script(sleep, () => live)
    return () => {
      live = false
      timers.forEach(clearTimeout)
    }
    // The script is fixed per scene; it runs once per mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled])
}

/** Tween a number from `from` to `to`, easing out, calling `on` each frame. */
function tween(from: number, to: number, ms: number, on: (v: number) => void, alive: () => boolean): Promise<void> {
  return new Promise((resolve) => {
    const start = performance.now()
    const frame = (now: number) => {
      if (!alive()) return resolve()
      const t = Math.min(1, (now - start) / ms)
      on(from + (to - from) * (1 - Math.pow(1 - t, 3)))
      if (t < 1) requestAnimationFrame(frame)
      else resolve()
    }
    requestAnimationFrame(frame)
  })
}

const eyebrow = 'text-[9.5px] font-bold uppercase tracking-[0.12em] text-[#a8a29e] text-center'
const titleCls = 'font-display text-[20px] font-bold text-[#1c1917] text-center truncate mt-0.5'
const metaCls = 'text-[11.5px] font-medium text-[#a8a29e] text-center mt-0.5'

// ── 1. Front to back ────────────────────────────────────────────────────────
// A miniature of the rating screen's track phase, keystroke for keystroke: the
// score is typed a character at a time, the dot on the ramp follows it, Next
// track is pressed, and the next song slides in while the one after it stays
// locked.

const TRACKS = [
  { title: 'Morning Light', time: '3:12', score: '8.4' },
  { title: 'Sundays', time: '4:05', score: '9.1' },
  { title: 'Glass House', time: '2:48', score: '7.6' },
  { title: 'Closer', time: '5:21', score: '8.8' },
]
const LAST = TRACKS.length - 1

export function FrontToBackScene() {
  const [reduce] = useState(reducedMotion)
  const [idx, setIdx] = useState(0) // the track on screen
  const [rated, setRated] = useState(0) // how many are scored
  const [typed, setTyped] = useState('') // what's in the score field
  const [leaving, setLeaving] = useState(false)
  const [pressed, setPressed] = useState(false)
  const [cycle, setCycle] = useState(0) // remounts the slide so it re-enters

  useScript(async (sleep, alive) => {
    await sleep(400)
    while (alive()) {
      for (let s = 0; s <= LAST; s++) {
        if (!alive()) return
        setIdx(s)
        setTyped('')
        setLeaving(false)
        setCycle((c) => c + 1)
        await sleep(280 + 450)
        const score = TRACKS[s].score
        for (let k = 1; k <= score.length; k++) {
          if (!alive()) return
          setTyped(score.slice(0, k))
          await sleep(240)
        }
        await sleep(450)
        setPressed(true)
        await sleep(90)
        setPressed(false)
        await sleep(160)
        if (!alive()) return
        setRated(s + 1)
        if (s < LAST) {
          setLeaving(true)
          await sleep(220)
        }
      }
      // Hold on the finished record, then start it over.
      await sleep(1700)
      setLeaving(true)
      await sleep(220)
      if (!alive()) return
      setRated(0)
    }
  }, !reduce)

  // Reduced motion holds a representative moment: one song rated, the second typed.
  const at = reduce ? 1 : idx
  const done = reduce ? 1 : rated
  const field = reduce ? TRACKS[1].score : typed
  const value = field === '' ? null : parseFloat(field)
  const t = TRACKS[at]
  const scores = TRACKS.slice(0, done).map((x) => parseFloat(x.score))
  const avg = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null
  const upNext = at < LAST
    ? { num: String(at + 2), title: TRACKS[at + 1].title, note: 'locked' }
    : { num: '', title: 'The album', note: 'next' }

  return (
    <div className="w-full">
      <div className="flex items-center gap-2">
        <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: INSET }}>
          <div className="h-full rounded-full transition-[width] duration-300" style={{ width: `${(done / TRACKS.length) * 100}%`, background: GREEN }} />
        </div>
        <span className="text-[11px] font-medium text-[#a8a29e] tabular-nums">{done} / {TRACKS.length}</span>
      </div>

      <div
        key={cycle}
        className="tut-slide-in mt-3 transition-[opacity,transform] duration-200"
        style={leaving ? { opacity: 0, transform: 'translateX(-28px)' } : undefined}
      >
        <p className={eyebrow}>Track {at + 1}</p>
        <p className={titleCls}>{t.title}</p>
        <p className={metaCls}>{t.time}</p>
        <p
          className="m-0 mt-2 text-center font-bold text-[40px] leading-none tabular-nums"
          style={{ color: value != null ? songScoreColor(value) : '#c8c0b4', fontFamily: "'Playfair Display', serif" }}
        >
          {field || '—'}
        </p>
        <p className={`${eyebrow} mt-1`}>Your score</p>
      </div>

      <div className="relative flex h-2 rounded-full overflow-visible mt-3">
        {Array.from({ length: 10 }, (_, i) => (
          <div
            key={i}
            className={i === 0 ? 'rounded-l-full' : i === 9 ? 'rounded-r-full' : ''}
            style={{ flex: 1, background: songScoreColor(i + 0.5) }}
          />
        ))}
        <div
          className="absolute top-1/2 w-3.5 h-3.5 -ml-[7px] -mt-[7px] rounded-full bg-white border-2 border-[#1c1917] transition-[left,opacity] duration-300 ease-out"
          style={{ left: `${((value ?? 0) / 10) * 100}%`, opacity: value == null ? 0 : 1 }}
        />
      </div>

      <div
        className="mt-3 flex items-center justify-center gap-1.5 rounded-xl py-2 text-[13px] font-semibold text-white transition-opacity duration-100"
        style={{ background: GREEN, opacity: pressed ? 0.6 : 1 }}
      >
        {at < LAST ? 'Next track' : 'Rate the album'} <ArrowRight size={14} />
      </div>

      <div className="mt-3 rounded-xl border border-[#ece6dc] px-3 py-2.5">
        <div className="flex items-baseline justify-between">
          <span className="text-[9.5px] font-bold tracking-[0.1em] text-[#2d6a4f]">RUNNING AVG</span>
          <span className="text-[15px] font-bold text-[#1c1917] tabular-nums">{avg != null ? avg.toFixed(2) : '—'}</span>
        </div>
        <div className="flex gap-1.5 mt-2">
          {TRACKS.map((x, i) => (
            <div
              key={x.title}
              className="flex-1 h-2 rounded-full transition-colors duration-300"
              style={{
                background: i < done ? songScoreColor(parseFloat(x.score)) : INSET,
                boxShadow: i === at && i >= done ? `inset 0 0 0 1.5px ${GREEN}` : undefined,
              }}
            />
          ))}
        </div>
      </div>

      <div className="flex items-center gap-2 mt-2.5 px-1">
        <span className="w-3.5 text-[11px] text-[#c8c0b4]">{upNext.num}</span>
        <span className="flex-1 truncate text-[13px] font-medium text-[#a8a29e]">{upNext.title}</span>
        <span className="text-[11px] text-[#c8c0b4]">{upNext.note}</span>
      </div>
    </div>
  )
}

// ── 2. Then the record ──────────────────────────────────────────────────────
// A miniature of the rating screen's factors phase. The four factors are typed
// in turn, and once the last one lands the album score appears the way the
// album page shows it — a Playfair numeral, counting up from the song average
// it started at.

const FACTOR_DEMO = [
  { label: 'Theme / Cohesion', desc: 'Strength and cohesion of the central idea', value: '8.5' },
  { label: 'Replay Value', desc: 'How replayable the album is', value: '9.0' },
  { label: 'Production', desc: 'Sound quality, mixing, sonic palette', value: '7.5' },
  { label: 'Distinctness', desc: 'Originality and genre-bending', value: '8.0' },
]
const SONG_AVG = 8.48
const ALBUM_SCORE = 8.72

export function TheRecordScene() {
  const [reduce] = useState(reducedMotion)
  const [typed, setTyped] = useState<string[]>(() => FACTOR_DEMO.map(() => ''))
  const [typing, setTyping] = useState(-1) // the factor being typed into
  const [reveal, setReveal] = useState(false)
  const [score, setScore] = useState(SONG_AVG)

  useScript(async (sleep, alive) => {
    await sleep(400)
    while (alive()) {
      for (let f = 0; f < FACTOR_DEMO.length; f++) {
        if (!alive()) return
        setTyping(f)
        await sleep(300)
        const v = FACTOR_DEMO[f].value
        for (let k = 1; k <= v.length; k++) {
          if (!alive()) return
          setTyped((prev) => prev.map((x, i) => (i === f ? v.slice(0, k) : x)))
          await sleep(200)
        }
      }
      if (!alive()) return
      setTyping(-1)
      await sleep(250)
      setScore(SONG_AVG)
      setReveal(true)
      await tween(SONG_AVG, ALBUM_SCORE, 1100, setScore, alive)
      await sleep(2400)
      setReveal(false)
      await sleep(250)
      if (!alive()) return
      setTyped(FACTOR_DEMO.map(() => ''))
    }
  }, !reduce)

  const values = reduce ? FACTOR_DEMO.map((f) => f.value) : typed

  return (
    <div className="w-full">
      <p className={eyebrow}>The album</p>
      <p className={titleCls}>Late Summer</p>
      <p className={metaCls}>4 tracks scored · avg {SONG_AVG.toFixed(2)}</p>

      <div className="mt-3 rounded-xl border border-[#ece6dc] overflow-hidden">
        {FACTOR_DEMO.map((f, i) => (
          <div key={f.label} className={`flex items-center gap-3 px-3 py-2 ${i < FACTOR_DEMO.length - 1 ? 'border-b border-[#f1ece4]' : ''}`}>
            <div className="flex-1 min-w-0">
              <p className="m-0 text-[13px] font-semibold text-[#1c1917] truncate">{f.label}</p>
              <p className="m-0 text-[10.5px] text-[#a8a29e] truncate">{f.desc}</p>
            </div>
            <div
              className="w-12 h-8 rounded-lg flex items-center justify-center border transition-colors"
              style={{ borderColor: typing === i ? GREEN : '#e7e0d6', background: '#faf8f5' }}
            >
              <span className="text-[14px] font-bold tabular-nums" style={{ color: values[i] ? '#1c1917' : '#c8c0b4' }}>
                {values[i] || '—'}
              </span>
            </div>
          </div>
        ))}
      </div>

      <div
        className="mt-3 text-center transition-opacity duration-200"
        style={{ opacity: reduce || reveal ? 1 : 0 }}
      >
        <p className="m-0 leading-none tabular-nums" style={{ fontFamily: "'Playfair Display', serif", fontWeight: 800, fontSize: 44, color: GREEN }}>
          {(reduce ? ALBUM_SCORE : score).toFixed(2)}
        </p>
        <p className="m-0 mt-1 text-[9.5px] font-bold tracking-[0.14em] text-[#2d6a4f]">FINAL SCORE</p>
      </div>
    </div>
  )
}

// ── 3. Your catalog ─────────────────────────────────────────────────────────

const SHELVES = ['To Listen', 'Listening', 'Rated'] as const
const TILE = 54

/** A tile's left edge, centred in shelf `i`. */
function home(i: number): string {
  return `calc(${((i + 0.5) * 100) / SHELVES.length}% - ${TILE / 2}px)`
}

export function YourCatalogScene() {
  const [reduce] = useState(reducedMotion)
  const art = useArt()
  const [shelf, setShelf] = useState(reduce ? 2 : 0)
  const [chip, setChip] = useState(reduce)
  const [recIn, setRecIn] = useState(reduce)
  // Snapping back to the start of the loop mustn't be seen sliding backwards.
  const [instant, setInstant] = useState(true)

  useScript(async (sleep, alive) => {
    while (alive()) {
      setInstant(true)
      setShelf(0)
      setChip(false)
      setRecIn(false)
      await sleep(50)
      setInstant(false)
      await sleep(650)
      setShelf(1)
      await sleep(650 + 750)
      setShelf(2)
      await sleep(650)
      setChip(true)
      await sleep(250 + 450)
      setRecIn(true)
      await sleep(500 + 2200)
    }
  }, !reduce)

  const move = instant ? 'none' : 'left 650ms cubic-bezier(0.65,0,0.35,1), opacity 250ms, transform 500ms'

  return (
    <div className="w-full relative" style={{ height: TILE + 58 }}>
      <div className="flex gap-1.5 h-full">
        {SHELVES.map((s) => (
          <div key={s} className="flex-1 rounded-xl pt-2 text-center" style={{ background: '#f5f1ea' }}>
            <span className="text-[9.5px] font-bold tracking-[0.08em] text-[#a8a29e]">{s.toUpperCase()}</span>
          </div>
        ))}
      </div>

      <div className="absolute" style={{ top: 30, left: home(shelf), transition: move }}>
        <Cover url={art[0]} size={TILE} seed="a" />
        <div
          className="absolute -right-2 -top-2 rounded-full px-1.5 py-0.5 text-[11px] font-bold text-white"
          style={{ background: songScoreColor(ALBUM_SCORE), opacity: chip ? 1 : 0, transition: instant ? 'none' : 'opacity 250ms' }}
        >
          {ALBUM_SCORE.toFixed(2)}
        </div>
      </div>

      {/* The recommendation takes the slot the first record left. */}
      <div
        className="absolute"
        style={{
          top: 30,
          left: home(0),
          opacity: recIn ? 1 : 0,
          transform: recIn ? 'translateY(0)' : 'translateY(-14px)',
          transition: instant ? 'none' : 'opacity 500ms, transform 500ms',
        }}
      >
        <Cover url={art[1]} size={TILE} seed="b" />
      </div>
      <div
        className="absolute rounded-full text-center text-[10.5px] font-semibold text-[#c2410c] truncate"
        style={{
          bottom: 4,
          left: 4,
          width: `calc(${100 / SHELVES.length}% - 12px)`,
          background: 'rgba(249,115,22,0.12)',
          padding: '2px 4px',
          opacity: recIn ? 1 : 0,
          transition: instant ? 'none' : 'opacity 500ms',
        }}
      >
        from Sam
      </div>
    </div>
  )
}

// ── 4. Better with friends ──────────────────────────────────────────────────

function Initial({ name }: { name: string }) {
  return (
    <div
      className="w-8 h-8 rounded-full flex items-center justify-center text-white text-[13px] font-bold shrink-0"
      style={{ background: avatarColor(name) }}
    >
      {name[0]}
    </div>
  )
}

export function FriendsScene() {
  const art = useArt()
  // Staggered with CSS, so reduced motion is the stylesheet's to switch off.
  const rise = (i: number): CSSProperties => ({ animationDelay: `${i * 420}ms` })
  const row = 'tut-rise flex items-center gap-2.5 rounded-xl bg-white border border-[#ece6dc] px-3 py-2'

  return (
    <div className="w-full flex flex-col gap-2">
      <div className={row} style={rise(0)}>
        <Initial name="Maya" />
        <span className="flex-1 min-w-0 truncate text-[13.5px] text-[#57534e]">
          <span className="font-semibold text-[#1c1917]">Maya</span> rated an album
        </span>
        <Cover url={art[2]} size={34} seed="c" />
        <span className="rounded-md px-1.5 py-0.5 text-[12px] font-bold text-white" style={{ background: songScoreColor(9.12) }}>9.12</span>
      </div>

      <div className={row} style={rise(1)}>
        <Initial name="Sam" />
        <span className="flex-1 min-w-0 rounded-xl bg-[#f5f1ea] px-2.5 py-1.5 text-[13px] text-[#1c1917] line-clamp-2">
          The closer makes the whole record.
        </span>
        <span className="flex items-center gap-1 text-[12px] font-semibold text-[#a8a29e]">
          <MessageCircle size={13} /> 12
        </span>
      </div>

      <div className={row} style={rise(2)}>
        <span className="w-7 text-center text-[15px] font-bold text-[#1c1917]">#3</span>
        <span className="flex items-center text-[12px] font-bold text-[#2d6a4f]">
          <ArrowUp size={12} strokeWidth={2.6} />2
        </span>
        <Cover url={art[3]} size={34} seed="d" />
        <span className="flex-1 min-w-0 truncate text-[13.5px] text-[#57534e]">Charts this week</span>
      </div>
    </div>
  )
}

// ── 5. It learns you ────────────────────────────────────────────────────────

const RING = 92
const RING_STROKE = 9
// Album scores, so two decimals like every final album score in the app.
const PREDICTED = [8.94, 8.13, 9.31]

export function LearnsYouScene() {
  const [reduce] = useState(reducedMotion)
  const art = useArt()
  const [progress, setProgress] = useState(reduce ? 10 : 0) // albums rated, 0–10

  useScript(async (sleep, alive) => {
    await sleep(250)
    await tween(0, 10, 1600, setProgress, alive)
  }, !reduce)

  const r = (RING - RING_STROKE) / 2
  const circumference = 2 * Math.PI * r

  return (
    <div className="w-full flex flex-col items-center">
      <div className="flex items-center gap-4">
        <div className="relative" style={{ width: RING, height: RING }}>
          <svg width={RING} height={RING} style={{ transform: 'rotate(-90deg)' }}>
            <circle cx={RING / 2} cy={RING / 2} r={r} stroke={INSET} strokeWidth={RING_STROKE} fill="none" />
            <circle
              cx={RING / 2}
              cy={RING / 2}
              r={r}
              stroke={GREEN}
              strokeWidth={RING_STROKE}
              fill="none"
              strokeDasharray={`${circumference} ${circumference}`}
              strokeDashoffset={circumference * (1 - progress / 10)}
              strokeLinecap="round"
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-[24px] leading-7 font-bold text-[#1c1917] tabular-nums">{Math.floor(progress)}</span>
            <span className="text-[11px] text-[#a8a29e]">of 10</span>
          </div>
        </div>
        <span className="text-[12.5px] font-medium text-[#a8a29e]">albums rated</span>
      </div>

      <div className="flex gap-3 mt-4">
        {PREDICTED.map((p, i) => (
          <div key={i} className="relative">
            <Cover url={art[4 + i]} size={64} seed={`p${i}`} />
            {/* Pops in once the ring has filled: 250 + 1600ms, then staggered. */}
            <span
              className="tut-pop absolute -right-2 -bottom-2 rounded-md px-1.5 py-0.5 text-[12px] font-bold text-white"
              style={{ background: songScoreColor(p), animationDelay: `${1850 + i * 140}ms` }}
            >
              {p.toFixed(2)}
            </span>
          </div>
        ))}
      </div>
      <p className="m-0 mt-3.5 text-[9.5px] font-bold tracking-[0.14em] text-[#2d6a4f]">PREDICTED FOR YOU</p>
    </div>
  )
}
