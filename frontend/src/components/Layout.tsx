import { useState } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useGoogleLogin } from '@react-oauth/google'
import { Library, BarChart2, List, Music, Mail, X, Loader2, MessageCircle, Pencil, Users } from 'lucide-react'
import clsx from 'clsx'
import { useUser } from '../context/UserContext'
import { fetchFriends, sendInvite, updateUser, signInWithGoogle, removeFriend } from '../api'
import type { UserInfo } from '../api'

function avatarColor(name: string): string {
  const colors = ['#2d6a4f', '#1d4ed8', '#7c3aed', '#b45309', '#0f766e', '#be185d', '#c2410c']
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % colors.length
  return colors[h]
}

function Avatar({ user, size = 28 }: { user: Pick<UserInfo, 'name' | 'avatarUrl'>; size?: number }) {
  if (user.avatarUrl) {
    return (
      <img
        src={user.avatarUrl}
        alt={user.name}
        style={{ width: size, height: size, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }}
      />
    )
  }
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%', background: avatarColor(user.name),
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      color: '#fff', fontSize: size * 0.4, fontWeight: 700, flexShrink: 0,
    }}>
      {user.name[0].toUpperCase()}
    </div>
  )
}

const nav = [
  { to: '/library', label: 'Library', icon: Library },
  { to: '/ratings', label: 'Ratings', icon: List },
  { to: '/stats', label: 'Stats', icon: BarChart2 },
  { to: '/social', label: 'Social', icon: Users },
]

function InviteModal({ onClose }: { onClose: () => void }) {
  const { activeUser } = useUser()
  const [email, setEmail] = useState('')
  const [loadingEmail, setLoadingEmail] = useState(false)
  const [loadingIMessage, setLoadingIMessage] = useState(false)
  const [result, setResult] = useState<{ link: string; viaEmail: boolean } | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function handleIMessage() {
    setLoadingIMessage(true)
    setError(null)
    try {
      const res = await sendInvite(activeUser!.id)
      setResult({ link: res.link, viaEmail: false })
      const msg = `Join me on Press'd, a music rating app! Create your account here: ${res.link}`
      window.location.href = `sms:?body=${encodeURIComponent(msg)}`
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate invite')
    } finally {
      setLoadingIMessage(false)
    }
  }

  async function handleEmail(e: React.FormEvent) {
    e.preventDefault()
    if (!email.trim()) return
    setLoadingEmail(true)
    setError(null)
    try {
      const res = await sendInvite(activeUser!.id, email.trim())
      setResult({ link: res.link, viaEmail: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send invite')
    } finally {
      setLoadingEmail(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white border border-[#e2e2e2] rounded-2xl p-6 w-full max-w-sm mx-4 shadow-xl">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-[#111] font-semibold">Invite Someone</h2>
          <button onClick={onClose} className="text-[#aaa] hover:text-[#555] transition-colors">
            <X size={18} />
          </button>
        </div>

        {result ? (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-[#444]">
              {result.viaEmail ? "Invite sent! Share this link as a backup:" : "Invite link created — opening iMessage…"}
            </p>
            <div className="bg-[#f5f5f5] rounded-lg px-3 py-2 text-xs text-[#555] break-all font-mono">
              {result.link}
            </div>
            <button
              onClick={() => navigator.clipboard.writeText(result.link)}
              className="w-full py-2 rounded-xl text-sm font-semibold bg-[#2d6a4f] hover:bg-[#245c43] text-white transition-colors"
            >
              Copy Link
            </button>
            {!result.viaEmail && (
              <button
                onClick={() => {
                  const msg = `Join me on Press'd, a music rating app! Create your account here: ${result.link}`
                  window.location.href = `sms:?body=${encodeURIComponent(msg)}`
                }}
                className="w-full py-2 rounded-xl text-sm font-semibold bg-[#f5f5f5] border border-[#e2e2e2] hover:bg-[#ececec] text-[#333] transition-colors flex items-center justify-center gap-2"
              >
                <MessageCircle size={14} /> Open iMessage again
              </button>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <button
              onClick={handleIMessage}
              disabled={loadingIMessage}
              className="w-full py-2.5 rounded-xl text-sm font-semibold bg-[#2d6a4f] hover:bg-[#245c43] text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {loadingIMessage ? <><Loader2 size={14} className="animate-spin" /> Generating…</> : <><MessageCircle size={14} /> Share via iMessage</>}
            </button>

            <div className="flex items-center gap-3">
              <div className="flex-1 h-px bg-[#e2e2e2]" />
              <span className="text-[11px] text-[#bbb]">or send by email</span>
              <div className="flex-1 h-px bg-[#e2e2e2]" />
            </div>

            <form onSubmit={handleEmail} className="flex flex-col gap-2">
              <input
                type="email"
                placeholder="Their email address"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="bg-[#f5f5f5] border border-[#e2e2e2] text-[#111] text-sm px-4 py-2.5 rounded-lg focus:outline-none focus:border-[#2d6a4f] transition-colors placeholder:text-[#bbb]"
              />
              <button
                type="submit"
                disabled={loadingEmail || !email.trim()}
                className="w-full py-2.5 rounded-xl text-sm font-semibold bg-[#f5f5f5] border border-[#e2e2e2] hover:bg-[#ececec] text-[#333] transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {loadingEmail ? <><Loader2 size={14} className="animate-spin" /> Sending…</> : 'Send Email Invite'}
              </button>
            </form>

            {error && <p className="text-[#c0392b] text-xs">{error}</p>}
          </div>
        )}
      </div>
    </div>
  )
}

function resizeImageToBase64(file: File, size = 200): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = size
      canvas.height = size
      const ctx = canvas.getContext('2d')!
      const min = Math.min(img.width, img.height)
      const sx = (img.width - min) / 2
      const sy = (img.height - min) / 2
      ctx.drawImage(img, sx, sy, min, min, 0, 0, size, size)
      URL.revokeObjectURL(url)
      resolve(canvas.toDataURL('image/jpeg', 0.85))
    }
    img.onerror = reject
    img.src = url
  })
}

function ProfileModal({ onClose }: { onClose: () => void }) {
  const { activeUser, setActiveUser, signOut } = useUser()
  const navigate = useNavigate()
  const [name, setName] = useState(activeUser?.name ?? '')
  const [avatarUrl, setAvatarUrl] = useState(activeUser?.avatarUrl ?? '')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const googleLink = useGoogleLogin({
    onSuccess: async (tokenResponse) => {
      setError(null)
      try {
        const user = await signInWithGoogle(tokenResponse.access_token, activeUser?.id)
        setActiveUser({ id: user.id, name: user.name, avatarUrl: user.avatarUrl })
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to link Google account')
      }
    },
    onError: () => setError('Google sign in was cancelled or failed.'),
  })

  function handleSignOut() {
    signOut()
    onClose()
    navigate('/login', { replace: true })
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    if (!file.type.startsWith('image/')) { setError('Please choose an image file'); return }
    try {
      const base64 = await resizeImageToBase64(file)
      setAvatarUrl(base64)
      setError(null)
    } catch {
      setError('Failed to process image')
    }
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    if (!activeUser) return
    setLoading(true)
    setError(null)
    try {
      const updated = await updateUser(activeUser.id, {
        name: name.trim() !== activeUser.name ? name.trim() : undefined,
        avatarUrl: avatarUrl !== (activeUser.avatarUrl ?? '') ? avatarUrl : undefined,
      })
      setActiveUser(updated)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save')
    } finally {
      setLoading(false)
    }
  }

  if (!activeUser) return null
  const preview: UserInfo = { id: activeUser.id, name: name || activeUser.name, avatarUrl: avatarUrl || undefined }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white border border-[#e2e2e2] rounded-2xl p-6 w-full max-w-sm mx-4 shadow-xl">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-[#111] font-semibold">Edit Profile</h2>
          <button onClick={onClose} className="text-[#aaa] hover:text-[#555] transition-colors"><X size={18} /></button>
        </div>

        {/* Avatar preview + upload button */}
        <div className="flex flex-col items-center gap-2 mb-5">
          <Avatar user={preview} size={80} />
          <label className="cursor-pointer text-xs font-medium text-[#2d6a4f] hover:text-[#245c43] transition-colors">
            Upload photo
            <input type="file" accept="image/*" className="hidden" onChange={handleFile} />
          </label>
        </div>

        <form onSubmit={handleSave} className="flex flex-col gap-3">
          <div>
            <label className="text-xs text-[#888] mb-1 block">Username</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full bg-[#f5f5f5] border border-[#e2e2e2] text-[#111] text-sm px-4 py-2.5 rounded-lg focus:outline-none focus:border-[#2d6a4f] transition-colors"
            />
          </div>
          {error && <p className="text-[#c0392b] text-xs">{error}</p>}
          <button
            type="submit"
            disabled={loading || !name.trim()}
            className="w-full py-2.5 rounded-xl text-sm font-semibold bg-[#2d6a4f] hover:bg-[#245c43] text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {loading ? <><Loader2 size={14} className="animate-spin" /> Saving…</> : 'Save'}
          </button>
        </form>

        <div className="mt-4 pt-4 border-t border-[#f0f0f0] flex flex-col gap-2">
          {!activeUser?.avatarUrl && (
            <button
              onClick={() => googleLink()}
              className="w-full flex items-center justify-center gap-2 bg-[#111] hover:bg-[#222] text-white text-sm font-medium py-2 rounded-xl transition-colors"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
              </svg>
              Link Google Account
            </button>
          )}
          <button
            onClick={handleSignOut}
            className="w-full py-2 rounded-xl text-sm font-medium text-[#c0392b] hover:bg-[#fdf0ee] transition-colors"
          >
            Sign out
          </button>
        </div>
      </div>
    </div>
  )
}

export default function Layout({ children }: { children: React.ReactNode }) {
  const { activeUser, viewingUser, setViewingUser, isViewingFriend } = useUser()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [showInvite, setShowInvite] = useState(false)
  const [showProfile, setShowProfile] = useState(false)

  const { data: friends = [] } = useQuery({
    queryKey: ['friends', activeUser?.id],
    queryFn: () => fetchFriends(activeUser!.id),
    enabled: !!activeUser,
    staleTime: 60_000,
  })

  function viewFriend(id: number, name: string, avatarUrl?: string) {
    setViewingUser({ id, name, avatarUrl })
    navigate('/library')
  }

  function returnToSelf() {
    setViewingUser(activeUser)
    queryClient.invalidateQueries()
  }

  return (
    <div className="flex min-h-screen bg-white">
      <aside className="w-56 shrink-0 border-r border-[#e2e2e2] flex flex-col py-6 px-4 sticky top-0 h-screen bg-white overflow-y-auto">
        <div className="flex items-center gap-2 mb-8 px-2">
          <Music size={20} className="text-[#2d6a4f]" />
          <span className="text-[#111] font-semibold tracking-wide text-lg">Press'd</span>
        </div>

        <nav className="flex flex-col gap-1">
          {nav.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                clsx(
                  'flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors',
                  isActive
                    ? 'bg-[#2d6a4f]/10 text-[#2d6a4f]'
                    : 'text-[#777] hover:text-[#111] hover:bg-[#f0f0f0]',
                )
              }
            >
              <Icon size={16} />
              {label}
            </NavLink>
          ))}
        </nav>

        {/* Friends section */}
        <div className="mt-6 pt-5 border-t border-[#e2e2e2]">
          <div className="flex items-center justify-between px-2 mb-2">
            <span className="text-[10px] font-semibold text-[#aaa] uppercase tracking-wider">Friends</span>
            <button
              onClick={() => setShowInvite(true)}
              title="Invite someone"
              className="text-[#aaa] hover:text-[#2d6a4f] transition-colors"
            >
              <Mail size={13} />
            </button>
          </div>

          {friends.length === 0 ? (
            <p className="text-[11px] text-[#bbb] px-2">No friends yet — invite someone!</p>
          ) : (
            <div className="flex flex-col gap-0.5">
              {friends.map((f) => (
                <div key={f.id} className="group relative flex items-center">
                  <button
                    onClick={() => viewFriend(f.id, f.name, f.avatarUrl)}
                    className={clsx(
                      'flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors flex-1 text-left min-w-0',
                      viewingUser?.id === f.id
                        ? 'bg-[#2d6a4f]/10 text-[#2d6a4f]'
                        : 'text-[#777] hover:text-[#111] hover:bg-[#f0f0f0]',
                    )}
                  >
                    <Avatar user={f} size={18} />
                    <span className="truncate">{f.name}</span>
                  </button>
                  <button
                    onClick={async () => {
                      if (!confirm(`Remove ${f.name} as a friend?`)) return
                      await removeFriend(activeUser!.id, f.id)
                      if (viewingUser?.id === f.id) returnToSelf()
                      queryClient.invalidateQueries({ queryKey: ['friends'] })
                      queryClient.invalidateQueries({ queryKey: ['feed'] })
                    }}
                    className="absolute right-1 opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded text-[#bbb] hover:text-[#c0392b] hover:bg-[#fdf0ee]"
                    title={`Remove ${f.name}`}
                  >
                    <X size={12} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Active user / viewing indicator at bottom */}
        <div className="mt-auto pt-4 border-t border-[#e2e2e2]">
          {isViewingFriend ? (
            <div className="px-2">
              <p className="text-[10px] text-[#aaa] uppercase tracking-wider mb-1">Viewing</p>
              <div className="flex items-center gap-2 mb-0.5">
                <Avatar user={viewingUser} size={22} />
                <p className="text-sm font-medium text-[#2d6a4f]">{viewingUser?.name}</p>
              </div>
              <button onClick={returnToSelf} className="text-[11px] text-[#aaa] hover:text-[#555] transition-colors">
                ← Back to your data
              </button>
            </div>
          ) : (
            <button
              onClick={() => setShowProfile(true)}
              className="flex items-center gap-2 px-2 w-full group hover:bg-[#f5f5f5] rounded-lg py-1.5 transition-colors"
            >
              <Avatar user={activeUser} size={26} />
              <span className="text-sm text-[#777] group-hover:text-[#111] transition-colors flex-1 text-left truncate">{activeUser?.name}</span>
              <Pencil size={12} className="text-[#ccc] group-hover:text-[#aaa] transition-colors shrink-0" />
            </button>
          )}
        </div>
      </aside>

      <main className="flex-1 overflow-y-auto">
        {isViewingFriend && (
          <div className="bg-[#2d6a4f]/8 border-b border-[#2d6a4f]/20 px-6 py-2 flex items-center gap-3">
            <span className="text-xs text-[#2d6a4f] font-medium">
              Viewing {viewingUser?.name}'s data (read-only)
            </span>
            <button onClick={returnToSelf} className="text-xs text-[#aaa] hover:text-[#555] transition-colors ml-auto">
              ← Back to your data
            </button>
          </div>
        )}
        {children}
      </main>

      {showInvite && <InviteModal onClose={() => setShowInvite(false)} />}
      {showProfile && <ProfileModal onClose={() => setShowProfile(false)} />}
    </div>
  )
}
