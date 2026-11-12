// Community guidelines — public (no auth), linked from Settings on both apps
// beside the terms of use. Plain rules for reviews, discussions and profiles,
// and what Pressd does about breaking them (reports, blocking, removal).
import { Link } from 'react-router-dom'
import LegalPage from '../components/LegalPage'

const UPDATED = 'November 12, 2026'
const CONTACT = 'pressdmusicapp@gmail.com'

export default function Guidelines() {
  return (
    <LegalPage>
      <h1>Community Guidelines</h1>
      <p className="updated">Last updated {UPDATED}</p>

      <p className="lede">
        Pressd is for people who love records. Disagree about albums as hard as you like — that’s
        the point — but treat the people you’re disagreeing with decently.
      </p>

      <h2>Talk about the music</h2>
      <ul>
        <li>Criticise records, not the people who like them.</li>
        <li>Mark spoilers for anything not everyone has heard yet, such as a new release.</li>
        <li>Keep reviews and posts about the record or the discussion they’re in.</li>
      </ul>

      <h2>Not allowed</h2>
      <ul>
        <li>Harassment, threats, or targeting someone repeatedly.</li>
        <li>Hate speech or slurs aimed at anyone’s identity.</li>
        <li>Sexual content involving minors, or sexually explicit images.</li>
        <li>Sharing someone’s personal information without their permission.</li>
        <li>Spam, advertising, or links posted only to promote something.</li>
        <li>Impersonating another person, artist or brand.</li>
        <li>Fake accounts or coordinated rating meant to game charts or averages.</li>
      </ul>

      <h2>Profiles</h2>
      <p>
        Usernames, profile pictures, banners and bios are seen by everyone signed in, so the same
        rules apply to them.
      </p>

      <h2>If something’s wrong</h2>
      <ul>
        <li><strong>Report</strong> a post in a discussion. Posts enough people report are hidden.</li>
        <li><strong>Block</strong> someone from their profile: you stop seeing each other’s reviews and activity, and any friendship ends. Unblock them any time in Settings.</li>
        <li>For anything else, write to <a href={`mailto:${CONTACT}`}>{CONTACT}</a>.</li>
      </ul>
      <p>
        We may remove anything that breaks these guidelines and suspend or close the accounts
        behind it. These guidelines are part of the <Link to="/terms">Terms of Use</Link>.
      </p>
    </LegalPage>
  )
}
