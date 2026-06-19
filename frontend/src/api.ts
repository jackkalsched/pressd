import type { Album, Song, ArtistStats, FactorStats } from './types'

const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:8000'

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
    spotifyId: a.spotify_id as string | null,
    extraArtists: (() => { try { const v = JSON.parse(a.extra_artists as string); return Array.isArray(v) ? v : [] } catch { return [] } })(),
    albumArtUrl: a.album_art_url as string | null,
    totalTracks: a.total_tracks as number | null,
    dateAdded: a.date_added as string,
    dateRated: a.date_rated as string | null,
    predictedTheme: a.predicted_theme as number | null ?? null,
    predictedThemeReasoning: a.predicted_theme_reasoning as string | null ?? null,
    predictedScore: a.predicted_score as number | null ?? null,
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
  const res = await fetch(`${BASE}/albums/?${qs}`)
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
  const res = await fetch(`${BASE}/albums/${id}`)
  if (!res.ok) throw new Error('Album not found')
  return transformAlbum(await res.json())
}

export async function updateAlbum(id: number, patch: Record<string, unknown>): Promise<Album> {
  const res = await fetch(`${BASE}/albums/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  })
  if (!res.ok) throw new Error('Failed to update album')
  return transformAlbum(await res.json())
}

export async function deleteAlbum(id: number): Promise<void> {
  const res = await fetch(`${BASE}/albums/${id}`, { method: 'DELETE' })
  if (!res.ok) throw new Error('Failed to delete album')
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
  const res = await fetch(`${BASE}/albums/`, {
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
  const res = await fetch(`${BASE}/songs/?${qs}`)
  return ((await res.json()) as Record<string, unknown>[]).map(transformSong)
}

export async function batchRateSongs(items: { id: number; score: number | null }[]): Promise<void> {
  const res = await fetch(`${BASE}/songs/batch-rate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(items),
  })
  if (!res.ok) throw new Error('Batch rate failed')
}

export async function rateSong(id: number, score: number | null): Promise<Song> {
  const res = await fetch(`${BASE}/songs/${id}`, {
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
  spotify_id: string
  artist: string
}

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
}

export async function searchSpotify(q: string): Promise<SpotifyAlbumResult[]> {
  const res = await fetch(`${BASE}/search/?q=${encodeURIComponent(q)}`)
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error((err as { detail?: string }).detail ?? 'Search failed')
  }
  return res.json()
}

export async function searchMusicBrainz(q: string): Promise<SpotifyAlbumResult[]> {
  const res = await fetch(`${BASE}/search/mb?q=${encodeURIComponent(q)}`)
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error((err as { detail?: string }).detail ?? 'MusicBrainz search failed')
  }
  return res.json()
}

export async function searchItunes(q: string): Promise<SpotifyAlbumResult[]> {
  const res = await fetch(`${BASE}/search/itunes?q=${encodeURIComponent(q)}`)
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error((err as { detail?: string }).detail ?? 'iTunes search failed')
  }
  return res.json()
}

export async function importAlbum(
  data: SpotifyAlbumResult,
  status: 'to_listen' | 'listening',
  userId = 1,
): Promise<Album & { alreadyExisted: boolean }> {
  const res = await fetch(`${BASE}/albums/import?user_id=${userId}`, {
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

export async function backfillCovers(): Promise<{ updated: number; skipped: number; failed: number }> {
  const res = await fetch(`${BASE}/util/backfill-covers`, { method: 'POST' })
  if (!res.ok) throw new Error('Backfill failed')
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
  const res = await fetch(`${BASE}/albums/${albumId}/report`)
  if (!res.ok) throw new Error('Report fetch failed')
  return res.json()
}

export async function analyzeAudio(albumId: number): Promise<{ analyzed: number; tracks: { id: number; bpm?: number; musical_key?: string; loudness_db?: number; error?: string }[] }> {
  const res = await fetch(`${BASE}/albums/${albumId}/analyze-audio`, { method: 'POST' })
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
  top_album: { name: string; artist: string; score: number } | null
  top_song: { title: string; artist: string; score: number } | null
  avg_theme: number | null
  avg_replay: number | null
  avg_production: number | null
  avg_distinctness: number | null
}

export async function fetchFactorStats(): Promise<FactorStats> {
  const res = await fetch(`${BASE}/stats/factor-stats`)
  return res.json()
}

export async function fetchSummary(userId = 1): Promise<Summary> {
  const res = await fetch(`${BASE}/stats/summary?user_id=${userId}`)
  return res.json()
}

export async function fetchArtistStats(userId = 1): Promise<ArtistStats[]> {
  const res = await fetch(`${BASE}/stats/artists?user_id=${userId}`)
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
  const res = await fetch(`${BASE}/stats/genres?user_id=${userId}`)
  return res.json()
}

export interface GenreScores { genre: string; scores: number[] }
export async function fetchGenreScores(userId = 1): Promise<GenreScores[]> {
  const res = await fetch(`${BASE}/stats/genre-scores?user_id=${userId}`)
  return res.json()
}

export interface YearEntry {
  album_name: string
  artist: string
  score: number
}

export async function fetchYearByYear(userId = 1): Promise<Record<string, YearEntry[]>> {
  const res = await fetch(`${BASE}/stats/year-by-year?user_id=${userId}`)
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
  w_song_plus: number | null
  consistency_plus: number | null
}

export interface ScatterData {
  points: ScatterPoint[]
  mean_song: number | null
  mean_external: number | null
}

export async function fetchScatterData(userId = 1): Promise<ScatterData> {
  const res = await fetch(`${BASE}/stats/scatter?user_id=${userId}`)
  return res.json()
}

export async function fetchArtistDetail(artist: string, userId = 1): Promise<ArtistDetail> {
  const res = await fetch(`${BASE}/stats/artist/${encodeURIComponent(artist)}?user_id=${userId}`)
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
  const res = await fetch(`${BASE}/aoty/artist/${encodeURIComponent(artist)}`)
  if (!res.ok) throw new Error('Artist not found on AOTY')
  return res.json()
}

export async function refreshAotyArtist(artist: string): Promise<void> {
  await fetch(`${BASE}/aoty/artist/${encodeURIComponent(artist)}/refresh`, { method: 'POST' })
}

// ── Auth ──────────────────────────────────────────────────────────────────────

export async function signInWithApple(
  idToken: string,
  name?: string,
  linkUserId?: number,
): Promise<{ id: number; name: string; avatarUrl?: string }> {
  const res = await fetch(`${BASE}/auth/apple`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id_token: idToken, name, link_user_id: linkUserId }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error((err as { detail?: string }).detail ?? 'Sign in failed')
  }
  const u = await res.json()
  return { id: u.id, name: u.name, avatarUrl: u.avatar_url ?? undefined }
}

// ── Users / Invites / Friends ─────────────────────────────────────────────────

export interface UserInfo {
  id: number
  name: string
  avatarUrl?: string
}

export async function fetchUsers(): Promise<UserInfo[]> {
  const res = await fetch(`${BASE}/users/`)
  return res.json()
}

export async function sendInvite(fromUserId: number, email?: string): Promise<{ ok: boolean; link: string }> {
  const res = await fetch(`${BASE}/users/invite`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: email ?? '', from_user_id: fromUserId }),
  })
  if (!res.ok) throw new Error('Failed to send invite')
  return res.json()
}

export async function fetchInvite(token: string): Promise<{ inviter_name: string; email: string }> {
  const res = await fetch(`${BASE}/users/invite/${token}`)
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error((err as { detail?: string }).detail ?? 'Invalid invite')
  }
  return res.json()
}

export async function acceptInvite(token: string, name: string): Promise<UserInfo> {
  const res = await fetch(`${BASE}/users/invite/${token}/accept`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error((err as { detail?: string }).detail ?? 'Failed to accept invite')
  }
  const u = await res.json()
  return { id: u.id, name: u.name, avatarUrl: u.avatar_url ?? undefined }
}

export async function fetchFriends(userId: number): Promise<UserInfo[]> {
  const res = await fetch(`${BASE}/users/${userId}/friends`)
  const data = await res.json()
  return data.map((u: { id: number; name: string; avatar_url?: string }) => ({
    id: u.id, name: u.name, avatarUrl: u.avatar_url ?? undefined,
  }))
}

export async function updateUser(userId: number, data: { name?: string; avatarUrl?: string }): Promise<UserInfo> {
  const res = await fetch(`${BASE}/users/${userId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: data.name, avatar_url: data.avatarUrl }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error((err as { detail?: string }).detail ?? 'Failed to update profile')
  }
  const u = await res.json()
  return { id: u.id, name: u.name, avatarUrl: u.avatar_url ?? undefined }
}
