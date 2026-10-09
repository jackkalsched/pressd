// Sign in with Apple, for the sign-in screen and Settings' "Connect".
//
// App Review (build 5, iOS/iPadOS 27) reported that the button did nothing.
// Reproduced on the 26.2 simulators: on a device with no Apple Account, the tap
// sends the person to Settings to sign in, and the original request comes back
// as ASAuthorizationError 1000 ("unknown"); the next tap works. A cancel (1001)
// also arrives for more than a tapped Cancel, and was swallowed silently. So
// every failure now puts a line on screen saying what to do, and is logged.
import * as AppleAuthentication from 'expo-apple-authentication'

export interface AppleCredential {
  identityToken: string
  fullName?: string
}

export class AppleSignInError extends Error {}

type Failure = 'canceled' | 'unknown' | 'other'

/** The module's error code didn't reach JS in a Release build (it logged
 *  `undefined`), so the message — fixed strings in the native module — is the
 *  fallback. */
function classify(e: unknown): Failure {
  const code = typeof e === 'object' && e && 'code' in e ? String((e as { code: unknown }).code) : ''
  const message = e instanceof Error ? e.message : String(e)
  if (code === 'ERR_REQUEST_CANCELED' || /canceled/i.test(message)) return 'canceled'
  if (code === 'ERR_REQUEST_UNKNOWN' || /unknown reason/i.test(message)) return 'unknown'
  return 'other'
}

/** Shows Apple's sheet; throws an AppleSignInError worded for the screen. */
export async function requestAppleCredential(): Promise<AppleCredential> {
  let cred: AppleAuthentication.AppleAuthenticationCredential
  try {
    cred = await AppleAuthentication.signInAsync({
      requestedScopes: [
        AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
        AppleAuthentication.AppleAuthenticationScope.EMAIL,
      ],
    })
  } catch (e) {
    const failure = classify(e)
    console.warn('Sign in with Apple failed', failure, e instanceof Error ? e.message : e)
    if (failure === 'canceled') throw new AppleSignInError('Sign in with Apple was canceled.')
    throw new AppleSignInError(
      failure === 'unknown'
        ? 'Sign in with Apple didn’t go through. If you just signed in to your Apple Account, tap Sign in with Apple again.'
        : 'Sign in with Apple didn’t go through. Please try again.',
    )
  }
  if (!cred.identityToken) {
    console.warn('Sign in with Apple returned no identity token')
    throw new AppleSignInError('Apple didn’t send back a sign-in token. Please try again.')
  }
  const fullName = [cred.fullName?.givenName, cred.fullName?.familyName].filter(Boolean).join(' ') || undefined
  return { identityToken: cred.identityToken, fullName }
}
