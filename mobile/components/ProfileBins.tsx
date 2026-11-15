// A profile's Bins tab, after Rankings (November 2026): the person's bins as
// the Bins page lists them. Yours, private ones included, with New bin; anyone
// else's only as they're published for you to see (GET /bins?owner=). Drawn in
// the profile list's header, as Stats is, so it scrolls with the page. Web's
// components/ProfileBins.tsx is the same tab.
import { useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { useRouter } from 'expo-router'
import { useQuery } from '@tanstack/react-query'
import { Plus } from 'lucide-react-native'
import { fetchUserBins } from '../lib/api'
import BinCard from './BinCard'
import NewBinSheet from './NewBinSheet'
import VinylSpinner from './VinylSpinner'
import { colors, fonts, radii, spacing, useColors } from '../theme/tokens'

export default function ProfileBins({ userId, isSelf, name }: { userId: number; isSelf: boolean; name: string }) {
  const tc = useColors()
  const router = useRouter()
  const [making, setMaking] = useState(false)
  // Under ['bins'], so making or editing a bin refreshes it.
  const { data, isLoading, isError } = useQuery({
    queryKey: ['bins', 'owner', userId],
    queryFn: () => fetchUserBins(userId),
  })
  const bins = data ?? []

  return (
    <View style={styles.wrap}>
      {isSelf && (
        <Pressable
          onPress={() => setMaking(true)}
          style={({ pressed }) => [styles.newBtn, { backgroundColor: tc.greenFill }, pressed && { opacity: 0.75 }]}
          accessibilityRole="button"
        >
          <Plus size={16} color="#ffffff" strokeWidth={2.4} />
          <Text style={styles.newText}>New bin</Text>
        </Pressable>
      )}
      {isLoading ? (
        <VinylSpinner size={44} style={{ marginTop: spacing.xl }} />
      ) : isError ? (
        <Text style={styles.empty}>Couldn&rsquo;t load bins.</Text>
      ) : bins.length === 0 ? (
        <Text style={styles.empty}>
          {isSelf ? 'You haven’t made a bin yet.' : `${name} hasn’t published a bin yet.`}
        </Text>
      ) : (
        bins.map((b) => (
          <BinCard key={b.slug} bin={b} onPress={() => router.push({ pathname: '/bins/[slug]', params: { slug: b.slug } })} />
        ))
      )}
      {isSelf && (
        <NewBinSheet
          visible={making}
          onClose={() => setMaking(false)}
          onCreated={(b) => {
            setMaking(false)
            router.push({ pathname: '/bins/[slug]', params: { slug: b.slug, edit: '1' } })
          }}
        />
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: { marginTop: spacing.lg, gap: spacing.md },
  newBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-end',
    paddingVertical: 8, paddingHorizontal: 14, borderRadius: radii.pill,
  },
  newText: { fontFamily: fonts.bodySemiBold, fontSize: 13, color: '#ffffff' },
  empty: { fontFamily: fonts.body, fontSize: 14, color: colors.inkTertiary, textAlign: 'center', marginTop: spacing.xl },
})
