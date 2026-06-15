import { useRef, useState } from 'react'
import html2canvas from 'html2canvas'
import { Download, Share2, X, Loader2, MessageCircle } from 'lucide-react'
import type { AlbumReportData, ArtistStatsSnapshot } from '../api'
import { songScoreColor } from '../types'

const FONT = "'DM Sans', system-ui, sans-serif"

function ordinal(n: number): string {
  if (n >= 11 && n <= 13) return `${n}th`
  switch (n % 10) {
    case 1: return `${n}st`
    case 2: return `${n}nd`
    case 3: return `${n}rd`
    default: return `${n}th`
  }
}

function fmt(n: number): string {
  return n % 1 === 0 ? `${n}` : n.toFixed(1)
}

// ── Horizontal lollipop chart for track scores ────────────────────────────────

function TrackList({ songs }: { songs: AlbumReportData['songs'] }) {
  const W = 540
  const NAME_W = 162
  const BAR_X = NAME_W + 6
  const SCORE_END = W
  const SCORE_W = 30
  const BAR_W = SCORE_END - SCORE_W - BAR_X - 4
  const ROW_H = 22
  const H = songs.length * ROW_H + 18

  const trunc = (s: string, n: number) => s.length > n ? s.slice(0, n - 1) + '…' : s

  return (
    <svg width={W} height={H} style={{ display: 'block', overflow: 'visible' }}>
      {/* Axis ticks at 0, 5, 10 */}
      {[0, 5, 10].map((v) => {
        const x = BAR_X + (v / 10) * BAR_W
        return (
          <g key={v}>
            <line x1={x} y1={0} x2={x} y2={H - 14} stroke="#f0f0f0" strokeWidth={1} />
            <text x={x} y={H - 2} textAnchor="middle" fontSize={9} fill="#c0c0c0" fontFamily={FONT}>{v}</text>
          </g>
        )
      })}
      {/* Subtle tick at 8 (bang threshold) */}
      <line
        x1={BAR_X + 0.8 * BAR_W} y1={0}
        x2={BAR_X + 0.8 * BAR_W} y2={H - 14}
        stroke="#e8f5e9" strokeWidth={1}
      />

      {songs.map((song, i) => {
        const cy = i * ROW_H + ROW_H / 2 + 2
        const score = song.score

        if (score === null) {
          return (
            <text key={i} x={0} y={cy + 4} fontSize={11} fill="#aaa" fontFamily={FONT}>
              {trunc(song.title, 24)}
            </text>
          )
        }

        const dotX = BAR_X + (score / 10) * BAR_W
        const color = songScoreColor(score)
        const r = song.is_bang ? 5 : 3.5

        return (
          <g key={i}>
            <text
              x={0} y={cy + 4}
              fontSize={11}
              fill={song.is_bang ? '#111' : '#444'}
              fontFamily={FONT}
              fontWeight={song.is_bang ? '600' : '400'}
            >
              {trunc(song.title, 24)}
            </text>
            {/* Track line */}
            <line x1={BAR_X} y1={cy} x2={dotX} y2={cy} stroke={color} strokeWidth={1.5} opacity={0.45} />
            {/* Dot */}
            <circle cx={dotX} cy={cy} r={r} fill={color} />
            {/* Score */}
            <text
              x={SCORE_END - SCORE_W + 2} y={cy + 4}
              fontSize={11} fontWeight="700"
              fill={color} fontFamily={FONT}
            >
              {fmt(score)}
            </text>
          </g>
        )
      })}
    </svg>
  )
}

// ── Score distribution histogram ──────────────────────────────────────────────

function DistributionChart({ allScores, thisScore }: { allScores: number[]; thisScore: number }) {
  const W = 540
  const H = 82
  const padL = 6
  const padR = 6
  const padTop = 20
  const padBot = 14

  const BIN = 0.25
  const MAX_SCORE = 10
  const numBins = Math.round(MAX_SCORE / BIN)
  const bins = Array(numBins).fill(0)
  for (const s of allScores) {
    const idx = Math.min(Math.floor(s / BIN), numBins - 1)
    bins[idx]++
  }
  const maxCount = Math.max(...bins, 1)
  const innerW = W - padL - padR
  const innerH = H - padTop - padBot
  const bW = innerW / numBins
  const thisBin = Math.min(Math.floor(thisScore / BIN), numBins - 1)
  const markerX = padL + thisBin * bW + bW / 2

  return (
    <svg width={W} height={H} style={{ display: 'block' }}>
      <line x1={padL} y1={padTop + innerH} x2={W - padR} y2={padTop + innerH} stroke="#e5e7eb" strokeWidth={1} />
      {bins.map((count, i) => {
        const barH = count > 0 ? Math.max((count / maxCount) * innerH, 2) : 0
        const x = padL + i * bW
        const y = padTop + innerH - barH
        return (
          <rect
            key={i}
            x={x + 0.5} y={y}
            width={Math.max(bW - 1, 1)} height={barH}
            fill={i === thisBin ? '#2d6a4f' : '#d1d5db'}
            rx={1}
          />
        )
      })}
      {/* Marker arrow */}
      <polygon
        points={`${markerX},${padTop - 1} ${markerX - 4},${padTop - 8} ${markerX + 4},${padTop - 8}`}
        fill="#2d6a4f"
      />
      <text x={markerX} y={padTop - 10} textAnchor="middle" fontSize={9} fill="#2d6a4f" fontFamily={FONT} fontWeight="700">
        {thisScore.toFixed(2)}
      </text>
      {/* X axis labels */}
      {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((v) => (
        <text key={v} x={padL + (v / MAX_SCORE) * innerW} y={H - 1} textAnchor="middle" fontSize={8} fill="#aaa" fontFamily={FONT}>
          {v}
        </text>
      ))}
    </svg>
  )
}

// ── Artist impact table ───────────────────────────────────────────────────────

function PercentileBar({ pct }: { pct: number | null }) {
  if (pct === null) return <span style={{ color: '#aaa', fontSize: 11, fontFamily: FONT }}>—</span>
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <div style={{ width: 72, height: 5, background: '#e5e7eb', borderRadius: 3, overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: '#2d6a4f', borderRadius: 3 }} />
      </div>
      <span style={{ fontSize: 11, fontWeight: 700, color: '#374151', fontFamily: FONT, minWidth: 28 }}>
        {ordinal(pct)}
      </span>
    </div>
  )
}

function ArtistImpact({ after, before }: { after: ArtistStatsSnapshot; before: ArtistStatsSnapshot }) {
  const rows = [
    {
      label: 'Avg Song Score',
      val: after.avg_song_score != null ? after.avg_song_score.toFixed(2) : '—',
      pct: after.percentiles.avg_song_score,
      delta: after.percentiles.avg_song_score != null && before.percentiles.avg_song_score != null
        ? after.percentiles.avg_song_score - before.percentiles.avg_song_score : null,
    },
    {
      label: 'Bang %',
      val: after.bang_pct != null ? `${Math.round(after.bang_pct * 100)}%` : '—',
      pct: after.percentiles.bang_pct,
      delta: after.percentiles.bang_pct != null && before.percentiles.bang_pct != null
        ? after.percentiles.bang_pct - before.percentiles.bang_pct : null,
    },
    {
      label: 'Skip %',
      val: after.skip_pct != null ? `${Math.round(after.skip_pct * 100)}%` : '—',
      pct: after.percentiles.skip_pct,
      delta: after.percentiles.skip_pct != null && before.percentiles.skip_pct != null
        ? after.percentiles.skip_pct - before.percentiles.skip_pct : null,
    },
    {
      label: 'wSong+',
      val: after.w_song_plus != null ? after.w_song_plus.toFixed(1) : '—',
      pct: after.percentiles.w_song_plus,
      delta: after.percentiles.w_song_plus != null && before.percentiles.w_song_plus != null
        ? after.percentiles.w_song_plus - before.percentiles.w_song_plus : null,
    },
    {
      label: 'Consistency+',
      val: after.consistency_plus != null ? after.consistency_plus.toFixed(1) : '—',
      pct: after.percentiles.consistency_plus,
      delta: after.percentiles.consistency_plus != null && before.percentiles.consistency_plus != null
        ? after.percentiles.consistency_plus - before.percentiles.consistency_plus : null,
    },
  ]

  return (
    <div style={{ width: '100%' }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 52px 110px 80px', gap: '0 10px', padding: '0 2px 6px' }}>
        {['Metric', 'Value', 'Rank', 'Change'].map((h) => (
          <span key={h} style={{ fontSize: 9, fontWeight: 700, color: '#aaa', textTransform: 'uppercase', letterSpacing: '0.08em', fontFamily: FONT }}>
            {h}
          </span>
        ))}
      </div>
      {rows.map((row) => {
        const d = row.delta != null ? Math.round(row.delta) : null
        const sign = d != null && d > 0 ? '+' : ''
        const deltaColor = d == null || d === 0 ? '#aaa' : d > 0 ? '#16a34a' : '#dc2626'

        return (
          <div
            key={row.label}
            style={{ display: 'grid', gridTemplateColumns: '1fr 52px 110px 80px', gap: '0 10px', padding: '8px 2px', borderTop: '1px solid #f3f4f6', alignItems: 'center' }}
          >
            <span style={{ fontSize: 12, color: '#374151', fontFamily: FONT, fontWeight: 500 }}>{row.label}</span>
            <span style={{ fontSize: 13, fontWeight: 700, color: '#111', fontFamily: FONT }}>{row.val}</span>
            <PercentileBar pct={row.pct} />
            <span style={{ fontSize: 12, fontWeight: 700, fontFamily: FONT, color: deltaColor }}>
              {d != null && d !== 0 ? `${sign}${d} pts` : '—'}
            </span>
          </div>
        )
      })}
    </div>
  )
}

// ── Main report card ──────────────────────────────────────────────────────────

function ReportCard({ data, cardRef }: { data: AlbumReportData; cardRef: React.RefObject<HTMLDivElement | null> }) {
  const { album, songs, bang_count, skip_count, bang_pct, skip_pct, avg_bang_pct, avg_skip_pct,
    album_rank, album_rank_of, all_album_scores, artist_stats_after, artist_stats_before } = data

  const artists = [album.artist, ...album.extra_artists].join(', ')
  const today = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  const hasFactors = album.theme != null || album.replay_value != null || album.production != null || album.distinctness != null

  const sectionLabel: React.CSSProperties = {
    fontSize: 9, fontWeight: 700, color: '#aaa', textTransform: 'uppercase',
    letterSpacing: '0.1em', fontFamily: FONT, marginBottom: 10,
  }
  const divider: React.CSSProperties = {
    borderTop: '1px solid #f0f0f0', margin: '0 20px',
  }

  return (
    <div
      ref={cardRef}
      style={{ width: 580, background: '#fff', fontFamily: FONT, borderRadius: 16, overflow: 'hidden', border: '1px solid #e5e7eb' }}
    >
      {/* Header */}
      <div style={{ background: '#1a3d2b', padding: '11px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ color: '#86efac', fontSize: 11, fontWeight: 800, letterSpacing: '0.18em', textTransform: 'uppercase', fontFamily: FONT }}>
          Press'd
        </span>
        <span style={{ color: '#6b7280', fontSize: 10, fontFamily: FONT }}>{today}</span>
      </div>

      {/* Album hero */}
      <div style={{ padding: '16px 20px 12px', display: 'flex', gap: 14, alignItems: 'center' }}>
        <div style={{ width: 56, height: 56, borderRadius: 8, overflow: 'hidden', background: '#e5e7eb', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, color: '#9ca3af' }}>
          {album.album_art_url
            ? <img src={album.album_art_url} crossOrigin="anonymous" alt={album.album_name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            : album.album_name[0]}
        </div>
        <div style={{ flex: 1, minWidth: 0, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 18, fontWeight: 800, color: '#111', lineHeight: 1.2, fontFamily: FONT, marginBottom: 3 }}>
              {album.album_name}
            </div>
            <div style={{ fontSize: 11, color: '#888', fontFamily: FONT }}>
              {artists}{album.year ? ` · ${album.year}` : ''}{album.genre ? ` · ${album.genre}` : ''}
            </div>
          </div>
          <div style={{ textAlign: 'right', flexShrink: 0 }}>
            <div style={{ fontSize: 26, fontWeight: 800, color: '#2d6a4f', lineHeight: 1, fontFamily: FONT }}>
              {album.score != null ? album.score.toFixed(2) : '—'}
            </div>
            {album_rank != null && (
              <div style={{ fontSize: 10, color: '#bbb', fontFamily: FONT, marginTop: 2 }}>
                #{album_rank} of {album_rank_of}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Bang / Skip row */}
      <div style={{ padding: '0 20px 16px', display: 'flex', gap: 24, alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 5 }}>
          <span style={{ fontSize: 15, fontWeight: 800, color: '#16a34a', fontFamily: FONT }}>
            {Math.round(bang_pct * 100)}%
          </span>
          <span style={{ fontSize: 12, fontWeight: 600, color: '#16a34a', fontFamily: FONT }}>Bangs</span>
          <span style={{ fontSize: 11, color: '#bbb', fontFamily: FONT }}>({bang_count} songs)</span>
          <span style={{ fontSize: 10, color: '#ccc', fontFamily: FONT, marginLeft: 2 }}>
            avg {Math.round(avg_bang_pct * 100)}%
          </span>
        </div>
        <span style={{ color: '#e5e7eb', fontSize: 14 }}>·</span>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 5 }}>
          <span style={{ fontSize: 15, fontWeight: 800, color: '#dc2626', fontFamily: FONT }}>
            {Math.round(skip_pct * 100)}%
          </span>
          <span style={{ fontSize: 12, fontWeight: 600, color: '#dc2626', fontFamily: FONT }}>Skips</span>
          <span style={{ fontSize: 11, color: '#bbb', fontFamily: FONT }}>({skip_count} songs)</span>
          <span style={{ fontSize: 10, color: '#ccc', fontFamily: FONT, marginLeft: 2 }}>
            avg {Math.round(avg_skip_pct * 100)}%
          </span>
        </div>
      </div>

      <div style={divider} />

      {/* Track scores */}
      <div style={{ padding: '14px 20px 10px' }}>
        <div style={sectionLabel}>Track Scores</div>
        <TrackList songs={songs} />
      </div>

      <div style={divider} />

      {/* Score distribution */}
      {all_album_scores.length > 3 && album.score != null && (
        <>
          <div style={{ padding: '14px 20px 10px' }}>
            <div style={sectionLabel}>Score Distribution · All Rated Albums</div>
            <DistributionChart allScores={all_album_scores} thisScore={album.score} />
          </div>
          <div style={divider} />
        </>
      )}

      {/* External factors */}
      {hasFactors && (
        <>
          <div style={{ padding: '14px 20px 10px' }}>
            <div style={sectionLabel}>External Factors</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 24px' }}>
              {[
                { label: 'Theme', val: album.theme },
                { label: 'Replay Value', val: album.replay_value },
                { label: 'Production', val: album.production },
                { label: 'Distinctness', val: album.distinctness },
              ].map(({ label, val }) => (
                <div key={label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '4px 0' }}>
                  <span style={{ fontSize: 12, color: '#777', fontFamily: FONT }}>{label}</span>
                  <span style={{ fontSize: 13, fontWeight: 700, color: val != null ? '#111' : '#ccc', fontFamily: FONT }}>
                    {val != null ? fmt(val) : '—'}
                  </span>
                </div>
              ))}
            </div>
          </div>
          <div style={divider} />
        </>
      )}

      {/* Artist impact */}
      <div style={{ padding: '14px 20px 20px' }}>
        <div style={sectionLabel}>{album.artist} · Artist Impact</div>
        <ArtistImpact after={artist_stats_after} before={artist_stats_before} />
      </div>
    </div>
  )
}

// ── Modal wrapper ─────────────────────────────────────────────────────────────

export default function RatingReport({ data, onClose }: { data: AlbumReportData; onClose: () => void }) {
  const cardRef = useRef<HTMLDivElement>(null)
  const [capturing, setCapturing] = useState(false)

  async function captureCard(): Promise<Blob | null> {
    if (!cardRef.current) return null
    const canvas = await html2canvas(cardRef.current, {
      scale: 2,
      useCORS: true,
      allowTaint: true,
      backgroundColor: '#ffffff',
      logging: false,
    })
    return new Promise((resolve) => canvas.toBlob(resolve, 'image/png', 0.95))
  }

  async function handleShare() {
    setCapturing(true)
    try {
      const blob = await captureCard()
      if (!blob) return
      const fileName = `${data.album.album_name} - Press'd.png`
      const file = new File([blob], fileName, { type: 'image/png' })
      if (typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: fileName })
      } else {
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url; a.download = fileName; a.click()
        URL.revokeObjectURL(url)
      }
    } catch (e) {
      if ((e as Error).name !== 'AbortError') console.error(e)
    } finally {
      setCapturing(false)
    }
  }

  async function handleDownload() {
    setCapturing(true)
    try {
      const blob = await captureCard()
      if (!blob) return
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url; a.download = `${data.album.album_name} - Press'd.png`; a.click()
      URL.revokeObjectURL(url)
    } finally {
      setCapturing(false)
    }
  }

  const btnBase: React.CSSProperties = {
    display: 'flex', alignItems: 'center', gap: 6,
    border: 'none', borderRadius: 8, padding: '8px 16px',
    fontSize: 13, fontWeight: 600, cursor: capturing ? 'not-allowed' : 'pointer',
    opacity: capturing ? 0.6 : 1, fontFamily: FONT,
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)', zIndex: 50, overflowY: 'auto' }}>
      {/* Sticky controls */}
      <div style={{ position: 'sticky', top: 0, zIndex: 10, background: 'rgba(15,15,15,0.85)', backdropFilter: 'blur(8px)', padding: '12px 20px', display: 'flex', justifyContent: 'center' }}>
        <div style={{ width: 580, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={handleShare} disabled={capturing} style={{ ...btnBase, background: '#2d6a4f', color: '#fff' }}>
              {capturing ? <Loader2 size={14} className="animate-spin" /> : <Share2 size={14} />}
              Share / AirDrop
            </button>
            <button onClick={handleDownload} disabled={capturing} style={{ ...btnBase, background: '#f5f5f5', color: '#374151', border: '1px solid #e5e7eb' }}>
              <Download size={14} />
              Save PNG
            </button>
            <button
              onClick={() => {
                const score = data.album.score != null ? `${data.album.score.toFixed(1)}/10` : 'unscored'
                const bang = Math.round(data.bang_pct * 100)
                const skip = Math.round(data.skip_pct * 100)
                const msg = `I just rated "${data.album.album_name}" by ${data.album.artist} — ${score} on Press'd 🎵 (Bang: ${bang}% | Skip: ${skip}%)`
                window.location.href = `sms:?body=${encodeURIComponent(msg)}`
              }}
              style={{ ...btnBase, background: '#f5f5f5', color: '#374151', border: '1px solid #e5e7eb' }}
            >
              <MessageCircle size={14} />
              iMessage
            </button>
          </div>
          <button onClick={onClose} style={{ ...btnBase, background: 'transparent', color: '#fff', border: '1px solid rgba(255,255,255,0.3)', padding: '8px 14px' }}>
            <X size={14} /> Continue
          </button>
        </div>
      </div>

      {/* Card */}
      <div style={{ display: 'flex', justifyContent: 'center', padding: '20px 20px 60px' }}>
        <ReportCard data={data} cardRef={cardRef} />
      </div>
    </div>
  )
}
