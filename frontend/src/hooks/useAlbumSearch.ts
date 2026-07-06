import { useState, useEffect } from 'react'
import { searchSpotify, searchMusicBrainz, searchItunes, searchDeezer } from '../api'
import type { SpotifyAlbumResult } from '../api'

function normalizeKey(name: string, artist: string): string {
  return `${name}|||${artist}`.toLowerCase().replace(/[^a-z0-9|]/g, '')
}

function mergeResults(
  itunes: SpotifyAlbumResult[],
  spotify: SpotifyAlbumResult[],
  deezer: SpotifyAlbumResult[],
  mb: SpotifyAlbumResult[],
): SpotifyAlbumResult[] {
  const seen = new Map<string, SpotifyAlbumResult>()
  for (const r of [...itunes, ...spotify, ...deezer, ...mb]) {
    const key = normalizeKey(r.album_name, r.artist)
    const existing = seen.get(key)
    if (!existing) {
      seen.set(key, r)
    } else if (!existing.cover_url && r.cover_url) {
      seen.set(key, r)
    }
  }
  return [...seen.values()].slice(0, 12)
}

/**
 * Debounced album search fanning out to all 4 sources simultaneously.
 * The three fast sources (iTunes, Spotify, Deezer) populate results
 * immediately; MusicBrainz — slow (global ~1 req/s limit) but the only
 * source with announced/unreleased albums — is merged in when it arrives.
 */
export function useAlbumSearch(query: string) {
  const [results, setResults] = useState<SpotifyAlbumResult[]>([])
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
    const timer = setTimeout(async () => {
      const q = query.trim()
      const mbPromise = searchMusicBrainz(q).catch(() => [] as SpotifyAlbumResult[])
      try {
        const [itunesRes, spotifyRes, deezerRes] = await Promise.allSettled([
          searchItunes(q),
          searchSpotify(`album:${q}`),
          searchDeezer(q),
        ])
        if (cancelled) return
        const itunes  = itunesRes.status  === 'fulfilled' ? itunesRes.value  : []
        const spotify = spotifyRes.status === 'fulfilled' ? spotifyRes.value : []
        const deezer  = deezerRes.status  === 'fulfilled' ? deezerRes.value  : []
        setResults(mergeResults(itunes, spotify, deezer, []))
        setMbPending(true)

        const mb = await mbPromise
        if (cancelled) return
        setMbPending(false)
        const merged = mergeResults(itunes, spotify, deezer, mb)
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
