// Pressd design tokens — mirrors the website's palette (frontend/src/index.css
// + Tailwind classes) so the two surfaces read as one brand.

import { Dimensions } from 'react-native'

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
  // The Pressd wordmark itself — Clash Display, per the brand mark. Not a
  // general-purpose face: use display/body for everything else.
  wordmark: 'ClashDisplay_700Bold',
  wordmarkSemiBold: 'ClashDisplay_600SemiBold',

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

// ── Fitting large type to the screen ────────────────────────────────────────
// Display-face numerals are set big enough that a narrow screen runs out of
// room, and a headline numeral that wraps ("10.0" over "0") reads as broken
// rather than tight. Sizes below are derived from the width that's actually
// available instead of being tuned to one device, because the trigger is as
// likely to be Display Zoom or a large text setting as a smaller phone.

export const screenWidth = Dimensions.get('window').width
export const screenHeight = Dimensions.get('window').height

/** Width of a string as a multiple of its own font size, for the display face.
 *  Playfair sets digits at ~0.55em and a period at ~0.27em, so the widest score
 *  a column has to hold — "10.00" — needs about 2.5em. */
export const SCORE_EM_WIDTH = 2.6

/**
 * The largest type that still fits `available` points across, for a string
 * occupying `em` times its font size. Caps at `max`, so a roomy screen keeps
 * the size the design asked for and only a cramped one steps down.
 */
export function fitType(max: number, available: number, em: number = SCORE_EM_WIDTH): number {
  if (!(available > 0)) return max
  return Math.max(1, Math.min(max, Math.floor(available / em)))
}

/** Content width inside a screen padded by `pad` on each side. */
export function contentWidth(pad: number = spacing.lg): number {
  return screenWidth - pad * 2
}

/**
 * How far type is allowed to grow past the reader's own setting before it is
 * held and shrunk to fit instead.
 *
 * Most of this app's numbers live somewhere they cannot grow — a score pinned
 * to the corner of a cover, a numeral in one of four columns splitting a row, a
 * value centred in a ring. Those places honour the setting up to here and then
 * stop, because past it the composition stops being able to give way and the
 * text clips rather than reflows.
 *
 * Prose is different and should generally be left uncapped: a paragraph can
 * take another line, so a reader who asked for larger text should get it.
 */
export const NUM_SCALE_CAP = 1.3
