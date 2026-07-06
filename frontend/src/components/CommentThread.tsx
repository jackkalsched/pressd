import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Loader2, Send, Trash2 } from 'lucide-react'
import { fetchComments, postComment, deleteComment } from '../api'
import { useUser } from '../context/UserContext'

function timeAgo(dateStr?: string | null): string {
  if (!dateStr) return ''
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days === 1) return '1 day ago'
  if (days < 30) return `${days} days ago`
  const months = Math.floor(days / 30)
  if (months === 1) return '1 month ago'
  return `${months} months ago`
}

function avatarColor(name: string): string {
  const colors = ['#2d6a4f', '#1d4ed8', '#7c3aed', '#b45309', '#0f766e', '#be185d', '#c2410c']
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % colors.length
  return colors[h]
}

function Avatar({ name, avatarUrl, size = 22 }: { name: string; avatarUrl?: string | null; size?: number }) {
  if (avatarUrl) {
    return <img src={avatarUrl} alt={name} style={{ width: size, height: size, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} />
  }
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%', background: avatarColor(name || '?'),
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      color: '#fff', fontSize: size * 0.42, fontWeight: 700, flexShrink: 0,
    }}>
      {(name || '?')[0].toUpperCase()}
    </div>
  )
}

/**
 * Comment list + composer for an album. Friend-gated on the backend — the caller
 * must already be able to view the album (own or a friend's).
 */
export default function CommentThread({ albumId, autoLoad = true }: { albumId: number; autoLoad?: boolean }) {
  const { activeUser } = useUser()
  const queryClient = useQueryClient()
  const [draft, setDraft] = useState('')
  const [posting, setPosting] = useState(false)

  const { data: comments = [], isLoading } = useQuery({
    queryKey: ['comments', albumId],
    queryFn: () => fetchComments(albumId),
    enabled: autoLoad,
    staleTime: 30_000,
  })

  async function handlePost() {
    const body = draft.trim()
    if (!body || posting) return
    setPosting(true)
    try {
      await postComment(albumId, body)
      setDraft('')
      queryClient.invalidateQueries({ queryKey: ['comments', albumId] })
      queryClient.invalidateQueries({ queryKey: ['feed'] })
    } catch { /* keep the draft so the user can retry */ } finally {
      setPosting(false)
    }
  }

  async function handleDelete(id: number) {
    try {
      await deleteComment(id)
      queryClient.invalidateQueries({ queryKey: ['comments', albumId] })
      queryClient.invalidateQueries({ queryKey: ['feed'] })
    } catch { /* ignore */ }
  }

  return (
    <div>
      {isLoading ? (
        <div className="flex items-center gap-1.5 text-[#bbb] text-xs py-1">
          <Loader2 size={12} className="animate-spin" /> Loading comments…
        </div>
      ) : (
        <div className="flex flex-col gap-2.5 mb-3">
          {comments.map(c => (
            <div key={c.id} className="flex gap-2 group">
              <Avatar name={c.author.name} avatarUrl={c.author.avatar_url} size={22} />
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline gap-2">
                  <span className="text-xs font-semibold text-[#111]">{c.author.name}</span>
                  {c.created_at && <span className="text-[10px] text-[#bbb]">{timeAgo(c.created_at)}</span>}
                  {c.can_delete && (
                    <button
                      onClick={() => handleDelete(c.id)}
                      className="ml-auto text-[#ccc] hover:text-[#c0392b] opacity-0 group-hover:opacity-100 transition-opacity"
                      aria-label="Delete comment"
                    >
                      <Trash2 size={12} />
                    </button>
                  )}
                </div>
                <p className="text-[13px] text-[#444] leading-snug whitespace-pre-wrap break-words">{c.body}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="flex items-center gap-2">
        <Avatar name={activeUser?.name ?? '?'} avatarUrl={activeUser?.avatarUrl} size={22} />
        <input
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handlePost() } }}
          placeholder="Add a comment…"
          className="flex-1 min-w-0 px-3 py-1.5 bg-[#f5f5f5] border border-[#e2e2e2] rounded-full text-[13px] text-[#111] placeholder:text-[#bbb] focus:outline-none focus:border-[#2d6a4f] transition-colors"
        />
        <button
          onClick={handlePost}
          disabled={!draft.trim() || posting}
          className="text-[#2d6a4f] hover:text-[#245c43] disabled:text-[#ccc] transition-colors shrink-0"
          aria-label="Post comment"
        >
          {posting ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
        </button>
      </div>
    </div>
  )
}
