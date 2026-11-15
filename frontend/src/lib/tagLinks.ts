// Where an album's genre and subgenre tags go. On a person's copy (and their
// profile's taste pills), to that person's ranking in the tag — TagBoard. On a
// record's Pressd page, to Charts filtered to it, all time (the week's board,
// with its three-rater bar, is nearly always empty for one genre). Mobile's
// components/GenreLinks.tsx makes the same split.
export type TagKind = 'genre' | 'subgenre'

export function tagBoardHref(kind: TagKind, tag: string, userId: number, owner?: string): string {
  const q = new URLSearchParams({ user: String(userId) })
  if (owner) q.set('owner', owner)
  return `/stats/${kind}/${encodeURIComponent(tag)}?${q.toString()}`
}

export function chartHref(kind: TagKind, tag: string): string {
  return `/charts?${new URLSearchParams({ period: 'all', [kind]: tag }).toString()}`
}
