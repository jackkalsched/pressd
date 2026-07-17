// Ambient album-art wash behind an album's pages, ported from the desktop
// AlbumDetail: the cover bleeds from the top-right (blurred, faint) under a
// gradient veil tinted by the album's own dominant hue, fading into the app
// background so the page stays readable. The art coloring its own page.
import { useMemo } from 'react'
import { Dimensions, Image, StyleSheet, View } from 'react-native'
import { LinearGradient } from 'expo-linear-gradient'
import { useQuery } from '@tanstack/react-query'
import { fetchAlbumColor } from '../lib/api'
import { colors } from '../theme/tokens'

const { width: W } = Dimensions.get('window')

function hueOf(hsl: string | null | undefined): number | null {
  const m = hsl?.match(/hsl\((\d+)/)
  return m ? Number(m[1]) : null
}

export default function AlbumBackdrop({
  albumArtUrl,
  album,
  artist,
}: {
  albumArtUrl?: string | null
  album: string
  artist: string
}) {
  const { data } = useQuery({
    queryKey: ['album-color', album, artist],
    queryFn: () => fetchAlbumColor(album, artist),
    enabled: !!album && !!artist,
    staleTime: Infinity,
  })
  const hue = hueOf(data?.color)

  // Veil tints the page in the album's hue and fades the art into the app bg.
  const veil = useMemo<[string, string, string, string]>(() => {
    if (hue == null) return ['rgba(249,248,246,0.5)', 'rgba(249,248,246,0.9)', colors.bg, colors.bg]
    return [
      `hsla(${hue}, 45%, 88%, 0.34)`,
      `hsla(${hue}, 30%, 92%, 0.72)`,
      'rgba(249,248,246,0.97)',
      colors.bg,
    ]
  }, [hue])

  return (
    <View style={styles.fill} pointerEvents="none">
      {albumArtUrl ? (
        <Image source={{ uri: albumArtUrl }} style={styles.art} blurRadius={14} resizeMode="cover" />
      ) : null}
      <LinearGradient colors={veil} locations={[0, 0.32, 0.62, 1]} style={styles.fill} />
    </View>
  )
}

const styles = StyleSheet.create({
  fill: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  art: {
    position: 'absolute',
    top: -W * 0.1,
    right: -W * 0.18,
    width: W * 0.85,
    height: W * 0.85,
    opacity: 0.4,
  },
})
