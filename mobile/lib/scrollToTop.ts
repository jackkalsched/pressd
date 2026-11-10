// A page's title takes you back to the top of the page, on every screen that
// scrolls: the big title in the masthead, and the compact title in the bar that
// fades in once the masthead has scrolled away.
//
// The compact bar is drawn over the top of the page at every scroll position,
// faded out while the masthead shows. A transparent view still catches taps, so
// a bar that accepts them must stop while it is invisible, or it blocks what is
// under it — the masthead's own back and search controls. `useCompactBar`
// gives the bar its pointerEvents from the same scroll event that drives the
// fade (the genre page's pattern, made shared), and moves state only when the
// answer changes, since it runs every frame.
import { useCallback, useRef, useState, type RefObject } from 'react'
import type { NativeScrollEvent, NativeSyntheticEvent } from 'react-native'
import { selection } from './haptics'

type Scrollable = {
  scrollToOffset?: (p: { offset: number; animated?: boolean }) => void
  scrollTo?: (p: { x?: number; y?: number; animated?: boolean }) => void
  getScrollResponder?: () => { scrollTo?: (p: { x?: number; y?: number; animated?: boolean }) => void } | null | undefined
}

/** Scroll a ScrollView, FlatList or SectionList (Animated or not) to its top. */
export function scrollToTop(ref: RefObject<unknown>): void {
  const r = ref.current as Scrollable | null
  if (!r) return
  selection()
  if (r.scrollToOffset) r.scrollToOffset({ offset: 0, animated: true })
  else if (r.scrollTo) r.scrollTo({ y: 0, animated: true })
  else r.getScrollResponder?.()?.scrollTo?.({ y: 0, animated: true })
}

/** Whether the compact bar is showing — so it may take taps — and the scroll
 *  listener that keeps it current. `at` is where the bar's fade begins. */
export function useCompactBar(at: number) {
  const [live, setLive] = useState(false)
  const liveRef = useRef(false)
  const track = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const now = e.nativeEvent.contentOffset.y >= at
    if (now !== liveRef.current) {
      liveRef.current = now
      setLive(now)
    }
  }, [at])
  return { live, track, pointerEvents: (live ? 'box-none' : 'none') as 'box-none' | 'none' }
}
