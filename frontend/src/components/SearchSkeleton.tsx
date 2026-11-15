// What search shows while it's answering: grey rows in the results' own shape —
// a cover or face and two lines — pulsing softly, instead of a spinner (Jack,
// November 2026). Still under reduced motion. Mobile's components/SearchSkeleton.tsx
// is the same idea.

const BLOCK = 'bg-(--c-ece5da)'

/** `count` placeholder rows; `round` for people. */
export function SkeletonRows({ count = 4, round = false }: { count?: number; round?: boolean }) {
  return (
    <ul className="m-0 list-none p-0 animate-pulse motion-reduce:animate-none" aria-hidden>
      {Array.from({ length: count }, (_, i) => (
        <li key={i} className="flex items-center gap-3 px-3 py-2">
          <span className={`h-11 w-11 shrink-0 ${round ? 'rounded-full' : 'rounded-lg'} ${BLOCK}`} />
          <span className="flex min-w-0 flex-1 flex-col gap-2">
            <span className={`h-3 rounded-full ${BLOCK}`} style={{ width: `${72 - (i % 3) * 14}%` }} />
            <span className={`h-2.5 rounded-full ${BLOCK}`} style={{ width: `${46 - (i % 2) * 10}%` }} />
          </span>
        </li>
      ))}
    </ul>
  )
}

/** The whole results page before its first answer: the four groups' columns. */
export default function SearchSkeleton() {
  return (
    <div className="mt-8 grid grid-cols-1 gap-x-10 gap-y-8 md:grid-cols-2 lg:grid-cols-4" role="status" aria-label="Searching">
      {[true, false, false, false].map((round, i) => (
        <section key={i}>
          <span className={`mb-3 block h-3 w-20 rounded-full ${BLOCK} animate-pulse motion-reduce:animate-none`} />
          <div className="-mx-3"><SkeletonRows round={round} /></div>
        </section>
      ))}
    </div>
  )
}
