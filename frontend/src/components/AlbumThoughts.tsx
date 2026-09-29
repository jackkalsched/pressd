// The line on the album page that leads into a record's discussion.
// PLAN_discussions.md §10, §4.1.
//
// Narrower than mobile's version on purpose. There the same row does two jobs —
// it invites you to write a review when you have none, and takes you to the
// conversation once you have — because the review composer is behind a button.
// On web the composer is already open on this page, directly above this row, so
// the "write a review" state would be a second button for something in reach.
// This row is only ever the door to the room.
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { ChevronRight, Lock, MessageCircle } from 'lucide-react'
import { resolveThread } from '../api'
import { threadKey, threadPath } from '../lib/threads'

export default function AlbumThoughts({ album, artist }: { album: string; artist: string }) {
  const { data: meta } = useQuery({
    queryKey: threadKey('album', artist, album),
    queryFn: () => resolveThread({ subjectType: 'album', artist, album }),
    // A thread is a nicety on this page; a failure should leave the album
    // readable rather than retrying at it.
    retry: false,
  })

  if (!meta) return null

  const people = meta.participantCount
  const locked = !meta.canRead

  const label = locked
    ? 'Finish rating to discuss'
    : people > 0
      ? `${people} ${people === 1 ? 'presser' : 'pressers'} weighed in`
      : 'Be the first to weigh in'

  const body = (
    <>
      {locked ? (
        <Lock size={16} className="text-[#c2b8ad] shrink-0" />
      ) : (
        <MessageCircle size={17} className="text-[#2d6a4f] shrink-0" />
      )}
      <span className={`text-[15px] font-semibold truncate ${locked ? 'text-[#c2b8ad]' : 'text-[#2d6a4f]'}`}>
        {label}
      </span>
      <span className="flex-1" />
      {!locked && <ChevronRight size={18} className="text-[#2d6a4f] shrink-0" />}
    </>
  )

  // Closes the block off the way the track rows are separated from each other.
  const row = 'flex items-center gap-3 py-3.5 border-b border-[#f0ebe3] mt-2 max-w-2xl'

  if (locked) return <div className={row}>{body}</div>

  return (
    <Link to={threadPath('album', artist, album)} className={`${row} hover:opacity-70 transition-opacity`}>
      {body}
    </Link>
  )
}
