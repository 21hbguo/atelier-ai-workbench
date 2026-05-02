import { useState, useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
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

function AppContent() {
  useUserSync()
  const [unreadQueue, setUnreadQueue] = useState([])
  const [currentAnnouncement, setCurrentAnnouncement] = useState(null)

  useEffect(() => {
    const token = localStorage.getItem('token')
    if (!token) return
    announcementAPI.getUnread().then(({ data }) => {
      if (data.items?.length) {
        setUnreadQueue(data.items)
        setCurrentAnnouncement(data.items[0])
      }
    }).catch(() => {})
  }, [])

  const handleReadAnnouncement = async (ann) => {
    try {
      await announcementAPI.markRead(ann.id)
    } catch {}
    const next = unreadQueue.slice(1)
    setUnreadQueue(next)
    setCurrentAnnouncement(next.length ? next[0] : null)
  }

  return (
    <ErrorBoundary>
    <ThemeProvider>
      <BrowserRouter>
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
      <AnnouncementModal announcement={currentAnnouncement} onRead={handleReadAnnouncement} onClose={() => setCurrentAnnouncement(null)} />
    </ThemeProvider>
    </ErrorBoundary>
  )
}

export default function App() {
  return <AppContent />
}
