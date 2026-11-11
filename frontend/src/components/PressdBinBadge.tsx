// The Pressd-verified badge for a bin Pressd made: the full-colour Pressd mark
// on a cream chip. Above the title on the bin page's banner, and in the lower
// right of the collage on a bin's card. Cream whatever the appearance: it sits
// on album art or the dark banner, never on the page. Mobile's
// components/PressdBinBadge.tsx draws the same chip.
import PressdMark from './PressdMark'

export default function PressdBinBadge({ width = 72, className = '' }: { width?: number; className?: string }) {
  return (
    <span
      className={`flex items-center justify-center overflow-hidden bg-[#f9f8f6] shadow-[0_1px_5px_rgba(0,0,0,0.3)] ${className}`}
      style={{ width, height: width * 0.6, borderRadius: width * 0.18 }}
      title="A Pressd bin"
      role="img"
      aria-label="A Pressd bin"
    >
      <PressdMark size={width * 0.95} />
    </span>
  )
}
