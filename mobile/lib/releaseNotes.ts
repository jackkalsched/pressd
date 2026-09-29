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

export const RELEASES: Release[] = []

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
