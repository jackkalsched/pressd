// How alike your taste and someone else's is, on their profile (spec §5.1).
//
// Two shapes, by relationship. Someone you aren't friends with yet gets the
// panel: the number, where it sits on 0–100, the record that connects you, and
// the two things worth doing about it — add them, or compare that record. A
// friend gets only the chip and its line, because the case for adding them has
// already been made. 50% is drawn like any other number: a pair with no
// evidence and a pair measured at the middle look the same on purpose.
import { Fragment, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Clock, Loader2, UserPlus } from 'lucide-react'
import type { Overlap, TasteReason } from '../types'
import { Cover, COVER_LIFT } from './covers'
import { GREEN, SECTION_LABEL } from './albumView'

/** The profile's quieter button (its Settings button), sized to Add friend. */
const SECONDARY =
  'flex items-center rounded-xl border border-[#e2dbd0] bg-white px-5 py-2.5 text-sm font-semibold text-[#2d6a4f] transition-colors hover:border-[#2d6a4f]'

// The server escapes every name it puts in `text` (html.escape, quote off) and
// wraps album titles in <i>; nothing else in it is markup.
const ENTITIES: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#x27;': "'", '&#39;': "'" }
const unescape = (s: string) => s.replace(/&(amp|lt|gt|quot|#x27|#39);/g, (m) => ENTITIES[m])

/** The reason's sentence with its album titles in italics. Only the literal
 *  `<i>…</i>` pairs become elements; every other character is text, so a
 *  record called "<b>" can't become markup. */
export function ReasonText({ reason }: { reason: TasteReason }) {
  const parts: ReactNode[] = []
  const re = /<i>(.*?)<\/i>/g
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(reason.text)) !== null) {
    if (m.index > last) parts.push(unescape(reason.text.slice(last, m.index)))
    parts.push(<i key={m.index}>{unescape(m[1])}</i>)
    last = re.lastIndex
  }
  if (last < reason.text.length) parts.push(unescape(reason.text.slice(last)))
  return <>{parts.map((p, i) => <Fragment key={i}>{p}</Fragment>)}</>
}

/** 0 on the left, 100 on the right, a mark where you two sit. */
function Meter({ percent }: { percent: number }) {
  const at = Math.max(0, Math.min(100, percent))
  return (
    <div>
      <div className="relative h-2 rounded-full bg-[#2d6a4f]/15">
        <div className="grow-x absolute inset-y-0 left-0 rounded-full bg-[#2d6a4f]/45" style={{ width: `${at}%` }} />
        <span
          className="absolute top-1/2 h-4 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full"
          style={{ left: `${at}%`, background: GREEN }}
        />
      </div>
      <div className="mt-1.5 flex justify-between text-[11px] tabular-nums text-[#8a7f72]">
        <span>0</span><span>50</span><span>100</span>
      </div>
    </div>
  )
}

/** Where Compare goes: the record the reason names, else the one that
 *  connects you; null when there's no shared record. */
function compareAlbumId(overlap: Overlap): number | null {
  return overlap.reason?.albumId ?? overlap.connectingAlbum?.id ?? overlap.connectingAlbumId ?? null
}

export function OverlapPanel({ overlap, person, onAdd, requested, theyAsked = false, busy = false, onOpenLibrary }: {
  overlap: Overlap
  person: { name: string }
  onAdd: () => void
  requested: boolean
  theyAsked?: boolean
  busy?: boolean
  /** Compare's destination when you share no record: their library. */
  onOpenLibrary: () => void
}) {
  if (overlap.percent == null) return null
  const albumId = compareAlbumId(overlap)
  const record = overlap.connectingAlbum
  return (
    <section className="mt-6 grid gap-x-10 gap-y-5 rounded-[24px] border border-[#e8e2d9] bg-white/70 px-5 py-5 md:grid-cols-[auto_minmax(0,1fr)_auto] md:items-center md:px-7 rise-in">
      <div>
        <p className={SECTION_LABEL}>YOU &amp; {person.name.toUpperCase()}</p>
        <p className="font-display m-0 mt-1 text-[56px] font-bold leading-none tabular-nums" style={{ color: GREEN }}>
          {overlap.percent}%
        </p>
      </div>

      <div className="min-w-0">
        <Meter percent={overlap.percent} />
        {(overlap.reason || record) && (
          <div className="mt-4 flex items-center gap-3.5">
            {record && (
              <Link to={`/album/${record.id}`} className="group shrink-0" aria-label={`Open ${record.name}`}>
                <div className={COVER_LIFT}>
                  <Cover artUrl={record.artUrl} seed={record.artist} size={48} radius={10} />
                </div>
              </Link>
            )}
            {overlap.reason && (
              <p className="m-0 min-w-0 text-[15px] leading-snug text-[#4a423a]">
                <ReasonText reason={overlap.reason} />
              </p>
            )}
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2.5">
        <button
          onClick={onAdd}
          disabled={busy || requested}
          className={`flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold transition-[background-color,transform,box-shadow] duration-200 ease-out disabled:opacity-60 ${
            requested
              ? 'bg-[#2d6a4f]/10 text-[#2d6a4f]'
              : 'bg-[#2d6a4f] text-white shadow-[0_10px_24px_-10px_rgba(45,106,79,0.75)] hover:bg-[#245c43] hover:-translate-y-px'
          }`}
        >
          {busy ? <Loader2 size={15} className="animate-spin" /> : requested ? <Clock size={15} /> : <UserPlus size={16} />}
          {requested ? 'Requested' : theyAsked ? 'Accept request' : 'Add friend'}
        </button>
        {albumId != null ? (
          <Link to={`/album/${albumId}?view=compare`} className={SECONDARY}>Compare</Link>
        ) : (
          <button onClick={onOpenLibrary} className={SECONDARY}>Compare</button>
        )}
      </div>
    </section>
  )
}

/** A friend's profile: the number as a chip, then the line. */
export function OverlapChip({ overlap }: { overlap: Overlap }) {
  if (overlap.percent == null) return null
  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 rise-in">
      <span className="inline-flex items-baseline gap-1.5 rounded-full bg-[#2d6a4f]/10 px-3 py-1 text-[13px] font-semibold text-[#2d6a4f]">
        <span className="font-display text-[17px] font-bold tabular-nums">{overlap.percent}%</span>
        taste overlap
      </span>
      {overlap.reason && (
        <span className="text-[14.5px] text-[#57534e]">
          <ReasonText reason={overlap.reason} />
        </span>
      )}
    </div>
  )
}
