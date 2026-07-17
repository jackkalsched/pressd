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
