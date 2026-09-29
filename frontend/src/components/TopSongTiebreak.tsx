// Asked once, at the end of rating an album, when more than one track shares
// the album's highest score. The web twin of mobile/components/TopSongTiebreak.
//
// Everything downstream that names a "top song" — the review feed, the share
// card — has to pick one, and without this it took whichever tied track
// happened to sort first. That is a coin toss the person who did the rating is
// far better placed to call, so it is called here, while the record is fresh.
//
// "I can't choose" is a real answer: it leaves the pick unset and everything
// falls back to the highest-score behaviour.
import { useEffect } from 'react'
import { Loader2, Star } from 'lucide-react'
import type { Song } from '../types'
import { songScoreColor } from '../types'

/** "both these songs" reads wrong the moment a third track ties. */
function countPhrase(n: number): string {
  return n === 2 ? 'both these songs' : `all ${n} of these songs`
}

export default function TopSongTiebreak({
  songs,
  score,
  busy,
  onPick,
  onSkip,
}: {
  songs: Song[]
  score: number
  busy: boolean
  onPick: (songId: number) => void
  onSkip: () => void
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onSkip() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [busy, onSkip])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-[#1c1917]/45 fade-in" />
      <div className="relative w-full max-w-[440px] bg-[#faf8f5] rounded-3xl px-6 pt-6 pb-4 shadow-xl pop-in">
        <div className="w-9 h-9 rounded-full bg-[#2d6a4f]/10 flex items-center justify-center">
          <Star size={16} fill="#2d6a4f" color="#2d6a4f" strokeWidth={0} />
        </div>
        <h2 className="font-display text-[26px] font-bold text-[#1c1917] mt-4 mb-0">It&rsquo;s a tie</h2>
        <p className="text-[14.5px] leading-[21px] text-[#78716c] mt-1.5 mb-4">
          You rated {countPhrase(songs.length)} a{' '}
          <span className="font-bold" style={{ color: songScoreColor(score) }}>{score.toFixed(1)}</span>.
          Which one was your favorite?
        </p>

        <div className="max-h-[34vh] overflow-y-auto -mx-2">
          {songs.map((s, i) => (
            <button
              key={s.id}
              onClick={() => onPick(s.id)}
              disabled={busy}
              className="rise-in w-full flex items-center gap-3 px-3 py-3 rounded-xl text-left hover:bg-[#2d6a4f]/8 disabled:opacity-50"
              style={{ '--i': i } as React.CSSProperties}
            >
              <span className="w-6 text-right text-[13px] text-[#a8998a] tabular-nums shrink-0">{s.trackNumber}</span>
              <span className="flex-1 min-w-0 text-[15px] font-semibold text-[#1c1917]">{s.title}</span>
              {busy && <Loader2 size={14} className="animate-spin text-[#a8998a]" />}
            </button>
          ))}
        </div>

        {/* Not a cancel: it's the honest answer when they genuinely rate the
            tracks the same, so it says so rather than "Cancel". */}
        <button
          onClick={onSkip}
          disabled={busy}
          className="w-full mt-2 py-2.5 text-[13.5px] font-semibold text-[#a8998a] hover:text-[#57534e]"
        >
          I can&rsquo;t choose
        </button>
      </div>
    </div>
  )
}
