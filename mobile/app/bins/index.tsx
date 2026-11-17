// Bins — your own, Pressd's, and other people's public ones, from For You's
// BINS section and the side menu. A card opens its bin; + makes one and opens
// it in edit mode, to add albums.
import { useRef, useState } from 'react'
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { useQueries } from '@tanstack/react-query'
import { ArrowLeft, Plus } from 'lucide-react-native'
import { fetchBins } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { scrollToTop } from '../../lib/scrollToTop'
import BinCard from '../../components/BinCard'
import BinSearch from '../../components/BinSearch'
import NewBinSheet from '../../components/NewBinSheet'
import { selection } from '../../lib/haptics'
import { binCardMatches, binSections } from '@pressd/shared/binSort'
import VinylSpinner from '../../components/VinylSpinner'
import { colors, fonts, spacing, useColors } from '../../theme/tokens'

export default function Bins() {
  const tc = useColors()
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { user } = useAuth()
  const scroll = useRef<ScrollView>(null)
  const [query, setQuery] = useState('')
  const [making, setMaking] = useState(false)
  // Three lists, each in the server's own order (yours last edited first, the
  // community's most opened first), then split into sections by binSections,
  // so the headings match web's.
  const scopes = ['mine', 'curated', 'community'] as const
  const results = useQueries({
    queries: scopes.map((scope) => ({
      queryKey: ['bins', scope, user?.id],
      queryFn: () => fetchBins(scope),
      enabled: !!user,
    })),
  })
  const isLoading = results.some((r) => r.isLoading)
  const isError = results.every((r) => r.isError)
  const data = isLoading ? undefined : results.flatMap((r) => r.data ?? [])
  const isRefetching = results.some((r) => r.isRefetching)
  const refetch = () => results.forEach((r) => r.refetch())

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
        <Pressable
          onPress={() => {
            selection()
            setMaking(true)
          }}
          hitSlop={8}
          style={({ pressed }) => [styles.newBtn, !data?.length && styles.searchBtn, { backgroundColor: tc.greenFill }, pressed && { opacity: 0.75 }]}
          accessibilityRole="button"
          accessibilityLabel="New bin"
        >
          <Plus size={20} color="#ffffff" strokeWidth={2.4} />
        </Pressable>
      </View>
      <NewBinSheet
        visible={making}
        onClose={() => setMaking(false)}
        onCreated={(b) => {
          setMaking(false)
          router.push({ pathname: '/bins/[slug]', params: { slug: b.slug, edit: '1' } })
        }}
      />
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
          {binSections(data.filter((b) => binCardMatches(b, query)), user?.id).map((section) => (
            <View key={section.key} style={styles.section}>
              <Text style={styles.sectionLabel}>{section.title.toUpperCase()}</Text>
              {section.bins.map((b) => (
                <BinCard key={b.slug} bin={b} onPress={() => router.push({ pathname: '/bins/[slug]', params: { slug: b.slug } })} />
              ))}
            </View>
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
  newBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  list: { paddingHorizontal: spacing.lg, paddingTop: spacing.lg, gap: spacing.xl },
  section: { gap: spacing.lg },
  sectionLabel: { fontFamily: fonts.labelBold, fontSize: 11, letterSpacing: 1.6, color: colors.inkMuted },
})
