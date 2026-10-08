// "Pass it on" — the outbound twin of the "New Recommendation!" banner. It
// offers one of your favourites and a friend the model expects to love it, and
// a tap opens the Recommend sheet with both already chosen.
//
// Drawn as a SpotlightCard, as on web, so it sits as a pair with the resume card
// below it. The friend's face rides on the cover — the record and the person
// it's for, in one picture.
//
// The friend's predicted score never reaches the client, so there is no number
// to show for them. "Would probably love it" is the whole claim; your own score
// is yours, and it stays.
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native'
import { Image } from 'expo-image'
import { Send } from 'lucide-react-native'
import { avatarColor, songScoreColor } from '@pressd/shared/types'
import type { RecommendSuggestion } from '@pressd/shared/api'
import { colors, fonts, NUM_SCALE_CAP } from '../theme/tokens'
import SpotlightCard, { eyebrowTextStyle } from './SpotlightCard'

const AVATAR = 30

export default function PassItOnCell({
  suggestion,
  onPress,
  style,
}: {
  suggestion: RecommendSuggestion
  onPress: () => void
  style?: StyleProp<ViewStyle>
}) {
  const { album, friend } = suggestion
  const firstName = friend.name.split(' ')[0] || friend.name

  return (
    <SpotlightCard
      tone="orange"
      style={style}
      onPress={onPress}
      accessibilityLabel={`Pass it on: recommend ${album.albumName}, which you rated ${album.score.toFixed(2)}, to ${friend.name}`}
      eyebrow={
        <>
          <Send size={11} color="#ea6c0a" strokeWidth={2.6} />
          <Text style={eyebrowTextStyle('orange')}>Pass it on</Text>
        </>
      }
      title={album.albumName}
      artUrl={album.albumArtUrl}
      seed={album.artist}
      badge={
        friend.avatarUrl ? (
          <Image source={{ uri: friend.avatarUrl }} style={styles.avatar} contentFit="cover" cachePolicy="memory-disk" />
        ) : (
          <View style={[styles.avatar, { backgroundColor: avatarColor(friend.name) }]}>
            <Text style={styles.avatarInitial} maxFontSizeMultiplier={NUM_SCALE_CAP}>
              {friend.name[0]?.toUpperCase()}
            </Text>
          </View>
        )
      }
    >
      <Text style={styles.meta} numberOfLines={1}>
        {album.artist} · you rated it{' '}
        <Text style={[styles.score, { color: songScoreColor(album.score) }]}>
          {album.score.toFixed(2)}
        </Text>
      </Text>
      <Text style={styles.friendLine} numberOfLines={1}>
        <Text style={styles.friendName}>{firstName}</Text> would probably love it
      </Text>
    </SpotlightCard>
  )
}

const styles = StyleSheet.create({
  meta: { fontFamily: fonts.body, fontSize: 12.5, color: colors.inkTertiary, marginTop: 3 },
  score: { fontFamily: fonts.bodyBold },
  friendLine: { fontFamily: fonts.body, fontSize: 13.5, color: colors.inkSecondary, marginTop: 3 },
  friendName: { fontFamily: fonts.bodyBold, color: colors.ink },
  avatar: { width: AVATAR, height: AVATAR, borderRadius: AVATAR / 2, alignItems: 'center', justifyContent: 'center' },
  avatarInitial: { fontFamily: fonts.bodyBold, fontSize: 13, color: '#fff' },
})
