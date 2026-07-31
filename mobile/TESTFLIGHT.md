# Shipping Pressd to TestFlight (Xcode path)

The app is built with Expo but uses a **bare native iOS project** (`mobile/ios/`),
so archiving and uploading happens in Xcode rather than EAS. This is the checklist
for getting a build in front of external beta testers.

Status as of 2026-07-30: the code side is ready. Everything left is Apple account
and App Store Connect work.

---

## Ready (verified)

- `mobile/.env.production` points at `https://pressd-backend.onrender.com` (live,
  `/docs` returns 200). Verified inlined into the Release bundle.
- Release bundling reads `.env.production`, not `.env` — the React Native build
  phase sets `NODE_ENV=production`, and Expo prefers `.env.production` when it does.
  The dev-token sign-in backdoor is blanked there, so it does not ship.
- Sign in with Apple works end to end: entitlement in `ios/Pressd/Pressd.entitlements`,
  button in `app/sign-in.tsx`, `POST /auth/apple` in `backend/routers/auth.py`
  verifying against Apple's JWKS, `apple_sub` column migrated in `backend/database.py`.
  This is the only sign-in path in Release — the Google iOS OAuth client was never
  created, so that button hides itself.
- App icon is 1024×1024 with no alpha channel (App Store rejects alpha).
- `ITSAppUsesNonExemptEncryption=false` is in Info.plist, so uploads skip the export
  compliance prompt.
- Bundle id `com.pressd.app`, deployment target iOS 16.4, scheme's Archive action
  uses Release.

## Blocking

### 1. Apple Developer Program enrollment ($99/yr) — start this first

This Mac only has "Apple Development" certificates, which free Apple IDs also get.
TestFlight needs a paid membership. Enroll at
<https://developer.apple.com/programs/enroll/>. **Approval can take 24–48 hours**,
occasionally longer if Apple asks for ID verification, so nothing below can happen
until it clears.

### 2. Privacy policy URL + App Privacy questionnaire

Required before a build can go to **external** testers (internal testers on your own
team are exempt). pressdmusic.com has no privacy page yet — needs a `/privacy` route
in `frontend/src/App.tsx` and a public URL to paste into App Store Connect.

The questionnaire needs honest answers about what Pressd collects. Currently that is:
name and email (via Sign in with Apple), user-generated content (ratings, reviews,
comments), and the social graph. No analytics SDK, no ads, no tracking across apps.

---

## Xcode path, step by step

Once enrollment clears:

### Register the app

1. Xcode → Settings → Accounts → add the Apple ID, confirm the paid team appears.
2. App Store Connect → Apps → **+** → New App. Platform iOS, bundle ID
   `com.pressd.app` (it appears in the dropdown once Xcode has registered it),
   SKU anything (e.g. `pressd-ios`), name "Pressd".
   - If the name is taken, the App Store name can differ from the on-device name.

### Configure signing

3. Open `mobile/ios/Pressd.xcworkspace` (**the workspace, not the .xcodeproj** —
   CocoaPods).
4. Select the Pressd target → Signing & Capabilities → check "Automatically manage
   signing" → pick your team. Xcode creates the Apple Distribution cert and App Store
   provisioning profile. Confirm "Sign in with Apple" is listed under Capabilities;
   automatic signing enables it on the App ID for you.
   - `ios/` is gitignored, so this setting is **not** committed and is lost on a
     `npx expo prebuild --clean`. See the prebuild note below.

### Archive and upload

5. Set the run destination to **Any iOS Device (arm64)** — Archive is greyed out
   while a simulator is selected.
6. Product → Archive. First archive takes a while; it compiles all pods.
7. In the Organizer window that opens: Distribute App → App Store Connect → Upload.
   Accept the defaults (bundle symbols, upload symbols).
8. Processing on Apple's side takes 5–30 minutes. You'll get an email when the build
   finishes processing or if it's rejected.

### Bump before every subsequent upload

Apple rejects a build whose `CFBundleVersion` matches one already uploaded. Increment
`CFBundleVersion` in `ios/Pressd/Info.plist` (currently `1`) for each upload;
`CFBundleShortVersionString` (`1.0.0`) only changes for user-visible releases.

### Distribute to testers

9. App Store Connect → your app → TestFlight → select the build.
10. Answer the export compliance question if prompted (it should be skipped — see
    `ITSAppUsesNonExemptEncryption` above).
11. **Internal testing**: add up to 100 Apple IDs that are members of your App Store
    Connect team. No review, available immediately. Good for a first smoke test.
12. **External testing**: create a group, add testers by email, then submit for
    **Beta App Review**. Needs a beta description, feedback email, and the App Privacy
    answers above. Review usually takes 24–48 hours for a first build; later builds in
    the same version are typically auto-approved.
13. Testers install the TestFlight app and redeem the invite link.

---

## Enabling Google sign-in — do this BEFORE inviting testers

As of 2026-07-31 the database holds 25 users: **22 authenticate with Google, none
with Apple.** Apple is currently the only way into the app, and an Apple sign-in
reaches an existing account only when the Apple ID's email is byte-identical to the
Google address on file — or not at all if the tester picks "Hide My Email".

Most of those 22 are `@gmail.com` accounts whose Apple ID is likely `@icloud.com`, so
the realistic outcome of inviting them today is that they land in a **new, empty
account** with no way to reach their real library, because Google sign-in is not
available to escape to.

With the iOS client in place they hit a direct `google_sub` lookup instead — the same
path the website uses — and get their account with no email matching involved. They
can then link Apple from Settings and use either method afterwards.

## How to enable Google sign-in

Apple and Google are interchangeable by design — `POST /auth/google` and
`POST /auth/apple` in `backend/routers/auth.py` run the same four-step resolution
(provider-sub lookup → explicit link via `link_user_id` → match on email → create),
so the same person lands on the same account either way. Nothing on the backend or
in the app needs to change.

The only missing piece is an **iOS OAuth client**, which does not exist yet. The web
client the website uses cannot be reused: Google rejects a native custom-scheme
redirect from a web client type.

1. Google Cloud Console → APIs & Services → Credentials, in the **same project** as
   the existing web client `459747258455-…`.
2. Create Credentials → OAuth client ID → Application type **iOS**.
3. Bundle ID: `com.pressd.app`. Leave App Store ID and Team ID blank — they only
   matter for Google's app-install attribution.
4. Copy the generated client ID into **both** `mobile/.env` and
   `mobile/.env.production` as `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID`.
5. Rebuild. `EXPO_PUBLIC_*` values are inlined at bundle time, so a running Metro
   server will not pick this up — restart it.

This should need no Info.plist change: the installed `expo-auth-session` builds its
redirect as `com.pressd.app:/oauthredirect` (see `providers/Google.js`), and
`com.pressd.app` is already registered under `CFBundleURLSchemes`. Google's iOS client
type accepts a bundle-id scheme as well as the reversed-client-id one.

Untested until the client id exists, though. If Google rejects the redirect with
`redirect_uri_mismatch`, add the reversed client id
(`com.googleusercontent.apps.<id>`) to `scheme` in `app.json` and to
`CFBundleURLSchemes` in `ios/Pressd/Info.plist` — both, since `ios/` is gitignored
and regenerated separately.

The sign-in screen gates the Google button on this variable being non-empty
(`app/sign-in.tsx`), because `Google.useAuthRequest` throws on native when no
platform client id is set. Filling it in is the whole change.

### Known gap: Apple's Hide My Email creates a second account

If someone signs in with Apple and picks **Hide My Email**, Apple sends a relay
address (`…@privaterelay.appleid.com`) instead of their real one. If that same person
later signs in with Google, the email-match step cannot connect the two, and they get
a **second, empty account** — different library, different ratings.

This is inherent to private relay, not a bug in the resolution logic, and it only
affects users who mix providers. Options, in increasing order of effort:

- Tell beta testers to pick one method and stick with it (fine for a small beta).
- Add a "link Google account" action in Profile — the backend already accepts
  `link_user_id` on both endpoints specifically for this, so it is UI-only work.
- Merge duplicates manually in the DB if a tester reports it.

---

## Notes and gotchas

- **Never run `npx expo prebuild --clean`** without expecting to redo step 4. It
  regenerates `ios/` from scratch and drops the team/signing config. Since `ios/` is
  gitignored there is no committed copy to restore from.
- `ios/.xcode.env.local` hardcodes `NODE_BINARY=/usr/local/Cellar/node/25.1.0/bin/node`.
  A Homebrew node upgrade will break the bundle build phase with a confusing error;
  repoint it if that happens.
- `expo-doctor` reports duplicate `react` (19.2.3 in `mobile/`, 19.2.7 at the repo
  root for the website) and ~15 Expo packages behind by a patch version. Neither
  blocks the build — the production export and a Release compile both pass. Worth
  cleaning up after the first TestFlight build lands, not before.
- The Render backend is on the **free plan**, which sleeps after inactivity. A tester's
  first request can take ~50 seconds to wake it. Consider upgrading before inviting
  people, or they'll read the cold start as the app being broken.
