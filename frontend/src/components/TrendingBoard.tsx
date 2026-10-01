// "Trending on Pressd" on For You — the records the whole userbase rated most
// this week.
//
// A plain ranked list, as it always was: small rank, cover, record, how many
// rated it and when, the room's average. Brought in line with the rest of For
// You rather than redesigned — a soft panel instead of a bordered box, album
// titles in Playfair like every other album title, the shared cover lift, and
// rows that ease in. Nothing is singled out by rank; the order says it.
import type { CSSProperties } from 'react'
import type { TrendingAlbum } from '../api'
import { Cover, COVER_LIFT, ScorePill } from './covers'
import { timeAgo } from '../lib/format'

export default function TrendingBoard({
  rows,
  onOpen,
}: {
  rows: TrendingAlbum[]
  onOpen: (albumId: number) => void
}) {
  return (
    <ol className="m-0 list-none overflow-hidden rounded-[22px] bg-[#f2eee7]/70 p-1.5">
      {rows.map((row, i) => (
        <li key={row.album_id} className="rise-in" style={{ '--i': i } as CSSProperties}>
          {i > 0 && <div className="mx-4 h-px bg-[#e8e1d6]" />}
          <button
            type="button"
            onClick={() => onOpen(row.album_id)}
            className="group flex w-full items-center gap-4 rounded-[16px] px-3.5 py-3 text-left transition-colors hover:bg-[#ebe5db]"
          >
            <span className="font-display w-[22px] shrink-0 text-center text-[15px] font-bold tabular-nums text-[#c2b8ad]">
              {i + 1}
            </span>
            <div className={`shrink-0 ${COVER_LIFT}`} style={{ willChange: 'transform' }}>
              <Cover artUrl={row.album_art_url} seed={row.artist} size={58} radius={13} fontSize={24} />
            </div>
            <div className="min-w-0 flex-1">
              <p className="font-display m-0 truncate text-[16px] font-bold text-[#1c1917]">{row.album_name}</p>
              <p className="m-0 mt-0.5 truncate text-[12.5px] text-[#8a7f72]">{row.artist}</p>
            </div>
            <span className="hidden shrink-0 text-right text-[11.5px] text-[#8a7f72] tabular-nums sm:block" style={{ width: 118 }}>
              {row.rater_count} {row.rater_count === 1 ? 'rating' : 'ratings'}
              {row.last_rated ? ` · ${timeAgo(row.last_rated)}` : ''}
            </span>
            {row.avg_score != null && <ScorePill score={row.avg_score} />}
          </button>
        </li>
      ))}
    </ol>
  )
}
