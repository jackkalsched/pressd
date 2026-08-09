// The chrome the three favourite-pickers share: a back header, the question,
// a search field, the score-sorted list, and the control that clears the pick.
//
// Shared so the three screens differ only in what they list and what they send.
// Each one writes through PATCH /users/{id}, which refuses anything the caller
// hasn't rated — so the lists here are the user's own library, never a catalog
// search.
import { type ReactElement } from 'react'
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { ArrowLeft, Check, Search, X } from 'lucide-react-native'
import { colors, fonts, radii, spacing } from '../theme/tokens'

export default function FavoritePicker<T>({
  question,
  data,
  loading,
  keyExtractor,
  renderRow,
  isSelected,
  search,
  onSearchChange,
  searchPlaceholder,
  emptyText,
  hasPick,
  onClear,
  saving,
  error,
  onBack,
}: {
  question: string
  data: T[]
  loading: boolean
  keyExtractor: (item: T) => string
  renderRow: (item: T, index: number) => ReactElement
  isSelected: (item: T) => boolean
  search: string
  onSearchChange: (v: string) => void
  searchPlaceholder: string
  emptyText: string
  hasPick: boolean
  onClear: () => void
  saving: boolean
  error: string | null
  onBack: () => void
}) {
  const insets = useSafeAreaInsets()

  return (
    <View style={styles.screen}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable onPress={onBack} hitSlop={12} style={styles.backBtn} accessibilityLabel="Back">
          <ArrowLeft size={18} color="#ffffff" />
          <Text style={styles.backText}>Back</Text>
        </Pressable>
        <Text style={styles.question}>{question}</Text>
      </View>

      <FlatList
        data={data}
        keyExtractor={keyExtractor}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={
          <View>
            <View style={styles.searchBar}>
              <Search size={15} color={colors.inkTertiary} />
              <TextInput
                style={styles.searchBarInput}
                value={search}
                onChangeText={onSearchChange}
                placeholder={searchPlaceholder}
                placeholderTextColor={colors.inkTertiary}
                autoCorrect={false}
                autoCapitalize="none"
                returnKeyType="search"
                clearButtonMode="never"
              />
              {search.length > 0 && (
                <Pressable onPress={() => onSearchChange('')} hitSlop={8} accessibilityLabel="Clear search">
                  <X size={14} color={colors.inkMuted} />
                </Pressable>
              )}
            </View>
            {error ? <Text style={styles.error}>{error}</Text> : null}
            {/* A pick is set by tapping a row, so clearing needs its own
                control — there is no row that means "none of these". */}
            {hasPick && (
              <Pressable style={styles.clearBtn} onPress={onClear} disabled={saving}>
                <Text style={styles.clearText}>Clear this pick</Text>
              </Pressable>
            )}
          </View>
        }
        renderItem={({ item, index }) => (
          <View style={styles.rowWrap}>
            <View style={{ flex: 1, minWidth: 0 }}>{renderRow(item, index)}</View>
            {/* The tick rides alongside the shared row components rather than
                inside them, so the Ratings board doesn't grow a selection slot
                it has no use for. */}
            {isSelected(item) ? <Check size={18} color={colors.green} strokeWidth={2.6} /> : null}
          </View>
        )}
        ListEmptyComponent={
          loading ? (
            <ActivityIndicator color={colors.green} style={{ marginTop: spacing.xxl }} />
          ) : (
            <Text style={styles.empty}>{emptyText}</Text>
          )
        }
      />

      {saving && (
        <View style={styles.savingOverlay} pointerEvents="auto">
          <ActivityIndicator color={colors.green} />
        </View>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  header: {
    backgroundColor: colors.green,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.lg,
    gap: spacing.md,
  },
  backBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start' },
  backText: { fontFamily: fonts.bodyMedium, fontSize: 15, color: '#ffffff' },
  question: { fontFamily: fonts.display, fontSize: 24, color: '#ffffff', lineHeight: 31 },

  content: { paddingHorizontal: spacing.lg, paddingBottom: 60 },

  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.lg,
    paddingHorizontal: spacing.md,
    height: 42,
    backgroundColor: colors.raised,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  searchBarInput: { flex: 1, fontFamily: fonts.body, fontSize: 14, color: colors.ink },

  rowWrap: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },

  clearBtn: { alignSelf: 'flex-start', paddingVertical: spacing.md },
  clearText: { fontFamily: fonts.bodyMedium, fontSize: 13.5, color: colors.inkTertiary },

  error: { fontFamily: fonts.bodyMedium, fontSize: 13, color: '#b91c1c', marginTop: spacing.md },
  empty: {
    fontFamily: fonts.body,
    fontSize: 14,
    color: colors.inkTertiary,
    textAlign: 'center',
    marginTop: spacing.xxl,
  },

  savingOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(249,248,246,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
  },
})
