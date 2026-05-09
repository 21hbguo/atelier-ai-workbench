import { useEffect, useState } from 'react'
import MainLayout from '../components/MainLayout'
import Pagination from '../components/Pagination'
import { announcementAPI, notificationAPI } from '../api'
import { useAppDialog } from '../components/AppDialogProvider'

export default function NotificationsPage() {
  const dialog = useAppDialog()
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(false)
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const size = 20

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

  useEffect(() => { fetchData(page) }, [page])

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

  return (
    <MainLayout>
      <div className="flex-1 overflow-y-auto p-4 sm:p-6">
        <div className="max-w-4xl mx-auto">
          <div className="flex items-center justify-between mb-4">
            <h1 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>通知中心</h1>
            <div className="flex gap-2">
              <button
                onClick={markAll}
                className="px-3 py-1.5 rounded-2xl text-sm font-medium text-white"
                style={{ background: 'var(--accent)' }}
              >
                全部已读
              </button>
              <button
                onClick={clearRead}
                className="px-3 py-1.5 rounded-2xl text-sm font-medium"
                style={{ color: 'var(--text-secondary)', border: '1px solid var(--border-color)' }}
              >
                清除已读通知
              </button>
            </div>
          </div>
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
                          className="px-1.5 py-0.5 rounded-full text-[10px] font-medium"
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
                        className="px-2 py-1 rounded-lg text-xs"
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
          <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />
        </div>
      </div>
    </MainLayout>
  )
}
