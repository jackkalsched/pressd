import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { UserProvider } from './context/UserContext'
import Layout from './components/Layout'
import Library from './pages/Library'
import Ratings from './pages/Ratings'
import Stats from './pages/Stats'
import RatingScreen from './pages/RatingScreen'
import AlbumDetail from './pages/AlbumDetail'
import ArtistPage from './pages/ArtistPage'
import Join from './pages/Join'

export default function App() {
  return (
    <UserProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/rate/:id" element={<RatingScreen />} />
          <Route path="/join" element={<Join />} />
          <Route
            path="/*"
            element={
              <Layout>
                <Routes>
                  <Route path="/" element={<Navigate to="/library" replace />} />
                  <Route path="/library" element={<Library />} />
                  <Route path="/ratings" element={<Ratings />} />
                  <Route path="/stats" element={<Stats />} />
                  <Route path="/album/:id" element={<AlbumDetail />} />
                  <Route path="/artist/:name" element={<ArtistPage />} />
                </Routes>
              </Layout>
            }
          />
        </Routes>
      </BrowserRouter>
    </UserProvider>
  )
}
