// Friend profile — read-only view of another user: identity, follower/following
// counts (friendships are mutual, so both equal their friend count), inline
// stats, bio, favorite genres, and Library / Ratings tabs. Add / Friends action
// mirrors the website FriendProfile.
import { useMemo, useState } from 'react'
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Image } from 'expo-image'
import { ArrowLeft, Check, UserPlus } from 'lucide-react-native'
import {
  fetchUsers,
  fetchFriends,
  fetchSummary,
  fetchAlbums,
  addFriend,
  removeFriend,
} from '../../lib/api'
import { songScoreColor, type Album } from '@pressd/shared/types'
import { useAuth } from '../../lib/auth'
import { colors, fonts, radii, spacing } from '../../theme/tokens'

type Tab = 'library' | 'ratings'

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
  const { user } = useAuth()
  const [tab, setTab] = useState<Tab>('library')

  const { data: allUsers = [] } = useQuery({ queryKey: ['users'], queryFn: fetchUsers })
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

  const friendFromList = myFriends.find((f) => f.id === fid)
  const person = friendFromList ?? allUsers.find((u) => u.id === fid)
  const isFriend = !!friendFromList

  const thisWeek = useMemo(() => {
    const weekAgo = Date.now() - 7 * 86_400_000
    return rated.filter((a) => a.dateRated && new Date(a.dateRated).getTime() >= weekAgo).length
  }, [rated])
  const topGenres = useMemo(() => topTags(rated.map((a) => a.genre), 3), [rated])
  const topSubgenres = useMemo(
    () => topTags(rated.flatMap((a) => [a.subGenre1, a.subGenre2, a.subGenre3]), 3),
    [rated],
  )

  async function toggleFriend() {
    if (!user) return
    if (isFriend) await removeFriend(user.id, fid)
    else await addFriend(user.id, fid)
    queryClient.invalidateQueries({ queryKey: ['friends'] })
    queryClient.invalidateQueries({ queryKey: ['feed'] })
    queryClient.invalidateQueries({ queryKey: ['user-search'] })
  }

  function openAlbum(a: Album) {
    router.push({ pathname: '/album/[id]', params: { id: String(a.id) } })
  }

  if (!person) {
    return (
      <SafeAreaView style={[styles.screen, styles.center]}>
        <ActivityIndicator color={colors.green} />
      </SafeAreaView>
    )
  }

  const ratingsSorted = [...rated].sort((a, b) => (b.score ?? 0) - (a.score ?? 0))

  const header = (
    <View>
      <View style={styles.identity}>
        {person.avatarUrl ? (
          <Image source={{ uri: person.avatarUrl }} style={styles.avatar} contentFit="cover" />
        ) : (
          <View style={[styles.avatar, styles.avatarFallback]}>
            <Text style={styles.avatarInitial}>{person.name[0]?.toUpperCase()}</Text>
          </View>
        )}
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.name} numberOfLines={1}>{person.name}</Text>
          <View style={styles.statLine}>
            <InlineStat value={String(theirFriends.length)} label="followers" />
            <InlineStat value={String(theirFriends.length)} label="following" />
            <InlineStat value={String(summary?.total_albums_rated ?? rated.length)} label="rated" />
          </View>
        </View>
      </View>

      <Pressable
        style={[styles.friendBtn, isFriend && styles.friendBtnActive]}
        onPress={toggleFriend}
      >
        {isFriend ? <Check size={16} color={colors.green} /> : <UserPlus size={16} color="#fff" />}
        <Text style={[styles.friendBtnText, isFriend && { color: colors.green }]}>
          {isFriend ? 'Friends' : 'Add friend'}
        </Text>
      </Pressable>

      <View style={styles.statTiles}>
        <StatTile value={summary?.avg_album_score != null ? summary.avg_album_score.toFixed(1) : '—'} label="Avg score" />
        <StatTile value={String(summary?.longest_streak ?? 0)} label="Day streak" />
        <StatTile value={String(thisWeek)} label="This week" />
      </View>

      {person.bio ? <Text style={styles.bio}>{person.bio}</Text> : null}

      {(topGenres.length > 0 || topSubgenres.length > 0) && (
        <View style={styles.genreRow}>
          {topGenres.map((g) => (
            <View key={`g-${g}`} style={[styles.genrePill, styles.genrePrimary]}>
              <Text style={styles.genrePrimaryText}>{g}</Text>
            </View>
          ))}
          {topSubgenres.map((g) => (
            <View key={`s-${g}`} style={[styles.genrePill, styles.genreMuted]}>
              <Text style={styles.genreMutedText}>{g}</Text>
            </View>
          ))}
        </View>
      )}

      <View style={styles.tabBar}>
        {(['library', 'ratings'] as Tab[]).map((t) => (
          <Pressable key={t} style={[styles.tab, tab === t && styles.tabActive]} onPress={() => setTab(t)}>
            <Text style={[styles.tabText, tab === t && styles.tabTextActive]}>
              {t === 'library' ? 'Library' : 'Ratings'}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  )

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.topBar}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={styles.backBtn}>
          <ArrowLeft size={18} color={colors.inkSecondary} />
          <Text style={styles.backText}>Back</Text>
        </Pressable>
      </View>

      {tab === 'library' ? (
        <FlatList
          key="grid"
          data={rated}
          keyExtractor={(a) => String(a.id)}
          numColumns={3}
          columnWrapperStyle={{ gap: 10 }}
          contentContainerStyle={styles.content}
          ListHeaderComponent={header}
          renderItem={({ item }) => (
            <Pressable style={styles.cell} onPress={() => openAlbum(item)}>
              <View style={styles.artWrap}>
                {item.albumArtUrl ? (
                  <Image source={{ uri: item.albumArtUrl }} style={styles.art} contentFit="cover" />
                ) : (
                  <View style={[styles.art, styles.artFallback]}>
                    <Text style={styles.artInitial}>{item.albumName[0]}</Text>
                  </View>
                )}
                {item.score != null && (
                  <View style={styles.scoreChip}><Text style={styles.scoreChipText}>{item.score.toFixed(1)}</Text></View>
                )}
              </View>
              <Text style={styles.cellName} numberOfLines={1}>{item.albumName}</Text>
            </Pressable>
          )}
          ListEmptyComponent={<Text style={styles.empty}>No rated albums yet.</Text>}
        />
      ) : (
        <FlatList
          key="list"
          data={ratingsSorted}
          keyExtractor={(a) => String(a.id)}
          contentContainerStyle={styles.content}
          ListHeaderComponent={header}
          renderItem={({ item, index }) => (
            <Pressable style={styles.ratingRow} onPress={() => openAlbum(item)}>
              <Text style={styles.ratingRank}>{index + 1}</Text>
              {item.albumArtUrl ? (
                <Image source={{ uri: item.albumArtUrl }} style={styles.ratingArt} contentFit="cover" />
              ) : (
                <View style={[styles.ratingArt, styles.artFallback]}>
                  <Text style={styles.artInitial}>{item.albumName[0]}</Text>
                </View>
              )}
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.ratingName} numberOfLines={1}>{item.albumName}</Text>
                <Text style={styles.ratingArtist} numberOfLines={1}>{item.artist}</Text>
              </View>
              {item.score != null && (
                <Text style={[styles.ratingScore, { color: songScoreColor(item.score) }]}>{item.score.toFixed(1)}</Text>
              )}
            </Pressable>
          )}
          ListEmptyComponent={<Text style={styles.empty}>No rated albums yet.</Text>}
        />
      )}
    </SafeAreaView>
  )
}

function InlineStat({ value, label }: { value: string; label: string }) {
  return (
    <Text style={styles.inlineStat}>
      <Text style={styles.inlineStatValue}>{value}</Text> {label}
    </Text>
  )
}
function StatTile({ value, label }: { value: string; label: string }) {
  return (
    <View style={styles.tile}>
      <Text style={styles.tileValue}>{value}</Text>
      <Text style={styles.tileLabel}>{label}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  center: { alignItems: 'center', justifyContent: 'center' },
  topBar: { paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  backBtn: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  backText: { fontFamily: fonts.bodyMedium, fontSize: 15, color: colors.inkSecondary },
  content: { paddingHorizontal: spacing.lg, paddingBottom: 120, gap: 14 },

  identity: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginTop: spacing.sm },
  avatar: { width: 72, height: 72, borderRadius: 36 },
  avatarFallback: { backgroundColor: colors.green, alignItems: 'center', justifyContent: 'center' },
  avatarInitial: { fontFamily: fonts.bodyBold, fontSize: 28, color: '#fff' },
  name: { fontFamily: fonts.display, fontSize: 28, color: colors.ink },
  statLine: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md, marginTop: 6 },
  inlineStat: { fontFamily: fonts.body, fontSize: 13, color: colors.inkTertiary },
  inlineStatValue: { fontFamily: fonts.bodyBold, color: colors.ink },

  friendBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.green,
    borderRadius: radii.md,
    paddingVertical: 11,
    marginTop: spacing.lg,
  },
  friendBtnActive: { backgroundColor: colors.greenSoft },
  friendBtnText: { fontFamily: fonts.bodySemiBold, fontSize: 14, color: '#fff' },

  statTiles: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg },
  tile: {
    flex: 1,
    backgroundColor: colors.raised,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.sm,
  },
  tileValue: { fontFamily: fonts.bodyBold, fontSize: 20, color: colors.ink },
  tileLabel: { fontFamily: fonts.bodyMedium, fontSize: 10, color: colors.inkTertiary, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 2 },

  bio: { fontFamily: fonts.body, fontSize: 13, color: colors.inkSecondary, lineHeight: 19, marginTop: spacing.lg },
  genreRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.md },
  genrePill: { paddingVertical: 4, paddingHorizontal: 10, borderRadius: radii.pill },
  genrePrimary: { backgroundColor: colors.greenSoft },
  genrePrimaryText: { fontFamily: fonts.bodySemiBold, fontSize: 12, color: colors.green },
  genreMuted: { backgroundColor: colors.inset },
  genreMutedText: { fontFamily: fonts.bodyMedium, fontSize: 12, color: colors.inkTertiary },

  tabBar: { flexDirection: 'row', backgroundColor: colors.inset, borderRadius: radii.md, padding: 4, marginTop: spacing.lg },
  tab: { flex: 1, paddingVertical: 8, alignItems: 'center', borderRadius: radii.sm },
  tabActive: { backgroundColor: colors.raised },
  tabText: { fontFamily: fonts.bodySemiBold, fontSize: 14, color: colors.inkTertiary },
  tabTextActive: { color: colors.ink },

  cell: { flex: 1 / 3 },
  artWrap: { width: '100%', aspectRatio: 1, borderRadius: radii.md, overflow: 'hidden' },
  art: { width: '100%', height: '100%' },
  artFallback: { backgroundColor: colors.inset, alignItems: 'center', justifyContent: 'center' },
  artInitial: { fontFamily: fonts.display, fontSize: 24, color: colors.inkMuted },
  scoreChip: { position: 'absolute', right: 6, bottom: 6, backgroundColor: colors.scoreChipBg, borderRadius: radii.sm, paddingHorizontal: 6, paddingVertical: 2 },
  scoreChipText: { fontFamily: fonts.bodyBold, fontSize: 11, color: '#fff' },
  cellName: { fontFamily: fonts.bodyMedium, fontSize: 12, color: colors.inkSecondary, marginTop: 5 },

  ratingRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.sm },
  ratingRank: { fontFamily: fonts.bodyBold, fontSize: 13, color: colors.inkMuted, width: 22, textAlign: 'center' },
  ratingArt: { width: 48, height: 48, borderRadius: radii.sm },
  ratingName: { fontFamily: fonts.bodySemiBold, fontSize: 15, color: colors.ink },
  ratingArtist: { fontFamily: fonts.body, fontSize: 13, color: colors.inkTertiary, marginTop: 1 },
  ratingScore: { fontFamily: fonts.bodyBold, fontSize: 17 },

  empty: { fontFamily: fonts.body, fontSize: 14, color: colors.inkTertiary, textAlign: 'center', marginTop: spacing.xxl },
})
