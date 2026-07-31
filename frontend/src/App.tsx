import type { ReactElement } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { GoogleOAuthProvider } from '@react-oauth/google'
import { useQuery } from '@tanstack/react-query'
import { fetchAlbums } from './api'
import { UserProvider, useUser } from './context/UserContext'
import Onboarding, { ONBOARDING_SKIP_KEY } from './pages/Onboarding'
import Layout from './components/Layout'
import ForYou from './pages/ForYou'
import Library from './pages/Library'
import Ratings from './pages/Ratings'
import Stats from './pages/Stats'
import Social from './pages/Social'
import FriendProfile from './pages/FriendProfile'
import RatingScreen from './pages/RatingScreen'
import AlbumDetail from './pages/AlbumDetail'
import ArtistPage from './pages/ArtistPage'
import Join from './pages/Join'
import LandingPage from './pages/LandingPage'
import Privacy from './pages/Privacy'
import PublicCharts from './pages/PublicCharts'
import HowItWorks from './pages/HowItWorks'

function PublicHome() {
  const { activeUser } = useUser()
  if (activeUser) return <Navigate to="/for-you" replace />
  return <LandingPage />
}

function RequireUser({ children }: { children: ReactElement }) {
  const { activeUser } = useUser()
  if (!activeUser) return <Navigate to="/" replace />
  return children
}

function ProtectedRoutes() {
  const { activeUser } = useUser()
  // First-login onboarding: no rated albums yet → rate one before reaching
  // the main site (skippable per session). /rate/:id stays reachable — it's
  // the flow the onboarding page hands off to.
  const skipped = sessionStorage.getItem(ONBOARDING_SKIP_KEY) === '1'
  const { data: rated, isLoading } = useQuery({
    queryKey: ['albums', 'rated', activeUser?.id],
    queryFn: () => fetchAlbums({ status: 'rated', userId: activeUser!.id }),
    enabled: !!activeUser && !skipped,
  })
  if (!activeUser) return <Navigate to="/" replace />
  if (!skipped) {
    if (isLoading) return null
    if ((rated ?? []).length === 0) return <Navigate to="/welcome" replace />
  }
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Navigate to="/for-you" replace />} />
        <Route path="/for-you" element={<ForYou />} />
        <Route path="/library" element={<Library />} />
        <Route path="/ratings" element={<Ratings />} />
        <Route path="/stats" element={<Stats />} />
        <Route path="/social" element={<Social />} />
        <Route path="/u/:userId" element={<FriendProfile />} />
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
          <Route path="/rate/:id" element={<RequireUser><RatingScreen /></RequireUser>} />
          <Route path="/welcome" element={<RequireUser><Onboarding /></RequireUser>} />
          <Route path="/join" element={<Join />} />
          {/* Public: App Store Connect requires a privacy URL that Apple's
              reviewers can open while signed out. Must stay above the catch-all,
              which sends everything else through ProtectedRoutes. */}
          <Route path="/privacy" element={<Privacy />} />
          {/* Reachable from the landing page without an account. Must stay
              above the catch-all, or ProtectedRoutes bounces visitors home. */}
          <Route path="/charts" element={<PublicCharts />} />
          <Route path="/how-it-works" element={<HowItWorks />} />
          <Route path="/*" element={<ProtectedRoutes />} />
        </Routes>
      </BrowserRouter>
    </UserProvider>
    </GoogleOAuthProvider>
  )
}
