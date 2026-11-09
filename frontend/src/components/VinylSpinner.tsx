// The app's loading indicator: a record, from the vinyl-loader design handoff
// (November 2026), whose geometry, colours and timings are kept here. Every
// wait shows it, from a button's 14px to the overlay while a rating settles.
//
// Five ways of playing it (the handoff's 1b–1f), one picked at random each
// time a spinner appears, so a wait isn't the same picture every time:
//   1b  the record turns under a light that stays put, as on a real deck
//   1c  a tonearm swings on, tracks inward and lifts off
//   1d  a plate presses the disc, which squashes and sends out a ring
//   1e  green grooves fill from the label outward
//   1f  the record slides out of a Pressd sleeve, spinning, and tucks back in
// Below SMALL_MAX (a button's or a row's spinner) it is always 1b: a tonearm or
// a sleeve at 15px is a smudge. Under prefers-reduced-motion it is 1b, still.
//
// Each variant is drawn at the handoff's reference disc (S = 120) and scaled
// into a `size` square, so a spinner keeps the footprint it always had and the
// keyframes (index.css, "VinylSpinner") keep the handoff's own numbers. 1c, 1d
// and 1f are wider or taller than the disc, so their disc is smaller in the box.
//
// mobile/components/VinylSpinner.tsx is the same drawing; change both.
import { useState, type CSSProperties, type ReactNode } from 'react'

export type VinylVariant = '1b' | '1c' | '1d' | '1e' | '1f'
const VARIANTS: VinylVariant[] = ['1b', '1c', '1d', '1e', '1f']
/** At or below this, always 1b. */
export const SMALL_MAX = 28

const S = 120 // the handoff's reference disc
// Each variant's whole picture, in reference units.
const BOX: Record<VinylVariant, [number, number]> = {
  '1b': [S, S],
  '1c': [S + 40, S + 4], // the tonearm's pivot sits 4 above the disc
  '1d': [S + 20, S + 30], // the plate overhangs 10 each side and drops from above
  '1e': [S, S],
  '1f': [S * 1.5, S + 10], // the sleeve, and room for the record to slide out
}

function reducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches
  } catch {
    return false
  }
}

function pick(size: number): VinylVariant {
  if (size <= SMALL_MAX || reducedMotion()) return '1b'
  return VARIANTS[Math.floor(Math.random() * VARIANTS.length)]
}

const ABS: CSSProperties = { position: 'absolute', inset: 0, borderRadius: '50%' }

/** The two wedges of light on the groove ring. Never turns: the record does. */
function Sheen() {
  return <div className="vl-sheen" style={ABS} />
}

function Label() {
  return (
    <div className="vl-label">
      <div className="vl-label-band" />
      <div className="vl-spindle" />
    </div>
  )
}

function Disc({ children }: { children?: ReactNode }) {
  return <div className="vl-disc">{children}</div>
}

function Stage({ variant }: { variant: VinylVariant }) {
  switch (variant) {
    case '1b':
      return (
        <>
          <div className="vl-spin" style={{ ...ABS, animationDuration: '1.8s' }}>
            <Disc><Label /></Disc>
          </div>
          <div style={{ ...ABS, transform: 'rotate(-20deg)' }}><Sheen /></div>
        </>
      )
    case '1c':
      return (
        <>
          <div className="vl-spin" style={{ ...ABS, top: 4, width: S, height: S, animationDuration: '1.8s' }}>
            <Disc><Label /></Disc>
          </div>
          <div style={{ ...ABS, top: 4, width: S, height: S, transform: 'rotate(-20deg)' }}><Sheen /></div>
          <div className="vl-arm vl-pivot">
            <div className="vl-arm-rod">
              <div className="vl-arm-head" />
            </div>
          </div>
        </>
      )
    case '1d':
      return (
        <>
          <div className="vl-ripple" />
          <div className="vl-squash" style={{ position: 'absolute', left: 10, top: 30, width: S, height: S }}>
            <Disc><Sheen /><Label /></Disc>
          </div>
          <div className="vl-plate" />
        </>
      )
    case '1e':
      return (
        <div className="vl-spin" style={{ ...ABS, animationDuration: '3s' }}>
          <Disc>
            <div className="vl-grooves" style={ABS} />
            <Label />
          </Disc>
        </div>
      )
    case '1f':
      return (
        <>
          <div className="vl-slide" style={{ position: 'absolute', left: 5, top: 5, width: S, height: S }}>
            <div className="vl-spin" style={{ ...ABS, animationDuration: '1.6s' }}>
              <Disc><Sheen /><Label /></Disc>
            </div>
          </div>
          <div className="vl-sleeve">
            <span className="font-wordmark" style={{ fontSize: S * 0.17, lineHeight: 1.1, color: '#F4F2EC' }}>Pressd</span>
          </div>
        </>
      )
  }
}

export default function VinylSpinner({
  size = 18,
  className,
  label = 'Loading',
  variant,
}: {
  size?: number
  className?: string
  /** Read out by screen readers. */
  label?: string
  /** A fixed variant; otherwise one is picked at random when it appears. */
  variant?: VinylVariant
}) {
  const [picked] = useState(() => variant ?? pick(size))
  const [w, h] = BOX[picked]
  const k = size / Math.max(w, h)
  return (
    <span
      className={`vinyl-spinner relative inline-block shrink-0 align-middle ${className ?? ''}`}
      style={{ width: size, height: size }}
      role="status"
      aria-label={label}
    >
      <span
        className="absolute block"
        style={{
          left: (size - w * k) / 2,
          top: (size - h * k) / 2,
          width: w,
          height: h,
          transform: `scale(${k})`,
          transformOrigin: '0 0',
          // 1e's green grooves: the handoff's 1px every 4px, spread out as the
          // spinner shrinks so they stay 3px apart on screen — closer, they
          // break into a moiré.
          ['--vl-g' as string]: `${Math.max(4, 3 / k)}px`,
          ['--vl-gw' as string]: `${Math.max(1, 0.75 / k)}px`,
        }}
      >
        <Stage variant={picked} />
      </span>
    </span>
  )
}
