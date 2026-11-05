import { useEffect, useRef, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Check, Clock, Link2, Loader2, MapPin, MoreHorizontal, Pencil, Settings, UserMinus, UserPlus } from 'lucide-react'
import { acceptFriendRequest, addFriend, fetchFriendRequests, fetchFriends, fetchProfile, fetchSummary, fetchAlbums, fetchOverlap, getInviteLink, removeFriend } from '../api'
import { useUser } from '../context/UserContext'
import Library from './Library'
import { stagger } from '../lib/format'
import { songScoreColor } from '../types'
import { ScoreHistogram } from '../components/histograms'
import ProfilePicks from '../components/ProfilePicks'
import SettingsDialog, { type SettingsMode } from '../components/SettingsDialog'
import { OverlapPill } from '../components/TasteOverlap'
import Avatar from '../components/Avatar'
import Stats from './Stats'
import Ratings from './Ratings'

type Tab = 'library' | 'stats' | 'ratings'

function avatarColor(name: string): string {
  const colors = ['var(--c-2d6a4f)', 'var(--c-1d4ed8)', 'var(--c-7c3aed)', 'var(--c-b45309)', 'var(--c-0f766e)', 'var(--c-be185d)', 'var(--c-c2410c)']
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % colors.length
  return colors[h]
}

/** Top-N values by frequency across a list of (possibly null) tags. */
function topTags(tags: (string | null)[], n: number): string[] {
  const counts = new Map<string, number>()
  for (const t of tags) {
    if (t) counts.set(t, (counts.get(t) ?? 0) + 1)
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([t]) => t)
}

export default function FriendProfile() {
  const { userId } = useParams()
  const fid = Number(userId)
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { activeUser, setViewingUser } = useUser()
  const [tab, setTab] = useState<Tab>('library')
  const [busy, setBusy] = useState(false)
  // The banner's pencil and gear: Edit profile and Settings, one dialog in two modes.
  const [sheet, setSheet] = useState<SettingsMode | null>(null)
  const [shared, setShared] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  // Removing a friend always asks first, from the Friends button or the menu.
  const [confirmRemove, setConfirmRemove] = useState(false)
  const [linkCopied, setLinkCopied] = useState(false)
  const valid = Number.isFinite(fid)
  // Your own page: Settings instead of the friend button, and picks you can change.
  const isSelf = activeUser?.id === fid

  // Who this is. Profiles are public (backend/deps.py, authorize_view), so the
  // identity comes from the profile endpoint rather than from your friends
  // list — which is why a reviewer you hadn't friended used to read as
  // "This profile isn't available".
  const { data: profile, isLoading: profileLoading, isError: profileError } = useQuery({
    queryKey: ['profile', fid],
    queryFn: () => fetchProfile(fid),
    enabled: valid,
    staleTime: 60_000,
  })
  const person = profile
    ? { id: profile.id, name: profile.name, avatarUrl: profile.avatar_url ?? undefined, bio: profile.bio }
    : null

  // Mine — whether we're friends, and the mutual count.
  const { data: myFriends = [] } = useQuery({
    queryKey: ['friends', activeUser?.id],
    queryFn: () => fetchFriends(activeUser!.id),
    enabled: !!activeUser,
    staleTime: 60_000,
  })
  const isFriend = myFriends.some(f => f.id === fid)
  const { data: requests } = useQuery({
    queryKey: ['friend-requests', activeUser?.id],
    queryFn: () => fetchFriendRequests(activeUser!.id),
    enabled: !!activeUser && !isFriend,
    staleTime: 60_000,
  })
  const requested = !!requests?.outgoing.some(u => u.id === fid)
  const theyAsked = !!requests?.incoming.some(u => u.id === fid)

  // How alike your taste is (spec §5.1) — anyone's profile but your own.
  const { data: overlap } = useQuery({
    queryKey: ['overlap', activeUser?.id, fid],
    queryFn: () => fetchOverlap(fid),
    enabled: valid && !!activeUser && !isSelf,
    staleTime: 60_000,
  })
  const tabsRef = useRef<HTMLDivElement>(null)

  // Their friends → mutual = intersection with mine (excluding myself).
  const { data: theirFriends = [] } = useQuery({
    queryKey: ['friends', fid],
    queryFn: () => fetchFriends(fid),
    enabled: valid && !!person,
    staleTime: 60_000,
  })
  const myIds = new Set(myFriends.map(f => f.id))
  const mutualCount = theirFriends.filter(f => f.id !== activeUser?.id && myIds.has(f.id)).length

  const { data: summary } = useQuery({
    queryKey: ['stats', 'summary', fid],
    queryFn: () => fetchSummary(fid),
    enabled: valid && !!person,
    staleTime: 60_000,
  })

  // Rated albums → "this week" count. Shares its query key with the embedded
  // Library, so React Query serves both from one fetch.
  const { data: rated = [] } = useQuery({
    queryKey: ['albums', 'rated', fid],
    queryFn: () => fetchAlbums({ status: 'rated', userId: fid }),
    enabled: valid && !!person,
  })
  // The stat row's figures, counted as mobile's ProfileBanner counts them.
  // Artists are folded on case and spacing, so one artist's records don't count twice.
  const artistCount = new Set(rated.flatMap((a) => [a.artist, ...a.extraArtists].map((n) => n.trim().toLowerCase()))).size
  const albumScores = rated.flatMap((a) => (a.score != null ? [a.score] : []))

  /** Your invite link, not this page's address: a profile is behind sign-in,
   *  and the invite both signs someone up and makes you friends. The system
   *  share sheet where there is one, else the clipboard. */
  async function shareProfile() {
    if (!activeUser) return
    try {
      const { link } = await getInviteLink(activeUser.id)
      const text = `Compare music taste with me on Pressd`
      if (navigator.share) {
        await navigator.share({ title: 'Pressd', text, url: link })
      } else {
        await navigator.clipboard.writeText(link)
        setShared(true)
        setTimeout(() => setShared(false), 2000)
      }
    } catch { /* dismissed, or no clipboard — nothing to undo */ }
  }

  // Favorite genres: most common genre / subgenre tags across rated albums
  const topGenres = topTags(rated.map(a => a.genre), 3)
  const topSubgenres = topTags(rated.flatMap(a => [a.subGenre1, a.subGenre2, a.subGenre3]), 3)

  // Drive the global "view-as" context so the embedded pages and album detail
  // render this friend's data (read-only).
  const personId = person?.id
  const personName = person?.name
  const personAvatar = person?.avatarUrl
  useEffect(() => {
    if (personId != null && personName) setViewingUser({ id: personId, name: personName, avatarUrl: personAvatar })
  }, [personId, personName, personAvatar, setViewingUser])

  // The button only ever adds or accepts. Removing a friend lives in the "…"
  // menu, so the filled Friends button can't undo a friendship on a stray click.
  async function changeFriendship(remove = false) {
    if (!person || busy) return
    if (remove ? !isFriend : (isFriend || requested)) return
    setBusy(true)
    try {
      if (remove) {
        await removeFriend(activeUser!.id, fid)
        setConfirmRemove(false)
      }
      else if (theyAsked) await acceptFriendRequest(activeUser!.id, fid)
      else await addFriend(activeUser!.id, fid)
      queryClient.invalidateQueries({ queryKey: ['friends'] })
      queryClient.invalidateQueries({ queryKey: ['friend-requests'] })
      queryClient.invalidateQueries({ queryKey: ['feed'] })
    } catch { /* the button stays as it was */ } finally {
      setBusy(false)
    }
  }

  async function copyProfileLink() {
    setMenuOpen(false)
    try {
      await navigator.clipboard.writeText(window.location.href)
      setLinkCopied(true)
      setTimeout(() => setLinkCopied(false), 2000)
    } catch { /* nothing to copy to */ }
  }

  // Back to wherever you came from — For You, a thread, Social — now that a
  // profile can be reached from more than the friends list.
  function goBack() {
    setViewingUser(activeUser)
    if (window.history.state?.idx > 0) navigate(-1)
    else navigate('/social')
  }

  const backToFriends = (
    <button
      onClick={goBack}
      className="flex items-center gap-1.5 text-(--c-57534e) hover:text-(--c-1c1917) text-sm transition-colors"
    >
      <ArrowLeft size={16} /> Back
    </button>
  )

  if (!valid || profileError || (!profileLoading && !person)) {
    return (
      <div className="min-h-screen bg-(--c-f9f8f6) p-4 md:p-8">
        {backToFriends}
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <p className="text-(--c-78716c) text-sm">This profile isn't available.</p>
        </div>
      </div>
    )
  }

  if (!person) {
    return (
      <div className="min-h-screen bg-(--c-f9f8f6) p-4 md:p-8">
        {backToFriends}
        <div className="flex items-center justify-center py-24 text-(--c-a8998a) gap-2">
          <Loader2 size={16} className="animate-spin" /> <span className="text-sm">Loading…</span>
        </div>
      </div>
    )
  }

  const tabs: { key: Tab; label: string }[] = [
    { key: 'library', label: 'Library' },
    { key: 'stats', label: 'Stats' },
    { key: 'ratings', label: 'Rankings' },
  ]

  return (
    <div className="relative min-h-screen overflow-x-hidden bg-(--c-f9f8f6)">
      <div className="relative p-4 md:p-8">
      <div className="mb-5">{backToFriends}</div>

      {/* ── Banner ──────────────────────────────────────────────────
          Their picture, sharp, in the shape both apps crop to and the server
          stores (24:5, BANNER_SIZE) — so this is exactly what was framed.
          Without one, Pressd green. */}
      <div className="relative aspect-[24/5] w-full overflow-hidden rounded-[28px] bg-[linear-gradient(120deg,#245c43_0%,#2d6a4f_45%,#3d8463_100%)] fade-in">
        {profile?.banner_url && (
          <img src={profile.banner_url} alt="" className="absolute inset-0 h-full w-full object-cover" />
        )}
        {/* Mobile's two banner buttons, backed in the page's cream so they
            read on any picture. The banner itself changes in Edit profile. */}
        {isSelf && (
          <div className="absolute right-4 top-4 flex gap-2 md:right-6 md:top-5">
            <button
              onClick={() => setSheet('profile')}
              aria-label="Edit profile"
              title="Edit profile"
              className="flex h-10 w-10 cursor-pointer items-center justify-center rounded-full border-none bg-(--c-f9f8f6) text-(--c-1c1917) shadow-[0_6px_16px_-8px_rgba(0,0,0,0.5)] hover:bg-(--c-fff)"
            >
              <Pencil size={16} />
            </button>
            <button
              onClick={() => setSheet('settings')}
              aria-label="Settings"
              title="Settings"
              className="flex h-10 w-10 cursor-pointer items-center justify-center rounded-full border-none bg-(--c-f9f8f6) text-(--c-1c1917) shadow-[0_6px_16px_-8px_rgba(0,0,0,0.5)] hover:bg-(--c-fff)"
            >
              <Settings size={17} />
            </button>
          </div>
        )}
      </div>

      {/* ── Identity ────────────────────────────────────────────────
          The avatar rides up over the banner's edge, ringed in the page's
          cream so it reads as lifted off it. Its own layer (relative z-10):
          the banner is positioned, and would otherwise paint over it. */}
      <div className="flex flex-wrap items-start gap-x-6 gap-y-4 px-2 md:px-6">
        {/* The avatar, and under it the shape of every album score — mobile
            draws the same histogram beneath its average. */}
        <div className="-mt-14 flex w-[122px] shrink-0 flex-col self-stretch md:-mt-24 md:w-[186px]">
          <div className="relative z-10 rounded-full bg-(--c-f9f8f6) p-[5px] shadow-[0_18px_40px_-18px_rgba(40,25,10,0.55)] md:p-[7px]">
            <div
              className="flex h-[112px] w-[112px] items-center justify-center overflow-hidden rounded-full text-[44px] font-bold text-white md:h-[172px] md:w-[172px] md:text-[68px]"
              style={{ background: person.avatarUrl ? 'var(--c-ebe5dc)' : avatarColor(person.name) }}
            >
              {person.avatarUrl
                ? <img src={person.avatarUrl} alt={person.name} className="h-full w-full object-cover" />
                : person.name[0]?.toUpperCase()}
            </div>
          </div>
          {albumScores.length > 0 && (
            // Pushed to the column's foot, which the row stretches to the
            // name block's — so the bars end level with the bio's last line.
            <div className="mt-auto px-2 pt-4 rise-in" style={stagger(1)}>
              <ScoreHistogram scores={albumScores} height={34} axis={false} />
            </div>
          )}
        </div>

        {/* Top-aligned, with its own gap under the banner: aligned to the
            bottom, room above the name would also drag the avatar down. */}
        <div className="min-w-0 flex-1 pt-4 md:pt-6">
          {/* Line height 1.2, not 1: `truncate` clips to the line box, and
              Playfair's descenders (the j, g, y) hang below a 1.0 line. */}
          <h1 className="font-display m-0 truncate pb-[0.06em] text-[40px] font-bold leading-[1.2] tracking-tight text-(--c-1c1917) md:text-[56px]">
            {person.name}
          </h1>
          <p className="m-0 mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[15px] text-(--c-8a7f72)">
            {[
              `@${person.name}`,
              profile?.location && (
                <span className="flex items-center gap-1">
                  <MapPin size={14} strokeWidth={2.2} aria-hidden />
                  {profile.location}
                </span>
              ),
              profile?.created_at && `Pressing since ${new Date(profile.created_at).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}`,
              !isSelf && mutualCount > 0 && `${mutualCount} mutual friend${mutualCount === 1 ? '' : 's'}`,
            ].filter(Boolean).map((part, i) => (
              <span key={i} className="flex items-center gap-2.5">
                {i > 0 && <span aria-hidden className="text-(--c-c8c0b4)">•</span>}
                <span>{part}</span>
              </span>
            ))}
          </p>
          {/* The bio on its own line, wrapping to three before it's cut —
              inline beside the handle it truncated after a few words. */}
          {person.bio && (
            <p className="m-0 mt-2 max-w-2xl whitespace-pre-line text-[15px] leading-relaxed text-(--c-57534e) line-clamp-3">
              {person.bio}
            </p>
          )}
          {/* The same pill for a friend and a stranger: only the button beside
              it says which they are. */}
          {!isSelf && overlap && activeUser && (
            <div>
              <OverlapPill
                overlap={overlap}
                me={activeUser}
                them={person}
                onOpenLibrary={() => {
                  setTab('library')
                  tabsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                }}
              />
            </div>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-2.5 pt-4 md:pt-8">
          {isSelf ? (
            <>
              <button
                onClick={shareProfile}
                className="flex h-11 items-center gap-2 rounded-full bg-(--c-green-fill) px-5 text-[14.5px] font-semibold text-white shadow-[0_10px_24px_-10px_rgba(45,106,79,0.75)] hover:bg-(--c-green-fill-hover)"
              >
                {shared ? <><Check size={16} className="pop" /> Link copied</> : 'Share profile'}
              </button>
            </>
          ) : (
            <>
              <button
                // Friends opens the removal prompt; the others add or accept.
                onClick={() => (isFriend ? setConfirmRemove(true) : changeFriendship())}
                disabled={busy || requested}
                aria-label={isFriend ? `Friends. Remove ${person.name} as a friend` : undefined}
                // Filled for every state but a sent request: adding is what the
                // page invites, and being friends is shown just as plainly.
                className={`flex h-12 shrink-0 items-center gap-2 rounded-full px-6 text-[15px] font-semibold transition-[background-color,transform,box-shadow] duration-200 ease-out ${
                  requested
                    ? 'bg-(--c-2d6a4f)/12 text-(--c-2d6a4f)'
                    : 'bg-(--c-green-fill) text-white shadow-[0_10px_24px_-10px_rgba(45,106,79,0.75)] hover:-translate-y-px hover:bg-(--c-green-fill-hover) hover:shadow-[0_14px_28px_-10px_rgba(45,106,79,0.8)]'
                } disabled:cursor-default`}
              >
                {busy ? <Loader2 size={16} className="animate-spin" />
                  : isFriend ? <Check size={17} />
                  : requested ? <Clock size={16} />
                  : <UserPlus size={17} />}
                {isFriend ? 'Friends' : requested ? 'Requested' : theyAsked ? 'Accept request' : 'Add friend'}
              </button>
              <div className="relative">
                <button
                  onClick={() => setMenuOpen(o => !o)}
                  aria-label="More"
                  aria-expanded={menuOpen}
                  className="flex h-12 w-12 items-center justify-center rounded-full border border-(--c-e2dbd0) bg-(--c-fff) text-(--c-57534e) transition-colors hover:border-(--c-2d6a4f) hover:text-(--c-2d6a4f)"
                >
                  {linkCopied ? <Check size={18} className="pop text-(--c-2d6a4f)" /> : <MoreHorizontal size={20} />}
                </button>
                {menuOpen && (
                  <>
                    <div className="fixed inset-0 z-20" onClick={() => setMenuOpen(false)} />
                    <div className="menu-in absolute right-0 top-14 z-30 min-w-[200px] overflow-hidden rounded-2xl border border-(--c-ece5da) bg-(--c-fff) py-1.5 shadow-[0_18px_40px_-18px_rgba(40,25,10,0.45)]">
                      <button onClick={copyProfileLink} className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-[14px] font-medium text-(--c-1c1917) hover:bg-(--c-f5f0e8)">
                        <Link2 size={16} className="text-(--c-8a7f72)" /> Copy profile link
                      </button>
                      {isFriend && (
                        <button
                          onClick={() => { setMenuOpen(false); setConfirmRemove(true) }}
                          className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-[14px] font-medium text-(--c-b1542f) hover:bg-(--c-f5f0e8)"
                        >
                          <UserMinus size={16} /> Remove friend
                        </button>
                      )}
                    </div>
                  </>
                )}
              </div>
            </>
          )}
        </div>
      </div>


      {/* ── Headline numbers, between two rules ─────────────────
          The average and the four counts, in mobile's order. */}
      <div className="mt-8 grid grid-cols-3 items-end gap-x-6 gap-y-6 border-y border-(--c-e8e2d9) px-2 py-6 md:grid-cols-5 md:px-6">
        {[
          { value: summary?.avg_album_score != null ? summary.avg_album_score.toFixed(2) : '—', label: 'Avg score',
            color: summary?.avg_album_score != null ? songScoreColor(summary.avg_album_score) : undefined },
          { value: rated.length.toLocaleString(), label: 'Albums' },
          { value: artistCount.toLocaleString(), label: 'Artists' },
          { value: summary?.total_songs_rated != null ? summary.total_songs_rated.toLocaleString() : '—', label: 'Songs' },
          { value: theirFriends.length.toLocaleString(), label: 'Friends' },
        ].map((st, i) => (
          <div key={st.label} className="rise-in" style={stagger(i)}>
            <p className="font-display m-0 text-[30px] font-bold leading-none tabular-nums md:text-[36px]" style={{ color: st.color ?? 'var(--c-1c1917)' }}>
              {st.value}
            </p>
            <p className="m-0 mt-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-(--c-a8998a)">{st.label}</p>
          </div>
        ))}
      </div>

      {/* Favourite genres, then the picks. */}
      <div className="mt-6 mb-2 px-2 md:px-6">
            {(topGenres.length > 0 || topSubgenres.length > 0) && (
              <div className="mt-4">
                <div className="flex flex-wrap items-center gap-1.5">
                  {topGenres.map((g) => (
                    <span key={g} className="text-xs font-semibold text-(--c-2d6a4f) bg-(--c-2d6a4f)/10 px-2.5 py-1 rounded-full">
                      {g}
                    </span>
                  ))}
                  {topSubgenres.map((g) => (
                    <span key={g} className="text-xs font-medium text-(--c-78716c) bg-(--c-efe9e0) px-2.5 py-1 rounded-full">
                      {g}
                    </span>
                  ))}
                </div>
              </div>
            )}
      </div>

      {/* Favourite song, album and artist — editable on your own page. */}
      {/* Same inset as the genres above, so the two share a left edge. */}
      {profile && (
        <div className="mt-8 px-2 md:px-6">
          <ProfilePicks profile={profile} editable={isSelf} />
        </div>
      )}

      {/* ── Tab switcher ─────────────────────────────────────────── */}
      <div ref={tabsRef} className="flex items-center border-t border-(--c-e8e2d9) pt-5 mb-6">
        <div className="flex items-center gap-1 bg-(--c-efe9e0) rounded-xl p-1 shrink-0">
          {tabs.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`text-sm font-semibold px-4 py-1.5 rounded-lg transition-colors ${
                tab === key ? 'bg-(--c-fff) text-(--c-1c1917) shadow-sm' : 'text-(--c-78716c) hover:text-(--c-1c1917)'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Tab content (read-only, driven by viewing context) ───── */}
      {tab === 'library' && <Library embedded />}
      {tab === 'stats' && <Stats embedded />}
      {tab === 'ratings' && <Ratings embedded />}
      </div>
      {sheet && <SettingsDialog mode={sheet} onClose={() => setSheet(null)} />}
      {confirmRemove && person && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/30 backdrop-blur-sm fade-in" onClick={busy ? undefined : () => setConfirmRemove(false)} />
          <div role="alertdialog" aria-modal="true" aria-labelledby="unfriend-title" className="relative w-full max-w-sm rounded-3xl bg-(--c-f9f8f6) p-6 text-center shadow-xl pop-in">
            <div className="mx-auto w-fit"><Avatar name={person.name} avatarUrl={person.avatarUrl} size={56} /></div>
            <h2 id="unfriend-title" className="font-display m-0 mt-4 text-[22px] font-bold leading-snug text-(--c-1c1917)">
              Remove {person.name} as a friend?
            </h2>
            <div className="mt-6 flex gap-2.5">
              <button
                onClick={() => setConfirmRemove(false)}
                disabled={busy}
                autoFocus
                className="h-11 flex-1 rounded-full border border-(--c-e2dbd0) bg-(--c-fff) text-[14.5px] font-semibold text-(--c-57534e) hover:border-(--c-a8998a)"
              >
                Cancel
              </button>
              <button
                onClick={() => changeFriendship(true)}
                disabled={busy}
                className="flex h-11 flex-1 items-center justify-center gap-2 rounded-full bg-(--c-b1542f) text-[14.5px] font-semibold text-white hover:bg-(--c-9a4727) disabled:opacity-60"
              >
                {busy ? <Loader2 size={16} className="animate-spin" /> : <UserMinus size={16} />}
                Remove
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
