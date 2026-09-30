// The five small scenes on the first-run tutorial, one per card.
//
// Each is a miniature of the real screen it describes rather than an icon, so
// the first time a new user meets the rating flow or their catalog it already
// looks familiar. None of them read real data: the scores and names are fixed,
// and the only thing fetched is the same album-art strip the welcome screen
// shows, so the covers are real records rather than grey squares.
//
// A scene animates only while its card is on screen (`active`). The tutorial
// remounts a scene each time its card comes back into view, so every effect
// here starts from fresh state and none of them has to reset anything. Under
// Reduce Motion every scene renders its finished state and never moves.
import { useEffect, useState } from 'react'
import { AccessibilityInfo, Animated, Easing, StyleSheet, Text, View } from 'react-native'
import Svg, { Circle } from 'react-native-svg'
import { Image } from 'expo-image'
import { useQuery } from '@tanstack/react-query'
import { ArrowRight, ArrowUp, MessageCircle } from 'lucide-react-native'
import { avatarColor } from '@pressd/shared/types'
import { fetchArtStrip } from '../lib/api'
import { colors, fonts, radii, spacing, songScoreColor, NUM_SCALE_CAP } from '../theme/tokens'

type SceneProps = { active: boolean }

function useReduceMotion(): boolean {
  const [reduce, setReduce] = useState(false)
  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduce).catch(() => {})
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduce)
    return () => sub.remove()
  }, [])
  return reduce
}

/** Cover art from the welcome screen's strip — same query key, so the welcome
 *  screen that follows opens with its belts already loaded. */
function useArt(): string[] {
  const { data = [] } = useQuery({ queryKey: ['art-strip'], queryFn: fetchArtStrip })
  return data
}

function Cover({ uri, size, seed }: { uri?: string; size: number; seed: string }) {
  if (uri) {
    return <Image source={{ uri }} style={{ width: size, height: size, borderRadius: radii.sm }} contentFit="cover" />
  }
  return (
    <View style={{ width: size, height: size, borderRadius: radii.sm, backgroundColor: avatarColor(seed), opacity: 0.55 }} />
  )
}

function wait(ms: number) {
  return Animated.delay(ms)
}

// ── 1. Front to back ────────────────────────────────────────────────────────
// A miniature of rate/[id]'s track phase, keystroke for keystroke: the score is
// typed a character at a time, the dot on the ramp follows it, Next track is
// pressed, and the next song slides in while the one after it stays locked.

const TRACKS = [
  { title: 'Morning Light', time: '3:12', score: '8.4' },
  { title: 'Sundays', time: '4:05', score: '9.1' },
  { title: 'Glass House', time: '2:48', score: '7.6' },
  { title: 'Closer', time: '5:21', score: '8.8' },
]
const LAST = TRACKS.length - 1

export function FrontToBackScene({ active }: SceneProps) {
  const reduce = useReduceMotion()
  const [idx, setIdx] = useState(0) // the track on screen
  const [rated, setRated] = useState(0) // how many are scored
  const [typed, setTyped] = useState('') // what's in the score field
  const [slide] = useState(() => new Animated.Value(1)) // 0 entering, 1 settled, 2 leaving
  const [press] = useState(() => new Animated.Value(1))
  const [rampW, setRampW] = useState(0)
  const [dotX] = useState(() => new Animated.Value(0))

  // Reduce Motion holds a representative moment: one song rated, the second typed.
  const at = reduce ? 1 : idx
  const done = reduce ? 1 : rated
  const field = reduce ? TRACKS[1].score : typed
  const value = field === '' ? null : parseFloat(field)

  useEffect(() => {
    if (rampW === 0 || value == null) return
    Animated.spring(dotX, { toValue: (value / 10) * rampW, friction: 9, tension: 90, useNativeDriver: true }).start()
  }, [value, rampW, dotX])

  useEffect(() => {
    if (!active || reduce) return
    let cancelled = false
    const timers = new Set<ReturnType<typeof setTimeout>>()
    const sleep = (ms: number) =>
      new Promise<void>((resolve) => {
        const t = setTimeout(() => {
          timers.delete(t)
          resolve()
        }, ms)
        timers.add(t)
      })
    const play = (a: Animated.CompositeAnimation) => new Promise<void>((resolve) => a.start(() => resolve()))
    const ease = (v: Animated.Value, to: number, duration: number) =>
      Animated.timing(v, { toValue: to, duration, easing: Easing.out(Easing.cubic), useNativeDriver: true })

    ;(async () => {
      await sleep(400)
      while (!cancelled) {
        for (let s = 0; s <= LAST; s++) {
          if (cancelled) return
          setIdx(s)
          setTyped('')
          slide.setValue(0)
          await play(ease(slide, 1, 280))
          await sleep(450)
          const score = TRACKS[s].score
          for (let k = 1; k <= score.length; k++) {
            if (cancelled) return
            setTyped(score.slice(0, k))
            await sleep(240)
          }
          await sleep(450)
          await play(Animated.sequence([ease(press, 0.6, 90), ease(press, 1, 160)]))
          if (cancelled) return
          setRated(s + 1)
          if (s < LAST) await play(ease(slide, 2, 220))
        }
        // Hold on the finished record, then start it over.
        await sleep(1700)
        await play(ease(slide, 2, 220))
        if (cancelled) return
        setRated(0)
      }
    })()

    return () => {
      cancelled = true
      timers.forEach(clearTimeout)
      slide.stopAnimation()
      press.stopAnimation()
    }
  }, [active, reduce, slide, press])

  const t = TRACKS[at]
  const scores = TRACKS.slice(0, done).map((x) => parseFloat(x.score))
  const avg = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null
  const upNext = at < LAST ? { num: String(at + 2), title: TRACKS[at + 1].title, note: 'locked' } : { num: '', title: 'The album', note: 'next' }

  return (
    <View style={styles.stageInner}>
      <View style={styles.progressRow}>
        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${(done / TRACKS.length) * 100}%` }]} />
        </View>
        <Text style={styles.progressText} maxFontSizeMultiplier={NUM_SCALE_CAP}>{done} / {TRACKS.length}</Text>
      </View>

      <Animated.View
        style={{
          opacity: slide.interpolate({ inputRange: [0, 1, 2], outputRange: [0, 1, 0] }),
          transform: [{ translateX: slide.interpolate({ inputRange: [0, 1, 2], outputRange: [28, 0, -28] }) }],
        }}
      >
        <Text style={styles.rateEyebrow}>TRACK {at + 1}</Text>
        <Text style={styles.rateTitle} numberOfLines={1}>{t.title}</Text>
        <Text style={styles.rateMeta}>{t.time}</Text>
        <Text
          style={[styles.rateScore, { color: value != null ? songScoreColor(value) : colors.inkMuted }]}
          maxFontSizeMultiplier={NUM_SCALE_CAP}
        >
          {field || '—'}
        </Text>
        <Text style={styles.rateScoreLabel}>YOUR SCORE</Text>
      </Animated.View>

      <View style={styles.ramp} onLayout={(e) => setRampW(e.nativeEvent.layout.width)}>
        {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => (
          <View key={i} style={{ flex: 1, backgroundColor: songScoreColor(i + 0.5) }} />
        ))}
        <Animated.View style={[styles.rampDot, { opacity: value == null ? 0 : 1, transform: [{ translateX: dotX }] }]} />
      </View>

      <Animated.View style={[styles.rateNext, { opacity: press }]}>
        <Text style={styles.rateNextText}>{at < LAST ? 'Next track' : 'Rate the album'}</Text>
        <ArrowRight size={14} color="#fff" />
      </Animated.View>

      <View style={styles.runCard}>
        <View style={styles.runTop}>
          <Text style={styles.runLabel}>RUNNING AVG</Text>
          <Text style={styles.runValue} maxFontSizeMultiplier={NUM_SCALE_CAP}>{avg != null ? avg.toFixed(2) : '—'}</Text>
        </View>
        <View style={styles.chipRow}>
          {TRACKS.map((x, i) => (
            <View
              key={x.title}
              style={[
                styles.chip,
                { backgroundColor: i < done ? songScoreColor(parseFloat(x.score)) : colors.inset },
                i === at && i >= done && styles.chipCurrent,
              ]}
            />
          ))}
        </View>
      </View>

      <View style={styles.upRow}>
        <Text style={styles.upNum} maxFontSizeMultiplier={NUM_SCALE_CAP}>{upNext.num}</Text>
        <Text style={styles.upTitle} numberOfLines={1}>{upNext.title}</Text>
        <Text style={styles.upLocked}>{upNext.note}</Text>
      </View>
    </View>
  )
}

// ── 2. Then the record ──────────────────────────────────────────────────────
// A miniature of rate/[id]'s factors phase. The four factors are typed in turn,
// and once the last one lands the album score appears the way the album page
// shows it — a Playfair numeral, counting up from the song average it started
// at. Card 1's four songs average 8.48, so the two cards read as one album.

const FACTOR_DEMO = [
  { label: 'Theme / Cohesion', desc: 'Strength and cohesion of the central idea', value: '8.5' },
  { label: 'Replay Value', desc: 'How replayable the album is', value: '9.0' },
  { label: 'Production', desc: 'Sound quality, mixing, sonic palette', value: '7.5' },
  { label: 'Distinctness', desc: 'Originality and genre-bending', value: '8.0' },
]
const SONG_AVG = 8.48
const ALBUM_SCORE = 8.72

export function TheRecordScene({ active }: SceneProps) {
  const reduce = useReduceMotion()
  const [typed, setTyped] = useState<string[]>(() => FACTOR_DEMO.map(() => ''))
  const [typing, setTyping] = useState(-1) // the factor being typed into
  const [score] = useState(() => new Animated.Value(SONG_AVG))
  const [reveal] = useState(() => new Animated.Value(0))
  const [scoreText, setScoreText] = useState(SONG_AVG.toFixed(2))

  useEffect(() => {
    const id = score.addListener(({ value }) => setScoreText(value.toFixed(2)))
    return () => score.removeListener(id)
  }, [score])

  useEffect(() => {
    if (!active) return
    if (reduce) {
      score.setValue(ALBUM_SCORE)
      reveal.setValue(1)
      return
    }
    let cancelled = false
    const timers = new Set<ReturnType<typeof setTimeout>>()
    const sleep = (ms: number) =>
      new Promise<void>((resolve) => {
        const t = setTimeout(() => {
          timers.delete(t)
          resolve()
        }, ms)
        timers.add(t)
      })
    const play = (a: Animated.CompositeAnimation) => new Promise<void>((resolve) => a.start(() => resolve()))

    ;(async () => {
      await sleep(400)
      while (!cancelled) {
        for (let f = 0; f < FACTOR_DEMO.length; f++) {
          if (cancelled) return
          setTyping(f)
          await sleep(300)
          const v = FACTOR_DEMO[f].value
          for (let k = 1; k <= v.length; k++) {
            if (cancelled) return
            setTyped((prev) => prev.map((x, i) => (i === f ? v.slice(0, k) : x)))
            await sleep(200)
          }
        }
        if (cancelled) return
        setTyping(-1)
        await sleep(250)
        score.setValue(SONG_AVG)
        await play(
          Animated.parallel([
            Animated.timing(reveal, { toValue: 1, duration: 250, useNativeDriver: false }),
            Animated.timing(score, {
              toValue: ALBUM_SCORE,
              duration: 1100,
              easing: Easing.out(Easing.cubic),
              useNativeDriver: false, // read back through a listener
            }),
          ]),
        )
        await sleep(2400)
        await play(Animated.timing(reveal, { toValue: 0, duration: 250, useNativeDriver: false }))
        if (cancelled) return
        setTyped(FACTOR_DEMO.map(() => ''))
      }
    })()

    return () => {
      cancelled = true
      timers.forEach(clearTimeout)
      score.stopAnimation()
      reveal.stopAnimation()
    }
  }, [active, reduce, score, reveal])

  const values = reduce ? FACTOR_DEMO.map((f) => f.value) : typed

  return (
    <View style={styles.stageInner}>
      <Text style={styles.rateEyebrow}>THE ALBUM</Text>
      <Text style={styles.rateTitle} numberOfLines={1}>Late Summer</Text>
      <Text style={styles.rateMeta}>4 tracks scored · avg {SONG_AVG.toFixed(2)}</Text>

      <View style={styles.factorList}>
        {FACTOR_DEMO.map((f, i) => (
          <View key={f.label} style={[styles.factorRow, i === FACTOR_DEMO.length - 1 && styles.factorRowLast]}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={styles.factorLabel} numberOfLines={1}>{f.label}</Text>
              <Text style={styles.factorDesc} numberOfLines={1}>{f.desc}</Text>
            </View>
            <View style={[styles.factorInput, typing === i && styles.factorInputActive]}>
              <Text
                style={[styles.factorValue, !values[i] && { color: colors.inkMuted }]}
                maxFontSizeMultiplier={NUM_SCALE_CAP}
              >
                {values[i] || '—'}
              </Text>
            </View>
          </View>
        ))}
      </View>

      <Animated.View style={[styles.finalBlock, { opacity: reveal }]}>
        <Text style={styles.finalScore} maxFontSizeMultiplier={NUM_SCALE_CAP}>
          {reduce ? ALBUM_SCORE.toFixed(2) : scoreText}
        </Text>
        <Text style={styles.finalLabel}>FINAL SCORE</Text>
      </Animated.View>
    </View>
  )
}

// ── 3. Your catalog ─────────────────────────────────────────────────────────

const SHELVES = ['To Listen', 'Listening', 'Rated'] as const
const TILE = 54

export function YourCatalogScene({ active }: SceneProps) {
  const reduce = useReduceMotion()
  const art = useArt()
  const [width, setWidth] = useState(0)
  const col = width / SHELVES.length
  const home = (i: number) => col * i + (col - TILE) / 2

  const [moveX] = useState(() => new Animated.Value(0)) // shelf index, 0–2
  const [chip] = useState(() => new Animated.Value(0))
  const [recIn] = useState(() => new Animated.Value(0))

  useEffect(() => {
    if (!active || width === 0) return
    if (reduce) {
      moveX.setValue(2)
      chip.setValue(1)
      recIn.setValue(1)
      return
    }
    const step = (v: Animated.Value, to: number, duration: number) =>
      Animated.timing(v, { toValue: to, duration, easing: Easing.inOut(Easing.cubic), useNativeDriver: true })
    const anim = Animated.loop(
      Animated.sequence([
        Animated.parallel([step(moveX, 0, 0), step(chip, 0, 0), step(recIn, 0, 0)]),
        wait(700),
        step(moveX, 1, 650),
        wait(750),
        step(moveX, 2, 650),
        step(chip, 1, 250),
        wait(450),
        step(recIn, 1, 500),
        wait(2200),
      ]),
    )
    anim.start()
    return () => anim.stop()
  }, [active, reduce, width, moveX, chip, recIn])

  return (
    <View style={styles.stageInner} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
      <View style={styles.shelves}>
        {SHELVES.map((s) => (
          <View key={s} style={styles.shelf}>
            <Text style={styles.shelfLabel} numberOfLines={1}>{s.toUpperCase()}</Text>
          </View>
        ))}
      </View>
      {width > 0 && (
        <>
          <Animated.View
            style={[
              styles.tile,
              { transform: [{ translateX: moveX.interpolate({ inputRange: [0, 2], outputRange: [home(0), home(2)] }) }] },
            ]}
          >
            <Cover uri={art[0]} size={TILE} seed="a" />
            <Animated.View style={[styles.tileChip, { opacity: chip }]}>
              <Text style={styles.tileChipText} maxFontSizeMultiplier={NUM_SCALE_CAP}>{ALBUM_SCORE.toFixed(2)}</Text>
            </Animated.View>
          </Animated.View>

          {/* The recommendation takes the slot the first record left. */}
          <Animated.View
            style={[
              styles.tile,
              {
                opacity: recIn,
                transform: [
                  { translateX: home(0) },
                  { translateY: recIn.interpolate({ inputRange: [0, 1], outputRange: [-14, 0] }) },
                ],
              },
            ]}
          >
            <Cover uri={art[1]} size={TILE} seed="b" />
          </Animated.View>
          <Animated.View
            style={[styles.recPill, { width: col - spacing.sm, left: spacing.xs, opacity: recIn }]}
          >
            <Text style={styles.recPillText} numberOfLines={1}>from Sam</Text>
          </Animated.View>
        </>
      )}
    </View>
  )
}

// ── 4. Better with friends ──────────────────────────────────────────────────

function Avatar({ name }: { name: string }) {
  return (
    <View style={[styles.avatar, { backgroundColor: avatarColor(name) }]}>
      <Text style={styles.avatarText} maxFontSizeMultiplier={NUM_SCALE_CAP}>{name[0]}</Text>
    </View>
  )
}

export function FriendsScene({ active }: SceneProps) {
  const reduce = useReduceMotion()
  const art = useArt()
  const [rows] = useState(() => [0, 1, 2].map(() => new Animated.Value(0)))

  useEffect(() => {
    if (!active) return
    if (reduce) {
      rows.forEach((r) => r.setValue(1))
      return
    }
    const anim = Animated.stagger(
      420,
      rows.map((r) =>
        Animated.timing(r, { toValue: 1, duration: 420, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      ),
    )
    anim.start()
    return () => anim.stop()
  }, [active, reduce, rows])

  const rise = (v: Animated.Value) => ({
    opacity: v,
    transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }) }],
  })

  return (
    <View style={[styles.stageInner, { gap: spacing.sm }]}>
      <Animated.View style={[styles.feedRow, rise(rows[0])]}>
        <Avatar name="Maya" />
        <Text style={styles.feedText} numberOfLines={1}>
          <Text style={styles.feedName}>Maya</Text> rated an album
        </Text>
        <Cover uri={art[2]} size={34} seed="c" />
        <View style={[styles.scoreChip, { backgroundColor: songScoreColor(9.12) }]}>
          <Text style={styles.scoreChipText} maxFontSizeMultiplier={NUM_SCALE_CAP}>9.12</Text>
        </View>
      </Animated.View>

      <Animated.View style={[styles.feedRow, rise(rows[1])]}>
        <Avatar name="Sam" />
        <View style={styles.bubble}>
          <Text style={styles.bubbleText} numberOfLines={2}>The closer makes the whole record.</Text>
        </View>
        <View style={styles.replies}>
          <MessageCircle size={13} color={colors.inkMuted} />
          <Text style={styles.repliesText} maxFontSizeMultiplier={NUM_SCALE_CAP}>12</Text>
        </View>
      </Animated.View>

      <Animated.View style={[styles.feedRow, rise(rows[2])]}>
        <Text style={styles.rank} maxFontSizeMultiplier={NUM_SCALE_CAP}>#3</Text>
        <View style={styles.move}>
          <ArrowUp size={12} color={colors.green} strokeWidth={2.6} />
          <Text style={styles.moveText} maxFontSizeMultiplier={NUM_SCALE_CAP}>2</Text>
        </View>
        <Cover uri={art[3]} size={34} seed="d" />
        <Text style={styles.feedText} numberOfLines={1}>Charts this week</Text>
      </Animated.View>
    </View>
  )
}

// ── 5. It learns you ────────────────────────────────────────────────────────

const RING = 92
const RING_STROKE = 9
const AnimatedCircle = Animated.createAnimatedComponent(Circle)
// Album scores, so two decimals like every final album score in the app.
const PREDICTED = [8.94, 8.13, 9.31]

export function LearnsYouScene({ active }: SceneProps) {
  const reduce = useReduceMotion()
  const art = useArt()
  const [progress] = useState(() => new Animated.Value(0)) // albums rated, 0–10
  const [chips] = useState(() => PREDICTED.map(() => new Animated.Value(0)))
  const [count, setCount] = useState(0)

  useEffect(() => {
    const id = progress.addListener(({ value }) => setCount(Math.floor(value)))
    return () => progress.removeListener(id)
  }, [progress])

  useEffect(() => {
    if (!active) return
    if (reduce) {
      progress.setValue(10)
      chips.forEach((c) => c.setValue(1))
      return
    }
    const anim = Animated.sequence([
      wait(250),
      Animated.timing(progress, { toValue: 10, duration: 1600, easing: Easing.inOut(Easing.quad), useNativeDriver: false }),
      Animated.stagger(
        140,
        chips.map((c) => Animated.spring(c, { toValue: 1, friction: 6, tension: 90, useNativeDriver: false })),
      ),
    ])
    anim.start()
    return () => anim.stop()
  }, [active, reduce, progress, chips])

  const r = (RING - RING_STROKE) / 2
  const circumference = 2 * Math.PI * r

  return (
    <View style={[styles.stageInner, styles.learns]}>
      <View style={styles.ringRow}>
        <View style={{ width: RING, height: RING }}>
          <Svg width={RING} height={RING}>
            <Circle cx={RING / 2} cy={RING / 2} r={r} stroke={colors.inset} strokeWidth={RING_STROKE} fill="none" />
            <AnimatedCircle
              cx={RING / 2}
              cy={RING / 2}
              r={r}
              stroke={colors.green}
              strokeWidth={RING_STROKE}
              fill="none"
              strokeDasharray={`${circumference} ${circumference}`}
              strokeDashoffset={progress.interpolate({ inputRange: [0, 10], outputRange: [circumference, 0] }) as unknown as number}
              strokeLinecap="round"
              transform={`rotate(-90 ${RING / 2} ${RING / 2})`}
            />
          </Svg>
          <View style={styles.ringCenter} pointerEvents="none">
            <Text style={styles.ringCount} maxFontSizeMultiplier={NUM_SCALE_CAP}>{count}</Text>
            <Text style={styles.ringOf} maxFontSizeMultiplier={NUM_SCALE_CAP}>of 10</Text>
          </View>
        </View>
        <Text style={styles.ringCaption}>albums rated</Text>
      </View>

      <View style={styles.predRow}>
        {PREDICTED.map((p, i) => (
          <View key={i} style={styles.predTile}>
            <Cover uri={art[4 + i]} size={64} seed={`p${i}`} />
            <Animated.View
              style={[
                styles.predChip,
                { opacity: chips[i], transform: [{ scale: chips[i].interpolate({ inputRange: [0, 1], outputRange: [0.6, 1] }) }] },
              ]}
            >
              <Text style={styles.predChipText} maxFontSizeMultiplier={NUM_SCALE_CAP}>{p.toFixed(2)}</Text>
            </Animated.View>
          </View>
        ))}
      </View>
      <Text style={styles.predLabel}>PREDICTED FOR YOU</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  stageInner: { width: '100%' },

  // 1 — rate/[id]'s track phase at roughly two-thirds scale
  progressRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  progressTrack: { flex: 1, height: 5, borderRadius: 3, backgroundColor: colors.inset, overflow: 'hidden' },
  progressFill: { height: '100%', backgroundColor: colors.green, borderRadius: 3 },
  progressText: { fontFamily: fonts.bodyMedium, fontSize: 11, color: colors.inkTertiary },
  rateEyebrow: {
    fontFamily: fonts.bodyBold,
    fontSize: 9.5,
    letterSpacing: 1.4,
    color: colors.inkSecondary,
    textAlign: 'center',
    marginTop: spacing.md,
  },
  rateTitle: { fontFamily: fonts.displayBlack, fontSize: 24, color: colors.ink, textAlign: 'center', marginTop: 2 },
  rateMeta: { fontFamily: fonts.bodyMedium, fontSize: 11.5, color: colors.inkTertiary, textAlign: 'center', marginTop: 2 },
  rateScore: { fontFamily: fonts.display, fontSize: 50, lineHeight: 58, textAlign: 'center', marginTop: spacing.xs },
  rateScoreLabel: {
    fontFamily: fonts.bodyBold,
    fontSize: 9.5,
    letterSpacing: 1.4,
    color: colors.inkMuted,
    textAlign: 'center',
  },
  ramp: { flexDirection: 'row', height: 5, borderRadius: 3, marginTop: spacing.md },
  rampDot: {
    position: 'absolute',
    top: -4,
    left: 0,
    marginLeft: -6.5,
    width: 13,
    height: 13,
    borderRadius: 7,
    backgroundColor: '#fff',
    borderWidth: 2,
    borderColor: colors.green,
  },
  rateNext: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: colors.green,
    borderRadius: radii.md,
    paddingVertical: 10,
    marginTop: spacing.lg,
  },
  rateNextText: { fontFamily: fonts.bodySemiBold, fontSize: 13.5, color: '#fff' },
  runCard: { backgroundColor: 'rgba(45,106,79,0.07)', borderRadius: radii.md, padding: spacing.md, marginTop: spacing.md },
  runTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  runLabel: { fontFamily: fonts.bodyBold, fontSize: 9.5, letterSpacing: 1, color: colors.green },
  runValue: { fontFamily: fonts.display, fontSize: 20, color: colors.green },
  chipRow: { flexDirection: 'row', gap: 4, marginTop: spacing.sm },
  chip: { flex: 1, height: 18, borderRadius: 4 },
  chipCurrent: { borderWidth: 1.5, borderColor: colors.ink },
  upRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingTop: spacing.md },
  upNum: { width: 14, fontFamily: fonts.body, fontSize: 11, color: colors.inkMuted },
  upTitle: { flex: 1, fontFamily: fonts.bodyMedium, fontSize: 13, color: colors.inkTertiary },
  upLocked: { fontFamily: fonts.body, fontSize: 11, color: colors.inkMuted },

  // 2 — rate/[id]'s factors phase, same scale as 1
  factorList: { marginTop: spacing.sm },
  factorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  factorRowLast: { borderBottomWidth: 0 },
  factorLabel: { fontFamily: fonts.bodySemiBold, fontSize: 13, color: colors.ink },
  factorDesc: { fontFamily: fonts.body, fontSize: 10.5, color: colors.inkTertiary, marginTop: 1 },
  factorInput: {
    width: 54,
    alignItems: 'center',
    paddingVertical: 3,
    backgroundColor: colors.raised,
    borderRadius: radii.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  factorInputActive: { borderColor: colors.green },
  factorValue: { fontFamily: fonts.display, fontSize: 19, color: colors.ink },
  finalBlock: { alignItems: 'center', marginTop: spacing.sm },
  finalScore: { fontFamily: fonts.display, fontSize: 46, lineHeight: 54, color: colors.green },
  finalLabel: { fontFamily: fonts.bodyBold, fontSize: 9.5, letterSpacing: 1.4, color: colors.green },

  // 3
  shelves: { flexDirection: 'row', gap: spacing.sm, height: 150 },
  shelf: {
    flex: 1,
    backgroundColor: colors.bg,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    paddingTop: spacing.sm,
  },
  shelfLabel: { fontFamily: fonts.bodyBold, fontSize: 9.5, letterSpacing: 0.8, color: colors.inkMuted },
  tile: { position: 'absolute', top: 40, left: 0 },
  tileChip: {
    position: 'absolute',
    right: -6,
    bottom: -6,
    backgroundColor: colors.scoreChipBg,
    borderRadius: radii.pill,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  tileChipText: { fontFamily: fonts.bodyBold, fontSize: 11, color: colors.scoreChipText },
  recPill: {
    position: 'absolute',
    top: 40 + TILE + spacing.sm,
    alignItems: 'center',
  },
  recPillText: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 10.5,
    color: '#c2410c',
    backgroundColor: 'rgba(234, 88, 12, 0.10)',
    borderRadius: radii.pill,
    overflow: 'hidden',
    paddingHorizontal: 8,
    paddingVertical: 2,
  },

  // 4
  feedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.bg,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.sm,
    minHeight: 54,
  },
  avatar: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontFamily: fonts.bodyBold, fontSize: 13, color: '#fff' },
  feedText: { flex: 1, fontFamily: fonts.body, fontSize: 13.5, color: colors.inkSecondary },
  feedName: { fontFamily: fonts.bodySemiBold, color: colors.ink },
  scoreChip: { borderRadius: radii.pill, paddingHorizontal: 7, paddingVertical: 3 },
  scoreChipText: { fontFamily: fonts.bodyBold, fontSize: 12, color: '#fff' },
  bubble: {
    flex: 1,
    backgroundColor: colors.raised,
    borderRadius: radii.md,
    borderTopLeftRadius: 4,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
  },
  bubbleText: { fontFamily: fonts.body, fontSize: 13, color: colors.ink },
  replies: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  repliesText: { fontFamily: fonts.bodySemiBold, fontSize: 12, color: colors.inkMuted },
  rank: { width: 30, textAlign: 'center', fontFamily: fonts.bodyBold, fontSize: 15, color: colors.ink },
  move: { flexDirection: 'row', alignItems: 'center' },
  moveText: { fontFamily: fonts.bodyBold, fontSize: 12, color: colors.green },

  // 5
  learns: { alignItems: 'center' },
  ringRow: { alignItems: 'center', gap: spacing.xs },
  ringCenter: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center' },
  ringCount: { fontFamily: fonts.bodyBold, fontSize: 24, lineHeight: 28, color: colors.ink },
  ringOf: { fontFamily: fonts.body, fontSize: 11, color: colors.inkMuted },
  ringCaption: { fontFamily: fonts.bodyMedium, fontSize: 12.5, color: colors.inkTertiary },
  predRow: { flexDirection: 'row', gap: spacing.lg, marginTop: spacing.xl },
  predTile: { alignItems: 'center' },
  predChip: {
    position: 'absolute',
    right: -8,
    bottom: -8,
    backgroundColor: colors.green,
    borderRadius: radii.pill,
    borderWidth: 2,
    borderColor: colors.raised,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  predChipText: { fontFamily: fonts.bodyBold, fontSize: 12, color: '#fff' },
  predLabel: {
    marginTop: spacing.lg,
    fontFamily: fonts.bodyBold,
    fontSize: 10,
    letterSpacing: 1.2,
    color: colors.green,
  },
})
