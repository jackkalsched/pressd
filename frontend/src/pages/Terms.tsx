// Terms of use — public (no auth), linked from Settings on both apps just above
// Sign out and Delete account. Written to describe how Pressd actually works;
// keep it in step with the product (blocking, reports, account deletion) and
// with the privacy policy (pages/Privacy.tsx).
import { Link } from 'react-router-dom'
import LegalPage from '../components/LegalPage'

const UPDATED = 'November 12, 2026'
const CONTACT = 'pressdmusicapp@gmail.com'

export default function Terms() {
  return (
    <LegalPage>
      <h1>Terms of Use</h1>
      <p className="updated">Last updated {UPDATED}</p>

      <p className="lede">
        Pressd is a place to rate albums song by song, keep a library of what you’ve heard and
        want to hear, and talk about records with friends and other listeners. By creating an
        account or using Pressd on the web or on iPhone, you agree to these terms.
      </p>

      <h2>Your account</h2>
      <p>
        You sign in with Apple or Google. You’re responsible for what happens under your account,
        and you need to be at least 13 years old (or the minimum age where you live) to use Pressd.
        Your username must not impersonate anyone or be offensive; we may change or remove one
        that is.
      </p>

      <h2>What you post</h2>
      <p>
        Your ratings, reviews, posts, replies, profile picture, banner and bio are yours. By posting
        them on Pressd you give us permission to store and display them inside Pressd — on your
        profile, on a record’s page and discussion, in friends’ feeds and in userbase-wide views
        such as charts and averages — for as long as they’re on your account.
      </p>
      <p>
        Your scores always count toward Pressd’s shared numbers (averages, charts, the Pressd score
        of a record). Everything you post must follow the{' '}
        <Link to="/guidelines">Community Guidelines</Link>.
      </p>

      <h2>Other people</h2>
      <p>
        Profiles on Pressd are visible to anyone signed in. You can block anyone: the two of you
        then stop seeing each other’s reviews and activity, and any friendship between you ends.
        You can report a post in a discussion; posts reported by enough people are hidden. We may
        remove content or suspend accounts that break these terms or the guidelines.
      </p>

      <h2>Music information</h2>
      <p>
        Album details, track lists and cover art come from public music catalogs such as Deezer,
        Apple’s iTunes, MusicBrainz and the Cover Art Archive, and belong to their owners. Lists
        that Pressd collects into bins credit the publication they come from. Predicted scores are
        estimates made from your own ratings and are not promises about anything.
      </p>

      <h2>Acceptable use</h2>
      <ul>
        <li>Don’t try to break, overload, scrape or reverse-engineer Pressd.</li>
        <li>Don’t create accounts to manipulate ratings, charts or discussions.</li>
        <li>Don’t use Pressd to harass anyone or to post anything illegal.</li>
      </ul>

      <h2>Ending your account</h2>
      <p>
        You can delete your account at any time from Settings. Deleting it removes your library,
        ratings, reviews and friends; posts in discussions are removed from your name so the
        replies under them still make sense. We may close accounts that break these terms.
      </p>

      <h2>No warranty</h2>
      <p>
        Pressd is provided as it is. We work to keep it running and your data safe, but we can’t
        promise it will always be available or free of errors, and to the extent the law allows we
        aren’t liable for losses that come from using it.
      </p>

      <h2>Changes</h2>
      <p>
        If these terms change materially, the date above will change and, where the change is
        significant, we’ll let you know in the app. Using Pressd after a change means you accept it.
      </p>

      <h2>Contact</h2>
      <p>
        Questions about these terms: <a href={`mailto:${CONTACT}`}>{CONTACT}</a>. How we handle your
        data is in the <Link to="/privacy">Privacy Policy</Link>.
      </p>
    </LegalPage>
  )
}
