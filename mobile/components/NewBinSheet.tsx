// Making a bin: a title, an optional description, and who can see it. A new
// bin is Private (spec 2026-11-13 §3) until its owner switches it to Public,
// here or later in the bin's edit mode. Opened from the Bins page's +, and —
// as a form inside its own sheet — from an album page's Add to bin…, which
// puts that album straight in. The mobile twin of web's NewBinDialog.
//
// A bottom sheet in PeopleSheet's manner: dimmed backdrop, grab handle,
// dragged down or tapped outside to close. `BinSheet` is that frame, shared
// with Add to bin… and the editor's Add albums.
import { useMemo, useState, type ReactNode } from 'react'
import {
  Animated,
  KeyboardAvoidingView,
  Modal,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useQueryClient } from '@tanstack/react-query'
import { Globe, Lock } from 'lucide-react-native'
import { createBin, type BinCard } from '../lib/api'
import { binErrorText, DESCRIPTION_MAX, TITLE_MAX } from '../lib/bins'
import { selection, success } from '../lib/haptics'
import VinylSpinner from './VinylSpinner'
import { colors, fonts, radii, spacing, useColors } from '../theme/tokens'

// A drag past this, or a flick, closes it; anything less springs back.
const DISMISS_DRAG = 110

/** The sheet itself. `busy` holds it open: no drag, no tap outside. */
export function BinSheet({ visible, onClose, busy = false, tall = false, children }: {
  visible: boolean
  onClose: () => void
  busy?: boolean
  /** Fill most of the screen whatever the content, for a list that grows. */
  tall?: boolean
  children: ReactNode
}) {
  const tc = useColors()
  const insets = useSafeAreaInsets()
  const { height } = useWindowDimensions()
  const [dragY] = useState(() => new Animated.Value(0))
  const close = busy ? () => {} : onClose
  const pan = useMemo(
    () =>
      PanResponder.create({
        // Downward drags only, so a list inside still scrolls.
        onMoveShouldSetPanResponder: (_e, g) => !busy && g.dy > 8 && Math.abs(g.dy) > Math.abs(g.dx) * 1.4,
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
    [dragY, height, onClose, busy],
  )

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={close}>
      <KeyboardAvoidingView behavior="padding" style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={close} accessibilityLabel="Close" />
        <Animated.View
          style={[
            styles.sheet,
            {
              paddingBottom: insets.bottom + spacing.md,
              maxHeight: height * 0.88,
              // Tall sheets give way to the keyboard rather than run off the top.
              ...(tall ? { height: height * 0.85, flexShrink: 1, marginTop: insets.top + spacing.lg } : null),
              transform: [{ translateY: dragY }],
            },
          ]}
        >
          {/* The handle is what you drag by. */}
          <View {...pan.panHandlers} style={styles.handleZone}>
            <View style={[styles.grabber, { backgroundColor: tc.border }]} />
          </View>
          {children}
        </Animated.View>
      </KeyboardAvoidingView>
    </Modal>
  )
}

/** Private / Public, as two halves of one control. The wire value for
 *  Public is `published`. */
export function VisibilitySwitch({ value, onChange, disabled = false }: {
  value: 'private' | 'published'
  onChange: (v: 'private' | 'published') => void
  disabled?: boolean
}) {
  const tc = useColors()
  const opt = (v: 'private' | 'published', label: string) => {
    const on = value === v
    const Icon = v === 'private' ? Lock : Globe
    return (
      <Pressable
        onPress={() => {
          if (on) return
          selection()
          onChange(v)
        }}
        disabled={disabled}
        style={[styles.visOpt, on && { backgroundColor: tc.greenFill }, disabled && { opacity: 0.6 }]}
        accessibilityRole="radio"
        accessibilityState={{ checked: on, disabled }}
      >
        <Icon size={13} color={on ? '#ffffff' : tc.inkSecondary} strokeWidth={2.4} />
        <Text style={[styles.visText, on && styles.visTextOn]}>{label}</Text>
      </Pressable>
    )
  }
  return (
    <View style={[styles.vis, { borderColor: tc.border }]} accessibilityRole="radiogroup" accessibilityLabel="Who can see this bin">
      {opt('private', 'Private')}
      {opt('published', 'Public')}
    </View>
  )
}

/** The form alone, for a sheet that already exists (Add to bin…). */
export function NewBinForm({ onCancel, onCreated, onBusy }: {
  onCancel: () => void
  onCreated: (bin: BinCard) => void
  /** While the bin is being made, so the sheet around it holds still. */
  onBusy?: (busy: boolean) => void
}) {
  const tc = useColors()
  const queryClient = useQueryClient()
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [visibility, setVisibility] = useState<'private' | 'published'>('private')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit() {
    if (!title.trim() || saving) return
    selection()
    setSaving(true)
    onBusy?.(true)
    setError(null)
    try {
      const bin = await createBin({ title: title.trim(), description: description.trim(), visibility, ranked: true })
      queryClient.invalidateQueries({ queryKey: ['bins'] })
      queryClient.invalidateQueries({ queryKey: ['search'] })
      success()
      onBusy?.(false)
      onCreated(bin)
    } catch (e) {
      setError(binErrorText(e, 'Couldn’t make that bin'))
      setSaving(false)
      onBusy?.(false)
    }
  }

  return (
    <View>
      <Text style={styles.heading}>New bin</Text>
      <View style={styles.fields}>
        <TextInput
          autoFocus
          value={title}
          onChangeText={setTitle}
          maxLength={TITLE_MAX}
          placeholder="Title"
          placeholderTextColor={tc.inkMuted}
          accessibilityLabel="Title"
          returnKeyType="next"
          style={[styles.field, { borderColor: tc.border }]}
        />
        <TextInput
          value={description}
          onChangeText={setDescription}
          maxLength={DESCRIPTION_MAX}
          placeholder="Description (optional)"
          placeholderTextColor={tc.inkMuted}
          accessibilityLabel="Description"
          multiline
          style={[styles.field, styles.fieldTall, { borderColor: tc.border }]}
        />
        <VisibilitySwitch value={visibility} onChange={setVisibility} disabled={saving} />
      </View>
      {error && <Text style={styles.error}>{error}</Text>}
      <View style={styles.buttons}>
        <Pressable onPress={onCancel} disabled={saving} hitSlop={6} style={styles.cancel} accessibilityRole="button">
          <Text style={styles.cancelText}>Cancel</Text>
        </Pressable>
        <Pressable
          onPress={submit}
          disabled={saving || !title.trim()}
          style={({ pressed }) => [
            styles.make,
            { backgroundColor: tc.greenFill },
            (saving || !title.trim()) && { opacity: 0.5 },
            pressed && { opacity: 0.8 },
          ]}
          accessibilityRole="button"
        >
          {saving && <VinylSpinner size={17} />}
          <Text style={styles.makeText}>Make bin</Text>
        </Pressable>
      </View>
    </View>
  )
}

export default function NewBinSheet({ visible, onClose, onCreated }: {
  visible: boolean
  onClose: () => void
  onCreated: (bin: BinCard) => void
}) {
  const [busy, setBusy] = useState(false)
  return (
    <BinSheet visible={visible} onClose={onClose} busy={busy}>
      {/* Mounted only while open, so the fields start empty every time. */}
      {visible && <NewBinForm onCancel={onClose} onCreated={onCreated} onBusy={setBusy} />}
    </BinSheet>
  )
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(28,25,23,0.45)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.bg,
    borderTopLeftRadius: radii.xl,
    borderTopRightRadius: radii.xl,
    paddingHorizontal: spacing.lg,
  },
  handleZone: { paddingTop: spacing.sm, paddingBottom: spacing.lg },
  grabber: { alignSelf: 'center', width: 38, height: 4, borderRadius: 2 },
  heading: { fontFamily: fonts.display, fontSize: 22, lineHeight: 28, color: colors.ink, marginBottom: spacing.lg },
  fields: { gap: spacing.md },
  field: {
    borderWidth: 1,
    borderRadius: radii.md,
    backgroundColor: colors.raised,
    paddingHorizontal: 14,
    paddingVertical: 11,
    fontFamily: fonts.body,
    fontSize: 15,
    color: colors.ink,
  },
  fieldTall: { minHeight: 84, textAlignVertical: 'top' },
  vis: { flexDirection: 'row', borderWidth: 1, borderRadius: radii.pill, padding: 4, backgroundColor: colors.raised },
  visOpt: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 8, borderRadius: radii.pill,
  },
  visText: { fontFamily: fonts.bodySemiBold, fontSize: 13.5, color: colors.inkSecondary },
  visTextOn: { color: '#ffffff' },
  error: { marginTop: spacing.md, fontFamily: fonts.bodyMedium, fontSize: 13, color: colors.danger },
  buttons: { flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', gap: spacing.sm, marginTop: spacing.xl },
  cancel: { height: 44, paddingHorizontal: spacing.lg, justifyContent: 'center' },
  cancelText: { fontFamily: fonts.bodySemiBold, fontSize: 15, color: colors.inkTertiary },
  make: {
    height: 44, paddingHorizontal: spacing.xl, borderRadius: radii.pill,
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
  },
  makeText: { fontFamily: fonts.bodySemiBold, fontSize: 15, color: '#ffffff' },
})
