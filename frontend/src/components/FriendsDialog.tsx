// A profile's friends — the dialog the Friends figure opens, on your own profile
// and on anyone else's. Each friend carries the *viewer's* taste overlap with
// them (GET /overlap/friends/{id}): on your own page yours with each friend, on
// someone else's yours with each of theirs. Highest first; you, when you're in
// their list, at the top with no number. The web twin of mobile's
// components/FriendsSheet.tsx, which is a bottom sheet. Each row carries the
// friend's bio under their name; on someone else's list, also Add / Requested /
// Accept / Friends, as you stand with that person.
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Clock, UserPlus, X } from 'lucide-react'
import { addFriend, fetchFriendsOverlap } from '../api'
import { useUser } from '../context/UserContext'
import { stagger } from '../lib/format'
import { overlapScore, songScoreColor, type FriendOverlap } from '../types'
import Avatar from './Avatar'
import VinylSpinner from './VinylSpinner'

export default function FriendsDialog({ userId, name, onClose }: {
  /** Whose friends. */
  userId: number
  /** Their name, for the heading; ignored on your own profile. */
  name: string
  onClose: () => void
}) {
  const { activeUser } = useUser()
  const navigate = useNavigate()
  const mine = activeUser?.id === userId
  const { data: rows, isLoading, isError } = useQuery({
    queryKey: ['friends-overlap', activeUser?.id, userId],
    queryFn: () => fetchFriendsOverlap(userId),
    enabled: !!activeUser,
  })

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const queryClient = useQueryClient()
  // Where you stand after Add or Accept here, ahead of the refetch.
  const [changed, setChanged] = useState<Record<number, FriendOverlap['relationship']>>({})
  const [busy, setBusy] = useState<number | null>(null)

  async function befriend(r: FriendOverlap) {
    if (!activeUser || busy != null) return
    setBusy(r.user.id)
    try {
      const res = await addFriend(activeUser.id, r.user.id)
      setChanged((c) => ({ ...c, [r.user.id]: res.status === 'accepted' ? 'friends' : 'sent' }))
      queryClient.invalidateQueries({ queryKey: ['friends'] })
      queryClient.invalidateQueries({ queryKey: ['friend-requests'] })
    } catch { /* the button stays as it was */ } finally {
      setBusy(null)
    }
  }

  function open(id: number) {
    onClose()
    navigate(`/u/${id}`)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm fade-in" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={mine ? 'Your friends' : `${name}'s friends`}
        className="relative flex max-h-[calc(100vh-2rem)] w-full max-w-md flex-col rounded-[24px] border border-(--c-e8e2d9) bg-(--c-f9f8f6) p-6 shadow-xl pop-in"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-baseline gap-3">
          <h2 className="font-display m-0 min-w-0 flex-1 truncate text-[24px] leading-tight text-(--c-1c1917)">
            {mine ? 'Your friends' : `${name}'s friends`}
            {rows && <span className="ml-2.5 text-[18px] text-(--c-a8998a) tabular-nums">{rows.length}</span>}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="cursor-pointer self-center rounded-full p-1.5 text-(--c-78716c) hover:bg-(--c-efe9e0)"
          >
            <X size={18} />
          </button>
        </div>

        {isLoading ? (
          <div className="flex justify-center py-12"><VinylSpinner size={44} /></div>
        ) : isError ? (
          <p className="m-0 py-12 text-center text-sm text-(--c-78716c)">Couldn't load friends.</p>
        ) : !rows?.length ? (
          <p className="m-0 py-12 text-center text-sm text-(--c-78716c)">No friends yet.</p>
        ) : (
          <ul className="m-0 -mx-2 list-none overflow-y-auto p-0">
            {rows.map((r, i) => (
              <li key={r.user.id} className="rise-in flex items-center gap-2 rounded-xl px-2 hover:bg-(--c-efe9e0)" style={stagger(Math.min(i, 12))}>
                <button
                  type="button"
                  onClick={() => open(r.user.id)}
                  className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 border-none bg-transparent py-2.5 pl-0 pr-1 text-left"
                >
                  <Avatar name={r.user.name} avatarUrl={r.user.avatarUrl} size={42} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15px] font-semibold text-(--c-1c1917)">{r.user.name}</span>
                    {r.user.bio && <span className="mt-0.5 block truncate text-xs text-(--c-78716c)">{r.user.bio}</span>}
                  </span>
                  {r.percent == null ? (
                    <span className="text-[13px] font-semibold text-(--c-78716c)">You</span>
                  ) : (
                    <span className="flex flex-col items-end leading-none" style={{ color: songScoreColor(overlapScore(r.percent)) }}>
                      <span className="font-display text-[22px] tabular-nums">{r.percent}%</span>
                      <span className="mt-1 text-[11px] font-semibold">taste overlap</span>
                    </span>
                  )}
                </button>
                {!mine && r.relationship !== 'self' && (
                  <FriendButton
                    rel={changed[r.user.id] ?? r.relationship}
                    busy={busy === r.user.id}
                    onClick={() => befriend(r)}
                    name={r.user.name}
                  />
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

/** You and this friend of theirs: Add or Accept act; Requested and Friends only
 *  say so. The words are the profile button's. */
function FriendButton({ rel, busy, onClick, name }: {
  rel: FriendOverlap['relationship']
  busy: boolean
  onClick: () => void
  name: string
}) {
  const acts = rel === 'none' || rel === 'received'
  const label = rel === 'none' ? 'Add' : rel === 'received' ? 'Accept' : rel === 'sent' ? 'Requested' : 'Friends'
  const Icon = rel === 'sent' ? Clock : rel === 'friends' ? Check : UserPlus
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!acts || busy}
      aria-label={rel === 'none' ? `Add ${name}` : rel === 'received' ? `Accept ${name}'s request` : label}
      className={`flex min-w-[88px] shrink-0 items-center justify-center gap-1.5 rounded-full border-none px-3 py-1.5 text-[13px] font-semibold transition-colors disabled:cursor-default ${
        acts
          ? 'cursor-pointer bg-(--c-green-fill) text-white hover:bg-(--c-green-fill-hover)'
          : 'bg-(--c-2d6a4f)/10 text-(--c-2d6a4f)'
      }`}
    >
      {busy ? <VinylSpinner size={15} /> : <Icon size={14} strokeWidth={2.4} />}
      {label}
    </button>
  )
}
