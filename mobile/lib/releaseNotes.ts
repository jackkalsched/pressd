// What each build changed, in the order it should be read.
//
// Data rather than markup so shipping a release is editing this file — add an
// entry keyed by build number and the sheet picks it up. Keeping it out of the
// component also means the sheet can show the newest build's notes without
// anything else knowing which build that is.
export interface ReleaseNote {
  /** Short label, sentence case, no trailing period. */
  title: string
  /** One or two sentences saying what it does for the reader. */
  body: string
}

export interface Release {
  build: number
  /** Marketing version, for the line under the heading. */
  version: string
  notes: ReleaseNote[]
}

export const RELEASES: Release[] = [
  {
    build: 3,
    version: '1.0.0',
    notes: [
      {
        title: 'Predictions for every album',
        body: "The prediction model has been rebuilt to score every album in Press'd for every user — so you get a predicted rating even on records nobody has rated yet, and even before you've rated anything yourself.",
      },
      {
        title: 'Pick your favourites',
        body: 'Choose a favourite song, album and artist, and they sit at the top of your profile for anyone visiting it.',
      },
      {
        title: 'Ratings save as you go',
        body: 'The rating flow now saves in the background while you score, so leaving an album half-finished no longer loses the tracks you already rated.',
      },
      {
        title: 'Recommend to friends',
        body: 'Send an album straight to a friend with a note about why. It lands on their To Listen shelf marked with an orange star, and For You tells them it arrived.',
      },
      {
        title: 'A rebuilt Compare page',
        body: "The artist Compare tab now shows the songs you and the rest of Press'd hear most differently, with your score distributions overlaid — instead of percentile bars you couldn't put a track name to.",
      },
    ],
  },
]

/** The notes for a given build, or null when that build has none. */
export function releaseFor(build: number): Release | null {
  return RELEASES.find((r) => r.build === build) ?? null
}

/** The newest release we have notes for. Used as the fallback when the running
 *  binary reports a build we shipped no notes for — better to show the most
 *  recent notes than nothing at all. */
export function latestRelease(): Release | null {
  return RELEASES.reduce<Release | null>(
    (best, r) => (best == null || r.build > best.build ? r : best),
    null,
  )
}
