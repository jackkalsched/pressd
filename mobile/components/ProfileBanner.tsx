// The profile header, shared by your own Profile tab and someone else's page:
// the banner, identity, the average score, four headline stats, taste chips, and
// the three picks below them. The `action` slot holds whatever control belongs to
// the viewer (settings on your own page, the friend button on someone else's).
//
// The top follows web's profile (frontend/src/pages/FriendProfile.tsx): the
// person's banner, sharp, in a rounded strip, Pressd green when there is none, and
// the avatar riding up over its bottom edge on a disc of the page's cream. It
// used to be their picture or favourite album blurred into a wash, which made an
// uploaded banner unrecognisable. The numbers stay unboxed in Playfair. The
// average is the headline figure, set large in its own score colour, and also
// rings the avatar: the share of 10 you rate at, drawn around who you are.
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
import ScoreHistogram from './ScoreHistogram'

// The server stores banners 24:5 (BANNER_SIZE, backend/routers/users.py). At phone
// width that is a sliver, too thin to carry the avatar, so the strip is a little
// taller and takes the crop from the sides. 4:1 keeps five-sixths of the width.
const BANNER_ASPECT = 4
// How much of the avatar's disc sits over the strip.
const AVATAR_OVERLAP = 0.5

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
  scores,
}: {
  name: string
  avatarUrl?: string | null
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
        <BannerStrip url={profile?.banner_url} />

        <View style={styles.bannerTop}>
          <RingedAvatar name={name} avatarUrl={avatarUrl} avg={avg} />
          <View style={styles.identity}>
            {/* Capped because this is the column that gives way when the
                avatar grows beside it — uncapped, a long name at a large
                setting truncates to two or three characters. */}
            <Text style={styles.name} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75} maxFontSizeMultiplier={HEADER_SCALE_CAP}>
              {name}
            </Text>
            <Text style={styles.handle} numberOfLines={1} maxFontSizeMultiplier={HEADER_SCALE_CAP}>
              @{name}
            </Text>
          </View>
          {action ? <View style={styles.action}>{action}</View> : null}
        </View>

        {/* The average leads, large and in its own score colour; the other
            four share a grid beside it. Unboxed, like the album pages' figures. */}
        <View style={styles.figures}>
          <View style={styles.hero}>
            <Text
              style={[styles.heroValue, { color: avg != null ? songScoreColor(avg) : colors.inkMuted }]}
              numberOfLines={1}
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
                {/* Held to one line: unbounded, "5,692" wrapped and pushed its own
                    label out of line. No adjustsFontSizeToFit: on iOS, with a set
                    lineHeight, it collapsed "458" to a few points in a cell with
                    room to spare. A five-digit count fits at full size. */}
                <Text
                  style={styles.statValue}
                  numberOfLines={1}
                  maxFontSizeMultiplier={HEADER_SCALE_CAP}
                >
                  {s.value}
                </Text>
                <Text style={styles.statLabel} numberOfLines={1} maxFontSizeMultiplier={HEADER_SCALE_CAP}>
                  {s.label}
                </Text>
              </View>
            ))}
          </View>
        </View>

        {/* Taste chips, last thing in the header: genres first (green), then
            subgenres (white). Borderless and translucent, so they read as part of
            the page rather than as white boxes laid over it. Only as many as actually fit the line are
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

/** Their picture exactly as uploaded, or Pressd green. A plain image rather than
 *  CoverImage: that sizes album covers per host, and a banner has one size. */
function BannerStrip({ url }: { url?: string | null }) {
  return (
    <View style={styles.strip} pointerEvents="none">
      <LinearGradient
        colors={['#245c43', '#2d6a4f', '#3d8463']}
        locations={[0, 0.45, 1]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0.4 }}
        style={StyleSheet.absoluteFill}
      />
      {url ? (
        <Image
          source={{ uri: url }}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          cachePolicy="memory-disk"
          recyclingKey={url}
          transition={120}
          accessible={false}
        />
      ) : null}
    </View>
  )
}

/** The avatar, ringed by the average: the arc fills to score/10 in the
 *  score's own colour. It grows with the reader's text setting — capped — so
 *  it keeps its proportion to the name beside it. */
function RingedAvatar({ name, avatarUrl, avg }: { name: string; avatarUrl?: string | null; avg: number | null }) {
  const { fontScale } = useWindowDimensions()
  const k = Math.min(Math.max(fontScale, 1), HEADER_SCALE_CAP)
  const AV = 74 * k
  const SW = 3.25
  const GAP = 3.5
  const SIZE = AV + (SW + GAP) * 2
  const R = (SIZE - SW) / 2
  const C = 2 * Math.PI * R
  const frac = avg != null ? Math.max(0, Math.min(1, avg / 10)) : 0
  const mid = SIZE / 2
  return (
    <View
      style={[styles.avatarDisc, { width: SIZE, height: SIZE, borderRadius: SIZE / 2, marginTop: -SIZE * AVATAR_OVERLAP }]}
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
            style={[styles.avatarInitial, { fontSize: 31 * k }]}
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
  banner: { paddingBottom: 20 },
  strip: {
    width: '100%',
    aspectRatio: BANNER_ASPECT,
    borderRadius: radii.lg,
    overflow: 'hidden',
    backgroundColor: colors.green,
  },

  // The strip's clipping is its own, so nothing here cuts the avatar off. The
  // text starts below the strip by its own padding, since the row aligns to the
  // top and the avatar alone is pulled up.
  bannerTop: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md, paddingLeft: spacing.sm },
  avatarDisc: { alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg, zIndex: 1 },
  identity: { flex: 1, minWidth: 0, paddingTop: spacing.sm },
  action: { paddingTop: spacing.md },
  avatar: {
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  avatarImg: { width: '100%', height: '100%' },
  avatarInitial: { fontFamily: fonts.display, color: '#ffffff' },
  name: { fontFamily: fonts.displayBlack, fontSize: 27, lineHeight: 33, color: colors.ink, letterSpacing: 0.2 },
  handle: { fontFamily: fonts.bodyMedium, fontSize: 12.5, color: colors.inkTertiary, marginTop: 2 },

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
  // Subgenres as frosted white on the page: present, but a step quieter.
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
