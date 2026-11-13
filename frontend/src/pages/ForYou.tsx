import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, ArrowRight, Heart, MessageCircle, Check, Play, Search, CalendarDays } from 'lucide-react'
import { fetchAlbum, fetchAlbums, fetchFeed, toggleLike, LIKE_QUERY_KEYS, fetchNewReleases, fetchTrending, resolveDeezerAlbum, resolveReleaseByName, importAlbum, fetchPredictedPicks, fetchTopReviews, fetchRecommendSuggestion, fetchBins } from '../api'
import type { NewRelease, PredictedPick, RecommendSuggestion, TopReview } from '../api'
import { MIN_RATED_ALBUMS } from '../types'
import { Cover, ScorePill, hueFromString, coverGradient } from '../components/covers'
import HeatedDiscussions from '../components/HeatedDiscussions'
import PassItOnCell from '../components/PassItOnCell'
import SpotlightCard from '../components/SpotlightCard'
import TrendingBoard from '../components/TrendingBoard'
import Avatar from '../components/Avatar'
import CoverImg from '../components/CoverImg'
import RecommendModal from '../components/RecommendModal'
import { markPassItOnEmpty, markPassItOnShown, passItOnRecent, usePassItOnDue, usePassItOnOpen } from '../lib/passItOn'
import { useUser } from '../context/UserContext'
import VinylSpinner from '../components/VinylSpinner'
import PredictedScore from '../components/PredictedScore'
import BinCard from '../components/BinCard'

// ── small helpers ─────────────────────────────────────────────────────────────

function withinDays(dateStr: string | undefined | null, n: number): boolean {
  if (!dateStr) return false
  const t = new Date(dateStr).getTime()
  if (Number.isNaN(t)) return false
  return (Date.now() - t) / 86400000 < n
}
function timeAgo(dateStr?: string): string {
  if (!dateStr) return ''
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 60) return mins <= 1 ? 'just now' : `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  if (days === 1) return 'yesterday'
  if (days < 7) return `${days}d ago`
  return `${Math.floor(days / 7)}w ago`
}

// The day a userbase-wide review round-up covers. The endpoint reports the
// latest *active* day, which on a quiet morning is not today.
function dayLabel(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso + 'T00:00:00')
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const diff = Math.round((today.getTime() - d.getTime()) / 86400000)
  if (diff <= 0) return 'Today'
  if (diff === 1) return 'Yesterday'
  return d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })
}

// ── shared bits ───────────────────────────────────────────────────────────────

const SECTION_LABEL = 'text-[11px] font-semibold uppercase tracking-[0.16em] text-(--c-a8998a) m-0'

// ── page ──────────────────────────────────────────────────────────────────────

export default function ForYou() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { activeUser } = useUser()
  const userId = activeUser?.id ?? 0

  const { data: bins = [] } = useQuery({
    queryKey: ['bins', userId],
    queryFn: fetchBins,
    enabled: userId > 0,
  })
  const { data: listening = [] } = useQuery({
    queryKey: ['albums', 'listening', userId],
    queryFn: () => fetchAlbums({ status: 'listening', userId }),
    enabled: userId > 0,
  })
  const { data: toListen = [] } = useQuery({
    queryKey: ['albums', 'to_listen', userId],
    queryFn: () => fetchAlbums({ status: 'to_listen', userId }),
    enabled: userId > 0,
  })
  const { data: rated = [], isSuccess: ratedLoaded } = useQuery({
    queryKey: ['albums', 'rated', userId],
    queryFn: () => fetchAlbums({ status: 'rated', userId }),
    enabled: userId > 0,
  })
  const { data: feed = [] } = useQuery({
    queryKey: ['feed', userId],
    queryFn: () => fetchFeed(userId),
    enabled: userId > 0,
  })
  // Same call the mobile New & Popular rail makes. No client staleTime: the
  // endpoint is already cached server-side, and holding a stale hour here made
  // web show an older list than mobile for the same account.
  const { data: newReleases = [] } = useQuery({
    queryKey: ['new-releases'],
    queryFn: () => fetchNewReleases(12),
    enabled: userId > 0,
  })
  // Catalog picks: the nightly worker scores every album anyone has added into
  // `albumprediction`, not only this user's queue. Without them "Ready to rate"
  // could only offer something already sitting in To Listen — a long rail for
  // the one user who queues heavily, and an empty section for everyone else.
  const { data: picks = [] } = useQuery({
    queryKey: ['picks', userId],
    queryFn: () => fetchPredictedPicks(10),
    enabled: userId > 0,
    staleTime: 30 * 60 * 1000,
  })
  // Userbase-wide reviews for the latest active day — the counterpart to the
  // friends-only rail below it.
  const { data: topReviews } = useQuery({
    queryKey: ['top-reviews'],
    queryFn: () => fetchTopReviews(3),
    enabled: userId > 0,
  })

  // ── derived ──
  const now = new Date()
  const hour = now.getHours()
  // Reads as one sentence with the name: "Good afternoon jack." The late-night
  // one takes a comma, since "Up late jack" isn't a greeting.
  const greeting = hour < 5 ? 'Up late' : hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'
  const greetingJoin = hour < 5 ? ', ' : ' '
  const firstName = (activeUser?.name ?? '').split(' ')[0]

  // Resume: most recently touched in-progress album
  // Resume: the most recently added in-progress album. The list endpoint omits
  // songs, so its rows can't say how far along a record is — counting scored
  // songs on one always gave 0. Fetch the full album for the real count, the
  // way mobile's For You does.
  const resumeAlbum = useMemo(() => {
    if (listening.length === 0) return null
    return [...listening].sort((x, y) => (y.dateAdded ?? '').localeCompare(x.dateAdded ?? ''))[0]
  }, [listening])
  const { data: resumeFull } = useQuery({
    queryKey: ['album', resumeAlbum?.id],
    queryFn: () => fetchAlbum(resumeAlbum!.id),
    enabled: !!resumeAlbum,
    // Always re-read on arrival: the rating screen autosaves scores without
    // touching this cache entry, and a count left over from before the last
    // session is the inaccuracy this exists to fix.
    staleTime: 0,
  })
  const resume = useMemo(() => {
    if (!resumeAlbum) return null
    const done = resumeFull?.songs.filter((s) => s.score !== null).length ?? null
    const total = resumeFull?.songs.length || resumeAlbum.totalTracks || 0
    return {
      album: resumeAlbum,
      // Null until the full album arrives, so the card never states a count it
      // doesn't know.
      done,
      total,
      pct: done != null && total > 0 ? Math.round((done / total) * 100) : 0,
    }
  }, [resumeAlbum, resumeFull])

  // Trending on Pressd this week: popular albums across the whole userbase
  const { data: trending = [] } = useQuery({
    queryKey: ['trending', 'week'],
    queryFn: () => fetchTrending('week', 8),
    enabled: userId > 0,
    staleTime: 5 * 60 * 1000,
  })

  // Friends leaderboard: albums rated in the last 7 days, friends + you
  const leaders = useMemo(() => {
    const counts = new Map<number, { id: number; name: string; avatarUrl?: string | null; count: number; you: boolean }>()
    for (const f of feed) {
      // A rating with a review arrives as a 'review' item; it's still a rating.
      if ((f.type !== 'rating' && f.type !== 'review') || !withinDays(f.date_rated, 7)) continue
      const e = counts.get(f.friend.id) ?? { id: f.friend.id, name: f.friend.name, avatarUrl: f.friend.avatar_url, count: 0, you: false }
      e.count += 1
      counts.set(f.friend.id, e)
    }
    const youCount = rated.filter((a) => withinDays(a.dateRated, 7)).length
    if (userId > 0) counts.set(userId, { id: userId, name: 'You', avatarUrl: activeUser?.avatarUrl, count: youCount, you: true })
    return [...counts.values()].filter((e) => e.count > 0).sort((a, b) => b.count - a.count).slice(0, 5)
  }, [feed, rated, userId, activeUser?.avatarUrl])
  const maxLeader = Math.max(1, ...leaders.map((l) => l.count))


  // Rate this next — the same rotation mobile runs, so a shared account sees the
  // same record on both. The pool is deliberately not limited to the library:
  // the nightly worker predicts the whole catalog, so a user who queues nothing
  // still has something to be offered.
  const recommended = useMemo(
    () => toListen
      .filter((a) => a.recommendedByName)
      .sort((a, b) => (b.recommendedAt ?? '').localeCompare(a.recommendedAt ?? '')),
    [toListen],
  )
  // Derived from the render's own clock rather than a fresh Date.now(): the web
  // lint config enforces react-hooks purity, and this reuses the same `now` the
  // greeting reads so the whole page agrees on what day it is.
  const dayIndex = Math.floor(now.getTime() / 86400000)
  const daily = useMemo(() => {
    // A friend asking still leads. That's a person waiting on an answer, not a
    // model's guess, and it shouldn't queue behind the catalog.
    if (recommended.length > 0) {
      const pool = [...recommended].sort((a, b) => a.id - b.id)
      return { queued: pool[dayIndex % pool.length], pick: null }
    }
    const queued = [...toListen].sort((a, b) => a.id - b.id)
    const total = queued.length + picks.length
    if (total === 0) return { queued: null, pick: null }
    // One index across both halves, so the rotation walks the whole pool
    // instead of alternating between two clocks.
    const i = dayIndex % total
    return i < queued.length
      ? { queued: queued[i], pick: null }
      : { queued: null, pick: picks[i - queued.length] }
  }, [toListen, picks, recommended, dayIndex])
  const suggestion = daily.queued
  const pick = daily.pick
  // The row beside the featured card leaves the featured record out.
  const restQueued = toListen.filter((a) => a.id !== suggestion?.id)
  const restPicks = picks.filter((p) => p !== pick)

  async function handleLikeTop(albumId: number) {
    if (!activeUser) return
    try {
      await toggleLike(activeUser.id, albumId)
      for (const queryKey of LIKE_QUERY_KEYS) queryClient.invalidateQueries({ queryKey })
    } catch { /* ignore */ }
  }

  // Pass it on: one of your favourites for a friend predicted to love it, on
  // the visits lib/passItOn deems due (a random 3–5 apart, at most once a day).
  //
  // Pinned to the visit it was drawn for: marking it shown ends "due" at once,
  // and without the pin that would pull the cell out from under the reader.
  // The next visit drops it.
  const passOpen = usePassItOnOpen()
  const passDue = usePassItOnDue()
  const { data: passDraw } = useQuery({
    queryKey: ['recommend-suggestion', userId, passOpen],
    queryFn: () => fetchRecommendSuggestion(passItOnRecent()),
    enabled: userId > 0 && passDue,
    staleTime: Infinity,
  })
  const [passPinned, setPassPinned] = useState<{ open: number; suggestion: RecommendSuggestion } | null>(null)
  if (passDraw && passDue && passPinned?.open !== passOpen) {
    setPassPinned({ open: passOpen, suggestion: passDraw })
  }
  const passItOn = passPinned?.open === passOpen ? passPinned.suggestion : null
  const passKey = passItOn ? `${passItOn.album.id}:${passItOn.friend.id}` : null
  useEffect(() => {
    if (passKey) markPassItOnShown(passKey)
  }, [passKey])
  useEffect(() => {
    if (passDue && passDraw === null) markPassItOnEmpty()
  }, [passDue, passDraw])
  const [passModalOpen, setPassModalOpen] = useState(false)
  // Sent from the dialog: the suggestion has done its job, so it leaves once
  // the dialog closes.
  const [passSent, setPassSent] = useState<string | null>(null)
  const showPass = !!passItOn && passKey !== passSent

  const nothingYet = !resume && toListen.length === 0 && rated.length === 0
  // Below MIN_RATED_ALBUMS the server sends no picks and no predicted scores,
  // so say how far off they are. Held until the count has loaded: a default
  // of zero would flash "10 more" at someone who is one away.
  const unlockLeft = ratedLoaded ? Math.max(0, MIN_RATED_ALBUMS - rated.length) : 0

  // Same ground as every other page: the shell in Layout and the pages that
  // set their own root (Ratings, Stats) are all #f9f8f6. This one was alone on
  // a darker #efece6, so moving between tabs shifted the background. The cards
  // here are delineated by their borders rather than their fill, so they still
  // read against the lighter ground.
  //
  // A line comment, not a JSX one: directly inside `return (` you are in
  // expression position, not JSX children position, so `{/* … */}` parses as a
  // block rather than a comment and the build fails on the element after it.
  // The right column's cards, drawn floated beside the feed at lg and after it below.
  const railCards = (
    <>

          {/* friends leaderboard — on Pressd green, dark in either appearance,
              so its colours are literal (as the share card's are). */}
          {leaders.length > 0 && (
            <div className="rounded-[20px] p-5" style={{ background: 'linear-gradient(165deg,#2d6a4f,#234f3d)', color: '#eaf5ef', boxShadow: '0 20px 44px -22px rgba(35,79,61,.85)' }}>
              <div className="flex items-baseline justify-between mb-3.5">
                <span className="text-[10.5px] font-bold uppercase tracking-[0.16em]" style={{ color: '#a9d3bf' }}>Friends this week</span>
                <span className="text-[11px]" style={{ color: '#8fc2aa' }}>most rated</span>
              </div>
              <div className="flex flex-col gap-1">
                {leaders.map((l, i) => (
                  <div key={l.id} className="flex items-center gap-2.5 px-2 py-1.5 rounded-[10px]" style={{ background: l.you ? 'rgba(255,255,255,.12)' : 'transparent' }}>
                    <span className="w-4 text-[12px] font-bold" style={{ color: '#8fc2aa' }}>{i + 1}</span>
                    <Avatar name={l.you ? (activeUser?.name ?? l.name) : l.name} avatarUrl={l.avatarUrl} size={24} />
                    <span className="w-[62px] text-[12.5px] font-semibold truncate" style={{ color: l.you ? '#fff' : '#d6ebe0' }}>{l.name}</span>
                    <div className="flex-1 h-1.5 rounded-full overflow-hidden mx-1" style={{ background: 'rgba(255,255,255,.14)' }}>
                      <div className="h-full rounded-full" style={{ width: `${(l.count / maxLeader) * 100}%`, background: l.you ? '#fff' : '#8fc2aa' }} />
                    </div>
                    <span className="font-display w-5 text-right text-[15px] font-bold tabular-nums" style={{ color: '#fff' }}>{l.count}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

    </>
  )

  return (
    <div className="min-h-screen bg-(--c-f9f8f6) text-(--c-1c1917)">
      <div className="mx-auto w-full max-w-[1600px] px-6 md:px-12 py-8 pb-24 flow-root">

        {/* ─────────── RIGHT RAIL ───────────
            Floated, so the feed runs beside it and every section that starts
            below its end takes the full width (each section is flow-root, so a
            section is either beside the column or under it, never split). */}
        <aside className="hidden lg:flex lg:float-right lg:w-[312px] lg:ml-8 lg:mb-8 flex-col gap-5">
          {railCards}
        </aside>

        {/* ─────────── FEED COLUMN ─────────── */}
        <div className="min-w-0">

          {/* header */}
          <header className="mb-7 flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h1 className="m-0 text-[40px] leading-none font-black tracking-[0.01em]" style={{ fontFamily: "'Playfair Display', serif" }}>For You</h1>
              <p className="mt-2.5 text-[15px] text-(--c-8a7f72)">
                {greeting}{firstName ? `${greetingJoin}${firstName}` : ''}. Here&rsquo;s what&rsquo;s moving on Pressd this week.
              </p>
            </div>
            {/* Bare: no circle or fill behind it (Jack). The padding is the hit area. */}
            <Link
              to="/search"
              aria-label="Search Pressd"
              title="Search Pressd"
              // mt-0 drops the icon 8px, so its foot sits on the 40px title's baseline rather than level with its top (Jack).
              className="-m-2 mt-0 shrink-0 p-2 text-(--c-1c1917) transition-colors hover:text-(--c-2d6a4f)"
            >
              <Search size={24} strokeWidth={2.2} />
            </Link>
          </header>

          {/* first-run CTA when the account is empty */}
          {nothingYet && (
            <div className="flex items-center gap-4 rounded-[18px] border border-(--c-d7e6dd) p-5 mb-7" style={{ background: 'linear-gradient(100deg,var(--c-eef5f0),var(--c-faf8f5) 55%)' }}>
              <div className="flex-1">
                <p className="m-0 font-bold text-[16px]" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>Rate your first album</p>
                <p className="m-0 mt-1 text-[13px] text-(--c-8a7f72)">Add an album to start building your library.</p>
              </div>
              <button
                onClick={() => navigate('/library')}
                className="shrink-0 rounded-[11px] bg-(--c-green-fill) hover:bg-(--c-green-fill-hover) text-white px-5 py-2.5 text-[13px] font-bold transition-colors flex items-center gap-1.5"
                style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}
              >
                <Plus size={15} /> Add an album
              </button>
            </div>
          )}

          {/* The two "one record, one thing to do" cards, side by side when the
              column has room for both. Pass it on is absent on most visits by
              design — see lib/passItOn. */}
          {(showPass || resume) && (
            <div
              className="grid gap-4 mb-9"
              style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 430px), 1fr))' }}
            >
              {showPass && passItOn && (
                <PassItOnCell suggestion={passItOn} onClick={() => setPassModalOpen(true)} index={0} />
              )}
              {resume && (
                <SpotlightCard
                  tone="green"
                  index={showPass ? 1 : 0}
                  onClick={() => navigate(`/rate/${resume.album.id}`)}
                  ariaLabel={`Continue rating ${resume.album.albumName}${resume.done != null ? `: ${resume.done} of ${resume.total} tracks done` : ''}`}
                  eyebrow="Pick this back up"
                  title={resume.album.albumName}
                  artUrl={resume.album.albumArtUrl}
                  seed={resume.album.artist}
                  action="Continue"
                  progress={resume.pct}
                >
                  <p className="m-0 mt-1 text-[13px] text-(--c-78716c) truncate">
                    {resume.album.artist}{resume.album.year ? ` · ${resume.album.year}` : ''}
                  </p>
                  <p className="m-0 mt-1 text-[14px] text-(--c-57534e) tabular-nums">
                    {resume.done != null ? (
                      <><span className="font-bold text-(--c-1c1917)">{resume.done}</span> of {resume.total} tracks</>
                    ) : (
                      <>{resume.total} tracks</>
                    )}
                  </p>
                </SpotlightCard>
              )}
            </div>
          )}
          {passItOn && passModalOpen && (
            <RecommendModal
              key={passKey}
              album={{ id: passItOn.album.id, albumName: passItOn.album.albumName, artist: passItOn.album.artist }}
              initialFriendId={passItOn.friend.id}
              onClose={() => setPassModalOpen(false)}
              onSent={() => setPassSent(passKey)}
            />
          )}

          {/* what are pressers talking about — the day's three most-engaged reviews,
              userbase-wide (so there's something on day one, before any friends),
              high on the page because reading reviews is what gets people liking,
              replying and writing their own (Jack, November 2026). */}
          {/* Not flow-root as a whole: each review is, so the ones that fit beside
              the right column sit there and the rest run full width under it. */}
          {(topReviews?.reviews.length ?? 0) > 0 && (
            <section className="mb-9">
              <div className="flex items-baseline justify-between mb-4 gap-3.5">
                <h2 className={SECTION_LABEL}>What are pressers talking about</h2>
                <span className="text-[11px] text-(--c-b3a99c)">{dayLabel(topReviews?.day ?? null)}</span>
              </div>
              <div className="space-y-3.5">
                {topReviews!.reviews.map((rv) => (
                  <TopReviewCard
                    key={`${rv.author.id}-${rv.album_id}`}
                    rv={rv}
                    // The record, as the whole of Pressd rated it; the comments
                    // live on the reviewer's own copy.
                    onOpen={() => navigate(`/album/${rv.album_id}/community`)}
                    onOpenComments={() => navigate(`/album/${rv.album_id}`)}
                    onOpenAuthor={() => navigate(`/u/${rv.author.id}`)}
                    onLike={() => handleLikeTop(rv.album_id)}
                  />
                ))}
              </div>
            </section>
          )}

          {/* new releases (Deezer) */}
          {newReleases.length > 0 && (
            <section className="mb-9 flow-root">
              <div className="flex items-baseline justify-between mb-4">
                <h2 className={SECTION_LABEL}>New &amp; Popular</h2>
                <button onClick={() => navigate('/upcoming')} className="text-[12px] font-semibold text-(--c-2d6a4f) hover:text-(--c-245c43) flex items-center gap-1"><CalendarDays size={13} /> Upcoming <ArrowRight size={12} /></button>
              </div>
              <div className="flex gap-4 overflow-x-auto pb-3.5 pt-1" style={{ scrollSnapType: 'x mandatory' }}>
                {newReleases.map((r) => (
                  <NewReleaseCard key={r.deezerId} release={r} userId={userId} onRate={(id) => navigate(`/rate/${id}`)} onAdded={() => queryClient.invalidateQueries({ queryKey: ['albums'] })} />
                ))}
              </div>
            </section>
          )}

          {unlockLeft > 0 && (
            <div className="rise-in mb-9 flex flex-wrap items-center gap-x-4 gap-y-2.5">
              <div className="flex gap-1.5" aria-hidden>
                {Array.from({ length: MIN_RATED_ALBUMS }, (_, i) => (
                  <span
                    key={i}
                    className="h-2 w-6 rounded-full"
                    style={{ background: i < rated.length ? 'var(--c-2d6a4f)' : 'var(--c-e7e0d6)' }}
                  />
                ))}
              </div>
              <p className="m-0 text-[14px] text-(--c-57534e)">
                <span className="font-bold text-(--c-1c1917) tabular-nums">{unlockLeft}</span>{' '}
                more {unlockLeft === 1 ? 'album' : 'albums'} until picks unlock
              </p>
            </div>
          )}
          {/* Rate this next — iPhone's section, laid out wide: the day's record
              as a featured card (the same rotation, so one account sees the same
              record on both), then everything else ready to rate beside it —
              the user's own queue first, then records the model likes that they
              don't own, never the featured one twice. A queued album is something
              they already chose; a pick is a suggestion, so it never outranks
              their own list. */}
          {(suggestion || pick || restQueued.length > 0 || restPicks.length > 0) && (
            <section className="mb-9 flow-root">
              <div className="flex items-baseline justify-between mb-4">
                <h2 className={SECTION_LABEL}>Rate this next</h2>
                <button onClick={() => navigate('/library')} className="text-[12px] font-semibold text-(--c-2d6a4f) hover:text-(--c-245c43) flex items-center gap-1">Browse all <ArrowRight size={12} /></button>
              </div>
              <div className="flex flex-col md:flex-row gap-5">
                {(suggestion || pick) && (
                  <div className="md:w-[360px] shrink-0 flex flex-col [&>*]:flex-1">
                    {/* the day's record: queued (or recommended) first */}
                    {suggestion && (
                      <FeaturedNext
                        artUrl={suggestion.albumArtUrl}
                        seed={suggestion.artist}
                        title={suggestion.albumName}
                        sub={suggestion.artist + (suggestion.year ? ` · ${suggestion.year}` : '')}
                        eyebrow={suggestion.recommendedByName ? `Recommended by ${suggestion.recommendedByName}` : 'In your queue'}
                        predicted={suggestion.predictedScore}
                        action={suggestion.recommendedByName ? 'Take a look' : 'Start rating'}
                        // A recommendation is someone else's pick — dropping straight
                        // into the scoring flow scores a record the person hasn't heard
                        // of yet and gives them no way to look at it first. Albums they
                        // queued themselves keep the fast path.
                        onAction={() => navigate(suggestion.recommendedByName ? `/album/${suggestion.id}/community` : `/rate/${suggestion.id}`)}
                      />
                    )}

                    {/* Nothing queued, but the model still has an opinion — same cell. */}
                    {!suggestion && pick && (
                      <NextUpPick
                        pick={pick}
                        userId={userId}
                        onRate={(id) => navigate(`/rate/${id}`)}
                        onAdded={() => {
                          queryClient.invalidateQueries({ queryKey: ['albums'] })
                          queryClient.invalidateQueries({ queryKey: ['picks', userId] })
                        }}
                      />
                    )}
                  </div>
                )}
                <div className="flex-1 min-w-0 flex gap-4 overflow-x-auto pb-3.5 pt-1" style={{ scrollSnapType: 'x mandatory' }}>
                  {restQueued.slice(0, 12).map((a) => (
                    <button
                      key={a.id}
                      onClick={() => navigate(`/rate/${a.id}`)}
                      className="text-left group"
                      style={{ width: 172, flexShrink: 0, scrollSnapAlign: 'start' }}
                    >
                      <div className="relative" style={{ width: 172, height: 172, borderRadius: 16, overflow: 'hidden', boxShadow: '0 14px 34px -18px rgba(60,45,30,.5)' }}>
                        <Cover artUrl={a.albumArtUrl} seed={a.artist} size={172} radius={16} fontSize={46} />
                        <span className="absolute top-2.5 left-2.5 text-[9px] font-bold tracking-[0.1em] text-white px-2 py-1 rounded-full" style={{ background: 'rgba(28,25,23,.72)' }}>
                          {a.recommendedByName ? 'RECOMMENDED' : 'IN QUEUE'}
                        </span>
                      </div>
                      <p className="mt-2.5 mb-0 font-bold text-[14px] truncate" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>{a.albumName}</p>
                      <p className="m-0 mt-0.5 text-[12px] text-(--c-8a7f72) truncate">{a.artist} · {a.year}</p>
                      <div className="mt-2 flex items-center gap-2">
                        {a.predictedScore != null ? (
                          <>
                            <span className="font-display text-[14px] font-bold leading-none tabular-nums"><PredictedScore value={a.predictedScore} prefix="~" sparkle={false} /></span>
                            <span className="text-[11px] text-(--c-b3a99c)">predicted</span>
                          </>
                        ) : (
                          <span className="text-[11px] text-(--c-b3a99c)">Not rated yet</span>
                        )}
                      </div>
                    </button>
                  ))}
                  {restPicks.map((pick) => (
                    <PickCard
                      key={`${pick.artist}-${pick.albumName}`}
                      pick={pick}
                      userId={userId}
                      onRate={(id) => navigate(`/rate/${id}`)}
                      onAdded={() => {
                        queryClient.invalidateQueries({ queryKey: ['albums'] })
                        queryClient.invalidateQueries({ queryKey: ['picks', userId] })
                      }}
                    />
                  ))}
                </div>
              </div>
            </section>
          )}

          {/* trending */}
          {trending.length > 0 && (
            <section className="mb-9 flow-root">
              <div className="flex items-baseline justify-between mb-4 gap-3.5">
                <h2 className={SECTION_LABEL}>Trending on Pressd</h2>
                <span className="text-[11px] text-(--c-b3a99c)">This week</span>
              </div>
              {/* Trending isn't tied to a person: open the userbase's averaged view, not
                  whichever copy happened to rank (friends-only, so it failed). */}
              <TrendingBoard rows={trending} onOpen={(id) => navigate(`/album/${id}/community`)} />
            </section>
          )}

          {/* Records people are writing about right now. */}
          <HeatedDiscussions />

          {/* Bins — Pressd's themed collections, and how far through each you are. */}
          {bins.length > 0 && (
            <section className="mb-9 flow-root">
              <div className="flex items-baseline justify-between mb-4">
                <h2 className={SECTION_LABEL}>Bins</h2>
                <button onClick={() => navigate('/bins')} className="text-[12px] font-semibold text-(--c-2d6a4f) hover:text-(--c-245c43) flex items-center gap-1">See all <ArrowRight size={12} /></button>
              </div>
              <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
                {bins.slice(0, 3).map((b) => <BinCard key={b.slug} bin={b} />)}
              </div>
            </section>
          )}

        </div>

        {/* The right column below lg: after the feed, as before. */}
        <aside className="lg:hidden mt-9 flex flex-col gap-5">
          {railCards}
        </aside>
      </div>
    </div>
  )
}

// ── new release card ──────────────────────────────────────────────────────────


function NewReleaseCard({
  release, userId, onRate, onAdded,
}: {
  release: NewRelease
  userId: number
  onRate: (albumId: number) => void
  onAdded: () => void
}) {
  const [pending, setPending] = useState<'listen' | 'rate' | null>(null)
  const [added, setAdded] = useState(false)
  const [error, setError] = useState(false)
  const [revealed, setRevealed] = useState(false)

  async function act(kind: 'listen' | 'rate') {
    if (pending || added) return
    setPending(kind)
    setError(false)
    try {
      // The releases feed carries a Deezer id only when the AOTY listing matched
      // one; without it (often the case for the newest, most-rated records) fall
      // back to searching by name + artist so the card still imports.
      const full = release.deezerId != null
        ? await resolveDeezerAlbum(release.deezerId)
        : await resolveReleaseByName(release.albumName, release.artist)
      const album = await importAlbum(full, kind === 'listen' ? 'to_listen' : 'listening', userId)
      if (kind === 'rate') {
        onRate(album.id)
        return
      }
      setAdded(true)
      onAdded()
    } catch {
      setError(true)
    } finally {
      if (kind !== 'rate') setPending(null)
    }
  }

  const overlayShown = revealed
  return (
    <div style={{ width: 172, flexShrink: 0, scrollSnapAlign: 'start' }}>
      <div className="relative group" style={{ width: 172, height: 172, borderRadius: 16, overflow: 'hidden', boxShadow: '0 14px 34px -18px rgba(60,45,30,.5)' }}>
        <button type="button" onClick={() => setRevealed((v) => !v)} className="absolute inset-0 z-0" aria-label={`${release.albumName} — options`}>
          <Cover artUrl={release.coverUrl} seed={release.artist} size={172} radius={16} fontSize={46} />
        </button>
        <span className="absolute top-2.5 left-2.5 z-0 text-[9px] font-bold tracking-[0.1em] text-white px-2 py-1 rounded-full pointer-events-none" style={{ background: 'rgba(28,25,23,.72)' }}>TRENDING</span>
        <div
          className={
            'absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 transition-opacity focus-within:opacity-100 focus-within:pointer-events-auto ' +
            (overlayShown ? 'opacity-100 pointer-events-auto ' : 'opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto')
          }
          style={{ background: 'rgba(28,25,23,.58)', backdropFilter: 'blur(2px)' }}
        >
          {added ? (
            <span className="text-white text-[12.5px] font-semibold flex items-center gap-1.5"><Check size={15} /> In your library</span>
          ) : (
            <>
              <button
                onClick={() => act('rate')}
                disabled={!!pending}
                className="w-[130px] py-2 rounded-[10px] bg-(--c-green-fill) hover:bg-(--c-green-fill-hover) text-white text-[12.5px] font-bold flex items-center justify-center gap-1.5 transition-colors disabled:opacity-60"
                style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}
              >
                {pending === 'rate' ? <VinylSpinner size={15} /> : <Play size={12} fill="currentColor" />} Rate now
              </button>
              <button
                onClick={() => act('listen')}
                disabled={!!pending}
                className="w-[130px] py-2 rounded-[10px] bg-(--c-fff)/90 hover:bg-(--c-fff) text-(--c-1c1917) text-[12.5px] font-bold flex items-center justify-center gap-1.5 transition-colors disabled:opacity-60"
                style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}
              >
                {pending === 'listen' ? <VinylSpinner size={15} /> : <Plus size={14} />} To listen
              </button>
            </>
          )}
        </div>
      </div>
      {/* The title opens the record's community view — the cover already opens
          Rate now / To listen. By name, because a new release may not be in
          Pressd yet; the Deezer id rides along for its tracklist. */}
      <Link
        to={`/album/community?${new URLSearchParams({
          name: release.albumName,
          artist: release.artist,
          ...(release.deezerId != null ? { deezer: String(release.deezerId) } : {}),
        }).toString()}`}
        className="mt-2.5 mb-0 block font-bold text-[14px] truncate text-(--c-1c1917) hover:text-(--c-2d6a4f) hover:underline underline-offset-2"
      >
        {release.albumName}
      </Link>
      <p className="m-0 mt-0.5 text-[12px] text-(--c-8a7f72) truncate">{release.artist}{release.year ? ` · ${release.year}` : ''}</p>
      {error && <p className="m-0 mt-1 text-[11px] text-(--c-c0392b)">Couldn&rsquo;t add — try again</p>}
    </div>
  )
}

// ── rate this next: the featured card ────────────────────────────────────────

/** The day's record at the head of Rate this next, in For You's
 *  single-record look (SpotlightCard's): the record's cover, blurred, is the
 *  card's colour, the cover itself sits tilted, and the title is in Playfair.
 *  SpotlightCard itself is a wide row with an arrow; this is the same card
 *  stood upright for a column. Along the foot, the prediction (PredictedScore,
 *  PREDICTED over it) beside the button. The whole card is the target, as
 *  SpotlightCard's is, with its hover: a shadow, the cover easing straighter, the
 *  arrow reaching forward — in COVER_LIFT's small range. Stretches to the row's
 *  height. */
function FeaturedNext({
  artUrl, seed, eyebrow, title, sub, predicted, action, onAction, pending = false, error = false,
}: {
  artUrl?: string | null
  seed: string
  eyebrow: string
  title: string
  sub: string
  predicted?: number | null
  action: string
  onAction: () => void
  pending?: boolean
  error?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onAction}
      disabled={pending}
      aria-label={`${action}: ${title}`}
      className="spot-green spot-card group relative w-full overflow-hidden rounded-[28px] isolate p-5 flex flex-col text-left transition-[box-shadow,transform] duration-300 ease-out hover:-translate-y-0.5 hover:shadow-[0_22px_44px_-26px_rgba(50,30,10,0.5)] disabled:cursor-wait"
    >
      {artUrl && (
        <CoverImg
          url={artUrl}
          displayPx={120}
          alt=""
          aria-hidden
          className="spot-glow pointer-events-none absolute inset-0 -z-10 h-full w-full scale-150 object-cover blur-3xl saturate-150 transition-opacity duration-500"
        />
      )}
      <div className="flex gap-4 items-start w-full">
        <div className="shrink-0 -rotate-[4deg] rounded-[18px] shadow-[0_16px_30px_-14px_rgba(40,25,10,0.6)] transition-transform duration-300 ease-out group-hover:-rotate-[1.5deg] group-hover:scale-[1.03]">
          <Cover artUrl={artUrl} seed={seed} size={128} radius={18} fontSize={42} />
        </div>
        <div className="flex-1 min-w-0 pt-1">
          <p className="m-0 mb-1.5 text-[10.5px] font-bold uppercase tracking-[0.16em] line-clamp-2" style={{ color: 'var(--spot-ink)' }}>{eyebrow}</p>
          <p className="m-0 font-display text-[22px] font-bold leading-tight text-(--c-1c1917) line-clamp-3">{title}</p>
          <p className="m-0 mt-1.5 text-[13px] text-(--c-57534e) truncate">{sub}</p>
        </div>
      </div>
      <div className="mt-auto pt-5 flex items-end gap-4 w-full">
        {predicted != null && (
          <div className="shrink-0">
            <span className="block text-[9px] font-bold tracking-[0.12em] text-(--c-78716c)">PREDICTED</span>
            <span className="font-display block mt-1 text-[32px] font-bold leading-none tabular-nums">
              <PredictedScore value={predicted} />
            </span>
          </div>
        )}
        {/* Looks like a button; the card around it is the one. */}
        <span
          className={`flex-1 py-3 rounded-full bg-(--c-green-fill) group-hover:bg-(--c-green-fill-hover) text-white text-[13.5px] font-bold transition-colors flex items-center justify-center gap-1.5 ${pending ? 'opacity-60' : ''}`}
          style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}
        >
          {pending ? <VinylSpinner size={16} /> : null} {action}
          <ArrowRight size={14} className="transition-transform duration-300 ease-out group-hover:translate-x-1" />
        </span>
      </div>
      {error && <span className="block m-0 mt-2 text-[11px] text-(--c-c0392b)">Couldn&rsquo;t add — try again</span>}
    </button>
  )
}

// ── rate-this-next pick ───────────────────────────────────────────────────────

/** Rate this next's featured card when the day's rotation lands on a
 *  catalog pick rather than something the user queued. It has no album id yet,
 *  so the action imports the record first and then opens the rating flow. */
function NextUpPick({
  pick, userId, onRate, onAdded,
}: {
  pick: PredictedPick
  userId: number
  onRate: (albumId: number) => void
  onAdded: () => void
}) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState(false)

  async function start() {
    if (pending) return
    setPending(true)
    setError(false)
    try {
      const full = await resolveReleaseByName(pick.albumName, pick.artist)
      const album = await importAlbum(full, 'listening', userId)
      onAdded()
      onRate(album.id)
    } catch {
      setError(true)
      setPending(false)
    }
  }

  return (
    <FeaturedNext
      artUrl={pick.coverUrl}
      seed={pick.artist}
      eyebrow="Picked for you"
      title={pick.albumName}
      sub={pick.artist + (pick.year ? ` · ${pick.year}` : '')}
      predicted={pick.predictedScore}
      action="Start rating"
      onAction={start}
      pending={pending}
      error={error}
    />
  )
}

// ── predicted pick card ───────────────────────────────────────────────────────

/** A record the model likes that the user doesn't own.
 *
 *  Mobile can open a pick straight from the catalog, because its album route
 *  takes a name + artist and falls back to the userbase view. The web album
 *  page is keyed on an id it fetches, so there is nothing to navigate to until
 *  the record exists in the user's library — the same bind NewReleaseCard is
 *  in, and this resolves it the same way: import on the action, then go.
 */
function PickCard({
  pick, userId, onRate, onAdded,
}: {
  pick: PredictedPick
  userId: number
  onRate: (albumId: number) => void
  onAdded: () => void
}) {
  const [pending, setPending] = useState<'listen' | 'rate' | null>(null)
  const [added, setAdded] = useState(false)
  const [error, setError] = useState(false)
  const [revealed, setRevealed] = useState(false)

  async function act(kind: 'listen' | 'rate') {
    if (pending || added) return
    setPending(kind)
    setError(false)
    try {
      const full = await resolveReleaseByName(pick.albumName, pick.artist)
      const album = await importAlbum(full, kind === 'listen' ? 'to_listen' : 'listening', userId)
      if (kind === 'rate') {
        onRate(album.id)
        return
      }
      setAdded(true)
      onAdded()
    } catch {
      setError(true)
    } finally {
      if (kind !== 'rate') setPending(null)
    }
  }

  return (
    <div style={{ width: 172, flexShrink: 0, scrollSnapAlign: 'start' }}>
      <div className="relative group" style={{ width: 172, height: 172, borderRadius: 16, overflow: 'hidden', boxShadow: '0 14px 34px -18px rgba(60,45,30,.5)' }}>
        <button type="button" onClick={() => setRevealed((v) => !v)} className="absolute inset-0 z-0" aria-label={`${pick.albumName} — options`}>
          <Cover artUrl={pick.coverUrl} seed={pick.artist} size={172} radius={16} fontSize={46} />
        </button>
        <span className="absolute top-2.5 left-2.5 z-0 text-[9px] font-bold tracking-[0.1em] text-white px-2 py-1 rounded-full pointer-events-none" style={{ background: 'rgba(28,25,23,.72)' }}>FOR YOU</span>
        <div
          className={
            'absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 transition-opacity focus-within:opacity-100 focus-within:pointer-events-auto ' +
            (revealed ? 'opacity-100 pointer-events-auto ' : 'opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto')
          }
          style={{ background: 'rgba(28,25,23,.58)', backdropFilter: 'blur(2px)' }}
        >
          {added ? (
            <span className="text-white text-[12.5px] font-semibold flex items-center gap-1.5"><Check size={15} /> In your library</span>
          ) : (
            <>
              <button
                onClick={() => act('rate')}
                disabled={!!pending}
                className="w-[130px] py-2 rounded-[10px] bg-(--c-green-fill) hover:bg-(--c-green-fill-hover) text-white text-[12.5px] font-bold flex items-center justify-center gap-1.5 transition-colors disabled:opacity-60"
                style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}
              >
                {pending === 'rate' ? <VinylSpinner size={15} /> : <Play size={12} fill="currentColor" />} Rate now
              </button>
              <button
                onClick={() => act('listen')}
                disabled={!!pending}
                className="w-[130px] py-2 rounded-[10px] bg-(--c-fff)/90 hover:bg-(--c-fff) text-(--c-1c1917) text-[12.5px] font-bold flex items-center justify-center gap-1.5 transition-colors disabled:opacity-60"
                style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}
              >
                {pending === 'listen' ? <VinylSpinner size={15} /> : <Plus size={14} />} To listen
              </button>
            </>
          )}
        </div>
      </div>
      <p className="mt-2.5 mb-0 font-bold text-[14px] truncate" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>{pick.albumName}</p>
      <p className="m-0 mt-0.5 text-[12px] text-(--c-8a7f72) truncate">{pick.artist}{pick.year ? ` · ${pick.year}` : ''}</p>
      <div className="mt-2 flex items-center gap-2">
        <span className="font-display text-[14px] font-bold leading-none tabular-nums"><PredictedScore value={pick.predictedScore} prefix="~" sparkle={false} /></span>
        <span className="text-[11px] text-(--c-b3a99c)">predicted</span>
      </div>
      {error && <p className="m-0 mt-1 text-[11px] text-(--c-c0392b)">Couldn&rsquo;t add — try again</p>}
    </div>
  )
}

// ── top review card ───────────────────────────────────────────────────────────

/** A userbase-wide review. Unlike a friend's, the author may be a stranger, so
 *  their name links through to their profile and the card carries the album's
 *  best and worst track — the context a reader has no other way to get. */
function TopReviewCard({ rv, onOpen, onOpenComments, onOpenAuthor, onLike }: {
  rv: TopReview
  onOpen: () => void
  onOpenComments: () => void
  onOpenAuthor: () => void
  onLike: () => void
}) {
  const liked = rv.liked_by_me
  return (
    <article className="flow-root rounded-[18px] border border-(--c-e6ded2) bg-(--c-faf8f5) p-[18px]" style={{ boxShadow: '0 12px 34px -24px rgba(60,45,30,.4)' }}>
      <div className="flex items-center gap-2.5 mb-3">
        <button onClick={onOpenAuthor} aria-label={`Open ${rv.author.name}'s profile`} className="shrink-0 rounded-full border-none bg-transparent p-0 cursor-pointer transition-transform hover:scale-[1.04]">
          {rv.author.avatar_url ? (
            <img src={rv.author.avatar_url} alt="" style={{ width: 38, height: 38, borderRadius: '50%', flexShrink: 0, objectFit: 'cover' }} />
          ) : (
            <div style={{ width: 38, height: 38, borderRadius: '50%', flexShrink: 0, background: coverGradient(hueFromString(rv.author.name)), color: 'var(--c-fff)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: "'Plus Jakarta Sans', sans-serif", fontWeight: 700, fontSize: 15 }}>
              {rv.author.name[0].toUpperCase()}
            </div>
          )}
        </button>
        <div className="flex-1 min-w-0">
          <p className="m-0 text-[13px] text-(--c-4a423a)">
            <button onClick={onOpenAuthor} className="bg-transparent border-none p-0 cursor-pointer font-semibold text-(--c-1c1917) hover:underline" style={{ font: 'inherit', fontWeight: 600 }}>{rv.author.name}</button> reviewed an album
          </p>
          <p className="m-0 mt-px text-[11.5px] text-(--c-b3a99c)">{timeAgo(rv.review_at)}</p>
        </div>
        {rv.score != null && <ScorePill score={rv.score} xl milker />}
      </div>
      <div className="group/album flex gap-3.5 cursor-pointer" onClick={onOpen} role="link" aria-label={`Open ${rv.album_name}`}>
        <div className="shrink-0 transition-transform duration-300 ease-out group-hover/album:scale-[1.04] group-hover/album:-rotate-1">
          <Cover artUrl={rv.album_art_url} seed={rv.artist} size={64} radius={12} fontSize={24} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="m-0 font-bold text-[15px] group-hover/album:text-(--c-2d6a4f) group-hover/album:underline underline-offset-2" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>{rv.album_name}</p>
          <p className="m-0 mt-0.5 mb-2 text-[12.5px] text-(--c-8a7f72)">{rv.artist}</p>
          <p className="m-0 text-[13.5px] leading-relaxed text-(--c-4a423a)" style={{ textWrap: 'pretty' } as React.CSSProperties}>&ldquo;{rv.review}&rdquo;</p>
          {(rv.top_song || rv.bottom_song) && (
            <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11.5px] text-(--c-8a7f72)">
              {rv.top_song && (
                <span className="truncate">
                  <span className="font-semibold text-(--c-2d6a4f)">Best</span> {rv.top_song.title}
                  <span className="text-(--c-b3a99c)"> · <span className="font-display font-bold tabular-nums">{rv.top_song.score.toFixed(1)}</span></span>
                </span>
              )}
              {rv.bottom_song && (
                <span className="truncate">
                  <span className="font-semibold text-(--c-b1542f)">Worst</span> {rv.bottom_song.title}
                  <span className="text-(--c-b3a99c)"> · <span className="font-display font-bold tabular-nums">{rv.bottom_song.score.toFixed(1)}</span></span>
                </span>
              )}
            </div>
          )}
        </div>
      </div>
      <div className="flex items-center mt-4 pt-3.5 border-t border-(--c-ece5da)" style={{ gap: 18 }}>
        <button onClick={onLike} className="flex items-center gap-1.5 bg-transparent border-none cursor-pointer p-0 text-[12.5px] font-semibold" style={{ color: liked ? 'var(--c-c0392b)' : 'var(--c-8a7f72)' }}>
          <Heart size={14} fill={liked ? 'currentColor' : 'none'} strokeWidth={liked ? 0 : 1.75} className="transition-transform active:scale-125" />
          {rv.like_count}
        </button>
        <span className="flex items-center gap-1.5 text-[12.5px] font-semibold text-(--c-8a7f72) cursor-pointer hover:text-(--c-1c1917)" onClick={onOpenComments}>
          <MessageCircle size={14} strokeWidth={1.75} />
          {rv.comment_count}
        </span>
      </div>
    </article>
  )
}
