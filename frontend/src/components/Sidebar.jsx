import { useState, useEffect } from 'react'
import { useLocation, Link, useNavigate } from 'react-router-dom'
import { Sun, Moon, BookOpen, Sparkles, Image, X, Globe, LogOut, User, Shield, Crown, Wallet, Settings, LayoutGrid, MessageCircle, Bell, PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import { useTheme } from '../ThemeContext'
import { useLayoutMode } from '../LayoutModeContext'
import { announcementAPI, authAPI, pointsAPI, notificationAPI, subscriptionAPI } from '../api'
import { clearUser, readUser } from '../auth'
import { useAppDialog } from './AppDialogProvider'
import SubscriptionDialog from './SubscriptionDialog'

const formatDate = ts => {
  if (!ts) return ''
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return ''
  const pad = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

const navItems = [
  { path: '/chat', icon: MessageCircle, label: 'AI 助手', shortLabel: '助手' },
  { path: '/draw', icon: Sparkles, label: 'AI 绘画', shortLabel: '绘画' },
]

const subNavItems = [
  { path: '/draw', icon: Sparkles, label: '画图' },
  { path: '/works', icon: Image, label: '我的作品' },
  { path: '/square', icon: Globe, label: '广场' },
  { path: '/prompts', icon: BookOpen, label: '我的提示词' },
  { path: '/notifications', icon: Bell, label: '通知' },
]

const SUB_NAV_PATHS = ['/draw', '/works', '/square', '/prompts', '/notifications']

export default function Sidebar({ open, onClose }) {
  const dialog = useAppDialog()
  const { dark, toggle } = useTheme()
  const { layoutMode, toggleLayoutMode, currentCols, currentBreakpointLabel, toggleCurrentCols } = useLayoutMode()
  const location = useLocation()
  const navigate = useNavigate()
  const user = readUser()
  const isAdmin = Boolean(user?.is_admin)
  const [points, setPoints] = useState(user?.points ?? 0)
  const [dailyRemaining, setDailyRemaining] = useState(0)
  const [dailyTotal, setDailyTotal] = useState(0)
  const [checkedInToday, setCheckedInToday] = useState(false)
  const [rechargePendingCount, setRechargePendingCount] = useState(0)
  const [unreadNoticeCount, setUnreadNoticeCount] = useState(0)
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('nav-collapsed') === '1')
  const [subscription, setSubscription] = useState(null)
  const [subOpen, setSubOpen] = useState(false)

  useEffect(() => {
    localStorage.setItem('nav-collapsed', collapsed ? '1' : '0')
  }, [collapsed])

  useEffect(() => {
    pointsAPI.balance().then(res => {
      setPoints(res.data.points)
      setDailyRemaining(res.data?.ai_daily_remaining === null ? null : Number(res.data?.ai_daily_remaining || 0))
      setDailyTotal(res.data?.ai_daily_total === null ? null : Number(res.data?.ai_daily_total || 0))
      const u = readUser()
      if (u) { u.points = res.data.points; localStorage.setItem('user', JSON.stringify(u)) }
    }).catch(() => {})

    pointsAPI.checkinStatus().then(res => {
      setCheckedInToday(res.data.checked_in_today)
    }).catch(() => {})
    Promise.allSettled([notificationAPI.unreadCount(), announcementAPI.getUnread()]).then(([noticeRes, annRes])=>setUnreadNoticeCount((noticeRes.status==='fulfilled'?(noticeRes.value.data.count||0):0)+(annRes.status==='fulfilled'?((annRes.value.data.items||[]).length):0))).catch(() => {})
    if (isAdmin) fetch('/api/admin/recharge-requests?page=1&size=1&status=pending',{ credentials:'include' }).then(r=>r.ok?r.json():null).then(data=>setRechargePendingCount(data?.total||0)).catch(()=>{})
    subscriptionAPI.me().then(res => setSubscription(res.data)).catch(() => {})

    const handleUpdate = () => {
      const u = readUser()
      if (u) setPoints(u.points ?? 0)
      pointsAPI.balance().then(res => { setDailyRemaining(res.data?.ai_daily_remaining === null ? null : Number(res.data?.ai_daily_remaining || 0)); setDailyTotal(res.data?.ai_daily_total === null ? null : Number(res.data?.ai_daily_total || 0)) }).catch(() => {})
    }
    const handleSubscriptionUpdate = () => subscriptionAPI.me().then(res => setSubscription(res.data)).catch(() => {})
    const handleNoticeUpdate = () => Promise.allSettled([notificationAPI.unreadCount(),announcementAPI.getUnread()]).then(([noticeRes,annRes])=>setUnreadNoticeCount((noticeRes.status==='fulfilled'?(noticeRes.value.data.count||0):0)+(annRes.status==='fulfilled'?((annRes.value.data.items||[]).length):0))).catch(() => {})
    const handleRechargeUpdate = e => setRechargePendingCount(Number(e?.detail?.pending)||0)
    window.addEventListener('points-updated', handleUpdate)
    window.addEventListener('subscriptions-updated', handleSubscriptionUpdate)
    window.addEventListener('notifications-updated', handleNoticeUpdate)
    window.addEventListener('admin-recharge-updated', handleRechargeUpdate)
    return () => { window.removeEventListener('points-updated', handleUpdate); window.removeEventListener('subscriptions-updated', handleSubscriptionUpdate); window.removeEventListener('notifications-updated', handleNoticeUpdate); window.removeEventListener('admin-recharge-updated', handleRechargeUpdate) }
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

  const subNavVisible = SUB_NAV_PATHS.includes(location.pathname)

  return (
    <>
      {open && <div className="fixed inset-0 bg-black/40 z-40 lg:hidden" onClick={onClose} />}
      <div className={`fixed lg:static inset-y-0 left-0 z-50 flex transition-transform duration-200 ease-out ${open ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}`}>
        <aside className={`${collapsed ? 'w-16' : 'w-40'} flex flex-col flex-shrink-0 transition-all duration-200 ease-out`}
          style={{ background: 'var(--bg-sidebar)', borderRight: '1px solid var(--border-color)' }}>
          <div className={`px-2 py-1.5 flex items-center ${collapsed ? 'justify-center' : ''}`}>
            <div className={`flex-1 min-w-0 ${collapsed ? 'hidden' : 'flex flex-col'}`}>
              <h1 className="font-extrabold tracking-tight"
                style={{ fontSize: '1.5rem', lineHeight: '1', backgroundImage: 'linear-gradient(135deg, var(--text-primary) 30%, color-mix(in srgb, var(--accent) 65%, var(--text-primary)))', WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent' }}>Atelier-ai</h1>
              <span className="text-[10px] leading-none mt-1" style={{ color: 'var(--text-secondary)' }}>你的专属工作台</span>
            </div>
            <button className={`hidden lg:flex p-1 rounded-lg hover:bg-[var(--bg-hover)] ${collapsed ? '' : 'ml-1'}`}
              onClick={() => setCollapsed(v => !v)}
              title={collapsed ? '展开侧边栏' : '折叠侧边栏'}
              style={{ color: 'var(--text-secondary)' }}>
              {collapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
            </button>
            <button className="lg:hidden p-1 rounded-lg hover:bg-[var(--bg-hover)]" onClick={onClose}><X size={16} /></button>
          </div>
          <nav className="flex-1 px-2 py-2 space-y-0.5 overflow-y-auto">
            {navItems.map(({ path, icon: Icon, label, shortLabel }) => {
              const active = location.pathname === path
              const groupActive = path === '/draw' && subNavVisible && !active
              return (
                <Link key={path} to={path}
                  className={`sidebar-nav-link ${collapsed ? 'flex-col items-center !h-auto !gap-0.5 !py-1 text-center' : ''} ${(active || groupActive) ? 'bg-accent/10' : 'hover:bg-bg-hover'}`}
                  style={{ color: (active || groupActive) ? 'var(--accent)' : 'var(--text-primary)', backgroundColor: (active || groupActive) ? 'color-mix(in srgb, var(--accent) 10%, transparent)' : undefined }}
                  onClick={() => onClose?.()}>
                  <Icon size={16} className="sidebar-nav-icon" /><span className={`sidebar-nav-text ${collapsed ? 'text-[10px] leading-none truncate max-w-full' : ''}`}>{collapsed ? shortLabel : label}</span>
                </Link>
              )
            })}
            {isAdmin && (
              <Link to="/admin"
                className={`sidebar-nav-link ${collapsed ? 'flex-col items-center !h-auto !gap-0.5 !py-1 text-center' : ''} ${location.pathname === '/admin' ? 'bg-accent/10' : 'hover:bg-bg-hover'}`}
                style={{ color: location.pathname === '/admin' ? 'var(--accent)' : 'var(--text-primary)', backgroundColor: location.pathname === '/admin' ? 'color-mix(in srgb, var(--accent) 10%, transparent)' : undefined }}
                onClick={() => onClose?.()}>
                <Shield size={16} className="sidebar-nav-icon" /><span className={`sidebar-nav-text ${collapsed ? 'text-[10px] leading-none truncate max-w-full' : ''}`}>{collapsed ? '后台' : '管理后台'}</span>
              </Link>
            )}
            {isAdmin && (
              <Link to="/admin?tab=recharge_review"
                className={`sidebar-nav-link ${collapsed ? 'flex-col items-center !h-auto !gap-0.5 !py-1 text-center' : ''} ${(location.pathname === '/admin' && new URLSearchParams(location.search).get('tab') === 'recharge_review') ? 'bg-accent/10' : 'hover:bg-bg-hover'}`}
                style={{ color: (location.pathname === '/admin' && new URLSearchParams(location.search).get('tab') === 'recharge_review') ? 'var(--accent)' : 'var(--text-primary)', backgroundColor: (location.pathname === '/admin' && new URLSearchParams(location.search).get('tab') === 'recharge_review') ? 'color-mix(in srgb, var(--accent) 10%, transparent)' : undefined }}
                onClick={() => onClose?.()}>
                <Wallet size={16} className="sidebar-nav-icon" /><span className={`sidebar-nav-text ${collapsed ? 'text-[10px] leading-none truncate max-w-full' : ''}`}>{collapsed ? '审核' : '充值审核'}</span>{!collapsed&&rechargePendingCount>0&&<span className="ml-auto text-[10px] px-1.5 py-0.5 rounded-full text-white" style={{background:'var(--color-error)'}}>{rechargePendingCount>99?'99+':rechargePendingCount}</span>}
              </Link>
            )}
          </nav>
          <div className={`px-2 pt-2 pb-1 border-t space-y-2 ${collapsed ? 'flex flex-col items-center' : ''}`} style={{ borderColor: 'var(--border-color)' }}>
            {/* 套餐入口卡片：参考 app-sidebar 底部「开通套餐」卡（登录与否均显示） */}
            {(() => {
              const hasPlan = subscription?.plan && !subscription.plan.is_free
              return (
                <button
                  type="button"
                  title={hasPlan ? `${subscription.plan.name} · 点击管理套餐` : '免费版 · 开通套餐'}
                  className={`group flex flex-col w-full rounded-xl border transition-all hover:bg-bg-hover cursor-pointer text-left ${collapsed ? 'items-center justify-center py-2' : 'px-2 py-2'}`}
                  style={{ borderColor: 'color-mix(in srgb, var(--accent) 25%, transparent)' }}
                  onClick={() => setSubOpen(true)}
                >
                  <div className={`flex items-center gap-1.5 ${collapsed ? 'flex-col' : ''}`}>
                    {hasPlan && <Crown size={12} className="shrink-0" style={{ color: 'var(--accent)' }} />}
                    <span className={`font-semibold truncate max-w-full ${collapsed ? 'text-[10px] leading-none text-center' : 'text-[11px]'}`} style={{ color: 'var(--text-primary)' }}>
                      {hasPlan ? subscription.plan.name : (collapsed ? '免费版' : '免费版 · 开通套餐')}
                    </span>
                  </div>
                  {!collapsed && (
                    <div className="text-[10px] leading-snug mt-1" style={{ color: 'var(--text-secondary)' }}>
                      <div className="truncate">{dailyTotal === null ? '不限次' : dailyTotal > 0 ? `今日已用 ${Math.max(0, dailyTotal - dailyRemaining)}/${dailyTotal} 次` : (hasPlan ? `周期至 ${formatDate(subscription.cycle?.period_end)}` : '解锁更多模型')}</div>
                      <div className="truncate">{points} 积分</div>
                    </div>
                  )}
                </button>
              )
            })()}
            {/* 用户行：圆形头像 + 账户名 */}
            {user && (
              <Link
                to="/account"
                title="账户中心"
                className={`flex items-center gap-2 min-w-0 rounded-lg hover:bg-bg-hover ${collapsed ? 'justify-center py-1' : 'px-1.5 py-1'}`}
                onClick={() => onClose?.()}
              >
                <span className="flex size-7 items-center justify-center rounded-full shrink-0" style={{ background: 'color-mix(in srgb, var(--accent) 10%, transparent)', color: 'var(--accent)' }}>
                  <User size={14} />
                </span>
                {!collapsed && (
                  <span className="ml-1 min-w-0 flex-1 text-left">
                    <span className="block truncate text-xs font-medium" style={{ color: 'var(--text-primary)' }}>{user.nickname || user.account || user.username}</span>
                  </span>
                )}
              </Link>
            )}
            {/* 主题 + 登出：纯图标小方钮 */}
            <div className={`flex items-center gap-1 ${collapsed ? 'flex-col' : ''}`}>
              <button
                onClick={toggle}
                aria-label="切换主题"
                title={dark ? '切换到浅色' : '切换到深色'}
                className="flex size-8 items-center justify-center rounded-lg hover:bg-bg-hover transition-colors shrink-0"
                style={{ color: 'var(--text-primary)' }}
              >
                {dark ? <Sun size={16} className="sidebar-nav-icon" /> : <Moon size={16} className="sidebar-nav-icon" />}
              </button>
              <button
                onClick={handleLogout}
                aria-label="退出登录"
                title="退出登录"
                className="flex size-8 items-center justify-center rounded-lg hover:bg-bg-hover transition-colors shrink-0"
                style={{ color: 'var(--text-primary)' }}
              >
                <LogOut size={16} className="sidebar-nav-icon" />
              </button>
            </div>
          </div>
        </aside>
        {subNavVisible && (
          <aside className="w-44 flex flex-col flex-shrink-0"
            style={{ background: 'var(--bg-sidebar)', borderRight: '1px solid var(--border-color)' }}>
            <div className="flex-1 min-h-0 overflow-y-auto py-2 px-2 space-y-0.5">
              {subNavItems.map(({ path, icon: Icon, label }) => {
                const active = location.pathname === path
                const linkClass = `sidebar-nav-link ${active ? 'bg-accent/10' : 'hover:bg-bg-hover'}`
                const linkStyle = { color: active ? 'var(--accent)' : 'var(--text-primary)', backgroundColor: active ? 'color-mix(in srgb, var(--accent) 10%, transparent)' : undefined }
                if (path === '/prompts') {
                  return (
                    <div key={path} className={linkClass} style={{ ...linkStyle, display: 'none' }}>
                      <Icon size={16} className="sidebar-nav-icon" /><span className="sidebar-nav-text">{label}</span>
                    </div>
                  )
                }
                return (
                  <Link key={path} to={path} className={linkClass} style={linkStyle} onClick={() => onClose?.()}>
                    <Icon size={16} className="sidebar-nav-icon" /><span className="sidebar-nav-text">{label}</span>{path==='/notifications'&&unreadNoticeCount>0&&<span className="ml-auto text-[10px] px-1.5 py-0.5 rounded-full text-white" style={{background:'var(--accent)'}}>{unreadNoticeCount>99?'99+':unreadNoticeCount}</span>}
                  </Link>
                )
              })}
            </div>
            <div className="px-2 py-2 space-y-0.5" style={{ borderColor: 'var(--border-color)' }}>
              <button onClick={toggleLayoutMode} className="sidebar-control-btn hover:bg-bg-hover"
                style={{ color: 'var(--text-primary)' }}>
                <LayoutGrid size={16} className="sidebar-nav-icon" /><span className="sidebar-nav-text">{layoutMode === 'masonry' ? '切换为网格' : '切换为瀑布流'}</span>
              </button>
              <button onClick={toggleCurrentCols} className="sidebar-control-btn hover:bg-bg-hover"
                style={{ color: 'var(--text-primary)' }}>
                <LayoutGrid size={16} className="sidebar-nav-icon" /><span className="sidebar-nav-text">{currentBreakpointLabel}列数 {currentCols}列</span>
              </button>
            </div>
          </aside>
        )}
      </div>
      <SubscriptionDialog open={subOpen} onClose={() => setSubOpen(false)} />
    </>
  )
}
