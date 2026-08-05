// The shareable album card — a native port of the web ShareCard, laid out to
// the same 1080×1350 proportions so both surfaces produce the same image.
//
// Every measurement below is the desktop card's pixel value passed through
// `u()`, which scales the 1080-wide design down to whatever width the phone
// gives us. Keeping the original numbers means the two cards stay in sync by
// construction: change one, port the same number here.
//
// Reached two ways — automatically after submitting a rating, and from the
// Share control on any finished album — so it takes the album to render rather
// than assuming it belongs to the viewer. Rank and distribution are computed
// against *that album's owner*, since "ranked #4 of 412" is a claim about the
// person who rated it, not whoever is looking.
import { useMemo, useRef, useState } from 'react'
import { ActivityIndicator, Dimensions, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Image } from 'expo-image'
import { LinearGradient } from 'expo-linear-gradient'
import Svg, { Defs, Image as SvgImage, Mask, RadialGradient, Rect, Stop } from 'react-native-svg'
import { useQuery } from '@tanstack/react-query'
import { captureRef } from 'react-native-view-shot'
import * as Sharing from 'expo-sharing'
import { Share2, Star, X } from 'lucide-react-native'
import {
  songScoreColor,
  BANG_THRESHOLD,
  SKIP_THRESHOLD,
  EP_MAX_TRACKS,
  type Album,
} from '@pressd/shared/types'
import { fetchAlbums, fetchAlbumColor } from '../lib/api'
import { colors, fonts } from '../theme/tokens'

// The web card's palette, kept as literals rather than tokens — this is a
// fixed-composition image, not a themed screen, and it must not drift.
const INK = '#1c1917'
const GREEN = '#2d6a4f'
const CORAL = '#b0402f'
const WARM = '#8a7f72'
const WARM2 = '#a8998a'
const FAINT = '#c2b8ad'
const CREAM = '#faf8f5'
const HAIRLINE = '#e6ded2'

const DESIGN_W = 1080
const DESIGN_H = 1350
const DIST_BINS = 22

const SCREEN_W = Dimensions.get('window').width
// Fits the phone with a margin, capped so it doesn't balloon on a tablet.
const CARD_W = Math.min(SCREEN_W - 32, 420)
const CARD_H = CARD_W * (DESIGN_H / DESIGN_W)
/** Desktop pixels → this card's scale. */
const u = (px: number) => (px * CARD_W) / DESIGN_W

function hueOf(hsl: string | null | undefined): number | null {
  const m = hsl?.match(/hsl\((\d+)/)
  return m ? Number(m[1]) : null
}

export default function ShareCard({ album, onClose }: { album: Album; onClose: () => void }) {
  const cardRef = useRef<View>(null)
  const [sharing, setSharing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const { data: color } = useQuery({
    queryKey: ['album-color', album.albumName, album.artist],
    queryFn: () => fetchAlbumColor(album.albumName, album.artist),
    staleTime: Infinity,
  })
  const hue = hueOf(color?.color)

  // The owner's library, not the viewer's — see the note at the top.
  const ownerId = album.userId ?? undefined
  const { data: ratedAlbums = [] } = useQuery({
    queryKey: ['albums', 'rated', ownerId],
    queryFn: () => fetchAlbums({ status: 'rated', userId: ownerId }),
    enabled: ownerId != null,
  })

  const stats = useMemo(() => {
    const rated = album.songs.filter((s) => s.score !== null)
    const bangs = rated.filter((s) => s.score! >= BANG_THRESHOLD)
    const skips = rated.filter((s) => s.score! < SKIP_THRESHOLD)
    const mids = rated.length - bangs.length - skips.length
    const pct = (n: number) => (rated.length ? Math.round((n / rated.length) * 100) : 0)
    const byScore = [...rated].sort((a, b) => b.score! - a.score!)

    const scores = ratedAlbums.map((a) => a.score).filter((s): s is number => s !== null)
    const total = scores.length || 1
    const rank = album.score !== null ? 1 + scores.filter((s) => s > album.score!).length : total
    const bins = Array.from({ length: DIST_BINS }, () => 0)
    for (const s of scores) {
      bins[Math.min(DIST_BINS - 1, Math.max(0, Math.round(((s - 1) / 9) * (DIST_BINS - 1))))] += 1
    }

    return {
      ratedCount: rated.length,
      bangCount: bangs.length,
      skipCount: skips.length,
      midCount: mids,
      bangPct: pct(bangs.length),
      skipPct: pct(skips.length),
      midPct: pct(mids),
      favorite: byScore[0] ?? null,
      least: byScore.length > 1 ? byScore[byScore.length - 1] : null,
      rank,
      total,
      tercile: rank <= total / 3 ? 'top' : rank <= (2 * total) / 3 ? 'middle' : 'bottom',
      noSkips: rated.length > 0 && skips.length === 0,
      bins,
      maxBin: Math.max(1, ...bins),
      markerBin:
        album.score !== null
          ? Math.min(DIST_BINS - 1, Math.max(0, Math.round(((album.score - 1) / 9) * (DIST_BINS - 1))))
          : -1,
    }
  }, [album, ratedAlbums])

  const isLP = album.songs.length > EP_MAX_TRACKS
  const factors = [
    { label: 'Theme', value: album.theme },
    { label: 'Replay', value: album.replayValue },
    { label: 'Production', value: album.production },
    { label: 'Distinct', value: album.distinctness },
  ]
  const showFactors = isLP && factors.some((f) => f.value !== null)
  const scoreColor = album.score !== null ? songScoreColor(album.score) : GREEN
  const dateStr = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

  const tercileLabel =
    stats.tercile === 'top'
      ? 'Top third of ratings'
      : stats.tercile === 'middle'
        ? 'Middle of ratings'
        : 'Bottom third of ratings'

  const pageGradient: [string, string, string] =
    hue == null
      ? ['#f3efe8', CREAM, CREAM]
      : [`hsl(${hue}, 42%, 86%)`, `hsl(${hue}, 30%, 92%)`, CREAM]

  async function share() {
    if (sharing) return
    setSharing(true)
    setError(null)
    try {
      const uri = await captureRef(cardRef, { format: 'png', quality: 1 })
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, { mimeType: 'image/png', dialogTitle: album.albumName })
      } else {
        setError('Sharing is not available on this device.')
      }
    } catch {
      setError('Could not render the card. Please try again.')
    } finally {
      setSharing(false)
    }
  }

  const art = album.albumArtUrl

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Share card</Text>
        <Pressable onPress={onClose} hitSlop={12} accessibilityLabel="Close">
          <X size={22} color={colors.inkTertiary} />
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* Captured region — everything inside becomes the shared PNG. */}
        <View ref={cardRef} collapsable={false} style={styles.card}>
          <LinearGradient
            colors={pageGradient}
            locations={[0, 0.32, 0.68]}
            start={{ x: 0, y: 0 }}
            end={{ x: 0.36, y: 1 }}
            style={StyleSheet.absoluteFill}
          />

          {/* The cover, blurred and bled off the top-right, masked to true
              transparency so no square edge can show against the wash. Same
              technique as the album page's backdrop. */}
          {art && (
            <Svg width={u(1320)} height={u(1560)} style={{ position: 'absolute', top: u(-120), right: u(-140) }}>
              <Defs>
                <RadialGradient id="shareFade" gradientUnits="userSpaceOnUse" cx={u(1320)} cy={0} r={u(1000)}>
                  <Stop offset="0" stopColor="#fff" stopOpacity={1} />
                  <Stop offset="0.46" stopColor="#fff" stopOpacity={0.5} />
                  <Stop offset="0.74" stopColor="#fff" stopOpacity={0} />
                </RadialGradient>
                <Mask id="shareMask" maskUnits="userSpaceOnUse" x={0} y={0} width={u(1320)} height={u(1560)}>
                  <Rect x={0} y={0} width={u(1320)} height={u(1560)} fill="url(#shareFade)" />
                </Mask>
              </Defs>
              <SvgImage
                href={{ uri: art }}
                x={0}
                y={0}
                width={u(1320)}
                height={u(1560)}
                preserveAspectRatio="xMidYMid slice"
                opacity={0.2}
                mask="url(#shareMask)"
              />
            </Svg>
          )}

          <View style={styles.inner}>
            {/* header */}
            <View style={styles.row}>
              <View style={styles.brandRow}>
                <Image source={require('../assets/icon.png')} style={styles.logo} contentFit="contain" />
                <Text style={styles.brand}>Press’d</Text>
              </View>
              <Text style={styles.date}>{dateStr}</Text>
            </View>

            {/* album */}
            <View style={styles.albumRow}>
              {art ? (
                <Image source={{ uri: art }} style={styles.art} contentFit="cover" />
              ) : (
                <View style={[styles.art, styles.artFallback]}>
                  <Text style={styles.artInitial}>{album.albumName[0]}</Text>
                </View>
              )}
              <View style={styles.albumText}>
                <Text style={styles.albumName} numberOfLines={2}>{album.albumName}</Text>
                <Text style={styles.artist} numberOfLines={1}>
                  {[album.artist, ...album.extraArtists].join(', ')}{album.year ? ` · ${album.year}` : ''}
                </Text>
                {album.genre && (
                  <View style={styles.genrePill}>
                    <Text style={styles.genrePillText}>{album.genre.toUpperCase()}</Text>
                  </View>
                )}
              </View>
            </View>

            {/* final score */}
            <View style={styles.scoreBlock}>
              <Text style={styles.scoreLabel}>FINAL SCORE</Text>
              <View style={styles.scoreLine}>
                <Text style={[styles.bigScore, { color: scoreColor }]}>
                  {album.score !== null ? album.score.toFixed(2) : '—'}
                </Text>
                <Text style={styles.outOf}> /10</Text>
              </View>
              <View style={styles.pills}>
                <Pill label={`Ranked #${stats.rank} of ${stats.total}`} />
                <Pill label={tercileLabel} tone={stats.tercile === 'top' ? 'green' : stats.tercile === 'bottom' ? 'coral' : 'neutral'} />
                {stats.noSkips && <Pill label="NO SKIPS" tone="solid" />}
              </View>
            </View>

            {/* distribution */}
            <View style={styles.section}>
              <View style={styles.bins}>
                {stats.bins.map((c, i) => (
                  <View
                    key={i}
                    style={{
                      flex: 1,
                      height: Math.max(u(8), (c / stats.maxBin) * u(64)),
                      borderRadius: u(4),
                      backgroundColor: i === stats.markerBin ? GREEN : 'rgba(120,100,80,0.18)',
                    }}
                  />
                ))}
              </View>
              <View style={styles.row}>
                <Text style={styles.caption}>SCORE DISTRIBUTION</Text>
                <Text style={styles.caption}>ALL RATED ALBUMS</Text>
              </View>
            </View>

            {/* bangs vs skips */}
            <View style={styles.section}>
              <View style={styles.vsRow}>
                <View style={[styles.vsCard, { backgroundColor: 'rgba(45,106,79,0.10)', borderColor: 'rgba(45,106,79,0.4)' }]}>
                  <Text style={[styles.vsPct, { color: GREEN }]}>{stats.bangPct}%</Text>
                  <Text style={styles.vsLabel}>BANGS</Text>
                  <Text style={styles.vsSub}>{stats.bangCount} {stats.bangCount === 1 ? 'song' : 'songs'} · 8.0+</Text>
                </View>
                <Text style={styles.vs}>vs</Text>
                <View style={[styles.vsCard, { backgroundColor: 'rgba(176,64,47,0.10)', borderColor: 'rgba(176,64,47,0.4)', alignItems: 'flex-end' }]}>
                  <Text style={[styles.vsPct, { color: CORAL }]}>{stats.skipPct}%</Text>
                  <Text style={styles.vsLabel}>SKIPS</Text>
                  <Text style={styles.vsSub}>{stats.skipCount} {stats.skipCount === 1 ? 'song' : 'songs'} · under 6.5</Text>
                </View>
              </View>
              <View style={styles.bar}>
                <View style={{ flex: Math.max(stats.bangPct, 0.001), backgroundColor: GREEN, borderRadius: u(99) }} />
                <View style={{ flex: Math.max(stats.midPct, 0.001), backgroundColor: 'rgba(120,100,80,0.2)', borderRadius: u(99) }} />
                <View style={{ flex: Math.max(stats.skipPct, 0.001), backgroundColor: CORAL, borderRadius: u(99) }} />
              </View>
              <View style={styles.row}>
                <Text style={styles.caption}>{stats.bangCount} {stats.bangCount === 1 ? 'BANG' : 'BANGS'}</Text>
                <Text style={styles.caption}>{stats.midCount} MIDS</Text>
                <Text style={styles.caption}>{stats.skipCount} {stats.skipCount === 1 ? 'SKIP' : 'SKIPS'}</Text>
              </View>
            </View>

            {/* favorite / least */}
            {stats.favorite && (
              <View style={styles.trackRow}>
                <View style={[styles.trackCard, { borderColor: 'rgba(45,106,79,0.3)' }]}>
                  <View style={styles.trackHead}>
                    <Star size={u(40)} color={GREEN} fill={GREEN} strokeWidth={0} />
                    <Text style={[styles.trackKind, { color: GREEN }]}>FAVORITE</Text>
                  </View>
                  <Text style={styles.trackName} numberOfLines={1}>{stats.favorite.title}</Text>
                  <Text style={[styles.trackScore, { color: songScoreColor(stats.favorite.score!) }]}>
                    {stats.favorite.score!.toFixed(1)}
                    <Text style={styles.trackOutOf}> /10</Text>
                  </Text>
                </View>
                {stats.least && (
                  <View style={[styles.trackCard, { borderColor: 'rgba(176,64,47,0.3)' }]}>
                    <View style={styles.trackHead}>
                      <Text style={{ fontSize: u(40), color: CORAL, lineHeight: u(46) }}>▽</Text>
                      <Text style={[styles.trackKind, { color: CORAL }]}>LEAST FAVORITE</Text>
                    </View>
                    <Text style={styles.trackName} numberOfLines={1}>{stats.least.title}</Text>
                    <Text style={[styles.trackScore, { color: songScoreColor(stats.least.score!) }]}>
                      {stats.least.score!.toFixed(1)}
                      <Text style={styles.trackOutOf}> /10</Text>
                    </Text>
                  </View>
                )}
              </View>
            )}

            {/* external factors — LPs only, same rule as the web card */}
            {showFactors && (
              <View style={styles.factorRow}>
                {factors.map((f) => (
                  <View key={f.label} style={styles.factorCell}>
                    <Text style={styles.factorValue}>{f.value !== null ? Math.round(f.value) : '—'}</Text>
                    <Text style={styles.factorLabel}>{f.label.toUpperCase()}</Text>
                  </View>
                ))}
              </View>
            )}

            <View style={{ flex: 1, minHeight: u(20) }} />

            {/* footer */}
            <View style={styles.footer}>
              <Text style={styles.footerText}>Rate your albums on</Text>
              <Image source={require('../assets/icon.png')} style={styles.footerLogo} contentFit="contain" />
              <Text style={styles.footerBrand}>Press’d</Text>
            </View>
          </View>
        </View>

        {error && <Text style={styles.error}>{error}</Text>}
      </ScrollView>

      {/* Share sits directly under the card, so what you're sending and the
          control that sends it read as one unit. */}
      <View style={styles.actions}>
        <Pressable
          style={({ pressed }) => [styles.shareBtn, pressed && { backgroundColor: colors.greenPressed }]}
          onPress={share}
          disabled={sharing}
          accessibilityLabel={`Share ${album.albumName}`}
        >
          {sharing ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <>
              <Share2 size={17} color="#fff" />
              <Text style={styles.shareBtnText}>Share</Text>
            </>
          )}
        </Pressable>
        <Pressable style={styles.doneBtn} onPress={onClose}>
          <Text style={styles.doneBtnText}>Done</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  )
}

function Pill({ label, tone = 'neutral' }: { label: string; tone?: 'neutral' | 'green' | 'coral' | 'solid' }) {
  const toneStyle =
    tone === 'green'
      ? { color: GREEN, backgroundColor: 'rgba(45,106,79,0.10)', borderColor: 'rgba(45,106,79,0.32)' }
      : tone === 'coral'
        ? { color: CORAL, backgroundColor: 'rgba(176,64,47,0.10)', borderColor: 'rgba(176,64,47,0.3)' }
        : tone === 'solid'
          ? { color: '#fff', backgroundColor: GREEN, borderColor: GREEN }
          : { color: '#4a423a', backgroundColor: 'rgba(255,255,255,0.6)', borderColor: HAIRLINE }
  return (
    <View style={[styles.pill, { backgroundColor: toneStyle.backgroundColor, borderColor: toneStyle.borderColor }]}>
      <Text style={[styles.pillText, { color: toneStyle.color }]}>{label}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  headerTitle: { fontFamily: fonts.bodySemiBold, fontSize: 16, color: colors.ink },
  scroll: { alignItems: 'center', paddingBottom: 16 },

  card: {
    width: CARD_W,
    minHeight: CARD_H,
    borderRadius: u(44),
    overflow: 'hidden',
    backgroundColor: CREAM,
  },
  inner: { flex: 1, paddingHorizontal: u(70), paddingTop: u(52), paddingBottom: u(44) },

  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: u(13) },
  logo: { width: u(44), height: u(44) },
  brand: { fontFamily: fonts.wordmark, fontSize: u(30), color: INK, letterSpacing: -0.5 },
  date: { fontFamily: fonts.bodySemiBold, fontSize: u(17), letterSpacing: u(2.4), color: WARM },

  albumRow: { flexDirection: 'row', alignItems: 'center', gap: u(26), marginTop: u(30) },
  art: { width: u(132), height: u(132), borderRadius: u(20), backgroundColor: '#ece6dc' },
  artFallback: { alignItems: 'center', justifyContent: 'center' },
  artInitial: { fontFamily: fonts.display, fontSize: u(48), color: WARM2 },
  albumText: { flex: 1, minWidth: 0 },
  albumName: { fontFamily: fonts.display, fontSize: u(54), lineHeight: u(58), color: INK },
  artist: { fontFamily: fonts.bodyMedium, fontSize: u(22), color: WARM, marginTop: u(11) },
  genrePill: {
    alignSelf: 'flex-start',
    marginTop: u(11),
    borderWidth: 1.5,
    borderColor: 'rgba(45,106,79,0.4)',
    borderRadius: u(99),
    paddingHorizontal: u(13),
    paddingVertical: u(5),
  },
  genrePillText: { fontFamily: fonts.bodyBold, fontSize: u(13), letterSpacing: u(2), color: GREEN },

  scoreBlock: { alignItems: 'center', marginTop: u(22) },
  scoreLabel: { fontFamily: fonts.bodyBold, fontSize: u(15), letterSpacing: u(4.5), color: WARM },
  scoreLine: { flexDirection: 'row', alignItems: 'baseline' },
  bigScore: { fontFamily: fonts.display, fontSize: u(148), lineHeight: u(150) },
  outOf: { fontFamily: fonts.bodySemiBold, fontSize: u(40), color: WARM2 },
  pills: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: u(12), marginTop: u(24) },
  pill: { borderWidth: 1, borderRadius: u(99), paddingHorizontal: u(18), paddingVertical: u(9) },
  pillText: { fontFamily: fonts.bodyBold, fontSize: u(17) },

  section: { marginTop: u(24) },
  bins: { flexDirection: 'row', alignItems: 'flex-end', gap: u(5), height: u(64) },
  caption: { fontFamily: fonts.bodySemiBold, fontSize: u(13), letterSpacing: u(1.3), color: FAINT, marginTop: u(11) },

  vsRow: { flexDirection: 'row', alignItems: 'center', gap: u(18) },
  vsCard: { flex: 1, borderWidth: 1.5, borderRadius: u(22), paddingHorizontal: u(22), paddingVertical: u(18) },
  vsPct: { fontFamily: fonts.display, fontSize: u(58), lineHeight: u(60) },
  vsLabel: { fontFamily: fonts.bodyBold, fontSize: u(17), letterSpacing: u(2.4), color: INK, marginTop: u(9) },
  vsSub: { fontFamily: fonts.bodyMedium, fontSize: u(15), color: WARM, marginTop: u(4) },
  vs: { fontFamily: fonts.display, fontSize: u(20), color: WARM2 },
  bar: { flexDirection: 'row', gap: u(5), height: u(22), marginTop: u(14) },

  trackRow: { flexDirection: 'row', gap: u(18), marginTop: u(22) },
  trackCard: {
    flex: 1,
    backgroundColor: 'rgba(255,255,255,0.5)',
    borderWidth: 1,
    borderRadius: u(22),
    paddingHorizontal: u(22),
    paddingVertical: u(18),
  },
  trackHead: { flexDirection: 'row', alignItems: 'center', gap: u(8) },
  trackKind: { fontFamily: fonts.bodyBold, fontSize: u(14), letterSpacing: u(2.2) },
  trackName: { fontFamily: fonts.display, fontSize: u(32), lineHeight: u(36), color: INK, marginTop: u(11) },
  trackScore: { fontFamily: fonts.display, fontSize: u(40), marginTop: u(9) },
  trackOutOf: { fontFamily: fonts.bodySemiBold, fontSize: u(17), color: WARM2 },

  factorRow: { flexDirection: 'row', gap: u(14), marginTop: u(26) },
  factorCell: {
    flex: 1,
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.5)',
    borderWidth: 1,
    borderColor: HAIRLINE,
    borderRadius: u(18),
    paddingVertical: u(16),
  },
  factorValue: { fontFamily: fonts.display, fontSize: u(34), color: INK },
  factorLabel: { fontFamily: fonts.bodySemiBold, fontSize: u(12), letterSpacing: u(1.2), color: WARM, marginTop: u(6) },

  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: u(11),
    paddingTop: u(24),
    borderTopWidth: 1,
    borderTopColor: HAIRLINE,
  },
  footerText: { fontFamily: fonts.bodyMedium, fontSize: u(19), color: WARM },
  footerLogo: { width: u(32), height: u(32) },
  footerBrand: { fontFamily: fonts.wordmark, fontSize: u(22), color: INK, letterSpacing: -0.4 },

  error: { fontFamily: fonts.body, fontSize: 12, color: '#c0392b', textAlign: 'center', marginTop: 10, paddingHorizontal: 24 },

  actions: { flexDirection: 'row', gap: 12, paddingHorizontal: 16, paddingBottom: 12, paddingTop: 4 },
  shareBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: colors.green,
    borderRadius: 12,
    paddingVertical: 15,
  },
  shareBtnText: { fontFamily: fonts.bodySemiBold, fontSize: 15, color: '#fff' },
  doneBtn: {
    paddingHorizontal: 24,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.raised,
  },
  doneBtnText: { fontFamily: fonts.bodyMedium, fontSize: 15, color: colors.inkSecondary },
})
