// The reveal a list row performs as it scrolls into view: it rises, overshoots
// its resting place, and settles.
//
// Shared so For You's trending block and the Charts board animate identically —
// they're the same gesture on two screens, and a curve copied into both would
// drift the moment one was tuned.
//
// Driven off scroll position rather than a timed animation: the row's progress
// is a function of where the page is, so it tracks the finger both ways and
// reverses if you scroll back up. Opacity and transform only, so it stays on
// the native driver alongside each screen's masthead.
import { Animated } from 'react-native'

// These three have a hard ceiling, and it is not a matter of taste.
//
// A row near the end of the content can only be scrolled a little past the
// point it enters — at most its own height plus the list's bottom padding.
// Whatever the reveal needs to finish has to fit inside that, or the last rows
// never reach the end of their curve and sit dimmed and displaced at full
// scroll. That is what hid rows 39 and 40 of a 40-row chart.
//
//     LEAD + RUN + (STAGGER_WRAP - 1) * STAGGER  <=  rowHeight + listPaddingBottom
//
// Both boards pad 130 and run ~70pt rows, so the budget is ~200 and this comes
// to 159. Raise any of these and check that sum first.
/** How far up from the bottom edge a row begins reacting. */
const LEAD = 50
/** Scroll distance the reveal plays out over. */
const RUN = 85
/** Extra delay per position, so a list cascades instead of arriving at once. */
const STAGGER = 6
/** The cascade repeats every few rows rather than accumulating down the list.
 *  Multiplying by an absolute index gave row 38 a 228px delay it could never
 *  scroll far enough to pay off. */
const STAGGER_WRAP = 5

export interface RevealStyle {
  opacity: Animated.AnimatedInterpolation<number>
  transform: (
    | { translateY: Animated.AnimatedInterpolation<number> }
    | { scale: Animated.AnimatedInterpolation<number> }
  )[]
}

/**
 * @param scrollY   the screen's shared scroll position
 * @param absY      the row's offset within the scroll content
 * @param order     its position in the list, for the cascade
 * @param windowH   viewport height
 */
export function revealStyle(
  scrollY: Animated.Value,
  absY: number,
  order: number,
  windowH: number,
): RevealStyle {
  const start = absY - windowH + LEAD + (order % STAGGER_WRAP) * STAGGER
  const progress = scrollY.interpolate({
    inputRange: [start, start + RUN],
    outputRange: [0, 1],
    extrapolate: 'clamp',
  })

  return {
    // Solid well before the bounce starts. Fading and bouncing at once reads as
    // mush; opaque by the time it moves means you see the movement.
    opacity: progress.interpolate({
      inputRange: [0, 0.38, 1],
      outputRange: [0, 1, 1],
    }),
    transform: [
      {
        // Past the resting point and back. The stops are asymmetric on purpose:
        // the overshoot is larger than the rebound, which is how a real spring
        // decays and what stops it reading as a wobble.
        translateY: progress.interpolate({
          inputRange: [0, 0.62, 0.84, 1],
          outputRange: [26, -6, 2, 0],
        }),
      },
      {
        scale: progress.interpolate({
          inputRange: [0, 0.62, 0.84, 1],
          outputRange: [0.93, 1.025, 0.996, 1],
        }),
      },
    ],
  }
}
