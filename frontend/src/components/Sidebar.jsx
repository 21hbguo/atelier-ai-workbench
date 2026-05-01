import { useLocation, Link, useNavigate } from 'react-router-dom'
import { Sun, Moon, BookOpen, MessageSquare, X, Settings, Globe, LogOut, User, Shield } from 'lucide-react'
import { useTheme } from '../ThemeContext'

const navItems = [
  { path: '/', icon: MessageSquare, label: '生成' },
  { path: '/square', icon: Globe, label: '广场' },
  { path: '/prompts', icon: BookOpen, label: '我的提示词' },
]

export default function Sidebar({ open, onClose }) {
  const { dark, toggle } = useTheme()
  const location = useLocation()
  const navigate = useNavigate()
  const user = JSON.parse(localStorage.getItem('user') || 'null')

  const handleLogout = () => {
    localStorage.removeItem('token')
    localStorage.removeItem('user')
    navigate('/login')
  }

  return (
    <>
      {open && <div className="fixed inset-0 bg-black/40 z-40 lg:hidden" onClick={onClose} />}
      <aside className={`fixed lg:static inset-y-0 left-0 z-50 w-48 flex flex-col transition-transform duration-200 ease-out ${open ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}`}
        style={{ background: 'var(--bg-sidebar)', borderRight: '1px solid var(--border-color)' }}>
        <div className="flex items-center justify-between px-3 py-2.5 border-b" style={{ borderColor: 'var(--border-color)' }}>
          <h1 className="text-sm font-semibold truncate" style={{ color: 'var(--text-primary)' }}>AI 图像</h1>
          <button className="lg:hidden p-1 rounded-md hover:bg-black/10" onClick={onClose}><X size={16} /></button>
        </div>
        <nav className="flex-1 px-2 py-2 space-y-0.5 overflow-y-auto">
          {navItems.map(({ path, icon: Icon, label }) => {
            const active = location.pathname === path
            return (
              <Link key={path} to={path}
                className={`flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-xs font-medium transition-colors duration-150 ${active ? 'bg-accent/10' : 'hover:bg-black/5'}`}
                style={{ color: active ? 'var(--accent)' : 'var(--text-primary)', backgroundColor: active ? 'var(--accent)15' : undefined }}
                onClick={() => onClose?.()}>
                <Icon size={15} />{label}
              </Link>
            )
          })}
          {user?.is_admin && (
            <>
              <Link to="/settings"
                className={`flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-xs font-medium transition-colors duration-150 ${location.pathname === '/settings' ? 'bg-accent/10' : 'hover:bg-black/5'}`}
                style={{ color: location.pathname === '/settings' ? 'var(--accent)' : 'var(--text-primary)', backgroundColor: location.pathname === '/settings' ? 'var(--accent)15' : undefined }}
                onClick={() => onClose?.()}>
                <Settings size={15} />设置
              </Link>
              <Link to="/admin"
                className={`flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-xs font-medium transition-colors duration-150 ${location.pathname === '/admin' ? 'bg-accent/10' : 'hover:bg-black/5'}`}
                style={{ color: location.pathname === '/admin' ? 'var(--accent)' : 'var(--text-primary)', backgroundColor: location.pathname === '/admin' ? 'var(--accent)15' : undefined }}
                onClick={() => onClose?.()}>
                <Shield size={15} />管理后台
              </Link>
            </>
          )}
        </nav>
        <div className="px-2 py-2 border-t space-y-0.5" style={{ borderColor: 'var(--border-color)' }}>
          {user && (
            <div className="flex items-center gap-2.5 px-2.5 py-2">
              <User size={15} style={{ color: 'var(--text-secondary)' }} />
              <span className="text-xs font-medium truncate" style={{ color: 'var(--text-primary)' }}>{user.nickname || user.username}</span>
            </div>
          )}
          <button onClick={toggle} className="flex items-center gap-2.5 w-full px-2.5 py-2 rounded-lg text-xs font-medium hover:bg-black/5 transition-colors"
            style={{ color: 'var(--text-primary)' }}>
            {dark ? <Sun size={15} /> : <Moon size={15} />}{dark ? '浅色' : '深色'}
          </button>
          <button onClick={handleLogout} className="flex items-center gap-2.5 w-full px-2.5 py-2 rounded-lg text-xs font-medium hover:bg-black/5 transition-colors"
            style={{ color: 'var(--text-primary)' }}>
            <LogOut size={15} />退出登录
          </button>
        </div>
      </aside>
    </>
  )
}
