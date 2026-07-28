import { useState, useEffect } from 'react'
import { searchItunes, searchDeezer, searchMusicBrainz } from '../api'
import type { AlbumSearchResult } from '../api'
import { mergeAndRankWithPopularity } from '../albumSearch'

/**
 * Debounced album search across iTunes, Deezer, and MusicBrainz.
 *
 * The two fast sources render first; MusicBrainz — slower, but the only source
 * carrying announced/unreleased albums — is merged in when it arrives. Both
 * passes rank the full merged set by relevance (including a Last.fm popularity
 * prior) rather than appending each source's list, so the top of the dropdown
 * is the best match and not whichever source happened to be listed first.
 *
 * Results carry identity only. The tracklist is fetched by `resolveAlbum` once
 * the user picks one.
 */
export function useAlbumSearch(query: string) {
  const [results, setResults] = useState<AlbumSearchResult[]>([])
  const [searching, setSearching] = useState(false)
  const [mbPending, setMbPending] = useState(false)
  const [noResults, setNoResults] = useState(false)

  useEffect(() => {
    if (query.trim().length < 2) {
      setResults([])
      setSearching(false)
      setMbPending(false)
      setNoResults(false)
      return
    }
    setSearching(true)
    setMbPending(false)
    setNoResults(false)
    let cancelled = false
    const empty = () => [] as AlbumSearchResult[]

    const timer = setTimeout(async () => {
      const q = query.trim()
      const mbPromise = searchMusicBrainz(q).catch(empty)
      try {
        const [itunes, deezer] = await Promise.all([
          searchItunes(q).catch(empty),
          searchDeezer(q).catch(empty),
        ])
        if (cancelled) return
        setMbPending(true)
        const fast = await mergeAndRankWithPopularity(q, [itunes, deezer])
        if (cancelled) return
        setResults(fast)

        const mb = await mbPromise
        if (cancelled) return
        setMbPending(false)
        const merged = await mergeAndRankWithPopularity(q, [itunes, deezer, mb])
        if (cancelled) return
        setResults(merged)
        setNoResults(merged.length === 0)
      } catch {
        if (cancelled) return
        setResults([])
        setMbPending(false)
        setNoResults(true)
      } finally {
        if (!cancelled) setSearching(false)
      }
    }, 380)

    return () => { cancelled = true; clearTimeout(timer) }
  }, [query])

  return { results, searching, mbPending, noResults }
}
