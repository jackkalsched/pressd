// An album cover <img>: asks the host for an image the size it's drawn at,
// loads lazily, and walks to a fallback address when one fails.
//
// Every album cover on web goes through this (or through covers.tsx's Cover,
// which uses it), so the sizing rules live in one place — shared/src/covers.ts,
// which mobile's CoverImage calls too. The share card is the exception: it is
// rasterised to a PNG and wants the stored full-size image.
import { useMemo, useState, type ImgHTMLAttributes } from 'react'
import { coverFallbacks, coverUrl } from '@pressd/shared/covers'

export default function CoverImg({
  url,
  displayPx,
  onError,
  style,
  loading = 'lazy',
  ...rest
}: {
  url: string | null | undefined
  /** How wide the image is drawn, in CSS pixels. */
  displayPx: number
} & Omit<ImgHTMLAttributes<HTMLImageElement>, 'src'>) {
  // The sized address first; then, for an Archive cover whose storage machine
  // has stopped answering, the stable Cover Art Archive addresses.
  const candidates = useMemo(
    () => (url ? [coverUrl(url, displayPx), ...coverFallbacks(url)] : []),
    [url, displayPx],
  )
  const [attempt, setAttempt] = useState(0)
  const [seen, setSeen] = useState(url)
  if (seen !== url) {
    // A new cover starts again from its first address.
    setSeen(url)
    setAttempt(0)
  }

  if (candidates.length === 0) return null
  const exhausted = attempt >= candidates.length
  return (
    <img
      {...rest}
      src={candidates[Math.min(attempt, candidates.length - 1)]}
      loading={loading}
      decoding="async"
      // Every address failed: keep the box (so layouts don't jump) and let the
      // placeholder behind it show, rather than the browser's broken-image mark.
      style={exhausted ? { ...style, visibility: 'hidden' } : style}
      onError={(e) => {
        setAttempt((a) => a + 1)
        onError?.(e)
      }}
    />
  )
}
