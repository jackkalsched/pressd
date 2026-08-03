// Removing an album from your library, from wherever you happen to be looking
// at it — the detail page, mid-rating, or the To Listen shelf.
//
// Deletion is destructive and the server cascades it (songs, likes, comments,
// audio features all go), so it always asks first and names the record in the
// prompt. There's no undo, which is exactly why the confirm isn't optional.
import { useState } from 'react'
import { Alert } from 'react-native'
import { useQueryClient } from '@tanstack/react-query'
import { deleteAlbum } from './api'

type Options = {
  albumId: number
  albumName: string
  /** Where to go once it's gone. The caller is usually looking at the thing
   *  being deleted, so most screens need to leave. */
  onDeleted?: () => void
}

type QueryClient = ReturnType<typeof useQueryClient>

/** Plain function form, for callers that can't hold a hook per album — a grid
 *  cell inside a list renderer, say. */
export function confirmDeleteAlbum(
  { albumId, albumName, onDeleted }: Options,
  queryClient: QueryClient,
  onBusyChange?: (busy: boolean) => void,
) {
  Alert.alert(
    'Delete album?',
    `"${albumName}" and your ratings for it will be removed from your library. This can't be undone.`,
    [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          onBusyChange?.(true)
          try {
            await deleteAlbum(albumId)
            // Every album-derived list is now wrong: the library grids, the
            // feed, the charts, and the summary counts on the profile.
            queryClient.invalidateQueries({ queryKey: ['albums'] })
            queryClient.invalidateQueries({ queryKey: ['stats'] })
            queryClient.invalidateQueries({ queryKey: ['feed'] })
            queryClient.invalidateQueries({ queryKey: ['charts'] })
            onDeleted?.()
          } catch {
            Alert.alert('Could not delete', 'Something went wrong. Please try again.')
          } finally {
            onBusyChange?.(false)
          }
        },
      },
    ],
  )
}

export function useDeleteAlbum(opts: Options) {
  const queryClient = useQueryClient()
  const [deleting, setDeleting] = useState(false)

  function confirmDelete() {
    if (deleting) return
    confirmDeleteAlbum(opts, queryClient, setDeleting)
  }

  return { confirmDelete, deleting }
}
