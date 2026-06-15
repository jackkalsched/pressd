import { useState, useEffect } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { Loader2, Music } from 'lucide-react'
import { fetchInvite, acceptInvite } from '../api'
import { useUser } from '../context/UserContext'

export default function Join() {
  const [searchParams] = useSearchParams()
  const token = searchParams.get('token') ?? ''
  const navigate = useNavigate()
  const { setActiveUser } = useUser()

  const [inviterName, setInviterName] = useState<string | null>(null)
  const [loadingInvite, setLoadingInvite] = useState(true)
  const [inviteError, setInviteError] = useState<string | null>(null)

  const [name, setName] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!token) {
      setInviteError('No invite token found in URL.')
      setLoadingInvite(false)
      return
    }
    fetchInvite(token)
      .then((data) => {
        setInviterName(data.inviter_name)
        setLoadingInvite(false)
      })
      .catch((err) => {
        setInviteError(err instanceof Error ? err.message : 'Invalid invite link.')
        setLoadingInvite(false)
      })
  }, [token])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
    setSubmitting(true)
    setError(null)
    try {
      const user = await acceptInvite(token, name.trim())
      setActiveUser({ id: user.id, name: user.name })
      navigate('/library')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.')
      setSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen bg-white flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="flex items-center gap-2 mb-8 justify-center">
          <Music size={22} className="text-[#2d6a4f]" />
          <span className="text-[#111] font-semibold tracking-wide text-xl">Press'd</span>
        </div>

        {loadingInvite ? (
          <div className="flex justify-center">
            <Loader2 size={20} className="animate-spin text-[#aaa]" />
          </div>
        ) : inviteError ? (
          <div className="text-center">
            <p className="text-[#c0392b] text-sm">{inviteError}</p>
          </div>
        ) : (
          <div className="bg-white border border-[#e2e2e2] rounded-2xl p-6 shadow-sm">
            <h1 className="text-[#111] font-semibold text-lg mb-1">You've been invited</h1>
            <p className="text-[#777] text-sm mb-5">
              <span className="font-medium text-[#111]">{inviterName}</span> invited you to join Press'd.
            </p>

            <form onSubmit={handleSubmit} className="flex flex-col gap-3">
              <div>
                <label className="text-xs font-medium text-[#777] mb-1 block">Your name</label>
                <input
                  type="text"
                  placeholder="e.g. Alex"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  autoFocus
                  className="w-full bg-[#f5f5f5] border border-[#e2e2e2] text-[#111] text-sm px-4 py-2.5 rounded-lg focus:outline-none focus:border-[#2d6a4f] transition-colors placeholder:text-[#bbb]"
                />
              </div>

              {error && <p className="text-[#c0392b] text-xs">{error}</p>}

              <button
                type="submit"
                disabled={submitting || !name.trim()}
                className="w-full py-2.5 rounded-xl text-sm font-semibold bg-[#2d6a4f] hover:bg-[#245c43] text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2 mt-1"
              >
                {submitting ? <><Loader2 size={14} className="animate-spin" /> Joining…</> : 'Join Press\'d'}
              </button>
            </form>
          </div>
        )}
      </div>
    </div>
  )
}
