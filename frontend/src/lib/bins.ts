// Words about bins, once for every web surface that shows one.
import type { BinCard } from '../api'

// The server's limits (backend/user_bins.py), so a field stops where it would
// be refused.
export const TITLE_MAX = 80
export const DESCRIPTION_MAX = 500
export const NOTE_MAX = 280

/** A bin's text fields: the new-bin dialog and the edit mode. */
export const BIN_FIELD =
  'w-full rounded-xl border border-(--c-e2dbd0) bg-(--c-fff) px-3.5 py-2.5 text-[14.5px] text-(--c-1c1917) transition-colors placeholder:text-(--c-a8998a) focus:border-(--c-2d6a4f) focus:outline-none'

/** Under a bin's title: the list it came from for Pressd's, who made it for
 *  anyone else's — "a former Pressd member" once its maker has left. */
export function binByline(bin: Pick<BinCard, 'kind' | 'owner' | 'sourceName' | 'sourceYear'>): string | null {
  if (bin.kind === 'curated') {
    return bin.sourceName ? `${bin.sourceName}${bin.sourceYear ? ` · ${bin.sourceYear}` : ''}` : null
  }
  return `by ${bin.owner?.name ?? 'a former Pressd member'}`
}

// What a refused bin write says, in the app's words. The shared client throws
// the server's `detail` (backend/routers/bins.py) as the message; these are the
// refusals a person can meet in normal use, and anything else reads as itself.
export function binErrorText(e: unknown, fallback = 'Something went wrong. Try again.'): string {
  const msg = e instanceof Error ? e.message : ''
  if (msg === 'unreleased') return 'That album isn’t out yet'
  if (msg === 'single') return 'Singles can’t go in a bin'
  if (/already in this bin/i.test(msg)) return 'Already in this bin'
  if (/^A bin holds up to/i.test(msg)) return 'Bins hold up to 100 albums'
  if (/^You can have up to/i.test(msg)) return 'You can have up to 25 bins'
  if (/^The bin changed/i.test(msg)) return 'This bin just changed. Try again.'
  if (/^over \d+ characters$/.test(msg)) return `That’s too long: ${msg}`
  if (msg === 'required') return 'Give it a title'
  if (msg === 'No match for this release') return 'Couldn’t find that album in the catalogs'
  return msg || fallback
}
