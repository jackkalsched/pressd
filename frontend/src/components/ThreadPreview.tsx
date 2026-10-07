// The record's discussion, previewed on the community album page: the room's
// top posts by votes, a line or three each, and the way in.
//
// The room only opens to people who have rated the record (deps.thread_access
// — a thread on an album you are halfway through is the most spoiler-prone
// surface in the app), so before that this is a locked line and nothing else.
// A post flagged as a spoiler stays covered here as it does in the thread.
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ArrowRight, Lock, MessageCircle, ThumbsUp } from 'lucide-react'
import { fetchThreadPosts, resolveThread } from '../api'
import { songScoreColor } from '../types'
import { threadKey, threadPath } from '../lib/threads'
import { stagger } from '../lib/format'
import Avatar from './Avatar'
import { SECTION_LABEL } from './albumView'

const SHOWN = 3

export default function ThreadPreview({ album, artist, index = 0 }: {
  album: string
  artist: string
  /** Where the block sits in the page's staggered entrance. */
  index?: number
}) {
  const { data: meta } = useQuery({
    queryKey: threadKey('album', artist, album),
    queryFn: () => resolveThread({ subjectType: 'album', artist, album }),
    // A preview is a nicety; a failure leaves the page as it was.
    retry: false,
  })
  const threadId = meta?.canRead ? meta.threadId : null
  // Shares the thread page's key, so opening the room after this is instant.
  const { data: page } = useQuery({
    queryKey: ['threadPosts', threadId, 'popular'],
    queryFn: () => fetchThreadPosts(threadId!, 'popular'),
    enabled: threadId != null,
    retry: false,
  })

  if (!meta) return null
  const path = threadPath('album', artist, album)

  if (!meta.canRead) {
    return (
      <section className="mt-8 rise-in" style={stagger(index)}>
        <p className={`${SECTION_LABEL} mb-2.5`}>DISCUSSION</p>
        <p className="m-0 flex items-center gap-2 text-[14px] font-semibold text-[#b5aa9c]">
          <Lock size={14} className="shrink-0" /> Finish rating to read the discussion
        </p>
      </section>
    )
  }

  const posts = (page?.posts ?? [])
    .filter(p => p.kind !== 'system' && !p.deleted && p.author)
    .slice(0, SHOWN)
  const people = meta.participantCount

  return (
    <section className="mt-8 rise-in" style={stagger(index)}>
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <p className={SECTION_LABEL}>DISCUSSION</p>
        {people > 0 && (
          <span className="text-[12px] text-[#8a7f72] tabular-nums">
            {people} {people === 1 ? 'presser' : 'pressers'}
          </span>
        )}
      </div>

      {posts.length > 0 && (
        <ul className="m-0 -mx-3 list-none p-0">
          {posts.map((p, i) => (
            <li key={p.id} className="rise-in" style={stagger(index + 1 + i)}>
              <Link
                to={path}
                className="group block rounded-2xl px-3 py-3 no-underline transition-colors hover:bg-[#f2eee7]"
              >
                <div className="flex items-center gap-2">
                  <Avatar name={p.author!.name} avatarUrl={p.author!.avatarUrl} size={22} />
                  <span className="min-w-0 truncate text-[13px] font-semibold text-[#1c1917]">{p.author!.name}</span>
                  {p.author!.score != null && (
                    <span
                      className="font-display ml-auto shrink-0 text-[14px] font-bold tabular-nums"
                      style={{ color: songScoreColor(p.author!.score) }}
                    >
                      {p.author!.score.toFixed(2)}
                    </span>
                  )}
                </div>
                <p className={`m-0 mt-1.5 line-clamp-3 break-words text-[13.5px] leading-snug ${p.isSpoiler ? 'italic text-[#a8998a]' : 'text-[#44403c]'}`}>
                  {p.isSpoiler ? 'Marked as a spoiler' : p.body}
                </p>
                {(p.likeCount > 0 || p.replyCount > 0) && (
                  <div className="mt-1.5 flex items-center gap-3.5 text-[11.5px] font-semibold text-[#a8998a] tabular-nums">
                    {p.likeCount > 0 && (
                      <span className="flex items-center gap-1"><ThumbsUp size={11} strokeWidth={2} /> {p.likeCount}</span>
                    )}
                    {p.replyCount > 0 && (
                      <span className="flex items-center gap-1"><MessageCircle size={11} strokeWidth={2} /> {p.replyCount}</span>
                    )}
                  </div>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}

      <Link
        to={path}
        className="group mt-1.5 inline-flex items-center gap-1.5 text-[13.5px] font-semibold text-[#2d6a4f] no-underline hover:text-[#245c43]"
      >
        {posts.length > 0 ? 'Open the discussion' : 'Be the first to weigh in'}
        <ArrowRight size={14} className="transition-transform group-hover:translate-x-0.5" />
      </Link>
    </section>
  )
}
