// How a bin's records can be ordered — one set of rules for both apps' "Sort
// by" menus.
//
// Each order has a natural direction: the source's list runs 1 → 100, the
// scores highest first. Ascending / Descending turns it round. A record with
// no number for the order (nobody has rated it, you haven't, no prediction)
// stays after the ones that have one, whichever way it runs, and ties fall
// back to the list's order.
//
// "Not yet rated" puts the records you haven't rated first — best predicted
// first, so it reads as a to-do list — and then the ones you have, by your
// score. "Most rated" counts the people who've rated the record on Pressd.
import type { BinCard, BinEntry } from './api'

export type BinSort = 'list' | 'pressd' | 'raters' | 'yours' | 'unrated'
export type BinSortDir = 'asc' | 'desc'

/** Each order's own direction, which choosing it resets to. */
export const BIN_SORT_DIR: Record<BinSort, BinSortDir> = {
  list: 'asc',
  pressd: 'desc',
  raters: 'desc',
  yours: 'desc',
  unrated: 'desc',
}

export function binSortLabel(sort: BinSort, sourceName: string | null): string {
  switch (sort) {
    case 'list': return sourceName ? `${sourceName}’s order` : 'The list’s order'
    case 'pressd': return 'Pressd’s order'
    case 'raters': return 'Most rated'
    case 'yours': return 'Your rating'
    case 'unrated': return 'Not yet rated'
  }
}

const rated = (e: BinEntry) => e.mine?.status === 'rated' && e.mine.score != null

function value(e: BinEntry, sort: BinSort): number | null {
  switch (sort) {
    case 'list': return e.position
    case 'pressd': return e.pressdAvg
    case 'raters': return e.pressdRaters
    case 'yours': return rated(e) ? e.mine!.score : null
    case 'unrated': return rated(e) ? e.mine!.score : e.predictedScore
  }
}

export function sortBinEntries(entries: BinEntry[], sort: BinSort, dir: BinSortDir): BinEntry[] {
  const sign = dir === 'asc' ? 1 : -1
  return [...entries].sort((a, b) => {
    if (sort === 'unrated') {
      const g = Number(rated(a)) - Number(rated(b))
      if (g) return g
    }
    const x = value(a, sort), y = value(b, sort)
    if (x == null && y == null) return a.position - b.position
    if (x == null) return 1
    if (y == null) return -1
    return sign * (x - y) || a.position - b.position
  })
}

// ── Search ────────────────────────────────────────────────────────────────────
// A bin page's search box and the Bins page's. Case, accents and punctuation
// don't count ("beyonce" finds Beyoncé, "mr brightside" finds "Mr. Brightside"),
// and every word typed must appear somewhere in the row.

function fold(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

function matches(fields: (string | null | undefined)[], query: string): boolean {
  const words = fold(query).split(' ').filter(Boolean)
  if (!words.length) return true
  const hay = ` ${fold(fields.filter(Boolean).join(' '))} `
  return words.every((w) => hay.includes(w))
}

/** A record (or song) in a bin, by its title, artist, album or year. */
export function binEntryMatches(e: BinEntry, query: string): boolean {
  return matches([e.songTitle, e.albumName, e.artist, e.year != null ? String(e.year) : null, e.genre], query)
}

/** A bin on the Bins page, by its title or source. */
export function binCardMatches(b: BinCard, query: string): boolean {
  return matches([b.title, b.sourceName, b.sourceYear != null ? String(b.sourceYear) : null], query)
}
