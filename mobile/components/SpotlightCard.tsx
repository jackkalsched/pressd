// The "one record, one thing to do with it" card at the top of For You — used
// by Pass it on and by Pick this back up. The mobile port of
// frontend/src/components/SpotlightCard.tsx, so the two platforms share a look.
//
// No border and no button inside it: the record's own cover, blurred, is the
// card's colour; the cover sits tilted; the whole card is the target, and the
// action is a round arrow. The two callers differ only in what rides on the
// cover (a friend's face) and around the arrow (a progress ring).
import type { ReactNode } from 'react'
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native'
import { LinearGradient } from 'expo-linear-gradient'
import Svg, { Circle } from 'react-native-svg'
import { ArrowRight } from 'lucide-react-native'
import { colors, fonts, radii, spacing } from '../theme/tokens'
import CoverImage from './CoverImage'

// The same three colours per tone as web: the ink for the eyebrow and arrow,
// the wash under the blurred cover, and the empty part of the progress ring.
const TONES = {
  green: { ink: '#2d6a4f', wash: ['#e6f0ea', '#f6f4ef'], ring: '#cfe0d6' },
  orange: { ink: '#ea6c0a', wash: ['#ffeedd', '#f8f5f0'], ring: '#fbd5b5' },
} as const

// Smaller than web's 92/58: a phone column is narrower than either of web's
// cards, and every point here comes out of the title.
const COVER = 72
const RING = 48
const RING_STROKE = 3
const ARROW = 38

export default function SpotlightCard({
  tone,
  eyebrow,
  title,
  artUrl,
  seed,
  children,
  accessibilityLabel,
  onPress,
  badge,
  progress,
  style,
}: {
  tone: keyof typeof TONES
  /** The small label over the title, icon included. */
  eyebrow: ReactNode
  title: string
  artUrl?: string | null
  seed: string
  /** Lines under the title. */
  children: ReactNode
  accessibilityLabel: string
  onPress: () => void
  /** Rides on the cover's lower-right corner. */
  badge?: ReactNode
  /** 0–100: drawn as a ring around the arrow. */
  progress?: number
  style?: StyleProp<ViewStyle>
}) {
  const t = TONES[tone]
  const r = (RING - RING_STROKE) / 2
  const circumference = 2 * Math.PI * r

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={({ pressed }) => [styles.card, pressed && styles.cardPressed, style]}
    >
      <LinearGradient
        colors={t.wash}
        start={{ x: 0, y: 0.2 }}
        end={{ x: 0.75, y: 0.8 }}
        style={StyleSheet.absoluteFill}
      />
      {/* The record's colour, as light rather than as a picture. Scaled past
          the edges so the blur has no hard border to fade against. */}
      {artUrl && (
        // Blurred to a wash: a small image is all it needs.
        <CoverImage url={artUrl} displayPx={120} blurRadius={40} style={styles.glow} accessible={false} />
      )}

      <View style={styles.row}>
        <View style={styles.coverWrap}>
          <View style={styles.coverTilt}>
            {artUrl ? (
              <CoverImage url={artUrl} displayPx={COVER} style={styles.cover} />
            ) : (
              <View style={[styles.cover, styles.coverFallback]}>
                <Text style={styles.coverInitial}>{seed[0]?.toUpperCase()}</Text>
              </View>
            )}
          </View>
          {badge && <View style={styles.badge}>{badge}</View>}
        </View>

        <View style={styles.text}>
          <View style={styles.eyebrow}>
            {typeof eyebrow === 'string' ? (
              <Text style={[styles.eyebrowText, { color: t.ink }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>{eyebrow}</Text>
            ) : eyebrow}
          </View>
          {/* Two lines where web has one: a phone fits a few words per line. */}
          <Text style={styles.title} numberOfLines={2}>{title}</Text>
          {children}
        </View>

        <View style={styles.ringWrap}>
          {progress != null && (
            <Svg width={RING} height={RING} style={[StyleSheet.absoluteFill, { transform: [{ rotate: '-90deg' }] }]}>
              <Circle cx={RING / 2} cy={RING / 2} r={r} fill="none" stroke={t.ring} strokeWidth={RING_STROKE} />
              <Circle
                cx={RING / 2}
                cy={RING / 2}
                r={r}
                fill="none"
                stroke={t.ink}
                strokeWidth={RING_STROKE}
                strokeLinecap="round"
                strokeDasharray={circumference}
                strokeDashoffset={circumference * (1 - Math.min(100, Math.max(0, progress)) / 100)}
              />
            </Svg>
          )}
          <View style={[styles.arrow, { backgroundColor: t.ink }]}>
            <ArrowRight size={18} color="#fff" />
          </View>
        </View>
      </View>
    </Pressable>
  )
}

/** The eyebrow's text style, for callers that put an icon beside it. */
export function eyebrowTextStyle(tone: keyof typeof TONES) {
  return [styles.eyebrowText, { color: TONES[tone].ink }]
}

const styles = StyleSheet.create({
  card: { borderRadius: 26, overflow: 'hidden', backgroundColor: colors.bg },
  cardPressed: { transform: [{ scale: 0.985 }] },
  glow: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, opacity: 0.22, transform: [{ scale: 1.5 }] },

  row: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: spacing.lg, paddingRight: 14 },

  coverWrap: { flexShrink: 0 },
  // The shadow lives on an un-clipped wrapper; the image carries the radius.
  coverTilt: {
    borderRadius: 16,
    transform: [{ rotate: '-5deg' }],
    shadowColor: '#28190a',
    shadowOpacity: 0.35,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 10 },
    elevation: 8,
  },
  cover: { width: COVER, height: COVER, borderRadius: 16 },
  coverFallback: { backgroundColor: colors.inset, alignItems: 'center', justifyContent: 'center' },
  coverInitial: { fontFamily: fonts.display, fontSize: 26, color: colors.inkMuted },
  badge: {
    position: 'absolute',
    right: -8,
    bottom: -6,
    borderRadius: radii.pill,
    borderWidth: 3,
    borderColor: 'rgba(255,255,255,0.9)',
  },

  text: { flex: 1, minWidth: 0 },
  eyebrow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 3 },
  eyebrowText: { fontFamily: fonts.bodyBold, fontSize: 10.5, letterSpacing: 1.3, textTransform: 'uppercase' },
  title: { fontFamily: fonts.display, fontSize: 19, lineHeight: 23, color: colors.ink },

  ringWrap: { width: RING, height: RING, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  arrow: {
    width: ARROW,
    height: ARROW,
    borderRadius: ARROW / 2,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 6 },
    elevation: 4,
  },
})
