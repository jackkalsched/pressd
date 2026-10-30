// You against one other person on a record you have both finished: both scores,
// the four factors, every track side by side, and where you split furthest. The
// web port of FriendCompare in mobile/app/album/[id].tsx, drawn in the album kit
// so it reads as another page of AlbumDetail.
//
// Tracks pair on track_id, the recording, never the title: two editions spell a
// song differently, and a live cut can share a studio title. The two copies may
// be different editions, so a song only one of you has still gets a row, with a
// dash on the other side. Lower score on the left, as on every compare screen;
// the factor and track columns keep that order, so nothing swaps mid-page.
import { songScoreColor, EP_MAX_TRACKS } from '../types'
import type { Album, Song } from '../types'
import { CompareScores, GREEN, RevealRow, SECTION_LABEL, type CompareSide } from './albumView'
import { stagger } from '../lib/format'

interface Row {
  key: string
  trackNumber: number | null
  title: string
  yours: number | null
  theirs: number | null
}

function pairTracks(theirs: Album, mine: Album): Row[] {
  const byNumber = (a: Song, b: Song) => (a.trackNumber ?? 0) - (b.trackNumber ?? 0)
  const mineByTrack = new Map(mine.songs.filter(s => s.trackId != null).map(s => [s.trackId, s]))
  const paired = new Set<number>()
  const rows: Row[] = [...theirs.songs].sort(byNumber).map((song) => {
    const match = song.trackId != null ? mineByTrack.get(song.trackId) : undefined
    if (match) paired.add(match.id)
    return {
      key: `t${song.id}`,
      trackNumber: song.trackNumber,
      title: song.title,
      yours: match?.score ?? null,
      theirs: song.score,
    }
  })
  const onlyYours: Row[] = [...mine.songs].sort(byNumber).filter(s => !paired.has(s.id)).map(s => ({
    key: `m${s.id}`, trackNumber: s.trackNumber, title: s.title, yours: s.score, theirs: null,
  }))
  return [...rows, ...onlyYours]
}

const score1 = (v: number | null) => (v != null ? v.toFixed(1) : '—')

export default function AlbumCompare({ theirs, mine, ownerName }: {
  theirs: Album
  mine: Album
  ownerName: string
}) {
  const theirScore = theirs.score!
  const myScore = mine.score!
  const diff = theirScore - myScore
  const youLeft = myScore <= theirScore

  const youSide: CompareSide = { label: 'YOU', score: myScore, color: '#44403c', tick: '#1c1917' }
  const themSide: CompareSide = { label: ownerName.toUpperCase(), score: theirScore, color: GREEN, tick: GREEN }
  const [left, right] = youLeft ? [youSide, themSide] : [themSide, youSide]
  const inOrder = (yours: number | null, other: number | null) => (youLeft ? [yours, other] : [other, yours])

  const rows = pairTracks(theirs, mine)
  let widest: Row | null = null
  let widestGap = 0
  for (const r of rows) {
    if (r.yours == null || r.theirs == null) continue
    const gap = Math.abs(r.yours - r.theirs)
    if (gap > widestGap) { widest = r; widestGap = gap }
  }

  const factors = [
    { label: 'Theme', yours: mine.theme, theirs: theirs.theme },
    { label: 'Replay', yours: mine.replayValue, theirs: theirs.replayValue },
    { label: 'Production', yours: mine.production, theirs: theirs.production },
    { label: 'Distinctness', yours: mine.distinctness, theirs: theirs.distinctness },
  ]
  const isEP = Math.max(theirs.songs.length, mine.songs.length) <= EP_MAX_TRACKS
  const showFactors = !isEP && factors.some(f => f.yours != null || f.theirs != null)

  const legend = (
    <p className="m-0 truncate text-[11px] font-bold tracking-[0.12em]">
      <span style={{ color: left.color }}>{left.label}</span>
      <span className="text-[#c2b8ad]"> / </span>
      <span style={{ color: right.color }}>{right.label}</span>
    </p>
  )

  return (
    <div>
      <div className="rise-in" style={stagger(0)}>
        <CompareScores left={left} right={right} />
        {Math.abs(diff) < 0.005 ? (
          <p className="m-0 mt-5 text-[15px] text-[#1c1917]">You and {ownerName} landed on exactly the same score.</p>
        ) : (
          <p className="m-0 mt-5 text-[15px] text-[#1c1917]">
            {ownerName} rated this{' '}
            <span className="font-bold tabular-nums" style={{ color: diff > 0 ? GREEN : '#c0392b' }}>{Math.abs(diff).toFixed(2)}</span>
            {` ${diff > 0 ? 'higher' : 'lower'} than you`}
          </p>
        )}
        {widest && (
          <p className="m-0 mt-1 text-[13.5px] text-[#57534e]">
            Biggest difference on &ldquo;{widest.title}&rdquo;: you {score1(widest.yours)}, {ownerName} {score1(widest.theirs)}
          </p>
        )}
      </div>

      {showFactors && (
        <>
          <div className="mb-3 mt-9 flex items-baseline justify-between gap-4">
            <p className={SECTION_LABEL}>FACTORS</p>
            {legend}
          </div>
          <div className="grid grid-cols-2 gap-y-5 sm:grid-cols-4">
            {factors.map((f, i) => {
              const [a, b] = inOrder(f.yours, f.theirs)
              return (
                <div key={f.label} className="rise-in" style={stagger(1 + i)}>
                  <p className="font-display m-0 text-[26px] font-bold leading-none tabular-nums">
                    <span style={{ color: a != null ? songScoreColor(a) : '#c8c0b4' }}>{score1(a)}</span>
                    <span className="mx-1.5 text-[18px] font-normal text-[#c2b8ad]">/</span>
                    <span style={{ color: b != null ? songScoreColor(b) : '#c8c0b4' }}>{score1(b)}</span>
                  </p>
                  <p className="m-0 mt-1.5 text-[12px] font-medium text-[#8a7f72]">{f.label}</p>
                </div>
              )
            })}
          </div>
        </>
      )}

      <div className="mb-2 mt-10 flex items-baseline justify-between gap-4">
        <p className={SECTION_LABEL}>TRACKS</p>
        {legend}
      </div>
      <ol className="m-0 -mx-4 list-none p-0">
        {rows.map((r, i) => {
          const [a, b] = inOrder(r.yours, r.theirs)
          const isWidest = widest != null && r.key === widest.key
          return (
            <RevealRow key={r.key} index={i}>
              <div className={`flex items-center gap-4 rounded-2xl px-4 py-3 transition-colors hover:bg-[#f2eee7] ${isWidest ? 'bg-[#2d6a4f]/[0.07]' : ''}`}>
                <span className="w-6 shrink-0 text-right text-[12.5px] text-[#b5aa9c] tabular-nums">{r.trackNumber}</span>
                <span className={`min-w-0 flex-1 truncate text-[14.5px] text-[#1c1917] ${isWidest ? 'font-semibold' : ''}`}>{r.title}</span>
                <span className="font-display w-12 text-right text-[16px] font-bold tabular-nums" style={{ color: a != null ? songScoreColor(a) : '#c8c0b4' }}>{score1(a)}</span>
                <span className="font-display w-12 text-right text-[16px] font-bold tabular-nums" style={{ color: b != null ? songScoreColor(b) : '#c8c0b4' }}>{score1(b)}</span>
              </div>
            </RevealRow>
          )
        })}
      </ol>
    </div>
  )
}
