// How alike your taste and someone else's is, on their profile (spec §5.1). The
// web twin of mobile/components/TasteOverlap.tsx.
//
// A small outlined pill under their name, the same for a friend and a stranger:
// your own face, then the number with "taste overlap" — theirs is already at the
// top of the page. A figure to read, not a control. Until November 2026 it was
// a filled pill with both faces and the shared records' covers, each a link to
// compare, which made the header look crowded. The reason's sentence rides
// along as its tooltip. 50% is drawn like any other number: a pair with no
// evidence and a pair measured at the middle look the same on purpose.
import type { Overlap, TasteReason } from '../types'
import { overlapScore, songScoreColor } from '../types'
import Avatar from './Avatar'

// The server escapes every name it puts in `text` (html.escape, quote off) and
// wraps album titles in <i>; nothing else in it is markup. The text is only
// ever shown as plain text, so nothing in it can become markup.
const ENTITIES: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#x27;': "'", '&#39;': "'" }
const unescape = (s: string) => s.replace(/&(amp|lt|gt|quot|#x27|#39);/g, (m) => ENTITIES[m])

/** The reason as plain text, for a tooltip: the italics dropped, not rendered. */
const reasonPlain = (reason: TasteReason) => unescape(reason.text.replace(/<\/?i>/g, ''))

type Face = { name: string; avatarUrl?: string | null }

export function OverlapPill({ overlap, me }: { overlap: Overlap; me: Face }) {
  if (overlap.percent == null) return null
  return (
    <div
      className="mt-4 inline-flex items-center gap-2.5 rounded-full border border-(--c-e8e2d9) py-1 pl-1 pr-4 rise-in"
      title={overlap.reason ? reasonPlain(overlap.reason) : undefined}
    >
      <Avatar name={me.name} avatarUrl={me.avatarUrl} size={30} />
      <span className="font-display text-[24px] font-bold leading-none tabular-nums" style={{ color: songScoreColor(overlapScore(overlap.percent)) }}>{overlap.percent}%</span>
      <span className="text-[14px] font-medium text-(--c-8a7f72)">taste overlap</span>
    </div>
  )
}
