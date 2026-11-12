// Bins — every one of Pressd's bins, from the sidebar and For You's Bins
// section. Mobile's app/bins/index.tsx, across the width of the page.
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { binCardMatches } from '@pressd/shared/binSort'
import BinSearch from '../components/BinSearch'
import { fetchBins } from '../api'
import BinCard from '../components/BinCard'
import VinylSpinner from '../components/VinylSpinner'
import { useUser } from '../context/UserContext'

export default function Bins() {
  const { activeUser } = useUser()
  const [query, setQuery] = useState('')
  const { data, isLoading, isError } = useQuery({
    queryKey: ['bins', activeUser?.id],
    queryFn: fetchBins,
    enabled: !!activeUser,
  })

  return (
    <div className="mx-auto w-full max-w-[1600px] px-6 md:px-12 py-8 pb-24">
      {/* The search sits at the far right of the header, opening leftward. */}
      <div className="flex items-center gap-4">
        <h1 className="m-0 font-display text-4xl font-bold text-(--c-1c1917)">Bins</h1>
        {!!data?.length && (
          <div className="ml-auto flex min-w-0 flex-1 justify-end">
            <BinSearch value={query} onChange={setQuery} placeholder="Search bins" className="w-full max-w-sm" />
          </div>
        )}
      </div>
      {isLoading ? (
        <div className="flex justify-center py-24"><VinylSpinner size={64} /></div>
      ) : isError || !data?.length ? (
        <p className="mt-10 text-[14px] text-(--c-57534e)">{isError ? 'Couldn’t load bins.' : 'No bins yet.'}</p>
      ) : (
        <>
        {!data.some((b) => binCardMatches(b, query)) && (
          <p className="mt-10 text-[14px] text-(--c-57534e)">No bins match “{query.trim()}”.</p>
        )}
        <div className="mt-8 grid gap-8 md:grid-cols-2 xl:grid-cols-3">
          {data.filter((b) => binCardMatches(b, query)).map((b, i) => (
            <div key={b.slug} className="rise-in" style={{ '--i': i } as React.CSSProperties}>
              <BinCard bin={b} size={128} />
            </div>
          ))}
        </div>
        </>
      )}
    </div>
  )
}
