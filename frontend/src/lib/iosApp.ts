// Where "Get the iPhone app" goes: a TestFlight public link or the App Store
// listing, set as VITE_IOS_APP_URL. Unset — which it is until the beta has a
// public link — the landing page's buttons scroll to its showcase instead and
// the public pages keep saying the beta is coming, rather than offering a
// download that isn't there. One constant so the two pages can't disagree.
export const IOS_APP_URL: string | undefined = import.meta.env.VITE_IOS_APP_URL || undefined

/** Link props for an iPhone-app call to action: out to the listing in a new
 *  tab when there is one, otherwise to `fallback` on the same page. */
export function iosAppLink(fallback: string): { href: string; target?: string; rel?: string } {
  return IOS_APP_URL
    ? { href: IOS_APP_URL, target: '_blank', rel: 'noopener noreferrer' }
    : { href: fallback }
}
