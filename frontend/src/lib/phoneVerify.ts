// Verifying a phone number with Firebase Phone Auth, on web — the counterpart
// of mobile/lib/phoneVerify.ts.
//
// Firebase texts the code and checks it; Pressd only sees the ID token that
// comes back and reads the number out of it on the server (backend/phone.py).
// The Firebase sign-in exists to produce that token and is signed out as soon
// as it has. In the browser Firebase also needs a reCAPTCHA, run invisibly in
// an empty element of its own beside the button — not on the button, whose
// contents `clear()` would take with it.
//
// Configured by the web app's Firebase config (Firebase console → Project
// settings → Your apps → Web). Without it the phone UI stays hidden rather than
// offering a step that can't work. The site's domains (pressdmusic.com, and
// localhost for development) must be in Authentication → Settings → Authorized
// domains.
import { initializeApp, type FirebaseApp } from 'firebase/app'
import { getAuth, getIdToken, RecaptchaVerifier, signInWithPhoneNumber, signOut } from 'firebase/auth'

const config = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY as string | undefined,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN as string | undefined,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID as string | undefined,
  appId: import.meta.env.VITE_FIREBASE_APP_ID as string | undefined,
}

export const phoneVerifyConfigured = Object.values(config).every(Boolean)

let app: FirebaseApp | null = null
function auth() {
  // Named, so it can never collide with another Firebase app on the page.
  app ??= initializeApp(config, 'pressd-phone')
  return getAuth(app)
}

function explain(e: unknown): string {
  const code = typeof e === 'object' && e && 'code' in e ? String((e as { code: unknown }).code) : ''
  if (code.includes('invalid-phone-number')) return 'That doesn’t look like a phone number.'
  if (code.includes('invalid-verification-code')) return 'That code isn’t right. Check the text and try again.'
  if (code.includes('code-expired')) return 'That code has expired. Send a new one.'
  if (code.includes('too-many-requests') || code.includes('quota-exceeded')) return 'Too many tries. Wait a little and try again.'
  if (code.includes('network')) return 'Couldn’t reach the network. Check your connection.'
  console.warn('Phone verification failed', code, e)
  return 'Couldn’t verify that number. Please try again.'
}

export class PhoneVerifyError extends Error {}

/** Texts a code to `e164`, with the invisible reCAPTCHA in the empty element
 *  `containerId` names. Returns the step that checks the code, which resolves
 *  to the ID token Pressd's server takes. */
export async function sendPhoneCode(e164: string, containerId: string): Promise<(code: string) => Promise<string>> {
  if (!phoneVerifyConfigured) throw new PhoneVerifyError('Phone numbers aren’t available yet.')
  const a = auth()
  const verifier = new RecaptchaVerifier(a, containerId, { size: 'invisible' })
  let confirmation
  try {
    confirmation = await signInWithPhoneNumber(a, e164, verifier)
  } catch (e) {
    throw new PhoneVerifyError(explain(e))
  } finally {
    // A verifier is good for one send; a new code gets a new one.
    verifier.clear()
  }
  return async (code: string) => {
    try {
      const cred = await confirmation.confirm(code.trim())
      return await getIdToken(cred.user)
    } catch (e) {
      throw new PhoneVerifyError(explain(e))
    } finally {
      signOut(a).catch(() => {})
    }
  }
}
