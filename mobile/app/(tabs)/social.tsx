// Social — three tabs under one masthead:
//   Activity — a dense rating log grouped by day, no cards. Each row pairs the
//     friend's avatar with the album cover, and shows the friend's score plus
//     the gap against your own rating (only when you've rated it too).
//   Reviews  — a feed of friends' written reviews.
//   Friends  — your current friends.
import { useCallback, useMemo, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Animated,
  Dimensions,
  FlatList,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Image } from 'expo-image'
import { LinearGradient } from 'expo-linear-gradient'
import { useFocusEffect, useRouter } from 'expo-router'
import { Heart, Search, UserPlus, X } from 'lucide-react-native'
import {
  fetchFeed,
  fetchFriendReviews,
  fetchFriends,
  fetchAlbums,
  fetchCompare,
  copyAlbumToLibrary,
  toggleLike,
  searchUsers,
  addFriend,
  fetchFriendRequests,
  acceptFriendRequest,
  declineFriendRequest,
  type FeedItem,
  type FriendReview,
  type CompareItem,
  type UserInfo,
  type UserSearchResult,
} from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { markSocialSeen, latestFeedTime } from '../../lib/socialSeen'
import { songScoreColor, avatarColor } from '@pressd/shared/types'
import { colors, fonts, radii, spacing } from '../../theme/tokens'

const DOWN = '#c0392b'
const CONTENT_W = Dimensions.get('window').width - spacing.lg * 2
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

type Tab = 'activity' | 'compare' | 'reviews' | 'friends'
const TABS: { key: Tab; label: string }[] = [
  { key: 'activity', label: 'Activity' },
  { key: 'compare', label: 'Compare' },
  { key: 'reviews', label: 'Reviews' },
  { key: 'friends', label: 'Friends' },
]

const albumKey = (album: string, artist: string) => `${album.trim().toLowerCase()}||${artist.trim().toLowerCase()}`

function timeOf(it: FeedItem): string | undefined {
  return it.review_at ?? it.recommended_at ?? it.date_rated ?? undefined
}

function relativeTime(iso?: string): string {
  if (!iso) return ''
  const t = Date.parse(iso.length <= 10 ? `${iso}T00:00:00` : iso)
  if (Number.isNaN(t)) return ''
  const min = Math.floor((Date.now() - t) / 60_000)
  if (min < 60) return `${Math.max(1, min)}m`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h`
  return `${Math.floor(hr / 24)}d`
}

function dayLabelFor(key: string): string {
  if (key === 'unknown') return ''
  const d = new Date(`${key}T00:00:00`)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const diff = Math.round((today.getTime() - d.getTime()) / 86_400_000)
  if (diff <= 0) return 'TODAY'
  if (diff === 1) return 'YESTERDAY'
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }).toUpperCase()
}

function groupFeed(feed: FeedItem[]) {
  const groups: { key: string; label: string; count: number; items: FeedItem[] }[] = []
  for (const it of feed) {
    const key = timeOf(it)?.slice(0, 10) ?? 'unknown'
    let g = groups.find((x) => x.key === key)
    if (!g) {
      g = { key, label: dayLabelFor(key), count: 0, items: [] }
      groups.push(g)
    }
    g.items.push(it)
    g.count += 1
  }
  return groups
}

function Avatar({ name, url, size, style }: { name: string; url?: string | null; size: number; style?: object }) {
  if (url) return <Image source={{ uri: url }} style={[{ width: size, height: size, borderRadius: size / 2 }, style]} contentFit="cover" />
  return (
    <View style={[{ width: size, height: size, borderRadius: size / 2, backgroundColor: avatarColor(name), alignItems: 'center', justifyContent: 'center' }, style]}>
      <Text style={{ fontFamily: fonts.bodyBold, fontSize: size * 0.4, color: '#fff' }}>{name[0]?.toUpperCase()}</Text>
    </View>
  )
}

function AlbumTile({ name, url, size, style }: { name: string; url?: string | null; size: number; style?: object }) {
  if (url) return <Image source={{ uri: url }} style={[{ width: size, height: size, borderRadius: radii.sm }, style]} contentFit="cover" />
  return (
    <View style={[{ width: size, height: size, borderRadius: radii.sm, backgroundColor: avatarColor(name), alignItems: 'center', justifyContent: 'center' }, style]}>
      <Text style={{ fontFamily: fonts.display, fontSize: size * 0.42, color: 'rgba(255,255,255,0.92)' }}>{name[0]?.toUpperCase()}</Text>
    </View>
  )
}

/** The paired friend-avatar + album-cover cluster that leads every row. */
function Cluster({ item }: { item: { friend: { name: string; avatar_url?: string }; album_name: string; album_art_url?: string } }) {
  return (
    <View style={styles.cluster}>
      <AlbumTile name={item.album_name} url={item.album_art_url} size={40} style={styles.albumPos} />
      <Avatar name={item.friend.name} url={item.friend.avatar_url} size={40} style={styles.avatarPos} />
    </View>
  )
}

export default function Social() {
  const { user } = useAuth()
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const queryClient = useQueryClient()
  const [tab, setTab] = useState<Tab>('activity')
  const [findOpen, setFindOpen] = useState(false)
  const [queued, setQueued] = useState<Set<number>>(new Set())

  const { data: feed = [], isLoading: feedLoading } = useQuery({
    queryKey: ['feed', user?.id],
    queryFn: () => fetchFeed(user!.id),
    enabled: !!user,
  })
  // Opening Social clears the tab bar's "new activity" dot. Keyed on the newest
  // feed timestamp, so activity that lands while you're already on this screen
  // is marked seen too rather than leaving the dot behind when you navigate off.
  const latestActivity = latestFeedTime(feed)
  useFocusEffect(
    useCallback(() => {
      if (latestActivity > 0) markSocialSeen(latestActivity)
    }, [latestActivity]),
  )

  const { data: reviews = [], isLoading: reviewsLoading } = useQuery({
    queryKey: ['reviews', 'recent'],
    queryFn: () => fetchFriendReviews('recent'),
    enabled: tab === 'reviews',
  })
  const { data: friends = [], isLoading: friendsLoading } = useQuery({
    queryKey: ['friends', user?.id],
    queryFn: () => fetchFriends(user!.id),
    enabled: !!user,
  })
  const { data: compare = [], isLoading: compareLoading } = useQuery({
    queryKey: ['compare', user?.id],
    queryFn: fetchCompare,
    enabled: !!user && tab === 'compare',
  })
  const { data: myRated = [] } = useQuery({
    queryKey: ['albums', 'rated', user?.id],
    queryFn: () => fetchAlbums({ status: 'rated', userId: user!.id }),
    enabled: !!user,
  })
  const { data: requests } = useQuery({
    queryKey: ['friend-requests', user?.id],
    queryFn: () => fetchFriendRequests(user!.id),
    enabled: !!user,
  })

  const incomingCount = requests?.incoming.length ?? 0

  // Scroll-reactive masthead, matching For You: the big title lifts + fades as
  // the active tab scrolls, and a compact title bar fades in at the top. One
  // shared scrollY (only the active tab scrolls); reset it when switching tabs.
  const scrollY = useRef(new Animated.Value(0)).current
  const mastheadOpacity = scrollY.interpolate({ inputRange: [0, 70], outputRange: [1, 0], extrapolate: 'clamp' })
  const mastheadShift = scrollY.interpolate({ inputRange: [0, 70], outputRange: [0, -14], extrapolate: 'clamp' })
  const compactOpacity = scrollY.interpolate({ inputRange: [36, 82], outputRange: [0, 1], extrapolate: 'clamp' })
  const onScroll = Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], { useNativeDriver: true })
  function selectTab(t: Tab) {
    scrollY.setValue(0)
    setTab(t)
  }

  const groups = useMemo(() => groupFeed(feed), [feed])
  const myScores = useMemo(() => {
    const m = new Map<string, number>()
    for (const a of myRated) if (a.score != null) m.set(albumKey(a.albumName, a.artist), a.score)
    return m
  }, [myRated])

  function openAlbum(id: number) {
    router.push({ pathname: '/album/[id]', params: { id: String(id) } })
  }
  function openFriend(id: number) {
    router.push({ pathname: '/friend/[id]', params: { id: String(id) } })
  }
  async function like(albumId: number) {
    if (!user) return
    await toggleLike(user.id, albumId)
    queryClient.invalidateQueries({ queryKey: ['feed', user.id] })
    queryClient.invalidateQueries({ queryKey: ['reviews'] })
  }
  async function addToQueue(item: FeedItem) {
    if (!user || queued.has(item.album_id)) return
    setQueued((prev) => new Set(prev).add(item.album_id))
    try {
      // Clone the friend's exact album (metadata + tracklist) into your queue.
      await copyAlbumToLibrary(item.album_id, 'to_listen')
      queryClient.invalidateQueries({ queryKey: ['albums', 'to_listen', user.id] })
    } catch {
      setQueued((prev) => {
        const next = new Set(prev)
        next.delete(item.album_id)
        return next
      })
    }
  }

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      {/* Absolute children ignore the SafeAreaView's inset padding, so push the
          compact bar down below the status bar (clock) explicitly. */}
      <Animated.View
        style={[styles.compactHeader, { opacity: compactOpacity, paddingTop: insets.top + spacing.sm }]}
        pointerEvents="none"
      >
        <Text style={styles.compactTitle}>Social</Text>
      </Animated.View>

      <Animated.View style={{ opacity: mastheadOpacity, transform: [{ translateY: mastheadShift }] }}>
        <View style={styles.header}>
          <Text style={styles.pageTitle}>Social</Text>
          <Pressable style={styles.findBtn} onPress={() => setFindOpen(true)}>
            <UserPlus size={17} color={colors.green} />
            <Text style={styles.findBtnText}>Find friends</Text>
            {incomingCount > 0 && (
              <View style={styles.badge}>
                <Text style={styles.badgeText}>{incomingCount}</Text>
              </View>
            )}
          </Pressable>
        </View>
      </Animated.View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.tabsScroll}
        contentContainerStyle={styles.tabs}
      >
        {TABS.map(({ key, label }) => (
          <Pressable key={key} style={styles.tab} onPress={() => selectTab(key)}>
            <Text style={[styles.tabText, tab === key && styles.tabTextActive]}>{label}</Text>
            <View style={[styles.tabUnderline, tab === key && styles.tabUnderlineActive]} />
          </Pressable>
        ))}
      </ScrollView>

      {tab === 'activity' ? (
        feedLoading && feed.length === 0 ? (
          <ActivityIndicator color={colors.green} style={{ marginTop: spacing.xxl }} />
        ) : groups.length === 0 ? (
          <Text style={styles.empty}>No friend activity yet. Add friends to see their ratings.</Text>
        ) : (
          <Animated.ScrollView
            style={styles.fill}
            contentContainerStyle={styles.list}
            showsVerticalScrollIndicator={false}
            onScroll={onScroll}
            scrollEventThrottle={16}
          >
            {groups.map((g) => (
              <View key={g.key}>
                <View style={styles.dayHead}>
                  <Text style={styles.dayLabel}>{g.label}</Text>
                  <View style={styles.dayRule} />
                </View>
                {g.items.map((item, i) => (
                  <ActivityRow
                    key={`${item.type}-${item.album_id}-${item.friend.id}-${i}`}
                    item={item}
                    first={i === 0}
                    myScore={item.score != null ? myScores.get(albumKey(item.album_name, item.artist)) ?? null : null}
                    queued={queued.has(item.album_id)}
                    onOpenAlbum={openAlbum}
                    onLike={() => like(item.album_id)}
                    onRate={() => router.push({ pathname: '/rate/[id]', params: { id: String(item.album_id) } })}
                    onAddQueue={() => addToQueue(item)}
                  />
                ))}
              </View>
            ))}
          </Animated.ScrollView>
        )
      ) : tab === 'compare' ? (
        <Animated.FlatList
          data={compare}
          keyExtractor={(item, i) => `${item.album_id}-${i}`}
          style={styles.fill}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          onScroll={onScroll}
          scrollEventThrottle={16}
          renderItem={({ item, index }) => (
            <View style={index > 0 ? styles.divider : undefined}>
              <CompareCard item={item} onOpen={openAlbum} onOpenUser={openFriend} />
            </View>
          )}
          ListEmptyComponent={
            compareLoading ? (
              <ActivityIndicator color={colors.green} style={{ marginTop: spacing.xxl }} />
            ) : (
              <Text style={styles.empty}>
                Nothing to compare yet. When you and a friend both rate an album, it shows up here.
              </Text>
            )
          }
        />
      ) : tab === 'reviews' ? (
        <Animated.FlatList
          data={reviews}
          keyExtractor={(item, i) => `${item.album_id}-${item.friend.id}-${i}`}
          style={styles.fill}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          onScroll={onScroll}
          scrollEventThrottle={16}
          renderItem={({ item, index }) => (
            <ReviewRow item={item} first={index === 0} onOpenAlbum={openAlbum} onLike={() => like(item.album_id)} />
          )}
          ListEmptyComponent={
            reviewsLoading ? (
              <ActivityIndicator color={colors.green} style={{ marginTop: spacing.xxl }} />
            ) : (
              <Text style={styles.empty}>No reviews from friends yet.</Text>
            )
          }
        />
      ) : (
        <Animated.FlatList
          data={friends}
          keyExtractor={(f) => String(f.id)}
          style={styles.fill}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          onScroll={onScroll}
          scrollEventThrottle={16}
          renderItem={({ item, index }) => (
            <Pressable style={[styles.friendRow, index > 0 && styles.divider]} onPress={() => openFriend(item.id)}>
              <Avatar name={item.name} url={item.avatarUrl} size={44} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.friendName} numberOfLines={1}>{item.name}</Text>
                {item.bio ? <Text style={styles.friendBio} numberOfLines={1}>{item.bio}</Text> : null}
              </View>
            </Pressable>
          )}
          ListEmptyComponent={
            friendsLoading ? (
              <ActivityIndicator color={colors.green} style={{ marginTop: spacing.xxl }} />
            ) : (
              <Text style={styles.empty}>No friends yet. Tap Find friends to add some.</Text>
            )
          }
        />
      )}

      <FindFriends visible={findOpen} onClose={() => setFindOpen(false)} onOpenFriend={openFriend} />
    </SafeAreaView>
  )
}

function ActivityRow({
  item,
  first,
  myScore,
  queued,
  onOpenAlbum,
  onLike,
  onRate,
  onAddQueue,
}: {
  item: FeedItem
  first: boolean
  myScore: number | null
  queued: boolean
  onOpenAlbum: (id: number) => void
  onLike: () => void
  onRate: () => void
  onAddQueue: () => void
}) {
  const verb = item.type === 'review' ? 'reviewed' : item.type === 'recommendation' ? 'sent you' : 'rated'
  const time = relativeTime(timeOf(item))
  // Only compare when you've rated the same album — otherwise no subtext at all.
  const gap = item.score != null && myScore != null ? item.score - myScore : null

  return (
    <Pressable style={[styles.row, !first && styles.divider]} onPress={() => onOpenAlbum(item.album_id)}>
      <View style={styles.rowMain}>
        <Cluster item={item} />
        <View style={styles.rowText}>
          <Text style={styles.line1}>
            <Text style={styles.bold}>{item.friend.name}</Text>
            <Text style={styles.reg}> {verb} </Text>
            <Text style={styles.bold}>{item.album_name}</Text>
          </Text>
          <Text style={styles.line2} numberOfLines={1}>
            {item.artist}
            {item.type === 'recommendation' ? ' · in your queue' : ''}
            {time ? ` · ${time}` : ''}
          </Text>
        </View>
        <View style={styles.rowRight}>
          {item.type === 'recommendation' ? (
            <Pressable style={styles.rateBtn} onPress={onRate}>
              <Text style={styles.rateBtnText}>Rate</Text>
            </Pressable>
          ) : item.score != null ? (
            <>
              <Text style={[styles.score, { color: songScoreColor(item.score) }]}>{item.score.toFixed(2)}</Text>
              {gap != null && (
                <Text style={[styles.gap, { color: gap >= 0 ? colors.green : DOWN }]}>
                  {gap >= 0 ? '+' : '−'}{Math.abs(gap).toFixed(2)} vs you
                </Text>
              )}
            </>
          ) : null}
        </View>
      </View>

      {item.type === 'review' && item.review_excerpt ? (
        <View style={styles.reviewBlock}>
          <Text style={styles.reviewQuote}>“{item.review_excerpt}”</Text>
          <View style={styles.reviewActions}>
            <Pressable style={styles.actionBtn} onPress={onLike} hitSlop={6}>
              <Heart size={15} color={item.liked_by_me ? DOWN : colors.inkTertiary} fill={item.liked_by_me ? DOWN : 'transparent'} />
              <Text style={styles.actionText}>{item.like_count ?? 0}</Text>
            </Pressable>
            <Pressable onPress={() => onOpenAlbum(item.album_id)} hitSlop={6}>
              <Text style={styles.actionText}>{item.comment_count ?? 0} replies</Text>
            </Pressable>
            <Pressable onPress={onAddQueue} hitSlop={6} disabled={queued}>
              <Text style={styles.addQueue}>{queued ? 'Added' : 'Add to queue'}</Text>
            </Pressable>
          </View>
        </View>
      ) : null}
    </Pressable>
  )
}

function ReviewRow({
  item,
  first,
  onOpenAlbum,
  onLike,
}: {
  item: FriendReview
  first: boolean
  onOpenAlbum: (id: number) => void
  onLike: () => void
}) {
  return (
    <Pressable style={[styles.row, !first && styles.divider]} onPress={() => onOpenAlbum(item.album_id)}>
      <View style={styles.rowMain}>
        <Cluster item={item} />
        <View style={styles.rowText}>
          <Text style={styles.line1}>
            <Text style={styles.bold}>{item.friend.name}</Text>
            <Text style={styles.reg}> reviewed </Text>
            <Text style={styles.bold}>{item.album_name}</Text>
          </Text>
          <Text style={styles.line2} numberOfLines={1}>{item.artist}</Text>
        </View>
        {item.score != null && (
          <View style={styles.rowRight}>
            <Text style={[styles.score, { color: songScoreColor(item.score) }]}>{item.score.toFixed(2)}</Text>
          </View>
        )}
      </View>
      <View style={styles.reviewBlock}>
        <Text style={styles.reviewQuote}>“{item.review}”</Text>
        <View style={styles.reviewActions}>
          <Pressable style={styles.actionBtn} onPress={onLike} hitSlop={6}>
            <Heart size={15} color={item.liked_by_me ? DOWN : colors.inkTertiary} fill={item.liked_by_me ? DOWN : 'transparent'} />
            <Text style={styles.actionText}>{item.like_count}</Text>
          </Pressable>
          <Pressable onPress={() => onOpenAlbum(item.album_id)} hitSlop={6}>
            <Text style={styles.actionText}>{item.comment_count} replies</Text>
          </Pressable>
        </View>
      </View>
    </Pressable>
  )
}

function FindFriends({ visible, onClose, onOpenFriend }: { visible: boolean; onClose: () => void; onOpenFriend: (id: number) => void }) {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const [q, setQ] = useState('')

  const { data: results = [], isFetching } = useQuery({
    queryKey: ['user-search', q, user?.id],
    queryFn: () => searchUsers(q.trim(), user!.id),
    enabled: !!user && q.trim().length >= 2,
  })
  const { data: requests } = useQuery({
    queryKey: ['friend-requests', user?.id],
    queryFn: () => fetchFriendRequests(user!.id),
    enabled: !!user,
  })

  const incoming = requests?.incoming ?? []

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ['friend-requests', user?.id] })
    queryClient.invalidateQueries({ queryKey: ['user-search'] })
    queryClient.invalidateQueries({ queryKey: ['friends', user?.id] })
    queryClient.invalidateQueries({ queryKey: ['feed'] })
  }

  async function request(id: number) { if (user) { await addFriend(user.id, id); invalidate() } }
  async function accept(id: number) { if (user) { await acceptFriendRequest(user.id, id); invalidate() } }
  async function decline(id: number) { if (user) { await declineFriendRequest(user.id, id); invalidate() } }

  const showRequests = q.trim().length < 2 && incoming.length > 0

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} presentationStyle="pageSheet">
      <SafeAreaView style={styles.screen} edges={['top']}>
        <View style={styles.header}>
          <Text style={styles.title}>Find friends</Text>
          <Pressable onPress={onClose} hitSlop={12}><X size={22} color={colors.inkTertiary} /></Pressable>
        </View>
        <View style={styles.searchBar}>
          <Search size={16} color={colors.inkMuted} />
          <TextInput
            style={styles.searchInput}
            value={q}
            onChangeText={setQ}
            placeholder="Search by name"
            placeholderTextColor={colors.inkMuted}
            autoFocus
            autoCorrect={false}
          />
          {q.length > 0 && <Pressable onPress={() => setQ('')} hitSlop={8}><X size={15} color={colors.inkMuted} /></Pressable>}
        </View>

        {showRequests && (
          <>
            <Text style={styles.sectionLabel}>REQUESTS</Text>
            {incoming.map((u) => (
              <View key={u.id} style={styles.userRow}>
                <Pressable style={styles.userInfo} onPress={() => onOpenFriend(u.id)}>
                  <Avatar name={u.name} url={u.avatarUrl} size={36} />
                  <Text style={styles.userName}>{u.name}</Text>
                </Pressable>
                <View style={styles.reqBtns}>
                  <Pressable style={styles.acceptBtn} onPress={() => accept(u.id)}>
                    <Text style={styles.acceptText}>Accept</Text>
                  </Pressable>
                  <Pressable style={styles.declineBtn} onPress={() => decline(u.id)}>
                    <Text style={styles.declineText}>Decline</Text>
                  </Pressable>
                </View>
              </View>
            ))}
          </>
        )}

        <FlatList
          data={results}
          keyExtractor={(u) => String(u.id)}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.list}
          ListHeaderComponent={
            isFetching ? <ActivityIndicator color={colors.green} style={{ marginVertical: spacing.md }} /> : null
          }
          renderItem={({ item }) => (
            <View style={styles.userRow}>
              <Pressable style={styles.userInfo} onPress={() => onOpenFriend(item.id)}>
                <Avatar name={item.name} url={item.avatar_url} size={36} />
                <Text style={styles.userName}>{item.name}</Text>
              </Pressable>
              <FriendAction u={item} onRequest={() => request(item.id)} onAccept={() => accept(item.id)} />
            </View>
          )}
          ListEmptyComponent={
            q.trim().length >= 2 && !isFetching ? (
              <Text style={styles.empty}>No users found.</Text>
            ) : !showRequests ? (
              <Text style={styles.empty}>Search for friends by name.</Text>
            ) : null
          }
        />
      </SafeAreaView>
    </Modal>
  )
}

// The 5–10 scale line: friends as colored bubbles at their score, you as a dark
// tick. No numbers under it — the stack below carries the exact scores.
function NumberLine({ raters }: { raters: CompareItem['raters'] }) {
  const pos = (score: number) => ((clamp(score, 5, 10) - 5) / 5) * CONTENT_W
  return (
    <View style={styles.line}>
      <LinearGradient
        colors={['#d9a6a2', '#d8c99c', '#8fbb8c']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}
        style={styles.lineTrack}
      />
      {raters.map((r, i) => {
        const x = pos(r.score)
        // A real picture replaces the initial in the bubble; the tick below it
        // still takes the name's color, so the mark stays findable on the line
        // whether or not the photo reads at 26px.
        const color = r.is_you ? colors.ink : avatarColor(r.name)
        if (r.is_you) {
          // Same bubble as friends, set apart by a soft glow ring.
          return (
            <View key={i} pointerEvents="none">
              <View style={[styles.lineTick, { left: x - 1.5, backgroundColor: color }]} />
              <View style={[styles.youGlow, { left: clamp(x - 15, 0, CONTENT_W - 30) }]}>
                {r.avatar_url ? (
                  <Image source={{ uri: r.avatar_url }} style={styles.bubbleImg} contentFit="cover" />
                ) : (
                  <View style={styles.youBubble}>
                    <Text style={styles.bubbleText}>{r.name[0]?.toUpperCase()}</Text>
                  </View>
                )}
              </View>
            </View>
          )
        }
        return (
          <View key={i} pointerEvents="none">
            <View style={[styles.lineTick, { left: x - 1.5, backgroundColor: color }]} />
            <View style={[styles.bubble, { left: clamp(x - 13, 0, CONTENT_W - 26), backgroundColor: color }]}>
              {r.avatar_url ? (
                <Image source={{ uri: r.avatar_url }} style={styles.bubbleImg} contentFit="cover" />
              ) : (
                <Text style={styles.bubbleText}>{r.name[0]?.toUpperCase()}</Text>
              )}
            </View>
          </View>
        )
      })}
      <View style={styles.axis}>
        {[5, 6, 7, 8, 9, 10].map((n) => (
          <Text key={n} style={styles.axisLabel}>{n}</Text>
        ))}
      </View>
    </View>
  )
}

function CompareCard({
  item,
  onOpen,
  onOpenUser,
}: {
  item: CompareItem
  onOpen: (id: number) => void
  onOpenUser: (id: number) => void
}) {
  const week = item.recent ? ' this week' : ''
  const subtitle =
    item.highlight === 'disagreement'
      ? `Widest disagreement${week} · ${item.spread.toFixed(1)} spread`
      : `${item.friend_count} ${item.friend_count === 1 ? 'friend' : 'friends'} rated${week}`
  const subColor = item.highlight === 'disagreement' ? DOWN : colors.green

  return (
    <View style={styles.compareCard}>
      <View style={styles.compareHead}>
        <AlbumTile name={item.album_name} url={item.album_art_url} size={72} />
        <View style={styles.compareHeadText}>
          {/* The title is the way in — a separate "View album" button underneath
              said the same thing twice, and the name is what you were reaching
              for anyway. */}
          <Pressable
            onPress={() => onOpen(item.album_id)}
            hitSlop={6}
            accessibilityRole="button"
            accessibilityLabel={`View ${item.album_name}`}
          >
            <Text style={styles.compareName} numberOfLines={1}>{item.album_name}</Text>
          </Pressable>
          <Text style={styles.compareMeta} numberOfLines={1}>
            {item.artist}{item.year ? ` · ${item.year}` : ''}
          </Text>
          <Text style={[styles.compareSub, { color: subColor }]}>{subtitle}</Text>
        </View>
      </View>

      <NumberLine raters={item.raters} />

      <View style={styles.stack}>
        {item.raters.map((r, i) => (
          <View key={i} style={styles.stackRow}>
            {/* Avatar + name are the link. Your own row isn't one — you're
                already looking at your ratings. */}
            <Pressable
              style={styles.stackWho}
              onPress={() => !r.is_you && onOpenUser(r.user_id)}
              disabled={r.is_you}
              hitSlop={6}
              accessibilityRole={r.is_you ? undefined : 'button'}
              accessibilityLabel={r.is_you ? undefined : `View ${r.name}'s profile`}
            >
              <Avatar
                name={r.name}
                url={r.avatar_url}
                size={28}
                style={r.is_you && !r.avatar_url ? { backgroundColor: colors.ink } : undefined}
              />
              <Text style={styles.stackName}>{r.is_you ? 'You' : r.name}</Text>
            </Pressable>
            {r.review ? (
              <Text style={styles.stackReview} numberOfLines={1}>“{r.review}”</Text>
            ) : (
              <View style={{ flex: 1 }} />
            )}
            <Text style={[styles.stackScore, { color: songScoreColor(r.score) }]}>{r.score.toFixed(2)}</Text>
          </View>
        ))}
      </View>

    </View>
  )
}

function FriendAction({ u, onRequest, onAccept }: { u: UserSearchResult; onRequest: () => void; onAccept: () => void }) {
  if (u.already_friends) return <Text style={styles.friendsTag}>Friends</Text>
  if (u.request_received) return (
    <Pressable style={styles.acceptBtn} onPress={onAccept}><Text style={styles.acceptText}>Accept</Text></Pressable>
  )
  if (u.request_sent) return <Text style={styles.pendingTag}>Requested</Text>
  return (
    <Pressable style={styles.addBtn} onPress={onRequest}>
      <UserPlus size={15} color="#fff" />
      <Text style={styles.addBtnText}>Add</Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  fill: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    marginTop: spacing.md,
  },
  pageTitle: { fontFamily: fonts.displayBlack, fontSize: 40, color: colors.ink, letterSpacing: 0.5 },
  compactHeader: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 20,
    backgroundColor: colors.bg,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  compactTitle: { fontFamily: fonts.displayBlack, fontSize: 22, color: colors.ink, letterSpacing: 0.5 },
  title: { fontFamily: fonts.display, fontSize: 34, color: colors.ink, letterSpacing: 1 },
  findBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.greenSoft, paddingHorizontal: 12, paddingVertical: 8, borderRadius: radii.pill },
  findBtnText: { fontFamily: fonts.bodySemiBold, fontSize: 13, color: colors.green },
  badge: { backgroundColor: DOWN, borderRadius: 9, minWidth: 18, height: 18, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  badgeText: { fontFamily: fonts.bodyBold, fontSize: 11, color: '#fff' },

  tabsScroll: { flexGrow: 0, marginTop: spacing.lg },
  tabs: { flexDirection: 'row', gap: spacing.xl, paddingHorizontal: spacing.lg, paddingRight: spacing.xl },
  tab: { alignItems: 'center', gap: 6 },
  tabText: { fontFamily: fonts.bodySemiBold, fontSize: 15, color: colors.inkMuted },
  tabTextActive: { color: colors.ink },
  tabUnderline: { height: 2, width: '100%', borderRadius: 1, backgroundColor: 'transparent' },
  tabUnderlineActive: { backgroundColor: colors.green },

  list: { paddingHorizontal: spacing.lg, paddingBottom: 130 },
  divider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },

  dayHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.xl, marginBottom: spacing.sm },
  dayLabel: { fontFamily: fonts.bodyBold, fontSize: 11, letterSpacing: 1.2, color: colors.inkMuted },
  dayRule: { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: colors.border },

  row: { paddingVertical: spacing.lg },
  rowMain: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  cluster: { width: 66, height: 40 },
  albumPos: { position: 'absolute', left: 26, top: 0 },
  avatarPos: { position: 'absolute', left: 0, top: 0 },
  rowText: { flex: 1, minWidth: 0 },
  line1: { fontSize: 15, lineHeight: 21 },
  bold: { fontFamily: fonts.bodyBold, color: colors.ink },
  reg: { fontFamily: fonts.body, color: colors.inkSecondary },
  line2: { fontFamily: fonts.body, fontSize: 12, color: colors.inkTertiary, marginTop: 2 },
  rowRight: { alignItems: 'flex-end', minWidth: 60 },
  score: { fontFamily: fonts.bodyBold, fontSize: 22 },
  gap: { fontFamily: fonts.bodyBold, fontSize: 11, marginTop: 1 },
  rateBtn: { backgroundColor: colors.green, paddingHorizontal: 16, paddingVertical: 8, borderRadius: radii.sm },
  rateBtnText: { fontFamily: fonts.bodySemiBold, fontSize: 13, color: '#fff' },

  reviewBlock: { marginLeft: 66 + spacing.md, marginTop: spacing.sm },
  reviewQuote: { fontFamily: fonts.displayRegular, fontSize: 15, lineHeight: 22, color: colors.ink },
  reviewActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.xl, marginTop: spacing.sm },
  actionBtn: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  actionText: { fontFamily: fonts.bodyMedium, fontSize: 13, color: colors.inkTertiary },
  addQueue: { fontFamily: fonts.bodySemiBold, fontSize: 13, color: colors.green },

  friendRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.md },
  friendName: { fontFamily: fonts.bodySemiBold, fontSize: 16, color: colors.ink },
  friendBio: { fontFamily: fonts.body, fontSize: 13, color: colors.inkTertiary, marginTop: 1 },

  // Compare
  compareCard: { paddingVertical: spacing.lg },
  compareHead: { flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start' },
  compareHeadText: { flex: 1, minWidth: 0, paddingTop: 2 },
  compareName: { fontFamily: fonts.bodyBold, fontSize: 20, color: colors.ink },
  compareMeta: { fontFamily: fonts.body, fontSize: 13, color: colors.inkTertiary, marginTop: 2 },
  compareSub: { fontFamily: fonts.bodySemiBold, fontSize: 13, marginTop: 6 },

  line: { height: 66, marginTop: spacing.lg },
  lineTrack: { position: 'absolute', left: 0, right: 0, top: 38, height: 5, borderRadius: 3 },
  bubble: {
    position: 'absolute',
    top: 6,
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: colors.bg,
  },
  bubbleText: { fontFamily: fonts.bodyBold, fontSize: 11, color: '#fff' },
  lineTick: { position: 'absolute', top: 32, width: 3, height: 11, borderRadius: 1.5 },
  // Fills the bubble edge to edge. Keeps the same ring as the initial version
  // so a photo and a fallback sit identically on the line.
  bubbleImg: {
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 2,
    borderColor: colors.bg,
  },
  youGlow: {
    position: 'absolute',
    top: 4,
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: 'rgba(45,106,79,0.30)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  youBubble: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: colors.ink,
    borderWidth: 2,
    borderColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: colors.green,
    shadowOpacity: 0.9,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 0 },
    elevation: 4,
  },
  axis: { position: 'absolute', left: 0, right: 0, top: 50, flexDirection: 'row', justifyContent: 'space-between' },
  axisLabel: { fontFamily: fonts.body, fontSize: 11, color: colors.inkMuted },

  stack: { marginTop: spacing.md },
  stackRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 6 },
  // Avatar + name as one tap target. Sized to its contents so the review text
  // beside it keeps the rest of the row.
  stackWho: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  stackName: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.ink },
  stackReview: { flex: 1, fontFamily: fonts.displayRegular, fontSize: 14, color: colors.inkSecondary },
  stackScore: { fontFamily: fonts.bodyBold, fontSize: 18 },

  empty: { fontFamily: fonts.body, fontSize: 14, color: colors.inkTertiary, textAlign: 'center', marginTop: spacing.xxl, paddingHorizontal: spacing.lg },

  // Find friends modal
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginHorizontal: spacing.lg,
    marginTop: spacing.md,
    paddingHorizontal: spacing.md,
    height: 44,
    backgroundColor: colors.raised,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  searchInput: { flex: 1, fontFamily: fonts.body, fontSize: 15, color: colors.ink },
  sectionLabel: {
    fontFamily: fonts.bodyBold,
    fontSize: 11,
    letterSpacing: 1.2,
    color: colors.inkMuted,
    paddingHorizontal: spacing.lg,
    marginTop: spacing.lg,
    marginBottom: spacing.xs,
  },
  userRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
  },
  userInfo: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, flex: 1, minWidth: 0 },
  userName: { fontFamily: fonts.bodySemiBold, fontSize: 15, color: colors.ink },
  reqBtns: { flexDirection: 'row', gap: spacing.sm },
  addBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: colors.green, paddingHorizontal: 14, paddingVertical: 8, borderRadius: radii.pill },
  addBtnText: { fontFamily: fonts.bodySemiBold, fontSize: 13, color: '#fff' },
  acceptBtn: { backgroundColor: colors.green, paddingHorizontal: 14, paddingVertical: 8, borderRadius: radii.pill },
  acceptText: { fontFamily: fonts.bodySemiBold, fontSize: 13, color: '#fff' },
  declineBtn: { backgroundColor: colors.inset, paddingHorizontal: 14, paddingVertical: 8, borderRadius: radii.pill },
  declineText: { fontFamily: fonts.bodyMedium, fontSize: 13, color: colors.inkSecondary },
  friendsTag: { fontFamily: fonts.bodyMedium, fontSize: 13, color: colors.inkTertiary },
  pendingTag: { fontFamily: fonts.bodyMedium, fontSize: 13, color: colors.inkMuted },
})
