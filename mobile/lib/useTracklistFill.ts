// Tops up the tracklist of a copy of yours that isn't settled yet. A record
// added before it was out carries whatever the catalog listed then (often the
// lead singles, or nothing). POST /albums/{id}/tracklist merges
// (backend/tracklist_fill.py): it adds the songs a copy is missing, from
// another copy of the same edition, then from `release` (looked up by name
// here), matched by recording so a single already on the copy isn't added
// twice, and never deletes or re-scores a song. Before release that's a top-up
// and can happen again on a later open; on or after release day it is the
// copy's one pull, after which the server marks it settled and it never
// changes again. The daily worker (worker/fill_tracklists.py) does the same.
//
// Asked for an unrated copy that isn't settled (on a server too old to say:
// songless or unreleased), once per copy per session (staleTime and gcTime
// Infinity), one request: the catalog is looked up first and sent with it. A
// released copy with songs whose lookup failed isn't sent at all, so a dropped
// connection can't spend its one pull; the worker does it instead. The album is
// refetched only when its songs or its settled state changed. Web's lib/useTracklistFill.ts
// is the same hook.
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { isUnreleased, type Album } from '@pressd/shared/types'
import { fillTracklist, resolveReleaseByName } from './api'

export function useTracklistFill(album: Album | undefined, isMine: boolean): { filling: boolean } {
  const queryClient = useQueryClient()
  const unsettled =
    album?.tracklistSettled === false ||
    (album?.tracklistSettled == null && !!album && (album.songs.length === 0 || isUnreleased(album.releaseDate)))
  const want = !!album && isMine && album.status !== 'rated' && unsettled
  const { isFetching } = useQuery({
    queryKey: ['tracklist-fill', album?.id],
    queryFn: async () => {
      const before = album!.songs.length
      const release = await resolveReleaseByName(album!.albumName, album!.artist).catch(() => null)
      const out = !isUnreleased(album!.releaseDate)
      if (!release && out && before > 0) return before
      const filled = await fillTracklist(album!.id, release)
      if (filled.songs.length !== before || filled.tracklistSettled !== album!.tracklistSettled) {
        queryClient.invalidateQueries({ queryKey: ['album', album!.id] })
        queryClient.invalidateQueries({ queryKey: ['albums'] })
      }
      return filled.songs.length
    },
    enabled: want,
    staleTime: Infinity,
    gcTime: Infinity,
    refetchOnWindowFocus: false,
    retry: false,
  })
  return { filling: want && isFetching }
}
