// Add to bin… on an album page — your copy, someone's copy, and the community
// view (spec 2026-11-13 §5), never inside the rating flow. Your own bins, each
// a tap to put the album in, plus New bin, which makes one here in the same
// sheet and puts this album in it. The mobile twin of web's AddToBinMenu.
//
// A copy of yours goes by its id, so the bin stores exactly the tracklist you
// hold; a record you don't hold is resolved from the catalogs by name, as Rate
// now on a public page does, once per sheet.
import { useRef, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Plus } from 'lucide-react-native'
import { addToBin, fetchBins, resolveReleaseByName, type BinCard } from '../lib/api'
import { useAuth } from '../lib/auth'
import { binErrorText, refreshBin } from '../lib/bins'
import { selection, success } from '../lib/haptics'
import { BinMosaic } from './BinCard'
import { BinSheet, NewBinForm } from './NewBinSheet'
import VinylSpinner from './VinylSpinner'
import { colors, fonts, radii, spacing, useColors } from '../theme/tokens'

type Source = { albumId: number } | { release: Record<string, unknown> }

export default function AddToBinSheet({ visible, onClose, ownAlbumId, albumName, artist }: {
  visible: boolean
  onClose: () => void
  /** Your copy of the record, in any edition, when you have one. */
  ownAlbumId: number | null
  albumName: string
  artist: string
}) {
  const tc = useColors()
  const queryClient = useQueryClient()
  const { user } = useAuth()
  const [making, setMaking] = useState(false)
  const [makingBusy, setMakingBusy] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [added, setAdded] = useState<string[]>([])
  const [error, setError] = useState<{ slug: string; text: string } | null>(null)
  const release = useRef<Promise<Record<string, unknown>> | null>(null)

  const { data: bins, isLoading, isError } = useQuery({
    queryKey: ['bins', 'mine', user?.id],
    queryFn: () => fetchBins('mine'),
    enabled: visible && !!user,
  })

  function close() {
    setMaking(false)
    setError(null)
    onClose()
  }

  function source(): Promise<Source> {
    if (ownAlbumId != null) return Promise.resolve({ albumId: ownAlbumId })
    if (!release.current) {
      release.current = resolveReleaseByName(albumName, artist).then((r) => r as unknown as Record<string, unknown>)
      // A failed lookup isn't kept, so the next tap asks again.
      release.current.catch(() => { release.current = null })
    }
    return release.current.then((r) => ({ release: r }))
  }

  async function add(slug: string) {
    if (busy) return
    selection()
    setBusy(slug)
    setError(null)
    try {
      await addToBin(slug, await source())
      setAdded((a) => [...a, slug])
      success()
      refreshBin(queryClient, slug)
    } catch (e) {
      setError({ slug, text: binErrorText(e, 'Couldn’t add it to that bin') })
    } finally {
      setBusy(null)
    }
  }

  function created(bin: BinCard) {
    setMaking(false)
    void add(bin.slug)
  }

  return (
    <BinSheet visible={visible} onClose={close} busy={makingBusy}>
      {making ? (
        <NewBinForm onCancel={() => setMaking(false)} onCreated={created} onBusy={setMakingBusy} />
      ) : (
        <>
          <Text style={styles.heading} numberOfLines={1}>Add to bin</Text>
          <Text style={styles.sub} numberOfLines={1}>{albumName} · {artist}</Text>
          {isLoading ? (
            <View style={styles.state}><VinylSpinner size={44} /></View>
          ) : isError ? (
            <View style={styles.state}><Text style={styles.stateText}>Couldn’t load your bins.</Text></View>
          ) : (
            <ScrollView style={styles.list} bounces={false} keyboardShouldPersistTaps="handled">
              {(bins ?? []).map((b, i) => {
                const done = added.includes(b.slug)
                return (
                  <View key={b.slug} style={i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderColor: tc.border }}>
                    <Pressable
                      onPress={() => !done && add(b.slug)}
                      disabled={busy != null}
                      style={({ pressed }) => [styles.row, pressed && { opacity: 0.6 }]}
                      accessibilityRole="button"
                      accessibilityLabel={done ? `${albumName} is in ${b.title}` : `Add ${albumName} to ${b.title}`}
                    >
                      <BinMosaic covers={b.covers} coverUrl={b.coverUrl} size={44} radius={radii.sm} />
                      <View style={styles.rowText}>
                        <Text style={styles.rowTitle} numberOfLines={1}>{b.title}</Text>
                        <Text style={styles.rowSub}>{b.entryCount} {b.entryCount === 1 ? 'album' : 'albums'}</Text>
                      </View>
                      {busy === b.slug ? (
                        <VinylSpinner size={20} />
                      ) : done ? (
                        <Check size={18} color={tc.green} strokeWidth={2.6} />
                      ) : null}
                    </Pressable>
                    {error?.slug === b.slug && <Text style={styles.error}>{error.text}</Text>}
                  </View>
                )
              })}
            </ScrollView>
          )}
          <Pressable
            onPress={() => {
              selection()
              setMaking(true)
            }}
            disabled={busy != null}
            style={({ pressed }) => [styles.newBin, { borderTopColor: tc.border }, pressed && { opacity: 0.6 }]}
            accessibilityRole="button"
          >
            <Plus size={17} color={tc.green} strokeWidth={2.4} />
            <Text style={styles.newBinText}>New bin</Text>
          </Pressable>
        </>
      )}
    </BinSheet>
  )
}

const styles = StyleSheet.create({
  heading: { fontFamily: fonts.display, fontSize: 22, lineHeight: 28, color: colors.ink },
  sub: { marginTop: 2, marginBottom: spacing.md, fontFamily: fonts.bodyMedium, fontSize: 13, color: colors.inkTertiary },
  list: { flexGrow: 0 },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.md },
  rowText: { flex: 1, minWidth: 0 },
  rowTitle: { fontFamily: fonts.bodySemiBold, fontSize: 15, color: colors.ink },
  rowSub: { marginTop: 2, fontFamily: fonts.body, fontSize: 12.5, color: colors.inkTertiary },
  error: { marginTop: -4, paddingBottom: spacing.md, paddingLeft: 44 + spacing.md, fontFamily: fonts.bodyMedium, fontSize: 12.5, color: colors.danger },
  state: { alignItems: 'center', justifyContent: 'center', paddingVertical: spacing.xl * 2 },
  stateText: { fontFamily: fonts.bodyMedium, fontSize: 14, color: colors.inkSecondary },
  newBin: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    paddingVertical: spacing.lg, marginTop: spacing.xs, borderTopWidth: StyleSheet.hairlineWidth,
  },
  newBinText: { fontFamily: fonts.bodySemiBold, fontSize: 15, color: colors.green },
})
