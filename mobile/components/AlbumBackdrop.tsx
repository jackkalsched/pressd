// Ambient album-art wash behind an album's pages, ported from the desktop
// AlbumDetail: the cover bleeds from the top-right (blurred, faint) and is
// dissolved by a radial vignette so its rectangular edges melt into the page
// while the center of the art stays faintly visible. A hue-tinted linear veil
// on top fades the whole thing into the app background so the page reads.
import { useMemo } from 'react'
import { Dimensions, Image, StyleSheet, View } from 'react-native'
import { LinearGradient } from 'expo-linear-gradient'
import Svg, { Defs, RadialGradient, Rect, Stop } from 'react-native-svg'
import { useQuery } from '@tanstack/react-query'
import { fetchAlbumColor } from '../lib/api'
import { colors } from '../theme/tokens'

const { width: W } = Dimensions.get('window')

// Blurred cover bleed, slightly larger than before and centered up in the
// top-right. Image and vignette share this frame so the radial fade lines up.
const ART = W * 1.06
const ART_TOP = -W * 0.16
const ART_RIGHT = -W * 0.22

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
        <>
          <Image
            source={{ uri: albumArtUrl }}
            style={[styles.artPos, styles.artImage]}
            blurRadius={20}
            resizeMode="cover"
          />
          {/* Radial fade: transparent over the art's center, ramping to solid
              app-bg by the edges, so the square dissolves into the page. */}
          <Svg width={ART} height={ART} style={styles.artPos}>
            <Defs>
              <RadialGradient id="albumFade" cx="50%" cy="50%" r="50%">
                <Stop offset="0" stopColor={colors.bg} stopOpacity={0} />
                <Stop offset="0.5" stopColor={colors.bg} stopOpacity={0.35} />
                <Stop offset="1" stopColor={colors.bg} stopOpacity={1} />
              </RadialGradient>
            </Defs>
            <Rect x={0} y={0} width={ART} height={ART} fill="url(#albumFade)" />
          </Svg>
        </>
      ) : null}
      <LinearGradient colors={veil} locations={[0, 0.32, 0.62, 1]} style={styles.fill} />
    </View>
  )
}

const styles = StyleSheet.create({
  fill: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  artPos: { position: 'absolute', top: ART_TOP, right: ART_RIGHT, width: ART, height: ART },
  artImage: { opacity: 0.45 },
})
