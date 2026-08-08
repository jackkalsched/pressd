import { useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { X, Download, Loader2, Star } from 'lucide-react'
import html2canvas from 'html2canvas'
import { fetchAlbums } from '../api'
import { BANG_THRESHOLD, SKIP_THRESHOLD, pickTopSong, songScoreColor } from '../types'
import type { Album } from '../types'
import { useUser } from '../context/UserContext'

const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:8000'

// palette (mirrors the app's warm cream + forest-green system)
const INK = '#1c1917'
const GREEN = '#2d6a4f'
const CORAL = '#b0402f'
const WARM = '#8a7f72'
const WARM2 = '#a8998a'
const FAINT = '#c2b8ad'

const CARD_W = 1080
const CARD_H = 1350
const DIST_BINS = 22

// Replicates AlbumDetail's page background from the album's accent colour
function accentGradient(hsl: string | null): string {
  const h = hsl?.match(/hsl\((\d+)/)?.[1]
  if (!h) return 'linear-gradient(to bottom, #f3efe8 0%, #faf8f5 55%)'
  return `linear-gradient(160deg, hsl(${h}, 42%, 86%) 0%, hsl(${h}, 30%, 92%) 32%, #faf8f5 68%)`
}

function useAlbumColor(album: string | null, artist: string | null) {
  const { data } = useQuery({
    queryKey: ['album-color', album, artist],
    queryFn: async () => {
      const res = await fetch(`${BASE}/util/album-color?album=${encodeURIComponent(album!)}&artist=${encodeURIComponent(artist!)}`)
      return (await res.json()) as { color: string | null; color2: string | null }
    },
    enabled: !!album && !!artist,
    staleTime: 60 * 60 * 1000,
  })
  return data?.color ?? null
}

function pillNeutral(): React.CSSProperties {
  return { font: "700 17px 'DM Sans', sans-serif", color: '#4a423a', background: 'rgba(255,255,255,.6)', border: '1px solid #e6ded2', borderRadius: 99, padding: '9px 18px' }
}

export default function ShareCardModal({ album, onClose }: { album: Album; onClose: () => void }) {
  const { activeUser } = useUser()
  const userId = activeUser?.id ?? 0
  const cardRef = useRef<HTMLDivElement>(null)
  const [downloading, setDownloading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const accent = useAlbumColor(album.albumName, album.artist)
  const { data: ratedAlbums = [] } = useQuery({
    queryKey: ['albums', 'rated', userId],
    queryFn: () => fetchAlbums({ status: 'rated', userId }),
    enabled: userId > 0,
  })

  const stats = useMemo(() => {
    const rated = album.songs.filter((s) => s.score !== null)
    const bangs = rated.filter((s) => s.score! >= BANG_THRESHOLD)
    const skips = rated.filter((s) => s.score! < SKIP_THRESHOLD)
    const mids = rated.length - bangs.length - skips.length
    const pct = (n: number) => (rated.length ? Math.round((n / rated.length) * 100) : 0)
    const sortedByScore = [...rated].sort((a, b) => b.score! - a.score!)
    // The rater's tie-break when several tracks shared the top score, so the
    // web card names the same favourite the app does.
    const favorite = pickTopSong(album)
    const least = sortedByScore.length > 1 ? sortedByScore[sortedByScore.length - 1] : null

    // ranking + distribution across the user's rated albums
    const scores = ratedAlbums.map((a) => a.score).filter((s): s is number => s !== null)
    const total = scores.length || 1
    const rank = album.score !== null ? 1 + scores.filter((s) => s > album.score!).length : total
    const tercile = rank <= total / 3 ? 'top' : rank <= (2 * total) / 3 ? 'middle' : 'bottom'
    const bins = Array.from({ length: DIST_BINS }, () => 0)
    for (const s of scores) {
      const idx = Math.min(DIST_BINS - 1, Math.max(0, Math.round(((s - 1) / 9) * (DIST_BINS - 1))))
      bins[idx] += 1
    }
    const maxBin = Math.max(1, ...bins)
    const markerBin = album.score !== null
      ? Math.min(DIST_BINS - 1, Math.max(0, Math.round(((album.score - 1) / 9) * (DIST_BINS - 1))))
      : -1

    return {
      ratedCount: rated.length,
      bangCount: bangs.length, skipCount: skips.length, midCount: mids,
      bangPct: pct(bangs.length), skipPct: pct(skips.length), midPct: pct(mids),
      favorite, least, rank, total, tercile,
      noSkips: rated.length > 0 && skips.length === 0,
      bins, maxBin, markerBin,
    }
  }, [album, ratedAlbums])

  const isLP = album.songs.length > 6
  const factors = [
    { label: 'Theme', value: album.theme },
    { label: 'Replay', value: album.replayValue },
    { label: 'Production', value: album.production },
    { label: 'Distinct', value: album.distinctness },
  ]
  const showFactors = isLP && factors.some((f) => f.value !== null)
  const scoreColor = album.score !== null ? songScoreColor(album.score) : GREEN
  const dateStr = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

  const scale = 0.36

  async function download() {
    if (!cardRef.current) return
    setDownloading(true)
    setError(null)
    try {
      const canvas = await html2canvas(cardRef.current, {
        useCORS: true, backgroundColor: null, scale: 1, logging: false, width: CARD_W, height: CARD_H,
      })
      const link = document.createElement('a')
      link.download = `pressd-${album.albumName.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.png`
      link.href = canvas.toDataURL('image/png')
      link.click()
    } catch {
      setError('Could not render the image — the album art host may be blocking it.')
    } finally {
      setDownloading(false)
    }
  }

  const tercileLabel = stats.tercile === 'top' ? 'Top third of your ratings'
    : stats.tercile === 'middle' ? 'Middle of your ratings'
      : 'Bottom third of your ratings'
  const tercileStyle: React.CSSProperties = stats.tercile === 'bottom'
    ? { ...pillNeutral(), color: CORAL, background: 'rgba(176,64,47,.10)', border: '1px solid rgba(176,64,47,.3)' }
    : stats.tercile === 'top'
      ? { ...pillNeutral(), color: GREEN, background: 'rgba(45,106,79,.10)', border: '1px solid rgba(45,106,79,.32)' }
      : pillNeutral()

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-xl border border-[#e6ded2] p-5 flex flex-col items-center max-h-[94vh]">
        <div className="w-full flex items-center justify-between mb-4">
          <h2 className="text-[#1c1917] font-semibold text-[15px]">Share card</h2>
          <button onClick={onClose} className="text-[#aaa] hover:text-[#555] transition-colors"><X size={18} /></button>
        </div>

        {/* scaled preview — the inner card is captured at full 1080×1350 */}
        <div style={{ width: CARD_W * scale, height: CARD_H * scale, overflow: 'hidden', borderRadius: 16, boxShadow: '0 18px 44px -22px rgba(60,45,30,.5)' }}>
          <div style={{ transform: `scale(${scale})`, transformOrigin: 'top left' }}>
            <div
              ref={cardRef}
              style={{
                position: 'relative', width: CARD_W, height: CARD_H, overflow: 'hidden',
                background: accentGradient(accent), color: INK,
                display: 'flex', flexDirection: 'column', padding: '52px 70px 44px',
                fontFamily: "'DM Sans', system-ui, sans-serif",
              }}
            >
              {/* faint album-art watermark (like the album page). The image is
                  sized to bleed past every card edge, so overflow:hidden clips
                  it and no square outline is ever visible; the radial gradient
                  then dissolves it into the cream, leaving a soft top-right bloom. */}
              {album.albumArtUrl && (
                <>
                  <img
                    src={album.albumArtUrl}
                    alt=""
                    crossOrigin="anonymous"
                    style={{
                      position: 'absolute', top: -120, right: -140, width: 1320, height: 1560, objectFit: 'cover',
                      opacity: 0.2, filter: 'blur(2px)', pointerEvents: 'none',
                      // Dissolve the art's own alpha radially from the top-right so it
                      // fades to nothing well before any square edge can show.
                      WebkitMaskImage: 'radial-gradient(66% 58% at 100% 0%, #000 0%, rgba(0,0,0,.5) 46%, transparent 74%)',
                      maskImage: 'radial-gradient(66% 58% at 100% 0%, #000 0%, rgba(0,0,0,.5) 46%, transparent 74%)',
                    }}
                  />
                  {/* Cream wash anchored to the card's top-right corner — reinforces
                      the bloom (and covers renderers that ignore mask-image). */}
                  <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(80% 70% at 100% 0%, transparent 0%, rgba(250,248,245,.3) 40%, rgba(250,248,245,.76) 64%, #faf8f5 84%)', pointerEvents: 'none' }} />
                </>
              )}

              {/* header */}
              <div style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 13 }}>
                  <img src="/logo.png" alt="" style={{ height: 44, width: 'auto', display: 'block' }} />
                  <span style={{ font: "800 30px 'Plus Jakarta Sans', sans-serif", letterSpacing: '-.02em', color: INK }}>Press&rsquo;d</span>
                </div>
                <span style={{ font: "600 17px 'DM Sans'", letterSpacing: '.14em', textTransform: 'uppercase', color: WARM }}>{dateStr}</span>
              </div>

              {/* album */}
              <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 26, marginTop: 30 }}>
                <div style={{ width: 132, height: 132, flexShrink: 0, borderRadius: 20, overflow: 'hidden', boxShadow: '0 20px 44px -18px rgba(60,45,30,.5)', border: '1px solid #e6ded2', background: '#ece6dc' }}>
                  {album.albumArtUrl
                    ? <img src={album.albumArtUrl} alt="" crossOrigin="anonymous" style={{ width: 132, height: 132, objectFit: 'cover', display: 'block' }} />
                    : <div style={{ width: 132, height: 132, display: 'flex', alignItems: 'center', justifyContent: 'center', color: WARM2, font: "700 48px 'Playfair Display', serif" }}>{album.albumName[0]}</div>}
                </div>
                <div style={{ minWidth: 0 }}>
                  <h1 style={{ margin: 0, font: "800 54px/1 'Playfair Display', serif", letterSpacing: '-.01em', color: INK }}>{album.albumName}</h1>
                  <p style={{ margin: '11px 0 0', font: "500 22px 'DM Sans'", color: WARM }}>{[album.artist, ...album.extraArtists].join(', ')}{album.year ? ` · ${album.year}` : ''}</p>
                  {album.genre && (
                    <span style={{ display: 'inline-block', marginTop: 11, font: "700 13px 'DM Sans'", letterSpacing: '.16em', textTransform: 'uppercase', color: GREEN, border: '1.5px solid rgba(45,106,79,.4)', borderRadius: 99, padding: '5px 13px' }}>{album.genre}</span>
                  )}
                </div>
              </div>

              {/* final score */}
              <div style={{ position: 'relative', textAlign: 'center', marginTop: 22 }}>
                <p style={{ margin: 0, font: "700 15px 'DM Sans'", letterSpacing: '.32em', textTransform: 'uppercase', color: WARM }}>Final Score</p>
                <div style={{ margin: '2px 0 0', font: "800 148px/0.86 'Playfair Display', serif", letterSpacing: '-.02em', color: scoreColor }}>
                  {album.score !== null ? album.score.toFixed(2) : '—'}
                  <span style={{ font: "600 40px 'Plus Jakarta Sans'", color: WARM2 }}> /10</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'center', flexWrap: 'wrap', gap: 12, marginTop: 28 }}>
                  <span style={pillNeutral()}>Ranked #{stats.rank} of {stats.total}</span>
                  <span style={tercileStyle}>{tercileLabel}</span>
                  {stats.noSkips && (
                    <span style={{ ...pillNeutral(), color: '#fff', background: GREEN, border: '1px solid ' + GREEN, letterSpacing: '.06em' }}>NO SKIPS</span>
                  )}
                </div>
              </div>

              {/* distribution */}
              <div style={{ position: 'relative', marginTop: 24 }}>
                <div style={{ display: 'flex', alignItems: 'flex-end', gap: 5, height: 64 }}>
                  {stats.bins.map((c, i) => {
                    const active = i === stats.markerBin
                    return (
                      <div key={i} style={{
                        flex: '1 1 0', height: Math.max(4, (c / stats.maxBin) * 64), borderRadius: '4px 4px 2px 2px',
                        background: active ? GREEN : 'rgba(120,100,80,.18)',
                        boxShadow: active ? '0 0 16px rgba(45,106,79,.5)' : 'none',
                      }} />
                    )
                  })}
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 11, font: "600 13px 'DM Sans'", letterSpacing: '.1em', color: FAINT }}>
                  <span>SCORE DISTRIBUTION</span><span>ALL YOUR RATED ALBUMS</span>
                </div>
              </div>

              {/* bang vs skip */}
              <div style={{ position: 'relative', marginTop: 26 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', alignItems: 'center', gap: 18 }}>
                  <div style={{ background: 'rgba(45,106,79,.10)', border: '1.5px solid rgba(45,106,79,.4)', borderRadius: 22, padding: '18px 22px' }}>
                    <div style={{ font: "800 58px/0.9 'Playfair Display', serif", color: GREEN }}>{stats.bangPct}%</div>
                    <p style={{ margin: '9px 0 0', font: "800 17px 'Plus Jakarta Sans'", letterSpacing: '.14em', textTransform: 'uppercase', color: INK }}>Bangs</p>
                    <p style={{ margin: '4px 0 0', font: "500 15px 'DM Sans'", color: WARM }}>{stats.bangCount} {stats.bangCount === 1 ? 'song' : 'songs'} · 8.0+</p>
                  </div>
                  <span style={{ font: "700 20px 'Playfair Display', serif", color: WARM2 }}>vs</span>
                  <div style={{ background: 'rgba(176,64,47,.10)', border: '1.5px solid rgba(176,64,47,.4)', borderRadius: 22, padding: '18px 22px', textAlign: 'right' }}>
                    <div style={{ font: "800 58px/0.9 'Playfair Display', serif", color: CORAL }}>{stats.skipPct}%</div>
                    <p style={{ margin: '9px 0 0', font: "800 17px 'Plus Jakarta Sans'", letterSpacing: '.14em', textTransform: 'uppercase', color: INK }}>Skips</p>
                    <p style={{ margin: '4px 0 0', font: "500 15px 'DM Sans'", color: WARM }}>{stats.skipCount} {stats.skipCount === 1 ? 'song' : 'songs'} · under 6.5</p>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 5, marginTop: 14, height: 22 }}>
                  <div style={{ width: `${stats.bangPct}%`, background: GREEN, borderRadius: 99 }} />
                  <div style={{ width: `${stats.midPct}%`, background: 'rgba(120,100,80,.2)', borderRadius: 99 }} />
                  <div style={{ width: `${stats.skipPct}%`, background: CORAL, borderRadius: 99 }} />
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 9, font: "600 13px 'DM Sans'", letterSpacing: '.08em', color: FAINT }}>
                  <span>{stats.bangCount} {stats.bangCount === 1 ? 'BANG' : 'BANGS'}</span>
                  <span>{stats.midCount} MIDS</span>
                  <span>{stats.skipCount} {stats.skipCount === 1 ? 'SKIP' : 'SKIPS'}</span>
                </div>
              </div>

              {/* favorite / least */}
              {stats.favorite && (
                <div style={{ position: 'relative', display: 'grid', gridTemplateColumns: stats.least ? '1fr 1fr' : '1fr', gap: 18, marginTop: 22 }}>
                  <div style={{ background: 'rgba(255,255,255,.5)', border: '1px solid rgba(45,106,79,.3)', borderRadius: 22, padding: '18px 22px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Star size={18} fill={GREEN} strokeWidth={0} /><span style={{ font: "800 14px 'Plus Jakarta Sans'", letterSpacing: '.16em', textTransform: 'uppercase', color: GREEN }}>Favorite</span></div>
                    <p style={{ margin: '11px 0 0', font: "700 32px/1 'Playfair Display', serif", color: INK, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{stats.favorite.title}</p>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 7, marginTop: 9 }}><span style={{ font: "800 40px 'Playfair Display', serif", color: songScoreColor(stats.favorite.score!) }}>{stats.favorite.score!.toFixed(1)}</span><span style={{ font: "600 17px 'DM Sans'", color: WARM2 }}>/10</span></div>
                  </div>
                  {stats.least && (
                    <div style={{ background: 'rgba(255,255,255,.5)', border: '1px solid rgba(176,64,47,.3)', borderRadius: 22, padding: '18px 22px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><span style={{ fontSize: 18, color: CORAL }}>▽</span><span style={{ font: "800 14px 'Plus Jakarta Sans'", letterSpacing: '.16em', textTransform: 'uppercase', color: CORAL }}>Least Favorite</span></div>
                      <p style={{ margin: '11px 0 0', font: "700 32px/1 'Playfair Display', serif", color: INK, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{stats.least.title}</p>
                      <div style={{ display: 'flex', alignItems: 'baseline', gap: 7, marginTop: 9 }}><span style={{ font: "800 40px 'Playfair Display', serif", color: songScoreColor(stats.least.score!) }}>{stats.least.score!.toFixed(1)}</span><span style={{ font: "600 17px 'DM Sans'", color: WARM2 }}>/10</span></div>
                    </div>
                  )}
                </div>
              )}

              {/* external factors */}
              {showFactors && (
                <div style={{ position: 'relative', display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 14, marginTop: 26 }}>
                  {factors.map((f) => (
                    <div key={f.label} style={{ textAlign: 'center', background: 'rgba(255,255,255,.5)', border: '1px solid #e6ded2', borderRadius: 18, padding: '16px 8px' }}>
                      <div style={{ font: "800 34px 'Playfair Display', serif", color: INK }}>{f.value !== null ? Math.round(f.value) : '—'}</div>
                      <p style={{ margin: '6px 0 0', font: "600 12px 'DM Sans'", letterSpacing: '.1em', textTransform: 'uppercase', color: WARM }}>{f.label}</p>
                    </div>
                  ))}
                </div>
              )}

              {/* footer */}
              <div style={{ position: 'relative', marginTop: 'auto', paddingTop: 24, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 11, borderTop: '1px solid #e6ded2' }}>
                <span style={{ font: "500 19px 'DM Sans'", color: WARM }}>Rate your albums on</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                  <img src="/logo.png" alt="" style={{ height: 32, width: 'auto', display: 'block' }} />
                  <span style={{ font: "800 22px 'Plus Jakarta Sans', sans-serif", letterSpacing: '-.02em', color: INK }}>Press&rsquo;d</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {error && <p className="text-[#c0392b] text-xs mt-3 max-w-[360px] text-center">{error}</p>}
        <button
          onClick={download}
          disabled={downloading}
          className="mt-4 w-full py-2.5 rounded-xl text-sm font-semibold bg-[#2d6a4f] hover:bg-[#245c43] text-white transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
        >
          {downloading ? <><Loader2 size={15} className="animate-spin" /> Rendering…</> : <><Download size={15} /> Download image</>}
        </button>
      </div>
    </div>
  )
}
