import { createContext, useContext, useState, useEffect, type ReactNode } from 'react'
import { addPhone, fetchMe, markTutorialSeen, removePhone, skipPhonePrompt } from '../api'

export interface UserInfo {
  id: number
  name: string
  avatarUrl?: string
  bio?: string
  /** Only the caller's own record carries this, from sign-in. Absent — a
   *  session stored before the field existed — must read as "seen", so the
   *  first-run gate checks for an explicit false. */
  tutorialSeen?: boolean
  /** Own record only, like tutorialSeen: whether a username has been picked.
   *  Absent reads as picked — the gate checks for an explicit false. */
  usernameChosen?: boolean
  /** Own record only: whether the one-time phone-number prompt is answered.
   *  Absent reads as answered — the prompt checks for an explicit false. */
  phonePromptDone?: boolean
  /** Own record only: the last four digits of the verified number on file. */
  phoneLast4?: string | null
}

interface UserContextValue {
  activeUser: UserInfo | null
  setActiveUser: (user: UserInfo | null) => void
  viewingUser: UserInfo | null
  setViewingUser: (user: UserInfo | null) => void
  isViewingFriend: boolean
  /** Close out the first-run tutorial, finished or skipped. */
  completeTutorial: () => void
  /** Phone number: attach the one a Firebase verification proved (its ID
   *  token), remove it, or answer the one-time prompt with "not now". */
  addPhoneNumber: (firebaseIdToken: string) => Promise<void>
  removePhoneNumber: () => Promise<void>
  skipPhoneNumber: () => void
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

  // The account itself, behind the stored copy, whenever who's signed in
  // changes — at load and after any sign-in. The sign-in sites each pass a few
  // fields by hand, and a session stored before a field existed never learns
  // it otherwise; this is how the phone fields reach everyone. A failure keeps
  // what's stored.
  const activeId = activeUser?.id
  useEffect(() => {
    if (activeId == null) return
    let cancelled = false
    fetchMe()
      .then((me) => {
        if (cancelled) return
        setActiveUserState((prev) => (prev && prev.id === me.id ? { ...prev, ...me } : prev))
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [activeId])

  function mergeOwn(me: UserInfo) {
    setActiveUserState((prev) => (prev && prev.id === me.id ? { ...prev, ...me } : prev))
  }

  async function addPhoneNumber(firebaseIdToken: string) {
    mergeOwn(await addPhone(firebaseIdToken))
  }

  async function removePhoneNumber() {
    mergeOwn(await removePhone())
  }

  // Local first, like completeTutorial: the prompt closes on this render, and
  // a failed save only means it may ask once more.
  function skipPhoneNumber() {
    if (!activeUser) return
    setActiveUserState({ ...activeUser, phonePromptDone: true })
    skipPhonePrompt().catch(() => {})
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
        addPhoneNumber,
        removePhoneNumber,
        skipPhoneNumber,
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
