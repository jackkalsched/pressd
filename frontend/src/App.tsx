import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { GoogleOAuthProvider } from '@react-oauth/google'
import { UserProvider, useUser } from './context/UserContext'
import Layout from './components/Layout'
import Library from './pages/Library'
import Ratings from './pages/Ratings'
import Stats from './pages/Stats'
import Social from './pages/Social'
import RatingScreen from './pages/RatingScreen'
import AlbumDetail from './pages/AlbumDetail'
import ArtistPage from './pages/ArtistPage'
import Join from './pages/Join'
import Login from './pages/Login'
import LandingPage from './pages/LandingPage'

function PublicHome() {
  const { activeUser } = useUser()
  if (activeUser) return <Navigate to="/library" replace />
  return <LandingPage />
}

function ProtectedRoutes() {
  const { activeUser } = useUser()
  if (!activeUser) return <Navigate to="/" replace />
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Navigate to="/library" replace />} />
        <Route path="/library" element={<Library />} />
        <Route path="/ratings" element={<Ratings />} />
        <Route path="/stats" element={<Stats />} />
        <Route path="/social" element={<Social />} />
        <Route path="/album/:id" element={<AlbumDetail />} />
        <Route path="/artist/:name" element={<ArtistPage />} />
      </Routes>
    </Layout>
  )
}

export default function App() {
  return (
    <GoogleOAuthProvider clientId={import.meta.env.VITE_GOOGLE_CLIENT_ID ?? ''}>
    <UserProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<PublicHome />} />
          <Route path="/rate/:id" element={<RatingScreen />} />
          <Route path="/join" element={<Join />} />
          <Route path="/login" element={<Login />} />
          <Route path="/*" element={<ProtectedRoutes />} />
        </Routes>
      </BrowserRouter>
    </UserProvider>
    </GoogleOAuthProvider>
  )
}
