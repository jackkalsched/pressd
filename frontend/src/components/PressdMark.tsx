// The Pressd mark, rebuilt from Pressd-Logo-Package/source-svg/pressd-mark-primary.svg
// so it can animate. Geometry is copied verbatim from that file — if the brand
// mark changes, re-copy the paths rather than nudging numbers here.
//
// The record is a flat disc, so rotating it would look completely static. The
// spin reads instead from a pale highlight arc that sweeps around the disc,
// plus a fainter inner arc turning at a different rate for depth. The green
// P/d frame and the centre label stay put — only the light moves.
//
// `spinning` is opt-in: the small nav/footer marks are static, and everything
// stops under prefers-reduced-motion.

import { DISC_CX, DISC_CY, LEG_PATHS } from '../lib/pressdMark'

// `onGreen` is not the package's reversed mark. That one uses #527A63 legs on a
// light disc, which sits too close to the site's own green to read — the legs
// vanish. Cream legs against the dark disc hold contrast on the green field and
// keep the highlight sweep visible, which the light-on-light reversal loses.
const TONES = {
  primary: { leg: 'var(--c-3e6b54)', disc: 'var(--c-212220)', label: 'var(--c-f4f2ec)', spindle: 'var(--c-212220)', sweep: 'var(--c-f4f2ec)' },
  onGreen: { leg: 'var(--c-f4f2ec)', disc: 'var(--c-212220)', label: 'var(--c-f4f2ec)', spindle: 'var(--c-212220)', sweep: 'var(--c-f4f2ec)' },
} as const

export default function PressdMark({
  size = 512,
  spinning = false,
  tone = 'primary',
  className,
}: {
  size?: number
  spinning?: boolean
  tone?: keyof typeof TONES
  className?: string
}) {
  const c = TONES[tone]
  return (
    <svg
      viewBox="-30 -12 230 230"
      width={size}
      height={size}
      className={className}
      role="img"
      aria-label={spinning ? 'Pressd logo, record spinning' : 'Pressd logo'}
    >
      <style>{`
        @keyframes pressd-spin { to { transform: rotate(360deg); } }
        .pressd-sweep {
          transform-origin: ${DISC_CX}px ${DISC_CY}px;
          animation: pressd-spin 3.4s linear infinite;
        }
        @media (prefers-reduced-motion: reduce) {
          .pressd-sweep { animation: none; }
        }
      `}</style>

      <g transform={`rotate(45 ${DISC_CX} ${DISC_CY})`}>
        {/* Green P/d frame — verbatim from the source SVG */}
        <path
          d={LEG_PATHS[0]}
          fill={c.leg}
        />
        <path
          d={LEG_PATHS[1]}
          fill={c.leg}
        />

        {/* The record */}
        <circle cx={DISC_CX} cy={DISC_CY} r="50" fill={c.disc} />

        {spinning && (
          /* One highlight only. strokeDasharray leaves most of the ring empty so
             a short glint travels around, which is what sells the spin. A second
             arc turning the other way read as two separate objects, not one
             record — a disc's highlights all move together. */
          <circle
            className="pressd-sweep"
            cx={DISC_CX}
            cy={DISC_CY}
            r="40"
            fill="none"
            stroke={c.sweep}
            strokeOpacity="0.5"
            strokeWidth="5"
            strokeLinecap="round"
            strokeDasharray="30 221"
          />
        )}

        {/* Label and spindle sit above the arcs so the glint passes behind them */}
        <circle cx={DISC_CX} cy={DISC_CY} r="13.5" fill={c.label} />
        <circle cx={DISC_CX} cy={DISC_CY} r="3.3" fill={c.spindle} />
      </g>
    </svg>
  )
}
