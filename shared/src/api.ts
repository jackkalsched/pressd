import type {
  Album, Song, ArtistStats, FactorStats, FactorPoints,
  DiscussionPost, SubjectRef, ThreadMeta, ThreadPage, ThreadSort,
  FeedPost, HeatedRecord, SubjectType,
} from './types'

// ── Runtime configuration ─────────────────────────────────────────────────────
// The shared client is platform-agnostic: each app (web, mobile) injects its own
// base URL, token storage, and unauthorized handler before making calls.

export interface ApiConfig {
  baseUrl: string
  getToken: () => string | null
  setToken: (token: string | null) => void
  onUnauthorized: () => void
}

let config: ApiConfig = {
  baseUrl: 'http://localhost:8000',
  getToken: () => null,
  setToken: () => {},
  onUnauthorized: () => {},
}

export function configureApi(c: ApiConfig): void {
  config = c
}

const BASE = () => config.baseUrl

/**
 * fetch wrapper that attaches the bearer token on every call and, on a 401,
 * clears the stale session and hands control to the app's unauthorized
 * handler. All API calls go through this.
 */
async function apiFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const token = config.getToken()
  const headers = new Headers(init.headers)
  if (token) headers.set('Authorization', `Bearer ${token}`)
  const res = await fetch(url, { ...init, headers })
  if (res.status === 401) {
    config.setToken(null)
    config.onUnauthorized()
    throw new Error('Session expired')
  }
  return res
}

// ── Transformers (snake_case → camelCase) ─────────────────────────────────────

function transformSong(s: Record<string, unknown>): Song {
  return {
    id: s.id as number,
    title: s.title as string,
    trackNumber: s.track_number as number ?? null,
    score: s.score as number | null,
    aScore: s.a_score as number | null,
    artist: s.artist as string ?? '',
    durationMs: s.duration_ms as number | null,
    spotifyPopularity: s.spotify_popularity as number | null,
    explicit: s.explicit as boolean ?? false,
    spotifyId: s.spotify_id as string | null,
    albumId: s.album_id as number,
    bpm: s.bpm as number | null,
    musicalKey: s.musical_key as string | null,
    loudnessDb: s.loudness_db as number | null,
    carriedScore: (s.carried_score as number | null) ?? null,
    carriedFromAlbumId: (s.carried_from_album_id as number | null) ?? null,
    carriedFromAlbumName: (s.carried_from_album_name as string | null) ?? null,
  }
}

function transformAlbum(a: Record<string, unknown>): Album {
  const songs = Array.isArray(a.songs)
    ? (a.songs as Record<string, unknown>[]).map(transformSong)
    : []
  return {
    id: a.id as number,
    userId: (a.user_id as number | undefined) ?? null,
    albumName: a.album_name as string,
    artist: a.artist as string,
    year: a.year as number,
    status: a.status as Album['status'],
    score: a.score as number | null,
    theme: a.theme as number | null,
    replayValue: a.replay_value as number | null,
    production: a.production as number | null,
    distinctness: a.distinctness as number | null,
    genre: a.genre as string | null,
    subGenre1: a.sub_genre1 as string | null,
    subGenre2: a.sub_genre2 as string | null,
    subGenre3: a.sub_genre3 as string | null,
    spotifyId: a.spotify_id as string | null,
    extraArtists: (() => { try { const v = JSON.parse(a.extra_artists as string); return Array.isArray(v) ? v : [] } catch { return [] } })(),
    albumArtUrl: a.album_art_url as string | null,
    totalTracks: a.total_tracks as number | null,
    dateAdded: a.date_added as string,
    dateRated: a.date_rated as string | null,
    predictedTheme: a.predicted_theme as number | null ?? null,
    predictedThemeReasoning: a.predicted_theme_reasoning as string | null ?? null,
    predictedScore: a.predicted_score as number | null ?? null,
    recommendedBy: a.recommended_by as number | null ?? null,
    recommendedByName: a.recommended_by_name as string | null ?? null,
    recommendedAt: a.recommended_at as string | null ?? null,
    recommendationNote: a.recommendation_note as string | null ?? null,
    review: a.review as string | null ?? null,
    reviewAt: a.review_at as string | null ?? null,
    topSongId: (a.top_song_id as number | null) ?? null,
    othersRaterCount: (a.others_rater_count as number | undefined) ?? 0,
    songs,
  }
}

// ── Albums ────────────────────────────────────────────────────────────────────

export async function fetchAlbums(params?: {
  status?: string
  artist?: string
  albumName?: string
  genre?: string
  userId?: number
}): Promise<Album[]> {
  const qs = new URLSearchParams()
  if (params?.status) qs.set('status', params.status)
  if (params?.artist) qs.set('artist', params.artist)
  if (params?.albumName) qs.set('album_name', params.albumName)
  if (params?.genre) qs.set('genre', params.genre)
  qs.set('user_id', String(params?.userId ?? 1))
  const res = await apiFetch(`${BASE()}/albums/?${qs}`)
  const data = await res.json()
  return (data as Record<string, unknown>[]).map(transformAlbum)
}

export async function fetchFriendRatings(
  albumName: string,
  artist: string,
  activeUserId: number,
): Promise<{ friend: UserInfo; album: Album }[]> {
  const friends = await fetchFriends(activeUserId)
  const results = await Promise.all(
    friends.map(async (friend) => {
      try {
        const albums = await fetchAlbums({ status: 'rated', albumName, artist, userId: friend.id })
        if (albums.length > 0) return { friend, album: albums[0] }
      } catch { /* friend may not have the album */ }
      return null
    })
  )
  return results.filter((r): r is { friend: UserInfo; album: Album } => r !== null)
}

export async function fetchAlbum(id: number): Promise<Album> {
  const res = await apiFetch(`${BASE()}/albums/${id}`)
  if (!res.ok) throw new Error('Album not found')
  return transformAlbum(await res.json())
}

export async function updateAlbum(id: number, patch: Record<string, unknown>): Promise<Album> {
  const res = await apiFetch(`${BASE()}/albums/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  })
  if (!res.ok) throw new Error('Failed to update album')
  return transformAlbum(await res.json())
}

/** Record which track wins when several tie for the album's top score, or pass
 *  null to clear the pick and fall back to the highest score. */
export async function setTopSong(albumId: number, songId: number | null): Promise<Album> {
  return updateAlbum(albumId, { top_song_id: songId })
}

export async function deleteAlbum(id: number): Promise<void> {
  const res = await apiFetch(`${BASE()}/albums/${id}`, { method: 'DELETE' })
  if (!res.ok) throw new Error('Failed to delete album')
}

export async function enrichCovers(): Promise<{ updated: number; total_missing: number }> {
  const res = await apiFetch(`${BASE()}/albums/enrich-covers`, { method: 'POST' })
  if (!res.ok) throw new Error('Cover enrichment failed')
  return res.json()
}

export async function createAlbum(data: Partial<Album> & { userId?: number }): Promise<Album> {
  const body = {
    album_name: data.albumName,
    artist: data.artist,
    year: data.year,
    status: data.status ?? 'to_listen',
    genre: data.genre,
    total_tracks: data.totalTracks,
    album_art_url: data.albumArtUrl,
    spotify_id: data.spotifyId,
    user_id: data.userId ?? 1,
  }
  const res = await apiFetch(`${BASE()}/albums/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return transformAlbum(await res.json())
}

// ── Songs ─────────────────────────────────────────────────────────────────────

export async function fetchSongs(params?: {
  artist?: string
  albumId?: number
  minScore?: number
  userId?: number
}): Promise<Song[]> {
  const qs = new URLSearchParams()
  if (params?.artist) qs.set('artist', params.artist)
  if (params?.albumId) qs.set('album_id', String(params.albumId))
  if (params?.minScore != null) qs.set('min_score', String(params.minScore))
  qs.set('user_id', String(params?.userId ?? 1))
  const res = await apiFetch(`${BASE()}/songs/?${qs}`)
  return ((await res.json()) as Record<string, unknown>[]).map(transformSong)
}

export async function batchRateSongs(items: { id: number; score: number | null }[], userId = 1): Promise<void> {
  const res = await apiFetch(`${BASE()}/songs/batch-rate?user_id=${userId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(items),
  })
  if (!res.ok) throw new Error('Batch rate failed')
}

export async function rateSong(id: number, score: number | null): Promise<Song> {
  const res = await apiFetch(`${BASE()}/songs/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ score }),
  })
  return transformSong(await res.json())
}

// ── Search / Import ───────────────────────────────────────────────────────────

export interface SpotifyTrack {
  title: string
  track_number: number
  duration_ms: number | null
  explicit: boolean
  spotify_id: string | null
  artist: string
}

/** A full album with its tracklist — what `/albums/import` consumes. */
export interface SpotifyAlbumResult {
  spotify_id: string | null
  mb_id?: string | null
  album_name: string
  artist: string
  year: number | null
  cover_url: string | null
  total_tracks: number
  tracks: SpotifyTrack[]
  genre?: string | null
  release_date?: string | null
  upcoming?: boolean
}

export type AlbumSource = 'itunes' | 'deezer' | 'mb'

/**
 * One search hit — identity only, no tracklist. Search fetches these (one HTTP
 * call per source); `resolveAlbum` fetches the tracklist for the one the user
 * picks. Fetching tracklists for every hit is what made search slow.
 */
export interface AlbumSearchResult {
  source: AlbumSource
  source_id: string
  spotify_id: string | null
  mb_id?: string | null
  album_name: string
  artist: string
  year: number | null
  cover_url: string | null
  total_tracks: number | null
  genre?: string | null
  release_date?: string | null
  upcoming?: boolean
  /** Last.fm listener count, attached by `fetchPopularity` for ranking. */
  listeners?: number | null
}

async function searchSource(path: string, q: string, label: string): Promise<AlbumSearchResult[]> {
  const res = await apiFetch(`${BASE()}/search/${path}?q=${encodeURIComponent(q)}`)
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error((err as { detail?: string }).detail ?? `${label} search failed`)
  }
  return res.json()
}

export function searchMusicBrainz(q: string): Promise<AlbumSearchResult[]> {
  return searchSource('mb', q, 'MusicBrainz')
}

export function searchItunes(q: string): Promise<AlbumSearchResult[]> {
  return searchSource('itunes', q, 'iTunes')
}

export function searchDeezer(q: string): Promise<AlbumSearchResult[]> {
  return searchSource('deezer', q, 'Deezer')
}

/**
 * Last.fm listener counts for a batch of albums, aligned to input order.
 * Zeros mean "no signal" — the ranker treats them as neutral, not unpopular.
 */
export async function fetchPopularity(
  items: { album_name: string; artist: string }[],
): Promise<number[]> {
  const res = await apiFetch(`${BASE()}/search/popularity`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(items),
  })
  if (!res.ok) throw new Error('Popularity lookup failed')
  return res.json()
}

/** Fetch the picked album's full tracklist, ready for `importAlbum`. */
export async function resolveAlbum(r: AlbumSearchResult): Promise<SpotifyAlbumResult> {
  const res = await apiFetch(
    `${BASE()}/search/resolve?source=${r.source}&id=${encodeURIComponent(r.source_id)}`,
  )
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error((err as { detail?: string }).detail ?? 'Could not load the tracklist')
  }
  return res.json()
}

export async function importAlbum(
  data: SpotifyAlbumResult,
  status: 'to_listen' | 'listening',
  userId = 1,
): Promise<Album & { alreadyExisted: boolean }> {
  const res = await apiFetch(`${BASE()}/albums/import?user_id=${userId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...data,
      status,
      cover_url: data.cover_url,
    }),
  })
  if (!res.ok) throw new Error('Import failed')
  const raw = await res.json()
  return { ...transformAlbum(raw), alreadyExisted: raw.already_existed ?? false }
}

// The userbase's averaged view of an album — what generic entry points
// (trending, charts) open, since those aren't tied to any one person's copy.
export interface CommunityTrack {
  /** Per-track equivalents of the album-level `others_*` fields. */
  others_avg_score?: number | null
  others_rater_count?: number
  title: string
  track_number: number | null
  avg_score: number | null
  rater_count: number
  your_score: number | null
}

export interface CommunityAlbum {
  /** null when nobody in Press'd has this album yet (a fresh release). */
  album_id: number | null
  album_name: string
  artist: string
  year: number | null
  album_art_url: string | null
  genre: string | null
  sub_genre1: string | null
  sub_genre2: string | null
  sub_genre3: string | null
  rater_count: number
  /** Raters other than you. Zero means there is nobody to compare against,
   *  however many `rater_count` claims. */
  others_rater_count: number
  /** The pooled score with your own copy left out — the figure a side-by-side
   *  must use, so "Pressd users" and "You" are disjoint. */
  others_avg_score: number | null
  avg_score: number | null
  avg_theme: number | null
  avg_replay_value: number | null
  avg_production: number | null
  avg_distinctness: number | null
  tracks: CommunityTrack[]
  /** Your copy at any status, so an unrated album can still be opened to rate. */
  your_album_id: number | null
  your_status: 'to_listen' | 'listening' | 'rated' | null
  predicted_score: number | null
  /** From your own copy — who sent you this album and what they said. */
  recommended_by_name: string | null
  recommendation_note: string | null
  you: {
    album_id: number
    score: number | null
    theme: number | null
    replay_value: number | null
    production: number | null
    distinctness: number | null
  } | null
}

export async function fetchCommunityAlbum(albumId: number): Promise<CommunityAlbum> {
  const res = await apiFetch(`${BASE()}/albums/${albumId}/community`)
  if (!res.ok) throw new Error('Could not load this album')
  return res.json()
}

/** Community view by name + artist — for albums that may not be in Press'd yet. */
export async function fetchCommunityAlbumByName(albumName: string, artist: string): Promise<CommunityAlbum> {
  const qs = new URLSearchParams({ album_name: albumName, artist })
  const res = await apiFetch(`${BASE()}/albums/community-by-name?${qs}`)
  if (!res.ok) throw new Error('Could not load this album')
  return res.json()
}

// Add an existing album (a friend's copy from the feed) to the current user's
// library as the exact same album — server clones its metadata + tracklist.
export async function copyAlbumToLibrary(
  albumId: number,
  status: 'to_listen' | 'listening' = 'to_listen',
): Promise<Album & { alreadyExisted: boolean }> {
  const res = await apiFetch(`${BASE()}/albums/${albumId}/copy?status=${status}`, { method: 'POST' })
  if (!res.ok) throw new Error('Failed to add album')
  const raw = await res.json()
  return { ...transformAlbum(raw), alreadyExisted: raw.already_existed ?? false }
}

export async function backfillCovers(): Promise<{ updated: number; skipped: number; failed: number }> {
  const res = await apiFetch(`${BASE()}/util/backfill-covers`, { method: 'POST' })
  if (!res.ok) throw new Error('Backfill failed')
  return res.json()
}

// Dominant colors of an album's cover (hsl strings), for the album-art page wash.
export interface AlbumColor {
  color: string | null
  color2: string | null
}

export async function fetchAlbumColor(album: string, artist: string): Promise<AlbumColor> {
  const res = await apiFetch(
    `${BASE()}/util/album-color?album=${encodeURIComponent(album)}&artist=${encodeURIComponent(artist)}`,
  )
  if (!res.ok) return { color: null, color2: null }
  const json = await res.json()
  return { color: json.color ?? null, color2: json.color2 ?? null }
}

/** Artist photo for the artist-page banner (Deezer, resolved server-side). */
export async function fetchArtistImage(artist: string): Promise<string | null> {
  const res = await apiFetch(`${BASE()}/util/artist-image?artist=${encodeURIComponent(artist)}`)
  if (!res.ok) return null
  const json = await res.json()
  return json.image_url ?? null
}

// ── Discover: new releases (Deezer) ───────────────────────────────────────────

export interface NewRelease {
  /** null when the release couldn't be matched to Deezer; it still displays,
   *  and the tracklist is resolved by search when you choose to rate it. */
  deezerId: number | null
  albumName: string
  artist: string
  coverUrl: string | null
  year: number | null
  releaseDate: string | null
  nbTracks: number | null
  /** Popularity from the AOTY listing — how many people rated it this week. */
  raterCount: number | null
  userScore: number | null
  criticScore: number | null
}

/** An album the nightly model expects this user to like, drawn from the whole
 *  catalog rather than their own queue — so it has no album id of its own. */
export interface PredictedPick {
  albumName: string
  artist: string
  year: number | null
  genre: string | null
  coverUrl: string | null
  predictedScore: number
}

export async function fetchPredictedPicks(limit = 10): Promise<PredictedPick[]> {
  const res = await apiFetch(`${BASE()}/discover/picks?limit=${limit}`)
  if (!res.ok) throw new Error('Failed to load predicted picks')
  const data = await res.json()
  return (data as Record<string, unknown>[]).map((r) => ({
    albumName: r.album_name as string,
    artist: r.artist as string,
    year: (r.year as number | null) ?? null,
    genre: (r.genre as string | null) ?? null,
    coverUrl: (r.album_art_url as string | null) ?? null,
    predictedScore: r.predicted_score as number,
  }))
}

export async function fetchNewReleases(limit = 12): Promise<NewRelease[]> {
  const res = await apiFetch(`${BASE()}/discover/new-releases?limit=${limit}`)
  if (!res.ok) throw new Error('Failed to load new releases')
  const data = await res.json()
  return (data as Record<string, unknown>[]).map((r) => ({
    deezerId: (r.deezer_id as number | null) ?? null,
    albumName: r.album_name as string,
    artist: r.artist as string,
    coverUrl: (r.cover_url as string | null) ?? null,
    year: (r.year as number | null) ?? null,
    releaseDate: (r.release_date as string | null) ?? null,
    nbTracks: (r.nb_tracks as number | null) ?? null,
    raterCount: (r.rater_count as number | null) ?? null,
    userScore: (r.user_score as number | null) ?? null,
    criticScore: (r.critic_score as number | null) ?? null,
  }))
}

// Popular albums across the whole userbase (grouped over per-user copies).
export interface TrendingAlbum {
  album_id: number
  album_name: string
  artist: string
  album_art_url: string | null
  year: number | null
  avg_score: number | null
  rater_count: number
  last_rated: string | null
}

export async function fetchTrending(
  period: 'week' | 'all' | 'top' = 'week',
  limit = 8,
): Promise<TrendingAlbum[]> {
  const res = await apiFetch(`${BASE()}/discover/trending?period=${period}&limit=${limit}`)
  if (!res.ok) throw new Error('Failed to load trending')
  return res.json()
}

// Userbase-wide album chart — aggregate ranking with day-over-day movement.
export interface ChartItem {
  rank: number
  album_id: number
  album_name: string
  artist: string
  year: number | null
  album_art_url: string | null
  avg_score: number | null
  rater_count: number
  movement: number | null // + up, − down, 0 no change, null = new entry
}

export interface ChartFacets {
  genres: string[]
  decades: number[]
  years: number[]
}

export interface ChartsResponse {
  items: ChartItem[]
  facets: ChartFacets
}

export async function fetchCharts(params?: {
  period?: 'week' | 'all'
  genre?: string
  decade?: number
  year?: number
  artist?: string
}): Promise<ChartsResponse> {
  const qs = new URLSearchParams()
  if (params?.period) qs.set('period', params.period)
  if (params?.genre) qs.set('genre', params.genre)
  if (params?.decade) qs.set('decade', String(params.decade))
  if (params?.year) qs.set('year', String(params.year))
  if (params?.artist) qs.set('artist', params.artist)
  const res = await apiFetch(`${BASE()}/discover/charts?${qs}`)
  if (!res.ok) throw new Error('Failed to load charts')
  return res.json()
}

/** Same board as `fetchCharts`, but served to logged-out visitors from the
 *  public router. Aggregates only — no "your copy", no per-user fields. */
export async function fetchPublicCharts(params?: {
  period?: 'week' | 'all'
  genre?: string
  decade?: number
  year?: number
  artist?: string
}): Promise<ChartsResponse> {
  const qs = new URLSearchParams()
  if (params?.period) qs.set('period', params.period)
  if (params?.genre) qs.set('genre', params.genre)
  if (params?.decade) qs.set('decade', String(params.decade))
  if (params?.year) qs.set('year', String(params.year))
  if (params?.artist) qs.set('artist', params.artist)
  const res = await apiFetch(`${BASE()}/public/charts?${qs}`)
  if (!res.ok) throw new Error('Failed to load charts')
  return res.json()
}

// Resolve a Deezer release to the full album+tracks shape importAlbum consumes
export async function resolveDeezerAlbum(deezerId: number): Promise<SpotifyAlbumResult> {
  const res = await apiFetch(`${BASE()}/discover/deezer/${deezerId}`)
  if (!res.ok) throw new Error('Failed to load album')
  return res.json()
}

/**
 * Loose title/artist match — the releases feed and the search sources spell
 * things differently (punctuation, "EP"/"Deluxe" suffixes, feature credits).
 *
 * Containment only counts when the shorter side is long enough to be
 * distinctive: short strings are substrings of half the catalogue, which is how
 * you end up importing an unrelated record that happens to share a word.
 */
function looseMatch(a: string, b: string): boolean {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '')
  const [x, y] = [norm(a), norm(b)]
  if (!x || !y) return false
  if (x === y) return true
  const [short, long] = x.length <= y.length ? [x, y] : [y, x]
  return short.length >= 5 && long.includes(short)
}

/**
 * Resolve a release that carries no Deezer id to a full album+tracks shape, by
 * searching for it. The new-releases feed is ranked from AOTY, whose most-rated
 * records regularly fail to match Deezer — without this they'd open a page with
 * no tracklist and nothing to rate. Deezer first (the catalogue the feed matches
 * against), then iTunes as a backstop.
 */
export async function resolveReleaseByName(
  albumName: string,
  artist: string,
): Promise<SpotifyAlbumResult> {
  const q = `${albumName} ${artist}`
  for (const search of [searchDeezer, searchItunes]) {
    let hits: AlbumSearchResult[]
    try {
      hits = await search(q)
    } catch {
      continue // one source being down shouldn't stop the other from trying
    }
    // Both title and artist must match. Falling back to "any album by this
    // artist" silently imports the wrong record, which is worse than telling
    // the user we couldn't find it.
    const hit = hits.find((r) => looseMatch(r.artist, artist) && looseMatch(r.album_name, albumName))
    if (hit) return resolveAlbum(hit)
  }
  throw new Error('No match for this release')
}

export interface AlbumReportSong {
  title: string
  track_number: number | null
  score: number | null
  is_bang: boolean
  is_skip: boolean
}

export interface ArtistStatsSnapshot {
  avg_song_score: number | null
  bang_pct: number | null
  skip_pct: number | null
  w_song_plus: number | null
  consistency_plus: number | null
  percentiles: {
    avg_song_score: number | null
    bang_pct: number | null
    skip_pct: number | null
    w_song_plus: number | null
    consistency_plus: number | null
  }
}

export interface AlbumReportData {
  album: {
    id: number
    album_name: string
    artist: string
    year: number | null
    score: number | null
    album_art_url: string | null
    genre: string | null
    extra_artists: string[]
    theme: number | null
    replay_value: number | null
    production: number | null
    distinctness: number | null
  }
  songs: AlbumReportSong[]
  bang_count: number
  skip_count: number
  bang_pct: number
  skip_pct: number
  avg_bang_pct: number
  avg_skip_pct: number
  album_rank: number | null
  album_rank_of: number
  all_album_scores: number[]
  artist_stats_after: ArtistStatsSnapshot
  artist_stats_before: ArtistStatsSnapshot
}

export async function fetchAlbumReport(albumId: number): Promise<AlbumReportData> {
  const res = await apiFetch(`${BASE()}/albums/${albumId}/report`)
  if (!res.ok) throw new Error('Report fetch failed')
  return res.json()
}

export async function analyzeAudio(albumId: number): Promise<{ analyzed: number; tracks: { id: number; bpm?: number; musical_key?: string; loudness_db?: number; error?: string }[] }> {
  const res = await apiFetch(`${BASE()}/albums/${albumId}/analyze-audio`, { method: 'POST' })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error((err as { detail?: string }).detail ?? 'Audio analysis failed')
  }
  return res.json()
}

// ── Stats ─────────────────────────────────────────────────────────────────────

export interface Summary {
  total_albums_rated: number
  total_songs_rated: number
  avg_album_score: number | null
  avg_song_score: number | null
  top_album: { name: string; artist: string; score: number } | null
  top_song: { title: string; artist: string; score: number } | null
  avg_theme: number | null
  avg_replay: number | null
  avg_production: number | null
  avg_distinctness: number | null
  most_rated_artist: { name: string; count: number } | null
  best_genre: { genre: string; avg_score: number; count: number } | null
  avg_release_year: number | null
  longest_streak: number
  albums_this_year: number
  total_10s: number
}

export async function fetchFactorStats(): Promise<FactorStats> {
  const res = await apiFetch(`${BASE()}/stats/factor-stats`)
  return res.json()
}

export interface FactorWeightsResponse {
  points: FactorPoints
  default: FactorPoints
  total: number
  min: number
}

export async function fetchFactorWeights(userId: number): Promise<FactorWeightsResponse> {
  const res = await apiFetch(`${BASE()}/users/${userId}/factor-weights`)
  if (!res.ok) throw new Error('Failed to load scoring weights')
  return res.json()
}

export async function updateFactorWeights(
  userId: number,
  points: FactorPoints,
): Promise<{ points: FactorPoints; recomputed: number }> {
  const res = await apiFetch(`${BASE()}/users/${userId}/factor-weights`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(points),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error((err as { detail?: string }).detail ?? 'Failed to save scoring weights')
  }
  return res.json()
}

export async function fetchSummary(userId = 1): Promise<Summary> {
  const res = await apiFetch(`${BASE()}/stats/summary?user_id=${userId}`)
  return res.json()
}

export async function fetchArtistStats(userId = 1, beforeDate?: string): Promise<ArtistStats[]> {
  const params = new URLSearchParams({ user_id: String(userId) })
  if (beforeDate) params.set('before_date', beforeDate)
  const res = await apiFetch(`${BASE()}/stats/artists?${params}`)
  const data = await res.json() as Record<string, unknown>[]
  return data.map((d) => ({
    artist: d.artist as string,
    count: d.count as number,
    avgSongScore: d.avg_song_score as number,
    wavgSongScore: d.wavg_song_score as number,
    aCi: d.a_ci as number,
    sar: d.sar as number,
    sarPs: d.sar_ps as number,
    skipPct: d.skip_pct as number,
    bangPct: d.bang_pct as number,
    songPlus: 0,
    wSongPlus: 0,
  }))
}

export interface GenreStat {
  genre: string
  count: number
  avg_score: number
}

/** The subgenre slots, aggregated the same way genres are. An album counts
 *  once per distinct subgenre it carries. */
export async function fetchSubgenreStats(userId = 1): Promise<GenreStat[]> {
  const res = await apiFetch(`${BASE()}/stats/subgenres?user_id=${userId}`)
  if (!res.ok) return []
  return res.json()
}

export async function fetchGenreStats(userId = 1): Promise<GenreStat[]> {
  const res = await apiFetch(`${BASE()}/stats/genres?user_id=${userId}`)
  return res.json()
}

export interface TagRecord {
  rank: number
  album_id: number
  album_name: string
  artist: string
  album_art_url: string | null
  year: number | null
  score: number
}

export interface TagRecords {
  tag: string
  kind: 'genre' | 'subgenre'
  count: number
  avg_score: number | null
  items: TagRecord[]
}

/** The albums behind one bar of the genre/subgenre breakdown, best first.
 *  Readable for a friend, so their bar opens their board and not yours. */
export async function fetchTagRecords(
  tag: string,
  kind: 'genre' | 'subgenre',
  userId: number,
): Promise<TagRecords> {
  const res = await apiFetch(
    `${BASE()}/stats/tag-records?tag=${encodeURIComponent(tag)}&kind=${kind}&user_id=${userId}`,
  )
  if (!res.ok) throw new Error('Failed to load records')
  return res.json()
}

export interface GenreScores { genre: string; scores: number[] }
export async function fetchGenreScores(userId = 1): Promise<GenreScores[]> {
  const res = await apiFetch(`${BASE()}/stats/genre-scores?user_id=${userId}`)
  return res.json()
}

export interface YearEntry {
  album_name: string
  artist: string
  score: number
}

export async function fetchYearByYear(userId = 1): Promise<Record<string, YearEntry[]>> {
  const res = await apiFetch(`${BASE()}/stats/year-by-year?user_id=${userId}`)
  return res.json()
}

export interface ArtistPercentiles {
  avg_song_score: number | null
  song_plus: number | null
  w_song_plus: number | null
  avg_external: number | null
  bang_pct: number | null
  skip_pct: number | null
  consistency_idx: number | null
  consistency_plus: number | null
}

/** What the comparison view draws for the userbase: a trimmed slice of
 *  ArtistDetail. The compare bars never read the album list or raw song
 *  scores, so shipping the whole global payload would double the response for
 *  fields nothing reads. */
export interface ArtistPopulationSlice {
  percentiles: ArtistPercentiles
  avg_song_score: number | null
  avg_external: number | null
  song_plus: number | null
  w_song_plus: number | null
  consistency_plus: number | null
  bang_pct: number | null
  skip_pct: number | null
  song_count: number
  album_count: number
  small_sample: boolean
  genre: string | null
  subgenres: string[]
  /** population='both' only — everyone else's raw song scores for this artist,
   *  so the compare view can draw their distribution against yours. */
  song_scores?: number[]
}

/** Which rating set the page is showing: your library, all of Pressd pooled,
 *  or yours with the userbase's attached for comparison. */
export type ArtistPopulation = 'me' | 'global' | 'both'

/** How far one of your song scores sits from the pooled Press'd score for the
 *  same track. Positive means you rate it higher than the crowd. */
export interface SongGap {
  title: string
  mine: number
  theirs: number
  diff: number
  /** How many other people rated it — the pooled figure excludes you. */
  raters: number
}

export interface ArtistDetail {
  artist: string
  /** Rolled up from the artist's albums in whichever scope was requested,
   *  ranked by how often each tag appears. */
  genre: string | null
  subgenres: string[]
  /** population='both' only — the userbase's numbers alongside yours, so each
   *  bar can mark both off one request. */
  global?: ArtistPopulationSlice
  song_count: number
  album_count: number
  avg_song_score: number | null
  avg_external: number | null
  small_sample: boolean
  bang_pct: number | null
  skip_pct: number | null
  consistency_idx: number | null
  consistency_plus: number | null
  song_plus: number | null
  w_song_plus: number | null
  song_score_rank: number | null
  song_score_rank_of: number
  external_rank: number | null
  external_rank_of: number
  song_plus_rank: number | null
  song_plus_rank_of: number
  w_song_plus_rank: number | null
  w_song_plus_rank_of: number
  percentiles: ArtistPercentiles
  song_scores: number[]
  /** Placement by songs rated within this payload's scope — site-wide when
   *  population='global'. `genre_*` is the same ranking inside their own genre. */
  popularity_rank: number | null
  popularity_of: number
  genre_popularity_rank: number | null
  genre_popularity_of: number
  popularity_genre: string | null
  /** Cover art for this artist from anywhere in Press'd, newest first. Lets the
   *  header show covers for an artist you've barely rated, or not at all. */
  catalog_art?: { album_name: string; album_art_url: string; year: number | null }[]
  /** population='both' only. One row per track you and at least one other
   *  person have both rated, biggest disagreement first. */
  song_gaps?: SongGap[]
  albums: {
    id: number
    album_name: string
    year: number | null
    score: number | null
    album_art_url: string | null
    avg_external: number | null
    is_ep: boolean
    status: string
  }[]
  all_artists: {
    artist: string
    avg_song_score: number | null
    avg_external: number | null
  }[]
}

export interface ScatterPoint {
  artist: string
  avg_song_score: number
  avg_external: number | null
  genre: string | null
  song_count: number
  song_plus: number | null
  w_song_plus: number | null
  consistency_plus: number | null
}

export interface ScatterData {
  points: ScatterPoint[]
  mean_song: number | null
  mean_external: number | null
}

export async function fetchArtStrip(): Promise<string[]> {
  const res = await apiFetch(`${BASE()}/albums/art-strip`)
  if (!res.ok) return []
  return res.json()
}

export async function fetchScoreRange(userId = 1): Promise<{ mu: number; sd: number; min: number; max: number }> {
  const res = await apiFetch(`${BASE()}/stats/score-range?user_id=${userId}`)
  return res.json()
}

export async function fetchScatterData(userId = 1, beforeDate?: string): Promise<ScatterData> {
  const params = new URLSearchParams({ user_id: String(userId) })
  if (beforeDate) params.set('before_date', beforeDate)
  const res = await apiFetch(`${BASE()}/stats/scatter?${params}`)
  return res.json()
}

/** One neighbouring artist and the single track you split from Press'd on most.
 *  "Neighbouring" is shared canonical genre, ranked by subgenre overlap. */
export interface SimilarArtistComparison {
  artist: string
  image_url: string | null
  shared_subgenres: number
  top_gap: { title: string; diff: number }
}

export async function fetchSimilarArtistComparisons(
  artist: string,
  userId: number,
): Promise<SimilarArtistComparison[]> {
  const res = await apiFetch(
    `${BASE()}/stats/artist/${encodeURIComponent(artist)}/similar?user_id=${userId}`,
  )
  if (!res.ok) return []
  return res.json()
}

export async function fetchArtistDetail(
  artist: string,
  userId = 1,
  population: ArtistPopulation = 'me',
): Promise<ArtistDetail> {
  const res = await apiFetch(
    `${BASE()}/stats/artist/${encodeURIComponent(artist)}?user_id=${userId}&population=${population}`,
  )
  if (!res.ok) throw new Error('Artist not found')
  return res.json()
}

// ── AOTY ─────────────────────────────────────────────────────────────────────

export interface AotyAlbum {
  title: string
  year: number | null
  type: string
  mb_id: string
  cover_url: string | null
  score: number | null
}

export interface AotyData {
  mb_artist_id: string
  total_on_mb: number
  unrated: AotyAlbum[]
}

export async function fetchAotyAlbums(artist: string): Promise<AotyData> {
  const res = await apiFetch(`${BASE()}/aoty/artist/${encodeURIComponent(artist)}`)
  if (!res.ok) throw new Error('Artist not found on AOTY')
  return res.json()
}

export async function refreshAotyArtist(artist: string): Promise<void> {
  await apiFetch(`${BASE()}/aoty/artist/${encodeURIComponent(artist)}/refresh`, { method: 'POST' })
}

// ── Auth ──────────────────────────────────────────────────────────────────────

/** Shape both providers return, and the point where the new session token is
 *  swapped in. `link: true` attaches the identity to the account the current
 *  token belongs to instead of signing in — the server takes the target user
 *  from that token, never from the request body. */
async function postAuth(path: string, body: Record<string, unknown>): Promise<UserInfo> {
  const res = await apiFetch(`${BASE()}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error((err as { detail?: string }).detail ?? 'Sign in failed')
  }
  const data = await res.json()
  config.setToken(data.token)
  const u = data.user
  return { id: u.id, name: u.name, avatarUrl: u.avatar_url ?? undefined, bio: u.bio ?? undefined }
}

export async function signInWithGoogle(accessToken: string): Promise<UserInfo> {
  return postAuth('/auth/google', { access_token: accessToken })
}

export async function signInWithApple(identityToken: string, fullName?: string): Promise<UserInfo> {
  return postAuth('/auth/apple', { identity_token: identityToken, full_name: fullName })
}

/** Attach Google to the signed-in account. Requires a valid session token. */
export async function linkGoogle(accessToken: string): Promise<UserInfo> {
  return postAuth('/auth/google', { access_token: accessToken, link: true })
}

/** Attach Apple to the signed-in account. Requires a valid session token. */
export async function linkApple(identityToken: string, fullName?: string): Promise<UserInfo> {
  return postAuth('/auth/apple', { identity_token: identityToken, full_name: fullName, link: true })
}

export interface LinkedProviders {
  google: boolean
  apple: boolean
  email?: string | null
}

export async function fetchLinkedProviders(): Promise<LinkedProviders> {
  const res = await apiFetch(`${BASE()}/auth/providers`)
  if (!res.ok) throw new Error('Failed to load linked accounts')
  return res.json()
}

/** Detach a provider. The server refuses if it is the only way into the
 *  account, so the caller can surface that message as-is. */
export async function unlinkProvider(provider: 'google' | 'apple'): Promise<void> {
  const res = await apiFetch(`${BASE()}/auth/providers/${provider}`, { method: 'DELETE' })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error((err as { detail?: string }).detail ?? 'Failed to unlink')
  }
}

// ── Users / Invites / Friends ─────────────────────────────────────────────────

export interface UserInfo {
  id: number
  name: string
  avatarUrl?: string
  bio?: string
}

export async function fetchUsers(): Promise<UserInfo[]> {
  const res = await apiFetch(`${BASE()}/users/`)
  return res.json()
}

export interface UserSearchResult {
  id: number
  name: string
  avatar_url?: string
  already_friends: boolean
  request_sent: boolean      // I already requested them
  request_received: boolean  // they requested me
}

export async function searchUsers(q: string, excludeUserId: number): Promise<UserSearchResult[]> {
  const res = await apiFetch(`${BASE()}/users/search?q=${encodeURIComponent(q)}&exclude_user_id=${excludeUserId}`)
  if (!res.ok) return []
  return res.json()
}

export async function addFriend(
  userId: number,
  friendId: number,
): Promise<{ ok: boolean; status: 'pending' | 'accepted'; already_friends: boolean }> {
  const res = await apiFetch(`${BASE()}/users/${userId}/friends`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ friend_id: friendId }),
  })
  if (!res.ok) throw new Error('Failed to send friend request')
  return res.json()
}

export async function fetchFriendRequests(
  userId: number,
): Promise<{ incoming: UserInfo[]; outgoing: UserInfo[] }> {
  const res = await apiFetch(`${BASE()}/users/${userId}/friend-requests`)
  if (!res.ok) throw new Error('Failed to fetch friend requests')
  const data = await res.json()
  const map = (u: { id: number; name: string; avatar_url?: string }): UserInfo => ({
    id: u.id, name: u.name, avatarUrl: u.avatar_url ?? undefined,
  })
  return { incoming: (data.incoming ?? []).map(map), outgoing: (data.outgoing ?? []).map(map) }
}

export async function acceptFriendRequest(userId: number, otherId: number): Promise<void> {
  const res = await apiFetch(`${BASE()}/users/${userId}/friend-requests/${otherId}/accept`, { method: 'POST' })
  if (!res.ok) throw new Error('Failed to accept request')
}

export async function declineFriendRequest(userId: number, otherId: number): Promise<void> {
  const res = await apiFetch(`${BASE()}/users/${userId}/friend-requests/${otherId}`, { method: 'DELETE' })
  if (!res.ok) throw new Error('Failed to decline request')
}

export async function getInviteLink(userId: number): Promise<{ link: string; inviter_name: string }> {
  const res = await apiFetch(`${BASE()}/users/${userId}/invite-link`)
  if (!res.ok) throw new Error('Failed to get invite link')
  return res.json()
}

export async function fetchInvite(token: string): Promise<{ inviter_name: string; email: string }> {
  const res = await apiFetch(`${BASE()}/users/invite/${token}`)
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error((err as { detail?: string }).detail ?? 'Invalid invite')
  }
  return res.json()
}

export async function acceptInvite(token: string, name?: string, userId?: number): Promise<UserInfo> {
  const res = await apiFetch(`${BASE()}/users/invite/${token}/accept`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(userId !== undefined ? { user_id: userId } : { name }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error((err as { detail?: string }).detail ?? 'Failed to accept invite')
  }
  const data = await res.json()
  config.setToken(data.token)
  const u = data.user
  return { id: u.id, name: u.name, avatarUrl: u.avatar_url ?? undefined, bio: u.bio ?? undefined }
}

export async function fetchFriends(userId: number): Promise<UserInfo[]> {
  const res = await apiFetch(`${BASE()}/users/${userId}/friends`)
  const data = await res.json()
  return data.map((u: { id: number; name: string; avatar_url?: string; bio?: string }) => ({
    id: u.id, name: u.name, avatarUrl: u.avatar_url ?? undefined, bio: u.bio ?? undefined,
  }))
}

export async function removeFriend(userId: number, friendId: number): Promise<void> {
  const res = await apiFetch(`${BASE()}/users/${userId}/friends/${friendId}`, { method: 'DELETE' })
  if (!res.ok) throw new Error('Failed to remove friend')
}

// ── Profile & picks ───────────────────────────────────────────────────────────
// Left in the server's snake_case, like FeedItem and Comment below: the payload
// is read straight onto a card rather than merged into an Album or Song, so a
// transformer would only add a shape to keep in sync.

export interface ProfileAlbumPick {
  id: number
  album_name: string
  artist: string
  album_art_url: string | null
  score: number | null
}

export interface ProfileSongPick {
  id: number
  title: string
  score: number | null
  album_name: string | null
  artist: string | null
  album_art_url: string | null
}

export interface Profile {
  id: number
  name: string
  avatar_url: string | null
  bio: string | null
  /** False until `picks_required` albums are rated; the picks row stays hidden. */
  picks_unlocked: boolean
  picks_rated_count: number
  picks_required: number
  favorite_artist: string | null
  favorite_album: ProfileAlbumPick | null
  favorite_song: ProfileSongPick | null
}

/** Readable for any user, so a friend's page renders their picks the same way
 *  your own does. The picks are resolved server-side on every read — a deleted
 *  album comes back null rather than as a stale title. */
export async function fetchProfile(userId: number): Promise<Profile> {
  const res = await apiFetch(`${BASE()}/users/${userId}/profile`)
  if (!res.ok) throw new Error('Failed to load profile')
  return res.json()
}

/** Patch the signed-in user's profile. Every field is optional and omitted keys
 *  are left alone; an explicit `null` on a pick clears it. Albums and songs must
 *  be the caller's own rated items, and all three picks are refused until ten
 *  albums are rated — which is why the pickers are only reachable past that bar. */
export async function updateUser(
  userId: number,
  data: {
    name?: string
    avatarUrl?: string | null
    bio?: string
    favoriteAlbumId?: number | null
    favoriteSongId?: number | null
    favoriteArtist?: string | null
  },
): Promise<Profile> {
  const res = await apiFetch(`${BASE()}/users/${userId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    // JSON.stringify drops undefined keys, which is what keeps "not mentioned"
    // distinct from "clear this" — the difference the endpoint is built around.
    body: JSON.stringify({
      name: data.name,
      avatar_url: data.avatarUrl,
      bio: data.bio,
      favorite_album_id: data.favoriteAlbumId,
      favorite_song_id: data.favoriteSongId,
      favorite_artist: data.favoriteArtist,
    }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error((err as { detail?: string }).detail ?? 'Failed to update profile')
  }
  return res.json()
}

/** One scored song of a user's, as the favourite-song picker lists them: best
 *  first, capped, and carrying enough of its album to draw a row. Search runs
 *  server-side because the cap would otherwise hide anything outside the top. */
export interface RankedSong {
  id: number
  title: string
  score: number | null
  album_id: number
  album_name: string
  artist: string
  album_art_url: string | null
}

export async function fetchRankedSongs(params?: {
  userId?: number
  q?: string
  limit?: number
}): Promise<RankedSong[]> {
  const qs = new URLSearchParams()
  if (params?.userId != null) qs.set('user_id', String(params.userId))
  if (params?.q?.trim()) qs.set('q', params.q.trim())
  if (params?.limit != null) qs.set('limit', String(params.limit))
  const res = await apiFetch(`${BASE()}/songs/ranked?${qs}`)
  if (!res.ok) throw new Error('Failed to load songs')
  return res.json()
}

/** Upload a profile picture as base64. The response's avatar_url carries a
 *  cache-busting stamp, so callers must adopt it rather than reusing the old
 *  one — the path is otherwise identical and the previous image would stick. */
export async function uploadAvatar(
  userId: number,
  image: { base64: string; contentType: string },
): Promise<{ avatar_url: string }> {
  const res = await apiFetch(`${BASE()}/users/${userId}/avatar`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data: image.base64, content_type: image.contentType }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error((err as { detail?: string }).detail ?? 'Failed to upload picture')
  }
  return res.json()
}

export async function deleteAvatar(userId: number): Promise<void> {
  const res = await apiFetch(`${BASE()}/users/${userId}/avatar`, { method: 'DELETE' })
  if (!res.ok) throw new Error('Failed to remove picture')
}

/** Permanently erase the signed-in account and everything attached to it.
 *  Irreversible — callers must confirm with the user first. The session token
 *  is dead the moment this returns, so sign out immediately after. */
export async function deleteOwnAccount(): Promise<void> {
  const res = await apiFetch(`${BASE()}/users/me`, { method: 'DELETE' })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error((err as { detail?: string }).detail ?? 'Failed to delete account')
  }
}

/** Send an album to a friend's To Listen shelf. `note` is the optional line the
 *  sender writes about why — it rides on the recipient's copy, so two friends
 *  sending the same record each carry their own. */
export const RECOMMENDATION_NOTE_MAX = 280

export async function recommendAlbum(
  albumId: number,
  friendId: number,
  recommenderId: number,
  note?: string,
): Promise<{ alreadyExisted: boolean }> {
  const res = await apiFetch(`${BASE()}/albums/${albumId}/recommend`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ friend_id: friendId, recommender_id: recommenderId, note }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error((err as { detail?: string }).detail ?? 'Failed to recommend album')
  }
  const data = await res.json()
  return { alreadyExisted: data.already_existed }
}

export interface FeedItem {
  type: 'rating' | 'recommendation' | 'review'
  friend: { id: number; name: string; avatar_url?: string }
  album_id: number
  album_name: string
  artist: string
  album_art_url?: string
  score: number | null
  date_rated?: string
  recommended_at?: string
  review_excerpt?: string
  review_at?: string
  like_count?: number
  liked_by_me?: boolean
  comment_count?: number
}

export async function fetchFeed(userId: number): Promise<FeedItem[]> {
  const res = await apiFetch(`${BASE()}/social/feed?user_id=${userId}`)
  if (!res.ok) throw new Error('Failed to fetch feed')
  return res.json()
}

// ── Comments ──────────────────────────────────────────────────────────────────

export interface Comment {
  id: number
  album_id: number
  body: string
  created_at: string | null
  author: { id: number; name: string; avatar_url?: string | null }
  can_delete: boolean
}

export async function fetchComments(albumId: number): Promise<Comment[]> {
  const res = await apiFetch(`${BASE()}/albums/${albumId}/comments`)
  if (!res.ok) throw new Error('Failed to fetch comments')
  return res.json()
}

export async function postComment(albumId: number, body: string): Promise<Comment> {
  const res = await apiFetch(`${BASE()}/albums/${albumId}/comments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ body }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error((err as { detail?: string }).detail ?? 'Failed to post comment')
  }
  return res.json()
}

export async function deleteComment(commentId: number): Promise<void> {
  const res = await apiFetch(`${BASE()}/comments/${commentId}`, { method: 'DELETE' })
  if (!res.ok) throw new Error('Failed to delete comment')
}

// ── Reviews ───────────────────────────────────────────────────────────────────

export async function saveReview(albumId: number, body: string): Promise<{ review: string | null; review_at: string | null }> {
  const res = await apiFetch(`${BASE()}/albums/${albumId}/review`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ body }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error((err as { detail?: string }).detail ?? 'Failed to save review')
  }
  return res.json()
}

export async function deleteReview(albumId: number): Promise<void> {
  const res = await apiFetch(`${BASE()}/albums/${albumId}/review`, { method: 'DELETE' })
  if (!res.ok) throw new Error('Failed to delete review')
}

export interface FriendReview {
  friend: { id: number; name: string; avatar_url?: string }
  album_id: number
  album_name: string
  artist: string
  album_art_url?: string
  score: number | null
  review: string
  review_at?: string
  like_count: number
  liked_by_me: boolean
  comment_count: number
}

export async function fetchFriendReviews(sort: 'recent' | 'top' = 'recent'): Promise<FriendReview[]> {
  const res = await apiFetch(`${BASE()}/social/reviews?sort=${sort}`)
  if (!res.ok) throw new Error('Failed to fetch reviews')
  return res.json()
}

// Userbase-wide "most talked about" reviews for the latest active calendar day.
export interface TopReview {
  author: { id: number; name: string; avatar_url?: string }
  album_id: number
  album_name: string
  artist: string
  album_art_url?: string
  score: number | null
  review: string
  review_at?: string
  like_count: number
  liked_by_me: boolean
  comment_count: number
  top_song: { title: string; score: number } | null
  bottom_song: { title: string; score: number } | null
}

export interface TopReviewsResponse {
  day: string | null
  reviews: TopReview[]
}

export async function fetchTopReviews(limit = 8): Promise<TopReviewsResponse> {
  const res = await apiFetch(`${BASE()}/social/top-reviews?limit=${limit}`)
  if (!res.ok) throw new Error('Failed to fetch top reviews')
  return res.json()
}

// Compare board — albums your community (you + friends) has rated, ≥2 raters.
export interface CompareRater {
  /** Who this is, so the client can link through to their profile. */
  user_id: number
  name: string
  /** Null for users who never set one — the client falls back to a colored
   *  initial keyed off the name. */
  avatar_url: string | null
  score: number
  review: string | null
  is_you: boolean
}

export interface CompareItem {
  album_id: number
  album_name: string
  artist: string
  year: number | null
  album_art_url: string | null
  friend_count: number
  you_rated: boolean
  spread: number
  recent: boolean
  has_reviews: boolean
  highlight: 'disagreement' | 'friends'
  raters: CompareRater[]
}

export async function fetchCompare(): Promise<CompareItem[]> {
  const res = await apiFetch(`${BASE()}/social/compare`)
  if (!res.ok) throw new Error('Failed to load compare')
  const data = await res.json()
  return (data.items ?? []) as CompareItem[]
}

export async function toggleLike(userId: number, albumId: number): Promise<{ liked: boolean }> {
  const res = await apiFetch(`${BASE()}/social/like?user_id=${userId}&album_id=${albumId}`, {
    method: 'POST',
  })
  if (!res.ok) throw new Error('Failed to toggle like')
  return res.json()
}

export async function fetchAnalysis(userId: number): Promise<{ insights: string[] }> {
  const res = await apiFetch(`${BASE()}/stats/analysis?user_id=${userId}`)
  if (!res.ok) throw new Error('Failed to fetch analysis')
  return res.json()
}

/** Bind this device's push token to the signed-in user.
 *
 *  Upserted server-side on the token, so calling this on every launch is
 *  correct and cheap — FCM reissues tokens after a reinstall or a restore, and
 *  the only way to notice is to re-register.
 */
export async function registerPushToken(
  token: string,
  platform: 'ios' | 'android' = 'ios',
): Promise<boolean> {
  const res = await apiFetch(`${BASE()}/users/push-token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, platform }),
  })
  return res.ok
}

/** Drop a token on sign-out, so the next account on this phone does not
 *  inherit the previous one's notifications. */
export async function unregisterPushToken(token: string): Promise<boolean> {
  const res = await apiFetch(
    `${BASE()}/users/push-token?token=${encodeURIComponent(token)}`,
    { method: 'DELETE' },
  )
  return res.ok
}


// ── Discussions (PLAN_discussions.md §5) ─────────────────────────────────────

function transformPost(p: Record<string, unknown>): DiscussionPost {
  const a = p.author as Record<string, unknown> | null
  return {
    id: p.id as number,
    parentId: (p.parent_id as number | null) ?? null,
    kind: (p.kind as DiscussionPost['kind']) ?? 'user',
    body: (p.body as string) ?? '',
    deleted: !!p.deleted,
    isSpoiler: !!p.is_spoiler,
    createdAt: (p.created_at as string | null) ?? null,
    editedAt: (p.edited_at as string | null) ?? null,
    likeCount: (p.like_count as number) ?? 0,
    dislikeCount: (p.dislike_count as number) ?? 0,
    replyCount: (p.reply_count as number) ?? 0,
    myVote: (p.my_vote as number) ?? 0,
    author: a
      ? {
          id: a.id as number,
          name: (a.name as string) ?? 'Unknown',
          avatarUrl: (a.avatar_url as string | null) ?? null,
          score: (a.score as number | null) ?? null,
        }
      : null,
    canDelete: !!p.can_delete,
    canEdit: !!p.can_edit,
  }
}

/** Query string for a subject. The server turns these into the key; sending a
 *  key from the client is what forks a room. */
function subjectQuery(ref: SubjectRef): string {
  const q = new URLSearchParams({ subject_type: ref.subjectType })
  if (ref.artist) q.set('artist', ref.artist)
  if (ref.album) q.set('album', ref.album)
  if (ref.trackId != null) q.set('track_id', String(ref.trackId))
  return q.toString()
}

function subjectBody(ref: SubjectRef): Record<string, unknown> {
  return {
    subject_type: ref.subjectType,
    ...(ref.artist ? { artist: ref.artist } : {}),
    ...(ref.album ? { album: ref.album } : {}),
    ...(ref.trackId != null ? { track_id: ref.trackId } : {}),
  }
}

/** Thread metadata and whether this viewer is allowed in. Does not throw on a
 *  locked subject — the caller has to draw the lock and say what opens it. */
export async function resolveThread(ref: SubjectRef): Promise<ThreadMeta> {
  const res = await apiFetch(`${BASE()}/threads/resolve?${subjectQuery(ref)}`)
  if (!res.ok) throw new Error('Failed to resolve thread')
  const d = await res.json()
  return {
    subjectType: d.subject_type,
    subjectKey: d.subject_key,
    threadId: d.thread_id ?? null,
    title: d.title ?? '',
    subtitle: d.subtitle ?? null,
    artUrl: d.art_url ?? null,
    postCount: d.post_count ?? 0,
    reviewCount: d.review_count ?? 0,
    raterCount: d.rater_count ?? 0,
    participantCount: d.participant_count ?? 0,
    lastPostAt: d.last_post_at ?? null,
    canRead: !!d.can_read,
    canPost: !!d.can_post,
    lockedReason: d.locked_reason ?? null,
  }
}

export async function fetchThreadPosts(
  threadId: number,
  sort: ThreadSort = 'popular',
  cursor?: string | null,
): Promise<ThreadPage> {
  const q = new URLSearchParams({ sort })
  if (cursor) q.set('cursor', cursor)
  const res = await apiFetch(`${BASE()}/threads/${threadId}/posts?${q.toString()}`)
  if (!res.ok) throw new Error('Failed to fetch posts')
  const d = await res.json()
  return {
    threadId: d.thread_id,
    sort: d.sort,
    posts: (d.posts as Record<string, unknown>[]).map(transformPost),
    nextCursor: d.next_cursor ?? null,
  }
}

export async function createThreadPost(
  ref: SubjectRef,
  body: string,
  isSpoiler = false,
): Promise<{ id: number; threadId: number }> {
  const res = await apiFetch(`${BASE()}/threads/posts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...subjectBody(ref), body, is_spoiler: isSpoiler }),
  })
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail ?? 'Failed to post')
  const d = await res.json()
  return { id: d.id, threadId: d.thread_id }
}

export async function fetchReplies(postId: number): Promise<DiscussionPost[]> {
  const res = await apiFetch(`${BASE()}/posts/${postId}/replies`)
  if (!res.ok) throw new Error('Failed to fetch replies')
  return ((await res.json()) as Record<string, unknown>[]).map(transformPost)
}

export async function replyToPost(postId: number, body: string): Promise<{ id: number }> {
  const res = await apiFetch(`${BASE()}/posts/${postId}/replies`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ body }),
  })
  if (!res.ok) throw new Error('Failed to reply')
  return res.json()
}

export async function editPost(postId: number, body: string): Promise<void> {
  const res = await apiFetch(`${BASE()}/posts/${postId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ body }),
  })
  if (!res.ok) throw new Error('Failed to edit post')
}

export async function deletePost(postId: number): Promise<void> {
  const res = await apiFetch(`${BASE()}/posts/${postId}`, { method: 'DELETE' })
  if (!res.ok) throw new Error('Failed to delete post')
}

/** Vote on a post: 1 up, -1 down. Sending the vote already held clears it, so
 *  the caller can pass the button that was tapped and let the server decide. */
export async function votePost(
  postId: number,
  value: 1 | -1 | 0,
): Promise<{ myVote: number; likeCount: number; dislikeCount: number }> {
  const res = await apiFetch(`${BASE()}/posts/${postId}/vote`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ value }),
  })
  if (!res.ok) throw new Error('Failed to vote')
  const d = await res.json()
  return { myVote: d.my_vote ?? 0, likeCount: d.like_count ?? 0, dislikeCount: d.dislike_count ?? 0 }
}

export async function reportPost(
  postId: number,
  reason: 'abuse' | 'off_subject' | 'spoiler',
): Promise<void> {
  const res = await apiFetch(`${BASE()}/posts/${postId}/report`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reason }),
  })
  if (!res.ok) throw new Error('Failed to report post')
}

export async function flagSpoiler(postId: number): Promise<{ blurred: boolean }> {
  const res = await apiFetch(`${BASE()}/posts/${postId}/spoiler`, { method: 'POST' })
  if (!res.ok) throw new Error('Failed to flag post')
  const d = await res.json()
  return { blurred: !!d.blurred }
}

/** Publish what was written during the rating flow — the review and any track
 *  notes — in one request. The server fans out to the threads; the client must
 *  not loop, since a dropped connection mid-loop loses writing outright.
 *
 *  Call it *after* the rating has landed. A note is a consequence of a rating,
 *  never a condition of one, and `failed` names anything to offer back. */
export async function publishThoughts(
  albumId: number,
  review: string | null,
  notes: { songId: number; body: string }[],
): Promise<{ reviewPosted: boolean; notesPosted: number; failed: number[] }> {
  const res = await apiFetch(`${BASE()}/albums/${albumId}/thoughts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      review,
      notes: notes.map((n) => ({ song_id: n.songId, body: n.body })),
    }),
  })
  if (!res.ok) throw new Error('Failed to publish thoughts')
  const d = await res.json()
  return {
    reviewPosted: !!d.review_posted,
    notesPosted: d.notes_posted ?? 0,
    failed: (d.failed ?? []) as number[],
  }
}

export interface TrackThreadInfo {
  trackId: number
  noteCount: number
  /** Withheld — not merely dimmed — on a track the viewer has not rated: a
   *  preview of what people said about it is the spoiler the gate exists for. */
  preview: string | null
  locked: boolean
}

/** Note counts and previews for every track on an album, in one call. Never
 *  fetch these per row: a 25-track record would issue 25 requests on mount. */
export async function fetchTrackThreads(
  albumId: number,
): Promise<Record<number, TrackThreadInfo>> {
  const res = await apiFetch(`${BASE()}/albums/${albumId}/track-threads`)
  if (!res.ok) throw new Error('Failed to fetch track notes')
  const d = (await res.json()) as Record<string, Record<string, unknown>>
  const out: Record<number, TrackThreadInfo> = {}
  for (const [songId, v] of Object.entries(d)) {
    out[Number(songId)] = {
      trackId: v.track_id as number,
      noteCount: (v.note_count as number) ?? 0,
      preview: (v.preview as string | null) ?? null,
      locked: !!v.locked,
    }
  }
  return out
}

export async function fetchHeated(limit = 10): Promise<HeatedRecord[]> {
  const res = await apiFetch(`${BASE()}/discover/heated?limit=${limit}`)
  if (!res.ok) throw new Error('Failed to fetch heated discussions')
  return ((await res.json()) as Record<string, unknown>[]).map((d) => ({
    subjectKey: d.subject_key as string,
    albumName: d.album_name as string,
    artist: (d.artist as string | null) ?? null,
    albumArtUrl: (d.album_art_url as string | null) ?? null,
    reviewCount: (d.review_count as number) ?? 0,
    recentReviews: (d.recent_reviews as number) ?? 0,
    raters: (d.raters as number) ?? 0,
    meanScore: (d.mean_score as number | null) ?? null,
    spread: (d.spread as number) ?? 0,
    controversial: !!d.controversial,
    loved: !!d.loved,
    hated: !!d.hated,
    isNew: !!d.is_new,
  }))
}

export async function fetchDiscussionFeed(
  cursor?: string | null,
): Promise<{ posts: FeedPost[]; nextCursor: string | null }> {
  const q = cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''
  const res = await apiFetch(`${BASE()}/discussions/feed${q}`)
  if (!res.ok) throw new Error('Failed to fetch the discussion feed')
  const d = await res.json()
  return {
    posts: (d.posts as Record<string, unknown>[]).map((p) => {
      const a = p.author as Record<string, unknown>
      const t = p.thread as Record<string, unknown>
      return {
        id: p.id as number,
        isReply: !!p.is_reply,
        toMe: !!p.to_me,
        kind: p.kind as FeedPost['kind'],
        body: (p.body as string) ?? '',
        isSpoiler: !!p.is_spoiler,
        createdAt: (p.created_at as string | null) ?? null,
        likeCount: (p.like_count as number) ?? 0,
        dislikeCount: (p.dislike_count as number) ?? 0,
        replyCount: (p.reply_count as number) ?? 0,
        author: {
          id: a.id as number,
          name: (a.name as string) ?? 'Unknown',
          avatarUrl: (a.avatar_url as string | null) ?? null,
          score: (a.score as number | null) ?? null,
        },
        thread: {
          id: t.id as number,
          subjectType: t.subject_type as SubjectType,
          subjectKey: t.subject_key as string,
          title: (t.title as string) ?? '',
          subtitle: (t.subtitle as string | null) ?? null,
          artUrl: (t.art_url as string | null) ?? null,
        },
      }
    }),
    nextCursor: (d.next_cursor as string | null) ?? null,
  }
}
