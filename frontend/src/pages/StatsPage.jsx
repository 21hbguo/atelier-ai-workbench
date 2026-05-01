import { useState, useEffect } from 'react'
import { BarChart3, TrendingUp, CheckCircle, XCircle, Clock } from 'lucide-react'
import { statsAPI } from '../api'
import PageLayout from '../components/PageLayout'

export default function StatsPage() {
  const [stats, setStats] = useState(null)

  useEffect(() => {
    statsAPI.get().then(({ data }) => setStats(data)).catch(() => {})
  }, [])

  if (!stats) return <div className="flex justify-center items-center min-h-screen"><div className="w-8 h-8 border-2 rounded-full animate-spin-slow" style={{ borderTopColor: 'var(--accent)', borderColor: 'var(--border-color)' }} /></div>

  const cards = [
    { label: '今日请求', value: stats.today_requests, icon: Clock, color: '#3b82f6' },
    { label: '今日成功', value: stats.today_success, icon: CheckCircle, color: 'var(--accent)' },
    { label: '今日失败', value: stats.today_failed, icon: XCircle, color: '#ef4444' },
    { label: '累计请求', value: stats.total_requests, icon: BarChart3, color: '#8b5cf6' },
    { label: '累计成功', value: stats.total_success, icon: TrendingUp, color: 'var(--accent)' },
    { label: '累计失败', value: stats.total_failed, icon: XCircle, color: '#ef4444' },
  ]

  const rate = stats.total_requests > 0 ? ((stats.total_success / stats.total_requests) * 100).toFixed(1) : '0'

  return (
    <PageLayout className="p-4 sm:p-6">
      <div className="max-w-5xl mx-auto">
        <div className="flex items-center gap-2 mb-6">
          <button onClick={() => history.back()} className="p-2 rounded-lg hover:bg-black/5" style={{ color: 'var(--text-primary)' }}><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m15 18-6-6 6-6"/></svg></button>
          <h1 className="text-xl font-semibold" style={{ color: 'var(--text-primary)' }}>调用统计</h1>
        </div>
        <div className="p-4 rounded-xl mb-6 shadow-sm" style={{ background: 'var(--bg-ai-bubble)', border: '1px solid var(--border-color)' }}>
          <div className="flex items-center justify-between">
            <div><p className="text-sm" style={{ color: 'var(--text-secondary)' }}>总成功率</p><p className="text-3xl font-bold" style={{ color: 'var(--accent)' }}>{rate}%</p></div>
            <div className="text-right"><p className="text-xs" style={{ color: 'var(--text-secondary)' }}>最后更新</p><p className="text-sm" style={{ color: 'var(--text-primary)' }}>{stats.last_date}</p></div>
          </div>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {cards.map(({ label, value, icon: Icon, color }) => (
            <div key={label} className="p-4 rounded-xl border" style={{ background: 'var(--bg-ai-bubble)', borderColor: 'var(--border-color)' }}>
              <Icon size={20} style={{ color }} className="mb-2" />
              <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>{label}</p>
              <p className="text-2xl font-bold mt-1" style={{ color: 'var(--text-primary)' }}>{value}</p>
            </div>
          ))}
        </div>
      </div>
    </PageLayout>
  )
}
