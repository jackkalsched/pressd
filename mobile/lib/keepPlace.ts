// Keeps a page where it was when a control swaps what's under it — a profile's
// Library / Stats / Rankings / Bins (November 2026). Switching to or from the
// Library rebuilds the list (a grid and a list are different FlatLists), which
// threw the page back to the top; a shorter tab also clamped it. So: remember
// the offset as the page scrolls, and on a switch hold a floor under the
// content (that offset plus a screen) and scroll back to it once the new tab
// has drawn. The floor goes once the page is back near the top.
import { useCallback, useRef, useState, type RefObject } from 'react'
import { Dimensions, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native'

type Scrollable = { scrollToOffset?: (p: { offset: number; animated?: boolean }) => void }

export function useKeepPlace(listRef: RefObject<unknown>) {
  const offset = useRef(0)
  const pending = useRef<number | null>(null)
  const floorOn = useRef(false)
  const [floor, setFloor] = useState(0)

  const track = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    offset.current = e.nativeEvent.contentOffset.y
    if (floorOn.current && offset.current < 40 && pending.current == null) {
      floorOn.current = false
      setFloor(0)
    }
  }, [])

  /** Run `change` (the tab switch) without the page moving. */
  const keep = useCallback((change: () => void) => {
    pending.current = offset.current
    floorOn.current = true
    setFloor(offset.current + Dimensions.get('window').height)
    change()
  }, [])

  const onContentSizeChange = useCallback(() => {
    const y = pending.current
    if (y == null) return
    pending.current = null
    requestAnimationFrame(() => (listRef.current as Scrollable | null)?.scrollToOffset?.({ offset: y, animated: false }))
  }, [listRef])

  return { track, keep, onContentSizeChange, floor }
}
