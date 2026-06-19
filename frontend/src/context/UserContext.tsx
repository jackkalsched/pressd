import { createContext, useContext, useState, useEffect, type ReactNode } from 'react'

export interface UserInfo {
  id: number
  name: string
  avatarUrl?: string
}

interface UserContextValue {
  activeUser: UserInfo | null
  setActiveUser: (user: UserInfo | null) => void
  viewingUser: UserInfo | null
  setViewingUser: (user: UserInfo) => void
  isViewingFriend: boolean
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

  function signOut() {
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
