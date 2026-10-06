// Album cover URLs, sized for where they're drawn.
//
// Covers come from three hosts, and every one of them will serve a smaller
// image than the one stored if you ask by URL:
//   - Deezer        …/1000x1000-000000-80-0-0.jpg   → any size up to 1000
//   - Apple         …/1000x1000bb.jpg               → any size up to 1000
//   - Internet Archive (Cover Art Archive storage)
//                   …/mbid-<release>-<image>.jpg     the uploaded original
//                   …-<image>_thumb250|500|1200.jpg  its thumbnails
// Stored URLs are 1000px (Deezer, Apple) or a 500px Archive thumbnail, which a
// 58px row tile doesn't need. Measured in October 2026: a Deezer cover went from
// 194 KB at 1000px to 24 KB at 250, an Apple one from 302 KB to 29 KB, and an
// Archive original from 5.4 MB to 55 KB as its 500px thumbnail.
//
// Archive URLs name one storage machine (dnNNNN.ca.archive.org,
// iaNNNNNN.us.archive.org) — the address the Cover Art Archive redirected to
// when the cover was saved. They load fastest (no redirect), but a machine can
// stop answering, so `coverFallbacks` offers the stable coverartarchive.org
// address, which routes to whichever machine is up.
//
// Domain-shaped, so it lives here and both apps call it (CLAUDE.md §12).

/** The pixel density covers are sized for. Every current screen that matters
 *  is 2x or better; 3x phones get a slightly soft tile rather than triple the
 *  bytes, which is the right trade at these sizes. */
const DENSITY = 2

/** The Archive only has fixed thumbnails, so take the smallest that covers
 *  `px` — allowing 10% short, which no one can see. Without the slack a 260px
 *  card on a 2x screen (520) jumped to the 1200 thumbnail, ~4x the bytes of
 *  the 500 that looks the same. */
function pick(px: number, sizes: number[]): number {
  return sizes.find((s) => s >= px * 0.9) ?? sizes[sizes.length - 1]
}

/** Deezer and Apple render any size asked for. Round up to the next 50 so a
 *  handful of sizes, not one per layout, end up in their caches and ours. */
function exact(px: number, max = 1000): number {
  return Math.min(max, Math.max(100, Math.ceil(px / 50) * 50))
}

const DEEZER = /^(https:\/\/[^/]*dzcdn\.net\/images\/cover\/[0-9a-f]+\/)\d+x\d+(-.*)$/
const APPLE = /^(https:\/\/[^/]*mzstatic\.com\/image\/thumb\/.+\/)\d+x\d+bb\.(?:jpg|png|webp)$/
const ARCHIVE = /^(https:\/\/[a-z0-9.-]+\.archive\.org\/\d+\/items\/mbid-([0-9a-f-]{36})\/mbid-\2-\d+)(?:_thumb\d+)?\.(?:jpe?g|png)$/
const CAA = /^(https:\/\/coverartarchive\.org\/release(?:-group)?\/[0-9a-f-]{36}\/(?:front|back|\d+))(?:-(?:250|500|1200))?(?:\.jpg)?$/

/** `url` resized for an image drawn `displayPx` CSS pixels wide. Unknown hosts,
 *  data URIs and null pass through untouched. */
export function coverUrl<T extends string | null | undefined>(url: T, displayPx: number): T {
  if (!url) return url
  const px = displayPx * DENSITY
  let m = url.match(DEEZER)
  if (m) {
    const s = exact(px)
    return `${m[1]}${s}x${s}${m[2]}` as T
  }
  m = url.match(APPLE)
  if (m) {
    const s = exact(px)
    return `${m[1]}${s}x${s}bb.jpg` as T
  }
  m = url.match(ARCHIVE)
  if (m) return `${m[1]}_thumb${pick(px, [250, 500, 1200])}.jpg` as T
  m = url.match(CAA)
  if (m) return `${m[1]}-${pick(px, [250, 500, 1200])}` as T
  return url
}

/** Addresses to try, in order, when `url` fails to load. Only Archive covers
 *  have any: the stable Cover Art Archive address for the release's front
 *  cover at 500px, then the front cover at whatever size it was uploaded. */
export function coverFallbacks(url: string | null | undefined): string[] {
  const m = url?.match(ARCHIVE)
  if (!m) return []
  const release = `https://coverartarchive.org/release/${m[2]}`
  return [`${release}/front-500`, `${release}/front`]
}
