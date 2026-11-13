import { APP_STORE_URL } from '@pressd/shared/types'

// Where "Download on the App Store" goes. Pressd is out on iOS, so the listing
// is a constant rather than an env var that, unset, would leave the public
// pages saying "coming soon"; VITE_IOS_APP_URL still overrides it (a TestFlight
// link for a preview deploy, say). The landing page's QR code
// (public/app/qr-code.png) is Apple's own, from App Store Connect: it encodes
// an apple.co short link to this listing, so scans are counted there. One
// constant so the two public pages can't disagree.
export const IOS_APP_URL: string = import.meta.env.VITE_IOS_APP_URL || APP_STORE_URL

/** Link props for an iPhone-app call to action: out to the listing, in a new tab. */
export const IOS_APP_LINK = { href: IOS_APP_URL, target: '_blank', rel: 'noopener noreferrer' } as const
