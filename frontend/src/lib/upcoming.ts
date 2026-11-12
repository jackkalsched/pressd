// Release-date wording for records not out yet — the Upcoming page and the
// album pages of a record added from it. Mobile has the same lines in
// app/upcoming.tsx and app/album/[id].tsx; change both.

/** "2026-11-13" read as a local calendar day, never shifted by the time zone. */
export function localDay(iso: string): Date {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  return new Date(y, m - 1, d)
}

/** "today", "tomorrow" or "in N days". */
export function untilText(iso: string): string {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const n = Math.round((localDay(iso).getTime() - today.getTime()) / 86_400_000)
  return n <= 0 ? 'today' : n === 1 ? 'tomorrow' : `in ${n} days`
}

/** "Out Friday, November 14 · in 2 days". */
export function outLine(iso: string): string {
  const when = localDay(iso).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
  return `Out ${when} · ${untilText(iso)}`
}

/** The community page by name for a record on the Upcoming list, carrying its
 *  date and cover for a record no catalog knows much about yet. */
export function upcomingAlbumPath(r: {
  title: string
  artist: string
  releaseDate: string
  deezerId: number | null
  coverUrl: string | null
}): string {
  const qs = new URLSearchParams({ name: r.title, artist: r.artist, release: r.releaseDate })
  if (r.deezerId != null) qs.set('deezer', String(r.deezerId))
  if (r.coverUrl) qs.set('cover', r.coverUrl)
  return `/album/community?${qs}`
}
