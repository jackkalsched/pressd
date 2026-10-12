// Settings — your own account, opened from the top right of your profile
// (FriendProfile, when it's you) and, before that page existed, from the
// sidebar. Mobile's SettingsSheet, as a dialog: photo, banner, username and
// bio, phone number, Google link, the tutorial replay and sign-out.
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useGoogleLogin } from '@react-oauth/google'
import { ChevronRight, Loader2, X } from 'lucide-react'
import { useUser } from '../context/UserContext'
import { fetchProfile, updateUser, linkGoogle } from '../api'
import type { UserInfo } from '../api'
import { cleanUsername } from '../types'
import Avatar from './Avatar'
import PhoneDialog from './PhoneDialog'
import { phoneVerifyConfigured } from '../lib/phoneVerify'
import { useBanner } from '../lib/useBanner'

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

export default function SettingsDialog({ onClose }: { onClose: () => void }) {
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
  const [name, setName] = useState(activeUser?.name ?? '')
  const [avatarUrl, setAvatarUrl] = useState(activeUser?.avatarUrl ?? '')
  const [bio, setBio] = useState(activeUser?.bio ?? '')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const banner = useBanner(activeUser?.id)

  // The banner lives on the profile, not the session: the ['profile', id]
  // query the profile page draws from, so a change shows at once.
  const { data: ownProfile } = useQuery({
    queryKey: ['profile', activeUser?.id],
    queryFn: () => fetchProfile(activeUser!.id),
    enabled: !!activeUser,
    staleTime: 60_000,
  })

  const googleLink = useGoogleLogin({
    onSuccess: async (tokenResponse) => {
      setError(null)
      try {
        // Links to whoever the stored session token belongs to; the server no
        // longer accepts a user id from the client here.
        const user = await linkGoogle(tokenResponse.access_token)
        setActiveUser({ ...activeUser, id: user.id, name: user.name, avatarUrl: user.avatarUrl, tutorialSeen: user.tutorialSeen, usernameChosen: user.usernameChosen })
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
      })
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
      <div className="relative bg-white border border-[#e2e2e2] rounded-2xl p-6 w-full max-w-sm mx-4 shadow-xl pop-in">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-[#111] font-semibold">Settings</h2>
          <button onClick={onClose} className="text-[#aaa] hover:text-[#555] transition-colors"><X size={18} /></button>
        </div>

        {/* Avatar preview + upload button */}
        <div className="flex flex-col items-center gap-2 mb-5">
          <Avatar name={preview.name} avatarUrl={preview.avatarUrl} size={80} />
          <label className="cursor-pointer text-xs font-medium text-[#2d6a4f] hover:text-[#245c43] transition-colors">
            Upload photo
            <input type="file" accept="image/*" className="hidden" onChange={handleFile} />
          </label>
        </div>

        {/* Banner — mobile's Settings → Profile. Shown sharp across the top
            of the profile, so the preview is the same 24:5 strip. */}
        <div className="mb-5 flex items-center gap-3">
          <div className="relative h-[25px] w-[120px] shrink-0 overflow-hidden rounded-lg bg-[#efebe5]">
            {ownProfile?.banner_url && (
              <img src={ownProfile.banner_url} alt="" className="absolute inset-0 h-full w-full object-cover" />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <p className="m-0 text-sm font-medium text-[#111]">Banner</p>
            <div className="mt-0.5 flex items-center gap-3 text-xs font-medium">
              {banner.busy ? (
                <Loader2 size={13} className="animate-spin text-[#2d6a4f]" />
              ) : (
                <>
                  <label className="cursor-pointer text-[#2d6a4f] hover:text-[#245c43] transition-colors">
                    {ownProfile?.banner_url ? 'Change' : 'Upload'}
                    <input type="file" accept="image/*" className="hidden" onChange={banner.onFile} />
                  </label>
                  {ownProfile?.banner_url && (
                    <button type="button" onClick={() => banner.remove()} className="text-[#b91c1c] hover:underline underline-offset-2">
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
            <label className="text-xs text-[#888] mb-1 block">Username</label>
            <input
              value={name}
              onChange={(e) => setName(cleanUsername(e.target.value))}
              placeholder="Pick a username"
              autoCapitalize="none"
              spellCheck={false}
              className="w-full bg-[#f5f5f5] border border-[#e2e2e2] text-[#111] text-sm px-4 py-2.5 rounded-lg focus:outline-none focus:border-[#2d6a4f] transition-colors"
            />
            <p className="text-[11px] text-[#999] mt-1">
              This is the name friends see — it doesn't have to be your real name.
            </p>
          </div>
          <div>
            <label className="text-xs text-[#888] mb-1 block">Bio</label>
            <textarea
              value={bio}
              onChange={(e) => setBio(e.target.value.slice(0, 240))}
              placeholder="A line about your taste…"
              rows={3}
              className="w-full bg-[#f5f5f5] border border-[#e2e2e2] text-[#111] text-sm px-4 py-2.5 rounded-lg focus:outline-none focus:border-[#2d6a4f] transition-colors resize-none"
            />
            <p className="text-[11px] text-[#999] mt-1 text-right">{bio.length}/240</p>
          </div>
          {(error ?? banner.error) && <p className="text-[#c0392b] text-xs">{error ?? banner.error}</p>}
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
          {/* Mobile's Settings → Account → Phone number. Only the last four
              digits ever come back: the number is stored as a keyed hash. */}
          {phoneVerifyConfigured && (
            <div className="flex w-full items-center gap-2 px-3 py-2">
              <span className="flex-1 text-sm font-medium text-[#111]">Phone number</span>
              {phoneBusy ? (
                <Loader2 size={14} className="animate-spin text-[#2d6a4f]" />
              ) : activeUser.phoneLast4 ? (
                <>
                  <span className="text-sm tabular-nums text-[#57534e]">•••• {activeUser.phoneLast4}</span>
                  <button onClick={removeNumber} className="ml-2 text-sm font-semibold text-[#b91c1c] hover:underline underline-offset-2">
                    Remove
                  </button>
                </>
              ) : (
                <button
                  onClick={() => setPhoneOpen(true)}
                  className="rounded-full border border-[#e2dbd0] bg-white px-3 py-1 text-[13px] font-semibold text-[#2d6a4f] hover:border-[#2d6a4f]"
                >
                  Add
                </button>
              )}
            </div>
          )}
          {/* Mobile's Settings → How Pressd works. This dialog is the web's
              settings surface, so the replay lives here. */}
          <button
            onClick={() => { onClose(); navigate('/tutorial?replay=1') }}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-left hover:bg-[#f5f5f5] transition-colors"
          >
            <span className="flex-1 min-w-0">
              <span className="block text-sm font-medium text-[#111]">How Pressd works</span>
              <span className="block text-xs text-[#999]">Replay the intro</span>
            </span>
            <ChevronRight size={16} className="text-[#bbb]" />
          </button>
          <button
            onClick={handleSignOut}
            className="w-full py-2 rounded-xl text-sm font-medium text-[#c0392b] hover:bg-[#fdf0ee] transition-colors"
          >
            Sign out
          </button>
        </div>
      </div>
      {phoneOpen && <PhoneDialog mode="settings" onClose={() => setPhoneOpen(false)} />}
      {banner.cropper}
    </div>
  )
}
