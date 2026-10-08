// The profile header, shared by your own Profile tab and a friend's page:
// identity, the average score, four headline stats, taste chips, and the three
// picks below them. The `action` slot holds whatever control belongs to the
// viewer (settings on your own page, add/remove friend on someone else's).
//
// It used to be a solid green block with white type, the one slab of flat
// colour left in the app. It now follows the rest of Pressd — For You's
// spotlight cards and web's album pages: no box, the colour comes from a record.
// Your favourite album (or the caller's stand-in, your top-rated one) is
// blurred into light behind the header, over a soft green wash, and the whole
// thing fades into the page instead of ending at an edge. The type is dark on
// cream, the numbers unboxed in Playfair. The average is the headline figure,
// set large in its own score colour, and also rings the avatar — the share of
// 10 you rate at, drawn around who you are.
import { useMemo, useState, type ReactNode } from 'react'
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native'
import { Image } from 'expo-image'
import { LinearGradient } from 'expo-linear-gradient'
import Svg, { Circle } from 'react-native-svg'
import { useQuery } from '@tanstack/react-query'
import type { Profile } from '@pressd/shared/api'
import { avatarColor, songScoreColor } from '@pressd/shared/types'
import { fetchArtistImage } from '../lib/api'
import { colors, fonts, radii, spacing } from '../theme/tokens'
import CoverImage from './CoverImage'
import ScoreHistogram from './ScoreHistogram'

// The wash's top colour — the same green tint the green SpotlightCard starts
// from. Pull-to-refresh exposes it above the header.
const WASH_TOP = '#e6f0ea'

// How far type in this header is allowed to scale. The header is a fixed-shape
// composition — a ringed avatar beside the name, a headline figure beside a
// grid of four — so past this the pieces stop being able to give way to each
// other. Text that hits the cap then shrinks to fit rather than clipping.
const HEADER_SCALE_CAP = 1.3

export interface BannerStatItem {
  value: string
  label: string
}

export default function ProfileBanner({
  name,
  avatarUrl,
  since,
  avg,
  stats,
  genres,
  subgenres,
  action,
  topInset,
  bio,
  profile,
  picksHeading,
  onPickPress,
  washArtUrl,
  scores,
}: {
  name: string
  avatarUrl?: string | null
  since?: string | null
  avg: number | null
  stats: BannerStatItem[]
  genres: string[]
  subgenres: string[]
  action?: ReactNode
  topInset: number
  /** Rendered between the taste chips and the picks — the prose belongs with
   *  the identity above it, not stranded under a row of cards. */
  bio?: string | null
  /** Picks come from GET /users/{id}/profile; the row hides itself until the
   *  ten-album bar is cleared, so a new account never shows three empty slots. */
  profile?: Profile | null
  /** "MY PICKS" on your own page, a possessive on someone else's — the banner
   *  can't tell whose page it is, so whoever renders it says. */
  picksHeading?: string
  /** Only your own page passes this; a friend's cards are not editable. */
  onPickPress?: (kind: PickKind) => void
  /** The cover blurred behind the header when no favourite album is set —
   *  callers pass the top-rated record. */
  washArtUrl?: string | null
  /** Every rated album's score: drawn as a small distribution under the
   *  average, the Stats tab's chart in miniature. */
  scores?: number[]
}) {
  const [expanded, setExpanded] = useState(false)
  const [rowW, setRowW] = useState(0)
  const [widths, setWidths] = useState<number[]>([])

  // Genres lead, subgenres follow; the split between shown and collapsed is
  // decided purely by what fits, not by which kind a tag is.
  const tags = useMemo(
    () => [
      ...genres.map((label) => ({ label, sub: false })),
      ...subgenres.map((label) => ({ label, sub: true })),
    ],
    [genres, subgenres],
  )

  // Chip text width + its own horizontal padding/border; the count chip needs
  // room reserved on the line whenever anything is going to overflow.
  const CHIP_PAD = 22
  const GAP = 6
  const MORE_W = 38

  const fitCount = useMemo(() => {
    if (!rowW || widths.length < tags.length || widths.some((w) => w == null)) return tags.length
    const fits = (budget: number) => {
      let used = 0
      let n = 0
      for (let i = 0; i < tags.length; i++) {
        const w = widths[i] + CHIP_PAD + (i > 0 ? GAP : 0)
        if (used + w > budget) break
        used += w
        n += 1
      }
      return n
    }
    const all = fits(rowW)
    if (all >= tags.length) return tags.length
    return Math.max(1, fits(rowW - MORE_W - GAP))
  }, [rowW, widths, tags])

  const shownTags = tags.slice(0, fitCount)
  const overflowTags = tags.slice(fitCount)
  const overflowCount = overflowTags.length

  return (
    <>
      <View style={[styles.banner, { paddingTop: topInset + spacing.sm }]}>
        <BannerWash artUrl={profile?.favorite_album?.album_art_url ?? washArtUrl} />

        <View style={styles.bannerTop}>
          <RingedAvatar name={name} avatarUrl={avatarUrl} avg={avg} />
          <View style={{ flex: 1, minWidth: 0 }}>
            {/* Capped because this is the column that gives way when the
                avatar grows beside it — uncapped, a long name at a large
                setting truncates to two or three characters. */}
            <Text style={styles.name} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75} maxFontSizeMultiplier={HEADER_SCALE_CAP}>
              {name}
            </Text>
            {since ? (
              <Text style={styles.since} numberOfLines={1} maxFontSizeMultiplier={HEADER_SCALE_CAP}>
                Pressing since {since}
              </Text>
            ) : null}
          </View>
          {action}
        </View>

        {/* The average leads, large and in its own score colour; the other
            four share a grid beside it. Unboxed, like the album pages' figures. */}
        <View style={styles.figures}>
          <View style={styles.hero}>
            <Text
              style={[styles.heroValue, { color: avg != null ? songScoreColor(avg) : colors.inkMuted }]}
              numberOfLines={1}
              adjustsFontSizeToFit
              maxFontSizeMultiplier={HEADER_SCALE_CAP}
            >
              {avg != null ? avg.toFixed(2) : '—'}
            </Text>
            <Text style={styles.statLabel} numberOfLines={1} maxFontSizeMultiplier={HEADER_SCALE_CAP}>
              Avg score
            </Text>
            {scores && scores.length > 0 ? (
              <View style={styles.heroChart}>
                <ScoreHistogram scores={scores} height={26} axis={false} gap={2} />
              </View>
            ) : null}
          </View>
          <View style={styles.rule} />
          <View style={styles.grid}>
            {stats.map((s) => (
              <View key={s.label} style={styles.statCell}>
                {/* Held to one line and allowed to shrink: unbounded, "5,692"
                    wrapped and pushed its own label out of line. */}
                <Text
                  style={styles.statValue}
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  maxFontSizeMultiplier={HEADER_SCALE_CAP}
                >
                  {s.value}
                </Text>
                <Text style={styles.statLabel} numberOfLines={1} adjustsFontSizeToFit maxFontSizeMultiplier={HEADER_SCALE_CAP}>
                  {s.label}
                </Text>
              </View>
            ))}
          </View>
        </View>

        {/* Taste chips, last thing on the wash: genres first (green), then
            subgenres (white). Borderless and translucent, so they read as part of
            the header rather than as white boxes laid over it. Only as many as actually fit the line are
            shown — the rest collapse behind a count chip that reveals them
            below, so the headline row is always exactly one line. */}
        {tags.length > 0 && (
          <>
            {/* Off-screen pass that measures each chip at its natural width;
                the visible row is sliced from these, so it never reflows. */}
            <View style={styles.measure} pointerEvents="none">
              {tags.map((t, i) => (
                <View key={`m-${t.label}`} style={[styles.chip, styles.chipNatural, t.sub ? styles.chipSub : styles.chipGenre]}>
                  <Text
                    style={t.sub ? styles.chipSubText : styles.chipGenreText}
                    onLayout={(e) => {
                      const w = e.nativeEvent.layout.width
                      setWidths((prev) => {
                        if (Math.abs((prev[i] ?? -1) - w) < 0.5) return prev
                        const next = [...prev]
                        next[i] = w
                        return next
                      })
                    }}
                  >
                    {t.label}
                  </Text>
                </View>
              ))}
            </View>

            <View style={styles.chipsRow} onLayout={(e) => setRowW(e.nativeEvent.layout.width)}>
              {shownTags.map((t) => (
                <View key={t.label} style={[styles.chip, t.sub ? styles.chipSub : styles.chipGenre]}>
                  <Text style={t.sub ? styles.chipSubText : styles.chipGenreText} numberOfLines={1}>{t.label}</Text>
                </View>
              ))}
              {(overflowCount > 0 || expanded) && (
                <Pressable
                  style={[styles.chip, styles.chipMore]}
                  onPress={() => setExpanded((v) => !v)}
                  hitSlop={6}
                  accessibilityLabel={expanded ? 'Show fewer tags' : `Show ${overflowCount} more tags`}
                >
                  <Text style={styles.chipMoreText}>{expanded ? 'Hide' : `+${overflowCount}`}</Text>
                </Pressable>
              )}
            </View>

            {expanded && overflowTags.length > 0 && (
              <View style={styles.subRow}>
                {overflowTags.map((t) => (
                  <View key={`o-${t.label}`} style={[styles.chip, t.sub ? styles.chipSub : styles.chipGenre]}>
                    <Text style={t.sub ? styles.chipSubText : styles.chipGenreText} numberOfLines={1}>{t.label}</Text>
                  </View>
                ))}
              </View>
            )}
          </>
        )}
      </View>

      {bio ? <Text style={styles.bio}>{bio}</Text> : null}

      <PicksRow profile={profile} heading={picksHeading} onPickPress={onPickPress} />
    </>
  )
}

export type PickKind = 'song' | 'album' | 'artist'

/** The cover of the highest-scored record that has one — the header's
 *  stand-in colour when no favourite album is set. */
export function topRatedArt(albums: { score?: number | null; albumArtUrl?: string | null }[]): string | null {
  let best: { score?: number | null; albumArtUrl?: string | null } | null = null
  for (const a of albums) {
    if (a.albumArtUrl && a.score != null && (best == null || a.score > (best.score ?? -1))) best = a
  }
  return best?.albumArtUrl ?? null
}

/** The three pinned favourites, under the taste chips.
 *
 *  Hidden wholesale below the unlock bar rather than shown as three empty
 *  slots: a profile with nothing rated yet has nothing to say here, and the
 *  server refuses to set a pick that early anyway.
 */
function PicksRow({
  profile,
  heading,
  onPickPress,
}: {
  profile?: Profile | null
  heading?: string
  onPickPress?: (kind: PickKind) => void
}) {
  // An artist is a name, not a row, so it has no art of its own — this is the
  // same lookup the artist page runs, sharing its cache key and its permanent
  // staleTime, so whichever screen is opened first pays for it once.
  //
  // Above the early returns on purpose: hooks can't sit behind a conditional.
  const artist = profile?.favorite_artist ?? null
  const { data: artistImage } = useQuery({
    queryKey: ['artist-image', artist],
    queryFn: () => fetchArtistImage(artist!),
    enabled: !!artist,
    staleTime: Infinity,
  })

  if (!profile?.picks_unlocked) return null

  const song = profile.favorite_song
  const album = profile.favorite_album
  const editable = !!onPickPress

  // On someone else's page an untouched set of picks is just noise, so the row
  // waits until there's something to show. On your own the empty slots are the
  // invitation to fill them, so they always render.
  if (!editable && !song && !album && !artist) return null

  return (
    <View style={styles.picks}>
      <Text style={styles.picksHeading}>{heading ?? 'PICKS'}</Text>
      <View style={styles.picksRow}>
        <PickCard
          label="SONG"
          artUrl={song?.album_art_url}
          fallback={song?.title}
          title={song?.title}
          subtitle={song?.artist ?? song?.album_name}
          editable={editable}
          onPress={() => onPickPress?.('song')}
        />
        <PickCard
          label="ALBUM"
          artUrl={album?.album_art_url}
          fallback={album?.album_name}
          title={album?.album_name}
          subtitle={album?.artist}
          editable={editable}
          onPress={() => onPickPress?.('album')}
        />
        <PickCard
          label="ARTIST"
          // A press photo is rarely square and never centred the way cover art
          // is, so it fills the tile and takes the crop rather than letterboxing
          // beside the two album covers next to it.
          artUrl={artistImage}
          fallback={artist}
          title={artist}
          editable={editable}
          onPress={() => onPickPress?.('artist')}
        />
      </View>
    </View>
  )
}

function PickCard({
  label,
  artUrl,
  fallback,
  title,
  subtitle,
  editable,
  onPress,
}: {
  label: string
  artUrl?: string | null
  fallback?: string | null
  title?: string | null
  subtitle?: string | null
  editable: boolean
  onPress: () => void
}) {
  const empty = !title
  return (
    <Pressable
      style={styles.pickCard}
      onPress={onPress}
      disabled={!editable}
      accessibilityRole={editable ? 'button' : undefined}
      accessibilityLabel={
        editable
          ? `${empty ? 'Choose your favorite' : 'Change your favorite'} ${label.toLowerCase()}`
          : undefined
      }
    >
      <Text style={styles.pickLabel}>{label}</Text>
      <View style={[styles.pickArt, empty && styles.pickArtEmpty]}>
        {/* The initial shows through underneath, so an artist whose photo is
            still in flight — or who has none — reads as a filled pick rather
            than a hole. */}
        <Text style={[styles.pickInitial, empty && styles.pickInitialEmpty]}>
          {empty ? '+' : fallback?.[0]?.toUpperCase() ?? '?'}
        </Text>
        {artUrl ? (
          <Image
            source={{ uri: artUrl }}
            style={styles.pickArtImg}
            contentFit="cover"
            cachePolicy="memory-disk"
            recyclingKey={artUrl}
            transition={140}
          />
        ) : null}
      </View>
      <Text style={[styles.pickTitle, empty && styles.pickTitleEmpty]} numberOfLines={1}>
        {title ?? (editable ? 'Choose' : 'Not set')}
      </Text>
      {/* An artist card has no second line, and a blank one would leave the
          three columns sitting at different heights. */}
      {subtitle ? (
        <Text style={styles.pickSubtitle} numberOfLines={1}>{subtitle}</Text>
      ) : null}
    </Pressable>
  )
}

/** The header's colour: a soft green wash, a record's cover blurred into light
 *  over it, and a fade to the page at the bottom so the header has no edge.
 *  Bled past the screen's padding and carried up above the top, so a
 *  pull-to-refresh shows more of the wash rather than a cream gap. */
function BannerWash({ artUrl }: { artUrl?: string | null }) {
  return (
    <View style={styles.wash} pointerEvents="none">
      <View style={styles.overscroll} />
      {/* Clipped: the cover is scaled past the header so its blur has no edge,
          and unclipped it hung below the fade as a grey slab over the picks. */}
      <View style={styles.washClip}>
        <LinearGradient colors={[WASH_TOP, colors.bg]} style={StyleSheet.absoluteFill} />
        {artUrl ? (
          // Blurred to a wash: a small image is all it needs.
          <CoverImage url={artUrl} displayPx={120} blurRadius={45} style={styles.washArt} accessible={false} />
        ) : null}
        <LinearGradient
          colors={['rgba(249,248,246,0)', colors.bg]}
          locations={[0.5, 1]}
          style={StyleSheet.absoluteFill}
        />
      </View>
    </View>
  )
}

/** The avatar, ringed by the average: the arc fills to score/10 in the
 *  score's own colour. It grows with the reader's text setting — capped — so
 *  it keeps its proportion to the name beside it. */
function RingedAvatar({ name, avatarUrl, avg }: { name: string; avatarUrl?: string | null; avg: number | null }) {
  const { fontScale } = useWindowDimensions()
  const k = Math.min(Math.max(fontScale, 1), HEADER_SCALE_CAP)
  const AV = 57 * k
  const SW = 3.25
  const GAP = 3.5
  const SIZE = AV + (SW + GAP) * 2
  const R = (SIZE - SW) / 2
  const C = 2 * Math.PI * R
  const frac = avg != null ? Math.max(0, Math.min(1, avg / 10)) : 0
  const mid = SIZE / 2
  return (
    <View
      style={{ width: SIZE, height: SIZE, alignItems: 'center', justifyContent: 'center' }}
      accessibilityLabel={avg != null ? `Average score ${avg.toFixed(2)}` : undefined}
    >
      <Svg width={SIZE} height={SIZE} style={StyleSheet.absoluteFill}>
        <Circle cx={mid} cy={mid} r={R} stroke="rgba(45,106,79,0.12)" strokeWidth={SW} fill="none" />
        {avg != null && (
          <Circle
            cx={mid}
            cy={mid}
            r={R}
            stroke={songScoreColor(avg)}
            strokeWidth={SW}
            fill="none"
            strokeDasharray={`${C * frac} ${C}`}
            strokeLinecap="round"
            transform={`rotate(-90 ${mid} ${mid})`}
          />
        )}
      </Svg>
      <View style={[styles.avatar, { width: AV, height: AV, borderRadius: AV / 2, backgroundColor: avatarColor(name) }]}>
        {avatarUrl ? (
          // The URL carries a ?v= stamp that only changes when the picture
          // does, and the server marks it immutable — so this can be held
          // on disk indefinitely and survive a cold launch.
          <Image
            source={{ uri: avatarUrl }}
            style={styles.avatarImg}
            contentFit="cover"
            cachePolicy="memory-disk"
            recyclingKey={avatarUrl}
            transition={120}
          />
        ) : (
          // A letter in a fixed disc: capped and allowed to shrink. Nobody
          // needs to *read* an initial at a larger size — it's identity.
          <Text
            style={[styles.avatarInitial, { fontSize: 24 * k }]}
            numberOfLines={1}
            adjustsFontSizeToFit
            maxFontSizeMultiplier={1}
          >
            {name[0]?.toUpperCase()}
          </Text>
        )}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  banner: {
    marginHorizontal: -spacing.lg,
    paddingHorizontal: spacing.lg,
    paddingBottom: 20,
  },
  wash: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  washClip: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, overflow: 'hidden' },
  // Taller than any realistic pull, and bled past both edges so it spans the
  // full width regardless of the header's own horizontal padding.
  overscroll: {
    position: 'absolute',
    top: -600,
    left: -spacing.lg * 2,
    right: -spacing.lg * 2,
    height: 600,
    backgroundColor: WASH_TOP,
  },
  // Scaled past the edges so the blur has no hard border to fade against.
  washArt: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    opacity: 0.3,
    transform: [{ scale: 1.6 }],
  },

  bannerTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginTop: spacing.sm },
  avatar: {
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  avatarImg: { width: '100%', height: '100%' },
  avatarInitial: { fontFamily: fonts.display, color: '#ffffff' },
  name: { fontFamily: fonts.displayBlack, fontSize: 27, lineHeight: 33, color: colors.ink, letterSpacing: 0.2 },
  since: { fontFamily: fonts.bodyMedium, fontSize: 12.5, color: colors.inkTertiary, marginTop: 2 },

  figures: { flexDirection: 'row', alignItems: 'center', marginTop: 20 },
  hero: { width: '33%', paddingRight: spacing.md },
  heroChart: { marginTop: 8 },
  heroValue: { fontFamily: fonts.display, fontSize: 42, lineHeight: 48, fontVariant: ['tabular-nums'] },
  rule: { width: StyleSheet.hairlineWidth, alignSelf: 'stretch', backgroundColor: 'rgba(28,25,23,0.16)' },
  grid: { flex: 1, flexDirection: 'row', flexWrap: 'wrap', paddingLeft: 14, rowGap: 10 },
  statCell: { width: '50%', paddingRight: spacing.sm },
  statValue: { fontFamily: fonts.display, fontSize: 20, lineHeight: 25, color: colors.ink, fontVariant: ['tabular-nums'] },
  statLabel: {
    fontFamily: fonts.bodyBold,
    fontSize: 9,
    color: colors.inkMuted,
    textTransform: 'uppercase',
    letterSpacing: 1.05,
    marginTop: 2,
  },

  chipsRow: {
    flexDirection: 'row',
    flexWrap: 'nowrap',
    alignItems: 'center',
    gap: 6,
    marginTop: 16,
  },
  // Off-screen measuring row — natural widths, never painted.
  measure: { position: 'absolute', top: 0, left: 0, flexDirection: 'row', opacity: 0 },
  chipNatural: { flexShrink: 0 },
  // No border: CHIP_PAD above is the horizontal padding alone.
  chip: {
    borderRadius: radii.pill,
    paddingHorizontal: 11,
    paddingVertical: 5,
  },
  // Genres in the brand's soft green — the same fill as For You's range chip.
  chipGenre: { backgroundColor: 'rgba(45,106,79,0.12)' },
  chipGenreText: { fontFamily: fonts.bodySemiBold, fontSize: 12, color: colors.green },
  // Subgenres as frosted white over the wash: present, but a step quieter.
  chipSub: { backgroundColor: 'rgba(255,255,255,0.7)' },
  chipSubText: { fontFamily: fonts.bodyMedium, fontSize: 12, color: colors.inkSecondary },
  // The count reads as a control, not a tag: no fill, just the words.
  chipMore: { paddingHorizontal: 8 },
  chipMoreText: { fontFamily: fonts.bodySemiBold, fontSize: 12, color: colors.inkTertiary },
  subRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6, marginTop: 7 },

  bio: { fontFamily: fonts.body, fontSize: 13, color: colors.inkSecondary, lineHeight: 19, marginTop: spacing.md },

  // Picks: three equal columns below the taste chips, each a slot label, a
  // square of art and the name. Same column rhythm as the Library grid, so the
  // page reads as one thing rather than a banner with a widget bolted on.
  picks: { marginTop: spacing.lg },
  picksHeading: {
    fontFamily: fonts.bodyBold,
    fontSize: 10,
    letterSpacing: 1.2,
    color: colors.inkMuted,
    textTransform: 'uppercase',
    marginBottom: spacing.sm,
  },
  picksRow: { flexDirection: 'row', gap: 10 },
  pickCard: { flex: 1, minWidth: 0 },
  pickLabel: {
    fontFamily: fonts.bodyBold,
    fontSize: 8.5,
    letterSpacing: 1,
    color: colors.green,
    marginBottom: 5,
  },
  pickArt: {
    width: '100%',
    aspectRatio: 1,
    borderRadius: radii.md,
    backgroundColor: colors.inset,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  // An unfilled slot reads as an invitation, not as art that failed to load.
  pickArtEmpty: {
    backgroundColor: 'transparent',
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: colors.border,
  },
  // Absolute so it covers the initial sitting behind it rather than displacing
  // it — the letter is the placeholder, not a sibling.
  pickArtImg: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  pickInitial: { fontFamily: fonts.display, fontSize: 30, color: colors.inkMuted },
  pickInitialEmpty: { fontFamily: fonts.body, fontSize: 24, color: colors.inkMuted },
  pickTitle: { fontFamily: fonts.bodySemiBold, fontSize: 12.5, color: colors.ink, marginTop: 6 },
  pickTitleEmpty: { fontFamily: fonts.bodyMedium, color: colors.inkMuted },
  pickSubtitle: { fontFamily: fonts.body, fontSize: 11, color: colors.inkTertiary, marginTop: 1 },
})
