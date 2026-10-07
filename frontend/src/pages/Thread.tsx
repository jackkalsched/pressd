// A discussion thread on one subject — userbase-wide, unlike the rest of the
// social surface: this is where people who have heard the same record argue
// about it. Reading and posting need the same thing (you finished it), so a
// locked subject draws the lock instead of its contents.
// PLAN_discussions.md §4, §5, §6. Mirror of mobile/app/thread/[subject].tsx.
//
// The web adaptations are input-shaped, not feature-shaped: mobile's long-press
// action sheet becomes an overflow button that appears on hover or focus, and
// the composer sends on Enter the way every other web composer here does.
import { useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import { Link, useParams, useSearchParams, useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowLeft, ChevronDown, ChevronUp, FileText, Loader2, Lock, MoreHorizontal, Send, Triangle,
} from 'lucide-react'
import {
  createThreadPost, fetchReplies, fetchThreadPosts, flagSpoiler, replyToPost,
  reportPost, resolveThread,
} from '../api'
import { songScoreColor } from '../types'
import type {
  DiscussionPost, PostAuthor, SubjectRef, SubjectType, ThreadSort, ThreadSummary,
} from '../types'
import { threadKey } from '../lib/threads'
import { timeAgo } from '../lib/format'
import VoteButtons from '../components/VoteButtons'
import Avatar from '../components/Avatar'
import FullReviewModal from '../components/FullReviewModal'
import CoverImg from '../components/CoverImg'

// Matches the red For You uses for a worst track.
const DOWN = '#e0492b'

const SORTS: { key: ThreadSort; label: string }[] = [
  { key: 'popular', label: 'Popular' },
  { key: 'newest', label: 'Newest' },
  { key: 'all', label: 'All time' },
]

// What each locked state should say. The gate exists to make the room worth
// entering, so the copy reads as an invitation rather than a refusal.
const LOCKED_COPY: Record<string, string> = {
  rate_album: 'Finish rating this record to read what people are saying about it.',
}

export default function Thread() {
  const { subject } = useParams<{ subject: string }>()
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const artist = params.get('artist') ?? ''
  const album = params.get('album') ?? ''
  const subjectType = (subject as SubjectType) ?? 'album'

  const [sort, setSort] = useState<ThreadSort>('popular')
  const [draft, setDraft] = useState('')
  const [replyTo, setReplyTo] = useState<DiscussionPost | null>(null)

  const ref: SubjectRef = {
    subjectType,
    artist: artist || undefined,
    album: album || undefined,
  }
  const key = threadKey(subjectType, artist, album)

  const { data: meta, isLoading: metaLoading } = useQuery({
    queryKey: key,
    queryFn: () => resolveThread(ref),
  })

  const threadId = meta?.threadId ?? null
  const { data: page, isLoading: postsLoading } = useQuery({
    queryKey: ['threadPosts', threadId, sort],
    queryFn: () => fetchThreadPosts(threadId!, sort),
    // Only once there is a thread and this viewer has earned it — asking for a
    // locked thread's posts would 403, and there is nothing to show anyway.
    enabled: !!threadId && !!meta?.canRead,
  })

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ['thread'] })
    queryClient.invalidateQueries({ queryKey: ['threadPosts'] })
    queryClient.invalidateQueries({ queryKey: ['heated'] })
    queryClient.invalidateQueries({ queryKey: ['discussionFeed'] })
  }

  // What the reader just posted, so it can be marked once when it lands — and,
  // for a reply, so its parent opens to show it.
  const [fresh, setFresh] = useState<{ id: number; parentId: number | null } | null>(null)
  // Marked once: cleared after the flash has played, so a later remount (a
  // sort change) doesn't replay it on something no longer new.
  useEffect(() => {
    if (!fresh) return
    const t = setTimeout(() => setFresh(null), 2000)
    return () => clearTimeout(t)
  }, [fresh])

  const send = useMutation({
    mutationFn: async () => {
      const body = draft.trim()
      if (!body) return null
      if (replyTo) {
        const r = await replyToPost(replyTo.id, body)
        return { id: r.id, parentId: replyTo.id }
      }
      const p = await createThreadPost(ref, body)
      return { id: p.id, parentId: null }
    },
    onSuccess: (made) => {
      setDraft('')
      setReplyTo(null)
      if (made) setFresh(made)
      invalidate()
    },
  })

  const posts = page?.posts ?? []
  const locked = !!meta && !meta.canRead

  // Wide the way For You is: a centred 1600px container, the conversation in
  // the main column and the record in a sticky rail beside it. Mobile's thread
  // is one column because a phone is; a desktop window left two-thirds empty
  // reads as a page that failed to load. Below lg the rail stacks on top,
  // which is the mobile order: the record, then the room.
  const title = meta?.title || album || 'Discussion'

  return (
    <div className="min-h-screen bg-[#f9f8f6]">
      <div className="mx-auto w-full max-w-[1600px] px-4 md:px-12 py-6 md:py-8 pb-24">
        <button
          onClick={() => navigate(-1)}
          className="flex items-center gap-1.5 text-[13px] font-medium text-[#8a7f72] hover:text-[#111] transition-colors mb-5"
          aria-label="Back"
        >
          <ArrowLeft size={16} /> Back
        </button>

        <div className="flex flex-col lg:flex-row-reverse gap-8 lg:gap-12">
          {/* ── The record ─────────────────────────────────────────── */}
          <aside className="lg:w-[360px] xl:w-[400px] shrink-0">
            <div className="lg:sticky lg:top-8">
              <div className="flex lg:flex-col items-center lg:items-stretch gap-4">
                {meta?.artUrl ? (
                  <CoverImg
                    url={meta.artUrl}
                    displayPx={400}
                    loading="eager"
                    alt=""
                    className="w-16 h-16 lg:w-full lg:h-auto lg:aspect-square rounded-xl lg:rounded-2xl object-cover shrink-0 bg-[#f0ebe3] lg:shadow-[0_18px_40px_-18px_rgba(50,30,10,0.45)]"
                  />
                ) : (
                  <div className="w-16 h-16 lg:w-full lg:h-auto lg:aspect-square rounded-xl lg:rounded-2xl shrink-0 bg-[#ece6dc]" />
                )}
                <div className="min-w-0">
                  <p className="hidden lg:block text-[10.5px] font-bold uppercase tracking-[0.16em] text-[#a8998a] m-0 mb-1">
                    Discussion
                  </p>
                  <h1 className="font-display text-xl lg:text-[28px] lg:leading-tight font-bold text-[#111] truncate lg:whitespace-normal m-0">
                    {title}
                  </h1>
                  {!!meta?.subtitle && (
                    <p className="text-[12.5px] lg:text-[15px] text-[#8a7f72] truncate m-0 mt-0.5">{meta.subtitle}</p>
                  )}
                </div>
              </div>

              {!locked && page?.summary && (
                <div className="mt-5 lg:mt-6 lg:pt-6 lg:border-t lg:border-[#eee]">
                  <Summary summary={page.summary} />
                </div>
              )}
            </div>
          </aside>

          {/* ── The room ───────────────────────────────────────────── */}
          <main className="flex-1 min-w-0">
            {metaLoading ? (
              <div className="flex items-center gap-2 text-[#aaa] text-sm py-16 justify-center">
                <Loader2 size={16} className="animate-spin" /> Loading…
              </div>
            ) : locked ? (
              <div className="flex flex-col items-center text-center gap-3 py-20 lg:py-32 px-6 rounded-2xl border border-dashed border-[#e2dbd0]">
                <Lock size={28} className="text-[#c2b8ad]" />
                <p className="font-display text-xl font-bold text-[#111] m-0">Not yet</p>
                <p className="text-sm text-[#8a7f72] leading-relaxed max-w-sm m-0">
                  {LOCKED_COPY[meta?.lockedReason ?? ''] ?? 'This thread is not open to you yet.'}
                </p>
                {album && (
                  <Link
                    to="/library"
                    className="mt-2 text-sm font-semibold text-[#2d6a4f] hover:text-[#245c43] transition-colors"
                  >
                    Go to your library
                  </Link>
                )}
              </div>
            ) : (
              <>
                {/* ── Sort + who is in the room ──────────────────────── */}
                <div className="flex items-center justify-between gap-3 mb-5">
                  <div className="flex items-center gap-2">
                    {SORTS.map((s) => (
                      <button
                        key={s.key}
                        onClick={() => setSort(s.key)}
                        className={`text-[12px] font-medium px-3 py-1.5 rounded-full transition-colors ${
                          sort === s.key
                            ? 'bg-[#111] text-white'
                            : 'bg-[#efebe5] text-[#666] hover:bg-[#e6e0d7]'
                        }`}
                      >
                        {s.label}
                      </button>
                    ))}
                  </div>
                  {/* Describes the room, not the record — which is why it sits
                      out here rather than in the summary. */}
                  {!!page?.summary && (
                    <span className="text-[12px] text-[#a8998a] tabular-nums shrink-0">
                      {page.summary.raters} {page.summary.raters === 1 ? 'rater' : 'raters'}
                    </span>
                  )}
                </div>

                {/* ── Composer ───────────────────────────────────────── */}
                {meta?.canPost && (
                  <div className="mb-7">
                    {replyTo && (
                      <div className="flex items-center justify-between gap-3 mb-2">
                        <span className="text-[12px] text-[#8a7f72] truncate">
                          Replying to {replyTo.author?.name ?? 'a post'}
                        </span>
                        <button
                          onClick={() => setReplyTo(null)}
                          className="text-[12px] font-semibold text-[#2d6a4f] hover:text-[#245c43] transition-colors shrink-0"
                        >
                          Cancel
                        </button>
                      </div>
                    )}
                    <div className="flex items-end gap-2">
                      <textarea
                        value={draft}
                        onChange={(e) => setDraft(e.target.value.slice(0, 4000))}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault()
                            if (draft.trim() && !send.isPending) send.mutate()
                          }
                        }}
                        rows={2}
                        placeholder={replyTo ? 'Write a reply…' : 'Say something about this record…'}
                        className="flex-1 min-w-0 resize-none bg-white border border-[#e2dbd0] rounded-xl px-3.5 py-2.5 text-[14px] text-[#111] placeholder:text-[#bbb] focus:outline-none focus:border-[#2d6a4f] transition-colors"
                      />
                      <button
                        onClick={() => send.mutate()}
                        disabled={!draft.trim() || send.isPending}
                        aria-label="Post"
                        className="w-10 h-10 shrink-0 rounded-full bg-[#2d6a4f] hover:bg-[#245c43] disabled:bg-[#ececec] disabled:text-[#bbb] text-white flex items-center justify-center transition-colors"
                      >
                        {send.isPending ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
                      </button>
                    </div>
                    {send.isError && (
                      <p className="text-[12px] text-[#c0392b] mt-1.5 m-0">
                        {(send.error as Error).message || 'Could not post.'}
                      </p>
                    )}
                  </div>
                )}

                {/* ── The conversation ───────────────────────────────── */}
                {postsLoading && threadId ? (
                  <div className="flex items-center gap-2 text-[#aaa] text-sm py-10 justify-center">
                    <Loader2 size={16} className="animate-spin" /> Loading posts…
                  </div>
                ) : posts.length === 0 ? (
                  <p className="text-center text-sm text-[#a8998a] py-12 m-0">
                    Nobody has said anything yet. Be the first.
                  </p>
                ) : (
                  <div>
                    {posts.map((p, i) => (
                      <div key={p.id} className="rise-in" style={{ '--i': i } as CSSProperties}>
                        <PostRow post={p} onChanged={invalidate} onReply={setReplyTo} fresh={fresh} />
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </main>
        </div>
      </div>
    </div>
  )
}

/** The record's numbers, above the conversation.
 *
 *  What the room scored it, the tracks it most and least agreed on, and then
 *  every track's room average in album order. Read fresh on every load rather
 *  than seeded as a post, which went stale the moment anyone else rated the
 *  album.
 */
function Summary({ summary }: { summary: ThreadSummary }) {
  // The full list is always open in the desktop rail. Stacked above the
  // conversation on a narrow window, fifteen rows would push the room off
  // screen, so there it waits behind a toggle.
  const [open, setOpen] = useState(false)
  const best = summary.topTrack?.title
  const worst = summary.bottomTrack?.title

  return (
    <div className="pb-5 border-b border-[#eee] lg:pb-0 lg:border-0">
      {/* A rule instead of a filled card: these are the record's numbers, not
          another voice in the room, and a panel made them read as one. */}
      <div className="flex items-center gap-6">
        <span
          className="font-display text-[30px] lg:text-[40px] font-bold tabular-nums leading-none shrink-0"
          style={{ color: songScoreColor(summary.meanScore) }}
        >
          {summary.meanScore.toFixed(2)}
        </span>
        <div className="flex-1 min-w-0 flex flex-col gap-1.5">
          {summary.topTrack && <SummaryTrack best track={summary.topTrack} />}
          {summary.bottomTrack && <SummaryTrack best={false} track={summary.bottomTrack} />}
        </div>
      </div>

      {summary.tracks.length > 1 && (
        <>
          <button
            onClick={() => setOpen((o) => !o)}
            className="lg:hidden mt-4 flex items-center gap-1 text-[12px] font-semibold text-[#2d6a4f] hover:text-[#245c43] transition-colors"
            aria-expanded={open}
          >
            {open ? 'Hide' : 'Every'} track{open ? 's' : ''} {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
          <div className={`${open ? 'block' : 'hidden'} lg:block mt-3 lg:mt-6`}>
            <p className="hidden lg:block text-[10.5px] font-bold uppercase tracking-[0.16em] text-[#a8998a] m-0 mb-2">
              Track by track
            </p>
            <ol className="m-0 p-0 list-none">
              {summary.tracks.map((t, i) => (
                <TrackAverage
                  key={`${t.trackNumber ?? 'x'}-${t.title}`}
                  track={t}
                  number={t.trackNumber ?? i + 1}
                  index={i}
                  mark={t.title === best ? 'best' : t.title === worst ? 'worst' : null}
                  // Only worth saying when it differs from the album's count:
                  // a song some raters skipped has fewer voices behind it.
                  fewer={t.raters < summary.raters}
                />
              ))}
            </ol>
          </div>
        </>
      )}
    </div>
  )
}

/** One track's room average. The bar runs on the same 0–10 scale as the
 *  number beside it, tinted by it, so a record's shape reads at a glance. */
function TrackAverage({
  track, number, mark, fewer, index,
}: {
  track: ThreadSummary['tracks'][number]
  number: number
  mark: 'best' | 'worst' | null
  fewer: boolean
  index: number
}) {
  const color = songScoreColor(track.score)
  return (
    <li className="rise-in flex items-center gap-2.5 py-[5px] min-w-0" style={{ '--i': index } as CSSProperties}>
      <span className="w-5 text-right text-[11.5px] text-[#b5aa9c] tabular-nums shrink-0">{number}</span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className={`text-[13px] truncate ${mark ? 'font-semibold text-[#111]' : 'text-[#44403c]'}`}>
            {track.title}
          </span>
          {mark && (
            <Triangle
              size={9}
              color={mark === 'best' ? '#2d6a4f' : DOWN}
              style={mark === 'best' ? undefined : { transform: 'rotate(180deg)' }}
              className="shrink-0"
            />
          )}
          {fewer && (
            <span className="text-[10.5px] text-[#b5aa9c] shrink-0 tabular-nums">
              {track.raters} {track.raters === 1 ? 'rater' : 'raters'}
            </span>
          )}
        </div>
        <div className="mt-1 h-[3px] rounded-full bg-[#ece6dc] overflow-hidden">
          <div className="grow-x h-full rounded-full" style={{ width: `${track.score * 10}%`, background: color, '--i': index } as CSSProperties} />
        </div>
      </div>
      <span className="font-display w-8 text-right text-[14px] font-bold tabular-nums shrink-0" style={{ color }}>
        {track.score.toFixed(1)}
      </span>
    </li>
  )
}

/** The app already marks a best and worst track with a green triangle up and a
 *  red one down. Same shapes and colours here so the mark means one thing
 *  everywhere — outlined rather than filled, since these are the room's picks
 *  and not the reader's own. */
function SummaryTrack({ best, track }: { best: boolean; track: { title: string; score: number } }) {
  return (
    <div className="flex items-center gap-2 min-w-0">
      <Triangle
        size={10}
        color={best ? '#2d6a4f' : DOWN}
        style={best ? undefined : { transform: 'rotate(180deg)' }}
        className="shrink-0"
      />
      <span className="text-[13px] font-medium text-[#111] truncate">{track.title}</span>
      <span
        className="font-display text-[14px] font-bold tabular-nums shrink-0 ml-auto"
        style={{ color: songScoreColor(track.score) }}
      >
        {track.score.toFixed(1)}
      </span>
    </div>
  )
}

/** One post. The overflow menu carries the same four actions as mobile's
 *  long-press sheet: Reply, Copy text, Flag as spoiler, Report — deliberately
 *  no Block. */
function PostRow({
  post, onChanged, onReply, fresh,
}: {
  post: DiscussionPost
  onChanged: () => void
  onReply: (p: DiscussionPost) => void
  fresh: { id: number; parentId: number | null } | null
}) {
  const [menu, setMenu] = useState(false)
  // Whose full rating is open: this post's, or one of its replies'.
  const [reviewOf, setReviewOf] = useState<number | null>(null)
  // A blurred spoiler is revealed per reader and stays revealed only for this
  // visit — the flag protects everyone else's first read, not this one's.
  const [revealed, setRevealed] = useState(false)
  // Replies are fetched only when someone asks for them: most posts have none,
  // and a thread of thirty would otherwise issue thirty requests on mount.
  const [open, setOpen] = useState(false)
  // A reply the reader just sent opens its parent, so they see it arrive
  // instead of a count ticking up on a closed list. Adjusted during render,
  // once per reply, rather than in an effect that would paint closed first.
  const [openedFor, setOpenedFor] = useState<number | null>(null)
  if (fresh?.parentId === post.id && openedFor !== fresh.id) {
    setOpenedFor(fresh.id)
    setOpen(true)
  }
  const { data: replies = [], isLoading: repliesLoading } = useQuery({
    queryKey: ['replies', post.id],
    queryFn: () => fetchReplies(post.id),
    enabled: open,
  })

  // Escape closes the actions menu. Without it the invisible backdrop that
  // catches the dismissing click stays over the page, and a reader who opened
  // the menu from the keyboard has no way to put it away.
  useEffect(() => {
    if (!menu) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenu(false) }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [menu])

  const system = post.kind === 'system'
  const hidden = post.isSpoiler && !revealed && !system

  async function act(value: string) {
    setMenu(false)
    if (value === 'reply') return onReply(post)
    if (value === 'copy') {
      await navigator.clipboard.writeText(post.body).catch(() => {})
      return
    }
    if (value === 'spoiler') {
      await flagSpoiler(post.id).catch(() => {})
      return onChanged()
    }
    if (value === 'report') {
      if (!confirm('Report this post? A few reports hide it while it is looked at.')) return
      await reportPost(post.id, 'abuse').catch(() => {})
      onChanged()
    }
  }

  if (post.deleted) {
    return (
      <p className="text-[13px] italic text-[#c2b8ad] py-3.5 border-b border-[#f0ebe3] m-0">
        This post was removed.
      </p>
    )
  }

  if (system) {
    return (
      <div className="bg-[#2d6a4f]/8 rounded-xl px-4 py-3.5 mb-3">
        <p className="text-[10px] font-bold tracking-[0.1em] text-[#2d6a4f] mb-1 m-0">PRESS&rsquo;D</p>
        <p className="font-display text-[15px] text-[#111] leading-relaxed whitespace-pre-wrap break-words m-0">
          {post.body}
        </p>
      </div>
    )
  }

  return (
    <div className={`group py-3.5 border-b border-[#f0ebe3] rounded-lg ${fresh?.id === post.id ? 'flash' : ''}`}>
      <div className="flex items-center gap-3 mb-1">
        {/* The person first and largest. Whose opinion this is matters more than
            what they scored it — so their face, then their name. */}
        <AuthorLink author={post.author} gap="gap-3">
          <Avatar name={post.author?.name ?? '?'} avatarUrl={post.author?.avatarUrl} size={30} />
          <span className="text-[16px] font-semibold text-[#111] truncate group-hover/author:underline underline-offset-2">
            {post.author?.name ?? 'Unknown'}
          </span>
        </AuthorLink>
        {post.createdAt && (
          <span className="text-[11px] text-[#c2b8ad] shrink-0">{timeAgo(post.createdAt)}</span>
        )}
        <div className="ml-auto flex items-center gap-2.5 shrink-0">
          {post.author?.score != null && (
            <span
              className="font-display text-[15px] font-bold tabular-nums"
              style={{ color: songScoreColor(post.author.score) }}
            >
              {post.author.score.toFixed(2)}
            </span>
          )}
          {/* A score means a rated copy stands behind the post, so there is a
              full rating to open. Always visible, unlike the overflow menu:
              it's something to read, not an action to tuck away. */}
          {post.author?.score != null && (
            <FullReviewButton name={post.author?.name ?? 'their'} onOpen={() => setReviewOf(post.id)} />
          )}
          <div className="relative">
            <button
              onClick={() => setMenu((v) => !v)}
              aria-label="Post actions"
              className="text-[#ccc] hover:text-[#555] opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity"
            >
              <MoreHorizontal size={16} />
            </button>
            {menu && (
              <>
                {/* Catches the click that dismisses the menu. */}
                <div className="fixed inset-0 z-10" onClick={() => setMenu(false)} />
                <div className="menu-in absolute right-0 top-6 z-20 w-44 bg-white border border-[#e8e2d9] rounded-xl shadow-lg py-1">
                  {[
                    { value: 'reply', label: 'Reply' },
                    { value: 'copy', label: 'Copy text' },
                    { value: 'spoiler', label: 'Flag as spoiler' },
                    { value: 'report', label: 'Report post' },
                  ].map((o) => (
                    <button
                      key={o.value}
                      onClick={() => act(o.value)}
                      className="w-full text-left px-3.5 py-2 text-[13px] text-[#444] hover:bg-[#f7f5f2] transition-colors"
                    >
                      {o.label}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Everything under the name hangs from it, not from the avatar: 30px of
          face plus the 12px gap. */}
      <div className="pl-[42px]">
      {hidden ? (
        <button
          onClick={() => setRevealed(true)}
          className="text-[14px] italic text-[#bbb] hover:text-[#888] transition-colors text-left"
        >
          Spoiler — click to read
        </button>
      ) : (
        <p className="text-[14.5px] text-[#111] leading-relaxed whitespace-pre-wrap break-words m-0">
          {post.body}
        </p>
      )}

      <div className="flex items-center gap-4 mt-2.5">
        <VoteButtons
          postId={post.id}
          likes={post.likeCount}
          dislikes={post.dislikeCount}
          myVote={post.myVote}
        />
        <button
          onClick={() => onReply(post)}
          className="text-[12px] font-medium text-[#a8998a] hover:text-[#555] transition-colors"
        >
          Reply
        </button>
        {post.replyCount > 0 && (
          <button
            onClick={() => setOpen((v) => !v)}
            className="flex items-center gap-1 text-[12px] font-semibold text-[#2d6a4f] hover:text-[#245c43] transition-colors"
          >
            {post.replyCount} {post.replyCount === 1 ? 'reply' : 'replies'}
            {open ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
          </button>
        )}
      </div>

      {/* Indented and ruled on the left so a reply reads as hanging off the post
          above it rather than as another post in the thread. */}
      {open && (
        <div className="mt-3 pl-3.5 border-l-2 border-[#f0ebe3]">
          {repliesLoading ? (
            <div className="flex items-center gap-1.5 text-[#bbb] text-xs py-2">
              <Loader2 size={12} className="animate-spin" /> Loading replies…
            </div>
          ) : (
            replies.map((r, ri) => (
              <div
                key={r.id}
                className={`py-2 rounded-lg rise-in ${fresh?.id === r.id ? 'flash' : ''}`}
                style={{ '--i': ri } as CSSProperties}
              >
                {r.deleted ? (
                  <p className="text-[13px] italic text-[#c2b8ad] m-0">This reply was removed.</p>
                ) : (
                  <>
                    <div className="flex items-center gap-2.5 mb-0.5">
                      <AuthorLink author={r.author} gap="gap-2.5">
                        <Avatar name={r.author?.name ?? '?'} avatarUrl={r.author?.avatarUrl} size={22} />
                        <span className="text-[13.5px] font-semibold text-[#111] truncate group-hover/author:underline underline-offset-2">
                          {r.author?.name ?? 'Unknown'}
                        </span>
                      </AuthorLink>
                      {r.createdAt && (
                        <span className="text-[10.5px] text-[#c2b8ad] shrink-0">{timeAgo(r.createdAt)}</span>
                      )}
                      {r.author?.score != null && (
                        <span
                          className="font-display text-[13px] font-bold tabular-nums ml-auto shrink-0"
                          style={{ color: songScoreColor(r.author.score) }}
                        >
                          {r.author.score.toFixed(2)}
                        </span>
                      )}
                      {r.author?.score != null && (
                        <FullReviewButton compact name={r.author?.name ?? 'their'} onOpen={() => setReviewOf(r.id)} />
                      )}
                    </div>
                    <p className="text-[13.5px] text-[#111] leading-relaxed whitespace-pre-wrap break-words m-0">
                      {r.body}
                    </p>
                    <div className="mt-1.5">
                      <VoteButtons
                        postId={r.id}
                        likes={r.likeCount}
                        dislikes={r.dislikeCount}
                        myVote={r.myVote}
                        compact
                      />
                    </div>
                  </>
                )}
              </div>
            ))
          )}
        </div>
      )}
      </div>
      {reviewOf != null && <FullReviewModal postId={reviewOf} onClose={() => setReviewOf(null)} />}
    </div>
  )
}

/** Someone's full rating of the record — beside the overflow menu on a post,
 *  and on a reply. An icon that drops down one named action, so the icon can
 *  stay quiet while what it opens is still spelled out, with whose it is. */
/** A post's author, linking to their profile — public to every user, so the
 *  name works whether or not you've friended them. */
function AuthorLink({ author, gap, children }: { author: PostAuthor | null; gap: string; children: ReactNode }) {
  if (!author) return <span className={`flex min-w-0 items-center ${gap}`}>{children}</span>
  return (
    <Link
      to={`/u/${author.id}`}
      className={`group/author flex min-w-0 items-center no-underline ${gap}`}
      aria-label={`Open ${author.name}'s profile`}
    >
      {children}
    </Link>
  )
}

function FullReviewButton({
  name, onOpen, compact = false,
}: {
  name: string
  onOpen: () => void
  compact?: boolean
}) {
  const [open, setOpen] = useState(false)

  // Escape closes it, for the same reason as the overflow menu: otherwise the
  // invisible backdrop stays over the page for a keyboard user.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label={`${name}'s full review`}
        aria-expanded={open}
        className={`transition-colors ${open ? 'text-[#2d6a4f]' : 'text-[#b5aa9c] hover:text-[#2d6a4f]'}`}
      >
        <FileText size={compact ? 13 : 15} />
      </button>
      {open && (
        <>
          {/* Catches the click that dismisses the dropdown. */}
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="menu-in absolute right-0 top-6 z-20 bg-white border border-[#e8e2d9] rounded-xl shadow-lg py-1">
            <button
              onClick={() => { setOpen(false); onOpen() }}
              className="w-full flex items-center gap-2 whitespace-nowrap text-left px-3.5 py-2 text-[13px] text-[#444] hover:bg-[#f7f5f2] transition-colors"
            >
              <FileText size={13} className="text-[#8a7f72]" />
              Access {name}&rsquo;s full review
            </button>
          </div>
        </>
      )}
    </div>
  )
}
