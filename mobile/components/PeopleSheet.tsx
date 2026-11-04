// "People who rated this too" — the sheet that follows a first album rating
// (spec §5.2). The mobile twin of frontend/src/components/PeopleSheet.tsx: a
// bottom sheet over whatever screen you're on, which after the share card is
// the album page.
//
// The server decides that a sheet is owed and whom it names; this decides only
// when it's on screen. Fetching a sheet records nothing, so the one "shown" is
// reported from here, once the Modal has actually appeared — a sheet fetched
// while the app was closing would otherwise count as seen and never come back.
//
// Unlike What's New and the phone prompt, it can be swiped away or dismissed by
// a tap outside: those are a decision the server records, this one is a "not
// now" that costs nothing.
import { useCallback, useMemo, useState } from 'react'
import {
  ActivityIndicator,
  Animated,
  Modal,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useRouter, useSegments } from 'expo-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Clock, MessageCircle, Triangle, UserPlus } from 'lucide-react-native'
import { songScoreColor, type PeopleSheetData, type SheetAction, type SheetPerson } from '@pressd/shared/types'
import { addFriend, fetchPeopleSheet, logSheetEvent } from '../lib/api'
import { useAuth } from '../lib/auth'
import { light, selection } from '../lib/haptics'
import { PEOPLE_SHEET_KEY } from '../lib/peopleSheet'
import { useOpenProfile } from '../lib/useOpenProfile'
import Avatar from './Avatar'
import CoverImage from './CoverImage'
import { colors, fonts, radii, spacing, NUM_SCALE_CAP } from '../theme/tokens'

const DOWN = '#e0492b'

// A drag past this, or a flick, closes it; anything less springs back.
const DISMISS_DRAG = 110

// Per launch, not per mount: one sheet must report "shown" once however often
// the host re-renders it.
const reported = new Set<number>()

// Screens it never covers: the rating flow it follows (the sheet waits for the
// album page the flow lands on), and the first run, which has the floor.
const HELD_ON = new Set(['rate', 'tutorial', 'username', 'welcome', 'first-album', 'add'])

/** A log is a measurement, not part of the action: it never holds one up. */
function log(sheetId: number, action: SheetAction, targetUserId?: number) {
  logSheetEvent(sheetId, action, targetUserId).catch(() => {})
}

/** Mounted once, in the root layout beside What's New and the phone prompt, and
 *  the query's only observer — so the two triggers, the app launching (a sheet
 *  owed from a rating on the other device) and the rating flow invalidating the
 *  key as its share card closes, can never open two sheets. `held` is the
 *  root's say: the username page, the tutorial, What's New and the phone
 *  prompt each come first. */
export function PeopleSheetHost({ held }: { held: boolean }) {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const segments = useSegments()
  const key = useMemo(() => [...PEOPLE_SHEET_KEY, user?.id], [user?.id])
  const { data } = useQuery({
    queryKey: key,
    queryFn: fetchPeopleSheet,
    enabled: !!user,
    staleTime: Infinity,
    retry: false,
  })
  // Cleared locally on close: the server stops owing it once "shown" lands,
  // and nothing should reopen it before the next fetch.
  const close = useCallback(() => queryClient.setQueryData(key, null), [queryClient, key])
  if (!data || data.people.length === 0) return null
  const blocked = held || HELD_ON.has(segments[0] ?? '')
  return <PeopleSheet data={data} visible={!blocked} onClose={close} />
}

/** Drawn exactly as For You's review previews (ReviewCell) draw them. */
function SongNotes({ person }: { person: SheetPerson }) {
  const { topSong, bottomSong, fromAlbum } = person
  if (!topSong && !bottomSong) return null
  return (
    <View style={styles.songNotes}>
      {topSong && (
        <View style={styles.songNote}>
          <Triangle size={11} color={colors.green} fill={colors.green} />
          <Text style={styles.songNoteText} numberOfLines={1}>{topSong.title}</Text>
          <Text style={[styles.songNoteScore, { color: songScoreColor(topSong.score) }]} numberOfLines={1} maxFontSizeMultiplier={NUM_SCALE_CAP}>{topSong.score.toFixed(1)}</Text>
        </View>
      )}
      {bottomSong && (
        <View style={styles.songNote}>
          <View style={{ transform: [{ rotate: '180deg' }] }}>
            <Triangle size={11} color={DOWN} fill={DOWN} />
          </View>
          <Text style={styles.songNoteText} numberOfLines={1}>{bottomSong.title}</Text>
          <Text style={[styles.songNoteScore, { color: songScoreColor(bottomSong.score) }]} numberOfLines={1} maxFontSizeMultiplier={NUM_SCALE_CAP}>{bottomSong.score.toFixed(1)}</Text>
        </View>
      )}
      {fromAlbum && (
        <Text style={styles.fromAlbum} numberOfLines={1}>
          from <Text style={styles.italic}>{fromAlbum}</Text>
        </Text>
      )}
    </View>
  )
}

export default function PeopleSheet({ data, visible, onClose }: {
  data: PeopleSheetData
  visible: boolean
  onClose: () => void
}) {
  const { user } = useAuth()
  const router = useRouter()
  const openProfile = useOpenProfile()
  const queryClient = useQueryClient()
  const insets = useSafeAreaInsets()
  const { height } = useWindowDimensions()
  const [added, setAdded] = useState<Set<number>>(() => new Set())
  const [adding, setAdding] = useState<number | null>(null)
  const { sheetId, album, people } = data

  // The sheet's own drag, so it can follow a finger down and be let go of. The
  // backdrop fades with the Modal; only the sheet moves.
  const [dragY] = useState(() => new Animated.Value(0))

  const dismiss = useCallback(() => {
    log(sheetId, 'not_now')
    onClose()
  }, [sheetId, onClose])

  const pan = useMemo(
    () =>
      PanResponder.create({
        // Downward drags only, so the list inside still scrolls.
        onMoveShouldSetPanResponder: (_e, g) => g.dy > 8 && Math.abs(g.dy) > Math.abs(g.dx) * 1.4,
        onPanResponderMove: (_e, g) => dragY.setValue(Math.max(0, g.dy)),
        onPanResponderRelease: (_e, g) => {
          if (g.dy > DISMISS_DRAG || g.vy > 1.2) {
            Animated.timing(dragY, { toValue: height, duration: 180, useNativeDriver: true }).start(() => {
              dismiss()
              dragY.setValue(0)
            })
          } else {
            Animated.spring(dragY, { toValue: 0, useNativeDriver: true, speed: 20, bounciness: 4 }).start()
          }
        },
        onPanResponderTerminate: () => {
          Animated.spring(dragY, { toValue: 0, useNativeDriver: true }).start()
        },
      }),
    [dragY, height, dismiss],
  )

  function onShow() {
    if (reported.has(sheetId)) return
    reported.add(sheetId)
    log(sheetId, 'shown')
  }

  // Closed first: this is a native modal, and a push from inside one lands
  // behind it.
  function onOpenProfile(p: SheetPerson) {
    selection()
    log(sheetId, 'open_profile', p.user.id)
    onClose()
    openProfile(p.user.id)
  }

  async function add(p: SheetPerson) {
    if (!user || adding != null || added.has(p.user.id)) return
    selection()
    setAdding(p.user.id)
    try {
      await addFriend(user.id, p.user.id)
      light()
      log(sheetId, 'add', p.user.id)
      setAdded((s) => new Set(s).add(p.user.id))
      queryClient.invalidateQueries({ queryKey: ['friend-requests'] })
    } catch { /* the button stays as it was */ } finally {
      setAdding(null)
    }
  }

  // The rater has just finished the record, so thread_access admits them. The
  // route is AlbumThoughts' own.
  function openDiscussion() {
    selection()
    log(sheetId, 'open_discussion')
    onClose()
    router.push({
      pathname: '/thread/[subject]',
      params: { subject: 'album', artist: album.artist, album: album.name, title: album.name },
    })
  }

  const counted = !data.fallback && data.raters != null

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={dismiss} onShow={onShow}>
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={dismiss} accessibilityLabel="Not now" />
        <Animated.View
          style={[
            styles.sheet,
            { paddingBottom: insets.bottom + spacing.lg, maxHeight: height * 0.88, transform: [{ translateY: dragY }] },
          ]}
        >
          {/* The handle and heading are what you drag by. */}
          <View {...pan.panHandlers}>
            <View style={styles.grabber} />
            <View style={styles.head}>
              {album.artUrl ? (
                <CoverImage url={album.artUrl} displayPx={56} style={styles.cover} />
              ) : (
                <View style={[styles.cover, styles.coverFallback]}>
                  <Text style={styles.coverInitial}>{album.name[0]?.toUpperCase()}</Text>
                </View>
              )}
              <Text style={styles.title} numberOfLines={3}>
                {counted ? (
                  <>
                    {data.raters} {data.raters === 1 ? 'person' : 'people'} rated{' '}
                    <Text style={styles.titleAlbum}>{album.name}</Text> too
                  </>
                ) : (
                  'People who like what you like'
                )}
              </Text>
            </View>
          </View>

          <ScrollView style={styles.list} contentContainerStyle={{ gap: spacing.sm }} bounces={false}>
            {people.map((p) => {
              const isAdded = added.has(p.user.id)
              return (
                <View key={p.user.id} style={styles.person}>
                  <View style={styles.personHead}>
                    <Pressable
                      onPress={() => onOpenProfile(p)}
                      accessibilityRole="button"
                      accessibilityLabel={`View ${p.user.name}'s profile`}
                    >
                      <Avatar name={p.user.name} avatarUrl={p.user.avatarUrl} size={42} />
                    </Pressable>
                    <Text style={styles.name} numberOfLines={1} onPress={() => onOpenProfile(p)}>{p.user.name}</Text>
                    <View style={styles.overlap}>
                      <Text style={styles.percent} numberOfLines={1} maxFontSizeMultiplier={NUM_SCALE_CAP}>{p.percent}%</Text>
                      <Text style={styles.overlapLabel} numberOfLines={1} maxFontSizeMultiplier={NUM_SCALE_CAP}>taste overlap</Text>
                    </View>
                    <Pressable
                      style={[styles.addBtn, isAdded && styles.addBtnOn]}
                      onPress={() => add(p)}
                      disabled={isAdded || adding === p.user.id}
                      hitSlop={6}
                      accessibilityLabel={isAdded ? 'Friend request sent' : `Add ${p.user.name}`}
                    >
                      {adding === p.user.id ? (
                        <ActivityIndicator size="small" color="#ffffff" />
                      ) : isAdded ? (
                        <Clock size={13} color={colors.green} strokeWidth={2.4} />
                      ) : (
                        <UserPlus size={13} color="#ffffff" strokeWidth={2.4} />
                      )}
                      <Text style={[styles.addText, isAdded && styles.addTextOn]} numberOfLines={1} maxFontSizeMultiplier={NUM_SCALE_CAP}>
                        {isAdded ? 'Requested' : 'Add'}
                      </Text>
                    </Pressable>
                  </View>
                  <SongNotes person={p} />
                </View>
              )
            })}
          </ScrollView>

          <View style={styles.footer}>
            <Pressable style={styles.notNow} onPress={() => { selection(); dismiss() }}>
              <Text style={styles.notNowText}>Not now</Text>
            </Pressable>
            <Pressable style={styles.discuss} onPress={openDiscussion}>
              <MessageCircle size={16} color={colors.green} />
              <Text style={styles.discussText} numberOfLines={1}>Open the discussion</Text>
            </Pressable>
          </View>
        </Animated.View>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  italic: { fontStyle: 'italic' },
  backdrop: { flex: 1, backgroundColor: 'rgba(28,25,23,0.45)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.bg,
    borderTopLeftRadius: radii.xl,
    borderTopRightRadius: radii.xl,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
  },
  grabber: {
    alignSelf: 'center',
    width: 38,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.border,
    marginBottom: spacing.lg,
  },
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.lg },
  cover: { width: 56, height: 56, borderRadius: radii.md },
  coverFallback: { backgroundColor: colors.inset, alignItems: 'center', justifyContent: 'center' },
  coverInitial: { fontFamily: fonts.display, fontSize: 22, color: colors.inkMuted },
  // One face for the whole line, a title's: the album stands out by italics,
  // not by switching family mid-sentence.
  title: { flex: 1, minWidth: 0, fontFamily: fonts.display, fontSize: 21, lineHeight: 27, color: colors.ink },
  titleAlbum: { fontFamily: fonts.displayItalic },

  list: { flexGrow: 0 },
  person: {
    padding: spacing.md,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: '#ece5da',
    backgroundColor: colors.raised,
  },
  personHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  name: { flex: 1, minWidth: 0, fontFamily: fonts.bodySemiBold, fontSize: 15, color: colors.ink },
  overlap: { alignItems: 'flex-end' },
  percent: { fontFamily: fonts.display, fontSize: 24, lineHeight: 28, color: colors.green, fontVariant: ['tabular-nums'] },
  overlapLabel: { fontFamily: fonts.bodySemiBold, fontSize: 11, color: colors.green },
  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    minWidth: 64,
    justifyContent: 'center',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: radii.pill,
    backgroundColor: colors.green,
  },
  addBtnOn: { backgroundColor: colors.greenSoft },
  addText: { fontFamily: fonts.bodySemiBold, fontSize: 13, color: '#ffffff' },
  addTextOn: { color: colors.green },

  // ReviewCell's song notes, indented under the name.
  songNotes: { marginTop: spacing.md, gap: 5, paddingLeft: 42 + spacing.md },
  songNote: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  songNoteText: { flex: 1, fontFamily: fonts.bodyMedium, fontSize: 12, color: colors.inkSecondary },
  songNoteScore: { fontFamily: fonts.bodyBold, fontSize: 12 },
  fromAlbum: { fontFamily: fonts.bodyMedium, fontSize: 12, color: colors.inkSecondary },

  footer: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg },
  notNow: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 13,
    borderRadius: radii.md,
    backgroundColor: colors.inset,
  },
  notNowText: { fontFamily: fonts.bodySemiBold, fontSize: 15, color: colors.inkSecondary },
  discuss: {
    flex: 1.6,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: 13,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: '#e2dbd0',
    backgroundColor: colors.raised,
  },
  discussText: { fontFamily: fonts.bodySemiBold, fontSize: 15, color: colors.green },
})
