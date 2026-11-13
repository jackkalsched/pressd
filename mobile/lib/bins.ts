// Words about bins, once for every iPhone surface that shows one. The copy is
// web's (frontend/src/lib/bins.ts), line for line; change both.
import type { QueryClient } from '@tanstack/react-query'
import type { BinCard } from './api'

// The server's limits (backend/user_bins.py), so a field stops where it would
// be refused.
export const TITLE_MAX = 80
export const DESCRIPTION_MAX = 500
export const NOTE_MAX = 280

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

/** After any write to a bin. A write answers with a partial entry or card (no
 *  genre, no Pressd figures, no description), never something to keep, so
 *  every list that shows the bin — its page, the bin lists, search's Bins
 *  group — asks again instead. */
export function refreshBin(queryClient: QueryClient, slug: string) {
  queryClient.invalidateQueries({ queryKey: ['bin', slug] })
  queryClient.invalidateQueries({ queryKey: ['bins'] })
  queryClient.invalidateQueries({ queryKey: ['search'] })
}

/** Whitespace folded, as the server stores a title or description, so an
 *  edit that only moved spaces around isn't sent again. */
export const foldSpace = (v: string) => v.split(/\s+/).join(' ').trim()
