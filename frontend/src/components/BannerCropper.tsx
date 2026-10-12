// Framing a banner. A banner is stored 24:5 at 1920×400 (backend/routers/users.py,
// BANNER_SIZE) and shown sharp across the top of the profile, so a picture of
// any other shape has to lose something — this lets the person choose what,
// instead of the server's centre crop choosing for them. Drag to move, the
// slider (or the wheel) to zoom; the frame is exactly what will be saved.
//
// Mobile does the same with the system picker's crop (`aspect: [24, 5]`).
import { useEffect, useRef, useState } from 'react'
import { Loader2, X } from 'lucide-react'
import { BANNER_H, BANNER_W, renderBanner } from '../lib/banner'

const ASPECT = BANNER_W / BANNER_H

const MAX_ZOOM = 4

export default function BannerCropper({ image, saving, onCancel, onSave }: {
  image: HTMLImageElement
  saving: boolean
  onCancel: () => void
  onSave: (base64: string) => void
}) {
  const frameRef = useRef<HTMLDivElement>(null)
  const [frameW, setFrameW] = useState(0)
  const [zoom, setZoom] = useState(1)
  // The picture's top-left corner, relative to the frame's, in frame pixels.
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)
  const drag = useRef<{ startX: number; startY: number; x: number; y: number } | null>(null)

  useEffect(() => {
    const el = frameRef.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setFrameW(e.contentRect.width))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const frameH = frameW / ASPECT
  const iw = image.naturalWidth
  const ih = image.naturalHeight
  // At zoom 1 the picture just covers the frame, the way the saved banner will.
  const scale = frameW ? Math.max(frameW / iw, frameH / ih) * zoom : 0
  const dw = iw * scale
  const dh = ih * scale

  const clamp = (x: number, y: number) => ({
    x: Math.min(0, Math.max(frameW - dw, x)),
    y: Math.min(0, Math.max(frameH - dh, y)),
  })
  // Centred until moved; re-clamped on every render so a zoom-out or a resize
  // never leaves a gap at an edge.
  const at = clamp(pos?.x ?? (frameW - dw) / 2, pos?.y ?? (frameH - dh) / 2)

  function zoomTo(next: number) {
    const z = Math.min(MAX_ZOOM, Math.max(1, next))
    // Keep the point under the frame's centre where it is.
    const k = z / zoom
    const cx = frameW / 2
    const cy = frameH / 2
    setPos({ x: cx - (cx - at.x) * k, y: cy - (cy - at.y) * k })
    setZoom(z)
  }

  function save() {
    if (!scale) return
    onSave(renderBanner(image, -at.x / scale, -at.y / scale, frameW / scale, frameH / scale))
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm fade-in" onClick={saving ? undefined : onCancel} />
      <div role="dialog" aria-modal="true" aria-labelledby="crop-title" className="relative w-full max-w-2xl rounded-3xl bg-[#f9f8f6] p-6 shadow-xl pop-in">
        <div className="mb-4 flex items-center justify-between">
          <h2 id="crop-title" className="font-display m-0 text-[24px] font-bold text-[#1c1917]">Frame your banner</h2>
          <button onClick={onCancel} disabled={saving} aria-label="Cancel" className="text-[#a8998a] hover:text-[#57534e]">
            <X size={18} />
          </button>
        </div>

        <div
          ref={frameRef}
          className="relative w-full cursor-grab touch-none select-none overflow-hidden rounded-2xl bg-[#1c1917] active:cursor-grabbing"
          style={{ aspectRatio: `${BANNER_W} / ${BANNER_H}` }}
          onPointerDown={(e) => {
            ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
            drag.current = { startX: e.clientX, startY: e.clientY, x: at.x, y: at.y }
          }}
          onPointerMove={(e) => {
            const d = drag.current
            if (!d) return
            setPos(clamp(d.x + e.clientX - d.startX, d.y + e.clientY - d.startY))
          }}
          onPointerUp={() => { drag.current = null }}
          onPointerCancel={() => { drag.current = null }}
          onWheel={(e) => zoomTo(zoom * (e.deltaY < 0 ? 1.08 : 1 / 1.08))}
        >
          {scale > 0 && (
            <img
              src={image.src}
              alt=""
              draggable={false}
              className="pointer-events-none absolute max-w-none"
              style={{ left: at.x, top: at.y, width: dw, height: dh }}
            />
          )}
          {/* Thirds, to frame against. */}
          <div className="pointer-events-none absolute inset-0 grid grid-cols-3 grid-rows-3">
            {Array.from({ length: 9 }, (_, i) => <div key={i} className="border border-white/15" />)}
          </div>
        </div>

        <div className="mt-5 flex items-center gap-3">
          <span className="text-[12px] font-medium text-[#8a7f72]">Zoom</span>
          <input
            type="range"
            min={1}
            max={MAX_ZOOM}
            step={0.01}
            value={zoom}
            onChange={(e) => zoomTo(Number(e.target.value))}
            className="flex-1 accent-[#2d6a4f]"
            aria-label="Zoom"
          />
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <button
            onClick={onCancel}
            disabled={saving}
            className="h-11 rounded-full px-5 text-[14.5px] font-semibold text-[#78716c] hover:bg-[#efebe5]"
          >
            Cancel
          </button>
          <button
            onClick={save}
            disabled={saving || !scale}
            className="flex h-11 items-center gap-2 rounded-full bg-[#2d6a4f] px-6 text-[14.5px] font-semibold text-white hover:bg-[#245c43] disabled:opacity-60"
          >
            {saving && <Loader2 size={15} className="animate-spin" />}
            Save banner
          </button>
        </div>
      </div>
    </div>
  )
}
