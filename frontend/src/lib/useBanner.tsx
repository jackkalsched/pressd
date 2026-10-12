// Setting and removing your banner, for the two places that do it: Settings,
// and the Edit banner button on your own profile. One copy, so both frame and
// upload the same way.
//
// A picked picture that's already the banner's shape (24:5, lib/banner.ts)
// goes straight up; anything else opens the cropper, so the person frames it
// rather than the server's centre crop. The new URL is written into the
// ['profile', id] query the profile page reads, so it shows at once.
import { useState, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { deleteBanner, uploadBanner, type Profile } from '../api'
import BannerCropper from '../components/BannerCropper'
import { fitsBanner, loadImage, renderBanner } from './banner'

export function useBanner(userId: number | undefined): {
  busy: boolean
  error: string | null
  /** Hand it an <input type="file"> change. */
  onFile: (e: React.ChangeEvent<HTMLInputElement>) => void
  remove: () => Promise<void>
  /** Render this somewhere; it's the cropper while one is open, else null. */
  cropper: ReactNode
} {
  const qc = useQueryClient()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [cropImage, setCropImage] = useState<HTMLImageElement | null>(null)

  function setUrl(url: string | null) {
    qc.setQueryData<Profile>(['profile', userId], (old) => (old ? { ...old, banner_url: url } : old))
  }

  async function upload(base64: string): Promise<boolean> {
    if (userId == null) return false
    setBusy(true)
    setError(null)
    try {
      const { banner_url } = await uploadBanner(userId, { base64, contentType: 'image/jpeg' })
      setUrl(banner_url)
      return true
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not set your banner')
      return false
    } finally {
      setBusy(false)
    }
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = '' // the same file can be picked again
    if (!file || userId == null) return
    if (!file.type.startsWith('image/')) { setError('Please choose an image file'); return }
    setError(null)
    try {
      const img = await loadImage(file)
      if (fitsBanner(img)) await upload(renderBanner(img))
      else setCropImage(img)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not read that picture')
    }
  }

  async function remove() {
    if (userId == null) return
    setBusy(true)
    setError(null)
    try {
      await deleteBanner(userId)
      setUrl(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not remove your banner')
    } finally {
      setBusy(false)
    }
  }

  const cropper = cropImage ? (
    <BannerCropper
      image={cropImage}
      saving={busy}
      onCancel={() => setCropImage(null)}
      onSave={async (base64) => { if (await upload(base64)) setCropImage(null) }}
    />
  ) : null

  return { busy, error, onFile, remove, cropper }
}
