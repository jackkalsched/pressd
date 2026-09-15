# 08 — Web and mobile clients

## Shape

Both consume `@pressd/shared` **as TypeScript source** — no build step. Vite and Metro
each transpile it (`shared/package.json` exports map points at `./src/*.ts`).

`configureApi()` (`shared/src/api.ts:25`) is the injection point. Each app supplies base
URL, token storage, and a 401 handler, then re-exports the whole client:

| | web (`frontend/src/api.ts`) | mobile (`mobile/lib/api.ts`) |
|---|---|---|
| storage | `localStorage['pressd_token']` (sync) | `expo-secure-store` (async) + in-memory mirror |
| hydration | synchronous | `loadStoredToken()` awaited behind the splash (`:27`) |
| 401 | clear user, `window.location.href = '/'` | delegate to the auth provider's sign-out |

The mobile adapter's in-memory mirror exists because `getToken()` must be synchronous
for `apiFetch` while SecureStore is not (`mobile/lib/api.ts:1-3`).

## Routes

**Web** (`frontend/src/App.tsx`) — react-router-dom 7.

Public: `/` (landing), `/join`, `/privacy`, `/how-it-works`, `/charts`.
Gated by `RequireUser`: `/rate/:id`, `/welcome`.
Behind `AppGate` + `Layout`: `/for-you`, `/library`, `/ratings`, `/stats`, `/social`,
`/u/:userId`, `/album/:id`, `/artist/:name`.

`AppGate` (`:44`) blocks the app until the user has ≥1 rated album, skippable per
session via `sessionStorage[ONBOARDING_SKIP_KEY]`. `/rate/:id` sits **outside** it —
it's the flow onboarding hands off to.

Two routes carry comments explaining why they must stay above the catch-all: `/privacy`
(App Store review needs it reachable signed out, `:97-99`) and `/charts` (`:101-102`).
`ChartsRoute` (`:63`) resolves per visitor — `PublicCharts` signed out, `Charts` signed
in — so one URL serves both audiences.

**Mobile** (`mobile/app/`) — expo-router file routes. Tabs: `index` (For You), `social`,
`charts`, `profile`. Stack: `add`, `welcome`, `sign-in`, `first-album`,
`album/[id]`, `artist/[name]`, `friend/[id]`, `genre/[tag]`, `rate/[id]`,
`thread/[subject]`, `splits/[name]`, `favorite/{album,artist,song}`.

`mobile/app/_layout.tsx` does four things at module scope, each with a stated reason:
- `setBackgroundMessageHandler` at module scope (`:45`) — iOS runs it in a fresh JS
  context with no React tree, so anything inside a component is never reached.
- `wireAppStateFocus()` (`:38`) — React Query's `refetchOnWindowFocus` is a browser
  concept and no-ops in React Native.
- `loadSocialSeen` / `loadRecsSeen` / `loadWhatsNewSeen` hydrate watermarks once.
- `import '../lib/api'` before anything fetches (`:18`).

Push tap routing (`:82-95`): the **server names the event, the client decides where it
goes**. Destinations stay type-checked against the router, and a payload can never talk
the app into navigating somewhere it was not built to go.

## Parity — the existing `CLAUDE.md` is out of date here

The old doc says web's For You is missing `/social/top-reviews` and `/discover/picks`.
**Both gaps are closed.** `frontend/src/pages/ForYou.tsx:101-110` calls
`fetchPredictedPicks` and `fetchTopReviews`, with matching invalidations at `:211`,
`:343`, `:525`.

Real parity picture, computed by diffing which of the 100 exported client functions each
app reaches:

**Mobile-only (32)** — discussions in full (`resolveThread`, `fetchThreadPosts`,
`createThreadPost`, `replyToPost`, `votePost`, `reportPost`, `flagSpoiler`,
`fetchReplies`, `fetchDiscussionFeed`, `fetchHeated`), the community album view
(`fetchCommunityAlbum`, `fetchCommunityAlbumByName`, `copyAlbumToLibrary`,
`publishThoughts`), friend-request actions (`acceptFriendRequest`,
`declineFriendRequest`), account management (`uploadAvatar`, `deleteAvatar`,
`deleteOwnAccount`, `linkApple`, `unlinkProvider`, `signInWithApple`), push
(`registerPushToken`), and several stats surfaces (`fetchSubgenreStats`,
`fetchTagRecords`, `fetchRankedSongs`, `fetchSimilarArtistComparisons`, `setTopSong`,
`fetchProfile`, `fetchUsers`, `fetchAlbumColor`, `fetchArtistImage`, `fetchCompare`).

**Web-only (8)** — the invite flow (`getInviteLink`, `fetchInvite`, `acceptInvite`),
`fetchPublicCharts`, `fetchFriendRatings`, `fetchFriendReviews`, `fetchGenreScores`,
`createAlbum`.

So the parity gap runs the **other way** from what the old doc says: **web is a long way
behind mobile**, most importantly on the entire discussions feature. Sign in with Apple
is mobile-only, which is expected; discussions being mobile-only is the substantive gap.

## Genuinely unused client exports (8)

Verified by grepping every `.ts`/`.tsx` under `frontend/src`, `mobile/`, and `shared/src`:

`analyzeAudio`, `deletePost`, `editPost`, `fetchAlbumReport`, `fetchAnalysis`,
`fetchYearByYear`, `rateSong`, `updateFactorWeights`.

Two of those are **product gaps, not just dead code**:

1. **`updateFactorWeights`** — the 60-point factor budget has a full backend
   (`PUT /users/{id}/factor-weights`, `users.py:487`, which also calls
   `recompute_user_scores`) and **no UI on either platform**. Both rating screens *read*
   the weights (`RatingScreen.tsx:153`, `rate/[id].tsx:169`) but nothing writes them.
   Every user is on the 25/15/15/5 default.
2. **`deletePost` / `editPost`** — `PATCH /posts/{id}` and `DELETE /posts/{id}` exist
   (`discussions.py:400`, `:419`), and the thread screen renders deleted-post states
   (`mobile/app/thread/[subject].tsx:356`, `:422`), but nothing calls them. Users can
   post and report but not edit or remove. Given `PostReport` and the auto-hide rule
   exist, this is a moderation gap.

Also dead: `setPopularityWeight` (`albumSearch.ts:115`), documented as a test seam for
fixtures that don't exist.

## Share cards — the growth mechanic

Two implementations, deliberately kept in lockstep. `mobile/components/ShareCard.tsx:1-12`
states the contract: **every measurement is the desktop card's pixel value passed
through `u()`**, which scales the 1080-wide design to the phone's width. Change one,
port the same number to the other.

Both render `1080 × 1350` with the same literal palette (`INK`, `GREEN`, `CORAL`, `WARM`,
`WARM2`, `FAINT`), kept as literals rather than theme tokens because it is a fixed
composition, not a themed screen (`mobile:34-36`).

Data pulled: the album with its songs, the owner's full rated library (for rank and the
22-bin distribution), and the album's accent colour from `/util/album-color`. Rank and
distribution are computed against **the album's owner**, not the viewer — "ranked #4 of
412" is a claim about the person who rated it (`mobile:9-12`).

| | web | mobile |
|---|---|---|
| rasterise | `html2canvas` | `captureRef` (`react-native-view-shot`) |
| deliver | file download | `expo-sharing` native sheet |
| colour fetch | **bare `fetch`**, no auth header (`:35`) | `fetchAlbumColor` via `apiFetch` |

`allowFontScaling={false}` on every `Text` in the mobile card (`:44-50`): the card is a
graphic composed on a fixed grid and rasterised to a PNG, so the reader's text-size
setting must not change the exported image.

**Structural gap:** rendering is entirely client-side and the output is a bare image.
No server-rendered OG image, no deep link, no event. The primary growth mechanic is
therefore unmeasurable and unattributable. See `10-performance.md`.

## Error handling

`apiFetch` (`shared/src/api.ts:36-46`) handles **401 only**. Everything else is per-call
`if (!res.ok) throw`. No timeouts, no backoff; React Query is `retry: 1` on both
platforms, which retries a 429 once, immediately.

Two web call sites bypass `apiFetch` entirely with a bare `fetch`
(`ShareCard.tsx:35`, `AlbumDetail.tsx:33`), both hitting `/util/album-color`. They work
only because `/util` is unauthenticated, which couples them to QUESTIONS Q7.
