// Favourite song picker — your scored tracks, best first.
//
// The only picker that can't read a list the app already holds: nothing else
// ranks a user's songs across albums, so this one goes to /songs/ranked. That
// endpoint caps the board, which means search has to run server-side too — a
// four-hundred-album library carries thousands of scored tracks and the one
// being looked for is often nowhere near the top.
import { useEffect, useState } from 'react'
import { useRouter } from 'expo-router'
import { useQuery } from '@tanstack/react-query'
import { fetchRankedSongs } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { useProfile, useSavePick } from '../../lib/picks'
import { SongRankRow } from '../../components/RatingsRows'
import FavoritePicker from '../../components/FavoritePicker'
import type { RankedSong } from '@pressd/shared/api'

export default function FavoriteSongPicker() {
  const router = useRouter()
  const { user } = useAuth()
  const [search, setSearch] = useState('')
  // Typing shouldn't fire a request per keystroke; a short pause is the signal
  // that the query is worth asking about.
  const [debounced, setDebounced] = useState('')
  const { data: profile } = useProfile(user?.id)
  const { save, saving, error } = useSavePick()

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 250)
    return () => clearTimeout(t)
  }, [search])

  const { data: songs = [], isLoading } = useQuery({
    queryKey: ['ranked-songs', user?.id, debounced],
    queryFn: () => fetchRankedSongs({ userId: user!.id, q: debounced || undefined }),
    enabled: !!user,
    // The board only moves when a song is re-rated, so it holds across the
    // back-and-forth of opening this screen, picking, and coming back.
    staleTime: 5 * 60_000,
  })

  const pickedId = profile?.favorite_song?.id ?? null

  return (
    <FavoritePicker<RankedSong>
      question="What's your favorite song right now?"
      data={songs}
      loading={isLoading}
      keyExtractor={(s) => String(s.id)}
      renderRow={(s, i) => (
        <SongRankRow song={s} rank={i + 1} onPress={() => save({ favoriteSongId: s.id })} />
      )}
      isSelected={(s) => s.id === pickedId}
      search={search}
      onSearchChange={setSearch}
      searchPlaceholder="Search your rated songs"
      emptyText={debounced ? 'No songs match your search.' : 'No rated songs yet.'}
      hasPick={pickedId != null}
      onClear={() => save({ favoriteSongId: null })}
      saving={saving}
      error={error}
      onBack={() => router.back()}
    />
  )
}
