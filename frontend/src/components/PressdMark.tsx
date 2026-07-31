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

const DISC_CX = 85
const DISC_CY = 103

// `onGreen` is not the package's reversed mark. That one uses #527A63 legs on a
// light disc, which sits too close to the site's own green to read — the legs
// vanish. Cream legs against the dark disc hold contrast on the green field and
// keep the highlight sweep visible, which the light-on-light reversal loses.
const TONES = {
  primary: { leg: '#3E6B54', disc: '#212220', label: '#F4F2EC', spindle: '#212220', sweep: '#F4F2EC' },
  onGreen: { leg: '#F4F2EC', disc: '#212220', label: '#F4F2EC', spindle: '#212220', sweep: '#F4F2EC' },
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
        .pressd-sweep-inner {
          transform-origin: ${DISC_CX}px ${DISC_CY}px;
          animation: pressd-spin 5.6s linear infinite reverse;
        }
        @media (prefers-reduced-motion: reduce) {
          .pressd-sweep, .pressd-sweep-inner { animation: none; }
        }
      `}</style>

      <g transform={`rotate(45 ${DISC_CX} ${DISC_CY})`}>
        {/* Green P/d frame — verbatim from the source SVG */}
        <path
          d="M127 14 L141 14 Q146 14 146 19 L146.00 80.56 L146.65 84.06 L147.10 87.57 L147.36 91.07 L147.42 94.55 L147.30 98.00 L147.00 101.41 L146.52 104.78 L145.86 108.09 L145.03 111.33 L144.04 114.50 L142.89 117.59 L141.59 120.59 L140.15 123.50 L138.57 126.30 L136.86 129.01 L135.04 131.61 L133.11 134.10 L131.11 136.50 L131.11 136.50 A57.0 57.0 0 0 0 122.00 59.64 L122 19 Q122 14 127 14 Z"
          fill={c.leg}
        />
        <path
          d="M43 192 L29 192 Q24 192 24 187 L24.00 125.44 L23.35 121.94 L22.90 118.43 L22.64 114.93 L22.58 111.45 L22.70 108.00 L23.00 104.59 L23.48 101.22 L24.14 97.91 L24.97 94.67 L25.96 91.50 L27.11 88.41 L28.41 85.41 L29.85 82.50 L31.43 79.70 L33.14 76.99 L34.96 74.39 L36.89 71.90 L38.89 69.50 L38.89 69.50 A57.0 57.0 0 0 0 48.00 146.36 L48 187 Q48 192 43 192 Z"
          fill={c.leg}
        />

        {/* The record */}
        <circle cx={DISC_CX} cy={DISC_CY} r="50" fill={c.disc} />

        {spinning && (
          <>
            {/* Highlight arcs. strokeDasharray leaves most of the ring empty so
                only a short glint travels around, which is what sells the spin. */}
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
            <circle
              className="pressd-sweep-inner"
              cx={DISC_CX}
              cy={DISC_CY}
              r="27"
              fill="none"
              stroke={c.sweep}
              strokeOpacity="0.26"
              strokeWidth="3"
              strokeLinecap="round"
              strokeDasharray="16 154"
            />
          </>
        )}

        {/* Label and spindle sit above the arcs so the glint passes behind them */}
        <circle cx={DISC_CX} cy={DISC_CY} r="13.5" fill={c.label} />
        <circle cx={DISC_CX} cy={DISC_CY} r="3.3" fill={c.spindle} />
      </g>
    </svg>
  )
}
