// Username — the first page a new account meets, before the tutorial. The web
// port of mobile/app/username.tsx: the server starts every account on a
// suggestion made from the Google name or email (backend/usernames.py), so
// this opens prefilled; Continue saves it, changed or not, and saving is what
// stamps PressUser.username_chosen_at.
//
// App's AppGate sends only an explicit usernameChosen === false here, so
// accounts from before this step never see it.
import { useState, type FormEvent } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { useUser } from '../context/UserContext'
import { updateUser } from '../api'
import { cleanUsername, USERNAME_RE } from '../types'

export default function Username() {
  const navigate = useNavigate()
  const { activeUser, setActiveUser } = useUser()
  const [value, setValue] = useState(() => cleanUsername(activeUser?.name ?? ''))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const valid = USERNAME_RE.test(value)

  // Someone who has already chosen and typed the URL has nothing to do here.
  if (activeUser && activeUser.usernameChosen !== false) return <Navigate to="/for-you" replace />

  async function save(e: FormEvent) {
    e.preventDefault()
    if (!activeUser || !valid || saving) return
    setSaving(true)
    setError(null)
    try {
      const updated = await updateUser(activeUser.id, { name: value })
      setActiveUser({ ...activeUser, name: updated.name, usernameChosen: true })
      navigate('/for-you', { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save your username')
      setSaving(false)
    }
  }

  return (
    <div className="min-h-screen bg-[#faf8f5] flex items-center justify-center px-4">
      <form onSubmit={save} className="page-enter w-full max-w-[420px] flex flex-col items-center">
        <p className="m-0 text-[11px] font-bold tracking-[0.18em] text-[#2d6a4f]">WELCOME TO PRESSD</p>
        <h1 className="font-display m-0 mt-2 text-[34px] leading-[40px] md:text-[44px] md:leading-[50px] font-bold tracking-[-0.01em] text-[#1c1917] text-center">
          Pick a username.
        </h1>

        <label
          className={`mt-8 w-full flex items-center gap-0.5 h-[52px] px-4 rounded-xl bg-white border transition-colors focus-within:border-[#2d6a4f] ${
            error ? 'border-[#c0392b]' : valid ? 'border-[#2d6a4f]' : 'border-[#e7e1d8]'
          }`}
        >
          <span className="text-[16px] font-semibold text-[#a8998a]">@</span>
          <input
            value={value}
            onChange={(e) => {
              setValue(cleanUsername(e.target.value))
              setError(null)
            }}
            autoFocus
            autoCapitalize="none"
            autoComplete="username"
            spellCheck={false}
            maxLength={20}
            placeholder="username"
            aria-label="Username"
            className="flex-1 min-w-0 bg-transparent text-[16px] font-semibold text-[#1c1917] placeholder:text-[#a8998a] focus:outline-none"
          />
        </label>
        {error && <p className="m-0 mt-2 text-[12.5px] text-[#c0392b] text-center">{error}</p>}

        <button
          type="submit"
          disabled={!valid || saving}
          className="w-full mt-6 h-[52px] rounded-xl text-[15px] font-semibold bg-[#2d6a4f] hover:bg-[#245c43] active:bg-[#1e5238] text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#2d6a4f]"
        >
          {saving ? <Loader2 size={18} className="animate-spin" /> : 'Continue'}
        </button>
      </form>
    </div>
  )
}
