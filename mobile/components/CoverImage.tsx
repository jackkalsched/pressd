// An album cover: asks the host for an image the size it's drawn at, and walks
// to a fallback address when one fails. The mobile twin of web's CoverImg —
// both go through shared/src/covers.ts, so the sizing rules live in one place.
//
// Size matters more here than on web: a phone decodes every image into memory
// at full resolution, so an 11 MB original drawn as a 48px row tile cost far
// more than its download. expo-image caches to disk by default; memory-disk
// keeps a scrolled-past grid from re-decoding when you scroll back.
import { useMemo, useState } from 'react'
import { Image, type ImageProps } from 'expo-image'
import { coverFallbacks, coverUrl } from '@pressd/shared/covers'

export default function CoverImage({
  url,
  displayPx,
  onError,
  ...rest
}: {
  url: string | null | undefined
  /** How wide the image is drawn, in points. */
  displayPx: number
} & Omit<ImageProps, 'source'>) {
  // The sized address first; then, for an Archive cover whose storage machine
  // has stopped answering, the stable Cover Art Archive addresses.
  const candidates = useMemo(
    () => (url ? [coverUrl(url, displayPx), ...coverFallbacks(url)] : []),
    [url, displayPx],
  )
  const [attempt, setAttempt] = useState(0)
  const [seen, setSeen] = useState(url)
  if (seen !== url) {
    setSeen(url)
    setAttempt(0)
  }
  if (candidates.length === 0) return null
  return (
    <Image
      contentFit="cover"
      cachePolicy="memory-disk"
      {...rest}
      // Past the last address there is nothing left to try: the source goes
      // empty and whatever sits behind the image shows through.
      source={attempt < candidates.length ? { uri: candidates[attempt] } : null}
      onError={(e) => {
        setAttempt((a) => a + 1)
        onError?.(e)
      }}
    />
  )
}
