import type { Album, Song, ArtistStats, FactorStats, FactorPoints } from './types'

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
    review: a.review as string | null ?? null,
    reviewAt: a.review_at as string | null ?? null,
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
}): Promise<ChartsResponse> {
  const qs = new URLSearchParams()
  if (params?.period) qs.set('period', params.period)
  if (params?.genre) qs.set('genre', params.genre)
  if (params?.decade) qs.set('decade', String(params.decade))
  if (params?.year) qs.set('year', String(params.year))
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
}): Promise<ChartsResponse> {
  const qs = new URLSearchParams()
  if (params?.period) qs.set('period', params.period)
  if (params?.genre) qs.set('genre', params.genre)
  if (params?.decade) qs.set('decade', String(params.decade))
  if (params?.year) qs.set('year', String(params.year))
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

export async function fetchGenreStats(userId = 1): Promise<GenreStat[]> {
  const res = await apiFetch(`${BASE()}/stats/genres?user_id=${userId}`)
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

export interface ArtistDetail {
  artist: string
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
  percentiles: {
    avg_song_score: number | null
    song_plus: number | null
    w_song_plus: number | null
    avg_external: number | null
    bang_pct: number | null
    skip_pct: number | null
    consistency_idx: number | null
    consistency_plus: number | null
  }
  song_scores: number[]
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

export async function fetchArtistDetail(artist: string, userId = 1): Promise<ArtistDetail> {
  const res = await apiFetch(`${BASE()}/stats/artist/${encodeURIComponent(artist)}?user_id=${userId}`)
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

export async function updateUser(userId: number, data: { name?: string; avatarUrl?: string; bio?: string }): Promise<UserInfo> {
  const res = await apiFetch(`${BASE()}/users/${userId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: data.name, avatar_url: data.avatarUrl, bio: data.bio }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error((err as { detail?: string }).detail ?? 'Failed to update profile')
  }
  const u = await res.json()
  return { id: u.id, name: u.name, avatarUrl: u.avatar_url ?? undefined, bio: u.bio ?? undefined }
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

export async function recommendAlbum(albumId: number, friendId: number, recommenderId: number): Promise<{ alreadyExisted: boolean }> {
  const res = await apiFetch(`${BASE()}/albums/${albumId}/recommend`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ friend_id: friendId, recommender_id: recommenderId }),
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
  name: string
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
