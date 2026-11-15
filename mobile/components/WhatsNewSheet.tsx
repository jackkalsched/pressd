// "What's new in Pressd" — this release's slides (shared/src/whatsNew.ts),
// shown once per account after an update: a full-screen pager over wherever the
// app opened, swiped or stepped with its button, Skip in the corner. Each slide
// is a drawn scene (WhatsNewScenes), a Playfair title and a line; the dots sit
// left of the button, and the last slide's button runs the full width. Held by
// the root layout until the first run and the phone prompt are done, and off the
// screens nothing opens over (HELD_ON). Web's WhatsNewDialog is the same slides.
import { useRef, useState, type ReactNode } from 'react'
import { Animated, Modal, Pressable, StyleSheet, Text, View, useWindowDimensions, type ScrollView } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Image } from 'expo-image'
import { WHATS_NEW, whatsNewCta } from '@pressd/shared/whatsNew'
import { WhatsNewScene } from './WhatsNewScenes'
import { colors, fonts, radii, spacing, useColors } from '../theme/tokens'

const SLIDES = WHATS_NEW.slides

/** The picture at its natural size where there's room, scaled down where there
 *  isn't (a smaller phone, a larger text size), so the words below keep their
 *  space — the tutorial's FitStage. */
function Fit({ children }: { children: ReactNode }) {
  const [room, setRoom] = useState<{ w: number; h: number } | null>(null)
  const [size, setSize] = useState<{ w: number; h: number } | null>(null)
  const scale = room && size ? Math.min(1, room.w / size.w, room.h / size.h) : 1
  return (
    <View style={styles.stage} onLayout={(e) => setRoom({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}>
      <View
        style={{ transform: [{ scale }], opacity: room && size ? 1 : 0 }}
        onLayout={(e) => setSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}
      >
        {children}
      </View>
    </View>
  )
}

export default function WhatsNewSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const tc = useColors()
  // Read here, outside the Modal: a Modal renders in its own native hierarchy,
  // where SafeAreaView reads no insets, and the sheet ran under the status bar
  // and into the screen's corners.
  const insets = useSafeAreaInsets()
  const { width } = useWindowDimensions()
  const scrollRef = useRef<ScrollView>(null)
  const [x] = useState(() => new Animated.Value(0))
  const [page, setPage] = useState(0)
  const last = page === SLIDES.length - 1

  function next() {
    if (last) return onClose()
    scrollRef.current?.scrollTo({ x: (page + 1) * width, animated: true })
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="fullScreen" onRequestClose={onClose}>
      <View style={[styles.screen, { paddingTop: insets.top, paddingBottom: Math.max(insets.bottom, spacing.md) }]}>
        {/* The Pressd mark and wordmark, centred; Skip at the right. */}
        <View style={styles.header}>
          <View style={styles.brand}>
            <Image source={require('../assets/pressd-mark.png')} style={styles.mark} contentFit="contain" />
            <Text style={styles.wordmark}>Pressd</Text>
          </View>
          {!last && (
            <Pressable onPress={onClose} hitSlop={12} accessibilityRole="button" style={styles.skipBtn}>
              <Text style={styles.skip}>Skip</Text>
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
              if (p !== page && p >= 0 && p < SLIDES.length) setPage(p)
            },
          })}
        >
          {SLIDES.map((sl) => (
            <View key={sl.key} style={[styles.slide, { width }]}>
              <Fit>
                <WhatsNewScene slide={sl.key} />
              </Fit>
              {/* Capped growth under large text, so the picture keeps some room. */}
              <Text style={styles.title} maxFontSizeMultiplier={1.25}>{sl.title}</Text>
              <Text style={styles.body} maxFontSizeMultiplier={1.25}>{sl.body}</Text>
            </View>
          ))}
        </Animated.ScrollView>

        <View style={styles.footer}>
          <View style={styles.dots} accessibilityLabel={`Slide ${page + 1} of ${SLIDES.length}`}>
              {SLIDES.map((sl, i) => {
                const range = [(i - 1) * width, i * width, (i + 1) * width]
                return (
                  <Animated.View
                    key={sl.key}
                    style={[
                      styles.dot,
                      {
                        backgroundColor: tc.ink,
                        opacity: x.interpolate({ inputRange: range, outputRange: [0.25, 1, 0.25], extrapolate: 'clamp' }),
                        transform: [{ scaleX: x.interpolate({ inputRange: range, outputRange: [1, 2.6, 1], extrapolate: 'clamp' }) }],
                      },
                    ]}
                  />
                )
              })}
            </View>
          <Pressable
            onPress={next}
            style={({ pressed }) => [styles.cta, { backgroundColor: tc.greenFill }, pressed && { opacity: 0.85 }]}
            accessibilityRole="button"
          >
            <Text style={styles.ctaText}>{whatsNewCta(page, SLIDES.length)}</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  header: { height: 52, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.xl },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  mark: { width: 26, height: 26 },
  wordmark: { fontFamily: fonts.wordmark, fontSize: 24, lineHeight: 28, color: colors.ink },
  skipBtn: { position: 'absolute', right: spacing.xl },
  skip: { fontFamily: fonts.bodySemiBold, fontSize: 14, color: colors.inkMuted },
  slide: { flex: 1, paddingHorizontal: spacing.xl, paddingBottom: spacing.xl },
  // The picture takes the room the words leave, centred in it.
  stage: { flex: 1, alignItems: 'center', justifyContent: 'center', marginVertical: spacing.md, overflow: 'hidden' },
  title: { fontFamily: fonts.displayBlack, fontSize: 30, lineHeight: 36, letterSpacing: -0.3, color: colors.ink, textAlign: 'center' },
  body: {
    fontFamily: fonts.body, fontSize: 15, lineHeight: 22, color: colors.inkTertiary, textAlign: 'center',
    marginTop: spacing.sm, minHeight: 22 * 3, // three lines, so the title holds still between slides
  },
  // Centred dots over a full-width button.
  footer: { paddingHorizontal: spacing.xl, paddingTop: spacing.sm, paddingBottom: spacing.lg, gap: spacing.xl },
  dots: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9 },
  dot: { width: 6, height: 6, borderRadius: 3 },
  cta: { height: 50, borderRadius: radii.pill, alignItems: 'center', justifyContent: 'center' },
  ctaText: { fontFamily: fonts.bodyBold, fontSize: 15.5, color: '#ffffff' },
})
