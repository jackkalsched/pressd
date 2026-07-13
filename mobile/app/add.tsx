// The "+" bottom-sheet: album search → import → rate. Real search lands in
// Phase 1 (ports @pressd/shared's useAlbumSearch, same 4-source fan-out).
import { StyleSheet, Text, View, Pressable } from 'react-native'
import { useRouter } from 'expo-router'
import { X } from 'lucide-react-native'
import { colors, fonts, spacing } from '../theme/tokens'

export default function AddAlbum() {
  const router = useRouter()
  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <Text style={styles.title}>Add an album</Text>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <X size={22} color={colors.inkTertiary} />
        </Pressable>
      </View>
      <View style={styles.card}>
        <Text style={styles.note}>
          Search across iTunes, Spotify, Deezer, and MusicBrainz lands here in Phase 1 — the same
          find → import → rate pipeline as the website.
        </Text>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg, padding: spacing.lg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.md,
    marginBottom: spacing.lg,
  },
  title: { fontFamily: fonts.display, fontSize: 26, color: colors.ink, letterSpacing: 1.5 },
  card: {
    backgroundColor: colors.raised,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.xl,
  },
  note: { fontFamily: fonts.bodyMedium, fontSize: 14, color: colors.inkTertiary, lineHeight: 21 },
})
