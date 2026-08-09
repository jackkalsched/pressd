// Profile — the signed-in user's home: identity + bio, top-line stats, and a
// Library / Stats / Ratings switcher. Library (the score-badged art grid with a
// Rated / Listening / To Listen filter) is built out here; Stats and Ratings are
// placeholders until their phases land.
import { useMemo, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Animated,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useQuery } from '@tanstack/react-query'
import { Image } from 'expo-image'
import { useRouter } from 'expo-router'
import { ChevronDown, Search, Settings, Star, X } from 'lucide-react-native'
import {
  fetchAlbums,
  fetchSummary,
  fetchScoreRange,
  fetchFriends,
  fetchArtistStats,
  fetchScatterData,
} from '../../lib/api'
import { songScoreColor, type Album, type AlbumStatus } from '@pressd/shared/types'
import { useAuth } from '../../lib/auth'
import { useProfile } from '../../lib/picks'
import StatsView from '../../components/StatsView'
import ProfileBanner, { type PickKind } from '../../components/ProfileBanner'
import SettingsSheet from '../../components/SettingsSheet'
import AnchoredMenu from '../../components/AnchoredMenu'
import { colors, fonts, radii, spacing } from '../../theme/tokens'

const GAP = 10
// The recommendation accent, shared with the Recommend control on album detail.
const RECOMMEND = '#f97316'

// Score-badge color relative to the user's own mean/sd, matching the desktop
// AlbumCard: amber at the mean → dark green above (+2.5 SD), dark red below.
function scoreBadgeColor(score: number, mu: number, sd: number): string {
  const SD_RANGE = 2.5
  if (score >= mu) {
    const t = Math.min(1, (score - mu) / (SD_RANGE * sd))
    return `hsl(${Math.round(30 + t * 108)}, 70%, 30%)`
  }
  const t = Math.min(1, (mu - score) / (SD_RANGE * sd))
  return `hsl(${Math.round(30 - t * 30)}, 72%, 30%)`
}

type Tab = 'library' | 'stats' | 'ratings'
const TABS: { key: Tab; label: string }[] = [
  { key: 'library', label: 'Library' },
  { key: 'stats', label: 'Stats' },
  { key: 'ratings', label: 'Ratings' },
]

const STATUSES: { key: AlbumStatus; label: string }[] = [
  { key: 'rated', label: 'Rated' },
  { key: 'listening', label: 'Listening' },
  { key: 'to_listen', label: 'To Listen' },
]

// ── Rankings sub-tab: sortable album/artist leaderboards ──
const QUALIFIED = 15 // artists need ≥15 rated songs to rank

// The rank column holds a position in a library that grows without bound, so
// it is sized from what it has to show rather than pinned. Same shape as the
// chart board: cap how far the numeral scales, then give it a floor wide
// enough for three digits at that ceiling, and let it grow past it if a
// library ever runs to four.
const NUM_SCALE_CAP = 1.3
const RANK_NUM_SIZE = 15
// Playfair sets digits at roughly 0.55em.
const RANK_NUM_MIN_W = Math.ceil(RANK_NUM_SIZE * NUM_SCALE_CAP * 0.55 * 3)

type RankMode = 'albums' | 'artists'
interface Metric<T> {
  key: string
  label: string
  get: (x: T) => number | string | null
}
const ALBUM_METRICS: Metric<Album>[] = [
  { key: 'score', label: 'Score', get: (a) => a.score },
  { key: 'year', label: 'Year', get: (a) => a.year },
  { key: 'dateRated', label: 'Date Rated', get: (a) => a.dateRated },
  { key: 'name', label: 'Name', get: (a) => a.albumName.toLowerCase() },
]
/** One artist row for the Rankings leaderboard: the +-metrics come from the
 *  scatter endpoint (league-indexed), bang/skip from the artist-stats one. */
interface ArtistRank {
  artist: string
  songs: number
  avgSongScore: number
  songPlus: number | null
  wSongPlus: number | null
  consistencyPlus: number | null
  bangPct: number | null
  skipPct: number | null
}
const ARTIST_METRICS: Metric<ArtistRank>[] = [
  { key: 'songPlus', label: 'Song+', get: (s) => s.songPlus },
  { key: 'wSongPlus', label: 'wSong+', get: (s) => s.wSongPlus },
  { key: 'consPlus', label: 'Cons+', get: (s) => s.consistencyPlus },
  { key: 'bang', label: 'Bang %', get: (s) => s.bangPct },
  { key: 'skip', label: 'Skip %', get: (s) => s.skipPct },
  { key: 'avg', label: 'Avg Song', get: (s) => s.avgSongScore },
]

/** null-safe comparator: nulls sink to the end regardless of direction */
function cmpVals(a: number | string | null, b: number | string | null, dir: 'asc' | 'desc'): number {
  if (a == null && b == null) return 0
  if (a == null) return 1
  if (b == null) return -1
  const c = typeof a === 'string' || typeof b === 'string' ? String(a).localeCompare(String(b)) : (a as number) - (b as number)
  return dir === 'desc' ? -c : c
}

/** Top-N values by frequency across a list of (possibly null) tags. */
function topTags(tags: (string | null)[], n: number): string[] {
  const counts = new Map<string, number>()
  for (const t of tags) {
    if (t) counts.set(t, (counts.get(t) ?? 0) + 1)
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([t]) => t)
}

export default function Profile() {
  const { user } = useAuth()
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const [tab, setTab] = useState<Tab>('library')
  const [libStatus, setLibStatus] = useState<AlbumStatus>('rated')
  const [rankMode, setRankMode] = useState<RankMode>('albums')
  const [rankMetric, setRankMetric] = useState('score')
  const [rankDir, setRankDir] = useState<'asc' | 'desc'>('desc')
  const [rankSearch, setRankSearch] = useState('')
  const metricBtnRef = useRef<View>(null)
  // Kept separate from the Rankings search so switching sub-tabs doesn't carry
  // one filter into a list it wasn't typed for. It does persist across the
  // Rated / Listening / To Listen chips, though — those are three views of one
  // library, and re-typing to follow a record between them is busywork.
  const [libSearch, setLibSearch] = useState('')
  const [metricOpen, setMetricOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)

  function switchRankMode(m: RankMode) {
    setRankMode(m)
    setRankMetric(m === 'albums' ? 'score' : 'avg')
    setRankDir('desc')
  }

  // Rated set drives the header count + "this week"; shares its key with the
  // grid query when the Rated filter is active, so React Query serves one fetch.
  const { data: rated = [] } = useQuery({
    queryKey: ['albums', 'rated', user?.id],
    queryFn: () => fetchAlbums({ status: 'rated', userId: user!.id }),
    enabled: !!user,
  })

  const { data: grid = [], isLoading: gridLoading, refetch, isRefetching } = useQuery({
    queryKey: ['albums', libStatus, user?.id],
    queryFn: () => fetchAlbums({ status: libStatus, userId: user!.id }),
    enabled: !!user && tab === 'library',
  })

  const { data: summary } = useQuery({
    queryKey: ['stats', 'summary', user?.id],
    queryFn: () => fetchSummary(user!.id),
    enabled: !!user,
  })

  // Mean/sd of the user's album scores, so the badge color is relative to them.
  const { data: scoreRange } = useQuery({
    queryKey: ['score-range', user?.id],
    queryFn: () => fetchScoreRange(user!.id),
    enabled: !!user,
    staleTime: 5 * 60_000,
  })
  const badgeMu = scoreRange?.mu ?? 7.0
  const badgeSd = scoreRange?.sd ?? 1.0

  const { data: friends = [] } = useQuery({
    queryKey: ['friends', user?.id],
    queryFn: () => fetchFriends(user!.id),
    enabled: !!user,
  })

  // Name, avatar and the three picks, resolved server-side. The banner hides
  // the picks row on its own until the ten-album bar is cleared.
  const { data: profile } = useProfile(user?.id)

  // Artist leaderboard data for Rankings (same cache keys as the Stats sub-tab
  // and the artist pages). Scatter carries the league-indexed + metrics;
  // artist-stats carries bang/skip.
  const { data: artistStats = [] } = useQuery({
    queryKey: ['artist-stats', user?.id],
    queryFn: () => fetchArtistStats(user!.id),
    enabled: !!user && tab === 'ratings',
  })
  const { data: scatter } = useQuery({
    queryKey: ['stats', 'scatter', user?.id],
    queryFn: () => fetchScatterData(user!.id),
    enabled: !!user && tab === 'ratings',
    staleTime: 5 * 60_000,
  })

  // Favorite tags: top three genres + top three subgenres, one scrolling line.
  const topGenres = useMemo(() => topTags(rated.map((a) => a.genre), 3), [rated])
  const topSubgenres = useMemo(
    () => topTags(rated.flatMap((a) => [a.subGenre1, a.subGenre2, a.subGenre3]), 3),
    [rated],
  )

  // "Pressing since" — the month of the earliest album in the library.
  const since = useMemo(() => {
    const dates = rated.map((a) => a.dateAdded ?? a.dateRated).filter(Boolean) as string[]
    if (dates.length === 0) return null
    const min = dates.reduce((a, b) => (a < b ? a : b))
    const d = new Date(min.length <= 10 ? `${min}T00:00:00` : min)
    return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
  }, [rated])

  // Scroll header: the banner scrolls away and a compact green bar keeping just
  // the profile name fades in, matching the other tabs' treatment.
  const scrollY = useRef(new Animated.Value(0)).current
  const compactOpacity = scrollY.interpolate({ inputRange: [70, 130], outputRange: [0, 1], extrapolate: 'clamp' })
  const onScroll = Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], { useNativeDriver: true })

  const isGrid = tab === 'library'
  const rankMetrics = rankMode === 'albums' ? ALBUM_METRICS : ARTIST_METRICS
  const currentMetric = rankMetrics.find((m) => m.key === rankMetric) ?? rankMetrics[0]
  const q = rankSearch.trim().toLowerCase()
  const libQ = libSearch.trim().toLowerCase()

  const rankedAlbums = useMemo(() => {
    if (tab !== 'ratings' || rankMode !== 'albums') return []
    const metric = ALBUM_METRICS.find((m) => m.key === rankMetric) ?? ALBUM_METRICS[0]
    return rated
      .filter((a) => !q || a.albumName.toLowerCase().includes(q) || a.artist.toLowerCase().includes(q))
      .sort((a, b) => cmpVals(metric.get(a), metric.get(b), rankDir))
  }, [tab, rankMode, rated, rankMetric, rankDir, q])

  const rankedArtists = useMemo<ArtistRank[]>(() => {
    if (tab !== 'ratings' || rankMode !== 'artists') return []
    const metric = ARTIST_METRICS.find((m) => m.key === rankMetric) ?? ARTIST_METRICS[0]
    const statBy = new Map(artistStats.map((s) => [s.artist, s]))
    return (scatter?.points ?? [])
      .filter((p) => p.song_count >= QUALIFIED && (!q || p.artist.toLowerCase().includes(q)))
      .map((p): ArtistRank => {
        const st = statBy.get(p.artist)
        return {
          artist: p.artist,
          songs: p.song_count,
          avgSongScore: p.avg_song_score,
          songPlus: p.song_plus,
          wSongPlus: p.w_song_plus,
          consistencyPlus: p.consistency_plus,
          bangPct: st?.bangPct ?? null,
          skipPct: st?.skipPct ?? null,
        }
      })
      .sort((a, b) => cmpVals(metric.get(a), metric.get(b), rankDir))
  }, [tab, rankMode, scatter, artistStats, rankMetric, rankDir, q])

  // To Listen has no ratings to order by, so lead with the model's guess — the
  // most promising records first. Unscored albums sink rather than sorting as
  // zero: "no prediction yet" isn't the same claim as "predicted terrible".
  // Album or artist, either one: you rarely remember which you're reaching for.
  const gridSorted = useMemo(() => {
    const matched = libQ
      ? grid.filter(
          (a) => a.albumName.toLowerCase().includes(libQ) || a.artist.toLowerCase().includes(libQ),
        )
      : grid
    return libStatus === 'to_listen'
      ? [...matched].sort((a, b) => (b.predictedScore ?? -1) - (a.predictedScore ?? -1))
      : matched
  }, [grid, libStatus, libQ])

  // Below every hook, not above them. `user` starts null and hydrates from
  // storage, so a guard placed earlier skipped the three useMemos below on the
  // first render and ran them on the next — the hook count changes and React
  // throws "rendered more hooks than during the previous render".
  if (!user) return null

  const listData: (Album | ArtistRank)[] = isGrid
    ? gridSorted
    : tab === 'ratings'
    ? rankMode === 'albums'
      ? rankedAlbums
      : rankedArtists
    : []

  return (
    <View style={styles.screen}>
      {/* Compact bar: only the profile name remains once the banner scrolls off. */}
      <Animated.View
        style={[styles.compactHeader, { opacity: compactOpacity, paddingTop: insets.top + spacing.sm }]}
        pointerEvents="none"
      >
        <Text style={styles.compactTitle} numberOfLines={1}>{user.name}</Text>
      </Animated.View>
      <Animated.FlatList
        key={isGrid ? 'grid' : 'list'}
        data={listData as Album[]}
        keyExtractor={(item: Album | ArtistRank) => ('id' in item ? String(item.id) : item.artist)}
        numColumns={isGrid ? 3 : 1}
        columnWrapperStyle={isGrid ? { gap: GAP } : undefined}
        contentContainerStyle={styles.content}
        onScroll={onScroll}
        scrollEventThrottle={16}
        refreshControl={
          // Cream, not the default gray: the spinner sits in the green the
          // banner carries up over the pull, where a gray wheel disappears.
          <RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={colors.bg} />
        }
        ListHeaderComponent={
          <View>
            <ProfileBanner
              name={user.name}
              avatarUrl={user.avatarUrl}
              since={since}
              avg={summary?.avg_album_score ?? null}
              stats={[
                { value: String(rated.length), label: 'ALBUMS' },
                {
                  value: summary?.total_songs_rated != null ? summary.total_songs_rated.toLocaleString() : '—',
                  label: 'SONGS',
                },
                {
                  value: summary?.avg_release_year != null ? String(Math.round(summary.avg_release_year)) : '—',
                  label: 'TASTE CENTER',
                },
                { value: String(friends.length), label: 'FRIENDS' },
              ]}
              genres={topGenres}
              subgenres={topSubgenres}
              topInset={insets.top}
              profile={profile}
              picksHeading="MY PICKS"
              onPickPress={(kind: PickKind) => router.push(`/favorite/${kind}`)}
              action={
                // Sign out moved inside Settings, alongside the sign-in methods
                // it belongs with.
                <Pressable onPress={() => setSettingsOpen(true)} hitSlop={12} accessibilityLabel="Settings">
                  <Settings size={18} color="rgba(255,255,255,0.75)" />
                </Pressable>
              }
            />

            {/* Library / Stats / Ratings — underline tabs, no segmented box. */}
            <View style={styles.tabBar}>
              {TABS.map(({ key, label }) => (
                <Pressable key={key} style={styles.tab} onPress={() => setTab(key)}>
                  <Text style={[styles.tabText, tab === key && styles.tabTextActive]}>{label}</Text>
                  <View style={[styles.tabUnderline, tab === key && styles.tabUnderlineActive]} />
                </Pressable>
              ))}
            </View>

            {/* Status filter + search (Library only) */}
            {tab === 'library' && (
              <>
                <View style={styles.statusRow}>
                  {STATUSES.map(({ key, label }) => (
                    <Pressable
                      key={key}
                      style={[styles.chip, libStatus === key && styles.chipActive]}
                      onPress={() => setLibStatus(key)}
                    >
                      <Text style={[styles.chipText, libStatus === key && styles.chipTextActive]}>
                        {label}
                      </Text>
                    </Pressable>
                  ))}
                </View>
                <View style={styles.searchBar}>
                  <Search size={15} color={colors.inkTertiary} />
                  <TextInput
                    style={styles.searchBarInput}
                    value={libSearch}
                    onChangeText={setLibSearch}
                    placeholder="Search album or artist"
                    placeholderTextColor={colors.inkTertiary}
                    autoCorrect={false}
                    autoCapitalize="none"
                    returnKeyType="search"
                    clearButtonMode="never"
                  />
                  {libSearch.length > 0 && (
                    <Pressable
                      onPress={() => setLibSearch('')}
                      hitSlop={8}
                      accessibilityLabel="Clear search"
                    >
                      <X size={14} color={colors.inkMuted} />
                    </Pressable>
                  )}
                </View>
              </>
            )}

            {/* Rankings filters: Albums/Artists pills + metric dropdown + search */}
            {tab === 'ratings' && (
              <>
                <View style={styles.rankFilters}>
                  <View style={styles.rankPills}>
                    {(['albums', 'artists'] as RankMode[]).map((m) => (
                      <Pressable
                        key={m}
                        style={[styles.rankPill, rankMode === m && styles.rankPillOn]}
                        onPress={() => switchRankMode(m)}
                      >
                        <Text style={[styles.rankPillText, rankMode === m && styles.rankPillTextOn]}>
                          {m === 'albums' ? 'Albums' : 'Artists'}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                  <Pressable ref={metricBtnRef} style={styles.metricBtn} onPress={() => setMetricOpen(true)}>
                    <Text style={styles.metricBtnText}>
                      {currentMetric.label} {rankDir === 'desc' ? '↓' : '↑'}
                    </Text>
                    <ChevronDown size={13} color={colors.inkSecondary} />
                  </Pressable>
                </View>
                <View style={styles.searchBar}>
                  <Search size={15} color={colors.inkTertiary} />
                  <TextInput
                    style={styles.searchBarInput}
                    value={rankSearch}
                    onChangeText={setRankSearch}
                    placeholder="Search your library"
                    placeholderTextColor={colors.inkTertiary}
                    autoCorrect={false}
                  />
                  {rankSearch.length > 0 && (
                    <Pressable onPress={() => setRankSearch('')} hitSlop={8}>
                      <X size={14} color={colors.inkMuted} />
                    </Pressable>
                  )}
                </View>
              </>
            )}

            {/* Stats sub-tab renders in the header so it scrolls as one page */}
            {tab === 'stats' && <StatsView userId={user.id} />}
          </View>
        }
        renderItem={({ item, index }: { item: Album | ArtistRank; index: number }) =>
          isGrid ? (
            <AlbumCell
              album={item as Album}
              mu={badgeMu}
              sd={badgeSd}
              onPress={() => {
                const a = item as Album
                if (a.status === 'listening') {
                  // Mid-listen: pick the rating flow back up where you left it.
                  router.push({ pathname: '/rate/[id]', params: { id: String(a.id) } })
                } else {
                  // Rated or not started — either way the detail page is the
                  // right landing spot; unrated ones open the userbase view
                  // with your prediction and a Rate now button.
                  router.push({
                    pathname: '/album/[id]',
                    params: { id: String(a.id), ...(a.status === 'to_listen' ? { community: '1' } : {}) },
                  })
                }
              }}
            />
          ) : rankMode === 'artists' ? (
            <ArtistRankRow
              stat={item as ArtistRank}
              rank={index + 1}
              metricKey={rankMetric}
              onPress={() =>
                router.push({ pathname: '/artist/[name]', params: { name: encodeURIComponent((item as ArtistRank).artist) } })
              }
            />
          ) : (
            <RatingRow
              album={item as Album}
              rank={index + 1}
              onPress={() => router.push({ pathname: '/album/[id]', params: { id: String((item as Album).id) } })}
            />
          )
        }
        ListEmptyComponent={
          tab === 'stats' ? null : isGrid && gridLoading ? (
            <ActivityIndicator color={colors.green} style={{ marginTop: spacing.xxl }} />
          ) : isGrid ? (
            <Text style={styles.emptyText}>
              {/* A filtered-to-nothing shelf and an empty one look identical
                  otherwise, and the fix for each is the opposite. */}
              {libQ
                ? 'No albums match your search.'
                : libStatus === 'rated'
                ? 'No rated albums yet.'
                : libStatus === 'listening'
                ? 'Nothing in progress.'
                : 'Your to-listen queue is empty.'}
            </Text>
          ) : rankMode === 'artists' ? (
            <Text style={styles.emptyText}>No artists with at least {QUALIFIED} rated songs{q ? ' match your search' : ' yet'}.</Text>
          ) : (
            <Text style={styles.emptyText}>{q ? 'No albums match your search.' : 'No rated albums yet.'}</Text>
          )
        }
      />

      {/* Metric picker: tap a new metric to sort by it (descending), tap the
          selected one again to flip the order. Right-aligned — the chip sits at
          the end of its row, so the menu opens inward. */}
      <AnchoredMenu
        visible={metricOpen}
        anchorRef={metricBtnRef}
        align="right"
        options={rankMetrics.map((m) => {
          const on = m.key === currentMetric.key
          return {
            key: m.key,
            // The arrow rides on the label rather than needing a second slot —
            // it only ever appears on the one selected row.
            label: on ? `${m.label}  ${rankDir === 'desc' ? '↓' : '↑'}` : m.label,
            value: m.key,
            selected: on,
          }
        })}
        onSelect={(v) => {
          if (v === currentMetric.key) setRankDir((d) => (d === 'desc' ? 'asc' : 'desc'))
          else {
            setRankMetric(String(v))
            setRankDir('desc')
          }
        }}
        onClose={() => setMetricOpen(false)}
      />

      <SettingsSheet visible={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </View>
  )
}

function AlbumCell({
  album, mu, sd, onPress,
}: {
  album: Album
  mu: number
  sd: number
  onPress: () => void
}) {
  const showScore = album.status === 'rated' && album.score != null
  const badge = showScore ? scoreBadgeColor(album.score!, mu, sd) : null
  return (
    <Pressable style={styles.cell} onPress={onPress}>
      <View style={styles.artWrap}>
        {album.albumArtUrl ? (
          <Image source={{ uri: album.albumArtUrl }} style={styles.art} contentFit="cover" />
        ) : (
          <View style={[styles.art, styles.artFallback]}>
            <Text style={styles.artInitial}>{album.albumName[0]?.toUpperCase()}</Text>
          </View>
        )}
        {/* Top-left, because the prediction badge holds the top-right on the
            same shelf — a recommended To Listen album shows both at once. */}
        {album.recommendedBy != null && (
          <View style={styles.recBadge}>
            <Star size={11} color={RECOMMEND} fill={RECOMMEND} />
          </View>
        )}
        {/* Rated: desktop-style white pill, colored text + border (top-right) */}
        {showScore ? (
          <View style={[styles.scoreBadge, { borderColor: badge! }]}>
            <Text style={[styles.scoreBadgeText, { color: badge! }]}>{album.score!.toFixed(2)}</Text>
          </View>
        ) : album.status === 'to_listen' && album.predictedScore != null ? (
          <View style={styles.predBadge}>
            <Text style={styles.predText}>~{album.predictedScore.toFixed(2)}</Text>
          </View>
        ) : null}
      </View>
      <Text style={styles.albumName} numberOfLines={1}>{album.albumName}</Text>
    </Pressable>
  )
}

function RatingRow({ album, rank, onPress }: { album: Album; rank: number; onPress: () => void }) {
  return (
    <Pressable style={styles.ratingRow} onPress={onPress}>
      <Text style={styles.rankNum} numberOfLines={1} maxFontSizeMultiplier={NUM_SCALE_CAP}>
        {rank}
      </Text>
      {album.albumArtUrl ? (
        <Image source={{ uri: album.albumArtUrl }} style={styles.ratingArt} contentFit="cover" />
      ) : (
        <View style={[styles.ratingArt, styles.artFallback]}>
          <Text style={styles.artInitial}>{album.albumName[0]?.toUpperCase()}</Text>
        </View>
      )}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={styles.ratingName} numberOfLines={1}>{album.albumName}</Text>
        <Text style={styles.ratingArtist} numberOfLines={1}>
          {album.artist}{album.year ? ` · ${album.year}` : ''}
        </Text>
      </View>
      {album.score != null && (
        <Text style={[styles.ratingScore, { color: songScoreColor(album.score) }]}>
          {album.score.toFixed(2)}
        </Text>
      )}
    </Pressable>
  )
}

function ArtistRankRow({
  stat,
  rank,
  metricKey,
  onPress,
}: {
  stat: ArtistRank
  rank: number
  metricKey: string
  onPress: () => void
}) {
  const pct = (v: number | null) => (v != null ? `${Math.round(v * 100)}%` : '—')
  const plus = (v: number | null) => (v != null ? v.toFixed(0) : '—')
  const value = (() => {
    switch (metricKey) {
      case 'songPlus':
        return { text: plus(stat.songPlus) }
      case 'wSongPlus':
        return { text: plus(stat.wSongPlus) }
      case 'consPlus':
        return { text: plus(stat.consistencyPlus) }
      case 'bang':
        return { text: pct(stat.bangPct) }
      case 'skip':
        return { text: pct(stat.skipPct) }
      default:
        return { text: stat.avgSongScore.toFixed(2), color: songScoreColor(stat.avgSongScore) }
    }
  })()
  return (
    <Pressable style={styles.ratingRow} onPress={onPress}>
      <Text style={styles.rankNum} numberOfLines={1} maxFontSizeMultiplier={NUM_SCALE_CAP}>
        {rank}
      </Text>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={styles.ratingName} numberOfLines={1}>{stat.artist}</Text>
        <Text style={styles.ratingArtist} numberOfLines={1}>
          {stat.songs} songs · avg {stat.avgSongScore.toFixed(2)}
        </Text>
      </View>
      <Text style={[styles.ratingScore, value.color ? { color: value.color } : { color: colors.ink }]}>
        {value.text}
      </Text>
    </Pressable>
  )
}


const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: spacing.lg, paddingBottom: 120, gap: GAP + 4 },

  compactHeader: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 20,
    backgroundColor: colors.green,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
  },
  compactTitle: { fontFamily: fonts.displayBlack, fontSize: 22, color: '#ffffff', letterSpacing: 0.5 },

  tabBar: { flexDirection: 'row', gap: spacing.xl, marginTop: spacing.xl },
  tab: { alignItems: 'center', gap: 6 },
  tabText: { fontFamily: fonts.bodySemiBold, fontSize: 15, color: colors.inkMuted },
  tabTextActive: { color: colors.ink },
  tabUnderline: { height: 2, width: '100%', borderRadius: 1, backgroundColor: 'transparent' },
  tabUnderlineActive: { backgroundColor: colors.green },

  statusRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg },
  chip: { paddingVertical: 6, paddingHorizontal: 14, borderRadius: radii.pill, backgroundColor: 'transparent' },
  chipActive: { backgroundColor: colors.green },
  chipText: { fontFamily: fonts.bodyMedium, fontSize: 13, color: colors.inkTertiary },
  chipTextActive: { color: '#ffffff' },

  cell: { flex: 1 / 3 },
  artWrap: { width: '100%', aspectRatio: 1, borderRadius: radii.md, overflow: 'hidden' },
  art: { width: '100%', height: '100%' },
  artFallback: { backgroundColor: colors.inset, alignItems: 'center', justifyContent: 'center' },
  artInitial: { fontFamily: fonts.display, fontSize: 28, color: colors.inkMuted },
  // Desktop-style score widget: white pill, colored text + colored border.
  scoreBadge: {
    position: 'absolute',
    top: 6,
    right: 6,
    backgroundColor: '#ffffff',
    borderRadius: radii.pill,
    borderWidth: 1.5,
    paddingHorizontal: 9,
    paddingVertical: 2,
    shadowColor: '#321e0a',
    shadowOpacity: 0.18,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  scoreBadgeText: { fontFamily: fonts.bodyBold, fontSize: 12, letterSpacing: -0.2 },
  // White disc so the star reads on dark art, mirroring the desktop card.
  recBadge: {
    position: 'absolute',
    top: 6,
    left: 6,
    backgroundColor: 'rgba(255,255,255,0.92)',
    borderRadius: radii.pill,
    padding: 4,
    shadowColor: '#321e0a',
    shadowOpacity: 0.18,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  predBadge: {
    position: 'absolute',
    top: 6,
    right: 6,
    backgroundColor: 'rgba(28,25,23,0.55)',
    borderRadius: radii.pill,
    paddingHorizontal: 9,
    paddingVertical: 2,
  },
  predText: { fontFamily: fonts.bodyBold, fontSize: 12, color: 'rgba(255,255,255,0.85)', letterSpacing: -0.2 },
  albumName: { fontFamily: fonts.bodyMedium, fontSize: 12, color: colors.inkSecondary, marginTop: 5 },

  // Rankings filters
  rankFilters: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: spacing.lg },
  rankPills: { flexDirection: 'row', gap: spacing.sm },
  rankPill: { paddingVertical: 7, paddingHorizontal: 16, borderRadius: radii.pill, backgroundColor: colors.inset },
  rankPillOn: { backgroundColor: colors.green },
  rankPillText: { fontFamily: fonts.bodySemiBold, fontSize: 14, color: colors.inkSecondary },
  rankPillTextOn: { color: '#ffffff' },
  metricBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 7,
    paddingHorizontal: 14,
    borderRadius: radii.pill,
    backgroundColor: colors.inset,
  },
  metricBtnText: { fontFamily: fonts.bodySemiBold, fontSize: 13, color: colors.inkSecondary },
  // Shared by the Library filter and the Rankings search — same control, two
  // lists.
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.md,
    paddingHorizontal: spacing.md,
    height: 42,
    backgroundColor: colors.raised,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  searchBarInput: { flex: 1, fontFamily: fonts.body, fontSize: 14, color: colors.ink },
  // minWidth, not width: a library past 99 albums needs three digits and
  // jack's is past 400. At 22 the third wrapped — "103" set as "10" over "3".
  rankNum: {
    fontFamily: fonts.display,
    fontSize: RANK_NUM_SIZE,
    color: colors.inkMuted,
    minWidth: RANK_NUM_MIN_W,
    textAlign: 'center',
  },

  backdrop: { flex: 1, backgroundColor: 'rgba(28,25,23,0.4)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.bg,
    borderTopLeftRadius: radii.xl,
    borderTopRightRadius: radii.xl,
    paddingTop: spacing.lg,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xxl,
  },
  sheetTitle: { fontFamily: fonts.bodySemiBold, fontSize: 16, color: colors.ink, marginBottom: spacing.sm },
  optionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  optionText: { fontFamily: fonts.bodyMedium, fontSize: 15, color: colors.ink },
  sheetHint: { fontFamily: fonts.body, fontSize: 12, color: colors.inkMuted, marginTop: spacing.md },

  ratingRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.sm },
  ratingArt: { width: 48, height: 48, borderRadius: radii.sm },
  ratingName: { fontFamily: fonts.bodySemiBold, fontSize: 15, color: colors.ink },
  ratingArtist: { fontFamily: fonts.body, fontSize: 13, color: colors.inkTertiary, marginTop: 1 },
  ratingScore: { fontFamily: fonts.bodyBold, fontSize: 17 },

  emptyText: {
    fontFamily: fonts.body,
    fontSize: 14,
    color: colors.inkTertiary,
    textAlign: 'center',
    marginTop: spacing.xxl,
  },
  placeholder: { alignItems: 'center', marginTop: spacing.xxl, gap: spacing.xs },
  placeholderTitle: { fontFamily: fonts.display, fontSize: 20, color: colors.ink },
  placeholderBody: { fontFamily: fonts.body, fontSize: 13, color: colors.inkTertiary },

})
