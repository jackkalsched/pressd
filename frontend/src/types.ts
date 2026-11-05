// Domain types + score helpers now live in @pressd/shared so the web and
// mobile apps can never drift on scoring math. This re-export keeps existing
// '../types' imports working.
export * from '@pressd/shared/types'

/** A 1–10 score's colour, following the theme: the hue is the score's, the
 *  saturation and lightness come from index.css (--score-s, --score-l), so a
 *  page already drawn changes with it. Shadows the shared helper for every
 *  '../types' import; the share card imports the shared one, which stays on the
 *  light scale because the card is a picture. */
export function songScoreColor(score: number): string {
  const hue = Math.round(((score - 1) / 9) * 130)
  return `hsl(${hue}, var(--score-s), var(--score-l))`
}
