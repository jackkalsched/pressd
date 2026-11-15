// The pictures on "What's new in Pressd"'s slides (WhatsNewSheet), one per
// slide key in shared/src/whatsNew.ts: small arrangements of the app's own UI —
// a few floating cards, one raised and highlighted, tilted tags around them and
// a dashed path behind — drawn, not screenshots, with made-up records and
// people around real records (their covers from Pressd's catalog addresses).
// Every surface that stands for the app (cards, fields, text) takes the theme,
// so they follow dark mode; the fresh look's sweep draws both modes literally. Each scene is drawn at STAGE_W × STAGE_H and scaled to fit by the sheet.
import type { ReactNode } from 'react'
import { useEffect, useState } from 'react'
import { AccessibilityInfo, Animated, Easing, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native'
import { LinearGradient } from 'expo-linear-gradient'
import { Image } from 'expo-image'
import Svg, { Path } from 'react-native-svg'
import { Bookmark, CalendarDays, Heart, Lock, MapPin, MessageCircle, Moon, Search, Triangle } from 'lucide-react-native'
import type { WhatsNewKey } from '@pressd/shared/whatsNew'
import { overlapScore } from '@pressd/shared/types'
import VinylSpinner from './VinylSpinner'
import CoverImage from './CoverImage'
import { colors, fonts, scoreColor, useColors } from '../theme/tokens'

export const STAGE_W = 330
export const STAGE_H = 300

// Real covers, from the records' own catalog addresses on Pressd (Deezer's, or
// the Cover Art Archive's), and two local pictures: maya.j's bin cover and
// jack's photo. The people other than allison and jack aren't on Pressd, so
// they keep coloured circles.
const COVERS = {
  miseducation: 'https://cdn-images.dzcdn.net/images/cover/1322b9d5248a55034f098802072cfac4/1000x1000-000000-80-0-0.jpg',
  feverToTell: 'https://cdn-images.dzcdn.net/images/cover/60ce1a5d2238dc4dc7a7024eb34aa841/1000x1000-000000-80-0-0.jpg',
  kidA: 'https://cdn-images.dzcdn.net/images/cover/e5925065cdb1cefbc3bd75af4a1f1801/1000x1000-000000-80-0-0.jpg',
  inRainbows: 'https://cdn-images.dzcdn.net/images/cover/a175af9b7d329bc678cb4d26fc13d6de/1000x1000-000000-80-0-0.jpg',
  amnesiac: 'https://dn710600.ca.archive.org/0/items/mbid-2d46a116-bba8-45a2-b43f-23ecc0ef4266/mbid-2d46a116-bba8-45a2-b43f-23ecc0ef4266-38154760876_thumb500.jpg',
  okComputer: 'https://dn710603.ca.archive.org/0/items/mbid-4b3d18cc-8937-36f4-8de0-481088be58e6/mbid-4b3d18cc-8937-36f4-8de0-481088be58e6-17486835783_thumb500.jpg',
  blonde: 'https://cdn-images.dzcdn.net/images/cover/aa7e6de00b0810f5051aa60b489f58d8/1000x1000-000000-80-0-0.jpg',
  whoCares: 'https://cdn-images.dzcdn.net/images/cover/ba1e7f3702a82b91615689daff474622/1000x1000-000000-80-0-0.jpg',
  artifact: 'https://coverartarchive.org/release/8a0ae308-7447-4d7f-a03e-fdb23c7e0f07/46681534496-500.jpg',
  entropy: 'https://coverartarchive.org/release/e0e614a1-4242-4c16-9abe-644e35fcb60c/46681118833-500.jpg',
  unravelling: 'https://cdn-images.dzcdn.net/images/cover/0a8c8f590d264ceff64293d7e174aa2c/500x500-000000-80-0-0.jpg',
  // jack's shelf: Because the Internet, Pony, HALO, Waiting to Spill.
  becauseTheInternet: 'https://dn710708.ca.archive.org/0/items/mbid-af54650b-5020-4b8b-a121-3f32f31d86eb/mbid-af54650b-5020-4b8b-a121-3f32f31d86eb-5905091136_thumb500.jpg',
  pony: 'https://dn711207.ca.archive.org/0/items/mbid-079006b7-4aa1-412b-9b7d-a2fffe32cdbc/mbid-079006b7-4aa1-412b-9b7d-a2fffe32cdbc-24579167658_thumb500.jpg',
  halo: 'https://ia800806.us.archive.org/14/items/mbid-9eea63f3-7338-464f-8ce8-302b7154dd69/mbid-9eea63f3-7338-464f-8ce8-302b7154dd69-44798679413_thumb500.jpg',
  waitingToSpill: 'https://dn721605.ca.archive.org/0/items/mbid-37abad08-8127-453a-9512-485fa5d989a8/mbid-37abad08-8127-453a-9512-485fa5d989a8-33912329085_thumb500.jpg',
} as const
const ALLISON = 'https://pressd-backend.onrender.com/users/4/avatar?v=1791680791'
const LATE_NIGHT = require('../assets/whatsnew/late-night-drives.jpg')
const JACK = require('../assets/whatsnew/jack.jpg')

/** A real cover, sized by CoverImage, on an inset square while it loads. */
function Cover({ url, size, radius = 8 }: { url: string; size: number; radius?: number }) {
  const tc = useColors()
  return (
    <View style={{ width: size, height: size, borderRadius: radius, overflow: 'hidden', backgroundColor: tc.inset }}>
      <CoverImage url={url} displayPx={size} style={StyleSheet.absoluteFill} />
    </View>
  )
}

/** A local picture (a bin cover, a photo) in the same square or circle. */
function Pic({ source, size, radius = 8 }: { source: number; size: number; radius?: number }) {
  return <Image source={source} style={{ width: size, height: size, borderRadius: radius }} contentFit="cover" />
}

/** A real profile photo in a circle. */
function Face({ url, source, size }: { url?: string; source?: number; size: number }) {
  return <Image source={source ?? { uri: url }} style={{ width: size, height: size, borderRadius: size / 2 }} contentFit="cover" />
}

/** A floating card in the app's own surface colour. `raised` is the one in focus. */
function Card({ children, style, raised = false }: { children: ReactNode; style?: StyleProp<ViewStyle>; raised?: boolean }) {
  const tc = useColors()
  return (
    <View style={[s.card, raised && s.cardRaised, { borderColor: tc.border }, style]}>
      {children}
    </View>
  )
}

/** A tilted tag floating at a card's corner, as a label on a sticker. */
function Tag({ children, style, tone = 'plain' }: { children: ReactNode; style?: StyleProp<ViewStyle>; tone?: 'plain' | 'green' }) {
  const tc = useColors()
  return (
    <View style={[s.tag, tone === 'green' ? { backgroundColor: tc.greenFill } : { borderColor: tc.border, borderWidth: StyleSheet.hairlineWidth }, style]}>
      {typeof children === 'string'
        ? <Text style={[s.tagText, tone === 'green' && { color: '#ffffff' }]}>{children}</Text>
        : children}
    </View>
  )
}

/** The dashed path the cards float along. */
function Trail({ d }: { d: string }) {
  const tc = useColors()
  return (
    <Svg width={STAGE_W} height={STAGE_H} style={StyleSheet.absoluteFill} pointerEvents="none">
      <Path d={d} stroke={tc.border} strokeWidth={2} strokeDasharray="7 7" fill="none" strokeLinecap="round" />
    </Svg>
  )
}

function Dot({ color, size = 26 }: { color: string; size?: number }) {
  return <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: color }} />
}

function Score({ value, size = 15 }: { value: number; size?: number }) {
  return <Text style={[s.score, { fontSize: size, color: scoreColor(value) }]}>{value.toFixed(2)}</Text>
}

// ── The slides ──────────────────────────────────────────────────────────────

function Intro() {
  return (
    <View style={s.stage}>
      <Trail d="M20 250 C 80 180, 60 90, 165 80 S 300 140, 310 40" />
      <View style={{ position: 'absolute', left: (STAGE_W - 190) / 2, top: 40 }}>
        <VinylSpinner size={190} variant="1f" accessibilityLabel="A record sliding out of its sleeve" />
      </View>
      <Tag style={{ left: 8, top: 30, transform: [{ rotate: '-8deg' }] }}>Bins</Tag>
      <Tag style={{ right: 10, top: 22, transform: [{ rotate: '7deg' }] }} tone="green">Search</Tag>
      <Tag style={{ left: 0, bottom: 52, transform: [{ rotate: '6deg' }] }}>Taste overlap</Tag>
      <Tag style={{ right: 4, bottom: 38, transform: [{ rotate: '-6deg' }] }}>Upcoming</Tag>
    </View>
  )
}

function BinRow({ cover, title, sub, done, raised = false }: { cover: ReactNode; title: string; sub: string; done: number; raised?: boolean }) {
  const tc = useColors()
  return (
    <Card raised={raised} style={{ flexDirection: 'row', alignItems: 'center', gap: 11 }}>
      {cover}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[s.title, raised && { fontSize: 15 }]} numberOfLines={1}>{title}</Text>
        <Text style={s.sub} numberOfLines={1}>{sub}</Text>
        <View style={[s.track, { backgroundColor: tc.inset }]}>
          <View style={{ width: `${done}%`, height: '100%', borderRadius: 3, backgroundColor: tc.green }} />
        </View>
      </View>
      <View style={[s.iconBtn, raised && { backgroundColor: tc.greenFill, borderWidth: 0 }, { borderColor: tc.border }]}>
        <Bookmark size={14} color={raised ? '#ffffff' : tc.inkTertiary} fill={raised ? '#ffffff' : 'transparent'} />
      </View>
    </Card>
  )
}

function Bins() {
  const tc = useColors()
  return (
    <View style={s.stage}>
      <Trail d="M300 10 C 340 80, 260 120, 300 160 S 250 280, 40 290" />
      <View style={{ position: 'absolute', left: 22, right: 22, top: 12 }}>
        <BinRow cover={<Cover url={COVERS.feverToTell} size={48} />} title="Rolling Stone’s 200 Rock Songs" sub="Pressd Official" done={18} />
      </View>
      <View style={{ position: 'absolute', left: 4, right: 4, top: 104 }}>
        <BinRow cover={<Cover url={COVERS.miseducation} size={60} />} title="Apple Music 100 Best Albums" sub="24 of 100 rated" done={24} raised />
      </View>
      <View style={{ position: 'absolute', left: 22, right: 22, top: 210 }}>
        <BinRow cover={<Pic source={LATE_NIGHT} size={48} />} title="Late-night drives" sub="by maya.j · 32 albums" done={56} />
      </View>
      <Tag style={{ left: 10, top: 2, transform: [{ rotate: '-9deg' }] }} tone="green">Pressd Official</Tag>
      <Tag style={{ right: 12, bottom: 4, transform: [{ rotate: '5deg' }] }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <Lock size={10} color={tc.inkSecondary} />
          <Text style={s.tagText}>Private</Text>
        </View>
      </Tag>
    </View>
  )
}

function ResultRow({ art, title, sub, right }: { art: ReactNode; title: string; sub: string; right?: ReactNode }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
      {art}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={s.title} numberOfLines={1}>{title}</Text>
        <Text style={s.sub} numberOfLines={1}>{sub}</Text>
      </View>
      {right}
    </View>
  )
}

function SearchScene() {
  const tc = useColors()
  return (
    <View style={s.stage}>
      <Trail d="M10 60 C 90 20, 140 90, 200 50 S 320 120, 320 290" />
      <Card raised style={{ position: 'absolute', left: 16, right: 16, top: 18, flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 12 }}>
        <Search size={16} color={tc.inkTertiary} />
        <Text style={[s.title, { fontSize: 15 }]}>kid a</Text>
        <View style={{ width: 2, height: 18, backgroundColor: tc.green, marginLeft: -4 }} />
      </Card>
      <Card style={{ position: 'absolute', left: 30, right: 30, top: 96, gap: 12 }}>
        <ResultRow art={<Cover url={COVERS.kidA} size={38} />} title="Kid A" sub="Album · Radiohead" right={<Score value={9.12} />} />
        <ResultRow art={<Dot color="#c08a5a" size={38} />} title="kidamnesiac" sub="Person" right={<Text style={[s.pct, { color: scoreColor(overlapScore(74)) }]}>74%</Text>} />
        <ResultRow
          art={
            <View style={{ width: 38, height: 38, borderRadius: 8, overflow: 'hidden', flexDirection: 'row', flexWrap: 'wrap' }}>
              <Cover url={COVERS.kidA} size={19} radius={0} /><Cover url={COVERS.inRainbows} size={19} radius={0} />
              <Cover url={COVERS.amnesiac} size={19} radius={0} /><Cover url={COVERS.okComputer} size={19} radius={0} />
            </View>
          }
          title="Kid-A-adjacent"
          sub="Bin · 24 albums"
        />
      </Card>
      <Tag style={{ left: 6, bottom: 12, transform: [{ rotate: '-6deg' }] }}>People · Albums · Songs</Tag>
      <Tag style={{ right: 6, top: 76, transform: [{ rotate: '8deg' }] }} tone="green">Bins too</Tag>
    </View>
  )
}

/** One person on the sheet a first rating brings: who, how close, Add, and
 *  their best and worst song of the record — the people sheet's own row. */
function PersonRow({ name, color, pct, best, worst, raised = false }: {
  name: string; color: string; pct: number; best: [string, number]; worst: [string, number]; raised?: boolean
}) {
  const tc = useColors()
  return (
    <Card raised={raised} style={raised ? { paddingVertical: 14 } : undefined}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <Dot color={color} size={raised ? 38 : 32} />
        <Text style={[s.title, { flex: 1 }, raised && { fontSize: 15 }]} numberOfLines={1}>{name}</Text>
        {/* The overlap, highlighted on the raised row. */}
        <View style={raised ? [s.pctBadge, { backgroundColor: tc.greenSoft }] : null}>
          <Text style={[s.pct, { color: scoreColor(overlapScore(pct)) }, raised && { fontSize: 20 }]}>{pct}%</Text>
        </View>
        <View style={[s.addBtn, { backgroundColor: raised ? tc.greenFill : tc.inset }]}>
          <Text style={[s.addText, !raised && { color: tc.inkSecondary }]}>Add</Text>
        </View>
      </View>
      <View style={{ flexDirection: 'row', gap: 12, marginTop: 8, marginLeft: (raised ? 38 : 32) + 10 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3, flexShrink: 1 }}>
          <Triangle size={8} color={tc.green} fill={tc.green} />
          <Text style={s.sub} numberOfLines={1}>{best[0]} <Text style={{ color: scoreColor(best[1]) }}>{best[1].toFixed(1)}</Text></Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3, flexShrink: 1 }}>
          <View style={{ transform: [{ rotate: '180deg' }] }}><Triangle size={8} color="#e0492b" fill="#e0492b" /></View>
          <Text style={s.sub} numberOfLines={1}>{worst[0]} <Text style={{ color: scoreColor(worst[1]) }}>{worst[1].toFixed(1)}</Text></Text>
        </View>
      </View>
    </Card>
  )
}

function Overlap() {
  return (
    <View style={s.stage}>
      <Trail d="M300 10 C 340 90, 250 120, 300 170 S 220 290, 20 290" />
      {/* The sheet's heading: the record just finished, and who else rated it. */}
      <View style={{ position: 'absolute', left: 14, top: 0, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Cover url={COVERS.blonde} size={30} radius={6} />
        <Text style={s.title}>3 people rated <Text style={{ fontFamily: fonts.displayItalic }}>Blonde</Text> too</Text>
      </View>
      <View style={{ position: 'absolute', left: 22, right: 22, top: 42 }}>
        <PersonRow name="roxy" color="#d0a35e" pct={78} best={['Nights', 9.6]} worst={['Facebook Story', 5.8]} />
      </View>
      <View style={{ position: 'absolute', left: 4, right: 4, top: 124 }}>
        <PersonRow name="maya.j" color="#c08a5a" pct={82} best={['Ivy', 9.8]} worst={['Pretty Sweet', 6.4]} raised />
      </View>
      <View style={{ position: 'absolute', left: 22, right: 22, top: 218 }}>
        <PersonRow name="judecole" color="#5b7fae" pct={61} best={['Self Control', 9.2]} worst={['Close To You', 6.0]} />
      </View>
    </View>
  )
}

function Upcoming() {
  const tc = useColors()
  // December 2026, Monday first: the 1st is a Tuesday. Real records on Pressd's
  // upcoming list fill their days.
  const tiles: Record<number, string> = { 1: COVERS.unravelling, 4: COVERS.entropy, 11: COVERS.artifact }
  const cell = 26
  return (
    <View style={s.stage}>
      <Trail d="M10 280 C 80 230, 40 150, 140 140 S 300 60, 320 10" />
      <Card style={{ position: 'absolute', left: 8, top: 8, width: 7 * cell + 6 * 4 + 24 }}>
        <Text style={[s.title, { fontFamily: fonts.displayBlack, fontSize: 15 }]}>December</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 8 }}>
          {Array.from({ length: 35 }, (_, i) => {
            const day = i
            const real = day >= 1 && day <= 31
            const art = real ? tiles[day] : undefined
            return (
              <View key={i} style={{ width: cell, height: cell, borderRadius: 5, overflow: 'hidden', backgroundColor: real ? tc.inset : 'transparent' }}>
                {art ? <Cover url={art} size={cell} radius={0} /> : null}
                {real && <Text style={[s.day, art ? { color: '#ffffff' } : null]}>{day}</Text>}
              </View>
            )
          })}
        </View>
      </Card>
      <Card raised style={{ position: 'absolute', right: 4, bottom: 18, width: 204, gap: 10 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <Cover url={COVERS.artifact} size={50} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={s.title} numberOfLines={1}>Artifact</Text>
            <Text style={s.sub} numberOfLines={1}>Warpaint</Text>
            <Text style={[s.sub, { color: tc.green }]}>Out Fri, Dec 11</Text>
          </View>
        </View>
        <View style={[s.pill, { backgroundColor: tc.greenFill }]}>
          <Text style={s.pillText}>Add to Library</Text>
        </View>
      </Card>
      <Tag style={{ right: 10, top: 18, transform: [{ rotate: '7deg' }] }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <CalendarDays size={11} color={tc.green} />
          <Text style={s.tagText}>45 this month</Text>
        </View>
      </Tag>
    </View>
  )
}

function Profile() {
  const tc = useColors()
  const shelf = [COVERS.becauseTheInternet, COVERS.pony, COVERS.halo, COVERS.waitingToSpill]
  return (
    <View style={s.stage}>
      <Trail d="M320 20 C 250 60, 330 140, 230 170 S 40 200, 10 290" />
      <Card raised style={{ position: 'absolute', left: 16, right: 16, top: 14, padding: 0, overflow: 'hidden' }}>
        <LinearGradient colors={['#2d6a4f', '#7fc29c']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ height: 64 }} />
        <View style={{ paddingHorizontal: 14, paddingBottom: 14 }}>
          <View style={{ width: 54, height: 54, borderRadius: 27, borderWidth: 3, borderColor: tc.raised, marginTop: -27, overflow: 'hidden' }}>
            <Face source={JACK} size={48} />
          </View>
          <Text style={[s.title, { fontSize: 16, marginTop: 4 }]}>jack</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
            <Text style={s.sub}>@jack</Text>
            <MapPin size={10} color={tc.inkTertiary} />
            <Text style={s.sub}>San Diego, CA</Text>
          </View>
          <Text style={[s.label, { marginTop: 12 }]}>JACK’S SHELF</Text>
          <View style={{ flexDirection: 'row', marginTop: 8 }}>
            {shelf.map((url, i) => (
              <View key={url} style={{ marginLeft: i ? -10 : 0, transform: [{ rotate: `${[-5, 3, -2, 6][i]}deg` }, { translateY: [2, -3, 1, -1][i] }] }}>
                <Cover url={url} size={62} radius={6} />
              </View>
            ))}
          </View>
        </View>
      </Card>
      <Tag style={{ right: 4, top: 50, transform: [{ rotate: '8deg' }] }} tone="green">Your banner</Tag>
      <Tag style={{ left: 2, bottom: 4, transform: [{ rotate: '-6deg' }] }}>Four on the shelf</Tag>
    </View>
  )
}

/** The fresh look's pair of For You review cards, in one appearance. Literal
 *  colours on purpose: the slide shows both modes whatever the app is in. */
function ReviewPair({ dark }: { dark: boolean }) {
  const ink = dark ? '#f4efe7' : '#1c1917'
  const muted = dark ? '#9c948a' : '#78716c'
  const line = dark ? '#34302c' : '#ece5da'
  const surface = dark ? '#211f1d' : '#ffffff'
  const page = dark ? '#171615' : '#f9f8f6'
  const green = dark ? '#7fc29c' : '#2d6a4f'
  const card = (face: ReactNode, who: string, cover: string, album: string, value: number, likes: number, replies: number, style: StyleProp<ViewStyle>) => (
    <View style={[s.card, s.cardRaised, { position: 'absolute', width: 224, backgroundColor: surface, borderColor: line }, style]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9 }}>
        <Cover url={cover} size={36} radius={6} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={[s.title, { color: ink }]} numberOfLines={1}>{album}</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 2 }}>
            {face}
            <Text style={[s.sub, { color: muted, marginTop: 0 }]}>{who}</Text>
          </View>
        </View>
        <Text style={[s.score, { color: green }]}>{value.toFixed(2)}</Text>
      </View>
      <View style={{ height: 5, borderRadius: 3, marginTop: 10, width: '94%', backgroundColor: line }} />
      <View style={{ height: 5, borderRadius: 3, marginTop: 6, width: '70%', backgroundColor: line }} />
      <View style={{ flexDirection: 'row', gap: 12, marginTop: 10 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <Heart size={12} color="#c0392b" fill="#c0392b" />
          <Text style={[s.sub, { color: muted, marginTop: 0 }]}>{likes}</Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <MessageCircle size={12} color={muted} />
          <Text style={[s.sub, { color: muted, marginTop: 0 }]}>{replies}</Text>
        </View>
      </View>
    </View>
  )
  return (
    <View style={[StyleSheet.absoluteFill, { backgroundColor: page, borderRadius: 22 }]}>
      <Text style={[s.label, { position: 'absolute', left: 18, top: 16, color: muted }]}>WHAT ARE PRESSERS TALKING ABOUT</Text>
      {card(<Face url={ALLISON} size={14} />, 'allison', COVERS.whoCares, 'WHO CARES?', 7.53, 12, 4, { left: 14, top: 44 })}
      {card(<Dot color="#c08a5a" size={14} />, 'maya.j', COVERS.blonde, 'Blonde', 9.2, 31, 7, { right: 14, top: 150 })}
    </View>
  )
}

/** Light into dark: a bar sweeps across and leaves the dark version behind it,
 *  holds, then sweeps back — the dark copy rides a clipping window that slides
 *  across while its contents slide the other way, so they hold still. */
function Look() {
  const [p] = useState(() => new Animated.Value(0))
  useEffect(() => {
    let loop: Animated.CompositeAnimation | null = null
    AccessibilityInfo.isReduceMotionEnabled().then((reduce) => {
      if (reduce) { p.setValue(0.5); return }
      const sweep = (to: number) => Animated.timing(p, { toValue: to, duration: 1300, easing: Easing.inOut(Easing.cubic), useNativeDriver: true })
      loop = Animated.loop(Animated.sequence([Animated.delay(700), sweep(1), Animated.delay(1400), sweep(0)]))
      loop.start()
    }).catch(() => {})
    return () => loop?.stop()
  }, [p])
  const window = p.interpolate({ inputRange: [0, 1], outputRange: [-STAGE_W, 0] })
  const counter = p.interpolate({ inputRange: [0, 1], outputRange: [STAGE_W, 0] })
  return (
    <View style={[s.stage, { borderRadius: 22, overflow: 'hidden' }]}>
      <ReviewPair dark={false} />
      <Animated.View style={[StyleSheet.absoluteFill, { overflow: 'hidden', transform: [{ translateX: window }] }]}>
        <Animated.View style={[StyleSheet.absoluteFill, { transform: [{ translateX: counter }] }]}>
          <ReviewPair dark />
        </Animated.View>
        {/* The bar, at the dark side's leading edge. */}
        <View style={s.sweepBar} />
      </Animated.View>
      <Tag style={{ right: 12, bottom: 12, transform: [{ rotate: '-5deg' }] }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <Moon size={11} color="#78716c" />
          <Text style={[s.tagText, { color: '#57534e' }]}>Dark mode</Text>
        </View>
      </Tag>
    </View>
  )
}

export function WhatsNewScene({ slide }: { slide: WhatsNewKey }) {
  switch (slide) {
    case 'intro': return <Intro />
    case 'bins': return <Bins />
    case 'search': return <SearchScene />
    case 'overlap': return <Overlap />
    case 'upcoming': return <Upcoming />
    case 'profile': return <Profile />
    case 'look': return <Look />
  }
}

const s = StyleSheet.create({
  stage: { width: STAGE_W, height: STAGE_H },
  card: {
    backgroundColor: colors.raised,
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 12,
    shadowColor: '#1c1917',
    shadowOpacity: 0.1,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
  },
  cardRaised: { shadowOpacity: 0.22, shadowRadius: 22, shadowOffset: { width: 0, height: 12 } },
  tag: {
    position: 'absolute',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    backgroundColor: colors.raised,
    shadowColor: '#1c1917',
    shadowOpacity: 0.12,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
  },
  tagText: { fontFamily: fonts.bodySemiBold, fontSize: 11, color: colors.inkSecondary },
  title: { fontFamily: fonts.bodySemiBold, fontSize: 13.5, color: colors.ink },
  sub: { fontFamily: fonts.body, fontSize: 11.5, color: colors.inkTertiary, marginTop: 1 },
  label: { fontFamily: fonts.wide, fontSize: 10, letterSpacing: 0.6, color: colors.ink },
  score: { fontFamily: fonts.display, fontSize: 15 },
  pct: { fontFamily: fonts.display, fontSize: 15 },
  pctBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10 },
  addBtn: { paddingHorizontal: 12, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  addText: { fontFamily: fonts.bodyBold, fontSize: 12, color: '#ffffff' },
  big: { fontFamily: fonts.displayBlack, fontSize: 46, lineHeight: 54, marginTop: 6 },
  track: { height: 5, borderRadius: 3, marginTop: 7, overflow: 'hidden' },
  iconBtn: { width: 32, height: 32, borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, alignItems: 'center', justifyContent: 'center' },
  day: { fontFamily: fonts.bodyMedium, fontSize: 8.5, color: colors.inkTertiary, position: 'absolute', top: 2, left: 4 },
  pill: { height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  // The light-to-dark sweep's bar: a soft white rule with a glow.
  sweepBar: {
    position: 'absolute', right: -2, top: 0, bottom: 0, width: 4, borderRadius: 2,
    backgroundColor: '#ffffff', shadowColor: '#ffffff', shadowOpacity: 0.9, shadowRadius: 10, shadowOffset: { width: 0, height: 0 },
  },
  pillText: { fontFamily: fonts.bodyBold, fontSize: 12.5, color: '#ffffff' },
})
