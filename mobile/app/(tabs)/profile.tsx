// Profile — Phase 0's end-to-end proof: authed fetch of the signed-in user's
// rated library rendered as the 3-column art grid from the mockup. Stats and
// Ratings tabs join in Phase 1/2.
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useQuery } from '@tanstack/react-query'
import { Image } from 'expo-image'
import { LogOut } from 'lucide-react-native'
import { fetchAlbums } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { colors, fonts, radii, spacing } from '../../theme/tokens'

const GAP = 10

export default function Profile() {
  const { user, signOut } = useAuth()

  const { data: rated = [], isLoading, refetch, isRefetching } = useQuery({
    queryKey: ['albums', 'rated', user?.id],
    queryFn: () => fetchAlbums({ status: 'rated', userId: user!.id }),
    enabled: !!user,
  })

  if (!user) return null

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <FlatList
        data={rated}
        keyExtractor={(a) => String(a.id)}
        numColumns={3}
        columnWrapperStyle={{ gap: GAP }}
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={colors.green} />
        }
        ListHeaderComponent={
          <View style={styles.header}>
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
                <Text style={styles.count}>
                  {isLoading ? 'Loading library…' : `${rated.length} albums rated`}
                </Text>
              </View>
              <Pressable onPress={signOut} hitSlop={12} accessibilityLabel="Sign out">
                <LogOut size={20} color={colors.inkMuted} />
              </Pressable>
            </View>
            {user.bio ? <Text style={styles.bio}>{user.bio}</Text> : null}
          </View>
        }
        renderItem={({ item }) => (
          <View style={styles.cell}>
            {item.albumArtUrl ? (
              <Image source={{ uri: item.albumArtUrl }} style={styles.art} contentFit="cover" />
            ) : (
              <View style={[styles.art, styles.artFallback]}>
                <Text style={styles.artInitial}>{item.albumName[0]?.toUpperCase()}</Text>
              </View>
            )}
            {item.score != null && (
              <View style={styles.scoreChip}>
                <Text style={styles.scoreText}>{item.score.toFixed(1)}</Text>
              </View>
            )}
            <Text style={styles.albumName} numberOfLines={1}>{item.albumName}</Text>
          </View>
        )}
      />
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: spacing.lg, paddingBottom: 120, gap: GAP + 4 },
  header: { marginTop: spacing.lg, marginBottom: spacing.md },
  identity: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
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
  name: { fontFamily: fonts.display, fontSize: 28, color: colors.ink, letterSpacing: 1.5 },
  count: { fontFamily: fonts.bodyMedium, fontSize: 13, color: colors.inkTertiary, marginTop: 2 },
  bio: { fontFamily: fonts.body, fontSize: 13, color: colors.inkSecondary, marginTop: spacing.md, lineHeight: 19 },
  cell: { flex: 1 / 3 },
  art: { width: '100%', aspectRatio: 1, borderRadius: radii.md },
  artFallback: { backgroundColor: colors.inset, alignItems: 'center', justifyContent: 'center' },
  artInitial: { fontFamily: fonts.display, fontSize: 28, color: colors.inkMuted },
  scoreChip: {
    position: 'absolute',
    right: 6,
    top: undefined,
    bottom: 28,
    backgroundColor: colors.scoreChipBg,
    borderRadius: radii.sm,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  scoreText: { fontFamily: fonts.bodyBold, fontSize: 11, color: colors.scoreChipText },
  albumName: {
    fontFamily: fonts.bodyMedium,
    fontSize: 12,
    color: colors.inkSecondary,
    marginTop: 5,
  },
})
