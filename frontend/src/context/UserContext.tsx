import { createContext, useContext, useState, useEffect, type ReactNode } from 'react'
import { markTutorialSeen } from '../api'

export interface UserInfo {
  id: number
  name: string
  avatarUrl?: string
  bio?: string
  /** Only the caller's own record carries this, from sign-in. Absent — a
   *  session stored before the field existed — must read as "seen", so the
   *  first-run gate checks for an explicit false. */
  tutorialSeen?: boolean
}

interface UserContextValue {
  activeUser: UserInfo | null
  setActiveUser: (user: UserInfo | null) => void
  viewingUser: UserInfo | null
  setViewingUser: (user: UserInfo | null) => void
  isViewingFriend: boolean
  /** Close out the first-run tutorial, finished or skipped. */
  completeTutorial: () => void
  signOut: () => void
}

const UserContext = createContext<UserContextValue | null>(null)

const STORAGE_KEY = 'pressd_active_user'

export function UserProvider({ children }: { children: ReactNode }) {
  const [activeUser, setActiveUserState] = useState<UserInfo | null>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY)
      if (stored) return JSON.parse(stored) as UserInfo
    } catch { /* ignore */ }
    return null
  })

  const [viewingUser, setViewingUser] = useState<UserInfo | null>(activeUser)

  useEffect(() => {
    if (activeUser) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(activeUser))
    } else {
      localStorage.removeItem(STORAGE_KEY)
    }
    setViewingUser(activeUser)
  }, [activeUser])

  function setActiveUser(user: UserInfo | null) {
    setActiveUserState(user)
  }

  // Local first, so the gate in App lets the user through on this render
  // instead of waiting on the network. A failed save only means another device
  // may show the tutorial once more — not worth holding anyone here for.
  function completeTutorial() {
    if (!activeUser || activeUser.tutorialSeen !== false) return
    setActiveUserState({ ...activeUser, tutorialSeen: true })
    markTutorialSeen(activeUser.id).catch(() => {})
  }

  function signOut() {
    try { localStorage.removeItem('pressd_token') } catch { /* ignore */ }
    setActiveUserState(null)
    setViewingUser(null)
  }

  return (
    <UserContext.Provider
      value={{
        activeUser,
        setActiveUser,
        viewingUser,
        setViewingUser,
        isViewingFriend: !!activeUser && !!viewingUser && viewingUser.id !== activeUser.id,
        completeTutorial,
        signOut,
      }}
    >
      {children}
    </UserContext.Provider>
  )
}

export function useUser() {
  const ctx = useContext(UserContext)
  if (!ctx) throw new Error('useUser must be used inside UserProvider')
  return ctx
}
