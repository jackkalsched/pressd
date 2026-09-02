export type AlbumStatus = 'to_listen' | 'listening' | 'rated'

export interface Song {
  id: number
  title: string
  trackNumber: number
  score: number | null
  aScore: number | null
  durationMs: number | null
  spotifyPopularity: number | null
  explicit: boolean
  spotifyId: string | null
  albumId: number
  artist: string
  bpm: number | null
  musicalKey: string | null
  loudnessDb: number | null
  /** A score this user already gave the same recording on a single or EP,
   *  offered as a prefill. Server-side only for the album's owner, and only
   *  while something is unscored. Null when nothing carries. */
  carriedScore: number | null
  carriedFromAlbumId: number | null
  carriedFromAlbumName: string | null
}

export interface Album {
  id: number
  userId: number | null
  albumName: string
  artist: string
  year: number
  status: AlbumStatus
  score: number | null
  theme: number | null
  replayValue: number | null
  production: number | null
  distinctness: number | null
  genre: string | null
  subGenre1: string | null
  subGenre2: string | null
  subGenre3: string | null
  extraArtists: string[]
  albumArtUrl: string | null
  totalTracks: number | null
  spotifyId: string | null
  dateAdded: string
  dateRated: string | null
  songs: Song[]
  predictedTheme: number | null
  predictedThemeReasoning: string | null
  predictedScore: number | null
  recommendedBy: number | null
  recommendedByName: string | null
  /** When it was sent. Ordering by this is what makes "newest recommendation"
   *  mean the latest one rather than the highest row id. */
  recommendedAt: string | null
  /** What the sender said when they passed it on, if anything. */
  recommendationNote: string | null
  /** People other than you who have rated this record. Zero means there is no
   *  comparison to offer. Only populated by the single-album fetch. */
  othersRaterCount: number
  review: string | null
  reviewAt: string | null
  /** The track the user picked when several tied for the album's best
   *  score. Null when there was no tie, or they were never asked. */
  topSongId: number | null
}

export interface ArtistStats {
  artist: string
  count: number
  avgSongScore: number
  wavgSongScore: number
  aCi: number
  sar: number
  sarPs: number
  skipPct: number
  bangPct: number
  songPlus: number
  wSongPlus: number
}

export const BANG_THRESHOLD = 8.0
export const SKIP_THRESHOLD = 6.5

// Short releases (≤6 tracks) skip the factor ratings and score as the song
// mean; they show everywhere with a tag so they read differently from LPs
export const EP_MAX_TRACKS = 6

/** Every track sharing the album's highest score, in track order. One entry
 *  means no tie; two or more is what the tie-break dialog asks about. Mirrors
 *  tied_top_songs() in backend/scoring.py — keep the two in step. */
export function tiedTopSongs(album: Album): Song[] {
  const scored = album.songs.filter((s) => s.score != null)
  if (scored.length === 0) return []
  const best = Math.max(...scored.map((s) => s.score as number))
  return scored
    .filter((s) => s.score === best)
    .sort((a, b) => (a.trackNumber ?? 0) - (b.trackNumber ?? 0))
}

/** The album's best track: the user's tie-break if they made one, otherwise the
 *  highest score. Mirrors pick_top_song() in backend/scoring.py. */
export function pickTopSong(album: Album): Song | null {
  const scored = album.songs.filter((s) => s.score != null)
  if (scored.length === 0) return null
  if (album.topSongId != null) {
    const chosen = scored.find((s) => s.id === album.topSongId)
    if (chosen) return chosen
  }
  return scored.reduce((best, s) => ((s.score as number) > (best.score as number) ? s : best))
}

export function shortReleaseLabel(album: Album): 'EP' | 'Single' | null {
  const n = album.songs.length
  if (n === 0 || n > EP_MAX_TRACKS) return null
  return n <= 2 ? 'Single' : 'EP'
}

// Maps a 1–10 song score to a gradient color (dark red → dark forest green)
export function songScoreColor(score: number): string {
  const hue = Math.round(((score - 1) / 9) * 130)
  return `hsl(${hue}, 65%, 32%)`
}

// Deterministic color for a user's default profile picture, derived from their
// name so it's stable and distinct per person. Tuned for legible text and fills
// on the light app background.
export function avatarColor(seed: string): string {
  let hash = 0
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) | 0
  const hue = Math.abs(hash) % 360
  return `hsl(${hue}, 55%, 42%)`
}

export function computeAScore(score: number): number {
  return (15 * score - 14) / 13
}

export interface FactorStats {
  theme:        [number, number]
  replay_value: [number, number]
  production:   [number, number]
  distinctness: [number, number]
}

// Per-user external-factor weighting, stored as a fixed 60-point budget
// (each factor ≥ 5). The scoring weight applied to a factor is points / 100.
export interface FactorPoints {
  theme:        number
  replay_value: number
  production:   number
  distinctness: number
}

export const DEFAULT_FACTOR_POINTS: FactorPoints = { theme: 25, replay_value: 15, production: 15, distinctness: 5 }
export const TOTAL_FACTOR_POINTS = 60
export const MIN_FACTOR_POINTS = 5

// Display order + labels for the four factors (mirrors the rating screen)
export const FACTOR_META: { key: keyof FactorPoints; label: string; desc: string }[] = [
  { key: 'theme',        label: 'Theme / Cohesion', desc: 'Strength and cohesion of the central idea' },
  { key: 'replay_value', label: 'Replay Value',     desc: 'How replayable the album is' },
  { key: 'production',   label: 'Production',        desc: 'Sound quality, mixing, sonic palette' },
  { key: 'distinctness', label: 'Distinctness',      desc: 'Originality and genre-bending' },
]

export function computeAlbumScore(
  songs: Song[],
  theme: number,
  replayValue: number,
  production: number,
  distinctness: number,
  factorStats: FactorStats,
  points: FactorPoints = DEFAULT_FACTOR_POINTS,
): number {
  const rated = songs.filter((s) => s.score !== null && s.score !== undefined)
  if (rated.length === 0) return 0
  const avgSong = rated.reduce((sum, s) => sum + s.score!, 0) / rated.length

  const z = (val: number, key: keyof FactorStats) => {
    const [mu, sd] = factorStats[key]
    return (val - mu) / sd
  }

  const composite =
    1.00 * avgSong +
    (points.theme        / 100) * z(theme,        'theme') +
    (points.replay_value / 100) * z(replayValue,  'replay_value') +
    (points.production   / 100) * z(production,   'production') +
    (points.distinctness / 100) * z(distinctness, 'distinctness')

  // Clamped and rounded exactly as compute_album_score does in
  // backend/scoring.py. Above-average factors add z-score bonuses on top of the
  // song mean, which can push a standout record past 10 — and this function
  // draws the projected score during rating, so without the clamp the flow
  // promised a 10.4 and then saved the 10 the server had clamped it to.
  return Math.round(Math.min(10, Math.max(1, composite)) * 10_000) / 10_000
}

// ── Discussions (PLAN_discussions.md §5) ─────────────────────────────────────

export type SubjectType = 'album' | 'artist' | 'track'
export type ThreadSort = 'newest' | 'popular' | 'all'

/** What a subject reference looks like on the wire. The server derives the
 *  subject key from these — a client never sends one, or a normalisation drift
 *  silently forks the room. */
export interface SubjectRef {
  subjectType: SubjectType
  artist?: string
  album?: string
  trackId?: number
}

export interface PostAuthor {
  id: number
  name: string
  avatarUrl: string | null
  /** The author's own current score for this subject, live rather than frozen
   *  at post time. Null when they have not scored it (a reply on an artist
   *  thread from someone with no rated album by them). */
  score: number | null
}

export interface DiscussionPost {
  id: number
  parentId: number | null
  /** 'system' is the seeded Press'd post: no author, not likeable, not
   *  replyable, and always first. */
  kind: 'user' | 'system' | 'review' | 'track_note'
  body: string
  deleted: boolean
  isSpoiler: boolean
  createdAt: string | null
  editedAt: string | null
  likeCount: number
  dislikeCount: number
  replyCount: number
  /** This viewer's own vote: 1 up, -1 down, 0 none. */
  myVote: number
  author: PostAuthor | null
  canDelete: boolean
  canEdit: boolean
}

/** The thread plus whether this viewer has earned it. `threadId` is null until
 *  someone posts — threads are created lazily. */
export interface ThreadMeta {
  subjectType: SubjectType
  subjectKey: string
  threadId: number | null
  title: string
  subtitle: string | null
  artUrl: string | null
  postCount: number
  /** Reviews standing on this record, and how many *other* people have rated
   *  it — enough for the album page to tell whether writing is joining a
   *  conversation or starting one, without pulling the thread. Album threads
   *  only; 0 for artist and track. */
  reviewCount: number
  raterCount: number
  /** Distinct people who have posted in the thread — voices, not posts. */
  participantCount: number
  lastPostAt: string | null
  canRead: boolean
  canPost: boolean
  /** 'rate_album' | 'rate_track' | 'rate_artist' when locked, else null. */
  lockedReason: string | null
}

export interface ThreadPage {
  threadId: number
  sort: ThreadSort
  posts: DiscussionPost[]
  nextCursor: string | null
}

/** A record the userbase disagrees about (PLAN_discussions.md §8).
 *  `hotPct`/`coldPct` are measured against each rater's own library mean, not
 *  an absolute cutoff — "60% hot" means 60% liked it more than they like their
 *  own library. They always sum to 100. */
export interface DivisiveRecord {
  subjectKey: string
  albumName: string
  artist: string | null
  albumArtUrl: string | null
  raters: number
  spread: number
  meanScore: number
  hot: number
  cold: number
  hotPct: number
  coldPct: number
}

/** One friend's post, with enough of its thread to draw a row. */
export interface FriendPost {
  id: number
  isReply: boolean
  kind: DiscussionPost['kind']
  body: string
  isSpoiler: boolean
  createdAt: string | null
  likeCount: number
  dislikeCount: number
  replyCount: number
  author: PostAuthor
  thread: {
    id: number
    subjectType: SubjectType
    subjectKey: string
    title: string
    subtitle: string | null
    artUrl: string | null
  }
}
