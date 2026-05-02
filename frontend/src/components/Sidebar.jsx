import { useState, useEffect } from 'react'
import { useLocation, Link, useNavigate } from 'react-router-dom'
import { Sun, Moon, BookOpen, MessageSquare, X, Settings, Globe, LogOut, User, Shield, Coins, Wallet, Megaphone } from 'lucide-react'
import { useTheme } from '../ThemeContext'
import { pointsAPI } from '../api'

const navItems = [
  { path: '/', icon: MessageSquare, label: '生成' },
  { path: '/square', icon: Globe, label: '广场' },
  { path: '/prompts', icon: BookOpen, label: '我的提示词' },
  { path: '/wallet', icon: Wallet, label: '小金库' },
  { path: '/announcements', icon: Megaphone, label: '公告' },
]

export default function Sidebar({ open, onClose }) {
  const { dark, toggle } = useTheme()
  const location = useLocation()
  const navigate = useNavigate()
  const user = JSON.parse(localStorage.getItem('user') || 'null')
  const [points, setPoints] = useState(user?.points ?? 0)

  useEffect(() => {
    pointsAPI.balance().then(res => {
      setPoints(res.data.points)
      const u = JSON.parse(localStorage.getItem('user') || 'null')
      if (u) { u.points = res.data.points; localStorage.setItem('user', JSON.stringify(u)) }
    }).catch(() => {})

    const handleUpdate = () => {
      const u = JSON.parse(localStorage.getItem('user') || 'null')
      if (u) setPoints(u.points ?? 0)
    }
    window.addEventListener('points-updated', handleUpdate)
    return () => window.removeEventListener('points-updated', handleUpdate)
  }, [])

  const handleCheckIn = async () => {
    try {
      const res = await pointsAPI.checkin()
      setPoints(res.data.points)
      const u = JSON.parse(localStorage.getItem('user') || 'null')
      if (u) { u.points = res.data.points; localStorage.setItem('user', JSON.stringify(u)) }
      window.dispatchEvent(new Event('points-updated'))
      alert(res.data.message || '签到成功')
    } catch (err) {
      alert(err.message || '签到失败')
    }
  }

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
        <div className="px-3 py-2.5 border-b" style={{ borderColor: 'var(--border-color)' }}>
          <div className="flex items-center justify-between">
            <h1 className="text-base font-semibold truncate" style={{ color: 'var(--text-primary)' }}>Atelier</h1>
            <button className="lg:hidden p-1 rounded-md hover:bg-black/10" onClick={onClose}><X size={16} /></button>
          </div>
          <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>v1.0.0</span>
        </div>
        <nav className="flex-1 px-2 py-2 space-y-0.5 overflow-y-auto">
          {navItems.map(({ path, icon: Icon, label }) => {
            const active = location.pathname === path
            return (
              <Link key={path} to={path}
                className={`flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm font-medium transition-colors duration-150 ${active ? 'bg-accent/10' : 'hover:bg-black/5'}`}
                style={{ color: active ? 'var(--accent)' : 'var(--text-primary)', backgroundColor: active ? 'var(--accent)15' : undefined }}
                onClick={() => onClose?.()}>
                <Icon size={16} />{label}
              </Link>
            )
          })}
          {user?.is_admin && (
            <>
              <Link to="/settings"
                className={`flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm font-medium transition-colors duration-150 ${location.pathname === '/settings' ? 'bg-accent/10' : 'hover:bg-black/5'}`}
                style={{ color: location.pathname === '/settings' ? 'var(--accent)' : 'var(--text-primary)', backgroundColor: location.pathname === '/settings' ? 'var(--accent)15' : undefined }}
                onClick={() => onClose?.()}>
                <Settings size={16} />设置
              </Link>
              <Link to="/admin"
                className={`flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm font-medium transition-colors duration-150 ${location.pathname === '/admin' ? 'bg-accent/10' : 'hover:bg-black/5'}`}
                style={{ color: location.pathname === '/admin' ? 'var(--accent)' : 'var(--text-primary)', backgroundColor: location.pathname === '/admin' ? 'var(--accent)15' : undefined }}
                onClick={() => onClose?.()}>
                <Shield size={16} />管理后台
              </Link>
            </>
          )}
        </nav>
        <div className="px-2 py-2 border-t space-y-0.5" style={{ borderColor: 'var(--border-color)' }}>
          {user && (
            <>
              <div className="flex items-center gap-2.5 px-2.5 py-2">
                <User size={16} style={{ color: 'var(--text-secondary)' }} />
                <span className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>{user.nickname || user.username}</span>
              </div>
              <div className="flex items-center gap-2 px-2.5 py-1.5">
                <Coins size={14} className="shrink-0" style={{ color: 'var(--accent)' }} />
                <span className="text-xs font-medium" style={{ color: 'var(--accent)' }}>{user?.is_admin ? '∞' : points}</span>
                {!user?.is_admin && (
                  <button
                    onClick={handleCheckIn}
                    className="ml-auto text-xs px-2 py-0.5 rounded transition-colors"
                    style={{ background: 'var(--accent)', color: '#fff' }}
                  >签到</button>
                )}
              </div>
            </>
          )}
          <button onClick={toggle} className="flex items-center gap-2.5 w-full px-2.5 py-2 rounded-lg text-sm font-medium hover:bg-black/5 transition-colors"
            style={{ color: 'var(--text-primary)' }}>
            {dark ? <Sun size={16} /> : <Moon size={16} />}{dark ? '浅色' : '深色'}
          </button>
          <button onClick={handleLogout} className="flex items-center gap-2.5 w-full px-2.5 py-2 rounded-lg text-sm font-medium hover:bg-black/5 transition-colors"
            style={{ color: 'var(--text-primary)' }}>
            <LogOut size={16} />退出登录
          </button>
        </div>
        <div className="px-3 py-2 border-t flex flex-wrap gap-x-1 gap-y-0.5 text-xs opacity-50" style={{ borderColor: 'var(--border-color)', color: 'var(--text-secondary)' }}>
          {!user?.is_admin && <Link to="/redeem" className="hover:underline hover:opacity-100 transition-opacity" onClick={() => onClose?.()}>兑换积分</Link>}
          {!user?.is_admin && <span>|</span>}
          <Link to="/agreement" className="hover:underline hover:opacity-100 transition-opacity" onClick={() => onClose?.()}>用户协议</Link>
          <span>|</span>
          <Link to="/privacy" className="hover:underline hover:opacity-100 transition-opacity" onClick={() => onClose?.()}>隐私政策</Link>
          <span>|</span>
          <Link to="/refund" className="hover:underline hover:opacity-100 transition-opacity" onClick={() => onClose?.()}>充值退款规则</Link>
        </div>
      </aside>
    </>
  )
}
