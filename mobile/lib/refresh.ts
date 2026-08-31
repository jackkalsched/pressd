// Keeping the app's data fresh without the user reloading anything.
//
// Two triggers were missing, and between them they explain why Social and For
// You only updated on a pull-to-refresh or an app restart:
//
//   1. React Query's refetchOnWindowFocus does nothing in React Native on its
//      own. "Window focus" is a browser idea; the equivalent is AppState going
//      active, and until focusManager is told that, coming back from the home
//      screen never refetched anything.
//
//   2. Moving between tabs does not remount a screen, so a query that already
//      fetched on mount stays as it was. Switching to Social and back showed
//      the same feed however long you had been away.
import { useCallback, useRef } from 'react'
import { AppState, type AppStateStatus } from 'react-native'
import { focusManager } from '@tanstack/react-query'
import { useFocusEffect } from 'expo-router'

/** Tell React Query when the app is in the foreground. Call once at launch. */
export function wireAppStateFocus(): () => void {
  const sub = AppState.addEventListener('change', (status: AppStateStatus) => {
    focusManager.setFocused(status === 'active')
  })
  return () => sub.remove()
}

/**
 * Refetch when the screen comes back into view.
 *
 * Skips the first focus: the query has just fetched on mount, and refetching
 * immediately would double every screen's requests on open. staleTime still
 * applies to the AppState path, so this is the deliberate "I navigated here,
 * show me current data" trigger rather than a poll.
 */
export function useRefreshOnFocus(refetch: () => unknown): void {
  const firstFocus = useRef(true)
  useFocusEffect(
    useCallback(() => {
      if (firstFocus.current) {
        firstFocus.current = false
        return
      }
      refetch()
    }, [refetch]),
  )
}
