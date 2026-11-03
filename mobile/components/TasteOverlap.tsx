// How alike your taste and someone else's is, on their profile (spec §5.1). The
// mobile twin of frontend/src/components/TasteOverlap.tsx.
//
// Two shapes, by relationship. Someone you aren't friends with yet gets the
// panel: the number, where it sits on 0–100, the record that connects you, and
// the two things worth doing about it — add them, or compare that record. A
// friend gets only the chip and its line, because the case for adding them has
// already been made. 50% is drawn like any other number: a pair with no
// evidence and a pair measured at the middle look the same on purpose.
import type { ReactNode } from 'react'
import { ActivityIndicator, Pressable, StyleSheet, Text, View, type StyleProp, type TextStyle } from 'react-native'
import { Clock, UserPlus } from 'lucide-react-native'
import type { Overlap, TasteReason } from '@pressd/shared/types'
import CoverImage from './CoverImage'
import { selection } from '../lib/haptics'
import { colors, fonts, radii, spacing, NUM_SCALE_CAP } from '../theme/tokens'

// The server escapes every name it puts in `text` (html.escape, quote off) and
// wraps album titles in <i>; nothing else in it is markup.
const ENTITIES: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#x27;': "'", '&#39;': "'" }
const unescape = (s: string) => s.replace(/&(amp|lt|gt|quot|#x27|#39);/g, (m) => ENTITIES[m])

/** The reason's sentence with its album titles in italics. Only the literal
 *  `<i>…</i>` pairs become italic spans; every other character is text. */
export function ReasonText({ reason, style, numberOfLines }: {
  reason: TasteReason
  style?: StyleProp<TextStyle>
  numberOfLines?: number
}) {
  const parts: ReactNode[] = []
  const re = /<i>(.*?)<\/i>/g
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(reason.text)) !== null) {
    if (m.index > last) parts.push(unescape(reason.text.slice(last, m.index)))
    parts.push(<Text key={m.index} style={styles.italic}>{unescape(m[1])}</Text>)
    last = re.lastIndex
  }
  if (last < reason.text.length) parts.push(unescape(reason.text.slice(last)))
  return <Text style={style} numberOfLines={numberOfLines}>{parts}</Text>
}

/** 0 on the left, 100 on the right, a mark where you two sit. */
function Meter({ percent }: { percent: number }) {
  const at = Math.max(0, Math.min(100, percent))
  return (
    <View>
      <View style={styles.track}>
        <View style={[styles.fill, { width: `${at}%` }]} />
        <View style={[styles.mark, { left: `${at}%` }]} />
      </View>
      <View style={styles.ticks}>
        {['0', '50', '100'].map((t) => (
          <Text key={t} style={styles.tick} maxFontSizeMultiplier={NUM_SCALE_CAP}>{t}</Text>
        ))}
      </View>
    </View>
  )
}

/** Where Compare goes: the record the reason names, else the one that
 *  connects you; null when there's no shared record. */
export function compareAlbumId(overlap: Overlap): number | null {
  return overlap.reason?.albumId ?? overlap.connectingAlbum?.id ?? overlap.connectingAlbumId ?? null
}

export function OverlapPanel({
  overlap, person, onAdd, requested, theyAsked = false, busy = false, onCompare, onOpenAlbum,
}: {
  overlap: Overlap
  person: { name: string }
  /** The profile's own friend handler, so this reads as the header button does. */
  onAdd: () => void
  requested: boolean
  theyAsked?: boolean
  busy?: boolean
  /** The shared record's id, or null for their library. */
  onCompare: (albumId: number | null) => void
  onOpenAlbum: (albumId: number) => void
}) {
  if (overlap.percent == null) return null
  const record = overlap.connectingAlbum
  return (
    <View style={styles.panel}>
      <Text style={styles.eyebrow} numberOfLines={1}>YOU &amp; {person.name.toUpperCase()}</Text>
      <Text style={styles.percent} maxFontSizeMultiplier={NUM_SCALE_CAP}>{overlap.percent}%</Text>
      <Meter percent={overlap.percent} />

      {(overlap.reason || record) && (
        <View style={styles.reasonRow}>
          {record && (
            <Pressable
              onPress={() => { selection(); onOpenAlbum(record.id) }}
              accessibilityRole="button"
              accessibilityLabel={`Open ${record.name}`}
            >
              {record.artUrl ? (
                <CoverImage url={record.artUrl} displayPx={44} style={styles.cover} />
              ) : (
                <View style={[styles.cover, styles.coverFallback]}>
                  <Text style={styles.coverInitial}>{record.name[0]?.toUpperCase()}</Text>
                </View>
              )}
            </Pressable>
          )}
          {overlap.reason && <ReasonText reason={overlap.reason} style={styles.reason} />}
        </View>
      )}

      <View style={styles.actions}>
        <Pressable
          style={[styles.addBtn, requested && styles.addBtnOn, busy && { opacity: 0.6 }]}
          onPress={() => { selection(); onAdd() }}
          disabled={busy || requested}
          accessibilityLabel={requested ? 'Friend request sent' : theyAsked ? 'Accept friend request' : 'Add friend'}
        >
          {busy ? (
            <ActivityIndicator size="small" color={requested ? colors.green : '#ffffff'} />
          ) : requested ? (
            <Clock size={15} color={colors.green} strokeWidth={2.4} />
          ) : (
            <UserPlus size={15} color="#ffffff" strokeWidth={2.4} />
          )}
          <Text style={[styles.addText, requested && styles.addTextOn]} numberOfLines={1} maxFontSizeMultiplier={NUM_SCALE_CAP}>
            {requested ? 'Requested' : theyAsked ? 'Accept request' : 'Add friend'}
          </Text>
        </Pressable>
        <Pressable
          style={styles.compareBtn}
          onPress={() => { selection(); onCompare(compareAlbumId(overlap)) }}
          accessibilityRole="button"
        >
          <Text style={styles.compareText} numberOfLines={1} maxFontSizeMultiplier={NUM_SCALE_CAP}>Compare</Text>
        </Pressable>
      </View>
    </View>
  )
}

/** A friend's profile: the number as a chip, then the line. */
export function OverlapChip({ overlap }: { overlap: Overlap }) {
  if (overlap.percent == null) return null
  return (
    <View style={styles.chipWrap}>
      <View style={styles.chip}>
        <Text style={styles.chipPercent} maxFontSizeMultiplier={NUM_SCALE_CAP}>{overlap.percent}%</Text>
        <Text style={styles.chipLabel} maxFontSizeMultiplier={NUM_SCALE_CAP}>taste overlap</Text>
      </View>
      {overlap.reason && <ReasonText reason={overlap.reason} style={styles.chipReason} />}
    </View>
  )
}

const styles = StyleSheet.create({
  italic: { fontStyle: 'italic' },

  panel: {
    marginTop: spacing.xl,
    padding: spacing.lg,
    borderRadius: radii.xl,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: 'rgba(255,255,255,0.7)',
  },
  eyebrow: { fontFamily: fonts.bodyBold, fontSize: 11, letterSpacing: 1.2, color: colors.inkTertiary },
  percent: {
    fontFamily: fonts.display,
    fontSize: 48,
    lineHeight: 56,
    color: colors.green,
    marginTop: 2,
    marginBottom: spacing.sm,
    fontVariant: ['tabular-nums'],
  },

  track: { height: 8, borderRadius: 4, backgroundColor: 'rgba(45,106,79,0.15)', justifyContent: 'center' },
  fill: { position: 'absolute', top: 0, bottom: 0, left: 0, borderRadius: 4, backgroundColor: 'rgba(45,106,79,0.45)' },
  mark: { position: 'absolute', width: 6, height: 16, marginLeft: -3, borderRadius: 3, backgroundColor: colors.green },
  ticks: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 },
  tick: { fontFamily: fonts.body, fontSize: 11, color: colors.inkMuted, fontVariant: ['tabular-nums'] },

  reasonRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginTop: spacing.lg },
  cover: { width: 44, height: 44, borderRadius: radii.sm },
  coverFallback: { backgroundColor: colors.inset, alignItems: 'center', justifyContent: 'center' },
  coverInitial: { fontFamily: fonts.display, fontSize: 18, color: colors.inkMuted },
  reason: { flex: 1, minWidth: 0, fontFamily: fonts.body, fontSize: 14, lineHeight: 20, color: colors.inkSecondary },

  actions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg },
  addBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 11,
    borderRadius: radii.md,
    backgroundColor: colors.green,
  },
  addBtnOn: { backgroundColor: colors.greenSoft },
  addText: { fontFamily: fonts.bodySemiBold, fontSize: 14, color: '#ffffff' },
  addTextOn: { color: colors.green },
  compareBtn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 11,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: '#e2dbd0',
    backgroundColor: colors.raised,
  },
  compareText: { fontFamily: fonts.bodySemiBold, fontSize: 14, color: colors.green },

  chipWrap: { marginTop: spacing.lg, gap: spacing.sm },
  chip: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 6,
    paddingHorizontal: spacing.md,
    paddingVertical: 5,
    borderRadius: radii.pill,
    backgroundColor: colors.greenSoft,
  },
  chipPercent: { fontFamily: fonts.display, fontSize: 17, color: colors.green, fontVariant: ['tabular-nums'] },
  chipLabel: { fontFamily: fonts.bodySemiBold, fontSize: 13, color: colors.green },
  chipReason: { fontFamily: fonts.body, fontSize: 14, lineHeight: 20, color: colors.inkSecondary },
})
