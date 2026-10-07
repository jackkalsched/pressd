// "Heated discussions" — records people are actively writing about.
// PLAN_discussions.md §8. Mirror of mobile/components/HeatedDiscussions.
//
// Ordered by review activity rather than by disagreement: spread is a real
// signal but a slow-moving one, and a section that never changes stops being
// looked at.
//
// Each card shows how the room feels rather than labelling it. It used to carry
// small text tags (LOVED / CONTROVERSIAL); now the verdict is something you see
// before you read anything:
//   - a badge with no words: crossed swords for a divided room, otherwise a
//     face — laughing (loved), angry (hated), meh (lukewarm);
//   - a glow under the cover in the verdict's colour — split red-to-green for a
//     room that can't agree, so a divided record looks torn;
//   - a "room meter": the 1–10 scale with a band over where the room's scores
//     actually fall (the mean ± one standard deviation), and a dot at the mean.
//     Loved is a tight green band on the right, hated a red one on the left,
//     divided a long red-to-green streak across the middle.
// The verdicts are the server's flags (discover.py: LOVED_MEAN, HATED_MEAN,
// CONTROVERSIAL_SPREAD), so the two platforms can't disagree on what counts.
import type { CSSProperties } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Angry, Laugh, Meh, Swords, type LucideIcon } from 'lucide-react'
import { fetchHeated } from '../api'
import type { HeatedRecord } from '../types'
import { songScoreColor } from '../types'
import { Cover, COVER_LIFT } from './covers'
import { threadPath } from '../lib/threads'

const SECTION_LABEL = 'text-[11px] font-semibold uppercase tracking-[0.16em] text-[#a8998a] m-0'

const GREEN = '#2d6a4f'
const RED = '#c0392b'

type Verdict = 'divided' | 'loved' | 'hated' | 'lukewarm'

const VERDICTS: Record<Verdict, { label: string; icon: LucideIcon; ink: string; glow: string; pill: string }> = {
  // A room that can't agree is the better story than where its average lands,
  // so divided wins when a record is also loved or hated. Its pill and glow run
  // red into green — the record looks pulled both ways.
  divided: {
    label: 'Divided', icon: Swords, ink: '#a8482f',
    glow: `linear-gradient(90deg, ${RED}, #d9a03b, ${GREEN})`,
    pill: `linear-gradient(90deg, ${RED}, #c47a2c 50%, ${GREEN})`,
  },
  // The rest are the room's face.
  loved: { label: 'Loved', icon: Laugh, ink: GREEN, glow: `linear-gradient(90deg, #3f8a63, ${GREEN})`, pill: GREEN },
  hated: { label: 'Hated', icon: Angry, ink: RED, glow: `linear-gradient(90deg, ${RED}, #a8482f)`, pill: RED },
  lukewarm: { label: 'Lukewarm', icon: Meh, ink: '#9a7b2f', glow: 'linear-gradient(90deg, #d9b25b, #c9a24a)', pill: '#b08a2e' },
}

function verdictOf(r: HeatedRecord): Verdict {
  if (r.controversial) return 'divided'
  if (r.loved) return 'loved'
  if (r.hated) return 'hated'
  return 'lukewarm'
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
          overflow-y off visible), and COVER_LIFT nudges a cover a few pixels
          past its box — scale 1.04 plus a 1° lean — while the glow under it
          spreads further still. So the track carries 20px of room top and
          bottom, and the scroller gives it back with a negative margin so the
          section's spacing is unchanged. */}
      <div className="-mx-4 md:-mx-8 -my-5 overflow-x-auto">
        <div className="flex gap-5 px-5 md:px-8 py-5">
          {records.map((r, i) => (
            <Card key={r.subjectKey} record={r} index={i} />
          ))}
        </div>
      </div>
    </section>
  )
}

function Card({ record: r, index }: { record: HeatedRecord; index: number }) {
  const v = VERDICTS[verdictOf(r)]
  const Icon = v.icon

  return (
    <Link
      to={threadPath('album', r.artist, r.albumName)}
      className="rise-in group shrink-0 w-[184px] no-underline"
      style={{ '--i': index } as CSSProperties}
      aria-label={`${r.albumName}${r.artist ? ` by ${r.artist}` : ''}: ${v.label.toLowerCase()}${r.meanScore != null ? `, room average ${r.meanScore.toFixed(2)}` : ''}, ${r.reviewCount} ${r.reviewCount === 1 ? 'review' : 'reviews'}`}
    >
      <div className="relative">
        {/* The verdict as light: a blurred wash under the cover that warms up
            when you reach for the card. Inset well inside the card, because the
            rail scrolls and a scroller clips a wider glow into a hard edge. */}
        <div
          aria-hidden
          className="absolute inset-x-5 -bottom-2 h-16 rounded-full opacity-70 blur-xl transition-opacity duration-300 group-hover:opacity-100"
          style={{ background: v.glow }}
        />
        <div className={`relative ${COVER_LIFT}`} style={{ willChange: 'transform' }}>
          <Cover artUrl={r.albumArtUrl} seed={r.artist ?? r.albumName} size={184} radius={16} fontSize={56} />
          {/* The verdict's word lives in the card's aria-label and the tooltip;
              the badge itself is just the face. */}
          <span
            title={v.label}
            className="absolute left-2 top-2 flex h-8 w-8 items-center justify-center rounded-full text-white shadow-[0_4px_12px_-4px_rgba(0,0,0,0.5)] transition-transform duration-300 ease-out group-hover:scale-[1.04]"
            style={{ background: v.pill }}
          >
            <Icon size={18} strokeWidth={2.4} />
          </span>
          {r.isNew && (
            <span className="absolute right-2 top-2 rounded-full bg-[#1c1917] px-2 py-[3px] text-[9.5px] font-bold tracking-[0.08em] text-white">
              NEW
            </span>
          )}
        </div>
      </div>

      <p className="m-0 mt-3.5 text-[14px] font-bold text-[#1c1917] truncate">{r.albumName}</p>
      <p className="m-0 mt-0.5 text-[12px] text-[#8a7f72] truncate">{r.artist ?? ''}</p>

      {r.meanScore != null && <RoomMeter mean={r.meanScore} spread={r.spread} index={index} />}

      <div className="mt-2 flex items-center gap-2 text-[11px] font-medium text-[#a8998a] tabular-nums">
        {r.recentReviews > 0 && (
          // Live: reviews landed in the last few days.
          <span className="flex items-center gap-1.5 font-semibold" style={{ color: v.ink }}>
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full rounded-full opacity-60 animate-ping motion-reduce:animate-none" style={{ background: v.ink }} />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full" style={{ background: v.ink }} />
            </span>
            {r.recentReviews} new
          </span>
        )}
        <span>{r.reviewCount} {r.reviewCount === 1 ? 'review' : 'reviews'}</span>
      </div>
    </Link>
  )
}

/** Where the room's scores fall on the 1–10 scale: a band from mean − spread
 *  to mean + spread, coloured end to end by the scores at its edges, with a dot
 *  at the mean and the mean itself beside it. The band grows out from the
 *  mean when the rail first appears. */
function RoomMeter({ mean, spread, index }: { mean: number; spread: number; index: number }) {
  const pos = (s: number) => ((Math.min(10, Math.max(1, s)) - 1) / 9) * 100
  const lo = Math.max(1, mean - spread)
  const hi = Math.min(10, mean + spread)
  // A room in perfect agreement still needs a band you can see.
  const left = Math.min(pos(lo), pos(mean) - 3)
  const width = Math.max(pos(hi) - pos(lo), 6)

  return (
    <div className="mt-2.5 flex items-center gap-2.5">
      <div className="relative h-2.5 flex-1">
        <div className="absolute inset-0 rounded-full bg-[#ece6dc]" />
        <div
          className="grow-x absolute inset-y-0 rounded-full transition-[filter] duration-300 group-hover:brightness-110"
          style={{
            left: `${Math.max(0, left)}%`,
            width: `${Math.min(width, 100 - Math.max(0, left))}%`,
            background: `linear-gradient(90deg, ${songScoreColor(lo)}, ${songScoreColor(hi)})`,
            boxShadow: `0 0 12px 0 ${songScoreColor(mean)}`,
            transformOrigin: `${((pos(mean) - Math.max(0, left)) / width) * 100}% 50%`,
            '--i': index,
          } as CSSProperties}
        />
        <div
          className="absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-[3px] bg-white transition-transform duration-300 ease-out group-hover:scale-110"
          style={{ left: `${pos(mean)}%`, borderColor: songScoreColor(mean), boxShadow: `0 0 8px 1px ${songScoreColor(mean)}` }}
        />
      </div>
      <span className="font-display text-[17px] font-bold tabular-nums" style={{ color: songScoreColor(mean) }}>
        {mean.toFixed(2)}
      </span>
    </div>
  )
}
