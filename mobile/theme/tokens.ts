// Press'd design tokens — mirrors the website's palette (frontend/src/index.css
// + Tailwind classes) so the two surfaces read as one brand.

export const colors = {
  // Surfaces
  bg: '#f9f8f6',
  raised: '#ffffff',
  inset: '#efe9e0',
  border: '#e8e2d9',

  // Ink
  ink: '#1c1917',
  inkSecondary: '#57534e',
  inkTertiary: '#78716c',
  inkMuted: '#a8998a',

  // Brand
  green: '#2d6a4f',
  greenPressed: '#245c43',
  greenSoft: 'rgba(45, 106, 79, 0.10)',

  // Score chip on dark art
  scoreChipBg: 'rgba(28, 25, 23, 0.82)',
  scoreChipText: '#ffffff',
} as const

export const fonts = {
  display: 'PlayfairDisplay_700Bold',
  displayRegular: 'PlayfairDisplay_400Regular',
  displayBlack: 'PlayfairDisplay_900Black',
  body: 'PlusJakartaSans_400Regular',
  bodyMedium: 'PlusJakartaSans_500Medium',
  bodySemiBold: 'PlusJakartaSans_600SemiBold',
  bodyBold: 'PlusJakartaSans_700Bold',
} as const

export const radii = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  pill: 999,
} as const

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const

/** Maps a 1–10 song score to the same gradient hue the website uses. */
export { songScoreColor } from '@pressd/shared/types'
