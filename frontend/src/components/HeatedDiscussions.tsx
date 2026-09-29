// "Heated discussions" — records people are actively writing about.
// PLAN_discussions.md §8. Mirror of mobile/components/HeatedDiscussions.
//
// Ordered by review activity rather than by disagreement: spread is a real
// signal but a slow-moving one, and a section that never changes stops being
// looked at. Disagreement survives as a tag instead.
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { fetchHeated } from '../api'
import type { HeatedRecord } from '../types'
import { Cover, COVER_LIFT } from './covers'
import { threadPath } from '../lib/threads'

const SECTION_LABEL = 'text-[11px] font-semibold uppercase tracking-[0.16em] text-[#a8998a] m-0'

// At most one of loved/hated can be true — they are opposite ends of the same
// average — so a card's tag row never needs to wrap for them.
const TONE: Record<string, { bg: string; fg: string }> = {
  controversial: { bg: 'rgba(192, 86, 58, 0.12)', fg: '#a8482f' },
  loved: { bg: 'rgba(45, 106, 79, 0.12)', fg: '#2d6a4f' },
  hated: { bg: 'rgba(192, 57, 43, 0.10)', fg: '#c0392b' },
  fresh: { bg: '#1c1917', fg: '#ffffff' },
}

export default function HeatedDiscussions() {
  const { data: records = [] } = useQuery({
    queryKey: ['heated'],
    queryFn: () => fetchHeated(10),
    retry: false,
  })

  if (records.length === 0) return null

  return (
    <section className="mb-9">
      <div className="flex items-baseline justify-between mb-4 gap-3.5">
        <h2 className={SECTION_LABEL}>Heated discussions</h2>
        <span className="text-[11px] text-[#b3a99c]">Right now</span>
      </div>
      {/* The page pads its content, so the rail bleeds back out and re-pads
          itself — cards run off the edge rather than stopping short.

          A horizontal scroller clips vertically too (overflow-x forces
          overflow-y off visible), and COVER_LIFT grows a cover ~16px past its
          box on every side — scale 1.13 plus a 3° tilt. So the track carries
          20px of room top and bottom for the lift to land in, and the scroller
          gives it back with a negative margin so the section's spacing is
          unchanged. */}
      <div className="-mx-4 md:-mx-8 -my-5 overflow-x-auto">
        <div className="flex gap-4 px-5 md:px-8 py-5">
          {records.map((r) => (
            <Card key={r.subjectKey} record={r} />
          ))}
        </div>
      </div>
    </section>
  )
}

function Card({ record: r }: { record: HeatedRecord }) {
  return (
    <Link
      to={threadPath('album', r.artist, r.albumName)}
      className="group shrink-0 w-[168px] no-underline"
    >
      <div className={COVER_LIFT} style={{ willChange: 'transform' }}>
        <Cover artUrl={r.albumArtUrl} seed={r.artist ?? r.albumName} size={168} radius={14} fontSize={52} />
      </div>
      <p className="m-0 mt-2.5 text-[14px] font-bold text-[#1c1917] truncate">{r.albumName}</p>
      <p className="m-0 mt-0.5 text-[12px] text-[#8a7f72] truncate">{r.artist ?? ''}</p>
      <div className="flex flex-wrap items-center gap-1.5 mt-2">
        {r.controversial && <Tag label="CONTROVERSIAL" tone={TONE.controversial} />}
        {r.loved && <Tag label="LOVED" tone={TONE.loved} />}
        {r.hated && <Tag label="HATED" tone={TONE.hated} />}
        {r.isNew && <Tag label="NEW" tone={TONE.fresh} />}
        <span className="text-[11px] font-medium text-[#a8998a] tabular-nums">
          {r.reviewCount} {r.reviewCount === 1 ? 'review' : 'reviews'}
        </span>
      </div>
    </Link>
  )
}

function Tag({ label, tone }: { label: string; tone: { bg: string; fg: string } }) {
  return (
    <span
      className="px-[7px] py-[3px] rounded text-[9px] font-bold tracking-[0.07em]"
      style={{ backgroundColor: tone.bg, color: tone.fg }}
    >
      {label}
    </span>
  )
}
