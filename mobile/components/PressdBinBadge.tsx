// The Pressd-verified badge for a bin Pressd made: the full-colour Pressd mark
// on a cream chip. Above the title on the bin page's banner, and in the lower
// right of the collage on a bin's card. Cream whatever the appearance: it sits
// on album art or the dark banner, never on the page. Web's
// components/PressdBinBadge.tsx draws the same chip.
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native'
import { Image } from 'expo-image'

export default function PressdBinBadge({ width = 56, style }: { width?: number; style?: StyleProp<ViewStyle> }) {
  return (
    <View
      style={[styles.chip, { width, height: width * 0.6, borderRadius: width * 0.18, padding: Math.max(3, width * 0.08) }, style]}
      accessible
      accessibilityLabel="A Pressd bin"
    >
      <Image source={require('../assets/pressd-mark.png')} style={styles.mark} contentFit="contain" />
    </View>
  )
}

const styles = StyleSheet.create({
  chip: {
    backgroundColor: '#f9f8f6',
    shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 4, shadowOffset: { width: 0, height: 1 },
  },
  mark: { width: '100%', height: '100%' },
})
