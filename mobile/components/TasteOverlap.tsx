// How alike your taste and someone else's is, on their profile (spec §5.1). The
// mobile twin of frontend/src/components/TasteOverlap.tsx.
//
// One pill under the profile's header, the same for a friend and a stranger:
// your two faces side by side, the number with "taste overlap", and the records
// you have both rated — the first few covers and a count of the rest. Tapping
// the number compares the record that connects you; a cover compares that
// record. 50% is drawn like any other number: a pair with no evidence and a
// pair measured at the middle look the same on purpose.
import { Pressable, StyleSheet, Text, View } from 'react-native'
import type { Overlap } from '@pressd/shared/types'
import Avatar from './Avatar'
import CoverImage from './CoverImage'
import { selection } from '../lib/haptics'
import { colors, fonts, spacing, NUM_SCALE_CAP } from '../theme/tokens'

/** Where tapping the number goes: the record the reason names, else the one
 *  that connects you; null when there's no shared record. */
export function compareAlbumId(overlap: Overlap): number | null {
  return overlap.reason?.albumId ?? overlap.connectingAlbum?.id ?? overlap.connectingAlbumId ?? null
}

type Face = { name: string; avatarUrl?: string | null }

const FACE = 30
const COVER = 30
const PILL_BG = '#dfe9e2'

export function OverlapPill({ overlap, me, them, onCompare }: {
  overlap: Overlap
  me: Face
  them: Face
  /** An album id to compare, or null to open their library. */
  onCompare: (albumId: number | null) => void
}) {
  if (overlap.percent == null) return null
  const covers = overlap.sharedRecords
  const more = overlap.sharedCount - covers.length
  return (
    <View style={styles.pill}>
      <Pressable
        style={styles.number}
        onPress={() => { selection(); onCompare(compareAlbumId(overlap)) }}
        accessibilityRole="button"
        accessibilityLabel={`${overlap.percent}% taste overlap`}
      >
        <View style={styles.faces}>
          {[me, them].map((f, i) => (
            <View key={i} style={[styles.ring, i > 0 && { marginLeft: -10 }, { zIndex: 2 - i }]}>
              <Avatar name={f.name} avatarUrl={f.avatarUrl} size={FACE} />
            </View>
          ))}
        </View>
        <Text style={styles.percent} maxFontSizeMultiplier={NUM_SCALE_CAP}>{overlap.percent}%</Text>
        <Text style={styles.label} numberOfLines={1} maxFontSizeMultiplier={NUM_SCALE_CAP}>taste overlap</Text>
      </Pressable>

      {covers.length > 0 && (
        <>
          <View style={styles.divider} />
          <View style={styles.covers}>
            {covers.map((c, i) => (
              <Pressable
                key={c.id}
                onPress={() => { selection(); onCompare(c.id) }}
                style={[styles.coverRing, i > 0 && { marginLeft: -9 }, { zIndex: covers.length - i }]}
                accessibilityRole="button"
                accessibilityLabel={`Compare ${c.name}`}
              >
                <CoverImage url={c.artUrl} displayPx={COVER} style={styles.cover} />
              </Pressable>
            ))}
          </View>
          {more > 0 && <Text style={styles.more} maxFontSizeMultiplier={NUM_SCALE_CAP}>+{more}</Text>}
        </>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  pill: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.md,
    paddingVertical: 5,
    paddingLeft: 5,
    paddingRight: 14,
    borderRadius: 999,
    backgroundColor: PILL_BG,
  },
  number: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  faces: { flexDirection: 'row' },
  ring: { borderRadius: 999, padding: 2, backgroundColor: PILL_BG },
  percent: { fontFamily: fonts.display, fontSize: 21, lineHeight: 26, color: colors.green, fontVariant: ['tabular-nums'] },
  label: { fontFamily: fonts.bodySemiBold, fontSize: 13, color: colors.green },
  divider: { width: StyleSheet.hairlineWidth * 2, height: 24, backgroundColor: 'rgba(45,106,79,0.25)' },
  covers: { flexDirection: 'row' },
  coverRing: { borderRadius: 8, padding: 2, backgroundColor: PILL_BG },
  cover: { width: COVER, height: COVER, borderRadius: 6 },
  more: { fontFamily: fonts.bodySemiBold, fontSize: 13, color: colors.green, fontVariant: ['tabular-nums'] },
})
