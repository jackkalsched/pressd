// How alike your taste and someone else's is, on their profile (spec §5.1).
//
// One pill under their name, the same for a friend and a stranger: your two
// faces side by side, the number, and the records you have both rated — the
// first few covers and a count of the rest. Tapping the number compares the
// record that connects you; a cover compares that record. The reason's
// sentence rides along as the pill's tooltip, so the row stays one line. 50% is
// drawn like any other number: a pair with no evidence and a pair measured at
// the middle look the same on purpose.
import { Link } from 'react-router-dom'
import type { Overlap, TasteReason } from '../types'
import Avatar from './Avatar'
import { Cover, COVER_LIFT } from './covers'
import { GREEN } from './albumView'

// The server escapes every name it puts in `text` (html.escape, quote off) and
// wraps album titles in <i>; nothing else in it is markup. The text is only
// ever shown as plain text, so nothing in it can become markup.
const ENTITIES: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#x27;': "'", '&#39;': "'" }
const unescape = (s: string) => s.replace(/&(amp|lt|gt|quot|#x27|#39);/g, (m) => ENTITIES[m])

/** The reason as plain text, for a tooltip: the italics dropped, not rendered. */
const reasonPlain = (reason: TasteReason) => unescape(reason.text.replace(/<\/?i>/g, ''))

/** Where tapping the number goes: the record the reason names, else the one
 *  that connects you; null when there's no shared record. */
function compareAlbumId(overlap: Overlap): number | null {
  return overlap.reason?.albumId ?? overlap.connectingAlbum?.id ?? overlap.connectingAlbumId ?? null
}

type Face = { name: string; avatarUrl?: string | null }

/** Two faces overlapping, each ringed in the pill's own colour so the seam reads. */
function Faces({ me, them }: { me: Face; them: Face }) {
  return (
    <span className="flex shrink-0">
      {[me, them].map((f, i) => (
        <span key={i} className={`rounded-full bg-[#dfe9e2] p-[2px] ${i ? '-ml-3' : ''}`} style={{ zIndex: 2 - i }}>
          <Avatar name={f.name} avatarUrl={f.avatarUrl} size={34} />
        </span>
      ))}
    </span>
  )
}

export function OverlapPill({ overlap, me, them, onOpenLibrary }: {
  overlap: Overlap
  me: Face
  them: Face
  /** Where the number goes when you share no record: their library. */
  onOpenLibrary: () => void
}) {
  if (overlap.percent == null) return null
  const albumId = compareAlbumId(overlap)
  const covers = overlap.sharedRecords
  const more = overlap.sharedCount - covers.length
  const number = (
    <>
      <Faces me={me} them={them} />
      <span className="font-display ml-1 text-[26px] font-bold leading-none tabular-nums">{overlap.percent}%</span>
      <span className="text-[15px] font-semibold">taste overlap</span>
    </>
  )
  return (
    <div
      className="mt-4 inline-flex max-w-full items-center gap-3 rounded-full bg-[#dfe9e2] py-1.5 pl-1.5 pr-4 rise-in"
      style={{ color: GREEN }}
      title={overlap.reason ? reasonPlain(overlap.reason) : undefined}
    >
      {albumId != null ? (
        <Link to={`/album/${albumId}?view=compare`} className="flex items-center gap-2.5 no-underline" style={{ color: GREEN }}>
          {number}
        </Link>
      ) : (
        <button onClick={onOpenLibrary} className="flex cursor-pointer items-center gap-2.5 border-none bg-transparent p-0" style={{ color: GREEN }}>
          {number}
        </button>
      )}

      {covers.length > 0 && (
        <>
          <span aria-hidden className="h-7 w-px shrink-0 bg-[#2d6a4f]/25" />
          <span className="flex shrink-0 items-center">
            {covers.map((c, i) => (
              <Link
                key={c.id}
                to={`/album/${c.id}?view=compare`}
                title={c.name}
                className={`group block rounded-[9px] bg-[#dfe9e2] p-[2px] ${i ? '-ml-2.5' : ''}`}
                style={{ zIndex: covers.length - i }}
              >
                <div className={COVER_LIFT}>
                  <Cover artUrl={c.artUrl} seed={c.artist} size={36} radius={7} />
                </div>
              </Link>
            ))}
          </span>
          {more > 0 && <span className="shrink-0 text-[15px] font-semibold tabular-nums">+{more}</span>}
        </>
      )}
    </div>
  )
}
