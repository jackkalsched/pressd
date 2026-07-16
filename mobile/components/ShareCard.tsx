// Post-rating summary card — the automatic payoff after submitting, and a
// shareable image. Mirrors the web ShareCard's content (final score, factor
// breakdown or EP average, bang/skip tallies, top track) in a native layout,
// and exports the card view as a PNG to the iOS share sheet.
import { useRef, useState } from 'react'
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Image } from 'expo-image'
import { captureRef } from 'react-native-view-shot'
import * as Sharing from 'expo-sharing'
import { Share2, X } from 'lucide-react-native'
import {
  songScoreColor,
  BANG_THRESHOLD,
  SKIP_THRESHOLD,
  EP_MAX_TRACKS,
  type Album,
} from '@pressd/shared/types'
import { colors, fonts, radii, spacing } from '../theme/tokens'

export default function ShareCard({ album, onClose }: { album: Album; onClose: () => void }) {
  const cardRef = useRef<View>(null)
  const [sharing, setSharing] = useState(false)

  const rated = album.songs.filter((s) => s.score !== null)
  const bangs = rated.filter((s) => s.score! >= BANG_THRESHOLD).length
  const skips = rated.filter((s) => s.score! < SKIP_THRESHOLD).length
  const topSong = rated.length
    ? [...rated].sort((a, b) => b.score! - a.score!)[0]
    : null
  const isLP = album.songs.length > EP_MAX_TRACKS
  const scoreColor = album.score !== null ? songScoreColor(album.score) : colors.green

  const factors: { label: string; value: number | null }[] = isLP
    ? [
        { label: 'Theme', value: album.theme },
        { label: 'Replay', value: album.replayValue },
        { label: 'Production', value: album.production },
        { label: 'Distinct', value: album.distinctness },
      ]
    : []

  async function share() {
    if (sharing) return
    setSharing(true)
    try {
      const uri = await captureRef(cardRef, { format: 'png', quality: 1 })
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, { mimeType: 'image/png', dialogTitle: album.albumName })
      }
    } catch {
      /* user dismissed or capture unavailable — the card is still on screen */
    } finally {
      setSharing(false)
    }
  }

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Share card</Text>
        <Pressable onPress={onClose} hitSlop={12}>
          <X size={22} color={colors.inkTertiary} />
        </Pressable>
      </View>

      <View style={styles.cardWrap}>
        {/* Captured region */}
        <View ref={cardRef} collapsable={false} style={styles.card}>
          <View style={styles.cardTop}>
            {album.albumArtUrl ? (
              <Image source={{ uri: album.albumArtUrl }} style={styles.art} contentFit="cover" />
            ) : (
              <View style={[styles.art, styles.artFallback]}>
                <Text style={styles.artInitial}>{album.albumName[0]}</Text>
              </View>
            )}
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

          <Text style={[styles.bigScore, { color: scoreColor }]}>
            {album.score !== null ? album.score.toFixed(2) : '—'}
          </Text>
          <Text style={styles.bigScoreLabel}>FINAL SCORE</Text>

          {factors.length > 0 && (
            <View style={styles.factorRow}>
              {factors.map((f) => (
                <View key={f.label} style={styles.factorCell}>
                  <Text style={styles.factorValue}>{f.value !== null ? f.value.toFixed(1) : '—'}</Text>
                  <Text style={styles.factorLabel}>{f.label}</Text>
                </View>
              ))}
            </View>
          )}

          <View style={styles.statRow}>
            <Stat value={String(bangs)} label="bangs" />
            <Stat value={String(skips)} label="skips" />
            <Stat value={String(rated.length)} label="tracks" />
          </View>

          {topSong && (
            <View style={styles.topTrack}>
              <Text style={styles.topTrackLabel}>TOP TRACK</Text>
              <Text style={styles.topTrackName} numberOfLines={1}>{topSong.title}</Text>
              <Text style={[styles.topTrackScore, { color: songScoreColor(topSong.score!) }]}>
                {topSong.score!.toFixed(1)}
              </Text>
            </View>
          )}

          <Text style={styles.wordmark}>Press'd</Text>
        </View>
      </View>

      <View style={styles.actions}>
        <Pressable
          style={({ pressed }) => [styles.shareBtn, pressed && { backgroundColor: colors.greenPressed }]}
          onPress={share}
          disabled={sharing}
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

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  headerTitle: { fontFamily: fonts.bodySemiBold, fontSize: 16, color: colors.ink },
  cardWrap: { flex: 1, justifyContent: 'center', paddingHorizontal: spacing.lg },
  card: {
    backgroundColor: colors.raised,
    borderRadius: radii.xl,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.xl,
    alignItems: 'center',
  },
  cardTop: { alignItems: 'center' },
  art: { width: 132, height: 132, borderRadius: radii.md },
  artFallback: { backgroundColor: colors.inset, alignItems: 'center', justifyContent: 'center' },
  artInitial: { fontFamily: fonts.display, fontSize: 52, color: colors.inkMuted },
  albumName: {
    fontFamily: fonts.display,
    fontSize: 26,
    color: colors.ink,
    textAlign: 'center',
    marginTop: spacing.lg,
  },
  artist: { fontFamily: fonts.bodyMedium, fontSize: 14, color: colors.inkTertiary, marginTop: 6, textAlign: 'center' },
  genrePill: {
    marginTop: spacing.md,
    borderWidth: 1.5,
    borderColor: 'rgba(45,106,79,0.4)',
    borderRadius: radii.pill,
    paddingHorizontal: 13,
    paddingVertical: 4,
  },
  genrePillText: { fontFamily: fonts.bodyBold, fontSize: 11, letterSpacing: 1.4, color: colors.green },

  bigScore: { fontFamily: fonts.display, fontSize: 88, lineHeight: 92, marginTop: spacing.lg },
  bigScoreLabel: { fontFamily: fonts.bodyBold, fontSize: 11, letterSpacing: 1.6, color: colors.inkMuted },

  factorRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignSelf: 'stretch',
    marginTop: spacing.xl,
  },
  factorCell: { alignItems: 'center', flex: 1 },
  factorValue: { fontFamily: fonts.bodyBold, fontSize: 17, color: colors.ink },
  factorLabel: { fontFamily: fonts.bodyMedium, fontSize: 10, color: colors.inkTertiary, marginTop: 2 },

  statRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: spacing.xxl,
    marginTop: spacing.xl,
    paddingTop: spacing.lg,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    alignSelf: 'stretch',
  },
  stat: { alignItems: 'center' },
  statValue: { fontFamily: fonts.bodyBold, fontSize: 20, color: colors.ink },
  statLabel: { fontFamily: fonts.bodyMedium, fontSize: 11, color: colors.inkTertiary, marginTop: 2 },

  topTrack: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'stretch',
    marginTop: spacing.lg,
    backgroundColor: colors.bg,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    gap: spacing.sm,
  },
  topTrackLabel: { fontFamily: fonts.bodyBold, fontSize: 9, letterSpacing: 1, color: colors.inkMuted },
  topTrackName: { flex: 1, fontFamily: fonts.bodyMedium, fontSize: 13, color: colors.ink },
  topTrackScore: { fontFamily: fonts.bodyBold, fontSize: 15 },

  wordmark: {
    fontFamily: fonts.display,
    fontSize: 18,
    color: colors.inkMuted,
    letterSpacing: 1,
    marginTop: spacing.xl,
  },

  actions: { flexDirection: 'row', gap: spacing.md, paddingHorizontal: spacing.lg, paddingBottom: spacing.md },
  shareBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.green,
    borderRadius: radii.md,
    paddingVertical: 15,
  },
  shareBtnText: { fontFamily: fonts.bodySemiBold, fontSize: 15, color: '#fff' },
  doneBtn: {
    paddingHorizontal: spacing.xl,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.raised,
  },
  doneBtnText: { fontFamily: fonts.bodyMedium, fontSize: 15, color: colors.inkSecondary },
})
