// Opening someone's profile from wherever their name or face is shown.
//
// Profiles are public (backend/deps.py, authorize_view), so any person the app
// names can be opened, friend or not. Your own name goes to the Profile tab:
// /friend/[id] is the read-only page, and would show you yourself with no way to
// edit anything.
//
// Inside a native modal, close it first and then call this. A push from inside
// one lands behind it, on a screen nobody can see.
import { useCallback } from 'react'
import { useRouter } from 'expo-router'
import { useAuth } from './auth'

export function useOpenProfile() {
  const router = useRouter()
  const { user } = useAuth()
  const myId = user?.id
  return useCallback(
    (id: number) => {
      if (id === myId) router.dismissTo('/(tabs)/profile')
      else router.push({ pathname: '/friend/[id]', params: { id: String(id) } })
    },
    [router, myId],
  )
}
