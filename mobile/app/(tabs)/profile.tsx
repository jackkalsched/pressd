// Profile — the signed-in user's home: identity + bio, top-line stats, and a
// Library / Stats / Ratings switcher. Library (the score-badged art grid with a
// Rated / Listening / To Listen filter) is built out here; Stats and Ratings are
// placeholders until their phases land.
import { useEffect, useMemo, useState } from 'react'
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useQuery } from '@tanstack/react-query'
import { Image } from 'expo-image'
import { useRouter } from 'expo-router'
import { Check, LogOut, Pencil, X } from 'lucide-react-native'
import { fetchAlbums, fetchSummary, fetchScoreRange } from '../../lib/api'
import { songScoreColor, type Album, type AlbumStatus } from '@pressd/shared/types'
import { useAuth } from '../../lib/auth'
import StatsView from '../../components/StatsView'
import { colors, fonts, radii, spacing } from '../../theme/tokens'

const GAP = 10
const BIO_MAX = 240

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

/** Top-N values by frequency across a list of (possibly null) tags. */
function topTags(tags: (string | null)[], n: number): string[] {
  const counts = new Map<string, number>()
  for (const t of tags) {
    if (t) counts.set(t, (counts.get(t) ?? 0) + 1)
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([t]) => t)
}

export default function Profile() {
  const { user, signOut } = useAuth()
  const router = useRouter()
  const [tab, setTab] = useState<Tab>('library')
  const [libStatus, setLibStatus] = useState<AlbumStatus>('rated')
  const [editing, setEditing] = useState(false)

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

  const thisWeek = useMemo(() => {
    const weekAgo = Date.now() - 7 * 86_400_000
    return rated.filter((a) => a.dateRated && new Date(a.dateRated).getTime() >= weekAgo).length
  }, [rated])

  // Favorite genres / subgenres: most common tags across the rated library.
  const topGenres = useMemo(() => topTags(rated.map((a) => a.genre), 3), [rated])
  const topSubgenres = useMemo(
    () => topTags(rated.flatMap((a) => [a.subGenre1, a.subGenre2, a.subGenre3]), 3),
    [rated],
  )

  if (!user) return null

  const isGrid = tab === 'library'
  const ratingsSorted = tab === 'ratings' ? [...rated].sort((a, b) => (b.score ?? 0) - (a.score ?? 0)) : []
  const listData = isGrid ? grid : tab === 'ratings' ? ratingsSorted : []

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <FlatList
        key={isGrid ? 'grid' : 'list'}
        data={listData}
        keyExtractor={(a) => String(a.id)}
        numColumns={isGrid ? 3 : 1}
        columnWrapperStyle={isGrid ? { gap: GAP } : undefined}
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={colors.green} />
        }
        ListHeaderComponent={
          <View>
            {/* Identity */}
            <View style={styles.identity}>
              <View style={styles.avatar}>
                {user.avatarUrl ? (
                  <Image source={{ uri: user.avatarUrl }} style={styles.avatarImg} contentFit="cover" />
                ) : (
                  <Text style={styles.avatarInitial}>{user.name[0]?.toUpperCase()}</Text>
                )}
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.name}>{user.name}</Text>
                <Text style={styles.count}>{rated.length} albums rated</Text>
              </View>
              <Pressable onPress={signOut} hitSlop={12} accessibilityLabel="Sign out">
                <LogOut size={20} color={colors.inkMuted} />
              </Pressable>
            </View>

            {/* Taste line — favorite genres (green) then subgenres (muted) as one
                typographic line rather than boxed pills. */}
            {(topGenres.length > 0 || topSubgenres.length > 0) && (
              <Text style={styles.taste}>
                {[
                  ...topGenres.map((g) => ({ g, primary: true })),
                  ...topSubgenres.map((g) => ({ g, primary: false })),
                ].map((p, i, arr) => (
                  <Text key={(p.primary ? 'g-' : 's-') + p.g} style={p.primary ? styles.tastePrimary : styles.tasteDim}>
                    {p.g}{i < arr.length - 1 ? '   ·   ' : ''}
                  </Text>
                ))}
              </Text>
            )}

            {/* Bio + edit */}
            <Pressable style={styles.bioRow} onPress={() => setEditing(true)}>
              <Text style={user.bio ? styles.bio : styles.bioEmpty} numberOfLines={4}>
                {user.bio || 'Add a bio'}
              </Text>
              <Pencil size={13} color={colors.inkMuted} />
            </Pressable>

            {/* Stats — open strip, no cards; hairline dividers keep it aligned. */}
            <View style={styles.stats}>
              <StatTile
                value={summary?.avg_album_score != null ? summary.avg_album_score.toFixed(2) : '—'}
                label="Avg score"
              />
              <View style={styles.statDivider} />
              <StatTile value={String(summary?.longest_streak ?? 0)} label="Day streak" />
              <View style={styles.statDivider} />
              <StatTile value={String(thisWeek)} label="This week" />
            </View>

            {/* Library / Stats / Ratings — underline tabs, no segmented box. */}
            <View style={styles.tabBar}>
              {TABS.map(({ key, label }) => (
                <Pressable key={key} style={styles.tab} onPress={() => setTab(key)}>
                  <Text style={[styles.tabText, tab === key && styles.tabTextActive]}>{label}</Text>
                  <View style={[styles.tabUnderline, tab === key && styles.tabUnderlineActive]} />
                </Pressable>
              ))}
            </View>

            {/* Status filter (Library only) */}
            {tab === 'library' && (
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
            )}

            {/* Stats sub-tab renders in the header so it scrolls as one page */}
            {tab === 'stats' && <StatsView userId={user.id} summary={summary} />}
          </View>
        }
        renderItem={({ item }) =>
          isGrid ? (
            <AlbumCell
              album={item}
              mu={badgeMu}
              sd={badgeSd}
              onPress={() =>
                item.status === 'rated'
                  ? router.push({ pathname: '/album/[id]', params: { id: String(item.id) } })
                  : router.push({ pathname: '/rate/[id]', params: { id: String(item.id) } })
              }
            />
          ) : (
            <RatingRow
              album={item}
              onPress={() => router.push({ pathname: '/album/[id]', params: { id: String(item.id) } })}
            />
          )
        }
        ListEmptyComponent={
          tab === 'stats' ? null : isGrid && gridLoading ? (
            <ActivityIndicator color={colors.green} style={{ marginTop: spacing.xxl }} />
          ) : isGrid ? (
            <Text style={styles.emptyText}>
              {libStatus === 'rated'
                ? 'No rated albums yet.'
                : libStatus === 'listening'
                ? 'Nothing in progress.'
                : 'Your to-listen queue is empty.'}
            </Text>
          ) : (
            <Text style={styles.emptyText}>No rated albums yet.</Text>
          )
        }
      />

      <EditBioModal
        visible={editing}
        initial={user.bio ?? ''}
        onClose={() => setEditing(false)}
      />
    </SafeAreaView>
  )
}

function StatTile({ value, label }: { value: string; label: string }) {
  return (
    <View style={styles.statCol}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  )
}

function AlbumCell({ album, mu, sd, onPress }: { album: Album; mu: number; sd: number; onPress: () => void }) {
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

function RatingRow({ album, onPress }: { album: Album; onPress: () => void }) {
  return (
    <Pressable style={styles.ratingRow} onPress={onPress}>
      {album.albumArtUrl ? (
        <Image source={{ uri: album.albumArtUrl }} style={styles.ratingArt} contentFit="cover" />
      ) : (
        <View style={[styles.ratingArt, styles.artFallback]}>
          <Text style={styles.artInitial}>{album.albumName[0]?.toUpperCase()}</Text>
        </View>
      )}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={styles.ratingName} numberOfLines={1}>{album.albumName}</Text>
        <Text style={styles.ratingArtist} numberOfLines={1}>{album.artist}</Text>
      </View>
      {album.score != null && (
        <Text style={[styles.ratingScore, { color: songScoreColor(album.score) }]}>
          {album.score.toFixed(2)}
        </Text>
      )}
    </Pressable>
  )
}

function EditBioModal({
  visible,
  initial,
  onClose,
}: {
  visible: boolean
  initial: string
  onClose: () => void
}) {
  const [text, setText] = useState(initial)
  const [saving, setSaving] = useState(false)
  const { updateProfile } = useAuth()

  // Reset the field whenever the modal reopens on a fresh bio.
  useEffect(() => {
    if (visible) setText(initial)
  }, [visible, initial])

  async function save() {
    setSaving(true)
    try {
      await updateProfile({ bio: text.trim() })
      onClose()
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.modalBackdrop}>
        <View style={styles.modalCard}>
          <View style={styles.modalHead}>
            <Pressable onPress={onClose} hitSlop={10}>
              <X size={22} color={colors.inkTertiary} />
            </Pressable>
            <Text style={styles.modalTitle}>Edit bio</Text>
            <Pressable onPress={save} hitSlop={10} disabled={saving}>
              {saving ? (
                <ActivityIndicator color={colors.green} />
              ) : (
                <Check size={22} color={colors.green} />
              )}
            </Pressable>
          </View>
          <TextInput
            style={styles.bioInput}
            value={text}
            onChangeText={(t) => setText(t.slice(0, BIO_MAX))}
            placeholder="Say something about your taste…"
            placeholderTextColor={colors.inkMuted}
            multiline
            autoFocus
          />
          <Text style={styles.counter}>{text.length}/{BIO_MAX}</Text>
        </View>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: spacing.lg, paddingBottom: 120, gap: GAP + 4 },

  identity: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginTop: spacing.lg },
  avatar: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.green,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  avatarImg: { width: '100%', height: '100%' },
  avatarInitial: { fontFamily: fonts.bodyBold, fontSize: 26, color: '#ffffff' },
  name: { fontFamily: fonts.display, fontSize: 28, color: colors.ink, letterSpacing: 1 },
  count: { fontFamily: fonts.bodyMedium, fontSize: 13, color: colors.inkTertiary, marginTop: 2 },

  taste: { marginTop: spacing.md, lineHeight: 20 },
  tastePrimary: { fontFamily: fonts.bodySemiBold, fontSize: 13, color: colors.green },
  tasteDim: { fontFamily: fonts.bodyMedium, fontSize: 13, color: colors.inkMuted },

  bioRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, marginTop: spacing.md },
  bio: { flex: 1, fontFamily: fonts.body, fontSize: 13, color: colors.inkSecondary, lineHeight: 19 },
  bioEmpty: { flex: 1, fontFamily: fonts.body, fontSize: 13, color: colors.inkMuted, fontStyle: 'italic' },

  stats: { flexDirection: 'row', alignItems: 'center', marginTop: spacing.xl },
  statCol: { flex: 1, alignItems: 'center' },
  statDivider: { width: StyleSheet.hairlineWidth, height: 30, backgroundColor: colors.border },
  statValue: { fontFamily: fonts.display, fontSize: 27, color: colors.ink, letterSpacing: 0.5 },
  statLabel: {
    fontFamily: fonts.bodyMedium,
    fontSize: 10,
    color: colors.inkMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginTop: 4,
  },

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

  modalBackdrop: { flex: 1, backgroundColor: 'rgba(28,25,23,0.4)', justifyContent: 'flex-end' },
  modalCard: {
    backgroundColor: colors.bg,
    borderTopLeftRadius: radii.xl,
    borderTopRightRadius: radii.xl,
    padding: spacing.lg,
    paddingBottom: spacing.xxl,
  },
  modalHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  modalTitle: { fontFamily: fonts.bodySemiBold, fontSize: 16, color: colors.ink },
  bioInput: {
    marginTop: spacing.lg,
    minHeight: 96,
    backgroundColor: colors.raised,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    fontFamily: fonts.body,
    fontSize: 14,
    color: colors.ink,
    textAlignVertical: 'top',
  },
  counter: {
    fontFamily: fonts.body,
    fontSize: 11,
    color: colors.inkMuted,
    textAlign: 'right',
    marginTop: spacing.xs,
  },
})
