// The green profile header, shared by your own Profile tab and a friend's
// page: identity, an average-score ring, four headline stats, taste chips
// that straddle the banner's bottom edge, and the three picks below them. The
// `action` slot holds whatever control belongs to the viewer (settings on your
// own page, add/remove friend on someone else's).
import { useMemo, useState, type ReactNode } from 'react'
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native'
import { Image } from 'expo-image'
import Svg, { Circle } from 'react-native-svg'
import { useQuery } from '@tanstack/react-query'
import type { Profile } from '@pressd/shared/api'
import { fetchArtistImage } from '../lib/api'
import { colors, fonts, radii, spacing } from '../theme/tokens'

// How far type in this header is allowed to scale. The banner is a fixed-shape
// composition — a ring, a round avatar, and four stat columns sharing one row —
// so past this the pieces stop being able to give way to each other. Text that
// hits the cap then shrinks to fit rather than clipping.
const HEADER_SCALE_CAP = 1.3
// The ring is the one piece that grows with the setting instead of capping the
// type inside it, so it gets a little more room than flat text does.
const RING_SCALE_CAP = 1.35

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
  const CHIP_PAD = 24
  const GAP = 6
  const MORE_W = 46

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
        {/* Pull-to-refresh drags the content down and exposes whatever sits
            above it. Without this the screen's cream shows through and the
            banner reads as a floating block, so carry the green up past the
            top of the scroll view. */}
        <View style={styles.overscroll} pointerEvents="none" />
        <View style={styles.bannerTop}>
          <View style={styles.avatar}>
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
              // A letter in a fixed disc: capped and allowed to shrink, rather
              // than growing the disc. Unlike the ring's number, nobody needs to
              // *read* an initial at a larger size — it's identity, not data.
              <Text
                style={styles.avatarInitial}
                numberOfLines={1}
                adjustsFontSizeToFit
                maxFontSizeMultiplier={HEADER_SCALE_CAP}
              >
                {name[0]?.toUpperCase()}
              </Text>
            )}
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            {/* Capped because this is the column that gives way when the ring
                and the avatar grow beside it — uncapped, a long name at a large
                setting truncates to two or three characters. */}
            <Text style={styles.name} numberOfLines={1} maxFontSizeMultiplier={HEADER_SCALE_CAP}>
              {name}
            </Text>
            {since ? (
              <Text style={styles.since} numberOfLines={1} maxFontSizeMultiplier={HEADER_SCALE_CAP}>
                Pressing since {since}
              </Text>
            ) : null}
          </View>
          <AvgRing value={avg} />
          {action}
        </View>

        <View style={styles.stats}>
          {stats.map((s) => (
            <View key={s.label} style={styles.statCol}>
              {/* Four columns splitting one row, so each gets a quarter of the
                  screen however wide the glyphs get. Held to one line and
                  allowed to shrink: unbounded, "5,692" wrapped to two lines and
                  pushed its own label out of line with the other three. */}
              <Text
                style={styles.statValue}
                numberOfLines={1}
                adjustsFontSizeToFit
                maxFontSizeMultiplier={HEADER_SCALE_CAP}
              >
                {s.value}
              </Text>
              {/* The label may take two lines — "TASTE CENTER" needs them at a
                  large setting — but never more, or one column drags the row. */}
              <Text
                style={styles.statLabel}
                numberOfLines={2}
                maxFontSizeMultiplier={HEADER_SCALE_CAP}
              >
                {s.label}
              </Text>
            </View>
          ))}
        </View>
      </View>

      {/* Taste chips ride the banner boundary: genres first (green outline),
          then subgenres (gray). Only as many as actually fit the line are
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

/** Average-score gauge: a ring filled to score/10, value centered. */
function AvgRing({ value }: { value: number | null }) {
  // The ring grows with the reader's text setting instead of holding a fixed
  // 59pt while the numeral inside it scales — which is what pushed "7.22" and
  // its AVG label out through the stroke at larger sizes.
  //
  // Circle and type scale by the *same* capped factor, so the numeral sits the
  // same way inside the ring at every setting. Capped rather than unbounded
  // because the ring shares a row with the name and the settings control, and
  // past ~1.35 it starts eating the name it sits beside.
  const { fontScale } = useWindowDimensions()
  const k = Math.min(Math.max(fontScale, 1), RING_SCALE_CAP)
  const R = 24 * k
  const SW = 4.5 * k
  const SIZE = (R + SW) * 2 + 2
  const C = 2 * Math.PI * R
  const frac = value != null ? Math.max(0, Math.min(1, value / 10)) : 0
  const mid = SIZE / 2
  return (
    <View style={{ width: SIZE, height: SIZE }}>
      <Svg width={SIZE} height={SIZE}>
        <Circle cx={mid} cy={mid} r={R} stroke="rgba(255,255,255,0.18)" strokeWidth={SW} fill="none" />
        {value != null && (
          <Circle
            cx={mid}
            cy={mid}
            r={R}
            stroke="#a9d5b4"
            strokeWidth={SW}
            fill="none"
            strokeDasharray={`${C * frac} ${C}`}
            strokeLinecap="round"
            transform={`rotate(-90 ${mid} ${mid})`}
          />
        )}
      </Svg>
      {/* Padded so the numeral can never touch the stroke, and allowed to
          shrink inside that box — a three-digit score at the cap would
          otherwise still reach the ring on the narrowest phones. */}
      <View style={[styles.ringCenter, { padding: SW + 2 }]}>
        <Text
          style={[styles.ringValue, { fontSize: 13.5 * k }]}
          numberOfLines={1}
          adjustsFontSizeToFit
          maxFontSizeMultiplier={RING_SCALE_CAP}
        >
          {value != null ? value.toFixed(2) : '—'}
        </Text>
        <Text
          style={[styles.ringLabel, { fontSize: 7 * k }]}
          numberOfLines={1}
          maxFontSizeMultiplier={RING_SCALE_CAP}
        >
          AVG
        </Text>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  banner: {
    backgroundColor: colors.green,
    marginHorizontal: -spacing.lg,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.lg + 10,
  },
  // Taller than any realistic pull, and bled past both edges so it spans the
  // full width regardless of the banner's own horizontal padding.
  overscroll: {
    position: 'absolute',
    top: -600,
    left: -spacing.lg * 2,
    right: -spacing.lg * 2,
    height: 600,
    backgroundColor: colors.green,
  },
  bannerTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginTop: spacing.sm },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  avatarImg: { width: '100%', height: '100%' },
  avatarInitial: { fontFamily: fonts.display, fontSize: 24, color: colors.green },
  name: { fontFamily: fonts.displayBlack, fontSize: 25, color: '#ffffff', letterSpacing: 0.3 },
  since: { fontFamily: fonts.bodyMedium, fontSize: 12.5, color: 'rgba(255,255,255,0.65)', marginTop: 2 },

  ringCenter: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  ringValue: { fontFamily: fonts.display, fontSize: 13.5, color: '#ffffff' },
  ringLabel: { fontFamily: fonts.bodyBold, fontSize: 7, letterSpacing: 1, color: 'rgba(255,255,255,0.65)' },

  stats: { flexDirection: 'row', marginTop: spacing.lg },
  statCol: { flex: 1, alignItems: 'flex-start' },
  statValue: { fontFamily: fonts.display, fontSize: 22, color: '#ffffff' },
  statLabel: {
    fontFamily: fonts.bodyMedium,
    fontSize: 9.5,
    color: 'rgba(255,255,255,0.6)',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginTop: 2,
  },

  chipsRow: {
    flexDirection: 'row',
    flexWrap: 'nowrap',
    alignItems: 'center',
    gap: 6,
    marginTop: -14,
    zIndex: 2,
  },
  // Off-screen measuring row — natural widths, never painted.
  measure: { position: 'absolute', top: 0, left: 0, flexDirection: 'row', opacity: 0 },
  chipNatural: { flexShrink: 0 },
  chip: {
    backgroundColor: '#ffffff',
    borderRadius: radii.pill,
    borderWidth: 1.5,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  chipGenre: { borderColor: colors.green },
  chipGenreText: { fontFamily: fonts.bodySemiBold, fontSize: 12.5, color: colors.green },
  // The count chip is filled rather than outlined, so it reads as a control
  // next to the tag labels instead of another tag.
  chipMore: { backgroundColor: colors.inset, borderColor: colors.inset },
  chipMoreText: { fontFamily: fonts.bodySemiBold, fontSize: 12.5, color: colors.inkTertiary },
  subRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6, marginTop: spacing.sm },
  chipSub: { borderColor: '#c9c2b8' },
  chipSubText: { fontFamily: fonts.bodyMedium, fontSize: 12.5, color: colors.inkTertiary },

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
