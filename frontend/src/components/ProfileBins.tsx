// A profile's Bins tab, after Rankings (November 2026): the person's bins as
// the Bins page draws them. Yours, private ones included, with New bin; anyone
// else's only as they're published for you to see (GET /bins?owner=).
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Plus } from 'lucide-react'
import { fetchUserBins } from '../api'
import { BinPoster } from './BinCard'
import NewBinDialog from './NewBinDialog'
import VinylSpinner from './VinylSpinner'

export default function ProfileBins({ userId, isSelf, name }: { userId: number; isSelf: boolean; name: string }) {
  const navigate = useNavigate()
  const [making, setMaking] = useState(false)
  // Under ['bins'], so making or editing a bin refreshes it.
  const { data, isLoading, isError } = useQuery({
    queryKey: ['bins', 'owner', userId],
    queryFn: () => fetchUserBins(userId),
  })

  if (isLoading) return <div className="flex justify-center py-16"><VinylSpinner size={48} /></div>
  if (isError) return <p className="py-10 text-[14px] text-(--c-57534e)">Couldn&rsquo;t load bins.</p>

  const bins = data ?? []
  return (
    <div>
      {isSelf && (
        <div className="mb-5 flex justify-end">
          <button
            type="button"
            onClick={() => setMaking(true)}
            className="inline-flex items-center gap-1.5 rounded-full bg-(--c-green-fill) px-4 py-2 text-[13px] font-semibold text-white transition-colors hover:bg-(--c-245c43)"
          >
            <Plus size={15} /> New bin
          </button>
        </div>
      )}
      {bins.length === 0 ? (
        <p className="py-10 text-[14px] text-(--c-57534e)">
          {isSelf ? 'You haven’t made a bin yet.' : `${name} hasn’t published a bin yet.`}
        </p>
      ) : (
        <div className="grid gap-6 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {bins.map((b, i) => (
            <div key={b.slug} className="rise-in" style={{ '--i': i } as React.CSSProperties}>
              <BinPoster bin={b} />
            </div>
          ))}
        </div>
      )}
      {making && (
        <NewBinDialog onClose={() => setMaking(false)} onCreated={(b) => navigate(`/bins/${b.slug}?edit=1`)} />
      )}
    </div>
  )
}
