import { useState, useEffect } from 'react'
import { Megaphone, Check } from 'lucide-react'
import MainLayout from '../components/MainLayout'
import AnnouncementModal from '../components/AnnouncementModal'
import { announcementAPI } from '../api'

export default function AnnouncementsPage() {
  const [announcements, setAnnouncements] = useState([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState(null)

  const fetchData = async (p = 1) => {
    setLoading(true)
    try {
      const { data } = await announcementAPI.list(p, 20)
      setAnnouncements(data.items)
      setTotal(data.total)
    } catch {} finally { setLoading(false) }
  }

  useEffect(() => { fetchData(page) }, [page])

  const handleRead = async (ann) => {
    try {
      await announcementAPI.markRead(ann.id)
      setAnnouncements(prev => prev.map(a => a.id === ann.id ? { ...a, is_read: 1 } : a))
      setSelected(null)
    } catch {}
  }

  return (
    <MainLayout>
      <div className="flex-1 overflow-y-auto p-4 sm:p-6">
        <div className="flex items-center gap-2 mb-4">
          <Megaphone size={20} style={{ color: 'var(--accent)' }} />
          <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>公告列表</h2>
          <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>共 {total} 条</span>
        </div>
        {loading ? (
          <div className="flex justify-center py-20">
            <div className="w-8 h-8 border-2 rounded-full animate-spin-slow" style={{ borderTopColor: 'var(--accent)', borderColor: 'var(--border-color)' }} />
          </div>
        ) : (
        <>
        <div className="space-y-2">
          {announcements.map(item => (
            <div key={item.id}
              onClick={() => setSelected(item)}
              className="flex items-center justify-between px-4 py-3 rounded-xl border cursor-pointer hover:shadow-sm transition-shadow"
              style={{ borderColor: 'var(--border-color)', background: 'var(--bg-ai-bubble)' }}>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>{item.title}</p>
                  {item.is_read ? (
                    <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-gray-500/20 text-gray-500 flex-shrink-0">已读</span>
                  ) : (
                    <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-accent/20 text-accent flex-shrink-0">未读</span>
                  )}
                </div>
                <div className="flex items-center gap-3 mt-1 text-xs" style={{ color: 'var(--text-secondary)' }}>
                  {Boolean(item.author_name) && <span>{item.author_name}</span>}
                  <span>{item.created_at}</span>
                </div>
              </div>
              {item.is_read ? (
                <Check size={16} className="flex-shrink-0 ml-3" style={{ color: '#22c55e' }} />
              ) : (
                <Megaphone size={16} className="flex-shrink-0 ml-3" style={{ color: 'var(--accent)' }} />
              )}
            </div>
          ))}
          {announcements.length === 0 && (
            <div className="text-center py-20" style={{ color: 'var(--text-secondary)' }}>暂无公告</div>
          )}
        </div>
        {total > 20 && (
          <div className="flex justify-center gap-2 mt-4">
            {Array.from({ length: Math.ceil(total / 20) }, (_, i) => i + 1).map(p => (
              <button key={p} onClick={() => setPage(p)} className={`w-8 h-8 rounded-lg text-sm font-medium ${p === page ? 'bg-accent text-white' : 'hover:bg-black/5'}`}
                style={{ color: p !== page ? 'var(--text-primary)' : undefined }}>{p}</button>
            ))}
          </div>
        )}
        </>
        )}
      </div>
      <AnnouncementModal announcement={selected} onRead={handleRead} onClose={() => setSelected(null)} />
    </MainLayout>
  )
}
