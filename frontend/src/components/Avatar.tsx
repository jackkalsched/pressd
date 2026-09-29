// The round avatar, photo or initial.
//
// Lifted out of CommentThread when the discussion surfaces landed: a thread, a
// reply and a comment all draw the same one, and a private copy per surface was
// the alternative.
import { avatarColor } from '../lib/format'

export default function Avatar({
  name, avatarUrl, size = 22,
}: {
  name: string
  avatarUrl?: string | null
  size?: number
}) {
  if (avatarUrl) {
    return (
      <img
        src={avatarUrl}
        alt=""
        style={{ width: size, height: size, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }}
      />
    )
  }
  return (
    <div
      style={{
        width: size, height: size, borderRadius: '50%', background: avatarColor(name || '?'),
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: '#fff', fontSize: size * 0.42, fontWeight: 700, flexShrink: 0,
      }}
    >
      {(name || '?')[0].toUpperCase()}
    </div>
  )
}
