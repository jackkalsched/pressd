import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { fetchAlbums } from '../api'
import { useUser } from '../context/UserContext'
import { Loader2, Music } from 'lucide-react'

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

  const thCls = (key: SortKey, extra = '') =>
    `text-left text-[10px] font-semibold uppercase tracking-[0.1em] py-3 px-4 cursor-pointer select-none transition-colors ${
      sortKey === key ? 'text-[#1c1917]' : 'text-[#a8998a] hover:text-[#78716c]'
    } ${extra}`

  return (
    <div className="min-h-screen bg-[#faf8f5]">
      <div className="p-4 md:p-8">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold text-[#1c1917]">Record Ratings</h1>
          <span className="text-[#a8998a] text-sm">{sorted.length} albums</span>
        </div>

        <input
          type="text"
          placeholder="Search albums or artists…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full max-w-sm bg-[#f0ebe3] border border-[#e8e2d9] text-[#1c1917] text-sm px-4 py-2 rounded-xl focus:outline-none focus:border-[#2d6a4f] transition-colors placeholder:text-[#c2b8ad] mb-6"
        />

        {isLoading ? (
          <div className="flex items-center justify-center py-24 text-[#a8998a] gap-2">
            <Loader2 size={16} className="animate-spin" /> Loading…
          </div>
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-[#e8e2d9]">
            <table className="w-full">
              <thead>
                <tr className="border-b border-[#e8e2d9] bg-[#f7f3ee]">
                  <th className="text-left text-[10px] font-semibold text-[#a8998a] uppercase tracking-[0.1em] py-3 px-4 w-8">#</th>
                  <th className={thCls('albumName')} onClick={() => toggleSort('albumName')}>
                    Album
                    {sortKey === 'albumName' && <span className="ml-1 text-[#2d6a4f]">{sortDir === 'desc' ? '↓' : '↑'}</span>}
                  </th>
                  <th className={thCls('artist')} onClick={() => toggleSort('artist')}>
                    Artist
                    {sortKey === 'artist' && <span className="ml-1 text-[#2d6a4f]">{sortDir === 'desc' ? '↓' : '↑'}</span>}
                  </th>
                  <th className={thCls('year', 'w-16')} onClick={() => toggleSort('year')}>
                    Year
                    {sortKey === 'year' && <span className="ml-1 text-[#2d6a4f]">{sortDir === 'desc' ? '↓' : '↑'}</span>}
                  </th>
                  <th
                    className={`text-right text-[10px] font-semibold uppercase tracking-[0.1em] py-3 px-4 w-20 cursor-pointer select-none transition-colors ${sortKey === 'score' ? 'text-[#1c1917]' : 'text-[#a8998a] hover:text-[#78716c]'}`}
                    onClick={() => toggleSort('score')}
                  >
                    Score {sortKey === 'score' && <span className="text-[#2d6a4f]">{sortDir === 'desc' ? '↓' : '↑'}</span>}
                  </th>
                  <th className="text-right text-[10px] font-semibold text-[#a8998a] uppercase tracking-[0.1em] py-3 px-4 w-20">Theme</th>
                  <th className="text-right text-[10px] font-semibold text-[#a8998a] uppercase tracking-[0.1em] py-3 px-4 w-20">Replay</th>
                  <th className="text-right text-[10px] font-semibold text-[#a8998a] uppercase tracking-[0.1em] py-3 px-4 w-20">Prod.</th>
                  <th className="text-right text-[10px] font-semibold text-[#a8998a] uppercase tracking-[0.1em] py-3 px-4 w-20">Dist.</th>
                  <th className="text-left text-[10px] font-semibold text-[#a8998a] uppercase tracking-[0.1em] py-3 px-4">Genre</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((album, i) => (
                  <tr
                    key={album.id}
                    className="border-b border-[#f0ebe3] last:border-0 hover:bg-[#f7f3ee] cursor-pointer transition-colors"
                    onClick={() => navigate(`/album/${album.id}`)}
                  >
                    <td className="py-3 px-4 text-[#c2b8ad] text-sm tabular-nums">{i + 1}</td>
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 shrink-0 rounded-lg overflow-hidden bg-gradient-to-br from-[#e8dfd2] to-[#cfc3b0] flex items-center justify-center">
                          {album.albumArtUrl
                            ? <img src={album.albumArtUrl} alt="" className="w-full h-full object-cover" />
                            : <Music size={14} className="text-[#b0a090]" strokeWidth={1.5} />}
                        </div>
                        <span className="text-[#1c1917] text-sm font-medium">{album.albumName}</span>
                      </div>
                    </td>
                    <td className="py-3 px-4 text-sm">
                      {[album.artist, ...album.extraArtists].map((name, j, arr) => (
                        <span key={name}>
                          <Link
                            to={`/artist/${encodeURIComponent(name)}`}
                            onClick={(e) => e.stopPropagation()}
                            className="text-[#78716c] hover:text-[#2d6a4f] transition-colors"
                          >
                            {name}
                          </Link>
                          {j < arr.length - 1 ? ', ' : ''}
                        </span>
                      ))}
                    </td>
                    <td className="py-3 px-4 text-[#78716c] text-sm tabular-nums">{album.year}</td>
                    <td className="py-3 px-4 text-right">
                      <span className="text-[#2d6a4f] font-semibold text-sm tabular-nums">
                        {album.score?.toFixed(2)}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-right text-[#78716c] text-sm tabular-nums">{album.theme ?? '—'}</td>
                    <td className="py-3 px-4 text-right text-[#78716c] text-sm tabular-nums">{album.replayValue ?? '—'}</td>
                    <td className="py-3 px-4 text-right text-[#78716c] text-sm tabular-nums">{album.production ?? '—'}</td>
                    <td className="py-3 px-4 text-right text-[#78716c] text-sm tabular-nums">{album.distinctness ?? '—'}</td>
                    <td className="py-3 px-4 text-[#a8998a] text-xs">{album.genre ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
