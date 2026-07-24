// Social — friend activity (ratings & reviews with likes/comments), a Reviews
// tab, and a Find Friends flow (search + incoming/outgoing requests). Mirrors
// the website Social page.
import { useEffect, useState } from 'react'
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Image } from 'expo-image'
import { useRouter } from 'expo-router'
import { Heart, MessageCircle, Search, UserPlus, X } from 'lucide-react-native'
import {
  fetchFeed,
  fetchFriendReviews,
  toggleLike,
  searchUsers,
  addFriend,
  fetchFriendRequests,
  acceptFriendRequest,
  declineFriendRequest,
  type FeedItem,
  type FriendReview,
  type UserSearchResult,
} from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { markSocialSeen, latestFeedTime } from '../../lib/socialSeen'
import { songScoreColor } from '@pressd/shared/types'
import { colors, fonts, radii, spacing } from '../../theme/tokens'

type Tab = 'feed' | 'reviews'

function Avatar({ name, url, size = 36 }: { name: string; url?: string; size?: number }) {
  if (url) return <Image source={{ uri: url }} style={{ width: size, height: size, borderRadius: size / 2 }} contentFit="cover" />
  return (
    <View style={[styles.avatarFallback, { width: size, height: size, borderRadius: size / 2 }]}>
      <Text style={[styles.avatarInitial, { fontSize: size * 0.4 }]}>{name[0]?.toUpperCase()}</Text>
    </View>
  )
}

export default function Social() {
  const { user } = useAuth()
  const router = useRouter()
  const queryClient = useQueryClient()
  const [tab, setTab] = useState<Tab>('feed')
  const [findOpen, setFindOpen] = useState(false)

  const { data: feed = [], isLoading: feedLoading, refetch: refetchFeed, isRefetching } = useQuery({
    queryKey: ['feed', user?.id],
    queryFn: () => fetchFeed(user!.id),
    enabled: !!user,
  })
  const { data: reviews = [], isLoading: reviewsLoading } = useQuery({
    queryKey: ['reviews', 'recent'],
    queryFn: () => fetchFriendReviews('recent'),
    enabled: tab === 'reviews',
  })
  const { data: requests } = useQuery({
    queryKey: ['friend-requests', user?.id],
    queryFn: () => fetchFriendRequests(user!.id),
    enabled: !!user,
  })

  const incomingCount = requests?.incoming.length ?? 0

  // Viewing the feed clears the tab-bar "new activity" dot up to the newest item.
  useEffect(() => {
    if (feed.length) markSocialSeen(latestFeedTime(feed))
  }, [feed])

  async function like(albumId: number) {
    if (!user) return
    await toggleLike(user.id, albumId)
    queryClient.invalidateQueries({ queryKey: ['feed', user.id] })
    queryClient.invalidateQueries({ queryKey: ['reviews'] })
  }

  function openAlbum(id: number) {
    router.push({ pathname: '/album/[id]', params: { id: String(id) } })
  }
  function openFriend(id: number) {
    router.push({ pathname: '/friend/[id]', params: { id: String(id) } })
  }

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.title}>Social</Text>
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

      <View style={styles.segment}>
        {(['feed', 'reviews'] as Tab[]).map((t) => (
          <Pressable
            key={t}
            style={[styles.segmentTab, tab === t && styles.segmentActive]}
            onPress={() => setTab(t)}
          >
            <Text style={[styles.segmentText, tab === t && styles.segmentTextActive]}>
              {t === 'feed' ? 'Activity' : 'Reviews'}
            </Text>
          </Pressable>
        ))}
      </View>

      {tab === 'feed' ? (
        <FlatList
          data={feed}
          keyExtractor={(item, i) => `${item.type}-${item.album_id}-${item.friend.id}-${i}`}
          contentContainerStyle={styles.list}
          refreshing={isRefetching}
          onRefresh={refetchFeed}
          renderItem={({ item }) => (
            <FeedCard item={item} onLike={() => like(item.album_id)} onAlbum={() => openAlbum(item.album_id)} onFriend={() => openFriend(item.friend.id)} />
          )}
          ListEmptyComponent={
            feedLoading ? (
              <ActivityIndicator color={colors.green} style={{ marginTop: spacing.xxl }} />
            ) : (
              <Text style={styles.empty}>No friend activity yet. Add friends to see their ratings.</Text>
            )
          }
        />
      ) : (
        <FlatList
          data={reviews}
          keyExtractor={(item, i) => `${item.album_id}-${item.friend.id}-${i}`}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => (
            <ReviewCard item={item} onLike={() => like(item.album_id)} onAlbum={() => openAlbum(item.album_id)} onFriend={() => openFriend(item.friend.id)} />
          )}
          ListEmptyComponent={
            reviewsLoading ? (
              <ActivityIndicator color={colors.green} style={{ marginTop: spacing.xxl }} />
            ) : (
              <Text style={styles.empty}>No reviews from friends yet.</Text>
            )
          }
        />
      )}

      <FindFriends visible={findOpen} onClose={() => setFindOpen(false)} onOpenFriend={openFriend} />
    </SafeAreaView>
  )
}

function FeedCard({ item, onLike, onAlbum, onFriend }: { item: FeedItem; onLike: () => void; onAlbum: () => void; onFriend: () => void }) {
  const verb = item.type === 'review' ? 'reviewed' : item.type === 'recommendation' ? 'recommended' : 'rated'
  return (
    <View style={styles.card}>
      <View style={styles.cardHead}>
        <Pressable onPress={onFriend}>
          <Avatar name={item.friend.name} url={item.friend.avatar_url} />
        </Pressable>
        <Text style={styles.cardHeadText}>
          <Text style={styles.friendName} onPress={onFriend}>{item.friend.name}</Text>
          <Text style={styles.verb}> {verb}</Text>
        </Text>
      </View>
      <Pressable style={styles.albumRow} onPress={onAlbum}>
        {item.album_art_url ? (
          <Image source={{ uri: item.album_art_url }} style={styles.albumArt} contentFit="cover" />
        ) : (
          <View style={[styles.albumArt, styles.artFallback]}>
            <Text style={styles.artInitial}>{item.album_name[0]}</Text>
          </View>
        )}
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.albumName} numberOfLines={1}>{item.album_name}</Text>
          <Text style={styles.albumArtist} numberOfLines={1}>{item.artist}</Text>
          {item.review_excerpt ? <Text style={styles.excerpt} numberOfLines={2}>"{item.review_excerpt}"</Text> : null}
        </View>
        {item.score != null && (
          <Text style={[styles.score, { color: songScoreColor(item.score) }]}>{item.score.toFixed(2)}</Text>
        )}
      </Pressable>
      <SocialActions item={item} onLike={onLike} onAlbum={onAlbum} />
    </View>
  )
}

function ReviewCard({ item, onLike, onAlbum, onFriend }: { item: FriendReview; onLike: () => void; onAlbum: () => void; onFriend: () => void }) {
  return (
    <View style={styles.card}>
      <View style={styles.cardHead}>
        <Pressable onPress={onFriend}>
          <Avatar name={item.friend.name} url={item.friend.avatar_url} />
        </Pressable>
        <Text style={styles.cardHeadText}>
          <Text style={styles.friendName} onPress={onFriend}>{item.friend.name}</Text>
          <Text style={styles.verb}> reviewed</Text>
        </Text>
      </View>
      <Pressable style={styles.albumRow} onPress={onAlbum}>
        {item.album_art_url ? (
          <Image source={{ uri: item.album_art_url }} style={styles.albumArt} contentFit="cover" />
        ) : (
          <View style={[styles.albumArt, styles.artFallback]}>
            <Text style={styles.artInitial}>{item.album_name[0]}</Text>
          </View>
        )}
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.albumName} numberOfLines={1}>{item.album_name}</Text>
          <Text style={styles.albumArtist} numberOfLines={1}>{item.artist}</Text>
        </View>
        {item.score != null && (
          <Text style={[styles.score, { color: songScoreColor(item.score) }]}>{item.score.toFixed(2)}</Text>
        )}
      </Pressable>
      <Text style={styles.reviewBody}>{item.review}</Text>
      <SocialActions
        item={{ like_count: item.like_count, liked_by_me: item.liked_by_me, comment_count: item.comment_count }}
        onLike={onLike}
        onAlbum={onAlbum}
      />
    </View>
  )
}

function SocialActions({
  item,
  onLike,
  onAlbum,
}: {
  item: { like_count?: number; liked_by_me?: boolean; comment_count?: number }
  onLike: () => void
  onAlbum: () => void
}) {
  return (
    <View style={styles.actions}>
      <Pressable style={styles.actionBtn} onPress={onLike} hitSlop={8}>
        <Heart
          size={16}
          color={item.liked_by_me ? '#c0392b' : colors.inkTertiary}
          fill={item.liked_by_me ? '#c0392b' : 'transparent'}
        />
        <Text style={styles.actionText}>{item.like_count ?? 0}</Text>
      </Pressable>
      <Pressable style={styles.actionBtn} onPress={onAlbum} hitSlop={8}>
        <MessageCircle size={16} color={colors.inkTertiary} />
        <Text style={styles.actionText}>{item.comment_count ?? 0}</Text>
      </Pressable>
    </View>
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
                  <Avatar name={u.name} url={u.avatarUrl} />
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
                <Avatar name={item.name} url={item.avatar_url} />
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
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    marginTop: spacing.md,
  },
  title: { fontFamily: fonts.display, fontSize: 34, color: colors.ink, letterSpacing: 1 },
  findBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.greenSoft, paddingHorizontal: 12, paddingVertical: 8, borderRadius: radii.pill },
  findBtnText: { fontFamily: fonts.bodySemiBold, fontSize: 13, color: colors.green },
  badge: { backgroundColor: '#c0392b', borderRadius: 9, minWidth: 18, height: 18, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  badgeText: { fontFamily: fonts.bodyBold, fontSize: 11, color: '#fff' },

  segment: {
    flexDirection: 'row',
    backgroundColor: colors.inset,
    borderRadius: radii.md,
    padding: 4,
    marginHorizontal: spacing.lg,
    marginTop: spacing.md,
  },
  segmentTab: { flex: 1, paddingVertical: 8, alignItems: 'center', borderRadius: radii.sm },
  segmentActive: { backgroundColor: colors.raised },
  segmentText: { fontFamily: fonts.bodySemiBold, fontSize: 14, color: colors.inkTertiary },
  segmentTextActive: { color: colors.ink },

  list: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: 120 },
  card: {
    backgroundColor: colors.raised,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.md },
  cardHeadText: { flex: 1 },
  friendName: { fontFamily: fonts.bodySemiBold, fontSize: 14, color: colors.ink },
  verb: { fontFamily: fonts.body, fontSize: 14, color: colors.inkTertiary },
  albumRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  albumArt: { width: 56, height: 56, borderRadius: radii.sm },
  artFallback: { backgroundColor: colors.inset, alignItems: 'center', justifyContent: 'center' },
  artInitial: { fontFamily: fonts.display, fontSize: 22, color: colors.inkMuted },
  albumName: { fontFamily: fonts.bodySemiBold, fontSize: 15, color: colors.ink },
  albumArtist: { fontFamily: fonts.body, fontSize: 13, color: colors.inkTertiary, marginTop: 1 },
  excerpt: { fontFamily: fonts.body, fontSize: 12, color: colors.inkSecondary, marginTop: 4, fontStyle: 'italic' },
  score: { fontFamily: fonts.bodyBold, fontSize: 20 },
  reviewBody: { fontFamily: fonts.body, fontSize: 14, color: colors.inkSecondary, lineHeight: 20, marginTop: spacing.md },

  actions: { flexDirection: 'row', gap: spacing.xl, marginTop: spacing.md, paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border },
  actionBtn: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  actionText: { fontFamily: fonts.bodyMedium, fontSize: 13, color: colors.inkTertiary },

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

  avatarFallback: { backgroundColor: colors.green, alignItems: 'center', justifyContent: 'center' },
  avatarInitial: { fontFamily: fonts.bodyBold, color: '#fff' },
  empty: { fontFamily: fonts.body, fontSize: 14, color: colors.inkTertiary, textAlign: 'center', marginTop: spacing.xxl },
})
