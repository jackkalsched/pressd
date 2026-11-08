// Search Pressd: people, records, artists and songs in one call (GET /search/all),
// then the catalogs' albums that Pressd doesn't have yet. Opened from the icon on
// For You, pushed over the tabs; Cancel goes back to where you were.
//
// Before typing it shows this account's last few tapped results, kept in the
// Keychain under recentKey(user id) and removed at sign-out (lib/auth.tsx).
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import * as SecureStore from 'expo-secure-store'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { Image } from 'expo-image'
import { Check, Plus, Search, Star, X } from 'lucide-react-native'
import { useAlbumSearch } from '@pressd/shared/hooks/useAlbumSearch'
import { pushRecent, recentKey, songTarget, type RecentItem } from '@pressd/shared/recentSearches'
import type { AlbumSearchResult } from '@pressd/shared/api'
import type { SearchAlbum, SearchArtist, SearchGroup, SearchPerson, SearchResults, SearchSong } from '@pressd/shared/types'
import { fetchArtistImage, searchAll, searchKnown } from '../lib/api'
import { useAuth } from '../lib/auth'
import { useOpenProfile } from '../lib/useOpenProfile'
import { catalogKey, deezerIdOf, useCatalogPick } from '../lib/catalogPick'
import * as haptics from '../lib/haptics'
import Avatar from '../components/Avatar'
import CoverImage from '../components/CoverImage'
import VinylSpinner from '../components/VinylSpinner'
import TracklistLoader from '../components/TracklistLoader'
import { colors, fonts, radii, spacing, useColors, scoreColor } from '../theme/tokens'

const SHOWN = 4
const COVER = 48

/** What a row opens. Stored with each recent search, so only plain values. */
type Target =
  | { kind: 'person'; id: number }
  | { kind: 'album'; albumId: number; community: boolean; track?: number }
  | { kind: 'artist'; name: string }
  | { kind: 'catalog'; album_name: string; artist: string; deezer: string | null }

const STATUS_LABEL = { listening: 'Listening', to_listen: 'To Listen' } as const

function useDebounced(value: string, ms: number): string {
  const [out, setOut] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setOut(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return out
}

function songOpens(s: SearchSong): Target {
  const t = songTarget(s)
  return t.kind === 'community'
    ? { kind: 'album', albumId: t.albumId, community: true, track: t.highlight }
    : { kind: 'album', albumId: t.albumId, community: false, ...(t.highlight != null ? { track: t.highlight } : {}) }
}

export default function SearchScreen() {
  const tc = useColors()
  const router = useRouter()
  const { user } = useAuth()
  const openProfile = useOpenProfile()
  const userId = user?.id

  const [query, setQuery] = useState('')
  const q = useDebounced(query.trim(), 200)
  const active = q.length >= 2

  const catalog = useCatalogPick()

  // ── Recent searches ──
  const [recents, setRecents] = useState<RecentItem[]>([])
  useEffect(() => {
    if (userId == null) return
    let live = true
    ;(async () => {
      try {
        const raw = await SecureStore.getItemAsync(recentKey(userId))
        const list = raw ? JSON.parse(raw) : []
        if (live && Array.isArray(list)) setRecents(list)
      } catch { /* none kept */ }
    })()
    return () => { live = false }
  }, [userId])

  function saveRecents(next: RecentItem[]) {
    setRecents(next)
    if (userId == null) return
    try {
      const write = next.length
        ? SecureStore.setItemAsync(recentKey(userId), JSON.stringify(next))
        : SecureStore.deleteItemAsync(recentKey(userId))
      write.catch(() => {})
    } catch { /* best effort */ }
  }

  function open(item: RecentItem) {
    haptics.selection()
    saveRecents(pushRecent(recents, item))
    const t = item.target as Target
    switch (t.kind) {
      case 'person':
        openProfile(t.id)
        return
      case 'album':
        router.push({
          pathname: '/album/[id]',
          params: {
            id: String(t.albumId),
            ...(t.community ? { community: '1' } : {}),
            ...(t.track != null ? { track: String(t.track) } : {}),
          },
        })
        return
      case 'artist':
        router.push({ pathname: '/artist/[name]', params: { name: encodeURIComponent(t.name), mode: 'pressd' } })
        return
      case 'catalog':
        catalog.preview(t)
        return
    }
  }

  // ── Pressd ──
  const { data: results, isLoading, isError, isPlaceholderData } = useQuery({
    queryKey: ['search', userId, q],
    queryFn: () => searchAll(q),
    enabled: active && userId != null,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  })
  // See all: one group re-asked for its full list, shown in place of its four.
  const [expanded, setExpanded] = useState<SearchGroup | 'catalog' | null>(null)
  const [expandedFor, setExpandedFor] = useState(q)
  if (expandedFor !== q) {
    setExpandedFor(q)
    setExpanded(null)
  }
  const pressdGroup = expanded && expanded !== 'catalog' ? expanded : null
  const { data: full, isFetching: fullLoading } = useQuery({
    queryKey: ['search', userId, q, pressdGroup],
    queryFn: () => searchAll(q, pressdGroup!),
    enabled: active && pressdGroup != null && userId != null,
    staleTime: 30_000,
  })

  function rows<G extends SearchGroup>(g: G): { list: SearchResults[G]; more: boolean } {
    const base: SearchResults[G] = results?.[g] ?? ([] as SearchResults[G])
    if (expanded === g && full) return { list: full[g], more: false }
    return { list: base.slice(0, SHOWN) as SearchResults[G], more: base.length > SHOWN }
  }

  // ── The catalogs, minus what Pressd already has ──
  const { results: catalogHits, searching: catalogSearching } = useAlbumSearch(active ? query : '')
  // Whether Pressd has each catalog hit, by name and artist, kept for the screen's
  // life. The hook answers twice per query (iTunes + Deezer, then MusicBrainz merged
  // in), so the check runs only for hits not yet asked about, and rows already
  // cleared stay put while it does.
  const [verdicts, setVerdicts] = useState<Map<string, boolean>>(() => new Map())
  const unchecked = useMemo(() => {
    const seen = new Set<string>()
    const out: { name: string; artist: string }[] = []
    for (const r of catalogHits) {
      const k = hitKey(r)
      if (verdicts.has(k) || seen.has(k)) continue
      seen.add(k)
      out.push({ name: r.album_name, artist: r.artist })
    }
    return out
  }, [catalogHits, verdicts])
  const { isError: knownFailed } = useQuery({
    queryKey: ['search-known', unchecked],
    queryFn: async () => {
      const known = await searchKnown(unchecked)
      const have = new Set(known.map((k) => k.index))
      setVerdicts((prev) => {
        const next = new Map(prev)
        unchecked.forEach((u, i) => next.set(`${u.name}|${u.artist}`, have.has(i)))
        return next
      })
      return known
    },
    enabled: active && unchecked.length > 0,
  })
  // A hit not yet checked is held back, so a record Pressd has doesn't flash in and
  // out; if the check fails, it's shown.
  const fresh: AlbumSearchResult[] = useMemo(
    () =>
      catalogHits.filter((r) => {
        const v = verdicts.get(hitKey(r))
        return v === undefined ? knownFailed : !v
      }),
    [catalogHits, verdicts, knownFailed],
  )
  const catalogPending = active && (catalogSearching || (unchecked.length > 0 && !knownFailed))
  const catalogShown = expanded === 'catalog' ? fresh : fresh.slice(0, SHOWN)

  if (catalog.picked) {
    return (
      <SafeAreaView style={styles.screen} edges={['top']}>
        <TracklistLoader
          albumName={catalog.picked.album_name}
          artist={catalog.picked.artist}
          coverUrl={catalog.picked.cover_url}
        />
      </SafeAreaView>
    )
  }

  const people = rows('people')
  const albums = rows('albums')
  const artists = rows('artists')
  const songs = rows('songs')
  const nothingOnPressd =
    results != null &&
    !isPlaceholderData &&
    results.people.length + results.albums.length + results.artists.length + results.songs.length === 0

  function seeAll(g: SearchGroup | 'catalog') {
    haptics.selection()
    setExpanded(expanded === g ? null : g)
  }

  function header(label: string, g: SearchGroup | 'catalog', more: boolean, pending = false) {
    const isOpen = expanded === g
    return (
      <View style={styles.sectionHead}>
        <Text style={styles.sectionLabel}>{label}</Text>
        {pending ? (
          <VinylSpinner size="small" />
        ) : more || isOpen ? (
          <Pressable onPress={() => seeAll(g)} hitSlop={10}>
            <Text style={styles.seeAll}>{isOpen ? 'Show less' : 'See all'}</Text>
          </Pressable>
        ) : null}
      </View>
    )
  }

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.top}>
        <View style={[styles.searchBar, { borderColor: tc.border }]}>
          <Search size={18} color={tc.inkMuted} />
          <TextInput
            style={styles.input}
            value={query}
            onChangeText={setQuery}
            placeholder="Search Pressd"
            placeholderTextColor={tc.inkMuted}
            autoFocus
            autoCorrect={false}
            autoCapitalize="none"
            returnKeyType="search"
            clearButtonMode="never"
          />
          {query.length > 0 && (
            <Pressable onPress={() => setQuery('')} hitSlop={8} accessibilityLabel="Clear search">
              <X size={16} color={tc.inkMuted} />
            </Pressable>
          )}
        </View>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Text style={styles.cancel}>Cancel</Text>
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        showsVerticalScrollIndicator={false}
      >
        {!active ? (
          recents.length > 0 && (
            <View style={styles.section}>
              <View style={styles.sectionHead}>
                <Text style={styles.sectionLabel}>Recent</Text>
                <Pressable onPress={() => saveRecents([])} hitSlop={10}>
                  <Text style={styles.seeAll}>Clear</Text>
                </Pressable>
              </View>
              {recents.map((r) => (
                <Row
                  key={`${r.kind}:${r.key}`}
                  onPress={() => open(r)}
                  lead={<RecentLead item={r} />}
                  title={r.label}
                  sub={r.sub}
                />
              ))}
            </View>
          )
        ) : (
          <>
            {isLoading && !results && (
              <View style={styles.centerNote}>
                <VinylSpinner size={44} />
              </View>
            )}
            {isError && !isPlaceholderData && !results && <Text style={styles.note}>Search isn&rsquo;t answering. Try again.</Text>}
            {nothingOnPressd && <Text style={styles.note}>Nothing on Pressd matches &ldquo;{q}&rdquo;.</Text>}

            {people.list.length > 0 && (
              <View style={styles.section}>
                {header('People', 'people', people.more, expanded === 'people' && fullLoading)}
                {people.list.map((p) => (
                  <PersonRow key={p.id} person={p} onPress={() => open(personItem(p))} />
                ))}
              </View>
            )}

            {albums.list.length > 0 && (
              <View style={styles.section}>
                {header('Albums', 'albums', albums.more, expanded === 'albums' && fullLoading)}
                {albums.list.map((a) => (
                  <AlbumRow key={a.albumId} album={a} onPress={() => open(albumItem(a))} />
                ))}
              </View>
            )}

            {artists.list.length > 0 && (
              <View style={styles.section}>
                {header('Artists', 'artists', artists.more, expanded === 'artists' && fullLoading)}
                {artists.list.map((a) => (
                  <Row
                    key={a.name}
                    onPress={() => open(artistItem(a))}
                    lead={<ArtistLead name={a.name} />}
                    title={a.name}
                    sub={recordsLabel(a.records)}
                  />
                ))}
              </View>
            )}

            {songs.list.length > 0 && (
              <View style={styles.section}>
                {header('Songs', 'songs', songs.more, expanded === 'songs' && fullLoading)}
                {songs.list.map((s) => (
                  <Row
                    key={s.trackId}
                    onPress={() => open(songItem(s))}
                    lead={<CoverLead url={s.artUrl} name={s.albumName} />}
                    title={s.title}
                    sub={`${s.albumName} · ${s.artist}`}
                  />
                ))}
              </View>
            )}

            {(catalogPending || fresh.length > 0) && (
              <View style={styles.section}>
                {header('From the catalogs', 'catalog', fresh.length > SHOWN, catalogPending)}
                {catalog.error && <Text style={styles.error}>{catalog.error}</Text>}
                {catalogShown.map((r) => {
                  const done = catalog.shelved.includes(catalogKey(r))
                  return (
                    <Row
                      key={catalogKey(r)}
                      onPress={() => open(catalogItem(r))}
                      lead={<CoverLead url={r.cover_url} name={r.album_name} />}
                      title={r.album_name}
                      sub={`${r.artist}${r.year ? ` · ${r.year}` : ''}`}
                      trailing={
                        <View style={styles.actions}>
                          <Pressable
                            onPress={() => {
                              saveRecents(pushRecent(recents, catalogItem(r)))
                              catalog.pick(r, 'rate')
                            }}
                            hitSlop={6}
                            accessibilityLabel={`Rate ${r.album_name} now`}
                            style={({ pressed }) => [styles.actionBtn, pressed && styles.actionBtnOn]}
                          >
                            <Star size={17} color={tc.green} strokeWidth={2.2} />
                          </Pressable>
                          <Pressable
                            onPress={() => {
                              saveRecents(pushRecent(recents, catalogItem(r)))
                              catalog.pick(r, 'shelve')
                            }}
                            disabled={done}
                            hitSlop={6}
                            accessibilityLabel={`Add ${r.album_name} to library`}
                            style={({ pressed }) => [
                              styles.actionBtn,
                              done && styles.actionBtnDone,
                              pressed && !done && styles.actionBtnOn,
                            ]}
                          >
                            {done ? (
                              <Check size={17} color={tc.green} strokeWidth={2.5} />
                            ) : (
                              <Plus size={17} color={tc.green} strokeWidth={2.5} />
                            )}
                          </Pressable>
                        </View>
                      }
                    />
                  )
                })}
              </View>
            )}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  )
}

// ── What each result stores as a recent search ──

function personItem(p: SearchPerson): RecentItem {
  return {
    kind: 'person',
    key: String(p.id),
    label: p.name,
    artUrl: p.avatar_url ?? null,
    target: { kind: 'person', id: p.id } satisfies Target,
  }
}

function albumItem(a: SearchAlbum): RecentItem {
  return {
    kind: 'album',
    key: String(a.albumId),
    label: a.name,
    sub: a.artist,
    artUrl: a.artUrl,
    target: { kind: 'album', albumId: a.albumId, community: !a.mine } satisfies Target,
  }
}

function artistItem(a: SearchArtist): RecentItem {
  return {
    kind: 'artist',
    key: a.name.toLowerCase(),
    label: a.name,
    sub: recordsLabel(a.records),
    target: { kind: 'artist', name: a.name } satisfies Target,
  }
}

function songItem(s: SearchSong): RecentItem {
  return {
    kind: 'song',
    key: String(s.trackId),
    label: s.title,
    sub: `${s.albumName} · ${s.artist}`,
    artUrl: s.artUrl,
    target: songOpens(s),
  }
}

function catalogItem(r: AlbumSearchResult): RecentItem {
  return {
    kind: 'catalog',
    key: catalogKey(r),
    label: r.album_name,
    sub: r.artist,
    artUrl: r.cover_url,
    target: { kind: 'catalog', album_name: r.album_name, artist: r.artist, deezer: deezerIdOf(r) } satisfies Target,
  }
}

function hitKey(r: AlbumSearchResult): string {
  return `${r.album_name}|${r.artist}`
}

function recordsLabel(n: number): string {
  return `${n} ${n === 1 ? 'record' : 'records'}`
}

// ── Rows ──

function Row({
  onPress,
  lead,
  title,
  sub,
  trailing,
}: {
  onPress: () => void
  lead: ReactNode
  title: string
  sub?: string
  trailing?: ReactNode
}) {
  return (
    <View style={styles.row}>
      <Pressable
        onPress={onPress}
        style={({ pressed }) => [styles.rowMain, pressed && { opacity: 0.6 }]}
        accessibilityRole="button"
      >
        {lead}
        <View style={styles.rowText}>
          <Text style={styles.title} numberOfLines={1}>{title}</Text>
          {sub ? <Text style={styles.sub} numberOfLines={1}>{sub}</Text> : null}
        </View>
      </Pressable>
      {trailing}
    </View>
  )
}

function PersonRow({ person, onPress }: { person: SearchPerson; onPress: () => void }) {
  return (
    <Row
      onPress={onPress}
      lead={<Avatar name={person.name} avatarUrl={person.avatar_url} size={COVER} />}
      title={person.name}
      sub={person.already_friends ? 'Friends' : undefined}
    />
  )
}

function AlbumRow({ album, onPress }: { album: SearchAlbum; onPress: () => void }) {
  // Your own copy says where it is; everyone else's says what the room thinks.
  const unfinished = album.mine && album.status !== 'rated'
  const score = album.mine ? album.yourScore : album.pressdAvg
  return (
    <Row
      onPress={onPress}
      lead={<CoverLead url={album.artUrl} name={album.name} />}
      title={album.name}
      sub={
        album.mine || album.raters === 0
          ? album.artist
          : `${album.artist} · ${album.raters} ${album.raters === 1 ? 'rater' : 'raters'}`
      }
      trailing={
        unfinished ? (
          <Text style={styles.status}>{STATUS_LABEL[album.status as 'listening' | 'to_listen']}</Text>
        ) : score != null ? (
          <View style={styles.scoreBox}>
            <Text style={[styles.score, { color: scoreColor(score) }]}>{score.toFixed(2)}</Text>
            <Text style={styles.scoreLabel}>{album.mine ? 'YOURS' : 'PRESSD AVG'}</Text>
          </View>
        ) : null
      }
    />
  )
}

function CoverLead({ url, name }: { url: string | null | undefined; name: string }) {
  return (
    <View style={styles.cover}>
      {url ? (
        <CoverImage url={url} displayPx={COVER} style={styles.coverImg} />
      ) : (
        <Text style={styles.coverInitial}>{name[0]?.toUpperCase()}</Text>
      )}
    </View>
  )
}

/** The artist's photo, from the same cache the artist page reads. */
function ArtistLead({ name }: { name: string }) {
  const { data: image } = useQuery({
    queryKey: ['artist-image', name],
    queryFn: () => fetchArtistImage(name),
    enabled: !!name,
    staleTime: Infinity,
  })
  return (
    <View style={[styles.cover, styles.round]}>
      {image ? (
        <Image source={{ uri: image }} style={styles.coverImg} contentFit="cover" cachePolicy="memory-disk" />
      ) : (
        <Text style={styles.coverInitial}>{name[0]?.toUpperCase()}</Text>
      )}
    </View>
  )
}

function RecentLead({ item }: { item: RecentItem }) {
  if (item.kind === 'person') return <Avatar name={item.label} avatarUrl={item.artUrl} size={COVER} />
  if (item.kind === 'artist') return <ArtistLead name={item.label} />
  return <CoverLead url={item.artUrl} name={item.label} />
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  top: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm,
  },
  searchBar: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    height: 42,
    backgroundColor: colors.raised,
    borderRadius: radii.md,
    borderWidth: 1,
  },
  input: { flex: 1, fontFamily: fonts.body, fontSize: 15, color: colors.ink },
  cancel: { fontFamily: fonts.bodyMedium, fontSize: 15, color: colors.inkTertiary },
  content: { paddingHorizontal: spacing.lg, paddingBottom: 80 },

  section: { marginTop: spacing.lg },
  sectionHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 24,
    marginBottom: spacing.xs,
  },
  sectionLabel: { fontFamily: fonts.bodyBold, fontSize: 13, letterSpacing: 0.6, color: colors.ink },
  seeAll: { fontFamily: fonts.bodySemiBold, fontSize: 13, color: colors.green },

  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: 6 },
  rowMain: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  rowText: { flex: 1, minWidth: 0 },
  // Add an album's result-row type (add.tsx albumName / meta), for every row here.
  title: { fontFamily: fonts.bodySemiBold, fontSize: 15, color: colors.ink },
  sub: { fontFamily: fonts.body, fontSize: 13, color: colors.inkTertiary, marginTop: 2 },

  cover: {
    width: COVER,
    height: COVER,
    borderRadius: radii.sm,
    overflow: 'hidden',
    backgroundColor: colors.inset,
    alignItems: 'center',
    justifyContent: 'center',
  },
  coverImg: { width: COVER, height: COVER },
  coverInitial: { fontFamily: fonts.display, fontSize: 20, color: colors.inkMuted },
  round: { borderRadius: COVER / 2 },

  scoreBox: { alignItems: 'flex-end' },
  score: { fontFamily: fonts.display, fontSize: 18 },
  scoreLabel: { fontFamily: fonts.bodyBold, fontSize: 9, letterSpacing: 0.8, color: colors.inkMuted, marginTop: 1 },
  status: { fontFamily: fonts.bodySemiBold, fontSize: 12, color: colors.green },

  actions: { flexDirection: 'row', gap: 8 },
  actionBtn: {
    width: 34,
    height: 34,
    borderRadius: radii.sm,
    backgroundColor: colors.greenSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionBtnOn: { opacity: 0.55 },
  actionBtnDone: { backgroundColor: colors.inset },

  centerNote: { alignItems: 'center', marginTop: spacing.xxl },
  note: {
    fontFamily: fonts.body,
    fontSize: 14,
    color: colors.inkTertiary,
    textAlign: 'center',
    marginTop: spacing.xl,
  },
  error: { fontFamily: fonts.bodyMedium, fontSize: 13, color: colors.danger, marginBottom: spacing.xs },
})
