// Friend profile — a read-only mirror of your own Profile tab: the same green
// banner (identity, average ring, headline stats, taste chips), the same
// compact scroll header, and the same Library / Stats / Ratings switcher. The
// banner's action slot carries the add/remove-friend control instead of sign out.
import { useMemo, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Animated,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Image } from 'expo-image'
import { ArrowLeft, Check, ChevronDown, Plus } from 'lucide-react-native'
import {
  fetchUsers,
  fetchFriends,
  fetchSummary,
  fetchAlbums,
  fetchScoreRange,
  addFriend,
  removeFriend,
  fetchArtistStats,
  fetchScatterData,
} from '../../lib/api'
import { songScoreColor, type Album } from '@pressd/shared/types'
import { useAuth } from '../../lib/auth'
import StatsView from '../../components/StatsView'
import AnchoredMenu from '../../components/AnchoredMenu'
import { ArtistRankRow, RatingRow } from '../../components/RatingsRows'
import {
  ALBUM_METRICS, ARTIST_METRICS, QUALIFIED, cmpVals, defaultMetricFor,
  type ArtistRank, type RankDir, type RankMode,
} from '../../lib/rankings'
import ProfileBanner from '../../components/ProfileBanner'
import { colors, fonts, radii, spacing } from '../../theme/tokens'

const GAP = 10

type Tab = 'library' | 'stats' | 'ratings'
const TABS: { key: Tab; label: string }[] = [
  { key: 'library', label: 'Library' },
  { key: 'stats', label: 'Stats' },
  { key: 'ratings', label: 'Ratings' },
]

// Score-badge color relative to this user's own mean/sd, matching Profile.
function scoreBadgeColor(score: number, mu: number, sd: number): string {
  const SD_RANGE = 2.5
  if (score >= mu) {
    const t = Math.min(1, (score - mu) / (SD_RANGE * sd))
    return `hsl(${Math.round(30 + t * 108)}, 70%, 30%)`
  }
  const t = Math.min(1, (mu - score) / (SD_RANGE * sd))
  return `hsl(${Math.round(30 - t * 30)}, 72%, 30%)`
}

function topTags(tags: (string | null)[], n: number): string[] {
  const counts = new Map<string, number>()
  for (const t of tags) if (t) counts.set(t, (counts.get(t) ?? 0) + 1)
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([t]) => t)
}

export default function FriendProfile() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const fid = Number(id)
  const router = useRouter()
  const queryClient = useQueryClient()
  const insets = useSafeAreaInsets()
  const { user } = useAuth()
  const [tab, setTab] = useState<Tab>('library')
  // Same board your own Ratings tab offers: album or artist, any metric,
  // either direction. It used to be a fixed score-descending album list.
  const [rankMode, setRankMode] = useState<RankMode>('albums')
  const [rankMetric, setRankMetric] = useState(defaultMetricFor('albums'))
  const [rankDir, setRankDir] = useState<RankDir>('desc')
  const [metricOpen, setMetricOpen] = useState(false)
  const metricBtnRef = useRef<View>(null)

  function switchRankMode(m: RankMode) {
    setRankMode(m)
    setRankMetric(defaultMetricFor(m))
    setRankDir('desc')
  }

  const { data: allUsers = [] } = useQuery({ queryKey: ['users'], queryFn: fetchUsers })
  const { data: artistStats = [] } = useQuery({
    queryKey: ['artist-stats', fid],
    queryFn: () => fetchArtistStats(fid),
    enabled: tab === 'ratings',
  })
  const { data: scatter } = useQuery({
    queryKey: ['stats', 'scatter', fid],
    queryFn: () => fetchScatterData(fid),
    enabled: tab === 'ratings',
    staleTime: 5 * 60_000,
  })
  const { data: myFriends = [] } = useQuery({
    queryKey: ['friends', user?.id],
    queryFn: () => fetchFriends(user!.id),
    enabled: !!user,
  })
  const { data: theirFriends = [] } = useQuery({
    queryKey: ['friends', fid],
    queryFn: () => fetchFriends(fid),
    enabled: Number.isFinite(fid),
  })
  const { data: summary } = useQuery({
    queryKey: ['stats', 'summary', fid],
    queryFn: () => fetchSummary(fid),
    enabled: Number.isFinite(fid),
  })
  const { data: rated = [] } = useQuery({
    queryKey: ['albums', 'rated', fid],
    queryFn: () => fetchAlbums({ status: 'rated', userId: fid }),
    enabled: Number.isFinite(fid),
  })
  const { data: scoreRange } = useQuery({
    queryKey: ['score-range', fid],
    queryFn: () => fetchScoreRange(fid),
    enabled: Number.isFinite(fid),
    staleTime: 5 * 60_000,
  })
  const badgeMu = scoreRange?.mu ?? 7.0
  const badgeSd = scoreRange?.sd ?? 1.0

  const friendFromList = myFriends.find((f) => f.id === fid)
  const person = friendFromList ?? allUsers.find((u) => u.id === fid)
  const isFriend = !!friendFromList

  const topGenres = useMemo(() => topTags(rated.map((a) => a.genre), 3), [rated])
  const topSubgenres = useMemo(
    () => topTags(rated.flatMap((a) => [a.subGenre1, a.subGenre2, a.subGenre3]), 3),
    [rated],
  )
  const since = useMemo(() => {
    const dates = rated.map((a) => a.dateAdded ?? a.dateRated).filter(Boolean) as string[]
    if (dates.length === 0) return null
    const min = dates.reduce((a, b) => (a < b ? a : b))
    const d = new Date(min.length <= 10 ? `${min}T00:00:00` : min)
    return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
  }, [rated])

  // Same scroll treatment as Profile: the banner scrolls away and a compact
  // green bar keeping just the name fades in.
  const scrollY = useRef(new Animated.Value(0)).current
  const compactOpacity = scrollY.interpolate({ inputRange: [70, 130], outputRange: [0, 1], extrapolate: 'clamp' })
  const onScroll = Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], { useNativeDriver: true })

  async function toggleFriend() {
    if (!user) return
    if (isFriend) await removeFriend(user.id, fid)
    else await addFriend(user.id, fid)
    queryClient.invalidateQueries({ queryKey: ['friends'] })
    queryClient.invalidateQueries({ queryKey: ['feed'] })
    queryClient.invalidateQueries({ queryKey: ['user-search'] })
  }

  function openArtist(name: string) {
    router.push({ pathname: '/artist/[name]', params: { name, userId: String(fid) } })
  }
  function openAlbum(a: Album) {
    router.push({ pathname: '/album/[id]', params: { id: String(a.id) } })
  }

  const isGrid = tab === 'library'

  const rankedAlbums = useMemo(() => {
    if (tab !== 'ratings' || rankMode !== 'albums') return []
    const metric = ALBUM_METRICS.find((m) => m.key === rankMetric) ?? ALBUM_METRICS[0]
    return [...rated].sort((a, b) => cmpVals(metric.get(a), metric.get(b), rankDir))
  }, [tab, rankMode, rated, rankMetric, rankDir])

  const rankedArtists = useMemo<ArtistRank[]>(() => {
    if (tab !== 'ratings' || rankMode !== 'artists') return []
    const metric = ARTIST_METRICS.find((m) => m.key === rankMetric) ?? ARTIST_METRICS[0]
    const statBy = new Map(artistStats.map((s2) => [s2.artist, s2]))
    return (scatter?.points ?? [])
      .filter((pt) => pt.song_count >= QUALIFIED)
      .map((pt): ArtistRank => {
        const st = statBy.get(pt.artist)
        return {
          artist: pt.artist,
          songs: pt.song_count,
          avgSongScore: pt.avg_song_score,
          songPlus: pt.song_plus,
          wSongPlus: pt.w_song_plus,
          consistencyPlus: pt.consistency_plus,
          bangPct: st?.bangPct ?? null,
          skipPct: st?.skipPct ?? null,
        }
      })
      .sort((a, b) => cmpVals(metric.get(a), metric.get(b), rankDir))
  }, [tab, rankMode, scatter, artistStats, rankMetric, rankDir])

  const currentMetric =
    (rankMode === 'albums' ? ALBUM_METRICS : ARTIST_METRICS).find((m) => m.key === rankMetric)
    ?? (rankMode === 'albums' ? ALBUM_METRICS[0] : ARTIST_METRICS[0])

  const listData: (Album | ArtistRank)[] = isGrid
    ? rated
    : rankMode === 'albums'
    ? rankedAlbums
    : rankedArtists

  if (!person) {
    return (
      <View style={[styles.screen, styles.center]}>
        <ActivityIndicator color={colors.green} />
      </View>
    )
  }


  return (
    <View style={styles.screen}>
      {/* Compact bar: only the name remains once the banner scrolls off. */}
      <Animated.View
        style={[styles.compactHeader, { opacity: compactOpacity, paddingTop: insets.top + spacing.sm }]}
        pointerEvents="none"
      >
        <Text style={styles.compactTitle} numberOfLines={1}>{person.name}</Text>
      </Animated.View>

      {/* Back sits above the banner, tinted for the green field. */}
      <View style={[styles.backWrap, { top: insets.top + 6 }]}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={styles.backBtn}>
          <ArrowLeft size={18} color="#ffffff" />
          <Text style={styles.backText}>Back</Text>
        </Pressable>
      </View>

      <Animated.FlatList
        key={isGrid ? 'grid' : 'list'}
        data={listData as (Album | ArtistRank)[]}
        // Artist rows have no id — the artist name is the identity there.
        keyExtractor={(it: Album | ArtistRank) =>
          'id' in it ? String(it.id) : `artist:${it.artist}`
        }
        numColumns={isGrid ? 3 : 1}
        columnWrapperStyle={isGrid ? { gap: GAP } : undefined}
        contentContainerStyle={styles.content}
        onScroll={onScroll}
        scrollEventThrottle={16}
        ListHeaderComponent={
          <View>
            <ProfileBanner
              name={person.name}
              avatarUrl={person.avatarUrl}
              since={since}
              avg={summary?.avg_album_score ?? null}
              stats={[
                { value: String(summary?.total_albums_rated ?? rated.length), label: 'ALBUMS' },
                {
                  value: summary?.total_songs_rated != null ? summary.total_songs_rated.toLocaleString() : '—',
                  label: 'SONGS',
                },
                {
                  value: summary?.avg_release_year != null ? String(Math.round(summary.avg_release_year)) : '—',
                  label: 'TASTE CENTER',
                },
                { value: String(theirFriends.length), label: 'FRIENDS' },
              ]}
              genres={topGenres}
              subgenres={topSubgenres}
              topInset={insets.top + 22}
              action={
                <Pressable
                  style={[styles.friendBtn, isFriend && styles.friendBtnOn]}
                  onPress={toggleFriend}
                  hitSlop={10}
                  accessibilityLabel={isFriend ? 'Remove friend' : 'Add friend'}
                >
                  {isFriend ? (
                    <Check size={18} color="#ffffff" strokeWidth={2.6} />
                  ) : (
                    <Plus size={18} color={colors.green} strokeWidth={2.6} />
                  )}
                </Pressable>
              }
            />

            {person.bio ? <Text style={styles.bio}>{person.bio}</Text> : null}

            <View style={styles.tabBar}>
              {TABS.map(({ key, label }) => (
                <Pressable key={key} style={styles.tab} onPress={() => setTab(key)}>
                  <Text style={[styles.tabText, tab === key && styles.tabTextActive]}>{label}</Text>
                  <View style={[styles.tabUnderline, tab === key && styles.tabUnderlineActive]} />
                </Pressable>
              ))}
            </View>

            {tab === 'stats' && <StatsView userId={fid} />}

            {/* Albums/Artists pills + the metric menu — the same controls your
                own Ratings tab has, so a friend's board sorts the same way. */}
            {tab === 'ratings' && (
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
            )}
          </View>
        }
        renderItem={({ item, index }: { item: Album | ArtistRank; index: number }) => {
          if (isGrid) {
            return <AlbumCell album={item as Album} mu={badgeMu} sd={badgeSd} onPress={() => openAlbum(item as Album)} />
          }
          if ('artist' in item && !('id' in item)) {
            return (
              <ArtistRankRow
                stat={item}
                rank={index + 1}
                metricKey={rankMetric}
                onPress={() => openArtist(item.artist)}
              />
            )
          }
          const album = item as Album
          return <RatingRow album={album} rank={index + 1} onPress={() => openAlbum(album)} />
        }}
        ListEmptyComponent={
          tab === 'stats' ? null : <Text style={styles.empty}>No rated albums yet.</Text>
        }
      />

      <AnchoredMenu
        visible={metricOpen}
        anchorRef={metricBtnRef}
        align="right"
        options={(rankMode === 'albums' ? ALBUM_METRICS : ARTIST_METRICS).map((m) => {
          const on = m.key === currentMetric.key
          return {
            key: m.key,
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
    </View>
  )
}

function AlbumCell({ album, mu, sd, onPress }: { album: Album; mu: number; sd: number; onPress: () => void }) {
  const badge = album.score != null ? scoreBadgeColor(album.score, mu, sd) : null
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
        {badge && (
          <View style={[styles.scoreBadge, { borderColor: badge }]}>
            <Text style={[styles.scoreBadgeText, { color: badge }]}>{album.score!.toFixed(2)}</Text>
          </View>
        )}
      </View>
      <Text style={styles.cellName} numberOfLines={1}>{album.albumName}</Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  // Mirrors Profile's Rankings filter bar, so the two boards read as one
  // control in two places.
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

  screen: { flex: 1, backgroundColor: colors.bg },
  center: { alignItems: 'center', justifyContent: 'center' },
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

  backWrap: { position: 'absolute', left: spacing.lg, zIndex: 30 },
  backBtn: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  backText: { fontFamily: fonts.bodyMedium, fontSize: 15, color: '#ffffff' },

  // Icon-only status control: a check when you're already friends, a plus to
  // add. Circular so it reads as a single toggle rather than a labelled button.
  friendBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#ffffff',
  },
  friendBtnOn: { backgroundColor: 'rgba(255,255,255,0.2)' },

  bio: { fontFamily: fonts.body, fontSize: 13, color: colors.inkSecondary, lineHeight: 19, marginTop: spacing.md },

  tabBar: { flexDirection: 'row', gap: spacing.xl, marginTop: spacing.xl },
  tab: { alignItems: 'center', gap: 6 },
  tabText: { fontFamily: fonts.bodySemiBold, fontSize: 15, color: colors.inkMuted },
  tabTextActive: { color: colors.ink },
  tabUnderline: { height: 2, width: '100%', borderRadius: 1, backgroundColor: 'transparent' },
  tabUnderlineActive: { backgroundColor: colors.green },

  cell: { flex: 1 / 3 },
  artWrap: { width: '100%', aspectRatio: 1, borderRadius: radii.md, overflow: 'hidden' },
  art: { width: '100%', height: '100%' },
  artFallback: { backgroundColor: colors.inset, alignItems: 'center', justifyContent: 'center' },
  artInitial: { fontFamily: fonts.display, fontSize: 24, color: colors.inkMuted },
  scoreBadge: {
    position: 'absolute',
    top: 6,
    right: 6,
    backgroundColor: '#ffffff',
    borderRadius: radii.pill,
    borderWidth: 1.5,
    paddingHorizontal: 9,
    paddingVertical: 2,
  },
  scoreBadgeText: { fontFamily: fonts.bodyBold, fontSize: 12, letterSpacing: -0.2 },
  cellName: { fontFamily: fonts.bodyMedium, fontSize: 12, color: colors.inkSecondary, marginTop: 5 },

  ratingRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.sm },
  rankNum: { fontFamily: fonts.display, fontSize: 15, color: colors.inkMuted, width: 22, textAlign: 'center' },
  ratingArt: { width: 48, height: 48, borderRadius: radii.sm },
  ratingName: { fontFamily: fonts.bodySemiBold, fontSize: 15, color: colors.ink },
  ratingArtist: { fontFamily: fonts.body, fontSize: 13, color: colors.inkTertiary, marginTop: 1 },
  ratingScore: { fontFamily: fonts.bodyBold, fontSize: 17 },

  empty: { fontFamily: fonts.body, fontSize: 14, color: colors.inkTertiary, textAlign: 'center', marginTop: spacing.xxl },
})
