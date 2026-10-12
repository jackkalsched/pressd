// A banner's stored shape, and the canvas work around it, for the Settings
// dialog and its cropper (components/BannerCropper.tsx). Stored 24:5 at
// 1920×400, the profile strip's shape — backend/routers/users.py, BANNER_SIZE.
export const BANNER_W = 1920
export const BANNER_H = 400
const ASPECT = BANNER_W / BANNER_H

/** Load a picked file as an image. */
export function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('That file isn’t an image we can read'))
    img.src = URL.createObjectURL(file)
  })
}

/** Already the banner's shape — within a pixel or so — so there's nothing to frame. */
export function fitsBanner(img: HTMLImageElement): boolean {
  return Math.abs(img.naturalWidth / img.naturalHeight - ASPECT) < 0.01
}

/** Draw a region of `img` at the stored size, as bare base64 JPEG. */
export function renderBanner(img: HTMLImageElement, sx = 0, sy = 0, sw = img.naturalWidth, sh = img.naturalHeight): string {
  const canvas = document.createElement('canvas')
  canvas.width = BANNER_W
  canvas.height = BANNER_H
  canvas.getContext('2d')!.drawImage(img, sx, sy, sw, sh, 0, 0, BANNER_W, BANNER_H)
  return canvas.toDataURL('image/jpeg', 0.85).split(',')[1]
}
