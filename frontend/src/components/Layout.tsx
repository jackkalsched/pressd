import { useState } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Library, BarChart2, List, Music, Mail, X, Loader2, MessageCircle, Pencil } from 'lucide-react'
import clsx from 'clsx'
import { useUser } from '../context/UserContext'
import { fetchFriends, sendInvite, updateUser, signInWithApple } from '../api'
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
  const [linkLoading, setLinkLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleLinkApple() {
    if (!window.AppleID || !activeUser) return
    setLinkLoading(true)
    setError(null)
    try {
      const response = await window.AppleID.auth.signIn()
      const { id_token } = response.authorization
      const user = await signInWithApple(id_token, undefined, activeUser.id)
      setActiveUser({ id: user.id, name: user.name, avatarUrl: user.avatarUrl })
    } catch (err: unknown) {
      if ((err as { error?: string })?.error !== 'popup_closed_by_user') {
        setError(err instanceof Error ? err.message : 'Failed to link Apple ID')
      }
    } finally {
      setLinkLoading(false)
    }
  }

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
            <label className="text-xs text-[#888] mb-1 block">Display name</label>
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
          {window.AppleID && (
            <button
              onClick={handleLinkApple}
              disabled={linkLoading}
              className="w-full py-2 rounded-xl text-sm font-medium bg-[#000] hover:bg-[#1a1a1a] text-white transition-colors disabled:opacity-40 flex items-center justify-center gap-2"
            >
              {linkLoading ? <Loader2 size={13} className="animate-spin" /> : (
                <svg width="13" height="16" viewBox="0 0 16 20" fill="none"><path d="M13.173 10.535c-.022-2.459 2.004-3.646 2.094-3.703-1.142-1.668-2.916-1.896-3.547-1.921-1.516-.156-2.963.896-3.732.896-.77 0-1.961-.872-3.222-.848-1.655.025-3.182.97-4.032 2.462C-.133 9.88 1.088 14.98 2.72 17.78c.814 1.178 1.784 2.502 3.063 2.455 1.228-.05 1.692-.793 3.178-.793s1.903.793 3.208.768c1.32-.025 2.157-1.2 2.97-2.38.94-1.364 1.325-2.691 1.349-2.76-.03-.014-2.585-1.002-2.615-3.535zM10.803 3.3c.674-.828 1.13-1.972.999-3.113-.968.04-2.146.651-2.842 1.467-.621.718-1.169 1.882-1.022 2.99 1.082.083 2.185-.553 2.865-1.344z" fill="currentColor"/></svg>
              )}
              {linkLoading ? 'Linking…' : 'Link Apple ID'}
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
                <button
                  key={f.id}
                  onClick={() => viewFriend(f.id, f.name, f.avatarUrl)}
                  className={clsx(
                    'flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors w-full text-left',
                    viewingUser?.id === f.id
                      ? 'bg-[#2d6a4f]/10 text-[#2d6a4f]'
                      : 'text-[#777] hover:text-[#111] hover:bg-[#f0f0f0]',
                  )}
                >
                  <Avatar user={f} size={18} />
                  {f.name}
                </button>
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
