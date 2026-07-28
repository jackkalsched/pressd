// Shown after the user picks a search result, while the tracklist is fetched.
// Search results carry identity only, so there's a real gap (~250ms–2.5s
// depending on source) between the tap and having something to rate — this
// fills it with the album they picked rather than a bare spinner.
import { useEffect, useRef, useState } from 'react'
import { Animated, Easing, StyleSheet, Text, View } from 'react-native'
import { Image } from 'expo-image'
import { colors, fonts, radii, spacing } from '../theme/tokens'

/** "Loading tracklist" + a dot cycling 1→3, so the wait reads as live. */
function useEllipsis(): string {
  const [n, setN] = useState(1)
  useEffect(() => {
    const id = setInterval(() => setN((v) => (v % 3) + 1), 400)
    return () => clearInterval(id)
  }, [])
  return '.'.repeat(n)
}

export default function TracklistLoader({
  albumName,
  artist,
  coverUrl,
}: {
  albumName: string
  artist: string
  coverUrl?: string | null
}) {
  const dots = useEllipsis()
  const progress = useRef(new Animated.Value(0)).current

  // There's no byte-level progress to report, so the bar eases toward 90% and
  // holds — it never claims to be finished while a request is still open.
  useEffect(() => {
    Animated.timing(progress, {
      toValue: 0.9,
      duration: 1600,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start()
  }, [progress])

  const width = progress.interpolate({
    inputRange: [0, 1],
    outputRange: ['0%', '100%'],
  })

  return (
    <View style={styles.screen}>
      {coverUrl ? (
        <Image source={{ uri: coverUrl }} style={styles.art} contentFit="cover" />
      ) : (
        <View style={[styles.art, styles.artFallback]}>
          <Text style={styles.artInitial}>{albumName[0]?.toUpperCase()}</Text>
        </View>
      )}

      <Text style={styles.albumName} numberOfLines={2}>{albumName}</Text>
      <Text style={styles.artist} numberOfLines={1}>{artist}</Text>

      <View style={styles.track}>
        <Animated.View style={[styles.fill, { width }]} />
      </View>

      {/* The dots sit in their own fixed-width slot so the label doesn't
          shuffle left and right as they cycle. */}
      <View style={styles.labelRow}>
        <Text style={styles.label}>Loading tracklist</Text>
        <Text style={[styles.label, styles.dots]}>{dots}</Text>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
    backgroundColor: colors.bg,
  },
  art: { width: 168, height: 168, borderRadius: radii.lg },
  artFallback: { backgroundColor: colors.inset, alignItems: 'center', justifyContent: 'center' },
  artInitial: { fontFamily: fonts.display, fontSize: 60, color: colors.inkMuted },

  albumName: {
    fontFamily: fonts.display,
    fontSize: 24,
    color: colors.ink,
    textAlign: 'center',
    marginTop: spacing.xl,
  },
  artist: {
    fontFamily: fonts.bodyMedium,
    fontSize: 14,
    color: colors.inkSecondary,
    marginTop: 4,
  },

  track: {
    width: '78%',
    height: 5,
    borderRadius: 3,
    backgroundColor: colors.inset,
    overflow: 'hidden',
    marginTop: spacing.xl,
  },
  fill: { height: '100%', borderRadius: 3, backgroundColor: colors.green },

  labelRow: { flexDirection: 'row', marginTop: spacing.md },
  label: { fontFamily: fonts.bodyMedium, fontSize: 13, color: colors.inkTertiary },
  dots: { width: 16, textAlign: 'left' },
})
