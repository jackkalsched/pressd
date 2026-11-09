// A profile's friends — the sheet the banner's Friends figure opens, on your
// own profile and on anyone else's. Each friend carries the *viewer's* taste
// overlap with them (GET /overlap/friends/{id}): on your own page yours with
// each friend, on someone else's yours with each of theirs, so the list reads
// as "who here is like me". Highest first; you, when you're in their list, at
// the top with no number. The mobile twin of frontend/src/components/FriendsDialog.tsx.
//
// A bottom sheet in PeopleSheet's manner: dimmed backdrop, grab handle, dragged
// down or tapped outside to close. Each row carries the friend's bio under
// their name; on someone else's list, also Add / Requested / Accept / Friends,
// as you stand with that person.
import { useCallback, useMemo, useState } from 'react'
import {
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
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Clock, UserPlus } from 'lucide-react-native'
import { overlapScore, type FriendOverlap } from '@pressd/shared/types'
import { addFriend, fetchFriendsOverlap } from '../lib/api'
import { useAuth } from '../lib/auth'
import { light, selection } from '../lib/haptics'
import { useOpenProfile } from '../lib/useOpenProfile'
import Avatar from './Avatar'
import VinylSpinner from './VinylSpinner'
import { colors, fonts, radii, spacing, NUM_SCALE_CAP, useColors, scoreColor } from '../theme/tokens'

// A drag past this, or a flick, closes it; anything less springs back.
const DISMISS_DRAG = 110

export default function FriendsSheet({ userId, name, visible, onClose }: {
  /** Whose friends. */
  userId: number
  /** Their name, for the heading; ignored on your own profile. */
  name: string
  visible: boolean
  onClose: () => void
}) {
  const tc = useColors()
  const { user } = useAuth()
  const openProfile = useOpenProfile()
  const insets = useSafeAreaInsets()
  const { height } = useWindowDimensions()
  const mine = user?.id === userId
  const queryClient = useQueryClient()
  // Where you stand after tapping Add or Accept here, ahead of the refetch.
  const [changed, setChanged] = useState<Record<number, FriendOverlap['relationship']>>({})
  const [busy, setBusy] = useState<number | null>(null)

  const { data: rows, isLoading, isError } = useQuery({
    queryKey: ['friends-overlap', user?.id, userId],
    queryFn: () => fetchFriendsOverlap(userId),
    enabled: visible && !!user,
  })

  const [dragY] = useState(() => new Animated.Value(0))
  const pan = useMemo(
    () =>
      PanResponder.create({
        // Downward drags only, so the list inside still scrolls.
        onMoveShouldSetPanResponder: (_e, g) => g.dy > 8 && Math.abs(g.dy) > Math.abs(g.dx) * 1.4,
        onPanResponderMove: (_e, g) => dragY.setValue(Math.max(0, g.dy)),
        onPanResponderRelease: (_e, g) => {
          if (g.dy > DISMISS_DRAG || g.vy > 1.2) {
            Animated.timing(dragY, { toValue: height, duration: 180, useNativeDriver: true }).start(() => {
              onClose()
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
    [dragY, height, onClose],
  )

  // Closed first: this is a native modal, and a push from inside one lands
  // behind it.
  const open = useCallback((r: FriendOverlap) => {
    selection()
    onClose()
    openProfile(r.user.id)
  }, [onClose, openProfile])

  async function befriend(r: FriendOverlap) {
    if (!user || busy != null) return
    selection()
    setBusy(r.user.id)
    try {
      const res = await addFriend(user.id, r.user.id)
      light()
      setChanged((c) => ({ ...c, [r.user.id]: res.status === 'accepted' ? 'friends' : 'sent' }))
      queryClient.invalidateQueries({ queryKey: ['friends'] })
      queryClient.invalidateQueries({ queryKey: ['friend-requests'] })
    } catch { /* the button stays as it was */ } finally {
      setBusy(null)
    }
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close" />
        <Animated.View
          style={[
            styles.sheet,
            { paddingBottom: insets.bottom + spacing.md, maxHeight: height * 0.8, transform: [{ translateY: dragY }] },
          ]}
        >
          {/* The handle and heading are what you drag by. */}
          <View {...pan.panHandlers}>
            <View style={[styles.grabber, { backgroundColor: tc.border }]} />
            <Text style={styles.title} numberOfLines={1}>
              {mine ? 'Your friends' : `${name}'s friends`}
              {rows ? <Text style={styles.count}>  {rows.length}</Text> : null}
            </Text>
          </View>

          {isLoading ? (
            <View style={styles.state}><VinylSpinner size={44} /></View>
          ) : isError ? (
            <View style={styles.state}><Text style={styles.stateText}>Couldn&rsquo;t load friends.</Text></View>
          ) : !rows?.length ? (
            <View style={styles.state}><Text style={styles.stateText}>No friends yet.</Text></View>
          ) : (
            <ScrollView style={styles.list} bounces={false}>
              {rows.map((r, i) => (
                <Pressable
                  key={r.user.id}
                  onPress={() => open(r)}
                  style={({ pressed }) => [
                    styles.row,
                    i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderColor: tc.border },
                    pressed && { opacity: 0.6 },
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel={
                    r.percent == null ? 'You' : `${r.user.name}, ${r.percent}% taste overlap`
                  }
                >
                  <Avatar name={r.user.name} avatarUrl={r.user.avatarUrl} size={42} />
                  <View style={styles.who}>
                    <Text style={styles.name} numberOfLines={1}>{r.user.name}</Text>
                    {r.user.bio ? <Text style={styles.bio} numberOfLines={1}>{r.user.bio}</Text> : null}
                  </View>
                  {r.percent == null ? (
                    <Text style={styles.you} maxFontSizeMultiplier={NUM_SCALE_CAP}>You</Text>
                  ) : (
                    <View style={styles.overlap}>
                      <Text style={[styles.percent, { color: scoreColor(overlapScore(r.percent)) }]} numberOfLines={1} maxFontSizeMultiplier={NUM_SCALE_CAP}>{r.percent}%</Text>
                      <Text style={[styles.overlapLabel, { color: scoreColor(overlapScore(r.percent)) }]} numberOfLines={1} maxFontSizeMultiplier={NUM_SCALE_CAP}>taste overlap</Text>
                    </View>
                  )}
                  {!mine && r.relationship !== 'self' && (
                    <FriendButton
                      rel={changed[r.user.id] ?? r.relationship}
                      busy={busy === r.user.id}
                      onPress={() => befriend(r)}
                      name={r.user.name}
                    />
                  )}
                </Pressable>
              ))}
            </ScrollView>
          )}
        </Animated.View>
      </View>
    </Modal>
  )
}

/** You and this friend of theirs: Add or Accept act; Requested and Friends
 *  only say so. The words are the profile button's. */
function FriendButton({ rel, busy, onPress, name }: {
  rel: FriendOverlap['relationship']
  busy: boolean
  onPress: () => void
  name: string
}) {
  const tc = useColors()
  const acts = rel === 'none' || rel === 'received'
  const label = rel === 'none' ? 'Add' : rel === 'received' ? 'Accept' : rel === 'sent' ? 'Requested' : 'Friends'
  const iconColor = acts ? '#ffffff' : tc.green
  return (
    <Pressable
      style={[styles.addBtn, !acts && styles.addBtnOn]}
      onPress={onPress}
      disabled={!acts || busy}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityLabel={rel === 'none' ? `Add ${name}` : rel === 'received' ? `Accept ${name}'s request` : label}
    >
      {busy ? (
        <VinylSpinner size="small" />
      ) : rel === 'sent' ? (
        <Clock size={13} color={iconColor} strokeWidth={2.4} />
      ) : rel === 'friends' ? (
        <Check size={13} color={iconColor} strokeWidth={2.6} />
      ) : (
        <UserPlus size={13} color={iconColor} strokeWidth={2.4} />
      )}
      <Text style={[styles.addText, !acts && styles.addTextOn]} numberOfLines={1} maxFontSizeMultiplier={NUM_SCALE_CAP}>{label}</Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(28,25,23,0.45)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.bg,
    borderTopLeftRadius: radii.xl,
    borderTopRightRadius: radii.xl,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
  },
  grabber: { alignSelf: 'center', width: 38, height: 4, borderRadius: 2, marginBottom: spacing.lg },
  title: { fontFamily: fonts.display, fontSize: 21, lineHeight: 27, color: colors.ink, marginBottom: spacing.sm },
  count: { fontFamily: fonts.display, fontSize: 17, color: colors.inkMuted },
  list: { flexGrow: 0 },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.md },
  who: { flex: 1, minWidth: 0 },
  name: { fontFamily: fonts.bodySemiBold, fontSize: 15, color: colors.ink },
  bio: { marginTop: 2, fontFamily: fonts.body, fontSize: 12, lineHeight: 16, color: colors.inkSecondary },
  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    minWidth: 64,
    justifyContent: 'center',
    paddingHorizontal: 11,
    paddingVertical: 7,
    borderRadius: radii.pill,
    backgroundColor: colors.green,
  },
  addBtnOn: { backgroundColor: colors.greenSoft },
  addText: { fontFamily: fonts.bodySemiBold, fontSize: 13, color: '#ffffff' },
  addTextOn: { color: colors.green },
  overlap: { alignItems: 'flex-end' },
  percent: { fontFamily: fonts.display, fontSize: 22, lineHeight: 26, color: colors.green, fontVariant: ['tabular-nums'] },
  overlapLabel: { fontFamily: fonts.bodySemiBold, fontSize: 11, color: colors.green },
  you: { fontFamily: fonts.bodySemiBold, fontSize: 13, color: colors.inkSecondary },
  state: { alignItems: 'center', justifyContent: 'center', paddingVertical: spacing.xl * 2 },
  stateText: { fontFamily: fonts.bodyMedium, fontSize: 14, color: colors.inkSecondary },
})
