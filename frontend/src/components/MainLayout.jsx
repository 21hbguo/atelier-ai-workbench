import { useState,useEffect } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { Menu } from 'lucide-react'
import Sidebar from './Sidebar'
import { announcementAPI, notificationAPI } from '../api'

const quickNavItems = [
  { label: '助手', path: '/chat' },
  { label: '绘画', path: '/draw' },
  { label: '作品', path: '/works' },
  { label: '广场', path: '/square' },
  { label: '通知', path: '/notifications' },
]

export default function MainLayout({ children, dragProps }) {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [unreadNoticeCount, setUnreadNoticeCount] = useState(0)
  const location = useLocation()
  useEffect(()=>{
    let timer=0;
    const load=()=>Promise.allSettled([
      notificationAPI.unreadCount(),
      announcementAPI.getUnread()
    ]).then(([noticeRes,annRes])=>setUnreadNoticeCount(
      (noticeRes.status==='fulfilled'?(noticeRes.value.data.count||0):0)
      +(annRes.status==='fulfilled'?((annRes.value.data.items||[]).length):0)
    )).catch(()=>{});
    timer=window.setTimeout(load,180);
    window.addEventListener('notifications-updated',load);
    return()=>{window.clearTimeout(timer);window.removeEventListener('notifications-updated',load)}
  },[])

  // 手机端抽屉打开时推入一条历史记录：系统返回键/返回手势触发 popstate 即关闭抽屉，而不是退出应用或回退页面
  useEffect(() => {
    if (!sidebarOpen) return
    window.history.pushState({ atelierSidebar: 'open' }, '')
    const handlePopState = () => setSidebarOpen(false)
    window.addEventListener('popstate', handlePopState)
    return () => {
      window.removeEventListener('popstate', handlePopState)
      // 若当前栈顶仍是自己推入的记录（经遮罩/链接等途径关闭），回退收回，避免残留多余历史
      if (window.history.state?.atelierSidebar === 'open') window.history.back()
    }
  }, [sidebarOpen])

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
                  <span className="relative inline-flex items-center">
                    <span className="mobile-topbar-link-text">{item.label}</span>
                    {item.path==='/notifications'&&unreadNoticeCount>0&&(
                      <span className="absolute -top-1.5 -right-2 w-2 h-2 rounded-full" style={{background:'var(--color-error)'}} />
                    )}
                  </span>
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
