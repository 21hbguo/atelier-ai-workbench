import { useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { Menu } from 'lucide-react'
import Sidebar from './Sidebar'

const quickNavItems = [
  { label: '生成', path: '/' },
  { label: '广场', path: '/square' },
  { label: '提示词', path: '/prompts' },
  { label: '公告', path: '/announcements' },
]

export default function MainLayout({ children, dragProps }) {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const location = useLocation()

  return (
    <div className="flex h-screen overflow-hidden" {...dragProps}>
      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      <div className="flex-1 flex flex-col min-w-0">
        <div className="flex items-center justify-between px-4 py-2 border-b lg:hidden" style={{ borderColor: 'var(--border-color)' }}>
          <button onClick={() => setSidebarOpen(true)} className="p-1" style={{ color: 'var(--text-primary)' }}><Menu size={20} /></button>
          <div className="flex items-center gap-1.5">
            {quickNavItems.map(item => {
              const isActive = item.path === '/' ? location.pathname === '/' : location.pathname.startsWith(item.path)
              return (
                <Link key={item.path} to={item.path}
                  className="px-2.5 py-1 rounded-full text-xs font-medium transition-colors"
                  style={{
                    background: isActive ? 'var(--accent)' : 'var(--border-color)',
                    color: isActive ? '#fff' : 'var(--text-secondary)'
                  }}>
                  {item.label}
                </Link>
              )
            })}
          </div>
        </div>
        {children}
      </div>
    </div>
  )
}
