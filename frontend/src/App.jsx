import { useState, useEffect, useRef, useCallback } from 'react'
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { ThemeProvider } from './ThemeContext'
import ErrorBoundary from './components/ErrorBoundary'
import AppDialogProvider from './components/AppDialogProvider'
import { useUserSync } from './hooks/useUserSync'
import AnnouncementModal from './components/AnnouncementModal'
import { announcementAPI, authAPI } from './api'
import { clearUser, readUser, writeUser } from './auth'
import ChatPage from './pages/ChatPage'
import PromptsPage from './pages/PromptsPage'
import SettingsPage from './pages/SettingsPage'
import LoginPage from './pages/LoginPage'
import SquarePage from './pages/SquarePage'
import AdminPage from './pages/AdminPage'
import AgreementPage from './pages/AgreementPage'
import PrivacyPage from './pages/PrivacyPage'
import RefundPage from './pages/RefundPage'
import RedeemPage from './pages/RedeemPage'
import WalletPage from './pages/WalletPage'
import AnnouncementsPage from './pages/AnnouncementsPage'
import NotificationsPage from './pages/NotificationsPage'

function ProtectedRoute({ children, authReady, user }) {
  if (!authReady) return null
  if (!user) return <Navigate to="/login" replace />
  return children
}

function AdminRoute({ children, authReady, user }) {
  if (!authReady) return null
  if (!user) return <Navigate to="/login" replace />
  if (!user?.is_admin) return <Navigate to="/" replace />
  return children
}

function AnnouncementManager({ user }) {
  const location = useLocation()
  const [unreadQueue, setUnreadQueue] = useState([])
  const [currentAnnouncement, setCurrentAnnouncement] = useState(null)
  const fetchingRef = useRef(false)
  const fetchUnread = useCallback(async () => {
    if (!user || fetchingRef.current) return
    fetchingRef.current = true
    try {
      const { data } = await announcementAPI.getUnread()
      if (data.items?.length) {
        setUnreadQueue(prev => {
          const prevIds = new Set(prev.map(a => a.id))
          const newItems = data.items.filter(a => !prevIds.has(a.id))
          if (newItems.length) {
            const next = [...newItems, ...prev]
            setCurrentAnnouncement(next[0])
            return next
          }
          return prev
        })
      }
    } catch {}
    fetchingRef.current = false
  }, [user])
  useEffect(() => { if (location.pathname !== '/login') fetchUnread() }, [location.pathname, fetchUnread])
  const handleReadAnnouncement = async ann => {
    try { await announcementAPI.markRead(ann.id) } catch {}
    setUnreadQueue(prev => { const next = prev.slice(1); setCurrentAnnouncement(next.length ? next[0] : null); return next })
  }
  return <AnnouncementModal announcement={currentAnnouncement} onRead={handleReadAnnouncement} onClose={() => setCurrentAnnouncement(null)} />
}

function AppContent() {
  const [user, setUser] = useState(readUser())
  const [authReady, setAuthReady] = useState(false)
  useUserSync()
  useEffect(() => {
    let active = true
    const sync = () => active && setUser(readUser())
    const bootstrap = async () => {
      try {
        const { data } = await authAPI.me()
        writeUser(data)
      } catch {
        try {
          const { data } = await authAPI.refresh()
          if (data?.user) writeUser(data.user)
          const me = await authAPI.me()
          writeUser(me.data)
        } catch {
          clearUser()
        }
      } finally {
        if (active) { sync(); setAuthReady(true) }
      }
    }
    bootstrap()
    window.addEventListener('auth-changed', sync)
    return () => { active = false; window.removeEventListener('auth-changed', sync) }
  }, [])
  return (
    <ErrorBoundary>
    <ThemeProvider>
      <AppDialogProvider>
      <BrowserRouter>
        <AnnouncementManager user={user} />
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/agreement" element={<AgreementPage />} />
          <Route path="/privacy" element={<PrivacyPage />} />
          <Route path="/refund" element={<RefundPage />} />
          <Route path="/redeem" element={<ProtectedRoute authReady={authReady} user={user}><RedeemPage /></ProtectedRoute>} />
          <Route path="/wallet" element={<ProtectedRoute authReady={authReady} user={user}><WalletPage /></ProtectedRoute>} />
          <Route path="/notifications" element={<ProtectedRoute authReady={authReady} user={user}><NotificationsPage /></ProtectedRoute>} />
          <Route path="/announcements" element={<ProtectedRoute authReady={authReady} user={user}><AnnouncementsPage /></ProtectedRoute>} />
          <Route path="/" element={<ProtectedRoute authReady={authReady} user={user}><ChatPage /></ProtectedRoute>} />
          <Route path="/square" element={<ProtectedRoute authReady={authReady} user={user}><SquarePage /></ProtectedRoute>} />
          <Route path="/prompts" element={<ProtectedRoute authReady={authReady} user={user}><PromptsPage /></ProtectedRoute>} />
          <Route path="/settings" element={<AdminRoute authReady={authReady} user={user}><SettingsPage /></AdminRoute>} />
          <Route path="/admin" element={<AdminRoute authReady={authReady} user={user}><AdminPage /></AdminRoute>} />
        </Routes>
      </BrowserRouter>
      </AppDialogProvider>
    </ThemeProvider>
    </ErrorBoundary>
  )
}

export default function App() { return <AppContent /> }
