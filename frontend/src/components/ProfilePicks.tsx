// The three picks on a profile — favourite song, album and artist — and, on
// your own, the picker behind each card. Mobile's ProfileBanner picks row and
// its app/favorite/* screens, as cards and a dialog.
//
// The picks live on the account (PressUser.favorite_*; PATCH /users/{id}), so
// one set shows on both platforms. Hidden until picks_unlocked — ten rated
// albums, PICKS_MIN_RATED_ALBUMS in backend/routers/users.py — as on mobile;
// on someone else's page an untouched set hides too, since three empty slots
// there say nothing.
import { useEffect, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Loader2, Search, X } from 'lucide-react'
import {
  fetchAlbums, fetchArtistImage, fetchArtistStats, fetchRankedSongs, fetchScatterData, updateUser,
  type Profile,
} from '../api'
import CoverImg from './CoverImg'
import { Cover } from './covers'
import { SECTION_LABEL } from './albumView'
import { songScoreColor } from '../types'
import { stagger } from '../lib/format'

type Kind = 'song' | 'album' | 'artist'

export default function ProfilePicks({ profile, editable }: { profile: Profile; editable: boolean }) {
  const [picking, setPicking] = useState<Kind | null>(null)
  const artist = profile.favorite_artist
  // The artist page's lookup and cache key, so whichever screen asks first pays.
  const { data: artistImage } = useQuery({
    queryKey: ['artist-image', artist],
    queryFn: () => fetchArtistImage(artist!),
    enabled: !!artist,
    staleTime: Infinity,
  })

  if (!profile.picks_unlocked) return null
  const song = profile.favorite_song
  const album = profile.favorite_album
  if (!editable && !song && !album && !artist) return null

  const cards: { kind: Kind; label: string; art?: string | null; title?: string | null; sub?: string | null }[] = [
    { kind: 'song', label: 'Song', art: song?.album_art_url, title: song?.title, sub: song?.artist ?? song?.album_name },
    { kind: 'album', label: 'Album', art: album?.album_art_url, title: album?.album_name, sub: album?.artist },
    { kind: 'artist', label: 'Artist', art: artistImage, title: artist },
  ]

  return (
    <section className="mb-8">
      <p className={`${SECTION_LABEL} mb-3`}>{editable ? 'MY PICKS' : 'PICKS'}</p>
      <div className="grid max-w-xl grid-cols-3 gap-4">
        {cards.map((c, i) => {
          const empty = !c.title
          const body = (
            <>
              <p className="m-0 mb-2 text-[11px] font-bold tracking-[0.14em] text-[#a8998a]">{c.label.toUpperCase()}</p>
              <div
                className={`relative aspect-square overflow-hidden rounded-2xl ${empty ? 'border-2 border-dashed border-[#d7cfc3] bg-transparent' : 'bg-[#ebe5dc] shadow-[0_14px_30px_-20px_rgba(40,25,10,0.55)]'} transition-transform duration-[250ms] ease-out ${editable ? 'group-hover:scale-[1.04] group-hover:-rotate-1' : ''}`}
              >
                <span className={`font-display absolute inset-0 flex items-center justify-center ${empty ? 'text-[34px] text-[#c8c0b4]' : 'text-[40px] text-[#a8998a]'}`}>
                  {empty ? '+' : c.title![0]?.toUpperCase()}
                </span>
                {c.art && (c.kind === 'artist'
                  ? <img src={c.art} alt="" className="absolute inset-0 h-full w-full object-cover" />
                  : <CoverImg url={c.art} displayPx={180} alt="" className="absolute inset-0 h-full w-full object-cover" />)}
              </div>
              <p className={`m-0 mt-2.5 truncate text-[14px] font-semibold ${empty ? 'text-[#a8998a]' : 'text-[#1c1917]'}`}>
                {c.title ?? (editable ? 'Choose' : 'Not set')}
              </p>
              {c.sub && <p className="m-0 mt-0.5 truncate text-[12.5px] text-[#8a7f72]">{c.sub}</p>}
            </>
          )
          return editable ? (
            <button
              key={c.kind}
              onClick={() => setPicking(c.kind)}
              className="group min-w-0 text-left rise-in"
              style={stagger(i)}
              aria-label={`${empty ? 'Choose' : 'Change'} your favorite ${c.label.toLowerCase()}`}
            >
              {body}
            </button>
          ) : (
            <div key={c.kind} className="min-w-0 rise-in" style={stagger(i)}>{body}</div>
          )
        })}
      </div>
      {picking && <PickDialog kind={picking} profile={profile} onClose={() => setPicking(null)} />}
    </section>
  )
}

interface Row {
  key: string; title: string; sub?: string | null; art?: string | null; score?: number | null
  /** An index figure (wSong+) shown in place of a score. */
  plus?: number | null
  selected: boolean; patch: Parameters<typeof updateUser>[1]
}

const QUESTION: Record<Kind, string> = {
  song: 'What’s your favorite song right now?',
  album: 'What’s your favorite album right now?',
  artist: 'What’s your favorite artist right now?',
}

function PickDialog({ kind, profile, onClose }: { kind: Kind; profile: Profile; onClose: () => void }) {
  const qc = useQueryClient()
  const userId = profile.id
  const [search, setSearch] = useState('')
  const [debounced, setDebounced] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Songs are searched on the server — a library holds thousands — so the
  // query waits for typing to settle, as mobile's does.
  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 250)
    return () => clearTimeout(t)
  }, [search])

  const albums = useQuery({
    queryKey: ['albums', 'rated', userId],
    queryFn: () => fetchAlbums({ status: 'rated', userId }),
    enabled: kind === 'album',
  })
  const songs = useQuery({
    queryKey: ['ranked-songs', userId, debounced],
    queryFn: () => fetchRankedSongs({ userId, q: debounced || undefined }),
    enabled: kind === 'song',
    staleTime: 5 * 60_000,
  })
  const artists = useQuery({
    queryKey: ['artist-stats', userId],
    queryFn: () => fetchArtistStats(userId),
    enabled: kind === 'artist',
  })
  // Artists are ranked by wSong+ — song average and the records' factors,
  // indexed to 100 against your own artists. /stats/artists doesn't compute it
  // (its wSongPlus is a 0 placeholder); /stats/scatter does, per artist.
  const scatter = useQuery({
    queryKey: ['scatter', userId],
    queryFn: () => fetchScatterData(userId),
    enabled: kind === 'artist',
  })

  const q = search.trim().toLowerCase()
  const rows: Row[] = useMemo(() => {
    if (kind === 'album') {
      return [...(albums.data ?? [])]
        .filter((a) => !q || a.albumName.toLowerCase().includes(q) || a.artist.toLowerCase().includes(q))
        .sort((a, b) => (b.score ?? -1) - (a.score ?? -1))
        .map((a) => ({
          key: String(a.id), title: a.albumName, sub: a.artist, art: a.albumArtUrl, score: a.score,
          selected: profile.favorite_album?.id === a.id, patch: { favoriteAlbumId: a.id },
        }))
    }
    if (kind === 'song') {
      return (songs.data ?? []).map((s) => ({
        key: String(s.id), title: s.title, sub: `${s.artist} · ${s.album_name}`, art: s.album_art_url, score: s.score,
        selected: profile.favorite_song?.id === s.id, patch: { favoriteSongId: s.id },
      }))
    }
    const wsp = new Map((scatter.data?.points ?? []).map((p) => [p.artist.trim().toLowerCase(), p.w_song_plus]))
    return (artists.data ?? [])
      .filter((s) => !q || s.artist.toLowerCase().includes(q))
      .map((s) => ({ s, plus: wsp.get(s.artist.trim().toLowerCase()) ?? null }))
      // Highest wSong+ first; artists without one (no record with all four
      // factors rated) after, by song average.
      .sort((a, b) => (b.plus ?? -Infinity) - (a.plus ?? -Infinity) || b.s.avgSongScore - a.s.avgSongScore)
      .map(({ s, plus }) => ({
        key: s.artist, title: s.artist, sub: `${s.count} ${s.count === 1 ? 'song' : 'songs'}`, plus,
        score: plus == null ? s.avgSongScore : null,
        selected: profile.favorite_artist === s.artist, patch: { favoriteArtist: s.artist },
      }))
  }, [kind, albums.data, songs.data, artists.data, scatter.data, q, profile])

  const loading = kind === 'album' ? albums.isLoading : kind === 'song' ? songs.isLoading : artists.isLoading || scatter.isLoading
  const hasPick = kind === 'album' ? !!profile.favorite_album : kind === 'song' ? !!profile.favorite_song : !!profile.favorite_artist
  const clearPatch = kind === 'album' ? { favoriteAlbumId: null } : kind === 'song' ? { favoriteSongId: null } : { favoriteArtist: null }

  async function save(patch: Row['patch']) {
    if (saving) return
    setSaving(true)
    setError(null)
    try {
      qc.setQueryData(['profile', userId], await updateUser(userId, patch))
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save your pick')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm fade-in" onClick={saving ? undefined : onClose} />
      <div role="dialog" aria-modal="true" aria-labelledby="pick-title" className="relative flex max-h-[80vh] w-full max-w-lg flex-col rounded-3xl bg-[#f9f8f6] shadow-xl pop-in">
        <div className="px-6 pt-6">
          <div className="flex items-start justify-between gap-4">
            <h2 id="pick-title" className="font-display m-0 text-[24px] font-bold leading-tight text-[#1c1917]">{QUESTION[kind]}</h2>
            <button onClick={onClose} aria-label="Close" className="mt-1 text-[#a8998a] hover:text-[#57534e]"><X size={18} /></button>
          </div>
          <div className="mt-4 flex items-center gap-2 rounded-xl border border-[#e2dbd0] bg-white px-3 py-2.5">
            <Search size={15} className="text-[#a8998a]" />
            <input
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={`Search your ${kind === 'artist' ? 'artists' : `rated ${kind}s`}`}
              className="flex-1 bg-transparent text-[14px] text-[#1c1917] placeholder:text-[#b5aa9c] focus:outline-none"
            />
          </div>
          <div className="flex items-center justify-between py-2">
            {error ? <p className="m-0 text-[13px] text-[#b91c1c]">{error}</p> : <span />}
            {hasPick && (
              <button onClick={() => save(clearPatch)} disabled={saving} className="text-[13px] font-medium text-[#78716c] hover:text-[#1c1917]">
                Clear this pick
              </button>
            )}
          </div>
        </div>
        <ul className="m-0 min-h-0 flex-1 list-none overflow-y-auto px-3 pb-4">
          {loading ? (
            <li className="flex justify-center py-10"><Loader2 size={18} className="animate-spin text-[#2d6a4f]" /></li>
          ) : rows.length === 0 ? (
            <li className="py-10 text-center text-[14px] text-[#8a7f72]">{q || debounced ? 'Nothing matches your search.' : `No rated ${kind}s yet.`}</li>
          ) : rows.map((r, i) => (
            <li key={r.key}>
              <button
                onClick={() => save(r.patch)}
                disabled={saving}
                className="flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left transition-colors hover:bg-[#f2eee7] disabled:opacity-60"
              >
                <span className="w-6 shrink-0 text-right text-[12.5px] tabular-nums text-[#b5aa9c]">{i + 1}</span>
                {kind !== 'artist' && (
                  <span className="h-10 w-10 shrink-0 overflow-hidden rounded-lg">
                    {r.art ? <CoverImg url={r.art} displayPx={40} alt="" className="h-full w-full object-cover" /> : <Cover artUrl={null} seed={r.title} size={40} radius={0} fontSize={16} />}
                  </span>
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14.5px] font-semibold text-[#1c1917]">{r.title}</span>
                  {r.sub && <span className="block truncate text-[12.5px] text-[#8a7f72]">{r.sub}</span>}
                </span>
                {r.plus != null && (
                  <span className="shrink-0 text-right">
                    <span className="font-display block text-[16px] font-bold leading-none tabular-nums text-[#1c1917]">{Math.round(r.plus)}</span>
                    <span className="block text-[10px] font-semibold tracking-[0.1em] text-[#a8998a]">wSONG+</span>
                  </span>
                )}
                {r.score != null && (
                  <span className="font-display shrink-0 text-[16px] font-bold tabular-nums" style={{ color: songScoreColor(r.score) }}>
                    {kind === 'album' ? r.score.toFixed(2) : r.score.toFixed(1)}
                  </span>
                )}
                <span className="w-5 shrink-0">{r.selected && <Check size={17} className="text-[#2d6a4f]" strokeWidth={2.6} />}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
