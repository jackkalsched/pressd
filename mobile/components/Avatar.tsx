// The round avatar, photo or initial — mobile's twin of
// frontend/src/components/Avatar.tsx. Added with the thread's author faces;
// older screens still draw their own inline and can move onto this one.
import { Text, View } from 'react-native'
import { Image } from 'expo-image'
import { avatarColor } from '@pressd/shared/types'
import { fonts, NUM_SCALE_CAP } from '../theme/tokens'

export default function Avatar({
  name,
  avatarUrl,
  size = 22,
}: {
  name: string
  avatarUrl?: string | null
  size?: number
}) {
  const box = { width: size, height: size, borderRadius: size / 2 }
  if (avatarUrl) {
    return <Image source={{ uri: avatarUrl }} style={box} contentFit="cover" cachePolicy="memory-disk" />
  }
  return (
    <View style={[box, { backgroundColor: avatarColor(name || '?'), alignItems: 'center', justifyContent: 'center' }]}>
      <Text
        style={{ fontFamily: fonts.bodyBold, fontSize: size * 0.42, color: '#fff' }}
        maxFontSizeMultiplier={NUM_SCALE_CAP}
      >
        {(name || '?')[0].toUpperCase()}
      </Text>
    </View>
  )
}
