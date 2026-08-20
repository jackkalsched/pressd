import { useEffect, useState } from 'react'

/**
 * What the app says while a submitted rating settles.
 *
 * Submitting doesn't just save scores. The backend re-scores the album against
 * the user's own factor distribution — shrunk toward the userbase prior — and
 * then recomputes every other album they own, because that distribution just
 * moved. The userbase-wide rating for the record is invalidated too. It's real
 * work, and it takes long enough that a bare spinner reads as a hang.
 *
 * Deliberately nothing here names theme, replay value, production or
 * distinctness: EPs (≤6 tracks) skip the external factors entirely, so a
 * message about weighing them would be a lie on every short record. These all
 * hold either way.
 *
 * The nudge in the middle is the point of the sequence. This is the one moment
 * the user has finished the album and has nothing to do, which is exactly when
 * asking for a review lands.
 */
export const RECALIBRATION_MESSAGES = [
  'Recalibrating score…',
  'Comparing to the rest of your library…',
  'Write a review!',
  'Almost there…',
] as const

/** How long each message holds before the next one. */
export const RECALIBRATION_INTERVAL_MS = 1400

/**
 * Walks `RECALIBRATION_MESSAGES` while mounted, holding on the last one.
 *
 * Mount this only for as long as the wait lasts — the sequence restarts from
 * the top on mount and has no reset of its own, which is what keeps it free of
 * the synchronous set-state-in-effect the web lint config rejects.
 *
 * It holds rather than loops: cycling back to "Recalibrating" after "Almost
 * there" reads as the work having started over.
 */
export function useRecalibrationMessage(intervalMs: number = RECALIBRATION_INTERVAL_MS): string {
  const [step, setStep] = useState(0)

  useEffect(() => {
    const timer = setInterval(
      () => setStep((prev) => Math.min(prev + 1, RECALIBRATION_MESSAGES.length - 1)),
      intervalMs,
    )
    return () => clearInterval(timer)
  }, [intervalMs])

  return RECALIBRATION_MESSAGES[step]
}
