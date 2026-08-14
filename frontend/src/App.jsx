import { useState, useEffect, useRef, useCallback, lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { ThemeProvider } from './ThemeContext'
import { LayoutModeProvider } from './LayoutModeContext'
import ErrorBoundary from './components/ErrorBoundary'
import AppDialogProvider from './components/AppDialogProvider'
import { useUserSync } from './hooks/useUserSync'
import { useVersionSync } from './hooks/useVersionSync'
import AnnouncementModal from './components/AnnouncementModal'
import WelcomeModal from './components/WelcomeModal'
import VersionUpdateBanner from './components/VersionUpdateBanner'
import NotificationsModal from './components/NotificationsModal'
import { announcementAPI, authAPI } from './api'
import { clearUser, readUser, writeUser } from './auth'
import ChatPage from './pages/ChatPage'
const WorksPage = lazy(() => import('./pages/WorksPage'))
const PromptsPage = lazy(() => import('./pages/PromptsPage'))
const SettingsPage = lazy(() => import('./pages/SettingsPage'))
const LoginPage = lazy(() => import('./pages/LoginPage'))
const SquarePage = lazy(() => import('./pages/SquarePage'))
const AdminPage = lazy(() => import('./pages/AdminPage'))
const AgreementPage = lazy(() => import('./pages/AgreementPage'))
const PrivacyPage = lazy(() => import('./pages/PrivacyPage'))
const RefundPage = lazy(() => import('./pages/RefundPage'))
const RedeemPage = lazy(() => import('./pages/RedeemPage'))
const WalletPage = lazy(() => import('./pages/WalletPage'))
const AccountPage = lazy(() => import('./pages/AccountPage'))
const ChatAssistantPage = lazy(() => import('./pages/ChatAssistantPage'))
const GroupBuyTeamPage = lazy(() => import('./pages/GroupBuyTeamPage'))
const SharesPage = lazy(() => import('./pages/SharesPage'))

function ProtectedRoute({ children, authReady, user, fallback }) {
  if (!authReady) return fallback || null
  if (!user) return <Navigate to="/login" replace />
  return children
}

function AdminRoute({ children, authReady, user, fallback }) {
  if (!authReady) return fallback || null
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
  const cachedUser = readUser()
  const [user, setUser] = useState(cachedUser)
  const [authReady, setAuthReady] = useState(!!cachedUser)
  const [welcomePoints, setWelcomePoints] = useState(null)
  useUserSync()
  const versionSync = useVersionSync()
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

  useEffect(() => {
    if (!authReady || !user) return
    try {
      const raw = localStorage.getItem('just_registered')
      if (raw) {
        const { points } = JSON.parse(raw)
        if (points > 0) setWelcomePoints(points)
        localStorage.removeItem('just_registered')
      }
    } catch { localStorage.removeItem('just_registered') }
  }, [authReady, user])
  const routeFallback = <div className="min-h-screen flex items-center justify-center text-sm app-route-loading" style={{ color: 'var(--text-secondary)' }}>加载中...</div>
  return (
    <ErrorBoundary>
    <ThemeProvider>
      <LayoutModeProvider>
      <AppDialogProvider>
      <BrowserRouter>
        <AnnouncementManager user={user} />
        <WelcomeModal points={welcomePoints} onClose={() => setWelcomePoints(null)} />
        <VersionUpdateBanner show={versionSync.updateAvailable} onRefresh={versionSync.reloadNow} />
        <NotificationsModal />
        <Suspense fallback={routeFallback}><Routes>
          {/* 已登录用户访问 /login 直接跳到 /chat */}
          <Route path="/login" element={
            authReady && user ? <Navigate to="/chat" replace /> : <LoginPage />
          } />
          <Route path="/agreement" element={<AgreementPage />} />
          <Route path="/privacy" element={<PrivacyPage />} />
          <Route path="/refund" element={<RefundPage />} />
          <Route path="/redeem" element={<ProtectedRoute authReady={authReady} user={user} fallback={routeFallback}><RedeemPage /></ProtectedRoute>} />
          <Route path="/wallet" element={<ProtectedRoute authReady={authReady} user={user} fallback={routeFallback}><WalletPage /></ProtectedRoute>} />
          <Route path="/account" element={<ProtectedRoute authReady={authReady} user={user} fallback={routeFallback}><AccountPage /></ProtectedRoute>} />
          <Route path="/settings" element={<ProtectedRoute authReady={authReady} user={user} fallback={routeFallback}><SettingsPage /></ProtectedRoute>} />
          <Route path="/chat" element={<ProtectedRoute authReady={authReady} user={user} fallback={routeFallback}><ChatAssistantPage /></ProtectedRoute>} />
          <Route path="/group-buy/team/:teamId" element={<GroupBuyTeamPage />} />
          {/* 通知已改为全局弹窗（NotificationsModal），旧链接重定向到聊天页 */}
          <Route path="/notifications" element={<Navigate to="/chat" replace />} />
          <Route path="/announcements" element={<Navigate to="/chat" replace />} />
          {/* 根路径：已登录跳 /chat，未登录跳 /login（落地页已摘除，LandingPage.jsx 仅保留源码） */}
          <Route path="/" element={
            !authReady ? routeFallback :
            user ? <Navigate to="/chat" replace /> : <Navigate to="/login" replace />
          } />
          <Route path="/draw" element={<ProtectedRoute authReady={authReady} user={user} fallback={routeFallback}><ChatPage /></ProtectedRoute>} />
          <Route path="/works" element={<ProtectedRoute authReady={authReady} user={user} fallback={routeFallback}><WorksPage /></ProtectedRoute>} />
          <Route path="/square" element={<ProtectedRoute authReady={authReady} user={user} fallback={routeFallback}><SquarePage /></ProtectedRoute>} />
          <Route path="/prompts" element={<ProtectedRoute authReady={authReady} user={user} fallback={routeFallback}><PromptsPage /></ProtectedRoute>} />
          <Route path="/favorites" element={<ProtectedRoute authReady={authReady} user={user} fallback={routeFallback}><Navigate to="/square" state={{ tab: 'favorites' }} replace /></ProtectedRoute>} />
          {/* <Route path="/shares" element={<ProtectedRoute authReady={authReady} user={user}><SharesPage /></ProtectedRoute>} /> */}
          <Route path="/admin" element={<AdminRoute authReady={authReady} user={user} fallback={routeFallback}><AdminPage /></AdminRoute>} />
        </Routes></Suspense>
      </BrowserRouter>
      </AppDialogProvider>
      </LayoutModeProvider>
    </ThemeProvider>
    </ErrorBoundary>
  )
}

export default function App() { return <AppContent /> }
