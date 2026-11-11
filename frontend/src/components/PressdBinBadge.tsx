// The Pressd-verified badge for a bin Pressd made: the Pressd mark traced as an
// outline — its two legs (open toward the record), the record and the label as
// lines, nothing filled — left-aligned above the bin's title: white on the bin
// page's dark banner, the ink colour (`color`) on a bin's card. The geometry is
// PressdMark's own (lib/pressdMark.ts); mobile's components/PressdBinBadge.tsx
// copies it, so change both.
import { DISC_CX, DISC_CY, LEG_OUTLINES } from '../lib/pressdMark'

// The mark's extent once rotated, so the outline fills its box.
const VIEW = { x: -25, y: 43, w: 220, h: 120 }

export default function PressdBinBadge({ width = 72, stroke = 1.6, color = '#fff' }: { width?: number; stroke?: number; color?: string }) {
  const sw = (stroke * VIEW.w) / width // the line's thickness in the mark's own units
  return (
    <svg
      viewBox={`${VIEW.x} ${VIEW.y} ${VIEW.w} ${VIEW.h}`}
      width={width}
      height={(width * VIEW.h) / VIEW.w}
      role="img"
      aria-label="A Pressd bin"
      className="block overflow-visible"
    >
      <title>A Pressd bin</title>
      <g transform={`rotate(45 ${DISC_CX} ${DISC_CY})`} fill="none" stroke={color} strokeWidth={sw} strokeLinejoin="round" strokeLinecap="round">
        <path d={LEG_OUTLINES[0]} />
        <path d={LEG_OUTLINES[1]} />
        <circle cx={DISC_CX} cy={DISC_CY} r="50" />
        <circle cx={DISC_CX} cy={DISC_CY} r="13.5" />
        <circle cx={DISC_CX} cy={DISC_CY} r="3.3" />
      </g>
    </svg>
  )
}
