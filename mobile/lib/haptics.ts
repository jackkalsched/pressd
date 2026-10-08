// Every buzz in the app goes through here, so Settings → Haptics turns all of
// them off at once. Calling expo-haptics directly from a component is how a
// new one would ignore that switch.
//
// Failures are swallowed: a device without a Taptic Engine, or one in Low
// Power Mode, rejects, and a missing buzz is never worth an error.
import * as Haptics from 'expo-haptics'
import { getPrefs } from './prefs'

/** A detent: a slider passing a whole number, a menu opening, a vote. */
export function selection(): void {
  if (getPrefs().haptics) Haptics.selectionAsync().catch(() => {})
}

/** A light tap: a like, sending a post. */
export function light(): void {
  if (getPrefs().haptics) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {})
}

/** Something finished: a rating submitted. */
export function success(): void {
  if (getPrefs().haptics) Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {})
}
