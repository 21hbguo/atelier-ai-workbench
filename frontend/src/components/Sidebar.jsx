import { useState, useEffect } from 'react'
import { useLocation, Link, useNavigate } from 'react-router-dom'
import { Sun, Moon, BookOpen, Sparkles, Image, X, Globe, LogOut, User, Shield, Coins, Wallet, Bell, Settings, LayoutGrid, MessageCircle } from 'lucide-react'
import { useTheme } from '../ThemeContext'
import { useLayoutMode } from '../LayoutModeContext'
import { announcementAPI, authAPI, pointsAPI, notificationAPI } from '../api'
import { clearUser, readUser } from '../auth'
import { useAppDialog } from './AppDialogProvider'

const navItems = [
  { path: '/', icon: Sparkles, label: 'AI绘画' },
  { path: '/chat', icon: MessageCircle, label: 'AI 助手' },
  { path: '/works', icon: Image, label: '我的作品' },
  { path: '/square', icon: Globe, label: '广场' },
  { path: '/prompts', icon: BookOpen, label: '我的提示词' },
  { path: '/wallet', icon: Wallet, label: '积分详情' },
  { path: '/notifications', icon: Bell, label: '通知' },
  // { path: '/shares', icon: Share2, label: '分享管理' },
  // { path: '/settings', icon: Settings, label: '账号安全' },
]

export default function Sidebar({ open, onClose }) {
  const dialog = useAppDialog()
  const { dark, toggle } = useTheme()
  const { layoutMode, toggleLayoutMode, currentCols, currentBreakpointLabel, toggleCurrentCols } = useLayoutMode()
  const location = useLocation()
  const navigate = useNavigate()
  const user = readUser()
  const isAdmin = Boolean(user?.is_admin)
  const [points, setPoints] = useState(user?.points ?? 0)
  const [checkedInToday, setCheckedInToday] = useState(false)
  const [unreadNoticeCount, setUnreadNoticeCount] = useState(0)
  const [rechargePendingCount, setRechargePendingCount] = useState(0)

  useEffect(() => {
    pointsAPI.balance().then(res => {
      setPoints(res.data.points)
      const u = readUser()
      if (u) { u.points = res.data.points; localStorage.setItem('user', JSON.stringify(u)) }
    }).catch(() => {})

    pointsAPI.checkinStatus().then(res => {
      setCheckedInToday(res.data.checked_in_today)
    }).catch(() => {})
    Promise.allSettled([notificationAPI.unreadCount(),announcementAPI.getUnread()]).then(([noticeRes,annRes])=>setUnreadNoticeCount((noticeRes.status==='fulfilled'?(noticeRes.value.data.count||0):0)+(annRes.status==='fulfilled'?((annRes.value.data.items||[]).length):0))).catch(() => {})
    if (isAdmin) fetch('/api/admin/recharge-requests?page=1&size=1&status=pending',{ credentials:'include' }).then(r=>r.ok?r.json():null).then(data=>setRechargePendingCount(data?.total||0)).catch(()=>{})

    const handleUpdate = () => {
      const u = readUser()
      if (u) setPoints(u.points ?? 0)
    }
    const handleNoticeUpdate = () => Promise.allSettled([notificationAPI.unreadCount(),announcementAPI.getUnread()]).then(([noticeRes,annRes])=>setUnreadNoticeCount((noticeRes.status==='fulfilled'?(noticeRes.value.data.count||0):0)+(annRes.status==='fulfilled'?((annRes.value.data.items||[]).length):0))).catch(() => {})
    const handleRechargeUpdate = e => setRechargePendingCount(Number(e?.detail?.pending)||0)
    window.addEventListener('points-updated', handleUpdate)
    window.addEventListener('notifications-updated', handleNoticeUpdate)
    window.addEventListener('admin-recharge-updated', handleRechargeUpdate)
    return () => { window.removeEventListener('points-updated', handleUpdate); window.removeEventListener('notifications-updated', handleNoticeUpdate); window.removeEventListener('admin-recharge-updated', handleRechargeUpdate) }
  }, [isAdmin])

  const handleCheckIn = async () => {
    try {
      const res = await pointsAPI.checkin()
      setPoints(res.data.points)
      setCheckedInToday(true)
      const u = readUser()
      if (u) { u.points = res.data.points; localStorage.setItem('user', JSON.stringify(u)) }
      window.dispatchEvent(new Event('points-updated'))
      dialog.alert(res.data.message || '签到成功')
    } catch (err) {
      dialog.alert(err.message || '签到失败')
    }
  }

  const handleLogout = () => {
    authAPI.logout().catch(() => {}).finally(() => { clearUser(); navigate('/login') })
  }

  return (
    <>
      {open && <div className="fixed inset-0 bg-black/40 z-40 lg:hidden" onClick={onClose} />}
      <aside className={`fixed lg:static inset-y-0 left-0 z-50 w-40 flex flex-col transition-transform duration-200 ease-out ${open ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}`}
        style={{ background: 'var(--bg-sidebar)', borderRight: '1px solid var(--border-color)' }}>
        <div className="h-11 px-3 border-b flex items-center" style={{ borderColor: 'var(--border-color)' }}>
          <h1 className="flex-1 truncate" style={{ color: 'var(--text-primary)', fontFamily: "'Alex Brush', cursive", fontSize: '2.5rem', lineHeight: '1' }}>Atelier</h1>
          <button className="lg:hidden p-1 rounded-lg hover:bg-[var(--bg-hover)]" onClick={onClose}><X size={16} /></button>
        </div>
        <nav className="flex-1 px-2 py-2 space-y-0.5 overflow-y-auto">
          {navItems.map(({ path, icon: Icon, label }) => {
            const active = location.pathname === path
            return (
            <Link key={path} to={path}
                className={`sidebar-nav-link ${active ? 'bg-accent/10' : 'hover:bg-bg-hover'}`}
                style={{ color: active ? 'var(--accent)' : 'var(--text-primary)', backgroundColor: active ? 'color-mix(in srgb, var(--accent) 10%, transparent)' : undefined }}
                onClick={() => onClose?.()}>
                <Icon size={16} className="sidebar-nav-icon" /><span className="sidebar-nav-text">{label}</span>{path==='/notifications'&&unreadNoticeCount>0&&<span className="ml-auto text-[10px] px-1.5 py-0.5 rounded-full text-white" style={{background:'var(--accent)'}}>{unreadNoticeCount>99?'99+':unreadNoticeCount}</span>}
              </Link>
            )
          })}
          {isAdmin && (
            <Link to="/admin"
              className={`sidebar-nav-link ${location.pathname === '/admin' ? 'bg-accent/10' : 'hover:bg-bg-hover'}`}
              style={{ color: location.pathname === '/admin' ? 'var(--accent)' : 'var(--text-primary)', backgroundColor: location.pathname === '/admin' ? 'color-mix(in srgb, var(--accent) 10%, transparent)' : undefined }}
              onClick={() => onClose?.()}>
              <Shield size={16} className="sidebar-nav-icon" /><span className="sidebar-nav-text">管理后台</span>
            </Link>
          )}
          {isAdmin && (
            <Link to="/admin?tab=recharge_review"
              className={`sidebar-nav-link ${(location.pathname === '/admin' && new URLSearchParams(location.search).get('tab') === 'recharge_review') ? 'bg-accent/10' : 'hover:bg-bg-hover'}`}
              style={{ color: (location.pathname === '/admin' && new URLSearchParams(location.search).get('tab') === 'recharge_review') ? 'var(--accent)' : 'var(--text-primary)', backgroundColor: (location.pathname === '/admin' && new URLSearchParams(location.search).get('tab') === 'recharge_review') ? 'color-mix(in srgb, var(--accent) 10%, transparent)' : undefined }}
              onClick={() => onClose?.()}>
              <Wallet size={16} className="sidebar-nav-icon" /><span className="sidebar-nav-text">充值审核</span>{rechargePendingCount>0&&<span className="ml-auto text-[10px] px-1.5 py-0.5 rounded-full text-white" style={{background:'var(--color-error)'}}>{rechargePendingCount>99?'99+':rechargePendingCount}</span>}
            </Link>
          )}
        </nav>
        <div className="px-2 py-2 border-t space-y-0.5" style={{ borderColor: 'var(--border-color)' }}>
          {user && (
            <div className="sidebar-user-row">
              <User size={16} className="sidebar-nav-icon" style={{ color: 'var(--text-secondary)' }} />
              <span className="sidebar-nav-text text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>{user.nickname || user.account || user.username}</span>
            </div>
          )}
          <button onClick={toggle} className="sidebar-control-btn hover:bg-bg-hover"
            style={{ color: 'var(--text-primary)' }}>
            {dark ? <Sun size={16} className="sidebar-nav-icon" /> : <Moon size={16} className="sidebar-nav-icon" />}<span className="sidebar-nav-text">{dark ? '浅色' : '深色'}</span>
          </button>
          <button onClick={toggleLayoutMode} className="sidebar-control-btn hover:bg-bg-hover"
            style={{ color: 'var(--text-primary)' }}>
            <LayoutGrid size={16} className="sidebar-nav-icon" /><span className="sidebar-nav-text">{layoutMode === 'masonry' ? '切换为网格' : '切换为瀑布流'}</span>
          </button>
          <button onClick={toggleCurrentCols} className="sidebar-control-btn hover:bg-bg-hover"
            style={{ color: 'var(--text-primary)' }}>
            <LayoutGrid size={16} className="sidebar-nav-icon" /><span className="sidebar-nav-text">{currentBreakpointLabel}列数 {currentCols}列</span>
          </button>
          <button onClick={handleLogout} className="sidebar-control-btn hover:bg-bg-hover"
            style={{ color: 'var(--text-primary)' }}>
            <LogOut size={16} className="sidebar-nav-icon" /><span className="sidebar-nav-text">退出登录</span>
          </button>
        </div>
        <div className="px-3 py-2 border-t flex flex-wrap gap-x-1 gap-y-0.5 text-xs opacity-50" style={{ borderColor: 'var(--border-color)', color: 'var(--text-secondary)' }}>
          <Link to="/wallet" className="hover:underline hover:opacity-100 transition-opacity" onClick={() => onClose?.()}>积分详情</Link>
          <span>|</span>
          <Link to="/agreement" className="hover:underline hover:opacity-100 transition-opacity" onClick={() => onClose?.()}>用户协议</Link>
          <span>|</span>
          <Link to="/privacy" className="hover:underline hover:opacity-100 transition-opacity" onClick={() => onClose?.()}>隐私政策</Link>
          <span>|</span>
          <Link to="/refund" className="hover:underline hover:opacity-100 transition-opacity" onClick={() => onClose?.()}>捐赠说明与积分规则</Link>
        </div>
      </aside>
    </>
  )
}
