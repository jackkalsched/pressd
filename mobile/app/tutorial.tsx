// Tutorial — five swipeable cards explaining how Pressd works, shown once to a
// new account before the welcome screen's first-album pick.
//
// "Once" is recorded on the account (PressUser.tutorial_seen_at), not the
// device, and the gate in (tabs)/_layout sends only an explicit
// tutorialSeen === false here. Finishing or skipping both count as seen: a
// tutorial someone has chosen to skip is not one they want to meet again.
//
// Settings reopens it with ?replay=1. A replay records nothing and closes back
// to where it came from instead of moving on to the welcome screen.
import { useRef, useState, type ReactNode } from 'react'
import {
  Animated,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type ScrollView,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useAuth } from '../lib/auth'
import { markWhatsNewSeen } from '../lib/whatsNew'
import {
  FriendsScene,
  FrontToBackScene,
  LearnsYouScene,
  TheRecordScene,
  YourCatalogScene,
} from '../components/TutorialScenes'
import { colors, fonts, radii, spacing } from '../theme/tokens'

const CARDS = [
  {
    title: 'Front to back.',
    body: 'Rate every song in track order. Songs unlock one at a time on your first listen, and you can change any score afterwards.',
    Scene: FrontToBackScene,
  },
  {
    title: 'Then the record.',
    body: 'Your song average is the base. Four factors move it up or down, judged against your own taste.',
    Scene: TheRecordScene,
  },
  {
    title: 'Your catalog.',
    body: 'Albums you want to hear wait in To Listen. When a friend recommends one, it lands there with their note.',
    Scene: YourCatalogScene,
  },
  {
    title: 'Better with friends.',
    body: "See what friends are rating and compare your taste. Each album has its own discussion, which opens once you've rated it.",
    Scene: FriendsScene,
  },
  {
    // Ten is MIN_RATED_ALBUMS in backend/scoring.py — change both.
    title: 'It learns your taste.',
    body: "After 10 rated albums, Pressd starts predicting what you'll love, and the predictions sharpen with every record you rate.",
    Scene: LearnsYouScene,
  },
]

/** The stage at its natural size where there's room, scaled down where there
 *  isn't. The scenes are drawn at one size for a tall phone; on a small one, or
 *  under a large text setting, the copy below keeps its space and the picture
 *  shrinks, rather than the two overlapping. */
function FitStage({ children }: { children: ReactNode }) {
  const [room, setRoom] = useState(0)
  const [natural, setNatural] = useState(0)
  const scale = room > 0 && natural > room ? room / natural : 1
  return (
    <View style={styles.stageWrap} onLayout={(e) => setRoom(e.nativeEvent.layout.height)}>
      <View
        style={[styles.stage, { transform: [{ scale }] }]}
        onLayout={(e) => setNatural(e.nativeEvent.layout.height)}
      >
        {children}
      </View>
    </View>
  )
}

export default function Tutorial() {
  const router = useRouter()
  const { replay } = useLocalSearchParams<{ replay?: string }>()
  const isReplay = replay === '1'
  const { completeTutorial } = useAuth()
  const { width } = useWindowDimensions()

  const scrollRef = useRef<ScrollView>(null)
  const [x] = useState(() => new Animated.Value(0))
  const [page, setPage] = useState(0)
  const last = page === CARDS.length - 1

  function finish() {
    if (isReplay) {
      router.back()
      return
    }
    // The release notes describe changes from a build this account never ran.
    markWhatsNewSeen()
    completeTutorial()
    router.replace('/welcome')
  }

  function next() {
    if (last) {
      finish()
      return
    }
    scrollRef.current?.scrollTo({ x: (page + 1) * width, animated: true })
  }

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Text style={styles.eyebrow}>HOW PRESSD WORKS</Text>
        {/* The last card's button already does what Skip would. */}
        {!last && (
          <Pressable onPress={finish} hitSlop={12} accessibilityRole="button">
            <Text style={styles.skip}>{isReplay ? 'Close' : 'Skip'}</Text>
          </Pressable>
        )}
      </View>

      <Animated.ScrollView
        ref={scrollRef}
        horizontal
        pagingEnabled
        bounces={false}
        showsHorizontalScrollIndicator={false}
        scrollEventThrottle={16}
        onScroll={Animated.event([{ nativeEvent: { contentOffset: { x } } }], {
          useNativeDriver: true,
          listener: (e: { nativeEvent: { contentOffset: { x: number } } }) => {
            const p = Math.round(e.nativeEvent.contentOffset.x / width)
            if (p !== page && p >= 0 && p < CARDS.length) setPage(p)
          },
        })}
      >
        {CARDS.map(({ title, body, Scene }, i) => (
          <View key={title} style={[styles.card, { width }]}>
            <FitStage>
              {/* Keyed on whether it's showing, so a card swiped back to
                  replays from the start instead of resuming mid-animation. */}
              <Scene key={page === i ? 'on' : 'off'} active={page === i} />
            </FitStage>
            <Text style={styles.title}>{title}</Text>
            <Text style={styles.body}>{body}</Text>
          </View>
        ))}
      </Animated.ScrollView>

      <View style={styles.footer}>
        <View style={styles.dots} accessibilityLabel={`Card ${page + 1} of ${CARDS.length}`}>
          {CARDS.map((c, i) => {
            const range = [(i - 1) * width, i * width, (i + 1) * width]
            return (
              <Animated.View
                key={c.title}
                style={[
                  styles.dot,
                  {
                    opacity: x.interpolate({ inputRange: range, outputRange: [0.3, 1, 0.3], extrapolate: 'clamp' }),
                    transform: [
                      { scale: x.interpolate({ inputRange: range, outputRange: [1, 1.35, 1], extrapolate: 'clamp' }) },
                    ],
                  },
                ]}
              />
            )
          })}
        </View>

        <Pressable
          onPress={next}
          style={({ pressed }) => [styles.cta, pressed && { backgroundColor: colors.greenPressed }]}
          accessibilityRole="button"
        >
          <Text style={styles.ctaText}>
            {!last ? 'Next' : isReplay ? 'Done' : 'Pick your first album'}
          </Text>
        </Pressable>
      </View>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.xl,
    height: 44,
  },
  eyebrow: { fontFamily: fonts.bodyBold, fontSize: 11, letterSpacing: 1.9, color: colors.green },
  skip: { fontFamily: fonts.bodySemiBold, fontSize: 14, color: colors.inkMuted },

  card: { flex: 1, paddingHorizontal: spacing.xl, paddingBottom: spacing.md },
  // Takes whatever height the copy leaves, and centres the stage in it, so a
  // short scene doesn't sit stranded at the top of a tall phone.
  stageWrap: { flex: 1, justifyContent: 'center', marginVertical: spacing.md },
  stage: {
    backgroundColor: colors.raised,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
  },
  title: {
    fontFamily: fonts.displayBlack,
    fontSize: 34,
    lineHeight: 40,
    letterSpacing: -0.4,
    color: colors.ink,
    marginTop: spacing.md,
  },
  body: {
    fontFamily: fonts.body,
    fontSize: 15.5,
    lineHeight: 23,
    color: colors.inkTertiary,
    marginTop: spacing.sm,
    minHeight: 23 * 4, // four lines, so the title holds still between cards
  },

  footer: { paddingHorizontal: spacing.xl, paddingBottom: spacing.sm, gap: spacing.lg },
  dots: { flexDirection: 'row', justifyContent: 'center', gap: 10 },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.green },
  cta: {
    height: 52,
    borderRadius: radii.md,
    backgroundColor: colors.green,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctaText: { fontFamily: fonts.bodySemiBold, fontSize: 15.5, color: '#fff' },
})
