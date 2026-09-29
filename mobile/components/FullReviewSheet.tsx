// One person's full rating of a record, opened from their post in its thread:
// the score on the post, then the working behind it — four factors, every song
// in track order, and what they wrote. The mobile twin of
// frontend/src/components/FullReviewModal.tsx.
//
// Reached only from a thread, and only for the record the thread is about.
// The server scopes it the same way (discussions.post_author_rating): a room
// shows you how the people in it heard the record, never their libraries.
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useQuery } from '@tanstack/react-query'
import { Triangle, X } from 'lucide-react-native'
import { songScoreColor } from '@pressd/shared/types'
import { fetchPostAuthorRating } from '../lib/api'
import Avatar from './Avatar'
import { colors, fonts, radii, spacing, NUM_SCALE_CAP } from '../theme/tokens'

const DOWN = '#e0492b'

const FACTORS = [
  { key: 'theme', label: 'Theme / Cohesion' },
  { key: 'replayValue', label: 'Replay Value' },
  { key: 'production', label: 'Production' },
  { key: 'distinctness', label: 'Distinctness' },
] as const

function ratedOn(iso: string | null): string | null {
  if (!iso) return null
  // A date, not a timestamp: parse as local so it doesn't slip a day west of UTC.
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })
}

export default function FullReviewSheet({ postId, onClose }: { postId: number | null; onClose: () => void }) {
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['postRating', postId],
    queryFn: () => fetchPostAuthorRating(postId!),
    enabled: postId != null,
    staleTime: 60_000,
  })

  const scored = data?.songs.filter((s) => s.score != null) ?? []
  const best = scored.length > 1 ? Math.max(...scored.map((s) => s.score!)) : null
  const worst = scored.length > 1 ? Math.min(...scored.map((s) => s.score!)) : null
  // The explicit pick when they made one (TopSongTiebreak); otherwise every
  // track tied at the top is marked, rather than one chosen by sort order.
  const isTop = (s: { id: number; score: number | null }) =>
    data?.topSongId != null ? s.id === data.topSongId : s.score != null && s.score === best
  const hasFactors = !!data && FACTORS.some((f) => data[f.key] != null)
  const rated = ratedOn(data?.dateRated ?? null)

  return (
    <Modal visible={postId != null} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={styles.sheet}>
        <View style={styles.head}>
          <Text style={styles.eyebrow}>FULL REVIEW</Text>
          <Pressable onPress={onClose} hitSlop={12} accessibilityLabel="Close">
            <X size={20} color={colors.inkTertiary} />
          </Pressable>
        </View>

        {isLoading ? (
          <ActivityIndicator color={colors.green} style={{ marginTop: spacing.xxl }} />
        ) : isError || !data ? (
          <Text style={styles.empty}>{(error as Error)?.message || 'Could not load that review.'}</Text>
        ) : (
          <ScrollView contentContainerStyle={styles.body}>
            <View style={styles.who}>
              <Avatar name={data.author.name} avatarUrl={data.author.avatarUrl} size={44} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.name} numberOfLines={1}>{data.author.name}</Text>
                <Text style={styles.meta} numberOfLines={2}>
                  on {data.albumName} · {data.artist}{rated ? ` · rated ${rated}` : ''}
                </Text>
              </View>
            </View>

            {data.score != null && (
              <View style={styles.scoreRow}>
                <Text style={[styles.score, { color: songScoreColor(data.score) }]} maxFontSizeMultiplier={NUM_SCALE_CAP}>
                  {data.score.toFixed(2)}
                </Text>
                <Text style={styles.scoreLabel}>FINAL SCORE</Text>
              </View>
            )}

            {/* EPs skip the four factors, so there is nothing to show. */}
            {hasFactors && (
              <View style={styles.factors}>
                {FACTORS.map((f) => {
                  const v = data[f.key]
                  return (
                    <View key={f.key} style={styles.factor}>
                      <Text style={styles.factorLabel} numberOfLines={1}>{f.label}</Text>
                      <Text
                        style={[styles.factorValue, { color: v != null ? songScoreColor(v) : colors.inkMuted }]}
                        maxFontSizeMultiplier={NUM_SCALE_CAP}
                      >
                        {v != null ? v.toFixed(1) : '—'}
                      </Text>
                    </View>
                  )
                })}
              </View>
            )}

            {!!data.review?.trim() && (
              <>
                <Text style={styles.section}>REVIEW</Text>
                <Text style={styles.review}>{data.review}</Text>
              </>
            )}

            <Text style={styles.section}>TRACK BY TRACK</Text>
            {data.songs.map((s, i) => (
              <View key={s.id} style={styles.track}>
                <Text style={styles.trackNum} maxFontSizeMultiplier={NUM_SCALE_CAP}>{s.trackNumber ?? i + 1}</Text>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <View style={styles.trackTop}>
                    <Text
                      style={[
                        styles.trackTitle,
                        s.score == null && styles.trackSkipped,
                        s.score != null && isTop(s) && styles.trackMarked,
                      ]}
                      numberOfLines={1}
                    >
                      {s.title}
                    </Text>
                    {s.score != null && isTop(s) && <Triangle size={9} color={colors.green} />}
                    {s.score != null && s.score === worst && worst !== best && (
                      <View style={{ transform: [{ rotate: '180deg' }] }}>
                        <Triangle size={9} color={DOWN} />
                      </View>
                    )}
                  </View>
                  {s.score != null && (
                    <View style={styles.bar}>
                      <View style={[styles.barFill, { width: `${s.score * 10}%`, backgroundColor: songScoreColor(s.score) }]} />
                    </View>
                  )}
                </View>
                <Text
                  style={[styles.trackScore, { color: s.score != null ? songScoreColor(s.score) : colors.inkMuted }]}
                  maxFontSizeMultiplier={NUM_SCALE_CAP}
                >
                  {s.score != null ? s.score.toFixed(1) : 'skip'}
                </Text>
              </View>
            ))}
          </ScrollView>
        )}
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  sheet: { flex: 1, backgroundColor: colors.bg },
  head: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: spacing.xl, paddingTop: spacing.lg, paddingBottom: spacing.sm,
  },
  eyebrow: { fontFamily: fonts.bodyBold, fontSize: 11, letterSpacing: 1.6, color: colors.green },
  empty: { fontFamily: fonts.body, fontSize: 14, color: colors.inkTertiary, textAlign: 'center', marginTop: spacing.xxl },
  body: { paddingHorizontal: spacing.xl, paddingBottom: spacing.xxl },

  who: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginTop: spacing.sm },
  name: { fontFamily: fonts.bodySemiBold, fontSize: 17, color: colors.ink },
  meta: { fontFamily: fonts.body, fontSize: 12.5, color: colors.inkTertiary, marginTop: 1 },

  scoreRow: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm, marginTop: spacing.lg },
  score: { fontFamily: fonts.displayBlack, fontSize: 52, lineHeight: 58 },
  scoreLabel: { fontFamily: fonts.bodyBold, fontSize: 10, letterSpacing: 1.4, color: colors.inkMuted, marginBottom: 10 },

  factors: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.md },
  factor: {
    width: '48%', flexGrow: 1, backgroundColor: colors.raised, borderRadius: radii.md,
    borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
  },
  factorLabel: { fontFamily: fonts.bodyMedium, fontSize: 11, color: colors.inkTertiary },
  factorValue: { fontFamily: fonts.display, fontSize: 20, marginTop: 2 },

  section: {
    fontFamily: fonts.bodyBold, fontSize: 10.5, letterSpacing: 1.6, color: colors.inkMuted,
    marginTop: spacing.xl, marginBottom: spacing.sm,
  },
  review: { fontFamily: fonts.displayRegular, fontSize: 15.5, lineHeight: 24, color: colors.ink },

  track: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 5 },
  trackNum: { width: 20, textAlign: 'right', fontFamily: fonts.body, fontSize: 11.5, color: colors.inkMuted },
  trackTop: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  trackTitle: { flexShrink: 1, fontFamily: fonts.body, fontSize: 13.5, color: colors.inkSecondary },
  trackMarked: { fontFamily: fonts.bodySemiBold, color: colors.ink },
  trackSkipped: { color: colors.inkMuted, fontStyle: 'italic' },
  bar: { height: 3, borderRadius: 2, backgroundColor: colors.inset, overflow: 'hidden', marginTop: 4 },
  barFill: { height: '100%', borderRadius: 2 },
  trackScore: { width: 34, textAlign: 'right', fontFamily: fonts.display, fontSize: 14.5 },
})
