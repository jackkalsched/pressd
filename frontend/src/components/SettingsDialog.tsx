// Edit profile and Settings — your own account, opened from the pencil and the
// gear at the top right of your profile's banner (FriendProfile, when it's
// you). Mobile's SettingsSheet, as one dialog in two modes, as there: Edit
// profile holds photo, banner, username, bio and location; Settings holds the
// phone number, Google link, the tutorial replay and sign-out.
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useGoogleLogin } from '@react-oauth/google'
import { ChevronLeft, ChevronRight, X } from 'lucide-react'
import { useUser } from '../context/UserContext'
import { fetchProfile, updateUser, linkGoogle, fetchLinkedProviders, unlinkProvider, deleteOwnAccount, fetchBlockedUsers, unblockUser } from '../api'
import AppleLogo from './AppleLogo'
import { IOS_APP_URL } from '../lib/iosApp'
import type { UserInfo } from '../api'
import { cleanUsername } from '../types'
import Avatar from './Avatar'
import PhoneDialog from './PhoneDialog'
import { phoneVerifyConfigured } from '../lib/phoneVerify'
import { useBanner } from '../lib/useBanner'
import { setAppearance, useAppearance, type Appearance } from '../lib/appearance'
import VinylSpinner from './VinylSpinner'

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

// The support inbox, and the App Store's write-a-review page for the listing.
const SUPPORT_EMAIL = 'pressdmusicapp@gmail.com'
const RATE_URL = `${IOS_APP_URL.split('?')[0]}?action=write-review`
const SMALL_BTN =
  'rounded-full border border-(--c-e2dbd0) bg-(--c-fff) px-3 py-1 text-[13px] font-semibold text-(--c-2d6a4f) hover:border-(--c-2d6a4f)'

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <p className="m-0 mt-4 mb-1 px-3 text-[11px] font-bold uppercase tracking-[0.14em] text-(--c-a8998a) first:mt-0">{children}</p>
}

/** A row that goes somewhere: a page in the app, or (`href`) out of it. */
function LinkLine({ label, onClick, href }: { label: string; onClick?: () => void; href?: string }) {
  const cls = 'w-full flex items-center gap-2 px-3 py-2 rounded-xl text-left hover:bg-(--c-f5f5f5) transition-colors'
  const inner = (
    <>
      <span className="flex-1 min-w-0 text-sm font-medium text-(--c-111)">{label}</span>
      <ChevronRight size={16} className="text-(--c-bbb)" />
    </>
  )
  return href ? (
    <a href={href} target={href.startsWith('mailto:') ? undefined : '_blank'} rel="noopener noreferrer" className={cls}>{inner}</a>
  ) : (
    <button onClick={onClick} className={cls}>{inner}</button>
  )
}

function GoogleG() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285f4"/>
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34a853"/>
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#fbbc05"/>
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#ea4335"/>
    </svg>
  )
}

/** One sign-in provider: connected (with Disconnect while another remains) or not. */
function ProviderLine({ icon, label, linked, canUnlink, onUnlink, connect }: {
  icon: React.ReactNode
  label: string
  linked: boolean
  canUnlink: boolean
  onUnlink: () => void
  connect: React.ReactNode
}) {
  return (
    <div className="flex w-full items-center gap-2 px-3 py-2">
      <span className="flex w-5 justify-center text-(--c-111)">{icon}</span>
      <span className="flex-1 text-sm font-medium text-(--c-111)">{label}</span>
      {linked ? (
        canUnlink ? (
          <button onClick={onUnlink} className="text-sm font-semibold text-(--c-b91c1c) hover:underline underline-offset-2">Disconnect</button>
        ) : (
          <span className="text-sm font-semibold text-(--c-2d6a4f)">Connected</span>
        )
      ) : (
        connect ?? <span className="text-sm text-(--c-a8998a)">Not connected</span>
      )}
    </div>
  )
}

/** Settings → Blocked users: everyone you've blocked, newest first, each with
 *  Unblock. Unblocking doesn't bring back a friendship the block ended. */
function BlockedList() {
  const queryClient = useQueryClient()
  const [busy, setBusy] = useState<number | null>(null)
  const { data, isLoading, isError } = useQuery({ queryKey: ['blocked'], queryFn: fetchBlockedUsers })
  async function unblock(id: number) {
    setBusy(id)
    try {
      await unblockUser(id)
      queryClient.invalidateQueries({ queryKey: ['blocked'] })
      queryClient.invalidateQueries({ queryKey: ['profile', id] })
    } finally {
      setBusy(null)
    }
  }
  if (isLoading) return <div className="flex justify-center py-6"><VinylSpinner size={32} /></div>
  if (isError) return <p className="m-0 py-6 text-center text-sm text-(--c-57534e)">Couldn’t load blocked users.</p>
  if (!data?.length) return <p className="m-0 py-6 text-center text-sm text-(--c-57534e)">You haven’t blocked anyone.</p>
  return (
    <div className="flex flex-col">
      {data.map((u) => (
        <div key={u.id} className="flex items-center gap-3 px-1 py-2">
          <Avatar name={u.name} avatarUrl={u.avatarUrl} size={36} />
          <span className="flex-1 min-w-0 truncate text-sm font-medium text-(--c-111)">{u.name}</span>
          {busy === u.id ? <VinylSpinner size={16} /> : (
            <button onClick={() => unblock(u.id)} className={SMALL_BTN} aria-label={`Unblock ${u.name}`}>Unblock</button>
          )}
        </div>
      ))}
    </div>
  )
}

const APPEARANCES: { key: Appearance; label: string }[] = [
  { key: 'system', label: 'System' },
  { key: 'light', label: 'Light' },
  { key: 'dark', label: 'Dark' },
]

export type SettingsMode = 'profile' | 'settings'

export default function SettingsDialog({ mode, onClose }: { mode: SettingsMode; onClose: () => void }) {
  const editing = mode === 'profile'
  const appearance = useAppearance()
  const { activeUser, setActiveUser, signOut, removePhoneNumber } = useUser()
  const [phoneOpen, setPhoneOpen] = useState(false)
  const [phoneBusy, setPhoneBusy] = useState(false)

  async function removeNumber() {
    if (!window.confirm('Remove your phone number? Friends won’t be able to find you by it.')) return
    setPhoneBusy(true)
    try {
      await removePhoneNumber()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Couldn’t remove that number')
    } finally {
      setPhoneBusy(false)
    }
  }
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [name, setName] = useState(activeUser?.name ?? '')
  const [avatarUrl, setAvatarUrl] = useState(activeUser?.avatarUrl ?? '')
  const [bio, setBio] = useState(activeUser?.bio ?? '')
  // Seeded from the profile once it arrives; null until then, so an early save
  // can't send an empty string and clear what's stored.
  const [location, setLocation] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const banner = useBanner(activeUser?.id)
  const [blockedOpen, setBlockedOpen] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)

  // Mobile's Settings → Sign-in methods: which providers reach this account.
  const { data: providers, isLoading: providersLoading } = useQuery({
    queryKey: ['linked-providers', activeUser?.id],
    queryFn: fetchLinkedProviders,
    enabled: !!activeUser && !editing,
  })
  const linkedCount = (providers?.google ? 1 : 0) + (providers?.apple ? 1 : 0)
  async function unlink(provider: 'google' | 'apple') {
    // Never the last one: the account would be locked out for good, so the
    // control isn't offered then (ProviderLine's canUnlink).
    if (!window.confirm(`Disconnect ${provider === 'google' ? 'Google' : 'Apple'}? You won’t be able to sign in with it.`)) return
    setError(null)
    try {
      await unlinkProvider(provider)
      queryClient.invalidateQueries({ queryKey: ['linked-providers'] })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Couldn’t disconnect that')
    }
  }

  async function handleDelete() {
    setDeleting(true)
    setError(null)
    try {
      await deleteOwnAccount()
      signOut()
      onClose()
      navigate('/', { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Couldn’t delete your account')
      setConfirmDelete(false)
    } finally {
      setDeleting(false)
    }
  }

  // The banner lives on the profile, not the session: the ['profile', id]
  // query the profile page draws from, so a change shows at once.
  const { data: ownProfile } = useQuery({
    queryKey: ['profile', activeUser?.id],
    queryFn: () => fetchProfile(activeUser!.id),
    enabled: !!activeUser,
    staleTime: 60_000,
  })
  const locationValue = location ?? ownProfile?.location ?? ''

  const googleLink = useGoogleLogin({
    onSuccess: async (tokenResponse) => {
      setError(null)
      try {
        // Links to whoever the stored session token belongs to; the server no
        // longer accepts a user id from the client here.
        const user = await linkGoogle(tokenResponse.access_token)
        setActiveUser({ ...activeUser, id: user.id, name: user.name, avatarUrl: user.avatarUrl, tutorialSeen: user.tutorialSeen, usernameChosen: user.usernameChosen })
        queryClient.invalidateQueries({ queryKey: ['linked-providers'] })
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to link Google account')
      }
    },
    onError: () => setError('Google sign in was cancelled or failed.'),
  })

  function handleSignOut() {
    signOut()
    onClose()
    navigate('/', { replace: true })
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
      // The endpoint answers with the whole profile now — picks included — but
      // this dialog only edits identity, so it keeps the fields it knows.
      const updated = await updateUser(activeUser.id, {
        name: name.trim() !== activeUser.name ? name.trim() : undefined,
        avatarUrl: avatarUrl !== (activeUser.avatarUrl ?? '') ? avatarUrl : undefined,
        bio: bio.trim() !== (activeUser.bio ?? '') ? bio.trim() : undefined,
        location: location !== null && location.trim() !== (ownProfile?.location ?? '') ? location.trim() : undefined,
      })
      // The profile page reads location from the profile query, not the session.
      queryClient.setQueryData(['profile', activeUser.id], updated)
      setActiveUser({
        ...activeUser,
        id: updated.id,
        name: updated.name,
        // The server stamps the choice on any saved name.
        ...(name.trim() !== activeUser.name ? { usernameChosen: true } : {}),
        avatarUrl: updated.avatar_url ?? undefined,
        bio: updated.bio ?? undefined,
      })
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
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm fade-in" onClick={onClose} />
      <div className="relative bg-(--c-fff) border border-(--c-e2e2e2) rounded-2xl p-6 w-full max-w-sm mx-4 shadow-xl pop-in max-h-[88vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-5">
          <h2 className="m-0 flex items-center gap-1 text-(--c-111) font-semibold">
            {!editing && blockedOpen && (
              <button onClick={() => setBlockedOpen(false)} aria-label="Back to Settings" className="-ml-1 text-(--c-57534e) hover:text-(--c-111)">
                <ChevronLeft size={18} />
              </button>
            )}
            {editing ? 'Edit profile' : blockedOpen ? 'Blocked users' : 'Settings'}
          </h2>
          <button onClick={onClose} className="text-(--c-aaa) hover:text-(--c-555) transition-colors"><X size={18} /></button>
        </div>

        {editing && (<>
        {/* Avatar preview + upload button */}
        <div className="flex flex-col items-center gap-2 mb-5">
          <Avatar name={preview.name} avatarUrl={preview.avatarUrl} size={80} />
          <label className="cursor-pointer text-xs font-medium text-(--c-2d6a4f) hover:text-(--c-245c43) transition-colors">
            Upload photo
            <input type="file" accept="image/*" className="hidden" onChange={handleFile} />
          </label>
        </div>

        {/* Banner — mobile's Settings → Profile. Shown sharp across the top
            of the profile, so the preview is the same 24:5 strip. */}
        <div className="mb-5 flex items-center gap-3">
          <div className="relative h-[25px] w-[120px] shrink-0 overflow-hidden rounded-lg bg-(--c-efebe5)">
            {ownProfile?.banner_url && (
              <img src={ownProfile.banner_url} alt="" className="absolute inset-0 h-full w-full object-cover" />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <p className="m-0 text-sm font-medium text-(--c-111)">Banner</p>
            <div className="mt-0.5 flex items-center gap-3 text-xs font-medium">
              {banner.busy ? (
                <VinylSpinner size={15} />
              ) : (
                <>
                  <label className="cursor-pointer text-(--c-2d6a4f) hover:text-(--c-245c43) transition-colors">
                    {ownProfile?.banner_url ? 'Change' : 'Upload'}
                    <input type="file" accept="image/*" className="hidden" onChange={banner.onFile} />
                  </label>
                  {ownProfile?.banner_url && (
                    <button type="button" onClick={() => banner.remove()} className="text-(--c-b91c1c) hover:underline underline-offset-2">
                      Remove
                    </button>
                  )}
                </>
              )}
            </div>
          </div>
        </div>

        <form onSubmit={handleSave} className="flex flex-col gap-3">
          <div>
            <label className="text-xs text-(--c-888) mb-1 block">Username</label>
            <input
              value={name}
              onChange={(e) => setName(cleanUsername(e.target.value))}
              placeholder="Pick a username"
              autoCapitalize="none"
              spellCheck={false}
              className="w-full bg-(--c-f5f5f5) border border-(--c-e2e2e2) text-(--c-111) text-sm px-4 py-2.5 rounded-lg focus:outline-none focus:border-(--c-2d6a4f) transition-colors"
            />
            <p className="text-[11px] text-(--c-999) mt-1">
              This is the name friends see — it doesn't have to be your real name.
            </p>
          </div>
          <div>
            <label className="text-xs text-(--c-888) mb-1 block">Bio</label>
            <textarea
              value={bio}
              onChange={(e) => setBio(e.target.value.slice(0, 240))}
              placeholder="A line about your taste…"
              rows={3}
              className="w-full bg-(--c-f5f5f5) border border-(--c-e2e2e2) text-(--c-111) text-sm px-4 py-2.5 rounded-lg focus:outline-none focus:border-(--c-2d6a4f) transition-colors resize-none"
            />
            <p className="text-[11px] text-(--c-999) mt-1 text-right">{bio.length}/240</p>
          </div>
          <div>
            <label className="text-xs text-(--c-888) mb-1 block">Location</label>
            <input
              value={locationValue}
              onChange={(e) => setLocation(e.target.value.slice(0, 40))}
              className="w-full bg-(--c-f5f5f5) border border-(--c-e2e2e2) text-(--c-111) text-sm px-4 py-2.5 rounded-lg focus:outline-none focus:border-(--c-2d6a4f) transition-colors"
            />
          </div>
          {(error ?? banner.error) && <p className="text-(--c-c0392b) text-xs">{error ?? banner.error}</p>}
          <button
            type="submit"
            disabled={loading || !name.trim()}
            className="w-full py-2.5 rounded-xl text-sm font-semibold bg-(--c-green-fill) hover:bg-(--c-green-fill-hover) text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {loading ? <><VinylSpinner size={16} /> Saving…</> : 'Save'}
          </button>
        </form>
        </>)}

        {!editing && blockedOpen && <BlockedList />}

        {!editing && !blockedOpen && (
        <div className="flex flex-col">
          {/* Mobile's Settings, section for section, less what only a phone has
              (notifications, haptics, which shelf Library opens on). */}
          <SectionLabel>Sign-in methods</SectionLabel>
          {providersLoading ? (
            <div className="flex justify-center py-3"><VinylSpinner size={24} /></div>
          ) : (
            <>
              <ProviderLine
                icon={<AppleLogo size={15} />}
                label="Apple"
                linked={!!providers?.apple}
                canUnlink={linkedCount > 1}
                onUnlink={() => unlink('apple')}
                // Sign in with Apple is iPhone-only here; web can only show it.
                connect={null}
              />
              <ProviderLine
                icon={<GoogleG />}
                label="Google"
                linked={!!providers?.google}
                canUnlink={linkedCount > 1}
                onUnlink={() => unlink('google')}
                connect={
                  <button onClick={() => googleLink()} className={SMALL_BTN}>Connect</button>
                }
              />
            </>
          )}

          <SectionLabel>Account</SectionLabel>
          {providers?.email && (
            <p className="m-0 truncate px-3 py-2 text-sm text-(--c-57534e)">{providers.email}</p>
          )}
          {/* Mobile's Settings → Account → Phone number. Only the last four
              digits ever come back: the number is stored as a keyed hash. */}
          {phoneVerifyConfigured && (
            <div className="flex w-full items-center gap-2 px-3 py-2">
              <span className="flex-1 text-sm font-medium text-(--c-111)">Phone number</span>
              {phoneBusy ? (
                <VinylSpinner size={16} />
              ) : activeUser.phoneLast4 ? (
                <>
                  <span className="text-sm tabular-nums text-(--c-57534e)">•••• {activeUser.phoneLast4}</span>
                  <button onClick={removeNumber} className="ml-2 text-sm font-semibold text-(--c-b91c1c) hover:underline underline-offset-2">
                    Remove
                  </button>
                </>
              ) : (
                <button onClick={() => setPhoneOpen(true)} className={SMALL_BTN}>Add</button>
              )}
            </div>
          )}
          <LinkLine label="Blocked users" onClick={() => setBlockedOpen(true)} />

          <SectionLabel>Preferences</SectionLabel>
          {/* Per browser, as it is per phone there. */}
          <div className="flex w-full items-center gap-2 px-3 py-2">
            <span className="flex-1 text-sm font-medium text-(--c-111)">Appearance</span>
            <div className="flex rounded-full bg-(--c-f0ebe3) p-0.5">
              {APPEARANCES.map((a) => (
                <button
                  key={a.key}
                  onClick={() => setAppearance(a.key)}
                  aria-pressed={appearance === a.key}
                  className={`rounded-full px-3 py-1 text-[12.5px] font-semibold transition-colors ${
                    appearance === a.key ? 'bg-(--c-green-fill) text-white' : 'text-(--c-57534e) hover:text-(--c-1c1917)'
                  }`}
                >
                  {a.label}
                </button>
              ))}
            </div>
          </div>

          <SectionLabel>About</SectionLabel>
          <LinkLine label="How Pressd works" onClick={() => { onClose(); navigate('/tutorial?replay=1') }} />
          <LinkLine label="Rate Pressd" href={RATE_URL} />
          <LinkLine label="Contact support" href={`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent('Pressd support')}`} />
          <LinkLine label="Privacy policy" onClick={() => { onClose(); navigate('/privacy') }} />
          {/* The last links before Sign out and Delete account, by request. */}
          <LinkLine label="Terms of use" onClick={() => { onClose(); navigate('/terms') }} />
          <LinkLine label="Community guidelines" onClick={() => { onClose(); navigate('/guidelines') }} />

          {error && <p className="m-0 mt-2 px-3 text-xs text-(--c-c0392b)">{error}</p>}
          <button
            onClick={handleSignOut}
            className="mt-4 w-full py-2 rounded-xl text-sm font-medium text-(--c-c0392b) hover:bg-(--c-fdf0ee) transition-colors"
          >
            Sign out
          </button>
          <button
            onClick={() => setConfirmDelete(true)}
            className="mt-1 w-full py-2 rounded-xl border border-(--c-b91c1c)/30 text-sm font-semibold text-(--c-b91c1c) hover:bg-(--c-fdf0ee) transition-colors"
          >
            Delete account
          </button>
        </div>
        )}
      </div>
      {confirmDelete && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center px-4">
          <div className="absolute inset-0 bg-black/40 fade-in" onClick={() => !deleting && setConfirmDelete(false)} />
          <div className="relative w-full max-w-sm rounded-2xl bg-(--c-fff) p-6 shadow-xl pop-in" role="alertdialog" aria-modal="true">
            <p className="m-0 font-display text-[20px] font-bold text-(--c-1c1917)">Delete your account?</p>
            <p className="m-0 mt-2 text-sm text-(--c-57534e)">
              Your ratings, reviews, library and friends are removed for good. This can’t be undone.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button onClick={() => setConfirmDelete(false)} disabled={deleting} className="rounded-full px-4 py-2 text-sm font-semibold text-(--c-57534e) hover:text-(--c-1c1917)">
                Cancel
              </button>
              <button onClick={handleDelete} disabled={deleting} className="flex items-center gap-2 rounded-full bg-(--c-b91c1c) px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">
                {deleting ? <VinylSpinner size={16} /> : null} Delete account
              </button>
            </div>
          </div>
        </div>
      )}
      {phoneOpen && <PhoneDialog mode="settings" onClose={() => setPhoneOpen(false)} />}
      {banner.cropper}
    </div>
  )
}
