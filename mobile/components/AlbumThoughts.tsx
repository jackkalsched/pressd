// The "Album thoughts" card that sits above the tracklist — the door into the
// record's discussion thread. Locked entirely until the viewer has finished
// rating it, which is the point: the room is worth entering because everyone
// in it has heard the whole thing. PLAN_discussions.md §10, §4.1.
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { useRouter } from 'expo-router'
import { useQuery } from '@tanstack/react-query'
import { ArrowRight, Lock, MessageCircle } from 'lucide-react-native'
import { resolveThread } from '../lib/api'
import { threadKey } from '../lib/refresh'
import { colors, fonts, radii, spacing } from '../theme/tokens'

export default function AlbumThoughts({
  album,
  artist,
}: {
  album: string
  artist: string
}) {
  const router = useRouter()
  const { data: meta } = useQuery({
    queryKey: threadKey('album', artist, album),
    queryFn: () => resolveThread({ subjectType: 'album', artist, album }),
    // A thread is a nicety on this page; a failure should leave the album
    // readable rather than retrying at it.
    retry: false,
  })

  if (!meta) return null

  const open = meta.canRead
  const count = meta.postCount

  return (
    <>
      <Text style={styles.sectionLabel}>ALBUM THOUGHTS</Text>
      <Pressable
        disabled={!open}
        onPress={() =>
          router.push({
            pathname: '/thread/[subject]',
            params: { subject: 'album', artist, album, title: album },
          })
        }
        style={({ pressed }) => [
          styles.card,
          !open && styles.cardLocked,
          pressed && open && { opacity: 0.85 },
        ]}
      >
        <View style={styles.icon}>
          {open ? (
            <MessageCircle size={17} color={colors.green} />
          ) : (
            <Lock size={15} color={colors.inkMuted} />
          )}
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.title}>
            {open
              ? count > 0
                ? `${count} ${count === 1 ? 'note' : 'notes'} on this record`
                : 'Start the conversation'
              : 'Notes open when you finish rating'}
          </Text>
          <Text style={styles.body} numberOfLines={2}>
            {open
              ? 'What everyone who finished this record had to say about it.'
              : 'Rate every track and the album to read and post here.'}
          </Text>
        </View>
        {open && <ArrowRight size={16} color={colors.green} />}
      </Pressable>
    </>
  )
}

const styles = StyleSheet.create({
  sectionLabel: {
    fontFamily: fonts.bodyBold, fontSize: 11, letterSpacing: 1.1,
    color: colors.inkTertiary, marginTop: spacing.xl, marginBottom: spacing.md,
  },
  card: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    backgroundColor: colors.greenSoft, borderRadius: radii.lg,
    paddingVertical: spacing.md, paddingHorizontal: spacing.md,
  },
  cardLocked: { backgroundColor: colors.inset },
  icon: { width: 30, alignItems: 'center' },
  title: { fontFamily: fonts.bodySemiBold, fontSize: 14, color: colors.ink },
  body: { fontFamily: fonts.body, fontSize: 12, color: colors.inkTertiary, marginTop: 2, lineHeight: 17 },
})
