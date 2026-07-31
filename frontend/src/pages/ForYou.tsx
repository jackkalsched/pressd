import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, ArrowRight, Heart, MessageCircle, Flame, Clock, Check, Play, Loader2 } from 'lucide-react'
import { fetchAlbums, fetchFeed, fetchFriendReviews, toggleLike, fetchNewReleases, fetchTrending, resolveDeezerAlbum, resolveReleaseByName, importAlbum } from '../api'
import type { FriendReview, NewRelease } from '../api'
import { songScoreColor } from '../types'
import { useUser } from '../context/UserContext'

// ── small helpers ─────────────────────────────────────────────────────────────

function hueFromString(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360
  return h
}
function coverGradient(hue: number): string {
  return `linear-gradient(140deg, hsl(${hue} 42% 38%), hsl(${(hue + 26) % 360} 48% 56%))`
}
function scoreHue(s: number): number {
  return Math.round(((s - 1) / 9) * 130)
}
function scoreTint(s: number): string {
  return `hsl(${scoreHue(s)}, 46%, 94%)`
}

function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function withinDays(dateStr: string | undefined | null, n: number): boolean {
  if (!dateStr) return false
  const t = new Date(dateStr).getTime()
  if (Number.isNaN(t)) return false
  return (Date.now() - t) / 86400000 < n
}
// Monday-based start of the week for a given date
function weekStart(d: Date): number {
  const x = new Date(d)
  const dow = (x.getDay() + 6) % 7
  x.setDate(x.getDate() - dow)
  x.setHours(0, 0, 0, 0)
  return x.getTime()
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

// ── shared bits ───────────────────────────────────────────────────────────────

function Cover({
  artUrl, seed, size, radius = 12, fontSize,
}: {
  artUrl?: string | null
  seed: string
  size: number
  radius?: number
  fontSize?: number
}) {
  if (artUrl) {
    return (
      <img
        src={artUrl}
        alt=""
        style={{ width: size, height: size, borderRadius: radius, objectFit: 'cover', flexShrink: 0, display: 'block' }}
      />
    )
  }
  const hue = hueFromString(seed || '?')
  return (
    <div
      style={{
        width: size, height: size, borderRadius: radius, flexShrink: 0, background: coverGradient(hue),
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: 'rgba(255,255,255,.92)', fontFamily: "'Playfair Display', serif", fontWeight: 700,
        fontSize: fontSize ?? Math.round(size * 0.34),
      }}
    >
      {(seed || '?')[0].toUpperCase()}
    </div>
  )
}

function ScorePill({ score, big }: { score: number; big?: boolean }) {
  return (
    <span
      className="tabular-nums"
      style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        minWidth: big ? 46 : 38, padding: big ? '6px 10px' : '3px 8px', borderRadius: 9,
        background: scoreTint(score), color: songScoreColor(score),
        fontFamily: "'Plus Jakarta Sans', sans-serif", fontWeight: 700, fontSize: big ? 16 : 13, flexShrink: 0,
      }}
    >
      {score.toFixed(2)}
    </span>
  )
}

const SECTION_LABEL = 'text-[11px] font-semibold uppercase tracking-[0.16em] text-[#a8998a] m-0'

// ── page ──────────────────────────────────────────────────────────────────────

export default function ForYou() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { activeUser } = useUser()
  const userId = activeUser?.id ?? 0

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
  const { data: rated = [] } = useQuery({
    queryKey: ['albums', 'rated', userId],
    queryFn: () => fetchAlbums({ status: 'rated', userId }),
    enabled: userId > 0,
  })
  const { data: feed = [] } = useQuery({
    queryKey: ['feed', userId],
    queryFn: () => fetchFeed(userId),
    enabled: userId > 0,
  })
  const { data: reviews = [] } = useQuery({
    queryKey: ['for-you-reviews'],
    queryFn: () => fetchFriendReviews('recent'),
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

  // ── derived ──
  const now = new Date()
  const dateStr = now.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })
  const hour = now.getHours()
  const greeting = hour < 5 ? 'Up late.' : hour < 12 ? 'Good morning.' : hour < 18 ? 'Good afternoon.' : 'Good evening.'
  const firstName = (activeUser?.name ?? '').split(' ')[0]

  // Resume: most recently touched in-progress album
  const resume = useMemo(() => {
    if (listening.length === 0) return null
    const a = [...listening].sort((x, y) => (y.dateAdded ?? '').localeCompare(x.dateAdded ?? ''))[0]
    const total = a.songs.length || a.totalTracks || 0
    const done = a.songs.filter((s) => s.score !== null).length
    return { album: a, done, total, pct: total > 0 ? Math.round((done / total) * 100) : 0 }
  }, [listening])

  // Trending on Pressd this week: popular albums across the whole userbase
  const { data: trending = [] } = useQuery({
    queryKey: ['trending', 'week'],
    queryFn: () => fetchTrending('week', 8),
    enabled: userId > 0,
    staleTime: 5 * 60 * 1000,
  })

  // Friends leaderboard: albums rated in the last 7 days, friends + you
  const leaders = useMemo(() => {
    const counts = new Map<number, { id: number; name: string; count: number; you: boolean }>()
    for (const f of feed) {
      if (f.type !== 'rating' || !withinDays(f.date_rated, 7)) continue
      const e = counts.get(f.friend.id) ?? { id: f.friend.id, name: f.friend.name, count: 0, you: false }
      e.count += 1
      counts.set(f.friend.id, e)
    }
    const youCount = rated.filter((a) => withinDays(a.dateRated, 7)).length
    if (userId > 0) counts.set(userId, { id: userId, name: 'You', count: youCount, you: true })
    return [...counts.values()].filter((e) => e.count > 0).sort((a, b) => b.count - a.count).slice(0, 5)
  }, [feed, rated, userId])
  const maxLeader = Math.max(1, ...leaders.map((l) => l.count))

  // Streak: consecutive weeks with ≥1 rating + the last 7 days of activity
  const streak = useMemo(() => {
    const dates = rated.map((a) => a.dateRated).filter(Boolean) as string[]
    const daySet = new Set(dates.map((d) => dayKey(new Date(d))))
    const days = Array.from({ length: 7 }, (_, i) => {
      const d = new Date()
      d.setDate(d.getDate() - (6 - i))
      return { label: d.toLocaleDateString(undefined, { weekday: 'narrow' }), rated: daySet.has(dayKey(d)), today: i === 6 }
    })
    const ratedWeek = rated.filter((a) => withinDays(a.dateRated, 7)).length
    const weekSet = new Set(dates.map((d) => weekStart(new Date(d))))
    let weeks = 0
    let cur = weekStart(new Date())
    while (weekSet.has(cur)) {
      weeks += 1
      cur = weekStart(new Date(cur - 7 * 86400000))
    }
    return { weeks, ratedWeek, days }
  }, [rated])

  // Rate this next: a recommended album first, else next in queue
  const suggestion = useMemo(() => {
    if (toListen.length === 0) return null
    const rec = toListen.find((a) => a.recommendedByName)
    return rec ?? toListen[0]
  }, [toListen])

  async function handleLike(albumId: number) {
    if (!activeUser) return
    try {
      await toggleLike(activeUser.id, albumId)
      queryClient.invalidateQueries({ queryKey: ['for-you-reviews'] })
    } catch { /* ignore */ }
  }

  const nothingYet = !resume && toListen.length === 0 && rated.length === 0

  return (
    <div className="min-h-screen bg-[#efece6] text-[#1c1917]">
      <div className="mx-auto w-full max-w-[1600px] px-6 md:px-12 py-8 pb-24 flex flex-col lg:flex-row gap-8">

        {/* ─────────── FEED COLUMN ─────────── */}
        <div className="flex-1 min-w-0">

          {/* header */}
          <header className="mb-7">
            <p className="m-0 mb-1.5 text-[12px] font-semibold uppercase tracking-[0.14em] text-[#a8998a]">{dateStr}</p>
            <h1 className="m-0 text-[36px] leading-none font-extrabold tracking-[-0.02em]" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>For You</h1>
            <p className="mt-2.5 text-[15px] text-[#8a7f72]">
              {greeting}{firstName ? ` ${firstName},` : ''} here&rsquo;s what&rsquo;s moving on Press&rsquo;d this week.
            </p>
          </header>

          {/* first-run CTA when the account is empty */}
          {nothingYet && (
            <div className="flex items-center gap-4 rounded-[18px] border border-[#d7e6dd] p-5 mb-7" style={{ background: 'linear-gradient(100deg,#eef5f0,#faf8f5 55%)' }}>
              <div className="flex-1">
                <p className="m-0 font-bold text-[16px]" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>Rate your first album</p>
                <p className="m-0 mt-1 text-[13px] text-[#8a7f72]">Add an album to start building your library and streak.</p>
              </div>
              <button
                onClick={() => navigate('/library')}
                className="shrink-0 rounded-[11px] bg-[#2d6a4f] hover:bg-[#245c43] text-white px-5 py-2.5 text-[13px] font-bold transition-colors flex items-center gap-1.5"
                style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}
              >
                <Plus size={15} /> Add an album
              </button>
            </div>
          )}

          {/* resume card */}
          {resume && (
            <div className="flex items-center gap-4 rounded-[18px] border border-[#d7e6dd] p-4 mb-7" style={{ background: 'linear-gradient(100deg,#eef5f0,#faf8f5 55%)' }}>
              <Cover artUrl={resume.album.albumArtUrl} seed={resume.album.artist} size={68} radius={14} />
              <div className="flex-1 min-w-0">
                <p className="m-0 mb-0.5 text-[10px] font-bold uppercase tracking-[0.14em] text-[#7a9e8b]">Pick up where you left off</p>
                <p className="m-0 font-bold text-[16px] truncate" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>{resume.album.albumName}</p>
                <p className="m-0 mt-0.5 mb-2 text-[12.5px] text-[#8a7f72] truncate">{resume.album.artist} · {resume.album.year}</p>
                <div className="flex items-center gap-2.5">
                  <div className="flex-1 max-w-[240px] h-1.5 rounded-full overflow-hidden bg-[#dfe9e2]">
                    <div className="h-full rounded-full bg-[#2d6a4f]" style={{ width: `${resume.pct}%` }} />
                  </div>
                  <span className="text-[11.5px] text-[#8a7f72]">{resume.done} / {resume.total} tracks</span>
                </div>
              </div>
              <button
                onClick={() => navigate(`/rate/${resume.album.id}`)}
                className="shrink-0 rounded-[11px] bg-[#2d6a4f] hover:bg-[#245c43] text-white px-5 py-2.5 text-[13px] font-bold transition-colors flex items-center gap-1.5"
                style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}
              >
                Continue <ArrowRight size={15} />
              </button>
            </div>
          )}

          {/* new releases (Deezer) */}
          {newReleases.length > 0 && (
            <section className="mb-9">
              <div className="flex items-baseline justify-between mb-4">
                <h2 className={SECTION_LABEL}>New &amp; Popular</h2>
              </div>
              <div className="flex gap-4 overflow-x-auto pb-3.5 pt-1" style={{ scrollSnapType: 'x mandatory' }}>
                {newReleases.map((r) => (
                  <NewReleaseCard key={r.deezerId} release={r} userId={userId} onRate={(id) => navigate(`/rate/${id}`)} onAdded={() => queryClient.invalidateQueries({ queryKey: ['albums'] })} />
                ))}
              </div>
            </section>
          )}

          {/* ready to rate (queue) */}
          {toListen.length > 0 && (
            <section className="mb-9">
              <div className="flex items-baseline justify-between mb-4">
                <h2 className={SECTION_LABEL}>Ready to rate</h2>
                <button onClick={() => navigate('/library')} className="text-[12px] font-semibold text-[#2d6a4f] hover:text-[#245c43] flex items-center gap-1">Browse all <ArrowRight size={12} /></button>
              </div>
              <div className="flex gap-4 overflow-x-auto pb-3.5 pt-1" style={{ scrollSnapType: 'x mandatory' }}>
                {toListen.slice(0, 12).map((a) => (
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
                    <p className="m-0 mt-0.5 text-[12px] text-[#8a7f72] truncate">{a.artist} · {a.year}</p>
                    <div className="mt-2 flex items-center gap-2">
                      {a.predictedScore != null ? (
                        <>
                          <span className="text-[11px] px-2 py-0.5 rounded-md tabular-nums" style={{ background: scoreTint(a.predictedScore), color: songScoreColor(a.predictedScore) }}>~{a.predictedScore.toFixed(2)}</span>
                          <span className="text-[11px] text-[#b3a99c]">predicted</span>
                        </>
                      ) : (
                        <span className="text-[11px] text-[#b3a99c]">Not rated yet</span>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            </section>
          )}

          {/* trending */}
          {trending.length > 0 && (
            <section className="mb-9">
              <div className="flex items-baseline justify-between mb-4 gap-3.5">
                <h2 className={SECTION_LABEL}>Trending on Press&rsquo;d</h2>
                <span className="text-[11px] text-[#b3a99c]">This week</span>
              </div>
              <div className="rounded-[18px] border border-[#e6ded2] bg-[#faf8f5] overflow-hidden">
                {trending.map((row, i) => (
                  <button
                    key={row.album_id}
                    onClick={() => navigate(`/album/${row.album_id}`)}
                    className="group w-full flex items-center gap-4 text-left hover:bg-[#f3efe8] transition-colors"
                    style={{ borderTop: i === 0 ? 'none' : '1px solid #f0ebe3', padding: '15px 18px' }}
                  >
                    <span className="w-[22px] text-center shrink-0 tabular-nums" style={{ fontFamily: "'Playfair Display', serif", fontWeight: 700, fontSize: 15, color: '#c2b8ad' }}>{i + 1}</span>
                    <div
                      className="shrink-0 transition-transform duration-200 ease-[cubic-bezier(0.34,1.56,0.64,1)] group-hover:scale-[1.13] group-hover:-rotate-3 group-active:scale-105"
                      style={{ willChange: 'transform' }}
                    >
                      <Cover artUrl={row.album_art_url} seed={row.artist} size={58} radius={13} fontSize={24} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="m-0 font-bold text-[15px] truncate" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>{row.album_name}</p>
                      <p className="m-0 mt-0.5 text-[12.5px] text-[#8a7f72] truncate">{row.artist}</p>
                    </div>
                    <span className="text-[11.5px] text-[#8a7f72] shrink-0 hidden sm:block text-right" style={{ width: 118 }}>
                      {row.rater_count} {row.rater_count === 1 ? 'rating' : 'ratings'}
                      {row.last_rated ? ` · ${timeAgo(row.last_rated)}` : ''}
                    </span>
                    {row.avg_score != null && <ScorePill score={row.avg_score} />}
                  </button>
                ))}
              </div>
            </section>
          )}

          {/* community reviews */}
          <section>
            <div className="flex items-baseline justify-between mb-4">
              <h2 className={SECTION_LABEL}>Fresh reviews from friends</h2>
              <button onClick={() => navigate('/social')} className="text-[12px] font-semibold text-[#2d6a4f] hover:text-[#245c43] flex items-center gap-1">See more <ArrowRight size={12} /></button>
            </div>
            {reviews.length > 0 ? (
              <div className="flex flex-col gap-3.5">
                {reviews.slice(0, 4).map((rv) => (
                  <ReviewCard key={`${rv.friend.id}-${rv.album_id}`} rv={rv} onOpen={() => navigate(`/album/${rv.album_id}`)} onLike={() => handleLike(rv.album_id)} />
                ))}
              </div>
            ) : (
              <div className="rounded-[18px] border border-dashed border-[#d8cfc1] bg-[#faf8f5] px-6 py-10 flex flex-col items-center text-center">
                <div className="w-11 h-11 rounded-full bg-[#eef1ec] flex items-center justify-center mb-3">
                  <MessageCircle size={20} className="text-[#a8998a]" strokeWidth={1.75} />
                </div>
                <p className="m-0 font-bold text-[14.5px]" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>No reviews yet</p>
                <p className="m-0 mt-1 max-w-[320px] text-[12.5px] leading-snug text-[#8a7f72]">
                  When your friends write reviews, they&rsquo;ll show up here. Add friends or write the first review yourself.
                </p>
                <button
                  onClick={() => navigate('/social')}
                  className="mt-4 rounded-[11px] border border-[#2d6a4f] bg-transparent text-[#2d6a4f] hover:bg-[#2d6a4f] hover:text-white px-4 py-2 text-[12.5px] font-bold transition-colors flex items-center gap-1.5"
                  style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}
                >
                  Find friends <ArrowRight size={13} />
                </button>
              </div>
            )}
          </section>
        </div>

        {/* ─────────── RIGHT RAIL ─────────── */}
        <aside className="w-full lg:w-[312px] shrink-0 flex flex-col gap-5">

          {/* streak */}
          <div className="rounded-[20px] p-[22px]" style={{ background: 'linear-gradient(165deg,#2d6a4f,#234f3d)', color: '#eaf5ef', boxShadow: '0 20px 44px -22px rgba(35,79,61,.85)' }}>
            <div className="flex items-center justify-between mb-4">
              <span className="text-[10.5px] font-bold uppercase tracking-[0.16em]" style={{ color: '#a9d3bf' }}>Your streak</span>
              <span className="text-[11px]" style={{ color: '#a9d3bf' }}>Rating streak</span>
            </div>
            <div className="flex items-center gap-3.5 mb-5">
              <Flame size={34} className="text-[#ffd9a0]" style={{ animation: 'none' }} fill="#f7b955" />
              <div>
                <div className="flex items-baseline gap-2">
                  <span style={{ fontFamily: "'Playfair Display', serif", fontWeight: 700, fontSize: 44, lineHeight: 0.9, color: '#fff' }}>{streak.weeks}</span>
                  <span className="text-[14px] font-semibold" style={{ color: '#a9d3bf' }}>{streak.weeks === 1 ? 'week' : 'weeks'}</span>
                </div>
                <p className="m-0 mt-1.5 text-[12px]" style={{ color: '#cfe6da' }}>in a row rating albums</p>
              </div>
            </div>
            <div className="flex justify-between gap-1.5 mb-3.5">
              {streak.days.map((d, i) => (
                <div key={i} className="flex flex-col items-center gap-1.5 flex-1">
                  <span className="text-[10px] font-semibold" style={{ color: '#8fbfa6' }}>{d.label}</span>
                  <div
                    className="flex items-center justify-center"
                    style={{
                      width: 30, height: 30, borderRadius: 10,
                      background: d.rated ? 'rgba(255,255,255,.92)' : 'rgba(255,255,255,.08)',
                      color: '#2d6a4f',
                      border: d.today ? '2px dashed #9fd3ba' : 'none',
                    }}
                  >
                    {d.rated && <Check size={14} strokeWidth={3} />}
                  </div>
                </div>
              ))}
            </div>
            <div className="flex items-center gap-2.5 rounded-xl px-3.5 py-3" style={{ background: 'rgba(255,255,255,.09)' }}>
              <span style={{ fontFamily: "'Playfair Display', serif", fontWeight: 700, fontSize: 22, color: '#fff' }}>{streak.ratedWeek}</span>
              <p className="m-0 text-[12px] leading-tight" style={{ color: '#cfe6da' }}>albums rated in the<br />last 7 days</p>
            </div>
            <div className="mt-3 flex items-center gap-2 text-[11.5px]" style={{ color: '#a9d3bf' }}>
              <Clock size={13} />
              {streak.ratedWeek > 0 ? "You're on a roll — keep it going." : "Rate 1 album to start this week's streak."}
            </div>
          </div>

          {/* friends leaderboard */}
          {leaders.length > 0 && (
            <div className="rounded-[20px] border border-[#e6ded2] bg-[#faf8f5] p-5">
              <div className="flex items-baseline justify-between mb-3.5">
                <span className="text-[10.5px] font-bold uppercase tracking-[0.16em] text-[#a8998a]">Friends this week</span>
                <span className="text-[11px] text-[#b3a99c]">most rated</span>
              </div>
              <div className="flex flex-col gap-1">
                {leaders.map((l, i) => (
                  <div key={l.id} className="flex items-center gap-2.5 px-2 py-1.5 rounded-[10px]" style={{ background: l.you ? '#eef5f0' : 'transparent' }}>
                    <span className="w-4 text-[12px] font-bold text-[#c2b8ad]">{i + 1}</span>
                    <div style={{ width: 24, height: 24, borderRadius: '50%', flexShrink: 0, background: coverGradient(hueFromString(l.name)), color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: "'Plus Jakarta Sans', sans-serif", fontWeight: 700, fontSize: 11 }}>
                      {l.name[0].toUpperCase()}
                    </div>
                    <span className="w-[62px] text-[12.5px] font-semibold truncate" style={{ color: l.you ? '#2d6a4f' : '#4a423a' }}>{l.name}</span>
                    <div className="flex-1 h-1.5 rounded-full overflow-hidden mx-1 bg-[#ece5da]">
                      <div className="h-full rounded-full" style={{ width: `${(l.count / maxLeader) * 100}%`, background: l.you ? '#2d6a4f' : '#cdbfae' }} />
                    </div>
                    <span className="w-4 text-right text-[13px] font-bold text-[#4a423a]" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>{l.count}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* rate this next */}
          {suggestion && (
            <div className="rounded-[20px] border border-dashed border-[#cdbfae] bg-[#f6f2ec] p-5">
              <span className="text-[10.5px] font-bold uppercase tracking-[0.16em] text-[#a8998a]">Rate this next</span>
              <div className="flex gap-3 mt-3.5">
                <Cover artUrl={suggestion.albumArtUrl} seed={suggestion.artist} size={60} radius={12} fontSize={23} />
                <div className="flex-1 min-w-0">
                  <p className="m-0 font-bold text-[14.5px] truncate" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>{suggestion.albumName}</p>
                  <p className="m-0 mt-0.5 text-[12px] text-[#8a7f72] truncate">{suggestion.artist}</p>
                  <p className="m-0 mt-2 text-[11.5px] leading-snug italic text-[#a08c76]">
                    {suggestion.recommendedByName
                      ? `Recommended by ${suggestion.recommendedByName}`
                      : suggestion.predictedScore != null
                        ? `We think you'll rate this ~${suggestion.predictedScore.toFixed(2)}`
                        : 'Next up in your queue'}
                  </p>
                </div>
              </div>
              <button
                onClick={() => navigate(`/rate/${suggestion.id}`)}
                className="mt-4 w-full py-2.5 rounded-[11px] border border-[#2d6a4f] bg-transparent text-[#2d6a4f] hover:bg-[#2d6a4f] hover:text-white text-[13px] font-bold transition-colors flex items-center justify-center gap-1.5"
                style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}
              >
                Start rating <ArrowRight size={14} />
              </button>
            </div>
          )}
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
                className="w-[130px] py-2 rounded-[10px] bg-[#2d6a4f] hover:bg-[#245c43] text-white text-[12.5px] font-bold flex items-center justify-center gap-1.5 transition-colors disabled:opacity-60"
                style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}
              >
                {pending === 'rate' ? <Loader2 size={13} className="animate-spin" /> : <Play size={12} fill="currentColor" />} Rate now
              </button>
              <button
                onClick={() => act('listen')}
                disabled={!!pending}
                className="w-[130px] py-2 rounded-[10px] bg-white/90 hover:bg-white text-[#1c1917] text-[12.5px] font-bold flex items-center justify-center gap-1.5 transition-colors disabled:opacity-60"
                style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}
              >
                {pending === 'listen' ? <Loader2 size={13} className="animate-spin" /> : <Plus size={14} />} To listen
              </button>
            </>
          )}
        </div>
      </div>
      <p className="mt-2.5 mb-0 font-bold text-[14px] truncate" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>{release.albumName}</p>
      <p className="m-0 mt-0.5 text-[12px] text-[#8a7f72] truncate">{release.artist}{release.year ? ` · ${release.year}` : ''}</p>
      {error && <p className="m-0 mt-1 text-[11px] text-[#c0392b]">Couldn&rsquo;t add — try again</p>}
    </div>
  )
}

// ── review card ───────────────────────────────────────────────────────────────

function ReviewCard({ rv, onOpen, onLike }: { rv: FriendReview; onOpen: () => void; onLike: () => void }) {
  const liked = rv.liked_by_me
  return (
    <article className="rounded-[18px] border border-[#e6ded2] bg-[#faf8f5] p-[18px]" style={{ boxShadow: '0 12px 34px -24px rgba(60,45,30,.4)' }}>
      <div className="flex items-center gap-2.5 mb-3">
        <div style={{ width: 38, height: 38, borderRadius: '50%', flexShrink: 0, background: coverGradient(hueFromString(rv.friend.name)), color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: "'Plus Jakarta Sans', sans-serif", fontWeight: 700, fontSize: 15 }}>
          {rv.friend.name[0].toUpperCase()}
        </div>
        <div className="flex-1 min-w-0">
          <p className="m-0 text-[13px] text-[#4a423a]"><span className="font-semibold text-[#1c1917]">{rv.friend.name}</span> reviewed an album</p>
          <p className="m-0 mt-px text-[11.5px] text-[#b3a99c]">{timeAgo(rv.review_at)}</p>
        </div>
        {rv.score != null && <ScorePill score={rv.score} big />}
      </div>
      <div className="flex gap-3.5 cursor-pointer" onClick={onOpen}>
        <Cover artUrl={rv.album_art_url} seed={rv.artist} size={64} radius={12} fontSize={24} />
        <div className="flex-1 min-w-0">
          <p className="m-0 font-bold text-[15px]" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>{rv.album_name}</p>
          <p className="m-0 mt-0.5 mb-2 text-[12.5px] text-[#8a7f72]">{rv.artist}</p>
          <p className="m-0 text-[13.5px] leading-relaxed text-[#4a423a]" style={{ textWrap: 'pretty' } as React.CSSProperties}>&ldquo;{rv.review}&rdquo;</p>
        </div>
      </div>
      <div className="flex items-center mt-4 pt-3.5 border-t border-[#ece5da]" style={{ gap: 18 }}>
        <button onClick={onLike} className="flex items-center gap-1.5 bg-transparent border-none cursor-pointer p-0 text-[12.5px] font-semibold" style={{ color: liked ? '#c0392b' : '#8a7f72' }}>
          <Heart size={14} fill={liked ? 'currentColor' : 'none'} strokeWidth={liked ? 0 : 1.75} className="transition-transform active:scale-125" />
          {rv.like_count}
        </button>
        <span className="flex items-center gap-1.5 text-[12.5px] font-semibold text-[#8a7f72] cursor-pointer" onClick={onOpen}>
          <MessageCircle size={14} strokeWidth={1.75} />
          {rv.comment_count}
        </span>
      </div>
    </article>
  )
}
