import { createContext, useContext, useState, useEffect, type ReactNode } from 'react'

interface UserInfo {
  id: number
  name: string
  avatarUrl?: string
}

interface UserContextValue {
  // Who you ARE on this device (persisted to localStorage)
  activeUser: UserInfo
  setActiveUser: (user: UserInfo) => void
  // Whose data you're currently VIEWING (yourself or a friend)
  viewingUser: UserInfo
  setViewingUser: (user: UserInfo) => void
  isViewingFriend: boolean
}

const UserContext = createContext<UserContextValue | null>(null)

const STORAGE_KEY = 'pressd_active_user'
const DEFAULT_USER: UserInfo = { id: 1, name: 'Jack' }

export function UserProvider({ children }: { children: ReactNode }) {
  const [activeUser, setActiveUserState] = useState<UserInfo>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY)
      if (stored) return JSON.parse(stored) as UserInfo
    } catch {
      // ignore
    }
    return DEFAULT_USER
  })

  const [viewingUser, setViewingUser] = useState<UserInfo>(activeUser)

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(activeUser))
    // When active user changes, reset viewing to self
    setViewingUser(activeUser)
  }, [activeUser])

  function setActiveUser(user: UserInfo) {
    setActiveUserState(user)
  }

  return (
    <UserContext.Provider
      value={{
        activeUser,
        setActiveUser,
        viewingUser,
        setViewingUser,
        isViewingFriend: viewingUser.id !== activeUser.id,
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
