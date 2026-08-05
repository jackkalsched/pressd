// Ambient album wash behind an album's pages, ported from the desktop
// AlbumDetail. Three layers, bottom to top:
//   1. the page tint — a vertical gradient in the album's own hue, matching
//      desktop's accentToPageGradient (strong at the top, app bg by 60%)
//   2. the cover, blurred and bled from the top, centered across the page
//   3. a radial vignette dissolving the cover's square edge into that tint,
//      then a bottom fade so text further down the page keeps its contrast
import { useMemo } from 'react'
import { Dimensions, StyleSheet, View } from 'react-native'
import { LinearGradient } from 'expo-linear-gradient'
import Svg, { Defs, Image as SvgImage, Mask, RadialGradient, Rect, Stop } from 'react-native-svg'
import { useQuery } from '@tanstack/react-query'
import { fetchAlbumColor } from '../lib/api'
import { colors } from '../theme/tokens'

const { width: W } = Dimensions.get('window')

// Blurred cover bleed, centered horizontally and oversized so the wash reaches
// across the upper page. Image and vignette share this frame so the radial
// fade lines up; the fade goes solid well inside the square, which is why it
// can overhang every edge without the artwork's border ever showing.
const ART = W * 1.4
const ART_TOP = -W * 0.2
// (W - ART) / 2 — the overhang split evenly, so the cover's midpoint sits on
// the screen's. Anchoring one side instead pushes the artwork's centre off the
// page and clips whatever it carries there.
const ART_LEFT = (W - ART) / 2

// Fully transparent app-bg. Interpolating from the literal 'transparent'
// keyword muddies through black on Android, so fade from this instead.
const BG_CLEAR = 'rgba(249,248,246,0)'

function hueOf(hsl: string | null | undefined): number | null {
  const m = hsl?.match(/hsl\((\d+)/)
  return m ? Number(m[1]) : null
}

export default function AlbumBackdrop({
  albumArtUrl,
  album,
  artist,
  subtle = false,
}: {
  albumArtUrl?: string | null
  album: string
  artist: string
  /** Dial the cover back for dense pages (e.g. the friend comparison), where a
   *  prominent wash competes with two columns of numbers. The page tint is
   *  unchanged — only the artwork recedes. */
  subtle?: boolean
}) {
  const { data } = useQuery({
    queryKey: ['album-color', album, artist],
    queryFn: () => fetchAlbumColor(album, artist),
    enabled: !!album && !!artist,
    staleTime: Infinity,
  })
  const hue = hueOf(data?.color)

  // Desktop's ramp, deepened a step (lower lightness, higher saturation) so the
  // tint carries on a phone screen instead of washing out.
  const page = useMemo<[string, string, string, string]>(() => {
    if (hue == null) return [colors.bg, colors.bg, colors.bg, colors.bg]
    return [`hsl(${hue}, 46%, 80%)`, `hsl(${hue}, 34%, 89%)`, colors.bg, colors.bg]
  }, [hue])

  return (
    <View style={styles.fill} pointerEvents="none">
      <LinearGradient colors={page} locations={[0, 0.34, 0.68, 1]} style={styles.fill} />

      {albumArtUrl ? (
        // The cover is masked to true transparency rather than covered by a
        // tinted disc: a disc has its own rectangular edge, and any flat color
        // it fades to can only match one point of the vertical page gradient.
        // Masking lets the gradient show through cleanly at every height, so
        // neither the artwork's border nor the mask's own edge can appear.
        <Svg width={ART} height={ART} style={styles.artPos}>
          <Defs>
            <RadialGradient
              id="albumFade"
              gradientUnits="userSpaceOnUse"
              cx={ART / 2}
              cy={ART / 2}
              r={ART / 2}
            >
              <Stop offset="0" stopColor="#ffffff" stopOpacity={1} />
              <Stop offset="0.45" stopColor="#ffffff" stopOpacity={0.85} />
              <Stop offset="0.72" stopColor="#ffffff" stopOpacity={0.32} />
              <Stop offset="1" stopColor="#ffffff" stopOpacity={0} />
            </RadialGradient>
            <Mask id="albumMask" maskUnits="userSpaceOnUse" x={0} y={0} width={ART} height={ART}>
              <Rect x={0} y={0} width={ART} height={ART} fill="url(#albumFade)" />
            </Mask>
          </Defs>
          <SvgImage
            href={{ uri: albumArtUrl }}
            x={0}
            y={0}
            width={ART}
            height={ART}
            preserveAspectRatio="xMidYMid slice"
            opacity={subtle ? 0.26 : 0.4}
            mask="url(#albumMask)"
          />
        </Svg>
      ) : null}

      <LinearGradient
        colors={[BG_CLEAR, colors.bg]}
        locations={subtle ? [0.28, 0.62] : [0.42, 0.8]}
        style={styles.fill}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  fill: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  artPos: { position: 'absolute', top: ART_TOP, left: ART_LEFT, width: ART, height: ART },
})
