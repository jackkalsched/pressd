// Shared album-cover and score presentation.
//
// The For You feed and the Charts board show the same two things — a cover that
// reacts to the pointer, and a score tinted along the app's red→green gradient.
// They lived in ForYou first; they're here so both surfaces stay one system
// rather than drifting into two near-identical looks.
import { songScoreColor } from '../types'
import CoverImg from './CoverImg'

/** Stable hue per string, so an artist without cover art always gets the same
 *  placeholder colour. */
export function hueFromString(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360
  return h
}

export function coverGradient(hue: number): string {
  return `linear-gradient(140deg, hsl(${hue} 42% 38%), hsl(${(hue + 26) % 360} 48% 56%))`
}

/** Same 0–130 hue ramp as songScoreColor, but pale — the pill's fill sits
 *  behind that colour as text, so it has to stay far lighter than it. */
export function scoreHue(s: number): number {
  return Math.round(((s - 1) / 9) * 130)
}

export function scoreTint(s: number): string {
  return `hsl(${scoreHue(s)}, 46%, 94%)`
}

/** Cover feedback: a slight lift and lean on hover, settling on press.
 *  Put this on a wrapper around <Cover> and `group` on the row that owns it.
 *
 *  Deliberately small. It was a 13% zoom with a 3° tilt on a springy curve,
 *  which made a row of covers jump around under the pointer; this is enough to
 *  say "this is clickable" without pulling the eye off everything else. */
export const COVER_LIFT =
  'transition-transform duration-[250ms] ease-out ' +
  'group-hover:scale-[1.04] group-hover:-rotate-1 group-active:scale-[1.02]'

export function Cover({
  artUrl, seed, size, radius = 12, fontSize,
}: {
  artUrl?: string | null
  seed: string
  size: number
  radius?: number
  fontSize?: number
}) {
  const hue = hueFromString(seed || '?')
  if (artUrl) {
    // The placeholder colour sits behind the image, so a cover still loading —
    // or one whose every address failed (CoverImg hides it) — reads as a tile.
    return (
      <div style={{ width: size, height: size, borderRadius: radius, flexShrink: 0, overflow: 'hidden', background: coverGradient(hue) }}>
        <CoverImg
          url={artUrl}
          displayPx={size}
          alt=""
          style={{ width: size, height: size, objectFit: 'cover', display: 'block' }}
        />
      </div>
    )
  }
  return (
    <div
      style={{
        width: size, height: size, borderRadius: radius, flexShrink: 0, background: coverGradient(hue),
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: 'rgba(255,255,255,.92)', fontFamily: "'Playfair Display', serif", fontWeight: 700,
        fontSize: fontSize ?? Math.round(size * 0.34),
      }}
    >
      {(seed || '?')[0].toUpperCase()}
    </div>
  )
}

export function ScorePill({ score, big }: { score: number; big?: boolean }) {
  return (
    <span
      className="tabular-nums"
      style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        minWidth: big ? 46 : 38, padding: big ? '6px 10px' : '3px 8px', borderRadius: 9,
        background: scoreTint(score), color: songScoreColor(score),
        fontFamily: "'Plus Jakarta Sans', sans-serif", fontWeight: 700, fontSize: big ? 16 : 13, flexShrink: 0,
      }}
    >
      {score.toFixed(2)}
    </span>
  )
}
