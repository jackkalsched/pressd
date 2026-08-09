// Favourite album picker — your rated library, best first.
//
// Reads the same ['albums','rated',userId] query the Profile tab already holds,
// so opening this screen usually costs nothing, and lists it through the same
// RatingRow the Ratings board uses: the row you tap here is the row you ranked
// there.
import { useMemo, useState } from 'react'
import { useRouter } from 'expo-router'
import { useQuery } from '@tanstack/react-query'
import { fetchAlbums } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { useProfile, useSavePick } from '../../lib/picks'
import { ALBUM_METRICS, cmpVals } from '../../lib/rankings'
import { RatingRow } from '../../components/RatingsRows'
import FavoritePicker from '../../components/FavoritePicker'
import type { Album } from '@pressd/shared/types'

export default function FavoriteAlbumPicker() {
  const router = useRouter()
  const { user } = useAuth()
  const [search, setSearch] = useState('')
  const { data: profile } = useProfile(user?.id)
  const { save, saving, error } = useSavePick()

  const { data: rated = [], isLoading } = useQuery({
    queryKey: ['albums', 'rated', user?.id],
    queryFn: () => fetchAlbums({ status: 'rated', userId: user!.id }),
    enabled: !!user,
  })

  const q = search.trim().toLowerCase()
  const albums = useMemo(() => {
    const byScore = ALBUM_METRICS[0]
    return rated
      .filter((a) => !q || a.albumName.toLowerCase().includes(q) || a.artist.toLowerCase().includes(q))
      .sort((a, b) => cmpVals(byScore.get(a), byScore.get(b), 'desc'))
  }, [rated, q])

  const pickedId = profile?.favorite_album?.id ?? null

  return (
    <FavoritePicker<Album>
      question="What's your favorite album right now?"
      data={albums}
      loading={isLoading}
      keyExtractor={(a) => String(a.id)}
      // The rank is the album's place in the filtered list, which is the whole
      // library until something is typed — so an unsearched list reads as your
      // leaderboard rather than an arbitrary order.
      renderRow={(a, i) => (
        <RatingRow album={a} rank={i + 1} onPress={() => save({ favoriteAlbumId: a.id })} />
      )}
      isSelected={(a) => a.id === pickedId}
      search={search}
      onSearchChange={setSearch}
      searchPlaceholder="Search your rated albums"
      emptyText={q ? 'No albums match your search.' : 'No rated albums yet.'}
      hasPick={pickedId != null}
      onClear={() => save({ favoriteAlbumId: null })}
      saving={saving}
      error={error}
      onBack={() => router.back()}
    />
  )
}
