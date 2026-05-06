import { Megaphone, X } from 'lucide-react'
import { useState } from 'react'

export default function AnnouncementModal({ announcement, onRead, onClose }) {
  const [loading, setLoading] = useState(false)

  if (!announcement) return null

  const handleRead = async () => {
    setLoading(true)
    try {
      await onRead(announcement)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/50" />
      <div className="relative w-full max-w-lg rounded-2xl overflow-hidden" style={{ background: 'var(--bg-primary)' }} onClick={e => e.stopPropagation()}>
        <div className="p-4 border-b flex items-center gap-2" style={{ borderColor: 'var(--border-color)' }}>
          <Megaphone size={16} style={{ color: 'var(--accent)' }} />
          <h3 className="text-sm font-semibold flex-1" style={{ color: 'var(--text-primary)' }}>{announcement.title}</h3>
          <button onClick={onClose} className="p-1 rounded-2xl hover:bg-bg-hover">
            <X size={16} style={{ color: 'var(--text-secondary)' }} />
          </button>
        </div>
        <div className="p-4 max-h-[60vh] overflow-y-auto">
          <p className="text-sm whitespace-pre-wrap" style={{ color: 'var(--text-primary)' }}>{announcement.content}</p>
          <div className="mt-3 text-xs" style={{ color: 'var(--text-secondary)' }}>
            {Boolean(announcement.author_name) && <span>{announcement.author_name} · </span>}
            {announcement.created_at}
          </div>
        </div>
        <div className="p-4 border-t" style={{ borderColor: 'var(--border-color)' }}>
          <button onClick={handleRead} disabled={loading}
            className="w-full py-2.5 rounded-2xl text-sm font-medium bg-accent text-white hover:opacity-90 disabled:opacity-50">
            {loading ? '处理中...' : '已阅读'}
          </button>
        </div>
      </div>
    </div>
  )
}
