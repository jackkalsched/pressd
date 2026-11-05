// The app's loading indicator: the record from the Pressd mark (PressdMark),
// spinning. Every wait shows it, from a button's 14px to the overlay while a
// rating settles.
//
// A flat disc turning on its own looks still, so it's the light that moves: the
// record holds still and its reflections sweep round it, as PressdMark's glint
// does on the landing page. The record is black in both themes, as a record is;
// under prefers-reduced-motion the light holds still.
//
// mobile/components/VinylSpinner.tsx is the same drawing; change both.

const C = 50 // the disc's centre in a 100-unit box

export default function VinylSpinner({
  size = 18,
  className,
  label = 'Loading',
}: {
  size?: number
  className?: string
  /** Read out by screen readers. */
  label?: string
}) {
  return (
    <svg
      viewBox="0 0 100 100"
      width={size}
      height={size}
      className={`vinyl-spinner inline-block shrink-0 ${className ?? ''}`}
      role="status"
      aria-label={label}
    >
      <circle cx={C} cy={C} r="49" fill="#212220" />
        {/* Grooves: barely there, so the disc reads as vinyl, not a dot. */}
        {[42, 35, 28].map((r) => (
          <circle key={r} cx={C} cy={C} r={r} fill="none" stroke="#f4f2ec" strokeOpacity="0.09" strokeWidth="1.2" />
        ))}
      {/* The reflections: what moves. */}
      <g className="vinyl-spinner-light">
        <path d="M 18 30 A 38 38 0 0 1 36 15" fill="none" stroke="#f4f2ec" strokeOpacity="0.38" strokeWidth="5" strokeLinecap="round" />
        <path d="M 82 70 A 38 38 0 0 1 64 85" fill="none" stroke="#f4f2ec" strokeOpacity="0.18" strokeWidth="5" strokeLinecap="round" />
      </g>
      {/* Label and spindle above the light, so it passes behind them. */}
      <circle cx={C} cy={C} r="17" fill="#f4f2ec" />
      <circle cx={C} cy={C} r="3.4" fill="#212220" />
    </svg>
  )
}
