// Privacy policy — a public page (no auth) because App Store Connect requires a
// reachable Privacy Policy URL before a build can go to external TestFlight
// testers, and Apple's reviewers open it while signed out.
//
// Every claim here is meant to describe what the code actually does. If you
// change what is collected or which third party sees it, change this page in
// the same commit. Notable couplings:
//   - backend/models.py           what is stored per user
//   - backend/routers/auth.py     what Google / Apple hand over
//   - theme_predictor/predictor.py what is sent to Anthropic (album text only)
//   - mobile/lib/push.ts           the device token sent for notifications
//   - mobile/app.json              which Firebase SDKs are bundled
import LegalPage from '../components/LegalPage'

const UPDATED = 'August 30, 2026'
const CONTACT = 'pressdmusicapp@gmail.com'

export default function Privacy() {
  return (
    <LegalPage>
        <h1>Privacy Policy</h1>
        <p className="updated">Last updated {UPDATED}</p>

        <p className="lede">
          Pressd is a small, independently run app for rating albums and tracking your taste.
          This policy describes exactly what it stores, who else can see it, and how to get rid
          of it. There is no advertising, no analytics or tracking SDK, and nothing about you is
          sold or shared for marketing.
        </p>

        <h2>What we collect</h2>

        <h3>Account information</h3>
        <p>
          You sign in with Google or Apple. Pressd never sees or stores your password. From the
          provider we receive and store:
        </p>
        <ul>
          <li>A <strong>unique account identifier</strong> from Google or Apple, used to recognize you on return visits.</li>
          <li>Your <strong>email address</strong>, used to identify your account and connect you with people who invite you. If you use Sign in with Apple and choose <strong>Hide My Email</strong>, we only ever receive Apple's private relay address.</li>
          <li>Your <strong>name</strong>, which becomes your initial display name and is visible to other users.</li>
        </ul>

        <h3>Content you create</h3>
        <ul>
          <li>Album and song ratings, scores, and listening status.</li>
          <li>Written reviews and comments.</li>
          <li>Likes on other people's reviews.</li>
          <li>Your display name, optional bio, and optional profile photo.</li>
          <li>Your friend connections, and any invitations you send (including the email address you send them to).</li>
        </ul>

        <h3>How the app is used</h3>
        <p>
          The iOS app includes Google's Firebase Analytics, which records how the app itself is
          used — which screens are opened, how long a session lasts, and basic device details
          like model and iOS version. It also assigns your installation a random
          identifier, and derives an approximate location (country or region) from your IP
          address. This is about the app, not about music: it is what tells us a screen is broken
          or that nobody can find a feature. It is never joined to your ratings or reviews.
        </p>

        <h3>Notifications</h3>
        <p>
          If you turn on notifications, Apple issues your device a <strong>push token</strong> and
          we store it against your account so we can tell you when a friend sends you a record.
          It identifies a device, not a person, and it is deleted when you turn notifications off,
          sign out, or delete your account. If you never turn notifications on, no token is ever
          created.
        </p>

        <h3>What we do not collect</h3>
        <ul>
          <li>No advertising identifiers, no ads, and no tracking of you across other companies' apps or websites.</li>
          <li>No precise location. The analytics described above infer a country or region from your IP address and nothing finer.</li>
          <li>No selling of your data, and no sharing of it with data brokers.</li>
          <li>No contacts, photos, microphone, or camera access beyond a profile photo you deliberately choose.</li>
          <li>No payment information — Pressd is free and does not process payments.</li>
        </ul>

        <h2>How your information is used</h2>
        <p>
          Your information is used to operate the app and nothing else: to sign you in, to store
          and display your library and ratings, to show your activity to people you are connected
          with, and to generate the predicted scores and statistics that are the point of Pressd.
          We do not sell your personal information or share it with advertisers.
        </p>

        <h2>What other people can see</h2>
        <p>
          Pressd is partly social, so some information is visible to other users by design:
        </p>
        <ul>
          <li>Your <strong>display name, profile photo, and bio</strong> are visible to other users, including in search.</li>
          <li>Your <strong>ratings, reviews, and comments</strong> appear in the social feed and on your profile, and can be seen by other users of the app.</li>
          <li>Your <strong>email address is never shown</strong> to other users.</li>
        </ul>
        <div className="callout">
          <p>
            Pressd does not currently offer a private-account mode. Treat anything you rate or
            write as visible to other people using the app.
          </p>
        </div>

        <h2>Service providers</h2>
        <p>
          Pressd relies on a small number of third parties to run. They process data on our
          behalf and are not permitted to use it for their own purposes.
        </p>
        <ul>
          <li><strong>Google</strong> and <strong>Apple</strong> — sign-in. They tell us who you are; we do not send them your ratings.</li>
          <li>
            <strong>Google Firebase</strong> — analytics, and the delivery of push notifications
            through Apple. Firebase sees how the app is used and the device token your phone was
            issued. It does not see your library, your ratings, or anything you have written.
          </li>
          <li><strong>Supabase</strong> — the hosted PostgreSQL database where your account and library are stored.</li>
          <li><strong>Render</strong> — hosts the backend API.</li>
          <li><strong>Vercel</strong> — hosts this website.</li>
          <li>
            <strong>Anthropic</strong> — used to predict how thematically coherent an album is.
            Only publicly available writing about the <em>album</em> is sent for this. Your
            identity, your ratings, and anything you have written are never included.
          </li>
          <li>
            <strong>Music metadata sources</strong> — Deezer, Apple/iTunes, MusicBrainz, Discogs,
            Last.fm, ListenBrainz, Cover Art Archive, and Album of the Year supply album details
            and artwork. These receive album and artist search terms, never your identity.
          </li>
        </ul>

        <h2>Data retention and deletion</h2>
        <p>
          Your data is kept until you delete it. You can erase your account yourself, at any time,
          without asking us:
        </p>
        <div className="callout">
          <p>
            <strong>In the iOS app:</strong> Library tab → the gear icon (top right) →
            <strong> Delete my account</strong>. You'll be asked to confirm, and then it happens
            immediately.
          </p>
        </div>
        <p>
          Deleting removes your account together with your ratings, song scores, reviews, comments,
          likes, friend connections, invitations, display name, bio, and profile photo. It takes
          effect straight away rather than after a waiting period, and it is <strong>permanent —
          there is no recovery and no way to get the data back</strong>.
        </p>
        <p>
          Album and artist reference information — track listings, artwork, and the album analyses
          used to generate predictions — is not personal to you, is shared across everyone using
          Pressd, and is kept.
        </p>
        <p>
          If you would rather not use the in-app control, or you can no longer sign in, email{' '}
          <a href={`mailto:${CONTACT}`}>{CONTACT}</a> from the address on your account and we will
          delete it for you within 30 days.
        </p>
        <p>
          You can also edit or delete individual ratings, reviews, and comments at any time without
          removing your account.
        </p>

        <h2>Security</h2>
        <p>
          Traffic is encrypted in transit over HTTPS, and sessions use signed tokens stored in the
          iOS Keychain on your device. No method of storage or transmission is perfectly secure,
          and Pressd is a small independent project rather than a company with a dedicated
          security team — please keep that in mind when deciding what to write in a review.
        </p>

        <h2>Children</h2>
        <p>
          Pressd is not directed at children under 13, and we do not knowingly collect their
          information. If you believe a child has created an account, contact us and we will
          remove it.
        </p>

        <h2>Your rights</h2>
        <p>
          Depending on where you live, you may have the right to access, correct, export, or
          delete your personal information, and to object to certain processing. Email{' '}
          <a href={`mailto:${CONTACT}`}>{CONTACT}</a> and we will help — these requests are
          handled manually.
        </p>

        <h2>Changes to this policy</h2>
        <p>
          If this policy changes materially, the date above will be updated and, where the change
          is significant, we will notify you in the app.
        </p>

        <h2>Contact</h2>
        <p>
          Questions, deletion requests, or anything else: <a href={`mailto:${CONTACT}`}>{CONTACT}</a>.
        </p>
    </LegalPage>
  )
}
