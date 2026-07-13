// Temporary stand-in for tabs whose real screens land in Phase 1/2.
import { StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { colors, fonts, spacing } from '../theme/tokens'

export default function PlaceholderScreen({ title, note }: { title: string; note: string }) {
  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <Text style={styles.title}>{title}</Text>
      <View style={styles.card}>
        <Text style={styles.note}>{note}</Text>
      </View>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg, paddingHorizontal: spacing.lg },
  title: {
    fontFamily: fonts.display,
    fontSize: 34,
    color: colors.ink,
    marginTop: spacing.lg,
    marginBottom: spacing.lg,
    letterSpacing: 2,
  },
  card: {
    backgroundColor: colors.raised,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.xl,
  },
  note: { fontFamily: fonts.bodyMedium, fontSize: 14, color: colors.inkTertiary, lineHeight: 21 },
})
