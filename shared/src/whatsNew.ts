// "What's new in Pressd": this release's slides, shown once per account after
// an update on both platforms — mobile's WhatsNewSheet, web's WhatsNewDialog,
// each drawing a scene per slide (`key`) in its own WhatsNewScenes. The
// account remembers the last release it dismissed (PressUser.whats_new_seen, by
// `id`); a new account's tutorial records the current one instead, so a
// sign-up isn't told what changed in an app they've just met. A new release: a
// new `id`, new slides here, and a scene per new key on each platform.
//
// The scenes are drawn, not screenshots: fixed records, names and numbers
// (Kid A at 9.12, maya.j at 82%), restated per platform — change both.

export type WhatsNewKey = 'intro' | 'bins' | 'search' | 'overlap' | 'upcoming' | 'profile' | 'look'

export interface WhatsNewSlide {
  key: WhatsNewKey
  title: string
  body: string
}

export const WHATS_NEW: { id: string; slides: WhatsNewSlide[] } = {
  id: '1.1',
  slides: [
    {
      key: 'intro',
      title: 'What’s new in Pressd',
      body: 'Six new ways to find records, rate them and meet the people who love them too.',
    },
    {
      key: 'bins',
      title: 'Bins',
      body: 'Themed collections to work through, like Apple Music’s 100 Best Albums. Or make your own, public or private.',
    },
    {
      key: 'search',
      title: 'One search',
      body: 'People, albums, artists, songs and bins in one place, plus anything in the catalogs that isn’t on Pressd yet.',
    },
    {
      key: 'overlap',
      title: 'Taste overlap',
      body: 'See how closely your taste matches anyone’s, right on their profile. Finish a record and meet the people who rated it too.',
    },
    {
      key: 'upcoming',
      title: 'Upcoming',
      body: 'A calendar of notable records on the way. Add one early, and its tracklist fills in on release day.',
    },
    {
      key: 'profile',
      title: 'Your profile',
      body: 'Put four favourite records on your shelf, frame a banner of your own, and add a location and a bio.',
    },
    {
      key: 'look',
      title: 'A fresh look',
      body: 'Dark mode, a For You led by the day’s most-talked-about reviews, and a side menu with an easy friend invite.',
    },
  ],
}

/** The first slide's button, the middle ones', and the last's. */
export function whatsNewCta(index: number, count: number): string {
  if (index === 0) return 'Show me'
  return index === count - 1 ? 'Let’s go' : 'Next'
}

/** Whether this account still owes the current release's notes: an existing
 *  account (past the tutorial) that hasn't dismissed them. Absent — a session
 *  stored before the field, or a server that predates it — isn't owed until
 *  the refresh brings the field, so an old session doesn't show it early. */
export function whatsNewOwed(user: { tutorialSeen?: boolean; whatsNewSeen?: string | null } | null | undefined): boolean {
  if (!user || user.tutorialSeen === false) return false
  if (user.whatsNewSeen === undefined) return false
  return user.whatsNewSeen !== WHATS_NEW.id
}
