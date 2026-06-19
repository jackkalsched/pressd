import { useState } from 'react'
import { X, Star, Loader2, Check } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { fetchFriends, recommendAlbum } from '../api'
import { useUser } from '../context/UserContext'
import type { Album } from '../types'
import type { UserInfo } from '../api'

interface Props {
  album: Album
  onClose: () => void
}

export default function RecommendModal({ album, onClose }: Props) {
  const { activeUser } = useUser()
  const [selected, setSelected] = useState<number | null>(null)
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const { data: friends = [] } = useQuery<UserInfo[]>({
    queryKey: ['friends', activeUser?.id],
    queryFn: () => fetchFriends(activeUser!.id),
    enabled: !!activeUser,
    staleTime: 60_000,
  })

  async function handleSend() {
    if (!selected || !activeUser) return
    setLoading(true)
    setError(null)
    try {
      const { alreadyExisted } = await recommendAlbum(album.id, selected, activeUser.id)
      const friendName = friends.find(f => f.id === selected)?.name ?? 'them'
      setSent(alreadyExisted
        ? `${friendName} already has this album — marked it as your recommendation.`
        : `Recommended to ${friendName}!`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" />
      <div
        className="relative bg-white border border-[#e2e2e2] rounded-2xl p-6 w-full max-w-sm mx-4 shadow-xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Star size={16} fill="#f97316" color="#f97316" />
            <h2 className="text-[#111] font-semibold">Recommend</h2>
          </div>
          <button onClick={onClose} className="text-[#aaa] hover:text-[#555] transition-colors">
            <X size={18} />
          </button>
        </div>

        <p className="text-sm text-[#777] mb-4">
          Send <span className="font-medium text-[#111]">{album.albumName}</span> by{' '}
          <span className="font-medium text-[#111]">{album.artist}</span> to a friend's To Listen list.
        </p>

        {sent ? (
          <div className="flex items-center gap-2 text-sm text-[#2d6a4f] bg-[#f0faf5] border border-[#c3e6d8] rounded-xl px-4 py-3">
            <Check size={16} /> {sent}
          </div>
        ) : (
          <>
            {friends.length === 0 ? (
              <p className="text-sm text-[#aaa] text-center py-4">You don't have any friends yet.</p>
            ) : (
              <div className="flex flex-col gap-1.5 mb-4 max-h-48 overflow-y-auto">
                {friends.map(f => (
                  <button
                    key={f.id}
                    onClick={() => setSelected(f.id)}
                    className={`flex items-center gap-3 px-3 py-2.5 rounded-xl border text-sm text-left transition-colors ${
                      selected === f.id
                        ? 'bg-[#fff7ed] border-[#f97316] text-[#c2410c]'
                        : 'bg-[#f5f5f5] border-[#e2e2e2] text-[#444] hover:border-[#c8c8c8]'
                    }`}
                  >
                    <div
                      className="w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0"
                      style={{ background: '#2d6a4f' }}
                    >
                      {f.name[0].toUpperCase()}
                    </div>
                    {f.name}
                    {selected === f.id && <Check size={14} className="ml-auto text-[#f97316]" />}
                  </button>
                ))}
              </div>
            )}

            {error && <p className="text-[#c0392b] text-xs mb-3">{error}</p>}

            <button
              onClick={handleSend}
              disabled={!selected || loading}
              className="w-full py-2.5 rounded-xl text-sm font-semibold bg-[#f97316] hover:bg-[#ea6c0a] text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {loading ? <><Loader2 size={14} className="animate-spin" /> Sending…</> : <>
                <Star size={14} fill="white" /> Recommend
              </>}
            </button>
          </>
        )}
      </div>
    </div>
  )
}
