import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { fetchAlbums } from '../api'
import { useUser } from '../context/UserContext'
import { Loader2 } from 'lucide-react'

type SortKey = 'score' | 'year' | 'artist' | 'albumName'

export default function Ratings() {
  const navigate = useNavigate()
  const { viewingUser } = useUser()
  const userId = viewingUser.id
  const [sortKey, setSortKey] = useState<SortKey>('score')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [search, setSearch] = useState('')

  const { data: albums = [], isLoading } = useQuery({
    queryKey: ['albums', 'rated', userId],
    queryFn: () => fetchAlbums({ status: 'rated', userId }),
  })

  const filtered = albums.filter(
    (a) =>
      a.theme !== null && a.replayValue !== null && a.production !== null && a.distinctness !== null &&
      (a.albumName.toLowerCase().includes(search.toLowerCase()) ||
       a.artist.toLowerCase().includes(search.toLowerCase())),
  )

  const sorted = [...filtered].sort((a, b) => {
    const av = a[sortKey] ?? ''
    const bv = b[sortKey] ?? ''
    if (av < bv) return sortDir === 'asc' ? -1 : 1
    if (av > bv) return sortDir === 'asc' ? 1 : -1
    return 0
  })

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    else { setSortKey(key); setSortDir('desc') }
  }

  const col = (key: SortKey, label: string, cls = '') => (
    <th
      className={`text-left text-xs font-semibold text-[#999] uppercase tracking-widest py-3 px-4 cursor-pointer hover:text-[#555] transition-colors select-none ${cls}`}
      onClick={() => toggleSort(key)}
    >
      {label}
      {sortKey === key && <span className="ml-1 text-[#2d6a4f]">{sortDir === 'desc' ? '↓' : '↑'}</span>}
    </th>
  )

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold text-[#111]">Record Ratings</h1>
        <span className="text-[#aaa] text-sm">{sorted.length} albums</span>
      </div>

      <input
        type="text"
        placeholder="Search albums or artists…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="w-full max-w-sm bg-[#f5f5f5] border border-[#e2e2e2] text-[#111] text-sm px-4 py-2 rounded-lg focus:outline-none focus:border-[#2d6a4f] transition-colors placeholder:text-[#bbb] mb-6"
      />

      {isLoading ? (
        <div className="flex items-center justify-center py-24 text-[#aaa] gap-2">
          <Loader2 size={16} className="animate-spin" /> Loading…
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-[#e2e2e2]">
                <th className="text-left text-xs font-semibold text-[#999] uppercase tracking-widest py-3 px-4 w-8">#</th>
                {col('albumName', 'Album')}
                {col('artist', 'Artist')}
                {col('year', 'Year', 'w-16')}
                <th className="text-right text-xs font-semibold text-[#999] uppercase tracking-widest py-3 px-4 w-20 cursor-pointer hover:text-[#555] select-none" onClick={() => toggleSort('score')}>
                  Score {sortKey === 'score' && <span className="text-[#2d6a4f]">{sortDir === 'desc' ? '↓' : '↑'}</span>}
                </th>
                <th className="text-right text-xs font-semibold text-[#999] uppercase tracking-widest py-3 px-4 w-20">Theme</th>
                <th className="text-right text-xs font-semibold text-[#999] uppercase tracking-widest py-3 px-4 w-20">Replay</th>
                <th className="text-right text-xs font-semibold text-[#999] uppercase tracking-widest py-3 px-4 w-20">Prod.</th>
                <th className="text-right text-xs font-semibold text-[#999] uppercase tracking-widest py-3 px-4 w-20">Dist.</th>
                <th className="text-left text-xs font-semibold text-[#999] uppercase tracking-widest py-3 px-4">Genre</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((album, i) => (
                <tr
                  key={album.id}
                  className="border-b border-[#f0f0f0] hover:bg-[#f5f5f5] cursor-pointer transition-colors"
                  onClick={() => navigate(`/album/${album.id}`)}
                >
                  <td className="py-3 px-4 text-[#aaa] text-sm">{i + 1}</td>
                  <td className="py-3 px-4">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 shrink-0 bg-[#e8e8e8] rounded-md flex items-center justify-center text-[#aaa] text-sm font-bold overflow-hidden">
                        {album.albumArtUrl
                          ? <img src={album.albumArtUrl} alt="" className="w-full h-full object-cover" />
                          : album.albumName[0]}
                      </div>
                      <span className="text-[#111] text-sm font-medium">{album.albumName}</span>
                    </div>
                  </td>
                  <td className="py-3 px-4 text-sm">
                    {[album.artist, ...album.extraArtists].map((name, i, arr) => (
                      <span key={name}>
                        <Link
                          to={`/artist/${encodeURIComponent(name)}`}
                          onClick={(e) => e.stopPropagation()}
                          className="text-[#777] hover:text-[#2d6a4f] transition-colors"
                        >
                          {name}
                        </Link>
                        {i < arr.length - 1 ? ', ' : ''}
                      </span>
                    ))}
                  </td>
                  <td className="py-3 px-4 text-[#777] text-sm">{album.year}</td>
                  <td className="py-3 px-4 text-right">
                    <span className="text-[#2d6a4f] font-semibold text-sm tabular-nums">
                      {album.score?.toFixed(2)}
                    </span>
                  </td>
                  <td className="py-3 px-4 text-right text-[#777] text-sm tabular-nums">{album.theme ?? '—'}</td>
                  <td className="py-3 px-4 text-right text-[#777] text-sm tabular-nums">{album.replayValue ?? '—'}</td>
                  <td className="py-3 px-4 text-right text-[#777] text-sm tabular-nums">{album.production ?? '—'}</td>
                  <td className="py-3 px-4 text-right text-[#777] text-sm tabular-nums">{album.distinctness ?? '—'}</td>
                  <td className="py-3 px-4 text-[#aaa] text-xs">{album.genre ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
