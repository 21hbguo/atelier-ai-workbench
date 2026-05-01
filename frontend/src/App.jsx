import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { ThemeProvider } from './ThemeContext'
import ChatPage from './pages/ChatPage'
import GalleryPage from './pages/GalleryPage'
import PromptsPage from './pages/PromptsPage'
import TasksPage from './pages/TasksPage'
import StatsPage from './pages/StatsPage'
import SettingsPage from './pages/SettingsPage'

export default function App() {
  return (
    <ThemeProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<ChatPage />} />
          <Route path="/gallery" element={<GalleryPage />} />
          <Route path="/prompts" element={<PromptsPage />} />
          <Route path="/tasks" element={<TasksPage />} />
          <Route path="/stats" element={<StatsPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Routes>
      </BrowserRouter>
    </ThemeProvider>
  )
}
