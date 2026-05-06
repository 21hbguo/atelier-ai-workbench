import { useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { Menu } from 'lucide-react'
import Sidebar from './Sidebar'

const quickNavItems = [
  { label: '生成', path: '/' },
  { label: '广场', path: '/square' },
  { label: '提示词', path: '/prompts' },
  { label: '积分详情', path: '/wallet' },
  { label: '通知', path: '/notifications' },
]

export default function MainLayout({ children, dragProps }) {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const location = useLocation()

  return (
    <div className="flex h-[100dvh] overflow-hidden safe-area-bottom" {...dragProps}>
      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      <div className="flex-1 flex flex-col min-w-0 min-h-0">
        <div className="mobile-topbar-shell safe-area-top lg:hidden" style={{ borderColor: 'var(--border-color)' }}>
          <div className="mobile-topbar-inner">
            <button onClick={() => setSidebarOpen(true)} className="mobile-topbar-menu" style={{ color: 'var(--text-primary)' }}><Menu size={20} className="block" /></button>
            <div className="mobile-topbar-links scrollbar-hide" style={{ scrollbarWidth: 'none' }}>
            {quickNavItems.map(item => {
              const isActive = item.path === '/' ? location.pathname === '/' : location.pathname.startsWith(item.path)
              return (
                <Link key={item.path} to={item.path} className="mobile-topbar-link" style={{ color: isActive ? 'var(--text-primary)' : 'var(--text-secondary)', borderBottomColor: isActive ? 'var(--accent)' : 'transparent' }}>
                  <span className="mobile-topbar-link-text">{item.label}</span>
                </Link>
              )
            })}
            </div>
          </div>
        </div>
        <div className="flex-1 min-h-0 flex flex-col overflow-hidden">{children}</div>
      </div>
    </div>
  )
}
