import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { ThemeProvider } from './ThemeContext'
import ChatPage from './pages/ChatPage'
import GalleryPage from './pages/GalleryPage'
import PromptsPage from './pages/PromptsPage'
import SettingsPage from './pages/SettingsPage'
import LoginPage from './pages/LoginPage'
import SquarePage from './pages/SquarePage'
import AdminPage from './pages/AdminPage'

function ProtectedRoute({ children }) {
  const token = localStorage.getItem('token')
  if (!token) return <Navigate to="/login" replace />
  return children
}

export default function App() {
  return (
    <ThemeProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/" element={<ProtectedRoute><ChatPage /></ProtectedRoute>} />
          <Route path="/gallery" element={<ProtectedRoute><GalleryPage /></ProtectedRoute>} />
          <Route path="/square" element={<ProtectedRoute><SquarePage /></ProtectedRoute>} />
          <Route path="/prompts" element={<ProtectedRoute><PromptsPage /></ProtectedRoute>} />
          <Route path="/settings" element={<ProtectedRoute><SettingsPage /></ProtectedRoute>} />
          <Route path="/admin" element={<ProtectedRoute><AdminPage /></ProtectedRoute>} />
        </Routes>
      </BrowserRouter>
    </ThemeProvider>
  )
}
