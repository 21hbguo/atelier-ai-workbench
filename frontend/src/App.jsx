import { useState, useEffect, useRef, useCallback } from 'react'
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { ThemeProvider } from './ThemeContext'
import ErrorBoundary from './components/ErrorBoundary'
import { useUserSync } from './hooks/useUserSync'
import AnnouncementModal from './components/AnnouncementModal'
import { announcementAPI } from './api'
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

function ProtectedRoute({ children }) {
  const token = localStorage.getItem('token')
  if (!token) return <Navigate to="/login" replace />
  return children
}

function AdminRoute({ children }) {
  const token = localStorage.getItem('token')
  const user = JSON.parse(localStorage.getItem('user') || 'null')
  if (!token) return <Navigate to="/login" replace />
  if (!user?.is_admin) return <Navigate to="/" replace />
  return children
}

function AnnouncementManager() {
  const location = useLocation()
  const [unreadQueue, setUnreadQueue] = useState([])
  const [currentAnnouncement, setCurrentAnnouncement] = useState(null)
  const fetchingRef = useRef(false)

  const fetchUnread = useCallback(async () => {
    const token = localStorage.getItem('token')
    if (!token || fetchingRef.current) return
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
  }, [])

  useEffect(() => {
    if (location.pathname === '/login') return
    fetchUnread()
  }, [location.pathname, fetchUnread])

  const handleReadAnnouncement = async (ann) => {
    try {
      await announcementAPI.markRead(ann.id)
    } catch {}
    setUnreadQueue(prev => {
      const next = prev.slice(1)
      setCurrentAnnouncement(next.length ? next[0] : null)
      return next
    })
  }

  return <AnnouncementModal announcement={currentAnnouncement} onRead={handleReadAnnouncement} onClose={() => setCurrentAnnouncement(null)} />
}

function AppContent() {
  useUserSync()

  return (
    <ErrorBoundary>
    <ThemeProvider>
      <BrowserRouter>
        <AnnouncementManager />
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/agreement" element={<AgreementPage />} />
          <Route path="/privacy" element={<PrivacyPage />} />
          <Route path="/refund" element={<RefundPage />} />
          <Route path="/redeem" element={<ProtectedRoute><RedeemPage /></ProtectedRoute>} />
          <Route path="/wallet" element={<ProtectedRoute><WalletPage /></ProtectedRoute>} />
          <Route path="/announcements" element={<ProtectedRoute><AnnouncementsPage /></ProtectedRoute>} />
          <Route path="/" element={<ProtectedRoute><ChatPage /></ProtectedRoute>} />
          <Route path="/square" element={<ProtectedRoute><SquarePage /></ProtectedRoute>} />
          <Route path="/prompts" element={<ProtectedRoute><PromptsPage /></ProtectedRoute>} />
          <Route path="/settings" element={<AdminRoute><SettingsPage /></AdminRoute>} />
          <Route path="/admin" element={<AdminRoute><AdminPage /></AdminRoute>} />
        </Routes>
      </BrowserRouter>
    </ThemeProvider>
    </ErrorBoundary>
  )
}

export default function App() {
  return <AppContent />
}
