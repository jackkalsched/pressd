// Pressd design tokens — mirrors the website's palette (frontend/src/index.css
// + Tailwind classes) so the two surfaces read as one brand.

import { DynamicColorIOS, Dimensions, useColorScheme, type ColorValue } from 'react-native'
import { songScoreColor } from '@pressd/shared/types'

// ── Colour ──────────────────────────────────────────────────────────────────
// Two palettes: the cream page, and a very dark warm gray that keeps the cream
// as its ink, so dark mode still reads as Pressd rather than as a generic black.
// Which one shows follows the phone's setting, or the override in Settings →
// Preferences (lib/prefs.ts sets it with Appearance.setColorScheme).

const light = {
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

  // Brand fill that carries white text (buttons, the active pill): the same
  // green on both pages, a touch lifted on the dark one.
  greenFill: '#2d6a4f',
  onGreen: '#ffffff',

  // A dim layer over the page behind a sheet or dialog.
  scrim: 'rgba(28, 25, 23, 0.35)',
  // A hairline rule between rows.
  hairline: 'rgba(28, 25, 23, 0.12)',

  // Errors and destructive actions (Delete, Remove).
  danger: '#b91c1c',
  // A warm tint behind a warning.
  warnSoft: '#fff7ed',
  // Frosted white on the page: a quiet chip.
  frost: 'rgba(255, 255, 255, 0.7)',
  // An opaque pale green: the taste-overlap pill, and a green-edged card.
  greenTint: '#dfe9e2',
  // The danger zone's card.
  dangerSoft: '#fdf5f5',
  dangerBorder: '#f0d5d5',

  // Score chip on dark art
  scoreChipBg: 'rgba(28, 25, 23, 0.82)',
  scoreChipText: '#ffffff',
}

const dark: typeof light = {
  bg: '#171615',
  raised: '#211f1d',
  inset: '#2a2826',
  border: '#34312e',

  ink: '#f4efe7',
  inkSecondary: '#d2cabe',
  inkTertiary: '#a69e92',
  inkMuted: '#857c72',

  // Lifted to read as text on the dark page, and kept deep enough to carry
  // white text where it's a fill: the one green does both jobs, as in light.
  green: '#4f9a77',
  greenPressed: '#438a69',
  greenSoft: 'rgba(79, 154, 119, 0.18)',

  greenFill: '#4f9a77',
  onGreen: '#ffffff',

  scrim: 'rgba(0, 0, 0, 0.55)',
  hairline: 'rgba(244, 239, 231, 0.12)',

  danger: '#f2867a',
  warnSoft: 'rgba(234, 108, 10, 0.14)',
  frost: 'rgba(255, 255, 255, 0.07)',
  greenTint: '#1f2c26',
  dangerSoft: 'rgba(242, 134, 122, 0.10)',
  dangerBorder: 'rgba(242, 134, 122, 0.30)',

  scoreChipBg: 'rgba(12, 11, 10, 0.82)',
  scoreChipText: '#ffffff',
}

export type ColorName = keyof typeof light
export type Palette = Record<ColorName, string>

/** Both palettes as plain strings, for code that needs one directly. */
export const palettes: { light: Palette; dark: Palette } = { light, dark }

/**
 * The palette as colours iOS resolves itself, for stylesheets. A view styled
 * with these changes the moment the appearance does, with no re-render.
 *
 * Not for SVG (icons included) or gradients: those draw once and keep what they
 * were given, so they take `useColors()`, which re-renders on the change.
 */
export const colors = Object.fromEntries(
  (Object.keys(light) as ColorName[]).map((k) => [k, DynamicColorIOS({ light: light[k], dark: dark[k] })]),
) as Record<ColorName, ColorValue>

/** True while the dark palette is showing. */
export function useIsDark(): boolean {
  return useColorScheme() === 'dark'
}

/** The current palette as plain strings, re-rendering when it changes — for
 *  icons, SVG, gradients and anything else that draws once. */
export function useColors(): Palette {
  return useIsDark() ? dark : light
}

// The page colour as an RGB triple, for veils and fades that need it at some
// opacity: bg in each palette.
const PAGE_RGB = { light: '249,248,246', dark: '23,22,21' }

/** The page colour at `alpha`, for a stylesheet: a veil over content. */
export function pageAlpha(alpha: number): ColorValue {
  return DynamicColorIOS({ light: `rgba(${PAGE_RGB.light},${alpha})`, dark: `rgba(${PAGE_RGB.dark},${alpha})` })
}

/** The page colour's RGB triple ("249,248,246"), for gradients that fade into it. */
export function usePageRgb(): string {
  return PAGE_RGB[useIsDark() ? 'dark' : 'light']
}

/** A 1–10 score's colour for a stylesheet or text, resolving per appearance. */
export function scoreColor(score: number): ColorValue {
  return DynamicColorIOS({ light: songScoreColor(score), dark: songScoreColor(score, true) })
}

/** A score's colour as a plain string, for SVG and gradients. */
export function useScoreColor(): (score: number) => string {
  const isDark = useIsDark()
  return (score: number) => songScoreColor(score, isDark)
}

export const fonts = {
  display: 'PlayfairDisplay_700Bold',
  displayRegular: 'PlayfairDisplay_400Regular',
  // A real italic face: iOS can't slant a custom font, so fontStyle: 'italic'
  // on `display` draws it upright.
  displayItalic: 'PlayfairDisplay_700Bold_Italic',
  // Wide and heavy, for the shelf's name alone.
  wide: 'Unbounded_700Bold',
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
