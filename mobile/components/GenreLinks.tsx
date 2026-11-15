// An album's genre and subgenres as the album pages print them — the genre on
// its line, the subgenres joined by "·" under it — with each tag a link. On a
// person's copy, to their ranking in it (app/genre/[tag]), as a profile's taste
// chips are: the copy's owner (`owner` names them), or yours with no `owner`.
// On a record's Pressd view (`charts`), to the Charts tab filtered to it, all
// time — web's lib/tagLinks.ts makes the same split.
import { Text, type StyleProp, type TextStyle } from 'react-native'
import { useRouter } from 'expo-router'
import { useAuth } from '../lib/auth'

export default function GenreLinks({ genre, subs, userId, owner, charts, genreStyle, subStyle }: {
  genre: string | null | undefined
  subs: string[]
  /** Whose records the ranking reads; yours when omitted. */
  userId?: number
  /** Their name, on someone else's copy; omitted for your own. */
  owner?: string
  /** A record's Pressd view: tags open Charts instead of a person's ranking. */
  charts?: boolean
  genreStyle: StyleProp<TextStyle>
  subStyle: StyleProp<TextStyle>
}) {
  const router = useRouter()
  const { user } = useAuth()
  const open = (tag: string, kind: 'genre' | 'subgenre') => {
    if (charts) {
      router.navigate({ pathname: '/charts', params: { [kind]: tag, period: 'all', t: String(Date.now()) } })
      return
    }
    const uid = userId ?? user?.id
    if (!uid) return
    router.push({
      pathname: '/genre/[tag]',
      params: {
        tag: encodeURIComponent(tag),
        kind,
        userId: String(uid),
        ...(owner ? { owner: encodeURIComponent(owner) } : {}),
      },
    })
  }
  return (
    <>
      {genre ? (
        <Text style={genreStyle} onPress={() => open(genre, 'genre')} accessibilityRole="link">{genre}</Text>
      ) : null}
      {subs.length > 0 && (
        <Text style={subStyle}>
          {subs.map((s, i) => (
            <Text key={s}>
              {i > 0 ? ' · ' : ''}
              <Text onPress={() => open(s, 'subgenre')} accessibilityRole="link">{s}</Text>
            </Text>
          ))}
        </Text>
      )}
    </>
  )
}
