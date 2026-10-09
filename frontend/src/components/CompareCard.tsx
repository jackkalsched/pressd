// One record you and your friends have all rated, everyone's score on one scale.
//
// Web's port of the card in mobile's Social → Compare. The server picks the
// albums and flags the widest disagreement (social.py, get_compare); this only
// draws them. album_id is always the caller's own copy, so the title opens your
// rating, not a friend's.
import { useNavigate } from 'react-router-dom'
import { Music } from 'lucide-react'
import type { CompareItem } from '../api'
import { songScoreColor } from '../types'
import { useUser } from '../context/UserContext'
import { avatarColor } from '../lib/format'
import Avatar from './Avatar'
import CoverImg from './CoverImg'

const GREEN = '#2d6a4f'
const DOWN = '#c0392b'

// The line runs 5–10: below 5 is rare enough that giving it half the width
// would crowd everyone else into the right half. A lower score sits at the end.
const LINE_MIN = 5
const LINE_MAX = 10
const pct = (score: number) =>
  ((Math.min(LINE_MAX, Math.max(LINE_MIN, score)) - LINE_MIN) / (LINE_MAX - LINE_MIN)) * 100

// Friends as bubbles at their score, you set apart by a glow ring. No numbers on
// the marks — the stack below carries the exact scores.
function NumberLine({ raters }: { raters: CompareItem['raters'] }) {
  return (
    <div className="relative mt-5 mx-[15px]" style={{ height: 66 }}>
      <div
        className="absolute inset-x-0 rounded-full"
        style={{ top: 38, height: 5, background: 'linear-gradient(90deg, #d9a6a2, #d8c99c, #8fbb8c)' }}
      />
      {raters.map((r, i) => {
        const left = `${pct(r.score)}%`
        // The tick keeps the name's colour even under a photo, so the mark stays
        // findable whether or not the picture reads at 26px.
        const color = r.is_you ? '#111' : avatarColor(r.name || '?')
        return (
          <div key={i} className="pointer-events-none" title={`${r.is_you ? 'You' : r.name} · ${r.score.toFixed(2)}`}>
            <div
              className="absolute rounded-sm"
              style={{ left, top: 32, width: 3, height: 11, marginLeft: -1.5, background: color }}
            />
            <div
              className="absolute rounded-full flex items-center justify-center"
              style={{
                left, top: r.is_you ? 4 : 6, marginLeft: r.is_you ? -15 : -13,
                width: r.is_you ? 30 : 26, height: r.is_you ? 30 : 26,
                background: r.is_you ? 'rgba(45,106,79,0.30)' : undefined,
                zIndex: r.is_you ? 1 : undefined,
              }}
            >
              <div className="rounded-full border-2 border-white" style={{ lineHeight: 0 }}>
                {r.is_you && !r.avatar_url ? (
                  <div
                    className="rounded-full flex items-center justify-center text-white font-bold"
                    style={{ width: 22, height: 22, background: '#111', fontSize: 10 }}
                  >
                    {(r.name || '?')[0].toUpperCase()}
                  </div>
                ) : (
                  <Avatar name={r.name} avatarUrl={r.avatar_url} size={22} />
                )}
              </div>
            </div>
          </div>
        )
      })}
      <div className="absolute inset-x-0 flex justify-between text-[11px] text-[#aaa] tabular-nums" style={{ top: 50, marginInline: -4 }}>
        {[5, 6, 7, 8, 9, 10].map((n) => <span key={n}>{n}</span>)}
      </div>
    </div>
  )
}

export default function CompareCard({ item }: { item: CompareItem }) {
  const { activeUser, setViewingUser } = useUser()
  const navigate = useNavigate()

  const week = item.recent ? ' this week' : ''
  const disagreement = item.highlight === 'disagreement'
  const subtitle = disagreement
    ? `Widest disagreement${week} · ${item.spread.toFixed(1)} spread`
    : `${item.friend_count} ${item.friend_count === 1 ? 'friend' : 'friends'} rated${week}`

  function openAlbum() {
    setViewingUser(activeUser)
    navigate(`/album/${item.album_id}`)
  }

  return (
    // Lifts and opens on hover the way a Library card does: the record and the
    // line first, who said what underneath. card-action-row keeps it open on
    // touch screens (index.css), which have no hover to open it with.
    <div
      className="
        group bg-white border border-[#e2e2e2] rounded-2xl p-5 self-start
        transition-[transform,box-shadow,border-color] duration-[180ms] ease-out will-change-transform
        hover:border-[#c8c8c8] hover:-translate-y-[5px] hover:scale-[1.02]
        hover:shadow-[0_14px_36px_-4px_rgba(50,30,10,0.14),0_4px_10px_-2px_rgba(50,30,10,0.08)]
        motion-reduce:transition-none motion-reduce:hover:transform-none motion-reduce:hover:shadow-none
      "
    >
      <div className="flex gap-4">
        <button
          onClick={openAlbum}
          className="w-[72px] h-[72px] shrink-0 rounded-lg overflow-hidden bg-[#e8e8e8] flex items-center justify-center text-[#aaa]"
          aria-label={`View ${item.album_name}`}
        >
          {item.album_art_url
            ? <CoverImg url={item.album_art_url} displayPx={72} alt="" className="w-full h-full object-cover" />
            : <Music size={22} />}
        </button>
        <div className="flex-1 min-w-0 pt-0.5">
          <button
            onClick={openAlbum}
            className="block max-w-full text-left text-lg font-bold text-[#111] truncate hover:underline underline-offset-2"
          >
            {item.album_name}
          </button>
          <p className="text-sm text-[#999] truncate">
            {item.artist}{item.year ? ` · ${item.year}` : ''}
          </p>
          <p className="text-sm font-semibold mt-1.5" style={{ color: disagreement ? DOWN : GREEN }}>
            {subtitle}
          </p>
        </div>
      </div>

      <NumberLine raters={item.raters} />

      <div className="card-action-row grid grid-rows-[0fr] group-hover:grid-rows-[1fr] group-focus-within:grid-rows-[1fr] transition-[grid-template-rows] duration-150 ease-out motion-reduce:transition-none">
        <div className="overflow-hidden min-h-0">
          <div className="mt-2 divide-y divide-[#f3f3f3]">
            {item.raters.map((r, i) => {
              const who = (
                <>
                  {r.is_you && !r.avatar_url ? (
                    <div
                      className="rounded-full flex items-center justify-center text-white font-bold shrink-0"
                      style={{ width: 28, height: 28, background: '#111', fontSize: 12 }}
                    >
                      {(r.name || '?')[0].toUpperCase()}
                    </div>
                  ) : (
                    <Avatar name={r.name} avatarUrl={r.avatar_url} size={28} />
                  )}
                  <span className="text-sm font-semibold text-[#111] truncate">{r.is_you ? 'You' : r.name}</span>
                </>
              )
              return (
                <div key={i} className="flex items-center gap-3 py-2.5">
                  {/* Your own row isn't a link — you're already looking at your ratings. */}
                  {r.is_you ? (
                    <div className="flex items-center gap-2.5 min-w-0 shrink-0 max-w-[45%]">{who}</div>
                  ) : (
                    <button
                      onClick={() => {
                        setViewingUser({ id: r.user_id, name: r.name, avatarUrl: r.avatar_url ?? undefined })
                        navigate(`/u/${r.user_id}`)
                      }}
                      className="flex items-center gap-2.5 min-w-0 shrink-0 max-w-[45%] group/who [&>span]:group-hover/who:underline underline-offset-2"
                      aria-label={`View ${r.name}'s profile`}
                    >
                      {who}
                    </button>
                  )}
                  <span className="flex-1 min-w-0 text-sm text-[#777] italic truncate">
                    {r.review ? `“${r.review}”` : ''}
                  </span>
                  <span className="font-display text-base font-bold tabular-nums shrink-0" style={{ color: songScoreColor(r.score) }}>
                    {r.score.toFixed(2)}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}
