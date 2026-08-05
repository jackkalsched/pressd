// Artist page — per-artist stats scoped to a user: a full-bleed hero washed in
// the artist's own colors, headline ranks, the savant-style percentile bars,
// the song-score histogram, and the artist's albums.
import { useState } from 'react'
import { ActivityIndicator, Dimensions, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useQuery } from '@tanstack/react-query'
import { Image } from 'expo-image'
import { LinearGradient } from 'expo-linear-gradient'
import { StatusBar } from 'expo-status-bar'
import Svg, { Defs, Pattern, Rect } from 'react-native-svg'
import { ArrowLeft } from 'lucide-react-native'
import { fetchArtistDetail, fetchAlbumColor, fetchArtistImage } from '../../lib/api'
import type { ArtistPopulation } from '@pressd/shared/api'
import { songScoreColor } from '@pressd/shared/types'
import { useAuth } from '../../lib/auth'
import ScoreHistogram from '../../components/ScoreHistogram'
import { colors, fonts, radii, spacing } from '../../theme/tokens'

/** Which rating set the page is showing.
 *   mine    — your ratings, ranked among your own artists
 *   pressd  — every user's pooled, ranked globally
 *   compare — yours, with the userbase marked on each bar
 *  `compare` asks the API for 'both'; the other two map straight through. */
type Mode = 'mine' | 'pressd' | 'compare'
const POPULATION: Record<Mode, ArtistPopulation> = {
  mine: 'me',
  pressd: 'global',
  compare: 'both',
}

// Mirrors SMALL_SAMPLE in backend/routers/stats.py — the song count at which an
// artist's percentiles and ranks start being published.
const SMALL_SAMPLE = 15

// Half the global mark's width as a share of the track, so it can be clamped
// inside the bar the way the badge is. The badge is 22 wide and clamps to 3–97;
// the mark is wider, so it needs more room or it hangs off the ends — which is
// exactly what happened on a percentile of 1.
const MARK_INSET_PCT = 3.4

// Deficit red for the score comparison, matching the Social board's.
const VS_DOWN = '#c0392b'

// Fully transparent app-bg. Interpolating from the literal 'transparent'
// keyword muddies through black on Android, so fade from this instead.
const BG_CLEAR = 'rgba(249,248,246,0)'

// How far above the catalog strip the photo starts dissolving.
const FADE_LEAD = spacing.lg
// Stops sampled along the dissolve. A plain two-stop fade leaves a seam where
// it begins — alpha's slope jumps from nothing to constant, and the eye catches
// that crease as a band. Sampling a smoothstep instead leaves the ramp flat at
// both ends, so the photo melts into the page with no edge anywhere along it.
const FADE_STEPS = 12

type Ramp = {
  colors: readonly [string, string, ...string[]]
  locations: readonly [number, number, ...number[]]
}

function fadeRamp(start: number): Ramp {
  const steps = Array.from({ length: FADE_STEPS }, (_, i) => (i + 1) / FADE_STEPS)
  return {
    // Held clear down to `start`, then eased in — smoothstep leaves the ramp
    // flat where it meets the clear run, so there is no crease at the join.
    colors: [BG_CLEAR, BG_CLEAR, ...steps.map((t) => `rgba(249,248,246,${+(t * t * (3 - 2 * t)).toFixed(3)})`)],
    locations: [0, start, ...steps.map((t) => start + t * (1 - start))],
  }
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v))

export default function ArtistPage() {
  const { name } = useLocalSearchParams<{ name: string }>()
  const artist = decodeURIComponent(name ?? '')
  const router = useRouter()
  const { user } = useAuth()
  const insets = useSafeAreaInsets()

  const [mode, setMode] = useState<Mode>('mine')
  const { data, isLoading } = useQuery({
    queryKey: ['artist', artist, user?.id, mode],
    queryFn: () => fetchArtistDetail(artist, user!.id, POPULATION[mode]),
    enabled: !!user && !!artist,
    // Keeps the previous scope's numbers on screen while the next loads, so
    // switching modes doesn't blank the page.
    placeholderData: (prev) => prev,
  })

  const albums = data ? [...data.albums].sort((a, b) => (b.score ?? 0) - (a.score ?? 0)) : []

  // The hero takes its wash from the artist's best-rated album, reusing the
  // same dominant-color endpoint the album pages use — so an artist's page
  // carries their own palette rather than a single house gradient.
  const seed = albums.find((a) => a.status === 'rated') ?? albums[0]
  const { data: seedColor } = useQuery({
    queryKey: ['album-color', seed?.album_name, artist],
    queryFn: () => fetchAlbumColor(seed!.album_name, artist),
    enabled: !!seed,
    staleTime: Infinity,
  })
  const hero = heroRamp(seedColor?.color, seedColor?.color2)

  const { data: artistImage } = useQuery({
    queryKey: ['artist-image', artist],
    queryFn: () => fetchArtistImage(artist),
    enabled: !!artist,
    staleTime: Infinity,
  })

  // The photo runs the full height of the hero and dissolves across its lower
  // half, so the wash is gone by the hero's bottom edge — just above where the
  // SONG+ / wSONG+ ranks start. `catalogY` anchors the shading: the strip's top
  // is where the name has ended, so it doubles as the point the darkening tops
  // out and the point the dissolve begins.
  const [catalogY, setCatalogY] = useState<number | null>(null)
  const [heroHeight, setHeroHeight] = useState<number | null>(null)
  const photoHeight = heroHeight
  const anchor = photoHeight && catalogY != null ? clamp01(catalogY / photoHeight) : 0.66
  const fade = fadeRamp(
    photoHeight && catalogY != null ? clamp01((catalogY - FADE_LEAD) / photoHeight) : 0.55,
  )

  // Reaching this page by deep link or notification leaves nothing on the
  // stack, and a bare router.back() then throws "The action 'GO_BACK' was not
  // handled by any navigator". Fall through to the tab the artist lives under.
  const goBack = () => {
    if (router.canGoBack()) router.back()
    else router.replace('/(tabs)/profile')
  }

  if (isLoading || !data) {
    return (
      <View style={[styles.root, styles.center]}>
        <ActivityIndicator color={colors.green} />
      </View>
    )
  }

  const fmt2 = (v: number | null) => (v != null ? v.toFixed(2) : '—')
  const plus = (v: number | null) => (v != null ? String(Math.round(v)) : '—')
  const pctv = (v: number | null) => (v != null ? `${(v * 100).toFixed(1)}%` : '—')

  const p = data.percentiles
  // Only present in compare mode; every bar reads it optionally, so the same
  // markup serves all three scopes.
  const gp = data.global?.percentiles

  return (
    <View style={[styles.root, { backgroundColor: hero[0] }]}>
      <StatusBar style="light" />
      <ScrollView showsVerticalScrollIndicator={false}>
        {/* Hero — bleeds under the status bar, so the safe-area inset is padding
            here rather than a SafeAreaView edge. */}
        <View
          style={[styles.hero, { paddingTop: insets.top + spacing.sm }]}
          onLayout={(e) => setHeroHeight(e.nativeEvent.layout.height)}
        >
          {artistImage ? (
            <View style={[styles.heroArt, { height: photoHeight ?? 0 }]} pointerEvents="none">
              <Image
                source={{ uri: artistImage }}
                style={styles.heroFill}
                // Deezer photos are square and head-centred; anchoring the top
                // keeps the face when the wide hero crops the bottom off.
                contentFit="cover"
                contentPosition="top"
                transition={220}
              />
              {/* Darkens down to the name's baseline so the white type holds up
                  over a bright photo, then holds that level to the bottom —
                  the dissolve above it is what hands off to the page. */}
              <LinearGradient
                colors={['rgba(0,0,0,0.15)', 'rgba(0,0,0,0.30)', 'rgba(0,0,0,0.62)', 'rgba(0,0,0,0.62)']}
                locations={[0, anchor * 0.3, anchor * 0.8, 1]}
                style={styles.heroFill}
              />
              <LinearGradient
                colors={fade.colors}
                locations={fade.locations}
                style={styles.heroFill}
              />
            </View>
          ) : (
            // No photo for this artist — fall back to the cover-derived wash.
            <LinearGradient
              colors={hero}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.heroFill}
            />
          )}

          <View style={styles.heroBar}>
            <Pressable onPress={goBack} hitSlop={10} style={styles.backBtn}>
              <ArrowLeft size={20} color="#ffffff" />
              <Text style={styles.backText}>Back</Text>
            </Pressable>
            {/* Which rating set you're reading. Both controls toggle, so the
                same button that opened a scope closes it — there's no separate
                way back to your own numbers. */}
            <View style={styles.heroActions}>
              <Pressable
                style={[styles.modeBtn, mode === 'compare' && styles.modeBtnOn]}
                onPress={() => setMode((m) => (m === 'compare' ? 'mine' : 'compare'))}
                hitSlop={8}
              >
                <Text style={[styles.modeBtnText, mode === 'compare' && styles.modeBtnTextOn]}>Compare</Text>
              </Pressable>
              <Pressable
                style={[styles.modeBtn, mode === 'pressd' && styles.modeBtnOn]}
                onPress={() => setMode((m) => (m === 'pressd' ? 'mine' : 'pressd'))}
                hitSlop={8}
              >
                <Text style={[styles.modeBtnText, mode === 'pressd' && styles.modeBtnTextOn]}>Pressd avg</Text>
              </Pressable>
            </View>
          </View>

          <Text style={[styles.artist, { fontSize: nameSize(data.artist) }]} numberOfLines={2}>
            {data.artist}
          </Text>
          {/* Your own page counts what you've rated. The other two scopes lead
              with what the artist *is* instead — a pooled song count says
              little, and the genres are the thing both views have in common. */}
          {/* Genres on every scope — they're what the artist is, and that holds
              whoever's ratings you're reading. Your own page keeps the counts
              underneath, since what you've rated is the thing that scopes it. */}
          {data.genre && <Text style={styles.heroGenre}>{data.genre.toUpperCase()}</Text>}
          {data.subgenres.length > 0 && (
            <Text style={styles.sub} numberOfLines={2}>{data.subgenres.join(' · ')}</Text>
          )}
          {mode === 'mine' && (
            <Text style={styles.heroCounts}>
              {data.song_count} songs rated · {data.album_count} album{data.album_count === 1 ? '' : 's'}
            </Text>
          )}
          {mode === 'pressd' && (
            <Text style={styles.scopeNote}>Averaged across every Pressd rating</Text>
          )}

          <View onLayout={(e) => setCatalogY(e.nativeEvent.layout.y)}>
            <CatalogStrip
              albums={albums}
              onOpen={(id) => router.push({ pathname: '/album/[id]', params: { id: String(id) } })}
            />
          </View>
        </View>

        <View style={styles.body}>
          {/* Headline ranks — placements within whichever population you're
              reading. Compare mode drops them for the score comparison below:
              a Song+ rank is a position in one league table, and holding yours
              against the userbase's would be two different tables. The row also
              repeated the same avg song score the comparison already shows. */}
          {mode !== 'compare' && (
            <View style={styles.statRow}>
              <StatCell
                value={data.song_plus_rank != null ? `#${data.song_plus_rank}` : '—'}
                label="SONG+"
                accent
              />
              <StatCell
                value={data.w_song_plus_rank != null ? `#${data.w_song_plus_rank}` : '—'}
                label="WSONG+"
                accent
              />
              <StatCell value={fmt2(data.avg_song_score)} label="AVG SONG" />
            </View>
          )}

          {/* Says why the ranks read "—" and the bars below are faded. The
              backend flags this under SMALL_SAMPLE (15) songs. */}
          {data.small_sample && (
            <Text style={styles.sampleNote}>
              Rate at least {SMALL_SAMPLE} songs to see advanced stats!
            </Text>
          )}

          {/* Absolute scores, so it sits above the percentile list rather than
              among rows that all share a track / badge / value grid. */}
          {mode === 'compare' && (
            <ScoreVersus mine={data.avg_song_score} theirs={data.global?.avg_song_score ?? null} />
          )}

          {/* Percentile rankings — savant-style bars */}
          <View style={styles.sectionHead}>
            <Text style={styles.sectionLabel}>PERCENTILE RANKINGS</Text>
            <View style={styles.legend}>
              <Text style={[styles.legendItem, { color: barColor(0) }]}>POOR</Text>
              <Text style={[styles.legendItem, { color: barColor(50) }]}>AVG</Text>
              <Text style={[styles.legendItem, { color: barColor(100) }]}>GREAT</Text>
            </View>
          </View>
          <PercentileBar label="Avg Song"     value={fmt2(data.avg_song_score)}   percentile={p.avg_song_score}   globalPercentile={gp?.avg_song_score}   smallSample={data.small_sample} />
          <PercentileBar label="Song+"        value={plus(data.song_plus)}        percentile={p.song_plus}        globalPercentile={gp?.song_plus}        smallSample={data.small_sample} />
          <PercentileBar label="wSong+"       value={plus(data.w_song_plus)}      percentile={p.w_song_plus}      globalPercentile={gp?.w_song_plus}      smallSample={data.small_sample} />
          <PercentileBar label="Avg External" value={fmt2(data.avg_external)}     percentile={p.avg_external}     globalPercentile={gp?.avg_external}     smallSample={data.small_sample} />
          <PercentileBar label="Bang%"        value={pctv(data.bang_pct)}         percentile={p.bang_pct}         globalPercentile={gp?.bang_pct}         smallSample={data.small_sample} />
          <PercentileBar label="Skip%"        value={pctv(data.skip_pct)}         percentile={p.skip_pct}         globalPercentile={gp?.skip_pct}         smallSample={data.small_sample} invert />
          <PercentileBar label="Consistency+" value={plus(data.consistency_plus)} percentile={p.consistency_plus} globalPercentile={gp?.consistency_plus} smallSample={data.small_sample} />

          {/* Distribution — same histogram as Profile → Stats */}
          {data.song_scores.length > 0 && (
            <>
              <Text style={[styles.sectionLabel, styles.sectionSolo]}>SCORE DISTRIBUTION</Text>
              <ScoreHistogram scores={data.song_scores} />
            </>
          )}

          {/* Albums */}
          <Text style={[styles.sectionLabel, styles.sectionSolo]}>ALBUMS</Text>
          {albums.map((a) => (
            <Pressable
              key={a.id}
              style={styles.albumRow}
              onPress={() => router.push({ pathname: '/album/[id]', params: { id: String(a.id) } })}
            >
              {/* Score-tinted rule, the same accent the album pages use */}
              <View
                style={[
                  styles.albumAccent,
                  { backgroundColor: a.score != null ? songScoreColor(a.score) : colors.border },
                ]}
              />
              {a.album_art_url ? (
                <Image source={{ uri: a.album_art_url }} style={styles.albumArt} contentFit="cover" />
              ) : (
                <LinearGradient
                  colors={[hero[0], hero[2]]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={[styles.albumArt, styles.artFallback]}
                >
                  <Text style={styles.artInitial}>{a.album_name[0]}</Text>
                </LinearGradient>
              )}
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.albumName} numberOfLines={2}>{a.album_name}</Text>
                <Text style={styles.albumMeta} numberOfLines={1}>
                  {[
                    a.year ?? null,
                    a.is_ep ? 'EP' : null,
                    a.status !== 'rated' ? 'unrated' : null,
                    a.avg_external != null ? `ext ${a.avg_external.toFixed(1)}` : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </Text>
              </View>
              {a.score != null && (
                <Text style={[styles.albumScore, { color: songScoreColor(a.score) }]}>
                  {a.score.toFixed(2)}
                </Text>
              )}
            </Pressable>
          ))}
        </View>
      </ScrollView>
    </View>
  )
}

// Long names would otherwise wrap to three lines and push the hero open.
function nameSize(name: string): number {
  if (name.length > 22) return 28
  if (name.length > 14) return 34
  return 44
}

/** `hsl(H, S%, L%)` → its hue and saturation, for re-mixing at another lightness. */
function parseHsl(v?: string | null): { h: number; s: number } | null {
  const m = v?.match(/hsl\((\d+),\s*(\d+)%/)
  return m ? { h: Number(m[1]), s: Number(m[2]) } : null
}

/** Relative luminance of an HSL color, per WCAG 2.1. */
function luminance(h: number, s: number, l: number): number {
  const a = s * Math.min(l, 1 - l)
  const ch = (n: number) => {
    const k = (n + h / 30) % 12
    return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))
  }
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
  return 0.2126 * lin(ch(0)) + 0.7152 * lin(ch(8)) + 0.0722 * lin(ch(4))
}

// Covers skew every hue, and a hue's luminance at a fixed lightness varies
// enormously — a yellow at 38% lightness is more than twice as bright as a blue
// at the same number, and white on it fails AA. So the ramp asks for a
// lightness and gets the highest one at that hue that still clears `ratio`.
function darkenToContrast(h: number, s: number, want: number, ratio: number): string {
  const ok = (l: number) => 1.05 / (luminance(h, s / 100, l) + 0.05) >= ratio
  let lo = 0.04
  let hi = want / 100
  if (ok(hi)) return `hsl(${h}, ${s}%, ${want}%)`
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2
    if (ok(mid)) lo = mid
    else hi = mid
  }
  // Floor, not round: rounding up would cross back over the threshold the
  // search just settled on.
  return `hsl(${h}, ${s}%, ${Math.floor(lo * 100)}%)`
}

// Three diagonal stops from the cover's two dominant hues: deep at the top-left
// where the name and back button sit, opening lighter toward the bottom-right.
// The two upper stops carry white text, so they hold body-text contrast (4.5:1);
// the bottom corner never has text over it and only needs to stay a color.
function heroRamp(color?: string | null, color2?: string | null): [string, string, string] {
  const a = parseHsl(color)
  const b = parseHsl(color2) ?? a
  if (!a || !b) return ['#31404f', '#4a5a63', '#6d7b76'] // slate, for artists with no cover
  const sat = (v: number) => Math.min(46, Math.max(18, v))
  return [
    darkenToContrast(a.h, sat(a.s), 27, 4.5),
    darkenToContrast(a.h, sat(a.s + 4), 38, 4.5),
    darkenToContrast(b.h, sat(b.s + 6), 50, 3),
  ]
}

// Continuous red→green gradient, matching the desktop PercentileBar.
function barColor(pct: number): string {
  const hue = Math.round(pct * 1.3) // 0 → red, 100 → forest green
  return `hsl(${hue}, 65%, 28%)`
}

// Overlapping strip of the artist's covers, mirroring the website header's
// catalog montage.
const STRIP_MAX = 8
const STRIP_SIZE = 56
const STRIP_MIN_OVERLAP = 8
const STRIP_WIDTH = Dimensions.get('window').width - spacing.lg * 2

function CatalogStrip({
  albums,
  onOpen,
}: {
  albums: { id: number; album_name: string; album_art_url: string | null }[]
  onOpen: (id: number) => void
}) {
  const shown = albums.filter((a) => a.album_art_url).slice(0, STRIP_MAX)
  // A lone cover reads as a stray thumbnail rather than a catalog, and the
  // ALBUMS list below is already showing it — most artists have exactly one.
  if (shown.length < 2) return null

  // Overlap only as much as the row needs to fit: small catalogs sit nearly
  // square like the website's, and the widest (8) tightens up rather than
  // running off the edge — which it would on a 375pt phone at a fixed overlap.
  const step = Math.min(
    STRIP_SIZE - STRIP_MIN_OVERLAP,
    (STRIP_WIDTH - STRIP_SIZE) / (shown.length - 1),
  )

  return (
    <View style={styles.strip}>
      {shown.map((a, i) => (
        <Pressable
          key={a.id}
          onPress={() => onOpen(a.id)}
          // Highest-scoring album leads and sits on top of the fan.
          style={[
            styles.stripItem,
            { marginLeft: i === 0 ? 0 : step - STRIP_SIZE, zIndex: shown.length - i },
          ]}
        >
          {/* Sits behind the cover, so a dead art URL (the library has some)
              shows the album's initial instead of an empty tile. */}
          <Text style={styles.stripInitial}>{a.album_name[0]}</Text>
          <Image source={{ uri: a.album_art_url! }} style={styles.stripImg} contentFit="cover" />
        </Pressable>
      ))}
    </View>
  )
}

// One headline rank cell: the figure over its metric.
function StatCell({
  value,
  label,
  accent = false,
}: {
  value: string
  label: string
  accent?: boolean
}) {
  // The accent is the rank's own emphasis — an absent one stays a muted dash.
  const missing = value === '—'
  return (
    <View style={styles.statCell}>
      <Text style={[styles.statValue, accent && !missing && styles.statValueAccent, missing && styles.statValueMissing]}>
        {value}
      </Text>
      <Text style={styles.statLabel} numberOfLines={1}>{label}</Text>
    </View>
  )
}

// One savant-style percentile bar: a track with a colored fill and a numbered
// badge sitting at the percentile. `invert` flips the reading (low Skip% good).
/** Your average song score for the artist against the userbase's, as raw scores
 *  rather than percentiles — see the note at its call site for why the two +
 *  metrics can't be compared directly. */
function ScoreVersus({ mine, theirs }: { mine: number | null; theirs: number | null }) {
  const diff = mine != null && theirs != null ? mine - theirs : null
  return (
    <View style={styles.vsBlock}>
      <View style={styles.vsCol}>
        <Text style={styles.vsLabel}>MY AVG SONG</Text>
        <Text style={[styles.vsScore, { color: mine != null ? songScoreColor(mine) : colors.inkMuted }]}>
          {mine != null ? mine.toFixed(2) : '—'}
        </Text>
      </View>

      <View style={styles.vsMiddle}>
        <Text style={styles.vsWord}>vs.</Text>
        {diff != null && (
          <Text style={[styles.vsDiff, { color: diff >= 0 ? colors.green : VS_DOWN }]}>
            {diff >= 0 ? '+' : ''}{diff.toFixed(2)}
          </Text>
        )}
      </View>

      <View style={styles.vsCol}>
        <Text style={styles.vsLabel}>PRESSD AVG SONG</Text>
        <Text style={[styles.vsScore, { color: theirs != null ? songScoreColor(theirs) : colors.inkMuted }]}>
          {theirs != null ? theirs.toFixed(2) : '—'}
        </Text>
      </View>
    </View>
  )
}

function PercentileBar({
  label,
  value,
  percentile,
  globalPercentile = null,
  invert = false,
  smallSample = false,
}: {
  label: string
  value: string
  percentile: number | null
  /** The userbase's percentile on this metric. Given, the bar draws the gap
   *  between the two rather than just your own fill. */
  globalPercentile?: number | null
  invert?: boolean
  smallSample?: boolean
}) {
  const display = percentile != null ? (invert ? 100 - percentile : percentile) : null
  const gDisplay = globalPercentile != null ? (invert ? 100 - globalPercentile : globalPercentile) : null
  const color = display != null ? barColor(display) : '#ccc'
  const badgePct = display != null ? Math.max(3, Math.min(97, display)) : 50
  const comparing = display != null && gDisplay != null
  // Which side of you the userbase sits on decides how the gap is drawn: a
  // solid lighter band when you rate the artist higher, hatching when they do.
  const ahead = comparing && gDisplay < display
  const lo = comparing ? Math.min(display, gDisplay) : 0
  const hi = comparing ? Math.max(display, gDisplay) : 0
  const patternId = `hatch-${label.replace(/[^a-z0-9]/gi, '')}`

  return (
    <View style={styles.pctRow}>
      <Text style={styles.pctLabel} numberOfLines={2}>{label}</Text>
      <View style={styles.pctTrack}>
        {display != null ? (
          <>
            {/* Base fill. Comparing, it stops at whichever percentile is lower
                and the band above it carries the difference. */}
            <View
              style={[
                styles.pctFill,
                {
                  width: `${comparing ? lo : display}%`,
                  backgroundColor: color,
                  opacity: smallSample ? 0.5 : comparing ? 0.95 : 0.75,
                },
              ]}
            />

            {comparing && ahead && (
              // You above the userbase: the stretch you've earned beyond them,
              // same hue at a lighter weight.
              <View
                style={[
                  styles.pctFill,
                  { left: `${lo}%`, width: `${hi - lo}%`, backgroundColor: color, opacity: 0.34 },
                ]}
              />
            )}

            {comparing && !ahead && hi > lo && (
              // The userbase above you: hatched rather than filled, so a
              // deficit never reads as progress. Same -45° stripe the web bars
              // use for an unqualified sample.
              <View style={[styles.pctFill, { left: `${lo}%`, width: `${hi - lo}%` }]}>
                <Svg width="100%" height="100%">
                  <Defs>
                    <Pattern
                      id={patternId}
                      width={8}
                      height={8}
                      patternUnits="userSpaceOnUse"
                      patternTransform="rotate(-45)"
                    >
                      <Rect x={0} y={0} width={3} height={8} fill={color} />
                    </Pattern>
                  </Defs>
                  <Rect x={0} y={0} width="100%" height="100%" fill={`url(#${patternId})`} />
                </Svg>
              </View>
            )}

            <View
              style={[styles.pctBadge, { left: `${badgePct}%`, backgroundColor: color, opacity: smallSample ? 0.7 : 1 }]}
            >
              <Text style={styles.pctBadgeText}>{Math.round(display)}</Text>
            </View>

            {comparing && (
              // The bare mark, no chip behind it. Its own cream lens is what
              // separates it from the fill, so a white circle only boxed it in.
              // Drawn last so it sits over your badge — the userbase's position
              // is the thing this view exists to show.
              <View
                style={[
                  styles.pctGlobalWrap,
                  { left: `${Math.max(MARK_INSET_PCT, Math.min(100 - MARK_INSET_PCT, gDisplay))}%` },
                ]}
              >
                {/* A white-tinted copy of the same mark, a couple of points
                    larger, sitting behind it. A shadow glow softens edges but
                    still lets a dark mark sink into a dark fill; an actual
                    silhouette behind it can't. */}
                <Image
                  source={require('../../assets/pressd-mark.png')}
                  style={styles.pctGlobalOutline}
                  tintColor="#ffffff"
                  contentFit="contain"
                />
                <Image
                  source={require('../../assets/pressd-mark.png')}
                  style={styles.pctGlobalMark}
                  contentFit="contain"
                />
              </View>
            )}
          </>
        ) : (
          <Text style={styles.pctDash}>—</Text>
        )}
      </View>
      <Text style={[styles.pctValue, smallSample && styles.pctValueSmall]}>{value}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  center: { alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },

  hero: { paddingHorizontal: spacing.lg, paddingBottom: spacing.sm, backgroundColor: colors.bg },
  heroArt: { position: 'absolute', top: 0, left: 0, right: 0 },
  heroFill: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  backBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: spacing.xl },
  backText: { fontFamily: fonts.bodyMedium, fontSize: 16, color: '#ffffff' },
  artist: { fontFamily: fonts.display, color: '#ffffff' },
  sub: {
    fontFamily: fonts.bodyMedium,
    fontSize: 14,
    color: 'rgba(255,255,255,0.78)',
    marginTop: spacing.xs,
  },

  strip: { flexDirection: 'row', marginTop: spacing.lg },
  stripItem: {
    width: STRIP_SIZE,
    height: STRIP_SIZE,
    borderRadius: radii.md,
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.4)',
    backgroundColor: 'rgba(0,0,0,0.18)', // backs the initial when art is missing
  },
  stripImg: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  stripInitial: {
    fontFamily: fonts.display,
    fontSize: 22,
    color: 'rgba(255,255,255,0.85)',
    textAlign: 'center',
    lineHeight: STRIP_SIZE - 4, // centres within the tile, minus the border
  },

  body: {
    flexGrow: 1,
    backgroundColor: colors.bg,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: 60,
  },

  // Headline ranks — the ProfileBanner stat treatment (Playfair figure over a
  // small uppercase label), with no card or rules around them.
  statRow: { flexDirection: 'row', paddingTop: spacing.xs },
  statCell: { flex: 1, alignItems: 'center', paddingHorizontal: spacing.xs },
  statValue: { fontFamily: fonts.display, fontSize: 26, color: colors.ink },
  statValueAccent: { color: colors.green },
  statValueMissing: { color: colors.inkMuted },
  statLabel: {
    fontFamily: fonts.bodyMedium,
    fontSize: 9.5,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    color: colors.inkTertiary,
    marginTop: 2,
  },
  sampleNote: {
    fontFamily: fonts.bodyMedium,
    fontSize: 12,
    lineHeight: 16,
    color: colors.green,
    marginTop: spacing.md,
    textAlign: 'center',
  },

  // Percentile (savant) bars
  sectionHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.xl,
    marginBottom: spacing.sm,
  },
  legend: { flexDirection: 'row', gap: spacing.md },
  legendItem: { fontFamily: fonts.bodyBold, fontSize: 10, letterSpacing: 0.8 },
  heroBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  heroActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexShrink: 0 },
  // Reads on a photo of any brightness: translucent white over the hero's own
  // scrim rather than a solid chip.
  modeBtn: {
    paddingHorizontal: 11,
    height: 30,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.16)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.32)',
  },
  modeBtnOn: { backgroundColor: '#ffffff', borderColor: '#ffffff' },
  modeBtnText: { fontFamily: fonts.bodySemiBold, fontSize: 12.5, color: '#ffffff' },
  modeBtnTextOn: { color: colors.green },
  heroGenre: {
    fontFamily: fonts.bodyBold,
    fontSize: 11.5,
    letterSpacing: 1.6,
    color: 'rgba(255,255,255,0.92)',
    marginTop: 6,
  },
  heroCounts: {
    fontFamily: fonts.bodyMedium,
    fontSize: 13,
    color: 'rgba(255,255,255,0.78)',
    marginTop: 4,
  },
  scopeNote: {
    fontFamily: fonts.bodyMedium,
    fontSize: 11.5,
    color: 'rgba(255,255,255,0.62)',
    marginTop: 4,
  },

  // Absolute scores, not percentiles, so this row wears no track — it sits in
  // the bars' rhythm but shouldn't read as one of them.
  vsBlock: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    // Takes the headline row's place in compare mode, so it carries that row's
    // vertical rhythm rather than a list row's.
    marginTop: spacing.sm,
    marginBottom: spacing.lg,
    paddingBottom: spacing.lg,
    borderBottomWidth: 1,
    borderColor: colors.border,
  },
  vsCol: { flex: 1, alignItems: 'center' },
  vsLabel: { fontFamily: fonts.bodyBold, fontSize: 9.5, letterSpacing: 1, color: colors.inkMuted },
  vsScore: { fontFamily: fonts.display, fontSize: 30, lineHeight: 34, marginTop: 2 },
  vsMiddle: { alignItems: 'center', gap: 1, flexShrink: 0 },
  // Set in the display face like the scores it separates, but small and muted —
  // it's a conjunction, not a third value.
  vsWord: { fontFamily: fonts.display, fontSize: 15, color: colors.inkMuted },
  vsDiff: { fontFamily: fonts.bodyBold, fontSize: 11 },

  pctRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 7 },
  pctLabel: { width: 84, textAlign: 'right', fontFamily: fonts.bodyMedium, fontSize: 11, lineHeight: 13, color: colors.inkMuted },
  pctTrack: { flex: 1, height: 14, borderRadius: 7, backgroundColor: colors.inset, position: 'relative', justifyContent: 'center' },
  pctFill: { position: 'absolute', left: 0, top: 0, bottom: 0, borderRadius: 7, overflow: 'hidden' },
  // The track is 14 tall; contentFit="contain" on a ~2:1 mark fits by width, so
  // a 42-wide box renders about 21 tall — half again the bar's height, which is
  // what makes it sit *on* the percentile rather than inside it. Width is the
  // dial here; height only has to stay above half of it or contain letterboxes.
  //
  // The glow is white and follows the PNG's alpha, so it haloes the mark's own
  // silhouette. That's the direction that matters: the mark is dark, and the
  // fills it has to survive are the dark ones. (iOS shadow props only — Android
  // has no coloured-glow equivalent, and elevation would just add a drop
  // shadow.)
  // The asset was a 256x256 canvas whose artwork filled only 49% of the height.
  // contentFit="contain" fits the *canvas*, so height was the binding constraint
  // and widening the box did nothing — the mark just sat in more transparent
  // padding. Cropped to its own bounds now, so these numbers mean what they say:
  // 1.84 aspect, sized a touch under the 22pt badge so the two read as a pair
  // rather than the mark swallowing the row.
  pctGlobalWrap: {
    position: 'absolute',
    top: '50%',
    marginTop: -8,
    marginLeft: -15,
    width: 30,
    height: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // A keyline, not a halo — enough to hold the mark off a dark fill without
  // swamping its thinner strokes.
  pctGlobalOutline: { position: 'absolute', top: -2.5, left: -2.5, right: -2.5, bottom: -2.5 },
  pctGlobalMark: { width: '100%', height: '100%' },
  pctBadge: {
    position: 'absolute',
    top: '50%',
    marginTop: -11,
    marginLeft: -11,
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
  },
  pctBadgeText: { fontFamily: fonts.bodyBold, fontSize: 9, color: '#ffffff' },
  pctDash: { textAlign: 'center', color: colors.inkMuted, fontSize: 10 },
  pctValue: { width: 46, textAlign: 'right', fontFamily: fonts.bodySemiBold, fontSize: 12, color: colors.ink, fontVariant: ['tabular-nums'] },
  pctValueSmall: { color: colors.inkMuted },

  sectionLabel: {
    fontFamily: fonts.bodyBold,
    fontSize: 11,
    letterSpacing: 1.2,
    color: colors.inkMuted,
  },
  sectionSolo: { marginTop: spacing.xl, marginBottom: spacing.sm },

  albumRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.raised,
    borderRadius: radii.lg,
    paddingVertical: spacing.md,
    paddingRight: spacing.lg,
    paddingLeft: spacing.md + 4, // clears the accent rule
    marginBottom: spacing.sm,
    overflow: 'hidden',
  },
  albumAccent: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 4 },
  albumArt: { width: 62, height: 62, borderRadius: radii.md },
  artFallback: { alignItems: 'center', justifyContent: 'center' },
  artInitial: { fontFamily: fonts.display, fontSize: 24, color: 'rgba(255,255,255,0.9)' },
  albumName: { fontFamily: fonts.display, fontSize: 17, lineHeight: 21, color: colors.ink },
  albumMeta: { fontFamily: fonts.body, fontSize: 12.5, color: colors.inkTertiary, marginTop: 3 },
  albumScore: { fontFamily: fonts.display, fontSize: 24 },
})
