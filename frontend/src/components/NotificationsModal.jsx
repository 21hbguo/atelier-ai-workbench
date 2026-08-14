import { useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import Pagination from './Pagination'
import { announcementAPI, notificationAPI } from '../api'
import { useAppDialog } from './AppDialogProvider'

// 全局通知弹窗：任意入口 `window.dispatchEvent(new Event('notifications-open'))` 打开。
// 支持遮罩点击 / ESC / 手机返回键（history.pushState + popstate）关闭。
export default function NotificationsModal() {
  const dialog = useAppDialog()
  const [open, setOpen] = useState(false)
  const openRef = useRef(false)
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(false)
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const size = 20

  const close = () => {
    openRef.current = false
    setOpen(false)
  }

  const fmtTime = value => {
    const s = String(value || '')
    const withTz = s.includes('T')
      ? (s.includes('+') || s.includes('Z') ? s : s + '+08:00')
      : s.replace(' ', 'T') + '+08:00'
    return new Date(withTz).toLocaleString('zh-CN')
  }

  const sortByTime = (a, b) => {
    const parseT = v => {
      const s = String(v || '')
      return s.includes('T') ? s : s.replace(' ', 'T')
    }
    return new Date(parseT(b.created_at)).getTime() - new Date(parseT(a.created_at)).getTime()
  }

  const fetchData = async (p = 1) => {
    setLoading(true)
    try {
      const [{ data: nData }, { data: aData }] = await Promise.all([
        notificationAPI.list(1, 100),
        announcementAPI.list(1, 100),
      ])
      const notifications = (nData.items || []).map(v => ({ ...v, _kind: 'notification' }))
      const announcements = (aData.items || []).map(v => ({ ...v, _kind: 'announcement' }))
      const merged = [...notifications, ...announcements].sort(sortByTime)
      setTotal(merged.length)
      setItems(merged.slice((p - 1) * size, p * size))
    } catch (e) {
      dialog.alert(e.message || '加载失败')
    }
    setLoading(false)
  }

  // 全局开关事件：同步推入历史标记（在抽屉关闭的 history.back() 之前完成，
  // 使抽屉 cleanup 检测到栈顶标记不是自己的、不再 back，避免 popstate 误关弹窗）
  useEffect(() => {
    const handleOpen = () => {
      if (openRef.current) return
      openRef.current = true
      window.history.pushState({ atelierNotifications: 'open' }, '')
      setPage(1)
      setOpen(true)
    }
    window.addEventListener('notifications-open', handleOpen)
    return () => window.removeEventListener('notifications-open', handleOpen)
  }, [])

  // 打开时加载
  useEffect(() => {
    if (open) fetchData(page)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, page])

  // 手机返回键关闭：打开时推入历史标记，返回手势触发 popstate 即关闭
  useEffect(() => {
    if (!open) return
    const handlePopState = () => close()
    window.addEventListener('popstate', handlePopState)
    return () => {
      window.removeEventListener('popstate', handlePopState)
      // 若当前栈顶仍是自己推入的记录（经遮罩/ESC 等途径关闭），回退收回，避免残留多余历史
      if (window.history.state?.atelierNotifications === 'open') window.history.back()
    }
  }, [open])

  // ESC 关闭
  useEffect(() => {
    if (!open) return
    const handleKey = e => { if (e.key === 'Escape') close() }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [open])

  const markRead = async item => {
    try {
      if (item._kind === 'announcement') await announcementAPI.markRead(item.id)
      else await notificationAPI.markRead(item.id)
      window.dispatchEvent(new Event('notifications-updated'))
      fetchData(page)
    } catch (e) {
      dialog.alert(e.message || '操作失败')
    }
  }

  const markAll = async () => {
    try {
      const unreadAnnouncements = items.filter(v => v._kind === 'announcement' && !v.is_read)
      await Promise.all([
        notificationAPI.markAllRead(),
        ...unreadAnnouncements.map(v => announcementAPI.markRead(v.id)),
      ])
      window.dispatchEvent(new Event('notifications-updated'))
      fetchData(page)
    } catch (e) {
      dialog.alert(e.message || '操作失败')
    }
  }

  const clearRead = async () => {
    try {
      const { data } = await notificationAPI.clearRead()
      if (data.deleted > 0) {
        window.dispatchEvent(new Event('notifications-updated'))
        fetchData(page)
      } else {
        dialog.alert('没有已读通知可清除')
      }
    } catch (e) {
      dialog.alert(e.message || '操作失败')
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / size))

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[95] flex items-center justify-center p-4" onClick={close}>
      <div className="absolute inset-0 bg-black/50" />
      <div
        className="relative w-full max-w-lg max-h-[85vh] overflow-hidden rounded-2xl flex flex-col"
        style={{ background: 'var(--bg-primary)', border: '1px solid var(--border-color)' }}
        onClick={e => e.stopPropagation()}
      >
        {/* 头部 */}
        <div className="flex items-center justify-between px-5 py-4 border-b shrink-0" style={{ borderColor: 'var(--border-color)' }}>
          <h2 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>通知中心</h2>
          <div className="flex items-center gap-2">
            <button onClick={markAll} className="px-2.5 py-1.5 rounded-2xl text-xs font-medium text-white" style={{ background: 'var(--accent)' }}>全部已读</button>
            <button onClick={clearRead} className="px-2.5 py-1.5 rounded-2xl text-xs font-medium" style={{ color: 'var(--text-secondary)', border: '1px solid var(--border-color)' }}>清除已读</button>
            <button onClick={close} aria-label="关闭" className="p-1.5 rounded-lg hover:bg-bg-hover shrink-0" style={{ color: 'var(--text-secondary)' }}><X size={18} /></button>
          </div>
        </div>
        {/* 内容 */}
        <div className="overflow-y-auto p-5 flex-1 min-h-0">
          {loading ? (
            <div className="text-sm" style={{ color: 'var(--text-secondary)' }}>加载中...</div>
          ) : items.length === 0 ? (
            <div className="text-sm" style={{ color: 'var(--text-secondary)' }}>暂无通知</div>
          ) : (
            <div className="space-y-2">
              {items.map(n => (
                <div
                  key={`${n._kind}-${n.id}`}
                  className="p-3 rounded-2xl border"
                  style={{ background: 'var(--bg-ai-bubble)', borderColor: 'var(--border-color)' }}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                          {n.title}
                        </div>
                        <span
                          className="px-1.5 py-0.5 rounded-full text-[10px] font-medium shrink-0"
                          style={{
                            background: n._kind === 'announcement'
                              ? 'color-mix(in srgb, var(--color-warning) 12%, transparent)'
                              : 'color-mix(in srgb, var(--accent) 12%, transparent)',
                            color: n._kind === 'announcement' ? 'var(--color-warning)' : 'var(--accent)',
                          }}
                        >
                          {n._kind === 'announcement' ? '公告' : '通知'}
                        </span>
                      </div>
                      <div className="text-xs mt-1 whitespace-pre-wrap" style={{ color: 'var(--text-secondary)' }}>
                        {n.content}
                      </div>
                      <div className="text-[11px] mt-1" style={{ color: 'var(--text-secondary)' }}>
                        {fmtTime(n.created_at)}
                      </div>
                    </div>
                    {!n.is_read && (
                      <button
                        onClick={() => markRead(n)}
                        className="px-2 py-1 rounded-lg text-xs shrink-0"
                        style={{ color: 'var(--accent)' }}
                      >
                        标为已读
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        {/* 分页 */}
        <div className="shrink-0 border-t" style={{ borderColor: 'var(--border-color)' }}>
          <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />
        </div>
      </div>
    </div>
  )
}
