// Verifying a phone number with Firebase Phone Auth, for the phone sheet.
//
// Firebase texts the code and checks it; Pressd only ever sees the ID token
// that comes back, and reads the number out of it on the server
// (backend/phone.py). The Firebase sign-in is a means to that token and
// nothing else, so it is signed out the moment the token is in hand.
//
// iOS: Firebase verifies the app with a silent push (the APNs key already
// uploaded for notifications) and falls back to a reCAPTCHA page, which needs
// the encoded app id and reversed client id as URL schemes — both are in
// ios/Pressd/Info.plist. Phone sign-in has to be switched on in the Firebase
// console (Authentication → Sign-in method → Phone).
import { getAuth, getIdToken, signInWithPhoneNumber, signOut } from '@react-native-firebase/auth'

/** Firebase's codes, in words someone can act on. */
function explain(e: unknown): string {
  const code = typeof e === 'object' && e && 'code' in e ? String((e as { code: unknown }).code) : ''
  if (code.includes('invalid-phone-number')) return 'That doesn’t look like a phone number.'
  if (code.includes('invalid-verification-code')) return 'That code isn’t right. Check the text and try again.'
  if (code.includes('code-expired') || code.includes('session-expired')) return 'That code has expired. Send a new one.'
  if (code.includes('too-many-requests') || code.includes('quota-exceeded')) return 'Too many tries. Wait a little and try again.'
  if (code.includes('network')) return 'Couldn’t reach the network. Check your connection.'
  console.warn('Phone verification failed', code, e instanceof Error ? e.message : e)
  return 'Couldn’t verify that number. Please try again.'
}

export class PhoneVerifyError extends Error {}

/** Texts a code to `e164`. Returns the step that checks it, which resolves to
 *  the ID token Pressd's server takes. */
export async function sendPhoneCode(e164: string): Promise<(code: string) => Promise<string>> {
  const auth = getAuth()
  let confirmation
  try {
    confirmation = await signInWithPhoneNumber(auth, e164)
  } catch (e) {
    throw new PhoneVerifyError(explain(e))
  }
  return async (code: string) => {
    try {
      const cred = await confirmation.confirm(code.trim())
      if (!cred?.user) throw new PhoneVerifyError('Couldn’t verify that number. Please try again.')
      return await getIdToken(cred.user)
    } catch (e) {
      if (e instanceof PhoneVerifyError) throw e
      throw new PhoneVerifyError(explain(e))
    } finally {
      signOut(auth).catch(() => {})
    }
  }
}
