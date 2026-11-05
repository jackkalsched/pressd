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
 * message about weighing them would be a lie on every short record.
 *
 * This is the one moment the user has finished an album and has nothing to do,
 * which is when a nudge lands: so after two lines saying what's happening, the
 * wait is spent on the rest of the app — a review, a friend, the room, the
 * charts. There is no "Almost there…": the wait has no known end, and a line
 * promising one reads as a lie the moment it runs long.
 */
export const RECALIBRATION_STATUS = [
  'Recalibrating your score…',
  'Setting it against the rest of your library…',
] as const

export const RECALIBRATION_NUDGES = [
  'Loved it? Hated it? Say why in a review.',
  'The best reviews can be one sentence. Write yours next.',
  'Your review lands in the record’s discussion for everyone who’s finished it.',
  'Know someone who’d love this? Send it to their queue.',
  'Recommend it to a friend — you can add a note.',
  'Find your friends on Pressd and compare scores.',
  'Taste overlap shows who hears records the way you do.',
  'Everyone in a record’s discussion has finished it. Jump in.',
  'See what Pressd is spinning this week on the Charts.',
  'Every rating sharpens your For You picks.',
  'Put the records you love on your shelf.',
  'Queue up your next record while this one settles.',
  'Front to back, the way it was meant to be heard.',
  'Open an artist’s page to see how their records stack up.',
  'There’s a new week of releases waiting in For You.',
  'Rankings show which artists you rate highest — by more than one measure.',
] as const

/** How long each message holds before the next one: long enough to read a nudge
 *  without being hurried off it. */
export const RECALIBRATION_INTERVAL_MS = 3600

function shuffled<T>(items: readonly T[]): T[] {
  const out = [...items]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

/**
 * The status lines in order, then the nudges in a fresh random order, round
 * and round for as long as the wait lasts.
 *
 * Mount this only for as long as the wait lasts — the sequence restarts from
 * the top on mount and has no reset of its own, which is what keeps it free of
 * the synchronous set-state-in-effect the web lint config rejects.
 */
export function useRecalibrationMessage(intervalMs: number = RECALIBRATION_INTERVAL_MS): string {
  const [sequence] = useState(() => [...RECALIBRATION_STATUS, ...shuffled(RECALIBRATION_NUDGES)])
  const [step, setStep] = useState(0)

  useEffect(() => {
    const timer = setInterval(() => setStep((prev) => prev + 1), intervalMs)
    return () => clearInterval(timer)
  }, [intervalMs])

  // Past the end, the nudges come round again; the status lines don't, since
  // "Recalibrating…" a second time reads as the work having started over.
  const n = RECALIBRATION_STATUS.length
  return step < sequence.length ? sequence[step] : sequence[n + ((step - n) % (sequence.length - n))]
}
