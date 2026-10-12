import { useState } from 'react'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Library, BarChart2, List, Mail, X, Loader2, MessageCircle, Users, Plus, Sparkles, TrendingUp, ChevronDown } from 'lucide-react'
import clsx from 'clsx'
import { useUser } from '../context/UserContext'
import { fetchFriends, getInviteLink, removeFriend } from '../api'
import type { UserInfo } from '../api'
import AddAlbumModal from './AddAlbumModal'
import PhoneDialog from './PhoneDialog'
import { phoneVerifyConfigured } from '../lib/phoneVerify'

function avatarColor(name: string): string {
  const colors = ['#2d6a4f', '#1d4ed8', '#7c3aed', '#b45309', '#0f766e', '#be185d', '#c2410c']
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % colors.length
  return colors[h]
}

function Avatar({ user, size = 28 }: { user: Pick<UserInfo, 'name' | 'avatarUrl'> | null; size?: number }) {
  const name = user?.name || '?'
  if (user?.avatarUrl) {
    return (
      <img
        src={user.avatarUrl}
        alt={name}
        style={{ width: size, height: size, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }}
      />
    )
  }
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%', background: avatarColor(name),
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      color: '#fff', fontSize: size * 0.4, fontWeight: 700, flexShrink: 0,
    }}>
      {name[0].toUpperCase()}
    </div>
  )
}

const nav = [
  { to: '/for-you', label: 'For You', icon: Sparkles },
  // Sits right after For You, where the mobile app puts it. BarChart2 is
  // already Stats — this board is about movement, not your own distribution.
  { to: '/charts', label: 'Charts', icon: TrendingUp },
  { to: '/library', label: 'Library', icon: Library },
  { to: '/ratings', label: 'Ratings', icon: List },
  { to: '/stats', label: 'Stats', icon: BarChart2 },
  { to: '/social', label: 'Social', icon: Users },
]

function InviteModal({ onClose }: { onClose: () => void }) {
  const { activeUser } = useUser()
  const [link, setLink] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function loadLink() {
    if (link) return
    setLoading(true)
    try {
      const res = await getInviteLink(activeUser!.id)
      setLink(res.link)
    } catch {
      setError('Failed to generate invite link')
    } finally {
      setLoading(false)
    }
  }

  // Load link on mount
  useState(() => { loadLink() })

  function handleCopy() {
    if (!link) return
    navigator.clipboard.writeText(link)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  function handleiMessage() {
    if (!link) return
    const msg = `Join me on Pressd, a music rating app! Sign up here: ${link}`
    window.location.href = `sms:?body=${encodeURIComponent(msg)}`
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm fade-in" onClick={onClose} />
      <div className="relative bg-white border border-[#e2e2e2] rounded-2xl p-6 w-full max-w-sm mx-4 shadow-xl pop-in">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-[#111] font-semibold">Invite Someone</h2>
          <button onClick={onClose} className="text-[#aaa] hover:text-[#555] transition-colors">
            <X size={18} />
          </button>
        </div>

        <p className="text-sm text-[#777] mb-4">
          Share your invite link — anyone who signs up becomes your friend.
        </p>

        {loading ? (
          <div className="flex items-center justify-center py-6 text-[#aaa] gap-2">
            <Loader2 size={14} className="animate-spin" /> Generating…
          </div>
        ) : error ? (
          <p className="text-[#c0392b] text-xs">{error}</p>
        ) : link ? (
          <div className="flex flex-col gap-3">
            <div className="bg-[#f5f5f5] rounded-lg px-3 py-2 text-xs text-[#555] break-all font-mono border border-[#e2e2e2]">
              {link}
            </div>
            <button
              onClick={handleCopy}
              className="w-full py-2.5 rounded-xl text-sm font-semibold bg-[#2d6a4f] hover:bg-[#245c43] text-white transition-colors"
            >
              {copied ? '✓ Copied!' : 'Copy Link'}
            </button>
            <button
              onClick={handleiMessage}
              className="w-full py-2 rounded-xl text-sm font-medium bg-[#f5f5f5] border border-[#e2e2e2] hover:bg-[#ececec] text-[#333] transition-colors flex items-center justify-center gap-2"
            >
              <MessageCircle size={14} /> Share via iMessage
            </button>
          </div>
        ) : null}
      </div>
    </div>
  )
}

const FRIENDS_OPEN_KEY = 'pressd_sidebar_friends_open'

export default function Layout({ children }: { children: React.ReactNode }) {
  const { activeUser, viewingUser, setViewingUser, isViewingFriend } = useUser()
  const navigate = useNavigate()
  const location = useLocation()
  const queryClient = useQueryClient()
  const [showInvite, setShowInvite] = useState(false)
  const [showAddAlbum, setShowAddAlbum] = useState(false)
  // The sidebar's friends list folds away; remembered per browser, so a long
  // list stays out of the way across visits. Storage can be unavailable.
  const [friendsOpen, setFriendsOpen] = useState(() => {
    try { return localStorage.getItem(FRIENDS_OPEN_KEY) !== '0' } catch { return true }
  })
  function toggleFriends() {
    setFriendsOpen((open) => {
      try { localStorage.setItem(FRIENDS_OPEN_KEY, open ? '0' : '1') } catch { /* ignore */ }
      return !open
    })
  }

  const { data: friends = [] } = useQuery({
    queryKey: ['friends', activeUser?.id],
    queryFn: () => fetchFriends(activeUser!.id),
    enabled: !!activeUser,
    staleTime: 60_000,
  })

  function viewFriend(id: number, name: string, avatarUrl?: string) {
    setViewingUser({ id, name, avatarUrl })
    navigate(`/u/${id}`)
  }

  // Your own name opens your profile, where Settings lives (top right).
  function openOwnProfile() {
    if (!activeUser) return
    setViewingUser(activeUser)
    navigate(`/u/${activeUser.id}`)
  }

  function returnToSelf() {
    setViewingUser(activeUser)
    queryClient.invalidateQueries()
  }

  return (
    <div className="flex min-h-screen bg-[#f9f8f6]">
      {/* Sidebar — desktop only */}
      <aside className="hidden md:flex w-56 shrink-0 border-r border-[#e2e2e2] flex-col py-6 px-4 sticky top-0 h-screen bg-[#f9f8f6] overflow-y-auto">
        <div className="flex items-center gap-2.5 mb-8 px-2">
          <img src="/logo.png" alt="Pressd logo" className="h-8 w-auto shrink-0" />
          <span className="font-wordmark text-[#111] text-xl">Pressd</span>
        </div>

        <nav className="flex flex-col gap-1">
          {nav.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              onClick={() => { if (isViewingFriend) returnToSelf() }}
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
          {!isViewingFriend && (
            <button
              onClick={() => setShowAddAlbum(true)}
              className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-semibold transition-colors bg-[#2d6a4f] hover:bg-[#245c43] text-white w-full text-left mt-1"
            >
              <Plus size={16} />
              Rate an Album
            </button>
          )}
        </nav>

        {/* Friends section */}
        <div className="mt-6 pt-5 border-t border-[#e2e2e2]">
          <div className="flex items-center justify-between px-2 mb-2">
            <button
              onClick={toggleFriends}
              aria-expanded={friendsOpen}
              className="flex items-center gap-1 text-[10px] font-semibold text-[#aaa] uppercase tracking-wider hover:text-[#555] transition-colors"
            >
              <ChevronDown size={12} className={clsx('transition-transform', !friendsOpen && '-rotate-90')} />
              Friends
              {!friendsOpen && friends.length > 0 && (
                <span className="ml-1 normal-case tracking-normal font-medium text-[#bbb]">{friends.length}</span>
              )}
            </button>
            <button
              onClick={() => setShowInvite(true)}
              title="Invite someone"
              className="text-[#aaa] hover:text-[#2d6a4f] transition-colors"
            >
              <Mail size={13} />
            </button>
          </div>

          {!friendsOpen ? null : friends.length === 0 ? (
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

        {/* Active user at bottom — always your own profile */}
        <div className="mt-auto pt-4 border-t border-[#e2e2e2]">
          <button
            onClick={openOwnProfile}
            aria-label="Your profile"
            className={clsx(
              'flex items-center gap-2 px-2 w-full group rounded-lg py-1.5 transition-colors',
              location.pathname === `/u/${activeUser?.id}` ? 'bg-[#2d6a4f]/10' : 'hover:bg-[#f5f5f5]',
            )}
          >
            <Avatar user={activeUser} size={26} />
            <span className="text-sm text-[#777] group-hover:text-[#111] transition-colors flex-1 text-left truncate">{activeUser?.name}</span>
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-y-auto pb-16 md:pb-0">
        {/* Keyed on the path so each new page settles in rather than cutting.
            The search string is left out: a filter or sort change on the same
            page shouldn't replay the entrance. */}
        <div key={location.pathname} className="page-enter">
          {children}
        </div>
      </main>

      {/* Bottom tab bar — mobile only */}
      <nav className="md:hidden fixed bottom-0 inset-x-0 bg-white border-t border-[#e2e2e2] flex items-stretch z-40"
           style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
        {nav.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            onClick={() => { if (isViewingFriend) returnToSelf() }}
            className={({ isActive }) =>
              clsx(
                'flex-1 flex flex-col items-center justify-center gap-0.5 py-2.5 text-[10px] font-medium transition-colors',
                isActive ? 'text-[#2d6a4f]' : 'text-[#aaa]',
              )
            }
          >
            <Icon size={20} />
            {label}
          </NavLink>
        ))}
        {/* Profile button */}
        <button
          onClick={openOwnProfile}
          className="flex-1 flex flex-col items-center justify-center gap-0.5 py-2.5 text-[10px] font-medium text-[#aaa] transition-colors"
        >
          <Avatar user={activeUser} size={22} />
          <span>Profile</span>
        </button>
      </nav>

      {/* Mobile FAB */}
      {!isViewingFriend && (
        <button
          onClick={() => setShowAddAlbum(true)}
          className="md:hidden fixed bottom-20 right-4 z-30 w-12 h-12 rounded-full bg-[#2d6a4f] hover:bg-[#245c43] text-white shadow-lg flex items-center justify-center transition-colors"
          style={{ marginBottom: 'env(safe-area-inset-bottom)' }}
          aria-label="Rate an Album"
        >
          <Plus size={22} />
        </button>
      )}

      {showInvite && <InviteModal onClose={() => setShowInvite(false)} />}
      {/* The one-time ask. Layout only renders past the tutorial and welcome
          gates, so it never lands on a first run's first screen. An explicit
          false: a session that hasn't heard of the field waits for the refresh
          in UserContext. Hidden where Firebase isn't configured for web. */}
      {phoneVerifyConfigured && activeUser?.phonePromptDone === false && (
        <PhoneDialog mode="prompt" onClose={() => {}} />
      )}
      {showAddAlbum && activeUser && (
        <AddAlbumModal onClose={() => setShowAddAlbum(false)} userId={activeUser.id} />
      )}
    </div>
  )
}
