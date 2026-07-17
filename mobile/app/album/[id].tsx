// Album detail — read view for any album, and the entry into the rating screen:
// "Rate" (to-listen), "Continue" (listening), or "Edit rating" (rated). Shows
// the final or predicted score, factor breakdown, and per-track scores.
import { useState } from 'react'
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Image } from 'expo-image'
import { ArrowLeft, Check, Pencil, Trash2 } from 'lucide-react-native'
import { fetchAlbum, saveReview, deleteReview } from '../../lib/api'
import { songScoreColor, EP_MAX_TRACKS, type Album } from '@pressd/shared/types'
import { useAuth } from '../../lib/auth'
import CommentThread from '../../components/CommentThread'
import AlbumBackdrop from '../../components/AlbumBackdrop'
import BangSkip from '../../components/BangSkip'
import { colors, fonts, radii, spacing } from '../../theme/tokens'

export default function AlbumDetail() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const albumId = Number(id)
  const router = useRouter()
  const { user } = useAuth()

  const { data: album, isLoading } = useQuery({
    queryKey: ['album', albumId],
    queryFn: () => fetchAlbum(albumId),
  })

  if (isLoading || !album) {
    return (
      <SafeAreaView style={[styles.screen, styles.center]}>
        <ActivityIndicator color={colors.green} />
      </SafeAreaView>
    )
  }

  const sorted = [...album.songs].sort((a, b) => (a.trackNumber ?? 0) - (b.trackNumber ?? 0))
  const isEP = album.songs.length <= EP_MAX_TRACKS
  const isRated = album.status === 'rated'
  const showScore = isRated ? album.score : album.predictedScore
  const scoreIsPredicted = !isRated && album.predictedScore != null

  const cta =
    album.status === 'rated' ? 'Edit rating' : album.status === 'listening' ? 'Continue' : 'Rate this album'
  const isMine = user != null && album.userId === user.id

  const factors: { label: string; value: number | null }[] = isEP
    ? []
    : [
        { label: 'Theme', value: album.theme },
        { label: 'Replay', value: album.replayValue },
        { label: 'Production', value: album.production },
        { label: 'Distinct', value: album.distinctness },
      ]

  return (
    <View style={styles.root}>
      <AlbumBackdrop albumArtUrl={album.albumArtUrl} album={album.albumName} artist={album.artist} />
      <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.topBar}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={styles.backBtn}>
          <ArrowLeft size={18} color={colors.inkSecondary} />
          <Text style={styles.backText}>Back</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.head}>
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
          {album.genre && <Text style={styles.genre}>{album.genre}</Text>}
        </View>

        <View style={styles.scoreBlock}>
          <Text style={[styles.bigScore, { color: showScore != null ? colors.green : colors.inkMuted }]}>
            {showScore != null ? showScore.toFixed(2) : '—'}
          </Text>
          <Text style={styles.scoreLabel}>
            {isRated ? 'FINAL SCORE' : scoreIsPredicted ? 'PREDICTED' : 'NOT YET RATED'}
          </Text>
        </View>

        {factors.length > 0 && isRated && (
          <View style={styles.factorRow}>
            {factors.map((f) => (
              <View key={f.label} style={styles.factorCell}>
                <Text style={styles.factorValue}>{f.value != null ? f.value.toFixed(1) : '—'}</Text>
                <Text style={styles.factorLabel}>{f.label}</Text>
              </View>
            ))}
          </View>
        )}

        <Pressable
          style={({ pressed }) => [styles.cta, pressed && { backgroundColor: colors.greenPressed }]}
          onPress={() => router.push({ pathname: '/rate/[id]', params: { id: String(albumId) } })}
        >
          <Text style={styles.ctaText}>{cta}</Text>
        </Pressable>

        <Text style={styles.sectionLabel}>TRACKS</Text>
        {sorted.map((s) => (
          <View key={s.id} style={styles.trackRow}>
            <Text style={styles.trackNum}>{s.trackNumber}</Text>
            <Text style={styles.trackTitle} numberOfLines={1}>{s.title}</Text>
            <BangSkip score={s.score} />
            {s.score != null ? (
              <Text style={[styles.trackScore, { color: songScoreColor(s.score) }]}>
                {s.score.toFixed(1)}
              </Text>
            ) : (
              <Text style={styles.trackScoreEmpty}>—</Text>
            )}
          </View>
        ))}

        <ReviewSection album={album} editable={isMine} />

        <CommentThread albumId={albumId} />
      </ScrollView>
      </SafeAreaView>
    </View>
  )
}

function ReviewSection({ album, editable }: { album: Album; editable: boolean }) {
  const queryClient = useQueryClient()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(album.review ?? '')
  const [busy, setBusy] = useState(false)

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ['album', album.id] })
    queryClient.invalidateQueries({ queryKey: ['feed'] })
    queryClient.invalidateQueries({ queryKey: ['reviews'] })
  }

  async function save() {
    setBusy(true)
    try {
      await saveReview(album.id, draft.trim())
      setEditing(false)
      invalidate()
    } finally {
      setBusy(false)
    }
  }
  async function remove() {
    setBusy(true)
    try {
      await deleteReview(album.id)
      setDraft('')
      setEditing(false)
      invalidate()
    } finally {
      setBusy(false)
    }
  }

  // Not mine and no review → nothing to show.
  if (!editable && !album.review) return null

  return (
    <View>
      <Text style={styles.sectionLabel}>REVIEW</Text>
      {editing ? (
        <View>
          <TextInput
            style={styles.reviewInput}
            value={draft}
            onChangeText={setDraft}
            placeholder="Write your thoughts on this album…"
            placeholderTextColor={colors.inkMuted}
            multiline
            autoFocus
          />
          <View style={styles.reviewActions}>
            <Pressable style={styles.reviewSave} onPress={save} disabled={busy}>
              {busy ? <ActivityIndicator size="small" color="#fff" /> : <Check size={15} color="#fff" />}
              <Text style={styles.reviewSaveText}>Save</Text>
            </Pressable>
            <Pressable style={styles.reviewCancel} onPress={() => { setDraft(album.review ?? ''); setEditing(false) }}>
              <Text style={styles.reviewCancelText}>Cancel</Text>
            </Pressable>
            {album.review && (
              <Pressable style={styles.reviewDelete} onPress={remove} disabled={busy} hitSlop={8}>
                <Trash2 size={16} color="#b91c1c" />
              </Pressable>
            )}
          </View>
        </View>
      ) : album.review ? (
        <View>
          <Text style={styles.reviewBody}>{album.review}</Text>
          {editable && (
            <Pressable style={styles.reviewEdit} onPress={() => { setDraft(album.review ?? ''); setEditing(true) }}>
              <Pencil size={13} color={colors.inkTertiary} />
              <Text style={styles.reviewEditText}>Edit review</Text>
            </Pressable>
          )}
        </View>
      ) : (
        <Pressable style={styles.reviewWrite} onPress={() => setEditing(true)}>
          <Pencil size={14} color={colors.green} />
          <Text style={styles.reviewWriteText}>Write a review</Text>
        </Pressable>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  screen: { flex: 1, backgroundColor: 'transparent' },
  center: { alignItems: 'center', justifyContent: 'center' },
  topBar: { paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  backBtn: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  backText: { fontFamily: fonts.bodyMedium, fontSize: 15, color: colors.inkSecondary },
  content: { paddingHorizontal: spacing.lg, paddingBottom: 60 },

  head: { alignItems: 'center', marginTop: spacing.sm },
  art: { width: 148, height: 148, borderRadius: radii.lg },
  artFallback: { backgroundColor: colors.inset, alignItems: 'center', justifyContent: 'center' },
  artInitial: { fontFamily: fonts.display, fontSize: 56, color: colors.inkMuted },
  albumName: { fontFamily: fonts.display, fontSize: 26, color: colors.ink, textAlign: 'center', marginTop: spacing.lg },
  artist: { fontFamily: fonts.bodyMedium, fontSize: 14, color: colors.inkTertiary, marginTop: 6, textAlign: 'center' },
  genre: {
    fontFamily: fonts.bodyBold,
    fontSize: 11,
    letterSpacing: 1.2,
    color: colors.green,
    marginTop: spacing.sm,
    textTransform: 'uppercase',
  },

  scoreBlock: { alignItems: 'center', marginTop: spacing.xl },
  bigScore: { fontFamily: fonts.display, fontSize: 64, lineHeight: 68 },
  scoreLabel: { fontFamily: fonts.bodyBold, fontSize: 11, letterSpacing: 1.4, color: colors.inkMuted },

  factorRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing.xl },
  factorCell: { alignItems: 'center', flex: 1 },
  factorValue: { fontFamily: fonts.bodyBold, fontSize: 17, color: colors.ink },
  factorLabel: { fontFamily: fonts.bodyMedium, fontSize: 10, color: colors.inkTertiary, marginTop: 2 },

  cta: {
    backgroundColor: colors.green,
    borderRadius: radii.md,
    paddingVertical: 15,
    alignItems: 'center',
    marginTop: spacing.xl,
  },
  ctaText: { fontFamily: fonts.bodySemiBold, fontSize: 15, color: '#fff' },

  sectionLabel: {
    fontFamily: fonts.bodyBold,
    fontSize: 11,
    letterSpacing: 1.2,
    color: colors.inkMuted,
    marginTop: spacing.xl,
    marginBottom: spacing.sm,
  },
  trackRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  trackNum: { fontFamily: fonts.body, fontSize: 12, color: colors.inkMuted, width: 20 },
  trackTitle: { flex: 1, fontFamily: fonts.bodyMedium, fontSize: 14, color: colors.ink },
  trackScore: { fontFamily: fonts.bodyBold, fontSize: 15 },
  trackScoreEmpty: { fontFamily: fonts.body, fontSize: 15, color: colors.inkMuted },

  reviewBody: { fontFamily: fonts.body, fontSize: 15, color: colors.inkSecondary, lineHeight: 22 },
  reviewInput: {
    minHeight: 90,
    backgroundColor: colors.raised,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    fontFamily: fonts.body,
    fontSize: 15,
    color: colors.ink,
    textAlignVertical: 'top',
  },
  reviewActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.sm },
  reviewSave: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.green,
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderRadius: radii.md,
  },
  reviewSaveText: { fontFamily: fonts.bodySemiBold, fontSize: 14, color: '#fff' },
  reviewCancel: { paddingHorizontal: 14, paddingVertical: 9 },
  reviewCancelText: { fontFamily: fonts.bodyMedium, fontSize: 14, color: colors.inkTertiary },
  reviewDelete: { marginLeft: 'auto', padding: spacing.sm },
  reviewEdit: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: spacing.sm },
  reviewEditText: { fontFamily: fonts.bodyMedium, fontSize: 13, color: colors.inkTertiary },
  reviewWrite: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.greenSoft,
    paddingVertical: 11,
    borderRadius: radii.md,
    justifyContent: 'center',
  },
  reviewWriteText: { fontFamily: fonts.bodySemiBold, fontSize: 14, color: colors.green },
})
