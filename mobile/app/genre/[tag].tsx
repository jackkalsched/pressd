// The board behind one bar of the Stats genre/subgenre breakdown: every record
// that person has rated in that tag, best first.
//
// Built as the Charts board rather than as a plain list — same podium, same
// ranked rows, same reveal — because it answers the same question at a smaller
// scope. A user who has read the chart once already knows how to read this.
//
// Works for a friend's page as well as your own: the tag, the owner and whose
// data to read all arrive as params, so the page never assumes it is showing
// the signed-in user.
import type { NativeScrollEvent, NativeSyntheticEvent, StyleProp, ViewStyle } from 'react-native'
import { useRef, useState } from 'react'
import {
  ActivityIndicator,
  Animated,
  Dimensions,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useQuery } from '@tanstack/react-query'
import { Image } from 'expo-image'
import { ArrowLeft } from 'lucide-react-native'
import { fetchTagRecords, type TagRecord } from '../../lib/api'
import { songScoreColor, avatarColor } from '@pressd/shared/types'
import { revealStyle } from '../../lib/scrollReveal'
import { colors, contentWidth, fonts, radii, spacing } from '../../theme/tokens'

// Podium proportions and numeral caps copied from Charts deliberately: the two
// boards sit one tap apart and any drift between them would read as a bug.
const CONTENT_W = contentWidth()
const POD_GAP = spacing.xl
const POD_AVAIL = CONTENT_W - POD_GAP * 2
const POD_SIDE = Math.floor(POD_AVAIL * 0.3)
const POD_CENTER = Math.floor(POD_AVAIL * 0.4)

const WINDOW_H = Dimensions.get('window').height
const NUM_SCALE_CAP = 1.3
const RANK_SIZE = 19
const RANK_MIN_W = Math.ceil(RANK_SIZE * NUM_SCALE_CAP * 0.62 * 2)

/** "Chris" → "Chris's", "Travis" → "Travis'". */
function possessive(name: string): string {
  return /s$/i.test(name) ? `${name}'` : `${name}'s`
}

export default function TagRecordsBoard() {
  const { tag, kind, userId, owner } = useLocalSearchParams<{
    tag: string
    kind?: string
    userId?: string
    owner?: string
  }>()
  const label = decodeURIComponent(tag ?? '')
  const tagKind = kind === 'subgenre' ? 'subgenre' : 'genre'
  const uid = Number(userId)
  const ownerName = owner ? decodeURIComponent(owner) : ''
  const router = useRouter()
  const insets = useSafeAreaInsets()

  const { data, isLoading } = useQuery({
    queryKey: ['tag-records', uid, tagKind, label],
    queryFn: () => fetchTagRecords(label, tagKind, uid),
    enabled: Number.isFinite(uid) && !!label,
    staleTime: 5 * 60_000,
  })

  const items = data?.items ?? []
  const podium = items.slice(0, 3)
  const rest = items.slice(3)

  // These are one person's ratings, so entries open that person's copy — not
  // the averaged community view the userbase chart links to.
  function openAlbum(id: number) {
    router.push({ pathname: '/album/[id]', params: { id: String(id) } })
  }

  function goBack() {
    if (router.canGoBack()) router.back()
    else router.replace('/(tabs)/profile')
  }

  const scrollY = useRef(new Animated.Value(0)).current
  const mastheadOpacity = scrollY.interpolate({ inputRange: [0, 70], outputRange: [1, 0], extrapolate: 'clamp' })
  const mastheadShift = scrollY.interpolate({ inputRange: [0, 70], outputRange: [0, -14], extrapolate: 'clamp' })
  const compactOpacity = scrollY.interpolate({ inputRange: [36, 82], outputRange: [0, 1], extrapolate: 'clamp' })
  // Charts' compact bar is pointerEvents="none" — it is only a label. This one
  // carries the back control, so it has to accept touches, which means it also
  // has to stop accepting them while it is invisible: a transparent view still
  // catches taps, and it sits directly over the masthead's own back button.
  //
  // Read off the same scroll event that drives the fade rather than a listener
  // on the value, and gated on a ref so the state only moves when the answer
  // actually changes — this runs every frame.
  const [barLive, setBarLive] = useState(false)
  const barLiveRef = useRef(false)
  const onScroll = Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], {
    useNativeDriver: true,
    listener: (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const live = e.nativeEvent.contentOffset.y >= 36
      if (live !== barLiveRef.current) {
        barLiveRef.current = live
        setBarLive(live)
      }
    },
  })

  const kicker = ownerName ? `${possessive(ownerName).toUpperCase()} TOP RECORDS` : 'YOUR TOP RECORDS'

  return (
    <View style={styles.screen}>
      {/* Covers the masthead's back control once you've scrolled, so it carries
          its own. */}
      <Animated.View
        style={[styles.compactHeader, { opacity: compactOpacity, paddingTop: insets.top + spacing.sm }]}
        pointerEvents={barLive ? 'auto' : 'none'}
      >
        <Pressable onPress={goBack} hitSlop={12} accessibilityLabel="Back">
          <ArrowLeft size={18} color={colors.ink} />
        </Pressable>
        <Text style={styles.compactTitle} numberOfLines={1}>{label}</Text>
      </Animated.View>

      <Animated.FlatList
        data={rest}
        keyExtractor={(it) => String(it.album_id)}
        contentContainerStyle={[styles.content, { paddingTop: insets.top + spacing.sm }]}
        showsVerticalScrollIndicator={false}
        onScroll={onScroll}
        scrollEventThrottle={16}
        ListHeaderComponent={
          <View>
            <Animated.View style={{ opacity: mastheadOpacity, transform: [{ translateY: mastheadShift }] }}>
              <Pressable onPress={goBack} hitSlop={12} style={styles.backBtn} accessibilityLabel="Back">
                <ArrowLeft size={18} color={colors.inkSecondary} />
                <Text style={styles.backText}>Back</Text>
              </Pressable>
              <Text style={styles.kicker}>{kicker}</Text>
              <View style={styles.masthead}>
                <Text style={styles.title} numberOfLines={2}>{label}</Text>
                {data && (
                  <Text style={styles.count}>
                    {data.count} {data.count === 1 ? 'RECORD' : 'RECORDS'}
                    {data.avg_score != null ? ` · ${data.avg_score.toFixed(2)} AVG` : ''}
                  </Text>
                )}
              </View>
              <View style={styles.rule} />
            </Animated.View>

            {isLoading && items.length === 0 ? (
              <ActivityIndicator color={colors.green} style={{ marginTop: spacing.xxl }} />
            ) : items.length === 0 ? (
              <Text style={styles.empty}>
                {ownerName ? `${ownerName} hasn't` : "You haven't"} rated anything in {label} yet.
              </Text>
            ) : (
              <Podium items={podium} onOpen={openAlbum} />
            )}
          </View>
        }
        renderItem={({ item }) => <BoardRow item={item} onOpen={openAlbum} />}
        CellRendererComponent={({ children, index, style, ...rest }) => (
          <RevealCell index={index} scrollY={scrollY} style={style} {...rest}>
            {children}
          </RevealCell>
        )}
      />
    </View>
  )
}

function Podium({ items, onOpen }: { items: TagRecord[]; onOpen: (id: number) => void }) {
  const [one, two, three] = items
  return (
    <View style={styles.podium}>
      {two && <PodiumTile item={two} size={POD_SIDE} onOpen={onOpen} />}
      {one && <PodiumTile item={one} size={POD_CENTER} onOpen={onOpen} />}
      {three && <PodiumTile item={three} size={POD_SIDE} onOpen={onOpen} />}
    </View>
  )
}

function PodiumTile({ item, size, onOpen }: { item: TagRecord; size: number; onOpen: (id: number) => void }) {
  return (
    <Pressable style={[styles.podCol, { width: size }]} onPress={() => onOpen(item.album_id)}>
      <View style={[styles.podTile, { width: size, height: size }]}>
        {item.album_art_url ? (
          <Image source={{ uri: item.album_art_url }} style={styles.podImg} contentFit="cover" />
        ) : (
          <View style={[styles.podImg, styles.podFallback, { backgroundColor: avatarColor(item.album_name) }]}>
            <Text style={[styles.podLetter, { fontSize: size * 0.4 }]}>{item.album_name[0]?.toUpperCase()}</Text>
          </View>
        )}
      </View>
      <View style={styles.podMeta}>
        <Text style={styles.podRank} numberOfLines={1} maxFontSizeMultiplier={NUM_SCALE_CAP}>
          {item.rank}
        </Text>
        <Text
          style={[styles.podScore, { color: songScoreColor(item.score) }]}
          numberOfLines={1}
          adjustsFontSizeToFit
          maxFontSizeMultiplier={NUM_SCALE_CAP}
        >
          {item.score.toFixed(2)}
        </Text>
      </View>
      <Text style={styles.podName} numberOfLines={1}>{item.album_name}</Text>
      <Text style={styles.podArtist} numberOfLines={1}>{item.artist}</Text>
    </Pressable>
  )
}

/** One board row, rising and settling into place as it scrolls in. Measured off
 *  the cell rather than the row, for the reason Charts documents: inside a
 *  FlatList a row's own layout y is always zero. */
function RevealCell({
  children,
  index,
  scrollY,
  style,
  ...rest
}: {
  children: React.ReactNode
  index: number
  scrollY: Animated.Value
  style?: StyleProp<ViewStyle>
}) {
  const [y, setY] = useState<number | null>(null)
  const reveal = y == null ? null : revealStyle(scrollY, y, index, WINDOW_H)
  return (
    <Animated.View {...rest} style={[style, reveal]} onLayout={(e) => setY(e.nativeEvent.layout.y)}>
      {children}
    </Animated.View>
  )
}

function BoardRow({ item, onOpen }: { item: TagRecord; onOpen: (id: number) => void }) {
  return (
    <Pressable style={styles.row} onPress={() => onOpen(item.album_id)}>
      <Text style={styles.rowRank} numberOfLines={1} maxFontSizeMultiplier={NUM_SCALE_CAP}>
        {item.rank}
      </Text>
      {item.album_art_url ? (
        <Image source={{ uri: item.album_art_url }} style={styles.rowArt} contentFit="cover" />
      ) : (
        <View style={[styles.rowArt, styles.podFallback, { backgroundColor: avatarColor(item.album_name) }]}>
          <Text style={styles.rowLetter}>{item.album_name[0]?.toUpperCase()}</Text>
        </View>
      )}
      <View style={styles.rowText}>
        <Text style={styles.rowName} numberOfLines={1}>{item.album_name}</Text>
        <Text style={styles.rowArtist} numberOfLines={1}>
          {item.artist}{item.year ? ` · ${item.year}` : ''}
        </Text>
      </View>
      <Text
        style={[styles.rowScore, { color: songScoreColor(item.score) }]}
        numberOfLines={1}
        maxFontSizeMultiplier={NUM_SCALE_CAP}
      >
        {item.score.toFixed(2)}
      </Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: spacing.lg, paddingBottom: 130 },

  compactHeader: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 20,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.bg,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  compactTitle: { flex: 1, fontFamily: fonts.displayBlack, fontSize: 20, color: colors.ink, letterSpacing: 0.5 },

  backBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start' },
  backText: { fontFamily: fonts.bodyMedium, fontSize: 15, color: colors.inkSecondary },

  kicker: {
    fontFamily: fonts.bodyBold,
    fontSize: 11,
    letterSpacing: 1.4,
    color: colors.inkTertiary,
    marginTop: spacing.md,
  },
  // A tag name can be two words long, so the title takes what it needs and the
  // count is the side that gives way.
  masthead: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: spacing.md,
    marginTop: 4,
  },
  title: { flexShrink: 1, fontFamily: fonts.displayBlack, fontSize: 34, color: colors.ink, letterSpacing: 0.5 },
  count: {
    flexShrink: 1,
    textAlign: 'right',
    fontFamily: fonts.bodyBold,
    fontSize: 11,
    letterSpacing: 1.2,
    color: colors.inkTertiary,
    marginBottom: 7,
  },
  rule: { height: 2, backgroundColor: colors.ink, marginTop: spacing.sm },

  podium: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'center', gap: POD_GAP, marginTop: spacing.xl, marginBottom: spacing.xxl },
  podCol: { alignItems: 'center' },
  podTile: {
    borderRadius: radii.lg,
    overflow: 'hidden',
    shadowColor: '#1c1917',
    shadowOpacity: 0.14,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
    elevation: 6,
  },
  podImg: { width: '100%', height: '100%' },
  podFallback: { alignItems: 'center', justifyContent: 'center' },
  podLetter: { fontFamily: fonts.display, color: 'rgba(255,255,255,0.92)' },
  podMeta: { flexDirection: 'row', alignItems: 'baseline', gap: 6, marginTop: spacing.sm, maxWidth: '100%' },
  podRank: { flexShrink: 0, fontFamily: fonts.displayBlack, fontSize: 26, color: colors.ink },
  podScore: { flexShrink: 1, fontFamily: fonts.bodyBold, fontSize: 14 },
  podName: { fontFamily: fonts.bodyBold, fontSize: 14, color: colors.ink, marginTop: 2, maxWidth: '100%' },
  podArtist: { fontFamily: fonts.body, fontSize: 12, color: colors.inkTertiary, marginTop: 1 },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  rowRank: {
    fontFamily: fonts.displayBlack,
    fontSize: RANK_SIZE,
    color: colors.ink,
    minWidth: RANK_MIN_W,
    textAlign: 'center',
  },
  // The userbase chart leaves covers off its rows — 50 albums nobody has
  // necessarily heard read better as a list of names. Here every record is one
  // the reader rated, so the cover is the fastest way to recognise it.
  rowArt: { width: 40, height: 40, borderRadius: radii.sm },
  rowLetter: { fontFamily: fonts.display, fontSize: 17, color: 'rgba(255,255,255,0.92)' },
  rowText: { flex: 1, minWidth: 0 },
  rowName: { fontFamily: fonts.bodySemiBold, fontSize: 13, color: colors.ink },
  rowArtist: { fontFamily: fonts.body, fontSize: 12, color: colors.inkTertiary, marginTop: 1 },
  rowScore: { fontFamily: fonts.bodyBold, fontSize: 15, marginLeft: spacing.sm },

  empty: { fontFamily: fonts.body, fontSize: 14, color: colors.inkTertiary, textAlign: 'center', marginTop: spacing.xxl },
})
