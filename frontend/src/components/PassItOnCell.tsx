// "Pass it on" — one of your favourites and a friend the model expects to love
// it; a click opens the Recommend dialog with both already chosen.
//
// The web port of mobile/components/PassItOnCell.tsx: the same recommendation
// orange and the same words, drawn as a SpotlightCard so it sits as a pair
// with the resume card beside it. The friend's face rides on the cover — the
// record and the person it's for, in one picture.
//
// The friend's predicted score never reaches the client, so there is no number
// to show for them. "Would probably love it" is the whole claim; your own score
// is yours, and it stays.
import { Send } from 'lucide-react'
import type { RecommendSuggestion } from '../api'
import { songScoreColor } from '../types'
import Avatar from './Avatar'
import SpotlightCard from './SpotlightCard'

export default function PassItOnCell({
  suggestion,
  onClick,
  index,
}: {
  suggestion: RecommendSuggestion
  onClick: () => void
  index?: number
}) {
  const { album, friend } = suggestion
  const firstName = friend.name.split(' ')[0] || friend.name

  return (
    <SpotlightCard
      tone="orange"
      index={index}
      onClick={onClick}
      ariaLabel={`Pass it on: recommend ${album.albumName}, which you rated ${album.score.toFixed(2)}, to ${friend.name}`}
      eyebrow={<><Send size={11} strokeWidth={2.6} /> Pass it on</>}
      title={album.albumName}
      artUrl={album.albumArtUrl}
      seed={album.artist}
      action="Recommend"
      badge={<Avatar name={friend.name} avatarUrl={friend.avatarUrl} size={34} />}
    >
      <p className="m-0 mt-1 text-[13px] text-[#78716c] truncate">
        {album.artist} · you rated it{' '}
        <span className="font-bold tabular-nums" style={{ color: songScoreColor(album.score) }}>{album.score.toFixed(2)}</span>
      </p>
      <p className="m-0 mt-1 text-[14px] text-[#57534e] truncate">
        <span className="font-bold text-[#1c1917]">{firstName}</span> would probably love it
      </p>
    </SpotlightCard>
  )
}
