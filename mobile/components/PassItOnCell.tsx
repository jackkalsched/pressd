// "Pass it on" — the outbound twin of the "New Recommendation!" banner. It
// offers one of your favourites and a friend the model expects to love it, and
// a tap opens the Recommend sheet with both already chosen.
//
// Same card geometry and orange as the banner, so the two read as a pair when
// they stack: one is something sent to you, the other something you could send.
// No star field — that motion belongs to an arrival, and this is only an idea.
//
// The friend's predicted score never reaches the client, so there is no number
// to show for them. "Would probably love it" is the whole claim; your own score
// is yours, and it stays.
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { Image } from 'expo-image'
import { ArrowRight, Send } from 'lucide-react-native'
import { avatarColor, songScoreColor } from '@pressd/shared/types'
import type { RecommendSuggestion } from '@pressd/shared/api'
import { colors, fonts, radii, spacing, NUM_SCALE_CAP } from '../theme/tokens'

// The recommendation orange, shared with RecommendationBanner and RecommendSheet.
const ORANGE = '#f97316'
const ORANGE_DEEP = '#c2410c'
const ORANGE_SOFT = 'rgba(249, 115, 22, 0.10)'

export default function PassItOnCell({
  suggestion,
  onPress,
}: {
  suggestion: RecommendSuggestion
  onPress: () => void
}) {
  const { album, friend } = suggestion
  const firstName = friend.name.split(' ')[0] || friend.name

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Pass it on: recommend ${album.albumName}, which you rated ${album.score.toFixed(2)}, to ${friend.name}`}
      style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
    >
      <View style={styles.body}>
        <View style={styles.headRow}>
          <Send size={14} color={ORANGE} strokeWidth={2.4} />
          <Text style={styles.title} numberOfLines={1}>Pass it on</Text>
        </View>

        <View style={styles.mediaRow}>
          {album.albumArtUrl ? (
            <Image source={{ uri: album.albumArtUrl }} style={styles.cover} contentFit="cover" />
          ) : (
            <View style={[styles.cover, styles.coverFallback]}>
              <Text style={styles.coverInitial} maxFontSizeMultiplier={NUM_SCALE_CAP}>
                {album.albumName[0]?.toUpperCase()}
              </Text>
            </View>
          )}
          <View style={styles.text}>
            <Text style={styles.albumName} numberOfLines={1}>{album.albumName}</Text>
            <Text style={styles.meta} numberOfLines={1}>
              {album.artist} · you rated it{' '}
              <Text style={[styles.score, { color: songScoreColor(album.score) }]}>
                {album.score.toFixed(2)}
              </Text>
            </Text>
            <View style={styles.friendRow}>
              {friend.avatarUrl ? (
                <Image source={{ uri: friend.avatarUrl }} style={styles.avatar} contentFit="cover" cachePolicy="memory-disk" />
              ) : (
                <View style={[styles.avatar, { backgroundColor: avatarColor(friend.name) }]}>
                  <Text style={styles.avatarInitial} maxFontSizeMultiplier={NUM_SCALE_CAP}>
                    {friend.name[0]?.toUpperCase()}
                  </Text>
                </View>
              )}
              <Text style={styles.friendLine} numberOfLines={1}>
                <Text style={styles.friendName}>{firstName}</Text> would probably love it
              </Text>
            </View>
          </View>
        </View>
      </View>

      <View style={styles.arrowWrap}>
        <ArrowRight size={20} color={ORANGE_DEEP} />
      </View>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  // Geometry matched to RecommendationBanner, so the two stack as siblings.
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing.lg,
    marginHorizontal: -spacing.sm,
    padding: spacing.lg,
    borderRadius: radii.lg,
    backgroundColor: ORANGE_SOFT,
  },
  cardPressed: { opacity: 0.7 },

  body: { flex: 1, minWidth: 0 },
  headRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  title: {
    flexShrink: 1,
    fontFamily: fonts.displayBlack,
    fontSize: 19,
    letterSpacing: 0.3,
    color: ORANGE_DEEP,
  },

  mediaRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginTop: spacing.sm },
  cover: { width: 56, height: 56, borderRadius: radii.sm },
  coverFallback: { backgroundColor: colors.inset, alignItems: 'center', justifyContent: 'center' },
  coverInitial: { fontFamily: fonts.display, fontSize: 20, color: colors.inkMuted },
  text: { flex: 1, minWidth: 0, gap: 2 },
  albumName: { fontFamily: fonts.bodySemiBold, fontSize: 15, color: colors.ink },
  meta: { fontFamily: fonts.body, fontSize: 12.5, color: colors.inkTertiary },
  score: { fontFamily: fonts.bodyBold },

  friendRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 3 },
  avatar: { width: 18, height: 18, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  avatarInitial: { fontFamily: fonts.bodyBold, fontSize: 9.5, color: '#fff' },
  friendLine: { flexShrink: 1, fontFamily: fonts.body, fontSize: 13, color: colors.inkSecondary },
  friendName: { fontFamily: fonts.bodyBold, color: colors.ink },

  arrowWrap: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(249,115,22,0.16)',
    marginLeft: spacing.sm,
  },
})
