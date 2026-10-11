// Adding a phone number: the number, then the texted code — mobile's
// PhoneSheet, as a dialog.
//
// `prompt` is the one-time ask every account meets once (mounted in Layout):
// it says why and offers "Not now", which is recorded as a skip. Like mobile's,
// it can't be dismissed by clicking outside — it appears once, and a stray
// click would record a decision nobody made. `settings` is the same flow from
// the Edit Profile dialog, closable like any other.
//
// The number goes to Firebase, never to Pressd (lib/phoneVerify.ts,
// backend/phone.py).
import { useRef, useState } from 'react'
import { Loader2, Phone, X } from 'lucide-react'
import { toE164 } from '../api'
import { useUser } from '../context/UserContext'
import { sendPhoneCode } from '../lib/phoneVerify'

const RECAPTCHA_ID = 'phone-recaptcha'

/** +15551234567 → +1 (555) 123-4567, for saying where the code went. */
function pretty(e164: string): string {
  const m = e164.match(/^\+1(\d{3})(\d{3})(\d{4})$/)
  return m ? `+1 (${m[1]}) ${m[2]}-${m[3]}` : e164
}

const INPUT =
  'w-full rounded-xl border border-[#e2dbd0] bg-white px-4 py-3 text-[16px] text-[#1c1917] placeholder:text-[#b5aa9c] focus:border-[#2d6a4f] focus:outline-none transition-colors'
const PRIMARY =
  'flex h-12 w-full items-center justify-center gap-2 rounded-full bg-[#2d6a4f] text-[15px] font-semibold text-white hover:bg-[#245c43] disabled:opacity-50'

export default function PhoneDialog({ mode, onClose }: { mode: 'prompt' | 'settings'; onClose: () => void }) {
  const { addPhoneNumber, skipPhoneNumber } = useUser()
  const [step, setStep] = useState<'number' | 'code'>('number')
  const [number, setNumber] = useState('')
  const [code, setCode] = useState('')
  const [sentTo, setSentTo] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const confirmRef = useRef<((code: string) => Promise<string>) | null>(null)
  const prompt = mode === 'prompt'

  async function send(to: string) {
    setBusy(true)
    setError(null)
    try {
      confirmRef.current = await sendPhoneCode(to, RECAPTCHA_ID)
      setSentTo(to)
      setCode('')
      setStep('code')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Couldn’t send a code')
    } finally {
      setBusy(false)
    }
  }

  function submitNumber(e: React.FormEvent) {
    e.preventDefault()
    const e164 = toE164(number)
    if (!e164) {
      setError('Enter a 10-digit number, or start with + and the country code.')
      return
    }
    send(e164)
  }

  async function submitCode(e: React.FormEvent) {
    e.preventDefault()
    if (!confirmRef.current || code.length < 6) return
    setBusy(true)
    setError(null)
    try {
      const token = await confirmRef.current(code)
      await addPhoneNumber(token)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Couldn’t verify that code')
    } finally {
      setBusy(false)
    }
  }

  function notNow() {
    skipPhoneNumber()
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm fade-in" onClick={prompt ? undefined : onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="phone-title"
        className="relative w-full max-w-sm rounded-3xl bg-[#f9f8f6] p-7 shadow-xl pop-in"
      >
        <div className="flex items-center justify-between">
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-[#2d6a4f]/10">
            <Phone size={18} color="#2d6a4f" />
          </span>
          {!prompt && (
            <button onClick={onClose} aria-label="Close" className="text-[#a8998a] hover:text-[#57534e]">
              <X size={18} />
            </button>
          )}
        </div>

        {step === 'number' ? (
          <form onSubmit={submitNumber}>
            <h2 id="phone-title" className="font-display m-0 mt-4 text-[28px] font-bold leading-tight text-[#1c1917]">
              {prompt ? 'Add your phone number' : 'Phone number'}
            </h2>
            <p className="m-0 mt-2 text-[14.5px] leading-relaxed text-[#57534e]">
              Pressd uses it to help your friends find you, and to make sharing records with them easier.
              It’s never shown on your profile.
            </p>
            <input
              className={`${INPUT} mt-5`}
              value={number}
              onChange={(e) => { setNumber(e.target.value); setError(null) }}
              placeholder="(555) 123-4567"
              type="tel"
              autoComplete="tel"
              autoFocus={!prompt}
              disabled={busy}
              aria-label="Phone number"
            />
            {error && <p className="m-0 mt-2 text-[13px] text-[#b91c1c]">{error}</p>}
            <button type="submit" className={`${PRIMARY} mt-5`} disabled={busy || !number.trim()}>
              {busy ? <Loader2 size={16} className="animate-spin" /> : 'Text me a code'}
            </button>
            {prompt && (
              <button
                type="button"
                onClick={notNow}
                disabled={busy}
                className="mt-2 h-11 w-full rounded-full text-[14.5px] font-semibold text-[#78716c] hover:bg-[#efebe5]"
              >
                Not now
              </button>
            )}
          </form>
        ) : (
          <form onSubmit={submitCode}>
            <h2 id="phone-title" className="font-display m-0 mt-4 text-[28px] font-bold leading-tight text-[#1c1917]">
              Enter the code
            </h2>
            <p className="m-0 mt-2 text-[14.5px] leading-relaxed text-[#57534e]">
              We texted a 6-digit code to {sentTo ? pretty(sentTo) : 'your phone'}.
            </p>
            <input
              className={`${INPUT} mt-5 text-center text-[22px] font-semibold tracking-[0.4em]`}
              value={code}
              onChange={(e) => { setCode(e.target.value.replace(/\D/g, '').slice(0, 6)); setError(null) }}
              placeholder="000000"
              inputMode="numeric"
              autoComplete="one-time-code"
              autoFocus
              disabled={busy}
              aria-label="Verification code"
            />
            {error && <p className="m-0 mt-2 text-[13px] text-[#b91c1c]">{error}</p>}
            <button type="submit" className={`${PRIMARY} mt-5`} disabled={busy || code.length < 6}>
              {busy ? <Loader2 size={16} className="animate-spin" /> : 'Verify'}
            </button>
            <div className="mt-4 flex justify-between text-[14px] font-semibold text-[#2d6a4f]">
              <button type="button" onClick={() => { setStep('number'); setError(null) }} disabled={busy} className="hover:underline underline-offset-2">
                Change number
              </button>
              <button type="button" onClick={() => sentTo && send(sentTo)} disabled={busy || !sentTo} className="hover:underline underline-offset-2">
                Send a new code
              </button>
            </div>
          </form>
        )}
        {/* Firebase's invisible reCAPTCHA lives here (lib/phoneVerify.ts). */}
        <div id={RECAPTCHA_ID} />
      </div>
    </div>
  )
}
