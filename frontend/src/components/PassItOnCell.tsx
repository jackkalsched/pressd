// "Pass it on" — one of your favourites and a friend the model expects to love
// it; a click opens the Recommend dialog with both already chosen.
//
// The web port of mobile/components/PassItOnCell.tsx. Same recommendation
// orange and the same words; the layout is the For You feed's card rather than
// mobile's, the way every surface differs per platform.
//
// The friend's predicted score never reaches the client, so there is no number
// to show for them. "Would probably love it" is the whole claim; your own score
// is yours, and it stays.
import { ArrowRight, Send } from 'lucide-react'
import type { RecommendSuggestion } from '../api'
import { songScoreColor } from '../types'
import { Cover, COVER_LIFT } from './covers'
import Avatar from './Avatar'

export default function PassItOnCell({
  suggestion,
  onClick,
}: {
  suggestion: RecommendSuggestion
  onClick: () => void
}) {
  const { album, friend } = suggestion
  const firstName = friend.name.split(' ')[0] || friend.name

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`Pass it on: recommend ${album.albumName}, which you rated ${album.score.toFixed(1)}, to ${friend.name}`}
      className="rise-in group w-full text-left flex items-center gap-4 rounded-[18px] border border-[#fbd5b5] p-4 mb-7 transition-[border-color,transform,box-shadow] hover:border-[#f97316] hover:-translate-y-0.5 hover:shadow-[0_10px_24px_-14px_rgba(194,65,12,0.45)]"
      style={{ background: 'linear-gradient(100deg,#fff4ea,#faf8f5 55%)' }}
    >
      <div className={COVER_LIFT}>
        <Cover artUrl={album.albumArtUrl} seed={album.artist} size={68} radius={14} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="m-0 mb-0.5 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-[#c2410c]">
          <Send size={11} strokeWidth={2.6} /> Pass it on
        </p>
        <p className="m-0 font-bold text-[16px] truncate" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
          {album.albumName}
        </p>
        <p className="m-0 mt-0.5 text-[12.5px] text-[#8a7f72] truncate">
          {album.artist} · you rated it{' '}
          <span className="font-bold" style={{ color: songScoreColor(album.score) }}>{album.score.toFixed(1)}</span>
        </p>
        <p className="m-0 mt-1.5 flex items-center gap-1.5 text-[13px] text-[#57534e] truncate">
          <Avatar name={friend.name} avatarUrl={friend.avatarUrl} size={18} />
          <span className="truncate"><span className="font-bold text-[#1c1917]">{firstName}</span> would probably love it</span>
        </p>
      </div>
      <span
        className="shrink-0 rounded-[11px] bg-[#f97316] group-hover:bg-[#ea6c0a] text-white px-5 py-2.5 text-[13px] font-bold transition-colors flex items-center gap-1.5"
        style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}
      >
        Recommend <ArrowRight size={15} />
      </span>
    </button>
  )
}
