import type { CSSProperties } from 'react'
// Presentation helpers with no markup of their own.
//
// Split from the Avatar component rather than sharing a file with it so fast
// refresh keeps working — a module that exports both a component and a plain
// function loses it, which is what react-refresh/only-export-components is
// warning about in covers.tsx.

/** Relative time at minute granularity. Conversations move faster than the
 *  day-level feeds do, so "3m ago" has to be sayable. */
export function timeAgo(dateStr?: string | null): string {
  if (!dateStr) return ''
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days === 1) return '1 day ago'
  if (days < 30) return `${days} days ago`
  const months = Math.floor(days / 30)
  if (months === 1) return '1 month ago'
  return `${months} months ago`
}

/** Stable colour per name, so someone without a photo keeps the same one
 *  wherever they appear. */
export function avatarColor(name: string): string {
  const colors = ['#2d6a4f', '#1d4ed8', '#7c3aed', '#b45309', '#0f766e', '#be185d', '#c2410c']
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % colors.length
  return colors[h]
}

/** The `--i` the motion classes in index.css (rise-in, grow-x) stagger by. */
export function stagger(i: number): CSSProperties {
  return { '--i': i } as CSSProperties
}
