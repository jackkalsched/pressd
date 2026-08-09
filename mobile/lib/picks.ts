// Reading and writing the three profile picks.
//
// The profile query is shared by your own Profile tab, a friend's page and the
// three pickers, so they all key on ['profile', userId] and a save seeds that
// cache with the server's answer rather than refetching it.
import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useRouter } from 'expo-router'
import { fetchProfile, type Profile } from './api'
import { useAuth } from './auth'

export function profileKey(userId: number | undefined) {
  return ['profile', userId] as const
}

/** A user's public face and their picks. Works for any user — a friend's page
 *  reads it the same way your own does. */
export function useProfile(userId: number | undefined) {
  return useQuery({
    queryKey: profileKey(userId),
    queryFn: () => fetchProfile(userId!),
    enabled: userId != null && Number.isFinite(userId),
  })
}

export interface PickPatch {
  favoriteAlbumId?: number | null
  favoriteSongId?: number | null
  favoriteArtist?: string | null
}

/** Save one pick and go back. The server answers with the whole profile — picks
 *  resolved, not just echoed — so that reply is what lands in the cache; the
 *  banner then shows exactly what was stored, including a pick it rejected. */
export function useSavePick() {
  const { user, updateProfile } = useAuth()
  const qc = useQueryClient()
  const router = useRouter()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save(patch: PickPatch): Promise<void> {
    if (!user || saving) return
    setSaving(true)
    setError(null)
    try {
      const profile: Profile = await updateProfile(patch)
      qc.setQueryData(profileKey(user.id), profile)
      router.back()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save your pick')
    } finally {
      setSaving(false)
    }
  }

  return { save, saving, error }
}
