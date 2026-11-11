// Bins — every one of Pressd's bins, from For You's BINS section and the side
// menu. A card opens its bin.
import { useRef, useState } from 'react'
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft } from 'lucide-react-native'
import { fetchBins } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { scrollToTop } from '../../lib/scrollToTop'
import BinCard from '../../components/BinCard'
import BinSearch from '../../components/BinSearch'
import { binCardMatches } from '@pressd/shared/binSort'
import VinylSpinner from '../../components/VinylSpinner'
import { colors, fonts, spacing, useColors } from '../../theme/tokens'

export default function Bins() {
  const tc = useColors()
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { user } = useAuth()
  const scroll = useRef<ScrollView>(null)
  const [query, setQuery] = useState('')
  const { data, isLoading, isError, refetch, isRefetching } = useQuery({
    queryKey: ['bins', user?.id],
    queryFn: fetchBins,
    enabled: !!user,
  })

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12} accessibilityRole="button" accessibilityLabel="Back">
          <ArrowLeft size={22} color={tc.ink} />
        </Pressable>
        <Text style={styles.title} onPress={() => scrollToTop(scroll)} accessibilityRole="button" accessibilityHint="Scrolls to the top">Bins</Text>
        {!!data?.length && (
          <BinSearch value={query} onChange={setQuery} placeholder="Search bins" buttonStyle={styles.searchBtn} fieldStyle={styles.searchField} />
        )}
      </View>
      {isLoading || isError || !data?.length ? (
        <View style={styles.state}>
          {isLoading ? <VinylSpinner size={64} /> : (
            <Text style={styles.stateText}>{isError ? 'Couldn’t load bins.' : 'No bins yet.'}</Text>
          )}
        </View>
      ) : (
        <ScrollView
          ref={scroll}
          contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + spacing.xl }]}
          refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={tc.green} />}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
        >
          {data.filter((b) => binCardMatches(b, query)).map((b) => (
            <BinCard key={b.slug} bin={b} onPress={() => router.push({ pathname: '/bins/[slug]', params: { slug: b.slug } })} />
          ))}
          {query !== '' && !data.some((b) => binCardMatches(b, query)) && (
            <Text style={styles.stateText}>No bins match “{query.trim()}”.</Text>
          )}
        </ScrollView>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.xs },
  title: { fontFamily: fonts.display, fontSize: 28, lineHeight: 34, color: colors.ink },
  state: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  stateText: { fontFamily: fonts.bodyMedium, fontSize: 14, color: colors.inkSecondary },
  searchBtn: { marginLeft: 'auto' },
  searchField: { flex: 1, marginLeft: spacing.sm },
  list: { paddingHorizontal: spacing.lg, paddingTop: spacing.lg, gap: spacing.xl },
})
