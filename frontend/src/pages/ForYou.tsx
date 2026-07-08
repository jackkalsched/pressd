import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, ArrowRight, Heart, MessageCircle, Flame, Clock, Check } from 'lucide-react'
import { fetchAlbums, fetchFeed, fetchFriendReviews, toggleLike } from '../api'
import type { FriendReview } from '../api'
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
      {score.toFixed(1)}
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
  const [trendTab, setTrendTab] = useState<'week' | 'all' | 'top'>('week')

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

  // Trending: friends' ratings from the feed, deduped per album
  const trending = useMemo(() => {
    const ratings = feed.filter((f) => f.type === 'rating' && f.score != null)
    const seen = new Set<number>()
    let items = ratings.filter((r) => (seen.has(r.album_id) ? false : (seen.add(r.album_id), true)))
    if (trendTab === 'week') items = items.filter((r) => withinDays(r.date_rated, 7))
    else if (trendTab === 'top') items = [...items].sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    return items.slice(0, 5)
  }, [feed, trendTab])

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

  const trendTabLabels: Record<typeof trendTab, string> = { week: 'This week', all: 'All time', top: 'Top rated' }
  const nothingYet = !resume && toListen.length === 0 && rated.length === 0

  return (
    <div className="min-h-screen bg-[#efece6] text-[#1c1917]">
      <div className="mx-auto w-full max-w-[1080px] px-5 md:px-8 py-8 pb-24 flex flex-col lg:flex-row gap-8">

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
                          <span className="text-[11px] px-2 py-0.5 rounded-md tabular-nums" style={{ background: scoreTint(a.predictedScore), color: songScoreColor(a.predictedScore) }}>~{a.predictedScore.toFixed(1)}</span>
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
              <div className="flex items-center justify-between mb-4 gap-3.5">
                <h2 className={SECTION_LABEL}>Trending with friends</h2>
                <div className="flex gap-1 rounded-[11px] border border-[#e6ded2] bg-[#f0ebe3] p-[3px]">
                  {(['week', 'all', 'top'] as const).map((k) => (
                    <button
                      key={k}
                      onClick={() => setTrendTab(k)}
                      className="px-3 py-1.5 rounded-lg text-[12px] font-semibold transition-colors"
                      style={{
                        background: trendTab === k ? '#faf8f5' : 'transparent',
                        color: trendTab === k ? '#1c1917' : '#8a7f72',
                        boxShadow: trendTab === k ? '0 2px 6px -3px rgba(60,45,30,.4)' : 'none',
                      }}
                    >
                      {trendTabLabels[k]}
                    </button>
                  ))}
                </div>
              </div>
              <div className="rounded-[18px] border border-[#e6ded2] bg-[#faf8f5] overflow-hidden">
                {trending.map((row, i) => (
                  <button
                    key={row.album_id}
                    onClick={() => navigate(`/album/${row.album_id}`)}
                    className="w-full flex items-center gap-3.5 text-left hover:bg-[#f3efe8] transition-colors"
                    style={{ borderTop: i === 0 ? 'none' : '1px solid #f0ebe3', padding: '13px 18px' }}
                  >
                    <span className="w-[22px] text-center shrink-0 tabular-nums" style={{ fontFamily: "'Playfair Display', serif", fontWeight: 700, fontSize: 15, color: '#c2b8ad' }}>{i + 1}</span>
                    <Cover artUrl={row.album_art_url} seed={row.artist} size={40} radius={10} fontSize={17} />
                    <div className="flex-1 min-w-0">
                      <p className="m-0 font-bold text-[14.5px] truncate" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>{row.album_name}</p>
                      <p className="m-0 mt-0.5 text-[12px] text-[#8a7f72] truncate">{row.artist}</p>
                    </div>
                    <span className="text-[11.5px] text-[#8a7f72] shrink-0 hidden sm:block" style={{ width: 118 }}>
                      {row.friend.name.split(' ')[0]} · {timeAgo(row.date_rated)}
                    </span>
                    {row.score != null && <ScorePill score={row.score} />}
                  </button>
                ))}
              </div>
            </section>
          )}

          {/* community reviews */}
          {reviews.length > 0 && (
            <section>
              <div className="flex items-baseline justify-between mb-4">
                <h2 className={SECTION_LABEL}>Fresh reviews from friends</h2>
                <button onClick={() => navigate('/social')} className="text-[12px] font-semibold text-[#2d6a4f] hover:text-[#245c43] flex items-center gap-1">See more <ArrowRight size={12} /></button>
              </div>
              <div className="flex flex-col gap-3.5">
                {reviews.slice(0, 4).map((rv) => (
                  <ReviewCard key={`${rv.friend.id}-${rv.album_id}`} rv={rv} onOpen={() => navigate(`/album/${rv.album_id}`)} onLike={() => handleLike(rv.album_id)} />
                ))}
              </div>
            </section>
          )}
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
                        ? `We think you'll rate this ~${suggestion.predictedScore.toFixed(1)}`
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
