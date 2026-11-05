import { useSegments } from 'expo-router'
// Session-scoped flag: set when a brand-new user chooses to skip the welcome
// screen ("I'll explore first"). Once they rate their first album the gate
// stops firing on its own, so this only needs to live for the session.
let skipped = false

export function isOnboardingSkipped(): boolean {
  return skipped
}
export function skipOnboarding(): void {
  skipped = true
}

// The screens nothing may open over: the first run (username, tutorial, the
// first-album pick) and the rating flow, plus adding a record. The root layout's
// launch prompts — the phone number, notifications — and the people
// sheet all hold while one of these is showing and wait for the next ordinary
// screen, so no step of onboarding lands on top of another.
export const HELD_ON = new Set(['rate', 'tutorial', 'username', 'welcome', 'first-album', 'add'])

/** True while the current screen is one of HELD_ON. */
export function useOnHeldScreen(): boolean {
  const segments = useSegments()
  return HELD_ON.has(segments[0] ?? '')
}
