// Your bin's edit mode (spec 2026-11-13 §5): its own picture, title,
// description, Private / Public, numbered or not, and its records — moved up
// and down, taken out, each with a note — plus Add albums, from your library
// or the catalogs (Add an album's search). The mobile twin of web's
// BinEditor, laid out as one column under a Done bar.
//
// Every change is its own request and the bin is refetched after it: the
// server answers adds and notes with a partial entry (no genre, no Pressd
// figures), never a row to keep. Order moves by arrows rather than a drag —
// a drag would need a gesture module this build doesn't carry.
import { useEffect, useState } from 'react'
import {
  AccessibilityInfo,
  Alert,
  Keyboard,
  LayoutAnimation,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { StatusBar } from 'expo-status-bar'
import { useRouter } from 'expo-router'
import * as ImagePicker from 'expo-image-picker'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, ChevronDown, ChevronUp, ImagePlus, Music, Plus, Search, Trash2, X } from 'lucide-react-native'
import { useAlbumSearch } from '@pressd/shared/hooks/useAlbumSearch'
import { isUnreleased } from '@pressd/shared/types'
import {
  addToBin, deleteBin, deleteBinCover, fetchAlbums, removeBinEntry, reorderBin, resolveAlbum, updateBin,
  updateBinEntryNote, uploadBinCover,
} from '../lib/api'
import type { AlbumSearchResult, BinDetail, BinEntry } from '../lib/api'
import { useAuth } from '../lib/auth'
import { binErrorText, DESCRIPTION_MAX, foldSpace, NOTE_MAX, refreshBin, TITLE_MAX } from '../lib/bins'
import { selection, success } from '../lib/haptics'
import { BinMosaic } from './BinCard'
import CoverImage from './CoverImage'
import { BinSheet, VisibilitySwitch } from './NewBinSheet'
import VinylSpinner from './VinylSpinner'
import { colors, fonts, NUM_SCALE_CAP, radii, spacing, useColors } from '../theme/tokens'

const COVER = 60
const PICTURE = 104
// What the picker hands back; the server re-encodes to 800×800 either way.
const COVER_UPLOAD_QUALITY = 0.8

let reduceMotion = false
AccessibilityInfo.isReduceMotionEnabled().then((v) => { reduceMotion = v }).catch(() => {})

/** Name and artist folded, to mark a record already in the bin. The server's
 *  test is the record's subject key (any edition), so this only greys the
 *  obvious ones; anything it misses is refused as "Already in this bin". */
const recordKey = (name: string, artist: string) => `${name.trim().toLowerCase()}|${artist.trim().toLowerCase()}`

export default function BinEditor({ bin, onDone }: { bin: BinDetail; onDone: () => void }) {
  const tc = useColors()
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const queryClient = useQueryClient()
  const slug = bin.slug
  // Writes in flight, by what they write ('title', 'order', `remove:12`…). A
  // list, not one slot: two can run at once (✕ on two rows, a switch while a
  // title saves), and the first to land mustn't clear the other's flag.
  const [inFlight, setInFlight] = useState<string[]>([])
  const saving = (what: string) => inFlight.includes(what)
  const writing = inFlight.length > 0
  // Each write's failure under its own key, so a later write starting or
  // landing doesn't wipe an earlier one's error.
  const [errors, setErrors] = useState<Record<string, string>>({})
  const setErrorFor = (what: string, text: string | null) =>
    setErrors((all) => {
      if (text == null) {
        if (!(what in all)) return all
        const next = { ...all }
        delete next[what]
        return next
      }
      return { ...all, [what]: text }
    })
  const errorLines = Object.values(errors)
  const error = errorLines.length > 0
  // Notes save on their own; Done waits for them as for everything else.
  const [notesSaving, setNotesSaving] = useState(0)
  const [adding, setAdding] = useState(false)
  const busy = writing || notesSaving > 0
  // How many fields hold focus (one, or none). A field saves as it loses
  // focus, so Done first lets go of the keyboard and closes only once that
  // field has blurred and its save has landed — closing straight away would
  // unmount a focused field before its blur, and drop the edit.
  const [focused, setFocused] = useState(0)
  const [closing, setClosing] = useState(false)
  const focus = { onFocus: () => setFocused((n) => n + 1) }
  const blurred = () => setFocused((n) => Math.max(0, n - 1))
  // A save that fails on the way out keeps the editor open, its error showing.
  const leaving = closing && !error
  useEffect(() => {
    if (leaving && focused === 0 && !busy) onDone()
  }, [leaving, focused, busy, onDone])

  const refresh = () => refreshBin(queryClient, slug)

  async function run(what: string, fn: () => Promise<unknown>, fallback: string): Promise<boolean> {
    setInFlight((l) => [...l, what])
    setErrorFor(what, null)
    try {
      await fn()
      refresh()
      return true
    } catch (e) {
      setErrorFor(what, binErrorText(e, fallback))
      return false
    } finally {
      setInFlight((l) => {
        const i = l.indexOf(what)
        return i < 0 ? l : [...l.slice(0, i), ...l.slice(i + 1)]
      })
    }
  }

  // ── Details: text saves when the field is left; switches save at once ──
  // Each field follows the stored value whenever that changes (after its own
  // save, or another device's), and is compared to it with whitespace folded,
  // as the server folds it, so leaving a field untouched sends nothing.
  const [title, setTitle] = useState(bin.title)
  const [titleFor, setTitleFor] = useState(bin.title)
  if (titleFor !== bin.title) {
    setTitleFor(bin.title)
    setTitle(bin.title)
  }
  const storedDescription = bin.description ?? ''
  const [description, setDescription] = useState(storedDescription)
  const [descriptionFor, setDescriptionFor] = useState(storedDescription)
  if (descriptionFor !== storedDescription) {
    setDescriptionFor(storedDescription)
    setDescription(storedDescription)
  }
  function saveTitle() {
    const t = foldSpace(title)
    if (!t) { setTitle(bin.title); return }
    if (t !== foldSpace(bin.title)) void run('title', () => updateBin(slug, { title: t }), 'Couldn’t save the title')
  }
  function saveDescription() {
    const d = foldSpace(description)
    if (d !== foldSpace(storedDescription)) {
      void run('description', () => updateBin(slug, { description: d }), 'Couldn’t save the description')
    }
  }

  // ── The bin's own picture: square, framed in the picker ──
  async function pickCover() {
    setErrorFor('cover', null)
    let perm = await ImagePicker.getMediaLibraryPermissionsAsync()
    if (!perm.granted && perm.canAskAgain) perm = await ImagePicker.requestMediaLibraryPermissionsAsync()
    if (!perm.granted) {
      Alert.alert('Allow access to your photos', 'Pressd needs your photos to set a bin’s picture.', [
        { text: 'Not now', style: 'cancel' },
        { text: 'Open Settings', onPress: () => Linking.openSettings().catch(() => {}) },
      ])
      return
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      // The stored shape: web frames the same square.
      aspect: [1, 1],
      quality: COVER_UPLOAD_QUALITY,
      base64: true,
    })
    if (result.canceled || !result.assets[0]) return
    const base64 = result.assets[0].base64
    if (!base64) { setErrorFor('cover', 'Couldn’t read that picture'); return }
    if (await run('cover', () => uploadBinCover(slug, base64), 'Couldn’t set that picture')) success()
  }

  // ── Order: moved a step at a time, sent whole after each move ──
  const serverIds = [...bin.entries].sort((a, b) => a.position - b.position).map((e) => e.id)
  const serverKey = serverIds.join(',')
  const [order, setOrder] = useState(serverIds)
  const [orderFor, setOrderFor] = useState(serverKey)
  if (orderFor !== serverKey) {
    setOrderFor(serverKey)
    setOrder(serverIds)
  }
  const byId = new Map(bin.entries.map((e) => [e.id, e]))
  const rows = order.map((id) => byId.get(id)).filter((e): e is BinEntry => !!e)

  async function move(id: number, step: -1 | 1) {
    // Only with nothing else in flight: an order sent while another move or a
    // removal is still landing is built on a list the server no longer has.
    if (writing) return
    const at = order.indexOf(id)
    const to = at + step
    if (at < 0 || to < 0 || to >= order.length) return
    selection()
    const next = [...order]
    next.splice(at, 1)
    next.splice(to, 0, id)
    if (!reduceMotion) LayoutAnimation.configureNext(LayoutAnimation.create(220, 'easeInEaseOut', 'opacity'))
    setOrder(next)
    const ok = await run('order', () => reorderBin(slug, next), 'Couldn’t save the new order')
    if (!ok) setOrder(serverIds)
  }

  function remove(e: BinEntry) {
    selection()
    void run(`remove:${e.id}`, () => removeBinEntry(slug, e.id), 'Couldn’t take that album out')
  }

  function confirmDelete() {
    selection()
    Alert.alert(`Delete “${bin.title}”?`, undefined, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          setInFlight((l) => [...l, 'delete'])
          setErrorFor('delete', null)
          try {
            await deleteBin(slug)
            // Leave first: the page still watching the bin would ask for it
            // again the moment its cache went, and meet a 404.
            if (router.canGoBack()) router.back()
            else router.replace('/bins')
            queryClient.removeQueries({ queryKey: ['bin', slug] })
            queryClient.invalidateQueries({ queryKey: ['bins'] })
            queryClient.invalidateQueries({ queryKey: ['search'] })
          } catch (e) {
            setErrorFor('delete', binErrorText(e, 'Couldn’t delete that bin'))
            setInFlight((l) => l.filter((w) => w !== 'delete'))
          }
        },
      },
    ])
  }

  function done() {
    if (busy) return
    selection()
    Keyboard.dismiss()
    setErrors({})
    setClosing(true)
  }

  const inBin = new Set(bin.entries.map((e) => recordKey(e.albumName, e.artist)))
  const full = rows.length >= 100

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <StatusBar style="auto" />
      <View style={styles.bar}>
        <Text style={styles.barTitle}>Edit bin</Text>
        <Pressable
          onPress={done}
          disabled={busy || leaving}
          style={({ pressed }) => [styles.done, { backgroundColor: tc.greenFill }, busy && { opacity: 0.55 }, pressed && { opacity: 0.8 }]}
          accessibilityRole="button"
          accessibilityState={{ disabled: busy || leaving }}
        >
          {busy || leaving ? <VinylSpinner size={16} /> : <Check size={15} color="#ffffff" strokeWidth={2.6} />}
          <Text style={styles.doneText}>Done</Text>
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + spacing.xxl }]}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        automaticallyAdjustKeyboardInsets
      >
        {/* ── The bin itself ── */}
        <Text style={styles.label}>PICTURE</Text>
        <View style={styles.pictureRow}>
          <BinMosaic covers={bin.covers} coverUrl={bin.coverUrl} size={PICTURE} />
          <View style={styles.pictureActions}>
            <Pressable
              onPress={pickCover}
              disabled={saving('cover')}
              style={({ pressed }) => [styles.outlineBtn, { borderColor: tc.border }, pressed && { opacity: 0.6 }]}
              accessibilityRole="button"
            >
              {saving('cover') ? <VinylSpinner size={14} /> : <ImagePlus size={14} color={tc.green} />}
              <Text style={styles.outlineBtnText}>{bin.coverUrl ? 'Change picture' : 'Upload a picture'}</Text>
            </Pressable>
            {bin.coverUrl && (
              <Pressable
                onPress={() => run('cover', () => deleteBinCover(slug), 'Couldn’t remove that picture')}
                disabled={saving('cover')}
                hitSlop={6}
                accessibilityRole="button"
              >
                <Text style={styles.plainBtnText}>Use the album covers</Text>
              </Pressable>
            )}
          </View>
        </View>

        <Text style={styles.label}>TITLE</Text>
        <TextInput
          value={title}
          onChangeText={setTitle}
          {...focus}
          onBlur={() => { blurred(); saveTitle() }}
          maxLength={TITLE_MAX}
          returnKeyType="done"
          accessibilityLabel="Title"
          style={[styles.field, { borderColor: tc.border }]}
        />

        <Text style={styles.label}>DESCRIPTION</Text>
        <TextInput
          value={description}
          onChangeText={setDescription}
          {...focus}
          onBlur={() => { blurred(); saveDescription() }}
          maxLength={DESCRIPTION_MAX}
          multiline
          placeholder="What ties these records together?"
          placeholderTextColor={tc.inkMuted}
          accessibilityLabel="Description"
          style={[styles.field, styles.fieldTall, { borderColor: tc.border }]}
        />

        <Text style={styles.label}>WHO CAN SEE IT</Text>
        <VisibilitySwitch
          value={bin.visibility}
          onChange={(v) => run('visibility', () => updateBin(slug, { visibility: v }), 'Couldn’t change who can see it')}
          disabled={saving('visibility')}
        />

        <View style={styles.switchRow}>
          <Text style={styles.switchLabel}>Number the records</Text>
          <Switch
            value={bin.ranked}
            disabled={saving('ranked')}
            onValueChange={(v) => {
              selection()
              void run('ranked', () => updateBin(slug, { ranked: v }), 'Couldn’t change that')
            }}
            trackColor={{ true: tc.green, false: tc.inset }}
          />
        </View>

        {errorLines.map((text, i) => (
          <Text key={i} style={styles.error} accessibilityRole="alert">{text}</Text>
        ))}

        {/* ── Its records ── */}
        <View style={[styles.recordsHead, { borderTopColor: tc.border }]}>
          <Text style={styles.count}>
            {rows.length} {rows.length === 1 ? 'album' : 'albums'}
          </Text>
          <Pressable
            onPress={() => {
              selection()
              setAdding(true)
            }}
            disabled={full}
            style={({ pressed }) => [styles.addBtn, { borderColor: tc.green }, full && { opacity: 0.5 }, pressed && { opacity: 0.6 }]}
            accessibilityRole="button"
          >
            <Plus size={16} color={tc.green} strokeWidth={2.4} />
            <Text style={styles.addBtnText}>Add albums</Text>
          </Pressable>
        </View>

        {rows.length === 0 ? (
          <Text style={styles.empty}>No albums yet.</Text>
        ) : (
          rows.map((e, i) => (
            <View key={e.id} style={[styles.row, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: tc.border }]}>
              <View style={styles.rowTop}>
                <View>
                  {e.coverUrl ? (
                    <CoverImage url={e.coverUrl} displayPx={COVER} style={styles.cover} />
                  ) : (
                    <View style={[styles.cover, styles.coverEmpty]}>
                      <Music size={18} color={tc.inkMuted} />
                    </View>
                  )}
                  {bin.ranked && (
                    <Text style={styles.rank} maxFontSizeMultiplier={NUM_SCALE_CAP}>{i + 1}</Text>
                  )}
                </View>
                <View style={styles.rowText}>
                  <Text style={styles.rowTitle} numberOfLines={2}>{e.albumName}</Text>
                  <Text style={styles.rowSub} numberOfLines={1}>{e.artist}{e.year ? ` · ${e.year}` : ''}</Text>
                </View>
                <View style={styles.rowTools}>
                  <Pressable
                    onPress={() => move(e.id, -1)}
                    disabled={i === 0 || writing}
                    hitSlop={4}
                    style={[styles.tool, (i === 0 || writing) && styles.toolOff]}
                    accessibilityRole="button"
                    accessibilityLabel={`Move ${e.albumName} up`}
                  >
                    <ChevronUp size={18} color={tc.inkSecondary} strokeWidth={2.2} />
                  </Pressable>
                  <Pressable
                    onPress={() => move(e.id, 1)}
                    disabled={i === rows.length - 1 || writing}
                    hitSlop={4}
                    style={[styles.tool, (i === rows.length - 1 || writing) && styles.toolOff]}
                    accessibilityRole="button"
                    accessibilityLabel={`Move ${e.albumName} down`}
                  >
                    <ChevronDown size={18} color={tc.inkSecondary} strokeWidth={2.2} />
                  </Pressable>
                  <Pressable
                    onPress={() => remove(e)}
                    // Not while an order is landing: that order still lists this row.
                    disabled={saving(`remove:${e.id}`) || saving('order')}
                    hitSlop={4}
                    style={styles.tool}
                    accessibilityRole="button"
                    accessibilityLabel={`Take ${e.albumName} out of the bin`}
                  >
                    {saving(`remove:${e.id}`) ? <VinylSpinner size={14} /> : <X size={17} color={tc.inkMuted} />}
                  </Pressable>
                </View>
              </View>
              <NoteField
                slug={slug}
                entry={e}
                onSaved={refresh}
                onSaving={(on) => setNotesSaving((n) => n + (on ? 1 : -1))}
                onFocus={focus.onFocus}
                onBlurred={blurred}
                onFailed={(text) => setErrorFor(`note:${e.id}`, text)}
              />
            </View>
          ))
        )}

        <Pressable
          onPress={confirmDelete}
          disabled={saving('delete')}
          style={({ pressed }) => [styles.deleteBtn, { borderTopColor: tc.border }, pressed && { opacity: 0.6 }]}
          accessibilityRole="button"
        >
          {saving('delete') ? <VinylSpinner size={14} /> : <Trash2 size={15} color={tc.danger} />}
          <Text style={styles.deleteText}>Delete bin</Text>
        </Pressable>
      </ScrollView>

      <AddAlbumsSheet visible={adding} slug={slug} inBin={inBin} onClose={() => setAdding(false)} onAdded={refresh} />
    </View>
  )
}

/** A record's note, saved when the field is left. */
function NoteField({ slug, entry, onSaved, onSaving, onFocus, onBlurred, onFailed }: {
  slug: string
  entry: BinEntry
  onSaved: () => void
  onSaving: (on: boolean) => void
  onFocus: () => void
  onBlurred: () => void
  /** Tells the editor too, so Done stays open on a note that didn't save;
   *  null as a new save starts. */
  onFailed: (text: string | null) => void
}) {
  const tc = useColors()
  const stored = entry.note ?? ''
  const [value, setValue] = useState(stored)
  const [valueFor, setValueFor] = useState(stored)
  if (valueFor !== stored) {
    setValueFor(stored)
    setValue(stored)
  }
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  async function save() {
    const v = foldSpace(value)
    if (v === foldSpace(stored)) return
    setBusy(true)
    onSaving(true)
    setError(null)
    onFailed(null)
    try {
      await updateBinEntryNote(slug, entry.id, v)
      onSaved()
    } catch (e) {
      const text = binErrorText(e, 'Couldn’t save that note')
      setError(text)
      onFailed(text)
    } finally {
      setBusy(false)
      onSaving(false)
    }
  }
  return (
    <View style={styles.note}>
      <View>
        <TextInput
          value={value}
          onChangeText={setValue}
          onFocus={onFocus}
          onBlur={() => { onBlurred(); void save() }}
          maxLength={NOTE_MAX}
          multiline
          placeholder="Add a note"
          placeholderTextColor={tc.inkMuted}
          accessibilityLabel={`Your note on ${entry.albumName}`}
          style={styles.noteField}
        />
        {busy && <View style={styles.noteSpinner}><VinylSpinner size={14} /></View>}
      </View>
      {error && <Text style={styles.noteError}>{error}</Text>}
    </View>
  )
}

type RowState = 'busy' | 'added' | { error: string }

/** Add albums: your library, or the catalogs as Add an album searches them. */
function AddAlbumsSheet({ visible, slug, inBin, onClose, onAdded }: {
  visible: boolean
  slug: string
  inBin: Set<string>
  onClose: () => void
  onAdded: () => void
}) {
  const tc = useColors()
  const { user } = useAuth()
  const userId = user?.id
  const [tab, setTab] = useState<'library' | 'catalogs'>('library')
  const [query, setQuery] = useState('')
  const [state, setState] = useState<Record<string, RowState>>({})

  const { data: library = [], isLoading: libraryLoading } = useQuery({
    queryKey: ['albums', 'all', userId, 'library'],
    queryFn: () => fetchAlbums({ userId, excludeSingles: true }),
    enabled: visible && userId != null,
  })
  const { results, searching } = useAlbumSearch(visible && tab === 'catalogs' ? query : '')

  const q = query.trim().toLowerCase()
  const mine = library
    .filter((a) => !isUnreleased(a.releaseDate))
    .filter((a) => !q || a.albumName.toLowerCase().includes(q) || a.artist.toLowerCase().includes(q))
    .sort((a, b) => a.artist.localeCompare(b.artist) || a.albumName.localeCompare(b.albumName))

  async function add(key: string, source: () => Promise<{ albumId: number } | { release: Record<string, unknown> }>) {
    if (state[key] === 'busy' || state[key] === 'added') return
    selection()
    setState((s) => ({ ...s, [key]: 'busy' }))
    try {
      await addToBin(slug, await source())
      setState((s) => ({ ...s, [key]: 'added' }))
      success()
      onAdded()
    } catch (e) {
      setState((s) => ({ ...s, [key]: { error: binErrorText(e, 'Couldn’t add that album') } }))
    }
  }

  function close() {
    setQuery('')
    setState({})
    onClose()
  }

  const tabBtn = (t: 'library' | 'catalogs', label: string) => (
    <Pressable
      onPress={() => {
        if (tab === t) return
        selection()
        setTab(t)
      }}
      style={[styles.tab, tab === t && { backgroundColor: tc.greenFill }]}
      accessibilityRole="tab"
      accessibilityState={{ selected: tab === t }}
    >
      <Text style={[styles.tabText, tab === t && styles.tabTextOn]}>{label}</Text>
    </Pressable>
  )

  return (
    <BinSheet visible={visible} onClose={close} tall>
      <Text style={styles.sheetHeading}>Add albums</Text>
      <View style={styles.tabs} accessibilityRole="tablist">
        {tabBtn('library', 'Your library')}
        {tabBtn('catalogs', 'Search the catalogs')}
      </View>
      <View style={[styles.searchBar, { borderColor: tc.border }]}>
        <Search size={16} color={tc.inkMuted} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder={tab === 'library' ? 'Filter your library' : 'Search album or artist…'}
          placeholderTextColor={tc.inkMuted}
          accessibilityLabel={tab === 'library' ? 'Filter your library' : 'Search the catalogs'}
          autoCorrect={false}
          autoCapitalize="none"
          returnKeyType="search"
          style={styles.searchInput}
        />
        {tab === 'catalogs' && searching && <VinylSpinner size={16} />}
      </View>
      <ScrollView style={styles.pickList} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
        {tab === 'library' ? (
          libraryLoading ? (
            <View style={styles.pickState}><VinylSpinner size={44} /></View>
          ) : mine.length === 0 ? (
            <Text style={styles.pickEmpty}>{q ? 'Nothing in your library matches.' : 'Your library is empty.'}</Text>
          ) : (
            mine.map((a) => {
              const key = `album:${a.id}`
              return (
                <PickRow
                  key={key}
                  cover={a.albumArtUrl}
                  title={a.albumName}
                  sub={a.artist}
                  state={inBin.has(recordKey(a.albumName, a.artist)) ? 'added' : state[key]}
                  onAdd={() => add(key, async () => ({ albumId: a.id }))}
                />
              )
            })
          )
        ) : (
          results.map((r: AlbumSearchResult) => {
            const key = `catalog:${r.source}:${r.source_id}`
            return (
              <PickRow
                key={key}
                cover={r.cover_url}
                title={r.album_name}
                sub={`${r.artist}${r.year ? ` · ${r.year}` : ''}`}
                state={
                  r.upcoming
                    ? { error: 'That album isn’t out yet' }
                    : inBin.has(recordKey(r.album_name, r.artist)) ? 'added' : state[key]
                }
                disabled={!!r.upcoming}
                onAdd={() => add(key, async () => ({ release: (await resolveAlbum(r)) as unknown as Record<string, unknown> }))}
              />
            )
          })
        )}
      </ScrollView>
    </BinSheet>
  )
}

function PickRow({ cover, title, sub, state, disabled = false, onAdd }: {
  cover: string | null | undefined
  title: string
  sub: string
  state: RowState | undefined
  disabled?: boolean
  onAdd: () => void
}) {
  const tc = useColors()
  const error = typeof state === 'object' ? state.error : null
  const off = disabled || state === 'busy' || state === 'added'
  return (
    <View style={styles.pickRow}>
      <View style={styles.pickMain}>
        {cover ? (
          <CoverImage url={cover} displayPx={44} style={styles.pickCover} />
        ) : (
          <View style={[styles.pickCover, styles.coverEmpty]}><Music size={14} color={tc.inkMuted} /></View>
        )}
        <View style={styles.rowText}>
          <Text style={styles.pickTitle} numberOfLines={1}>{title}</Text>
          <Text style={styles.pickSub} numberOfLines={1}>{sub}</Text>
        </View>
        <Pressable
          onPress={onAdd}
          disabled={off}
          hitSlop={6}
          style={[styles.pickBtn, state === 'added' ? { backgroundColor: tc.inset } : { backgroundColor: tc.greenSoft }, disabled && { opacity: 0.5 }]}
          accessibilityRole="button"
          accessibilityLabel={state === 'added' ? `${title} is in the bin` : `Add ${title}`}
        >
          {state === 'busy' ? (
            <VinylSpinner size={13} />
          ) : state === 'added' ? (
            <Check size={13} color={tc.green} strokeWidth={2.6} />
          ) : (
            <Plus size={13} color={tc.green} strokeWidth={2.6} />
          )}
          <Text style={styles.pickBtnText}>{state === 'added' ? 'In bin' : 'Add'}</Text>
        </Pressable>
      </View>
      {error && <Text style={styles.pickError}>{error}</Text>}
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  bar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.sm,
  },
  barTitle: { fontFamily: fonts.display, fontSize: 26, lineHeight: 32, color: colors.ink },
  done: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 38, paddingHorizontal: spacing.lg, borderRadius: radii.pill },
  doneText: { fontFamily: fonts.bodySemiBold, fontSize: 14.5, color: '#ffffff' },
  content: { paddingHorizontal: spacing.lg, paddingTop: spacing.md },

  label: { marginTop: spacing.xl, marginBottom: spacing.sm, fontFamily: fonts.bodyBold, fontSize: 11, letterSpacing: 1.6, color: colors.inkMuted },
  pictureRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg },
  pictureActions: { alignItems: 'flex-start', gap: spacing.md },
  outlineBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: radii.pill, borderWidth: 1,
  },
  outlineBtnText: { fontFamily: fonts.bodySemiBold, fontSize: 13, color: colors.green },
  plainBtnText: { paddingHorizontal: 4, fontFamily: fonts.bodyMedium, fontSize: 13, color: colors.inkTertiary },
  field: {
    borderWidth: 1, borderRadius: radii.md, backgroundColor: colors.raised,
    paddingHorizontal: 14, paddingVertical: 11, fontFamily: fonts.body, fontSize: 15, color: colors.ink,
  },
  fieldTall: { minHeight: 96, textAlignVertical: 'top' },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.lg, marginTop: spacing.xl },
  switchLabel: { fontFamily: fonts.bodyMedium, fontSize: 15, color: colors.ink },
  error: { marginTop: spacing.lg, fontFamily: fonts.bodyMedium, fontSize: 13, color: colors.danger },

  recordsHead: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md,
    marginTop: spacing.xl, paddingTop: spacing.xl, borderTopWidth: StyleSheet.hairlineWidth,
  },
  count: { fontFamily: fonts.bodySemiBold, fontSize: 14, color: colors.inkSecondary },
  addBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    height: 38, paddingHorizontal: 14, borderRadius: radii.pill, borderWidth: 1,
  },
  addBtnText: { fontFamily: fonts.bodySemiBold, fontSize: 14, color: colors.green },
  empty: { paddingVertical: spacing.xxl, fontFamily: fonts.bodyMedium, fontSize: 14, color: colors.inkSecondary },

  row: { paddingVertical: spacing.md },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  cover: { width: COVER, height: COVER, borderRadius: radii.sm },
  coverEmpty: { backgroundColor: colors.inset, alignItems: 'center', justifyContent: 'center' },
  // The number on the cover's lower left, white with a soft shadow so it holds
  // on a pale cover — literal colours, since it sits on the art.
  rank: {
    position: 'absolute', left: 5, bottom: 0, fontFamily: fonts.displayBlack, fontSize: 20, lineHeight: 24,
    color: '#ffffff', fontVariant: ['tabular-nums'],
    textShadowColor: 'rgba(0,0,0,0.6)', textShadowRadius: 5, textShadowOffset: { width: 0, height: 1 },
  },
  rowText: { flex: 1, minWidth: 0 },
  rowTitle: { fontFamily: fonts.bodyBold, fontSize: 15, lineHeight: 19, color: colors.ink },
  rowSub: { marginTop: 2, fontFamily: fonts.bodyMedium, fontSize: 13, color: colors.inkSecondary },
  rowTools: { flexDirection: 'row', alignItems: 'center' },
  tool: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center', borderRadius: 16 },
  toolOff: { opacity: 0.3 },
  note: { marginTop: spacing.sm },
  noteField: {
    borderRadius: radii.sm, backgroundColor: colors.inset,
    paddingHorizontal: 12, paddingTop: 9, paddingBottom: 9, paddingRight: 30,
    fontFamily: fonts.body, fontSize: 13.5, lineHeight: 18, color: colors.ink,
  },
  noteSpinner: { position: 'absolute', right: 8, top: 8 },
  noteError: { marginTop: 4, fontFamily: fonts.bodyMedium, fontSize: 12.5, color: colors.danger },
  deleteBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    marginTop: spacing.xl, paddingTop: spacing.xl, borderTopWidth: StyleSheet.hairlineWidth,
  },
  deleteText: { fontFamily: fonts.bodySemiBold, fontSize: 14, color: colors.danger },

  sheetHeading: { fontFamily: fonts.display, fontSize: 22, lineHeight: 28, color: colors.ink, marginBottom: spacing.md },
  tabs: { flexDirection: 'row', gap: 4, marginBottom: spacing.md },
  tab: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: radii.pill },
  tabText: { fontFamily: fonts.bodySemiBold, fontSize: 13, color: colors.inkSecondary },
  tabTextOn: { color: '#ffffff' },
  searchBar: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    height: 42, paddingHorizontal: spacing.md, borderRadius: radii.md, borderWidth: 1, backgroundColor: colors.raised,
  },
  searchInput: { flex: 1, fontFamily: fonts.body, fontSize: 15, color: colors.ink },
  pickList: { flex: 1, marginTop: spacing.sm },
  pickState: { alignItems: 'center', paddingVertical: spacing.xxl },
  pickEmpty: { paddingVertical: spacing.xl, fontFamily: fonts.bodyMedium, fontSize: 14, color: colors.inkSecondary },
  pickRow: { paddingVertical: 7 },
  pickMain: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  pickCover: { width: 44, height: 44, borderRadius: radii.sm },
  // Add an album's result-row type.
  pickTitle: { fontFamily: fonts.bodySemiBold, fontSize: 15, color: colors.ink },
  pickSub: { marginTop: 2, fontFamily: fonts.body, fontSize: 13, color: colors.inkTertiary },
  pickBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, height: 32, paddingHorizontal: 12, borderRadius: radii.sm },
  pickBtnText: { fontFamily: fonts.bodySemiBold, fontSize: 12.5, color: colors.green },
  pickError: { marginTop: 3, paddingLeft: 44 + spacing.md, fontFamily: fonts.bodyMedium, fontSize: 12.5, color: colors.danger },
})
