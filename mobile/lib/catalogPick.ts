// What a catalog search result offers, wherever one is listed: Add an album (the
// "+" sheet) and search's "From the catalogs" rows. Kept in one place so the two
// can't come to disagree about where a picked record lands.
import { useState } from 'react'
import { useRouter } from 'expo-router'
import { useQueryClient } from '@tanstack/react-query'
import type { AlbumSearchResult } from '@pressd/shared/api'
import { importAlbum, resolveAlbum } from './api'
import { useAuth } from './auth'

export function catalogKey(r: AlbumSearchResult): string {
  return `${r.source}:${r.source_id}`
}

export function useCatalogPick() {
  const router = useRouter()
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const [picked, setPicked] = useState<AlbumSearchResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Rows already shelved this session — the list stays put after "add", so
  // without a mark there's nothing to show the tap landed.
  const [shelved, setShelved] = useState<string[]>([])

  /** The third way out of a search result: look before you commit. Opens the
   *  userbase view by name+artist — the record may not be in Pressd at all yet
   *  — carrying the Deezer id when we have one so the tracklist resolves and
   *  Rate now can import from it. Nothing is written to the library here. */
  function preview(r: { album_name: string; artist: string; deezer: string | null }) {
    router.push({
      pathname: '/album/[id]',
      params: {
        // The id segment goes unused once name+artist are present, but the
        // route still requires one.
        id: r.deezer ?? '0',
        name: r.album_name,
        artist: r.artist,
        ...(r.deezer ? { deezer: r.deezer } : {}),
      },
    })
  }

  /** Both actions import the same album — they differ in the status it lands
   *  in and where you end up. "Rate now" opens the rating flow; "Add to
   *  library" shelves it under To Listen and stays here, so several records
   *  can be queued from one search. */
  async function pick(r: AlbumSearchResult, mode: 'rate' | 'shelve') {
    if (picked || !user) return
    setPicked(r)
    setError(null)
    try {
      const full = await resolveAlbum(r)
      const album = await importAlbum(full, mode === 'rate' ? 'listening' : 'to_listen', user.id)
      if (mode === 'rate') {
        router.replace({ pathname: '/rate/[id]', params: { id: String(album.id) } })
        return
      }
      // Shelved: the library grids are now stale wherever they're mounted.
      queryClient.invalidateQueries({ queryKey: ['albums'] })
      setShelved((s) => [...s, catalogKey(r)])
      setPicked(null)
    } catch {
      setError('Could not load that album. Try another result.')
      setPicked(null)
    }
  }

  return { picked, error, shelved, pick, preview }
}

export function deezerIdOf(r: AlbumSearchResult): string | null {
  return r.source === 'deezer' ? r.source_id : null
}
