// Favourite artist picker.
//
// Sourced from /stats/artists, which already returns every artist with a scored
// song ordered by SAR — value above replacement, so it rewards both how well you
// rate someone and how much of them you've rated. Deliberately not the Ratings
// board's artist mode: that one hides anyone under fifteen rated songs, which is
// a sensible bar for a leaderboard and an absurd one for naming a favourite.
import { useMemo, useState } from 'react'
import { useRouter } from 'expo-router'
import { useQuery } from '@tanstack/react-query'
import { fetchArtistStats } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { useProfile, useSavePick } from '../../lib/picks'
import type { ArtistRank } from '../../lib/rankings'
import { ArtistRankRow } from '../../components/RatingsRows'
import FavoritePicker from '../../components/FavoritePicker'

export default function FavoriteArtistPicker() {
  const router = useRouter()
  const { user } = useAuth()
  const [search, setSearch] = useState('')
  const { data: profile } = useProfile(user?.id)
  const { save, saving, error } = useSavePick()

  const { data: stats = [], isLoading } = useQuery({
    queryKey: ['artist-stats', user?.id],
    queryFn: () => fetchArtistStats(user!.id),
    enabled: !!user,
  })

  const q = search.trim().toLowerCase()
  const artists = useMemo<ArtistRank[]>(
    () =>
      stats
        .filter((s) => !q || s.artist.toLowerCase().includes(q))
        // ArtistRankRow reads the league-indexed + metrics off the scatter
        // endpoint, which this screen has no reason to fetch — it only ever
        // shows the average, so the rest stay null.
        .map((s) => ({
          artist: s.artist,
          songs: s.count,
          avgSongScore: s.avgSongScore,
          songPlus: null,
          wSongPlus: null,
          consistencyPlus: null,
          bangPct: s.bangPct,
          skipPct: s.skipPct,
        })),
    [stats, q],
  )

  const picked = profile?.favorite_artist ?? null

  return (
    <FavoritePicker<ArtistRank>
      question="What's your favorite artist right now?"
      data={artists}
      loading={isLoading}
      keyExtractor={(a) => a.artist}
      renderRow={(a, i) => (
        <ArtistRankRow
          stat={a}
          rank={i + 1}
          metricKey="avg"
          onPress={() => save({ favoriteArtist: a.artist })}
        />
      )}
      isSelected={(a) => a.artist === picked}
      search={search}
      onSearchChange={setSearch}
      searchPlaceholder="Search your artists"
      emptyText={q ? 'No artists match your search.' : 'No rated songs yet.'}
      hasPick={!!picked}
      onClear={() => save({ favoriteArtist: null })}
      saving={saving}
      error={error}
      onBack={() => router.back()}
    />
  )
}
