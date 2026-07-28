/**
 * Multi-source album search: fan-out, relevance ranking, and merge.
 *
 * Each source returns results in its own relevance order, and those orders are
 * not comparable — iTunes ranks `Blonde` as the Netflix soundtrack while Deezer
 * ranks it as Frank Ocean's. Concatenating them meant whichever source was
 * listed first owned the top of the dropdown regardless of match quality, so
 * every result is scored against the query and the merged set is sorted by that
 * score instead.
 */
import { searchItunes, searchDeezer, searchMusicBrainz, fetchPopularity } from './api'
import type { AlbumSearchResult } from './api'

// ── Normalization ─────────────────────────────────────────────────────────────

// Edition qualifiers that name the same record: "(Deluxe)", "- 2011 Remaster".
// Deliberately excludes soundtrack/OST/live — those are genuinely different
// releases, and folding them in makes a soundtrack look like an exact match.
const EDITION_PAREN =
  /[([][^)\]]*\b(deluxe|remaster(ed)?|expanded|edition|version|anniversary|explicit|bonus|mono|stereo|reissue|remix|mix)\b[^)\]]*[)\]]/gi
const EDITION_TRAIL =
  /\s[-–]\s[^-–]*\b(deluxe|remaster(ed)?|expanded|edition|version|anniversary|explicit|bonus|mono|stereo|reissue|remix|mix)\b.*$/gi

/** Strip diacritics so "Cœur"/"Coeur" and "Beyoncé"/"Beyonce" compare equal. */
function deaccent(s: string): string {
  return s.normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/œ/gi, 'oe').replace(/æ/gi, 'ae')
}

/** Comparison key: edition qualifiers dropped, punctuation gone. */
export function normalizeTitle(s: string): string {
  let t = deaccent(s || '').toLowerCase()
  t = t.replace(EDITION_PAREN, ' ').replace(EDITION_TRAIL, ' ')
  return t.replace(/[^a-z0-9]+/g, ' ').trim()
}

function tokens(s: string): string[] {
  return normalizeTitle(s).split(' ').filter(Boolean)
}

/** Identity key for deduping the same record across sources. */
export function albumKey(name: string, artist: string): string {
  return `${normalizeTitle(name)}|||${normalizeTitle(artist)}`
}

// ── Scoring ───────────────────────────────────────────────────────────────────

/** How much of `sub`'s tokens appear in `sup` (0–1). */
function tokenCoverage(sub: string[], sup: string[]): number {
  if (sub.length === 0) return 0
  const set = new Set(sup)
  return sub.filter((t) => set.has(t)).length / sub.length
}

/**
 * Title match, 0–1. Partial matches are scaled by how much of the query the
 * candidate actually accounts for, so a one-word title can't ride to the top of
 * a long query just by being a prefix of it.
 */
function titleScore(qNorm: string, qTokens: string[], name: string): number {
  const n = normalizeTitle(name)
  if (!n || !qNorm) return 0
  if (n === qNorm) return 1
  // Overlap is scaled by how much of the longer string the shorter one covers:
  // "Kid A" against "Kid A Mnesia" is a weaker match than against "Kid A".
  const shrink = (a: string, b: string) => 0.5 + 0.5 * (a.length / b.length)
  if (n.startsWith(qNorm)) return 0.85 * shrink(qNorm, n)
  if (qNorm.startsWith(n)) return 0.75 * shrink(n, qNorm)
  if (n.includes(qNorm)) return 0.6 * shrink(qNorm, n)
  if (qNorm.includes(n)) return 0.55 * shrink(n, qNorm)
  // Fall back to how much of the query the title accounts for.
  return 0.5 * tokenCoverage(qTokens, tokens(name))
}

/** Artist match, 0–1 — how much of the artist name the query names. */
function artistScore(qTokens: string[], artist: string): number {
  const aTokens = tokens(artist)
  if (aTokens.length === 0 || qTokens.length === 0) return 0
  return tokenCoverage(aTokens, qTokens)
}

// Per-source weight on that source's own relevance ordering. Deezer's ranking
// tracks popularity closely and puts the canonical record first for bare album
// titles; iTunes' leads with soundtracks and singles; MusicBrainz ranks by text
// match alone and has no popularity signal at all.
const SOURCE_TRUST: Record<string, number> = { deezer: 1.4, itunes: 0.9, mb: 0.7 }

const SINGLE_EP_SUFFIX = /\s[-–]\s(single|ep)\s*$/i
const VARIOUS_ARTISTS = /^(various artists?|various|soundtrack)$/i

// Weight on Last.fm listener count. Text similarity alone can't separate a
// famous album from an obscure one with the same name — "Rumours" by the band
// Rumours scores a perfect title *and* artist match, beating Fleetwood Mac's.
// Listener counts separate them by four orders of magnitude.
let POPULARITY_WEIGHT = 2.0

/** Test seam for tuning the weight against recorded search fixtures. */
export function setPopularityWeight(w: number): void {
  POPULARITY_WEIGHT = w
}

/**
 * Listener count → 0–1. Log-scaled: the interesting range spans ~1 to ~5M
 * listeners, so raw counts would let one megahit swamp every other signal.
 * log10(5M) ≈ 6.7, so dividing by 7 keeps it inside the unit interval.
 */
function popularityScore(listeners: number | null | undefined): number {
  if (!listeners || listeners <= 0) return 0
  return Math.min(1, Math.log10(listeners + 1) / 7)
}

export interface ScoredResult extends AlbumSearchResult {
  _score: number
}

function scoreOne(
  r: AlbumSearchResult,
  rank: number,
  qNorm: string,
  qTokens: string[],
  agreement: number,
): number {
  let score = 3.0 * titleScore(qNorm, qTokens, r.album_name)
  score += 2.0 * artistScore(qTokens, r.artist)
  score += POPULARITY_WEIGHT * popularityScore(r.listeners)
  // The source's own relevance prior, decaying down its result list.
  score += (SOURCE_TRUST[r.source] ?? 0.7) / (1 + rank)
  if (r.cover_url) score += 0.15
  if (normalizeTitle(r.album_name) === qNorm) score += 0.35
  // Same record found by more than one source — a real album, not a long-tail
  // upload that only one catalog carries.
  score += 0.25 * Math.max(0, agreement - 1)
  // "Kid A - Single" when nobody asked for a single.
  if (SINGLE_EP_SUFFIX.test(r.album_name) && !/\b(single|ep)\b/i.test(qNorm)) score -= 0.6
  if (VARIOUS_ARTISTS.test(r.artist.trim())) score -= 0.4
  return score
}

// ── Merge ─────────────────────────────────────────────────────────────────────

/** Prefer the richer value when the same album comes back from two sources. */
function backfill(winner: AlbumSearchResult, other: AlbumSearchResult): AlbumSearchResult {
  return {
    ...winner,
    cover_url: winner.cover_url ?? other.cover_url,
    listeners: winner.listeners ?? other.listeners,
    // Deezer's search payload carries no release date; a duplicate from iTunes
    // or MusicBrainz usually does, and resolve fills in the rest on pick.
    year: winner.year ?? other.year,
    total_tracks: winner.total_tracks ?? other.total_tracks,
    genre: winner.genre ?? other.genre,
    release_date: winner.release_date ?? other.release_date,
    upcoming: winner.upcoming ?? other.upcoming,
  }
}

/**
 * Merge every source's results into one relevance-ranked list. Duplicates are
 * collapsed on normalized name+artist; the highest-scoring copy wins and
 * inherits any fields the others filled in.
 */
export function mergeAndRank(query: string, lists: AlbumSearchResult[][], limit = 12): AlbumSearchResult[] {
  const qNorm = normalizeTitle(query)
  const qTokens = tokens(query)

  // Cross-source agreement has to be counted before scoring.
  const agreement = new Map<string, number>()
  for (const list of lists) {
    const seenInList = new Set<string>()
    for (const r of list) {
      const key = albumKey(r.album_name, r.artist)
      if (seenInList.has(key)) continue
      seenInList.add(key)
      agreement.set(key, (agreement.get(key) ?? 0) + 1)
    }
  }

  const best = new Map<string, ScoredResult>()
  for (const list of lists) {
    for (let rank = 0; rank < list.length; rank++) {
      const r = list[rank]
      if (!r.album_name || !r.artist) continue
      const key = albumKey(r.album_name, r.artist)
      const _score = scoreOne(r, rank, qNorm, qTokens, agreement.get(key) ?? 1)
      const existing = best.get(key)
      if (!existing) {
        best.set(key, { ...r, _score })
      } else if (_score > existing._score) {
        best.set(key, { ...backfill(r, existing), _score })
      } else {
        best.set(key, { ...backfill(existing, r), _score: existing._score })
      }
    }
  }

  return [...best.values()]
    .sort((a, b) => b._score - a._score)
    .slice(0, limit)
}

/**
 * Merge, then re-rank once Last.fm listener counts are in.
 *
 * Popularity is looked up only for the candidates that survive the merge — a
 * bounded batch, and the lookup can only reorder rows the user was already
 * going to see. Counts are written back onto the source lists so the re-rank
 * keeps each row's original per-source rank and cross-source agreement.
 *
 * A failed lookup is not fatal: the text-only ranking is returned as-is.
 */
export async function mergeAndRankWithPopularity(
  query: string,
  lists: AlbumSearchResult[][],
  limit = 12,
): Promise<AlbumSearchResult[]> {
  const merged = mergeAndRank(query, lists, limit)
  const needed = merged.filter((r) => r.listeners == null)
  if (needed.length === 0) return merged

  let counts: number[]
  try {
    counts = await fetchPopularity(
      needed.map((r) => ({ album_name: r.album_name, artist: r.artist })),
    )
  } catch {
    return merged
  }

  const byKey = new Map<string, number>()
  needed.forEach((r, i) => byKey.set(albumKey(r.album_name, r.artist), counts[i] ?? 0))
  for (const list of lists) {
    for (const r of list) {
      const v = byKey.get(albumKey(r.album_name, r.artist))
      if (v != null) r.listeners = v
    }
  }
  return mergeAndRank(query, lists, limit)
}

// ── Fan-out ───────────────────────────────────────────────────────────────────

const empty = () => [] as AlbumSearchResult[]

/**
 * Search every source and return one ranked list. Used by callers outside the
 * autocomplete (which needs the progressive two-stage version in
 * `useAlbumSearch`) that just want the best matches for a query.
 */
export async function searchAlbumsRanked(query: string, limit = 12): Promise<AlbumSearchResult[]> {
  const q = query.trim()
  if (q.length < 2) return []
  const [itunes, deezer, mb] = await Promise.all([
    searchItunes(q).catch(empty),
    searchDeezer(q).catch(empty),
    searchMusicBrainz(q).catch(empty),
  ])
  return mergeAndRankWithPopularity(q, [itunes, deezer, mb], limit)
}
