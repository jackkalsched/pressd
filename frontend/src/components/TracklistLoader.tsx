// Shown after the user picks a search result, while the tracklist is fetched.
// Search results carry identity only, so there's a real gap (~250ms–2.5s
// depending on source) between the click and having something to rate — this
// fills it with the album they picked rather than a bare spinner.
import { useEffect, useState } from 'react'

/** "Loading tracklist" + a dot cycling 1→3, so the wait reads as live. */
function useEllipsis(): string {
  const [n, setN] = useState(1)
  useEffect(() => {
    const id = setInterval(() => setN((v) => (v % 3) + 1), 400)
    return () => clearInterval(id)
  }, [])
  return '.'.repeat(n)
}

export default function TracklistLoader({
  albumName,
  artist,
  coverUrl,
  compact = false,
}: {
  albumName: string
  artist: string
  coverUrl?: string | null
  /** Row-shaped variant for inline use inside an existing list. */
  compact?: boolean
}) {
  const dots = useEllipsis()
  // There's no byte-level progress to report, so the bar eases toward 90% and
  // holds — it never claims to be finished while a request is still open.
  const [width, setWidth] = useState(0)
  useEffect(() => {
    const id = requestAnimationFrame(() => setWidth(90))
    return () => cancelAnimationFrame(id)
  }, [])

  const art = coverUrl ? (
    <img src={coverUrl} alt="" className={`${compact ? 'w-12 h-12 rounded-lg' : 'w-40 h-40 rounded-2xl'} object-cover shrink-0`} />
  ) : (
    <div className={`${compact ? 'w-12 h-12 rounded-lg text-lg' : 'w-40 h-40 rounded-2xl text-5xl'} bg-[#e8e2d9] text-[#b0a090] shrink-0 flex items-center justify-center font-semibold`}>
      {albumName[0]?.toUpperCase()}
    </div>
  )

  const bar = (
    <div className={`${compact ? 'w-full' : 'w-64'} h-[5px] bg-[#efe9e0] rounded-full overflow-hidden`}>
      <div
        className="h-full bg-[#2d6a4f] rounded-full transition-[width] duration-[1600ms] ease-out"
        style={{ width: `${width}%` }}
      />
    </div>
  )

  // The dots sit in their own fixed-width slot so the label doesn't shuffle
  // left and right as they cycle.
  const label = (
    <p className="text-[#78716c] text-[13px] font-medium">
      Loading tracklist<span className="inline-block w-4 text-left">{dots}</span>
    </p>
  )

  if (compact) {
    return (
      <div className="flex items-center gap-3 py-3">
        {art}
        <div className="flex-1 min-w-0 flex flex-col gap-2">
          <div className="min-w-0">
            <p className="text-[#111] text-sm font-semibold truncate">{albumName}</p>
            <p className="text-[#aaa] text-xs truncate">{artist}</p>
          </div>
          {bar}
          {label}
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col items-center justify-center gap-5 py-10 text-center">
      {art}
      <div>
        <p className="text-[#111] text-xl font-semibold">{albumName}</p>
        <p className="text-[#78716c] text-sm mt-0.5">{artist}</p>
      </div>
      {bar}
      {label}
    </div>
  )
}
