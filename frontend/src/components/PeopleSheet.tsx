// "People who rated this too" — the dialog that follows a first album rating
// (spec §5.2). Mobile draws it as a bottom sheet over the album page; web, as a
// dialog over whatever page you're on, which after the share card is the album.
//
// The server decides that a sheet is owed and whom it names; this decides only
// when it's on screen. Fetching a sheet records nothing, so the one "shown" is
// reported from here, once the dialog has rendered — a sheet fetched while the
// tab was closing would otherwise count as seen and never come back.
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Clock, MessageCircle, UserPlus, X } from 'lucide-react'
import { addFriend, fetchPeopleSheet, logSheetEvent, resolveThread } from '../api'
import { useUser } from '../context/UserContext'
import type { PeopleSheetData, SheetAction, SheetPerson } from '../types'
import { threadKey, threadPath } from '../lib/threads'
import { PEOPLE_SHEET_KEY } from '../lib/peopleSheet'
import { phoneVerifyConfigured } from '../lib/phoneVerify'
import { stagger } from '../lib/format'
import Avatar from './Avatar'
import { Cover, COVER_LIFT } from './covers'
import { GREEN } from './albumView'
import VinylSpinner from './VinylSpinner'

// Per page load, not per mount: Layout remounts between route trees (Charts has
// its own), and one sheet must report "shown" once however often it does.
const reported = new Set<number>()

/** A log is a measurement, not part of the action: it never holds one up. */
function log(sheetId: number, action: SheetAction, targetUserId?: number) {
  logSheetEvent(sheetId, action, targetUserId).catch(() => {})
}

/** Mounted once, in Layout, the query's only observer — so the two triggers,
 *  the app loading (a sheet owed from a rating on the other device) and the
 *  rating flow invalidating the key as its share card closes, can never open
 *  two dialogs. The rating flow sits outside Layout, so the sheet can never
 *  land on top of it. */
export function PeopleSheetHost() {
  const { activeUser } = useUser()
  const queryClient = useQueryClient()
  const key = [...PEOPLE_SHEET_KEY, activeUser?.id]
  const { data } = useQuery({
    queryKey: key,
    queryFn: fetchPeopleSheet,
    enabled: !!activeUser,
    staleTime: Infinity,
    retry: false,
  })
  // The one-time phone prompt has the floor while it's up.
  const phonePrompt = phoneVerifyConfigured && activeUser?.phonePromptDone === false
  if (!data || data.people.length === 0 || phonePrompt) return null
  // Cleared locally on close: the server stops owing it once "shown" lands,
  // and a remount before the next fetch shouldn't reopen it.
  return <PeopleSheet data={data} onClose={() => queryClient.setQueryData(key, null)} />
}

function SongNotes({ person }: { person: SheetPerson }) {
  const { topSong, bottomSong, fromAlbum } = person
  if (!topSong && !bottomSong) return null
  // Drawn exactly as For You's review previews draw them.
  return (
    <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11.5px] text-(--c-8a7f72)">
      {topSong && (
        <span className="truncate">
          <span className="font-semibold text-(--c-2d6a4f)">Best</span> {topSong.title}
          <span className="tabular-nums text-(--c-b3a99c)"> · {topSong.score.toFixed(1)}</span>
        </span>
      )}
      {bottomSong && (
        <span className="truncate">
          <span className="font-semibold text-(--c-b1542f)">Worst</span> {bottomSong.title}
          <span className="tabular-nums text-(--c-b3a99c)"> · {bottomSong.score.toFixed(1)}</span>
        </span>
      )}
      {fromAlbum && <span className="w-full truncate">from <i>{fromAlbum}</i></span>}
    </div>
  )
}

export default function PeopleSheet({ data, onClose }: { data: PeopleSheetData; onClose: () => void }) {
  const { activeUser, setViewingUser } = useUser()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [added, setAdded] = useState<Set<number>>(() => new Set())
  const [adding, setAdding] = useState<number | null>(null)
  const [opening, setOpening] = useState(false)
  const { sheetId, album, people } = data

  useEffect(() => {
    if (reported.has(sheetId)) return
    reported.add(sheetId)
    log(sheetId, 'shown')
  }, [sheetId])

  function dismiss() {
    log(sheetId, 'not_now')
    onClose()
  }

  function openProfile(p: SheetPerson) {
    log(sheetId, 'open_profile', p.user.id)
    onClose()
    setViewingUser({ id: p.user.id, name: p.user.name, avatarUrl: p.user.avatarUrl })
    navigate(`/u/${p.user.id}`)
  }

  async function add(p: SheetPerson) {
    if (!activeUser || adding != null || added.has(p.user.id)) return
    setAdding(p.user.id)
    try {
      await addFriend(activeUser.id, p.user.id)
      log(sheetId, 'add', p.user.id)
      setAdded((s) => new Set(s).add(p.user.id))
      queryClient.invalidateQueries({ queryKey: ['friend-requests'] })
    } catch { /* the button stays as it was */ } finally {
      setAdding(null)
    }
  }

  // The rater has just finished the record, so thread_access admits them; the
  // resolve is the album page's own (AlbumThoughts), cached for the thread page.
  async function openDiscussion() {
    if (opening) return
    setOpening(true)
    log(sheetId, 'open_discussion')
    await queryClient
      .fetchQuery({
        queryKey: threadKey('album', album.artist, album.name),
        queryFn: () => resolveThread({ subjectType: 'album', artist: album.artist, album: album.name }),
      })
      .catch(() => null)
    onClose()
    navigate(threadPath('album', album.artist, album.name))
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={dismiss}>
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm fade-in" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={data.fallback ? 'People who like what you like' : `People who rated ${album.name} too`}
        className="relative max-h-[calc(100vh-2rem)] w-full max-w-4xl overflow-y-auto rounded-[24px] border border-(--c-e8e2d9) bg-(--c-f9f8f6) p-6 shadow-xl pop-in md:p-8"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-4">
          <Cover artUrl={album.artUrl} seed={album.artist} size={64} radius={12} />
          {/* One face for the whole line, a title's: the album stands out by
              italics, not by switching family mid-sentence. */}
          <h2 className="font-display m-0 min-w-0 flex-1 text-[22px] font-bold leading-snug text-(--c-1c1917) md:text-[26px]">
            {data.fallback || data.raters == null ? 'People who like what you like' : (
              <>
                {data.raters} {data.raters === 1 ? 'person' : 'people'} rated <i>{album.name}</i> too
              </>
            )}
          </h2>
          <button onClick={dismiss} aria-label="Close" className="self-start text-(--c-a8998a) transition-colors hover:text-(--c-57534e)">
            <X size={20} />
          </button>
        </div>

        <ul className={`m-0 mt-6 grid list-none gap-3 p-0 ${people.length >= 3 ? 'md:grid-cols-3' : people.length === 2 ? 'md:grid-cols-2' : ''}`}>
          {people.map((p, i) => {
            const isAdded = added.has(p.user.id)
            return (
              <li key={p.user.id} className="rise-in min-w-0 rounded-2xl border border-(--c-ece5da) bg-(--c-fff) p-4" style={stagger(i)}>
                <div className="flex items-center gap-3">
                  <button onClick={() => openProfile(p)} className="group shrink-0 cursor-pointer border-none bg-transparent p-0" aria-label={`Open ${p.user.name}'s profile`}>
                    <div className={COVER_LIFT}>
                      <Avatar name={p.user.name} avatarUrl={p.user.avatarUrl} size={44} />
                    </div>
                  </button>
                  <button
                    onClick={() => openProfile(p)}
                    className="min-w-0 flex-1 cursor-pointer truncate border-none bg-transparent p-0 text-left text-[15px] font-semibold text-(--c-1c1917) hover:underline"
                  >
                    {p.user.name}
                  </button>
                  <span className="flex shrink-0 items-baseline gap-1.5" style={{ color: GREEN }}>
                    <span className="font-display text-[26px] font-bold leading-none tabular-nums">{p.percent}%</span>
                    <span className="text-xs font-semibold">taste overlap</span>
                  </span>
                </div>
                <SongNotes person={p} />
                <button
                  onClick={() => add(p)}
                  disabled={isAdded || adding === p.user.id}
                  className={`mt-3.5 flex w-full items-center justify-center gap-2 rounded-xl py-2 text-sm font-semibold transition-colors disabled:cursor-default ${
                    isAdded ? 'bg-(--c-2d6a4f)/10 text-(--c-2d6a4f)' : 'bg-(--c-green-fill) text-white hover:bg-(--c-green-fill-hover)'
                  }`}
                >
                  {adding === p.user.id ? <VinylSpinner size={17} />
                    : isAdded ? <Clock size={15} className="pop" />
                    : <UserPlus size={15} />}
                  {isAdded ? 'Requested' : 'Add'}
                </button>
              </li>
            )
          })}
        </ul>

        <div className="mt-6 flex flex-wrap items-center justify-end gap-2.5">
          <button
            onClick={dismiss}
            className="rounded-xl px-5 py-2.5 text-sm font-semibold text-(--c-57534e) transition-colors hover:bg-(--c-efe9e0)"
          >
            Not now
          </button>
          <button
            onClick={openDiscussion}
            disabled={opening}
            className="flex items-center gap-2 rounded-xl border border-(--c-e2dbd0) bg-(--c-fff) px-5 py-2.5 text-sm font-semibold text-(--c-2d6a4f) transition-colors hover:border-(--c-2d6a4f) disabled:opacity-60"
          >
            {opening ? <VinylSpinner size={17} /> : <MessageCircle size={16} />}
            Open the discussion
          </button>
        </div>
      </div>
    </div>
  )
}
