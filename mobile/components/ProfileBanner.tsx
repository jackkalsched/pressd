// The profile header, shared by your own Profile tab and someone else's page:
// the banner edge to edge, the avatar riding up over its bottom edge with three
// figures beside it (albums, songs, the average), the name with its stickers and
// the viewer's control, the bio, someone else's taste overlap, taste chips, and
// their shelf below. The `action` slot holds whatever control belongs to the
// viewer (settings on your own page, the friend button on someone else's).
//
// The person's banner, sharp, Pressd green when there is none. It used to be
// their picture or favourite album blurred into a wash, which made an uploaded
// banner unrecognisable. The numbers stay unboxed in Playfair; the average is
// written in its own score colour.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { AccessibilityInfo, Pressable, StyleSheet, Text, useWindowDimensions, View, type ColorValue } from 'react-native'
import { Image } from 'expo-image'
import { LinearGradient } from 'expo-linear-gradient'
import { useRouter } from 'expo-router'
import { MapPin, Plus } from 'lucide-react-native'
import { SHELF_SIZE, type Profile } from '@pressd/shared/api'
import { avatarColor } from '@pressd/shared/types'
import { colors, fonts, radii, spacing, useColors, scoreColor } from '../theme/tokens'
import CoverImage from './CoverImage'

// The server stores banners 24:5 (BANNER_SIZE, backend/routers/users.py). At phone
// width that is a sliver, so the strip stands this tall and takes the crop from
// the sides, BANNER_INSET from the screen's edges and below the status bar.
const BANNER_HEIGHT = 112
const BANNER_INSET = 6

// The avatar, its ring in the page colour, and how much of it the banner covers.
const AVATAR = 80
const AVATAR_RING = 4
const AVATAR_OVERLAP = 40
// The disc's inset from the content edge, and where the picture itself begins.
const AVATAR_LEFT = 4
const AVATAR_EDGE = AVATAR_LEFT + AVATAR_RING

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
  overlap,
  stickers,
  bannerAction,
  countKey,
  profile,
  onShelfSlotPress,
}: {
  name: string
  avatarUrl?: string | null
  avg: number | null
  stats: BannerStatItem[]
  genres: string[]
  subgenres: string[]
  action?: ReactNode
  topInset: number
  /** Right under the name: the prose belongs with the identity it describes. */
  bio?: string | null
  /** Someone else's taste overlap, between the bio and the average. */
  overlap?: ReactNode
  /** Earned stickers, drawn on the name's line to its right. Nothing passes
   *  them yet; the slot is there so the line already leaves them room. */
  stickers?: ReactNode
  /** Names one visit to this profile. The figures count up once per visit:
   *  the list rebuilding the header (Library → Stats → Rankings) keeps the
   *  same key, so they hold their value; a new key counts them up again. */
  countKey: string
  /** A control pinned to the banner's top-right corner (Settings, on your own page). */
  bannerAction?: ReactNode
  /** Picks come from GET /users/{id}/profile; the row hides itself until the
   *  ten-album bar is cleared, so a new account never shows three empty slots. */
  profile?: Profile | null
  /** Only your own page passes this: a slot was tapped, to fill or change it.
   *  On someone else's page a cover opens their copy of the album. */
  onShelfSlotPress?: (slot: number) => void
}) {
  const tc = useColors()
  // One chip's height: the row is held to it, so the tags that don't fit
  // whole wrap out of sight rather than squeezing or adding a line.
  const [chipH, setChipH] = useState(0)

  // Genres lead, subgenres follow.
  const tags = useMemo(
    () => [
      ...genres.map((label) => ({ label, sub: false })),
      ...subgenres.map((label) => ({ label, sub: true })),
    ],
    [genres, subgenres],
  )
  // The caller's counts, then the average in its own score colour.
  const figures: (BannerStatItem & { color?: ColorValue })[] = [
    ...stats,
    { value: avg != null ? avg.toFixed(2) : '—', label: 'Avg score', color: avg != null ? scoreColor(avg) : undefined },
  ]

  return (
    <>
      <View style={styles.banner}>
        <View style={{ height: topInset + BANNER_INSET }} />
        <View>
          <BannerStrip url={profile?.banner_url} height={BANNER_HEIGHT} />
          {bannerAction ? <View style={styles.bannerAction}>{bannerAction}</View> : null}
        </View>

        {/* The avatar rides up over the banner's bottom edge; the figures sit
            beside it, level with the part below the picture. */}
        <View style={styles.headRow}>
          <PlainAvatar name={name} avatarUrl={avatarUrl} />
          <View style={styles.figures}>
            {figures.map((s) => (
              <View key={s.label} style={styles.figure}>
                {/* Held to one line: unbounded, "5,692" wrapped and pushed its
                    own label out of line. No adjustsFontSizeToFit: on iOS, with
                    a set lineHeight, it collapsed "458" to a few points in a
                    cell with room to spare. */}
                <Text style={[styles.statValue, s.color ? { color: s.color } : null]} numberOfLines={1} maxFontSizeMultiplier={HEADER_SCALE_CAP}>
                  <CountUp value={s.value} cacheKey={`${countKey}:${s.label}`} />
                </Text>
                <Text style={styles.statLabel} numberOfLines={1} maxFontSizeMultiplier={HEADER_SCALE_CAP}>
                  {s.label}
                </Text>
              </View>
            ))}
          </View>
        </View>

        {/* The name shares its line with the stickers slot, so it shrinks
            before they do, and with the viewer's control at the far end. */}
        <View style={styles.nameRow}>
          <View style={styles.nameCell}>
            {/* Full size, cut short with "…" when long. No adjustsFontSizeToFit:
                in a row it shrinks the name well past what the room needs. */}
            <Text style={styles.name} numberOfLines={1} maxFontSizeMultiplier={HEADER_SCALE_CAP}>
              {name}
            </Text>
            {stickers ? <View style={styles.stickers}>{stickers}</View> : null}
          </View>
          {action ? <View>{action}</View> : null}
        </View>
        {/* The handle, and where they say they are when they've said. The
            location gives way first on a narrow line. */}
        <View style={styles.handleRow}>
          <Text style={styles.handle} numberOfLines={1} maxFontSizeMultiplier={HEADER_SCALE_CAP}>@{name}</Text>
          {profile?.location ? (
            <>
              <Text style={styles.handleSep} maxFontSizeMultiplier={HEADER_SCALE_CAP}>|</Text>
              <MapPin size={12} color={tc.inkTertiary} strokeWidth={2.2} />
              <Text style={[styles.handle, styles.location]} numberOfLines={1} maxFontSizeMultiplier={HEADER_SCALE_CAP}>
                {profile.location}
              </Text>
            </>
          ) : null}
        </View>
        {bio ? <Text style={styles.bio} maxFontSizeMultiplier={HEADER_SCALE_CAP}>{bio}</Text> : null}

        {overlap}

        {/* Taste chips, last thing in the header: genres first (green), then
            subgenres (white). Borderless and translucent, so they read as part of
            the page rather than as white boxes laid over it. As many as fit
            the line whole, in order, at their own width; never cut short. */}
        {tags.length > 0 && (
          // Hidden until the first chip has said how tall a line is, so the
          // wrapped extras never flash on screen.
          <View style={[styles.chipsRow, { height: chipH || undefined, opacity: chipH ? 1 : 0 }]}>
            {tags.map((t, i) => (
              <View
                key={t.label}
                style={[styles.chip, t.sub ? styles.chipSub : styles.chipGenre]}
                onLayout={i === 0 ? (e) => setChipH(Math.ceil(e.nativeEvent.layout.height)) : undefined}
              >
                <Text style={t.sub ? styles.chipSubText : styles.chipGenreText}>{t.label}</Text>
              </View>
            ))}
          </View>
        )}
      </View>

      <ShelfRow profile={profile} name={name} onSlotPress={onShelfSlotPress} />
    </>
  )
}

/** "jack's", "james'": the shelf is named for whoever's page it is. */
function possessive(name: string): string {
  return /s$/i.test(name) ? `${name}'` : `${name}'s`
}

// Each cover's lean and lift along the shelf, so the row reads as records stood
// up by hand rather than a grid.
const SHELF_TILT = [-3, 2, -1.5, 2.5]
const SHELF_LIFT = [0, -7, -2, -8]
const SHELF_OVERLAP = 18

/** The shelf: four of their rated albums, overlapping and staggered.
 *
 *  Hidden wholesale below the unlock bar, as the picks were: the server refuses
 *  to fill it that early anyway. On your own page every slot shows, the empty
 *  ones as the invitation to fill them; on someone else's only the albums do,
 *  and a bare shelf isn't drawn at all.
 */
function ShelfRow({
  profile,
  name,
  onSlotPress,
}: {
  profile?: Profile | null
  name: string
  onSlotPress?: (slot: number) => void
}) {
  const tc = useColors()
  const router = useRouter()
  const { width } = useWindowDimensions()
  if (!profile?.picks_unlocked) return null

  const editable = !!onSlotPress
  const slots = (profile.shelf ?? []).slice(0, SHELF_SIZE).map((album, slot) => ({ album, slot }))
  const shown = editable ? slots : slots.filter((s) => s.album)
  if (shown.length === 0) return null

  // Four covers across the content width, each overlapping the last.
  const rowW = width - spacing.lg * 2
  const cover = (rowW + SHELF_OVERLAP * (SHELF_SIZE - 1)) / SHELF_SIZE

  return (
    <View style={styles.shelf}>
      <Text style={styles.shelfHeading} numberOfLines={1}>{possessive(name)} shelf</Text>
      <View style={styles.shelfRow}>
        {shown.map(({ album, slot }, i) => (
          <Pressable
            key={slot}
            onPress={() => (editable ? onSlotPress!(slot) : album && router.push(`/album/${album.id}`))}
            style={[
              styles.shelfItem,
              {
                width: cover,
                height: cover,
                marginLeft: i > 0 ? -SHELF_OVERLAP : 0,
                zIndex: i,
                transform: [{ translateY: SHELF_LIFT[i] }, { rotate: `${SHELF_TILT[i]}deg` }],
              },
            ]}
            accessibilityRole="button"
            accessibilityLabel={
              album
                ? `${album.album_name} by ${album.artist}${editable ? '. Change' : ''}`
                : 'Add an album to your shelf'
            }
          >
            {album ? (
              <View style={styles.shelfCover}>
                <Text style={styles.shelfInitial}>{album.album_name[0]?.toUpperCase()}</Text>
                {album.album_art_url ? (
                  <CoverImage url={album.album_art_url} displayPx={Math.round(cover)} style={StyleSheet.absoluteFill} />
                ) : null}
              </View>
            ) : (
              <View style={[styles.shelfCover, [styles.shelfEmpty, { borderColor: tc.border }]]}>
                <Plus size={20} color={tc.inkMuted} strokeWidth={2} />
              </View>
            )}
          </Pressable>
        ))}
      </View>
    </View>
  )
}

const COUNT_MS = 1300

// Where each figure last got to, by visit and label, so a header rebuilt
// mid-visit starts from there rather than from zero.
const counted = new Map<string, number>()

/** A figure that counts up to its value as the profile loads — "6,098" from
 *  zero, "7.22" through the decimals — and from the old value when it changes.
 *  Anything that isn't a number ("—") is shown as it is, and Reduce Motion
 *  shows the value straight away. */
function CountUp({ value, cacheKey }: { value: string; cacheKey: string }) {
  const target = Number(value.replace(/,/g, ''))
  const numeric = value.trim() !== '' && Number.isFinite(target)
  const decimals = numeric ? (value.split('.')[1]?.length ?? 0) : 0
  const grouped = value.includes(',')
  const [shown, setShown] = useState(() => counted.get(cacheKey) ?? 0)
  const from = useRef(counted.get(cacheKey) ?? 0)

  useEffect(() => {
    if (!numeric) return
    let frame = 0
    let cancelled = false
    const start = from.current
    AccessibilityInfo.isReduceMotionEnabled().then((reduce) => {
      if (cancelled) return
      if (reduce || start === target) {
        from.current = target
        counted.set(cacheKey, target)
        setShown(target)
        return
      }
      const t0 = Date.now()
      const tick = () => {
        const t = Math.min(1, (Date.now() - t0) / COUNT_MS)
        // Quintic ease-out: most of the climb early, a long settle into the value.
        const eased = 1 - Math.pow(1 - t, 5)
        const v = start + (target - start) * eased
        from.current = v
        counted.set(cacheKey, v)
        setShown(v)
        if (t < 1) frame = requestAnimationFrame(tick)
      }
      frame = requestAnimationFrame(tick)
    })
    return () => {
      cancelled = true
      cancelAnimationFrame(frame)
    }
  }, [numeric, target, cacheKey])

  if (!numeric) return <>{value}</>
  const text = decimals > 0 ? shown.toFixed(decimals) : Math.round(shown).toString()
  return <>{grouped ? Number(text).toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals }) : text}</>
}

/** Their picture exactly as uploaded, or Pressd green, edge to edge and up under
 *  the status bar. A plain image rather than CoverImage: that sizes album covers
 *  per host, and a banner has one size. */
function BannerStrip({ url, height }: { url?: string | null; height: number }) {
  return (
    <View style={[styles.strip, { height }]} pointerEvents="none">
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

/** The avatar in a ring of the page's own colour, so it reads as cut out of the
 *  banner it overlaps. Fixed size: the figures beside it give way instead. */
function PlainAvatar({ name, avatarUrl }: { name: string; avatarUrl?: string | null }) {
  return (
    <View style={styles.avatarDisc}>
      <View style={[styles.avatar, { backgroundColor: avatarColor(name) }]}>
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
          <Text style={styles.avatarInitial} numberOfLines={1} maxFontSizeMultiplier={1}>
            {name[0]?.toUpperCase()}
          </Text>
        )}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  banner: { paddingBottom: 20 },
  // Nearly edge to edge: the list pads its content by spacing.lg, and the strip
  // takes back all but BANNER_INSET of it, below the status bar.
  strip: {
    marginHorizontal: -(spacing.lg - BANNER_INSET),
    borderRadius: radii.lg,
    overflow: 'hidden',
    backgroundColor: colors.green,
  },

  bannerAction: { position: 'absolute', top: spacing.sm, right: -(spacing.lg - BANNER_INSET) + spacing.sm },

  // Pulled up so the banner covers the avatar's top AVATAR_OVERLAP points.
  headRow: { flexDirection: 'row', marginTop: -AVATAR_OVERLAP, paddingLeft: AVATAR_LEFT },
  avatarDisc: {
    width: AVATAR + AVATAR_RING * 2,
    height: AVATAR + AVATAR_RING * 2,
    borderRadius: (AVATAR + AVATAR_RING * 2) / 2,
    padding: AVATAR_RING,
    backgroundColor: colors.bg,
  },
  avatar: {
    width: AVATAR,
    height: AVATAR,
    borderRadius: AVATAR / 2,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  avatarImg: { width: '100%', height: '100%' },
  avatarInitial: { fontFamily: fonts.display, fontSize: 32, color: '#ffffff' },
  // Starts just below the banner's edge, so the figures sit on the page.
  // Four figures beside the avatar, so the side padding is tight.
  figures: { flex: 1, minWidth: 0, flexDirection: 'row', justifyContent: 'space-between', paddingTop: AVATAR_OVERLAP + 14, paddingLeft: spacing.md, paddingRight: spacing.xs },
  figure: { alignItems: 'center', minWidth: 0, flexShrink: 1 },
  statValue: { fontFamily: fonts.display, fontSize: 18, lineHeight: 23, color: colors.ink, fontVariant: ['tabular-nums'] },
  statLabel: { fontFamily: fonts.bodyMedium, fontSize: 11.5, color: colors.inkTertiary, marginTop: 1 },

  // The name and its stickers share a line; the slot is empty until stickers exist.
  // Text lines up with the picture's edge, not the ring around it.
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginTop: 10, paddingLeft: AVATAR_EDGE },
  nameCell: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center' },
  name: { flexShrink: 1, fontFamily: fonts.displayBlack, fontSize: 25, lineHeight: 31, color: colors.ink, letterSpacing: 0.2 },
  handleRow: { flexDirection: 'row', alignItems: 'center', marginTop: 4, paddingLeft: AVATAR_EDGE },
  handle: { fontFamily: fonts.bodyMedium, fontSize: 13, color: colors.inkTertiary, flexShrink: 0 },
  handleSep: { fontFamily: fonts.body, fontSize: 13, color: colors.border, marginHorizontal: 7 },
  location: { flexShrink: 1, marginLeft: 3 },
  stickers: { flexDirection: 'row', alignItems: 'center', gap: 4, marginLeft: 6, flexShrink: 0 },

  // Wraps, but is clipped to one line: what wraps is simply not shown.
  chipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 6,
    rowGap: 20,
    marginTop: 16,
    overflow: 'hidden',
  },
  // No border; its own width, never shrunk.
  chip: {
    flexShrink: 0,
    borderRadius: radii.pill,
    paddingHorizontal: 11,
    paddingVertical: 5,
  },
  // Genres in the brand's soft green — the same fill as For You's range chip.
  chipGenre: { backgroundColor: 'rgba(45,106,79,0.12)' },
  chipGenreText: { fontFamily: fonts.bodySemiBold, fontSize: 12, color: colors.green },
  // Subgenres as frosted white on the page: present, but a step quieter.
  chipSub: { backgroundColor: colors.frost },
  chipSubText: { fontFamily: fonts.bodyMedium, fontSize: 12, color: colors.inkSecondary },

  bio: { fontFamily: fonts.body, fontSize: 14, color: colors.inkSecondary, lineHeight: 20, marginTop: spacing.sm, paddingLeft: AVATAR_EDGE },

  // Close under the taste chips: the banner already pads its own foot.
  shelf: { marginTop: 0 },
  shelfHeading: { fontFamily: fonts.wide, fontSize: 15, lineHeight: 20, color: colors.ink, letterSpacing: 0.2, marginBottom: spacing.md, paddingLeft: AVATAR_EDGE },
  // Room above for the lifted covers.
  shelfRow: { flexDirection: 'row', alignItems: 'flex-end', paddingTop: 10 },
  shelfItem: {
    borderRadius: radii.sm,
    shadowColor: '#2a1a0a',
    shadowOpacity: 0.28,
    shadowRadius: 6,
    shadowOffset: { width: 2, height: 4 },
  },
  shelfCover: {
    flex: 1,
    borderRadius: radii.sm,
    overflow: 'hidden',
    backgroundColor: colors.inset,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // An unfilled slot reads as an invitation, not as art that failed to load.
  shelfEmpty: {
    backgroundColor: colors.bg,
    borderWidth: 1.5,
    borderStyle: 'dashed',
  },
  shelfInitial: { fontFamily: fonts.display, fontSize: 26, color: colors.inkMuted },
})
