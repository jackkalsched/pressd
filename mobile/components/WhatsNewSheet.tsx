// "What's New" — the release notes, shown once after an update.
//
// A sheet rather than a route: it interrupts whatever the reader opened the app
// to do, so it has to be dismissible in one tap and leave them exactly where
// they were. A pushed screen would put it in the back stack and make the app
// feel like it started somewhere else.
//
// Deliberately not dismissible by tapping outside or swiping down. It appears
// exactly once per build, and a stray tap while the sheet animates in would
// spend that one showing on nothing.
import { Modal, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Sparkles } from 'lucide-react-native'
import type { Release } from '../lib/releaseNotes'
import { colors, fonts, radii, spacing } from '../theme/tokens'

export default function WhatsNewSheet({
  release,
  visible,
  onClose,
}: {
  release: Release
  visible: boolean
  onClose: () => void
}) {
  const insets = useSafeAreaInsets()
  const { height } = useWindowDimensions()

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={[styles.sheet, { maxHeight: height * 0.85, paddingBottom: insets.bottom + spacing.lg }]}>
          <View style={styles.grabber} />

          <View style={styles.head}>
            <View style={styles.badge}>
              <Sparkles size={13} color={colors.green} />
              <Text style={styles.badgeText}>BUILD {release.build}</Text>
            </View>
            <Text style={styles.title}>What&rsquo;s New</Text>
            <Text style={styles.sub}>Here&rsquo;s what changed in this update.</Text>
          </View>

          {/* Scrolls because the list grows every release and a fifth or sixth
              note would otherwise push the dismiss button off a small screen. */}
          <ScrollView
            style={styles.body}
            contentContainerStyle={styles.bodyContent}
            showsVerticalScrollIndicator={false}
          >
            {release.notes.map((n, i) => (
              <View key={n.title} style={styles.note}>
                <View style={styles.num}>
                  <Text style={styles.numText}>{i + 1}</Text>
                </View>
                <View style={styles.noteText}>
                  <Text style={styles.noteTitle}>{n.title}</Text>
                  <Text style={styles.noteBody}>{n.body}</Text>
                </View>
              </View>
            ))}
          </ScrollView>

          <Pressable style={styles.cta} onPress={onClose} accessibilityRole="button">
            <Text style={styles.ctaText}>Start listening</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(28,25,23,0.45)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.bg,
    borderTopLeftRadius: radii.xl,
    borderTopRightRadius: radii.xl,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
  },
  grabber: {
    alignSelf: 'center',
    width: 38,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.border,
    marginBottom: spacing.lg,
  },

  head: { marginBottom: spacing.lg },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: radii.pill,
    backgroundColor: colors.greenSoft,
  },
  badgeText: { fontFamily: fonts.bodyBold, fontSize: 10, letterSpacing: 1.2, color: colors.green },
  title: {
    fontFamily: fonts.displayBlack,
    fontSize: 34,
    color: colors.ink,
    letterSpacing: 0.4,
    marginTop: spacing.sm,
  },
  sub: { fontFamily: fonts.body, fontSize: 14, color: colors.inkTertiary, marginTop: 4 },

  body: { flexGrow: 0 },
  bodyContent: { paddingBottom: spacing.sm },
  note: { flexDirection: 'row', gap: spacing.md, marginBottom: spacing.lg },
  // A numeral rather than a bullet: these are ordered by importance, and the
  // first one is the reason the build exists.
  num: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.greenSoft,
    marginTop: 1,
  },
  numText: { fontFamily: fonts.bodyBold, fontSize: 12, color: colors.green },
  noteText: { flex: 1, minWidth: 0 },
  noteTitle: { fontFamily: fonts.bodyBold, fontSize: 15.5, color: colors.ink },
  noteBody: {
    fontFamily: fonts.body,
    fontSize: 14,
    lineHeight: 21,
    color: colors.inkSecondary,
    marginTop: 3,
  },

  cta: {
    marginTop: spacing.sm,
    paddingVertical: spacing.md + 2,
    borderRadius: radii.pill,
    backgroundColor: colors.green,
    alignItems: 'center',
  },
  ctaText: { fontFamily: fonts.bodyBold, fontSize: 15.5, color: '#ffffff' },
})
