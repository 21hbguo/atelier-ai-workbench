import { useState, useEffect } from 'react'
import { Save, RotateCcw, Eye, EyeOff, BarChart3, TrendingUp, CheckCircle, XCircle, Clock } from 'lucide-react'
import { statsAPI } from '../api'
import PageLayout from '../components/PageLayout'

const DEFAULTS = { api_url: 'https://api.wuyinkeji.com/api/async', api_key: '', image_hosting_upload_url: 'https://img.heliar.top/upload', image_hosting_base_url: 'https://img.heliar.top', image_hosting_referer: 'https://img.heliar.top/' }

export default function SettingsPage() {
  const [config, setConfig] = useState(DEFAULTS)
  const [showKey, setShowKey] = useState(false)
  const [saved, setSaved] = useState(false)
  const [stats, setStats] = useState(null)

  useEffect(() => {
    fetch('/api/config').then(r => r.json()).then(data => {
      setConfig(prev => ({ ...prev, ...data }))
    }).catch(() => {})
    statsAPI.get().then(({ data }) => setStats(data)).catch(() => {})
  }, [])

  const handleSave = async () => {
    await fetch('/api/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(config) })
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  const handleReset = async () => {
    if (!confirm('确定重置？')) return
    await fetch('/api/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(DEFAULTS) })
    setConfig(DEFAULTS)
  }

  const updateField = (key, value) => setConfig(prev => ({ ...prev, [key]: value }))

  return (
    <PageLayout className="p-4 sm:p-6">
      <div className="max-w-2xl mx-auto w-full">
        <div className="flex items-center gap-2 mb-6">
          <button onClick={() => history.back()} className="p-2 rounded-lg hover:bg-black/5" style={{ color: 'var(--text-primary)' }}><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m15 18-6-6 6-6"/></svg></button>
          <h1 className="text-xl font-semibold" style={{ color: 'var(--text-primary)' }}>设置</h1>
        </div>

        {stats && (
          <>
            <div className="p-4 rounded-xl mb-4 shadow-sm" style={{ background: 'var(--bg-ai-bubble)', border: '1px solid var(--border-color)' }}>
              <div className="flex items-center justify-between">
                <div><p className="text-xs" style={{ color: 'var(--text-secondary)' }}>总成功率</p><p className="text-2xl font-bold" style={{ color: 'var(--accent)' }}>{stats.total_requests > 0 ? ((stats.total_success / stats.total_requests) * 100).toFixed(1) : '0'}%</p></div>
                <div className="text-right"><p className="text-xs" style={{ color: 'var(--text-secondary)' }}>最后更新</p><p className="text-sm" style={{ color: 'var(--text-primary)' }}>{stats.last_date}</p></div>
              </div>
            </div>
            <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 mb-6">
              {[
                { label: '今日请求', value: stats.today_requests, icon: Clock, color: '#3b82f6' },
                { label: '今日成功', value: stats.today_success, icon: CheckCircle, color: 'var(--accent)' },
                { label: '今日失败', value: stats.today_failed, icon: XCircle, color: '#ef4444' },
                { label: '累计请求', value: stats.total_requests, icon: BarChart3, color: '#8b5cf6' },
                { label: '累计成功', value: stats.total_success, icon: TrendingUp, color: 'var(--accent)' },
                { label: '累计失败', value: stats.total_failed, icon: XCircle, color: '#ef4444' },
              ].map(({ label, value, icon: Icon, color }) => (
                <div key={label} className="p-3 rounded-xl border" style={{ background: 'var(--bg-ai-bubble)', borderColor: 'var(--border-color)' }}>
                  <Icon size={16} style={{ color }} className="mb-1" />
                  <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>{label}</p>
                  <p className="text-lg font-bold mt-0.5" style={{ color: 'var(--text-primary)' }}>{value}</p>
                </div>
              ))}
            </div>
          </>
        )}

        <div className="p-5 rounded-xl border mb-6" style={{ background: 'var(--bg-ai-bubble)', borderColor: 'var(--border-color)' }}>
          <h2 className="font-medium mb-4" style={{ color: 'var(--text-primary)' }}>AI 图像生成 API</h2>
          <div className="space-y-4">
            <div>
              <label className="block text-sm mb-1.5" style={{ color: 'var(--text-primary)' }}>API 地址 <span className="text-red-500">*</span></label>
              <input type="text" value={config.api_url || ''} onChange={e => updateField('api_url', e.target.value)} placeholder="https://api.wuyinkeji.com/api/async"
                className="w-full px-3 py-2.5 rounded-lg text-sm border outline-none focus:ring-1 focus:ring-accent/50"
                style={{ background: 'var(--bg-primary)', borderColor: 'var(--border-color)', color: 'var(--text-primary)' }} />
            </div>
            <div>
              <label className="block text-sm mb-1.5" style={{ color: 'var(--text-primary)' }}>API Key <span className="text-red-500">*</span></label>
              <div className="relative">
                <input type={showKey ? 'text' : 'password'} value={config.api_key || ''} onChange={e => updateField('api_key', e.target.value)} placeholder="sk-..."
                  className="w-full px-3 py-2.5 rounded-lg text-sm border outline-none focus:ring-1 focus:ring-accent/50"
                  style={{ background: 'var(--bg-primary)', borderColor: 'var(--border-color)', color: 'var(--text-primary)', paddingRight: '40px' }} />
                <button onClick={() => setShowKey(!showKey)} className="absolute right-2 top-1/2 -translate-y-1/2 p-1" style={{ color: 'var(--text-secondary)' }}>{showKey ? <EyeOff size={16} /> : <Eye size={16} />}</button>
              </div>
            </div>
          </div>
        </div>
        <div className="p-5 rounded-xl border mb-6" style={{ background: 'var(--bg-ai-bubble)', borderColor: 'var(--border-color)' }}>
          <h2 className="font-medium mb-4" style={{ color: 'var(--text-primary)' }}>图床配置</h2>
          <div className="space-y-4">
            {[{ key: 'image_hosting_upload_url', label: '上传地址' }, { key: 'image_hosting_base_url', label: '域名' }, { key: 'image_hosting_referer', label: 'Referer' }]
              .map(({ key, label }) => (
                <div key={key}>
                  <label className="block text-sm mb-1.5" style={{ color: 'var(--text-primary)' }}>{label}</label>
                  <input type="text" value={config[key] || ''} onChange={e => updateField(key, e.target.value)}
                    className="w-full px-3 py-2.5 rounded-lg text-sm border outline-none focus:ring-1 focus:ring-accent/50"
                    style={{ background: 'var(--bg-primary)', borderColor: 'var(--border-color)', color: 'var(--text-primary)' }} />
                </div>
              ))}
          </div>
        </div>
        <div className="flex gap-3">
          <button onClick={handleSave} className="flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-medium text-white transition-colors hover:opacity-90" style={{ background: 'var(--accent)' }}><Save size={14} /> 保存配置</button>
          <button onClick={handleReset} className="flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-medium hover:bg-black/5 transition-colors" style={{ color: 'var(--text-secondary)' }}><RotateCcw size={14} /> 重置</button>
          {saved && <span className="flex items-center text-sm" style={{ color: 'var(--accent)' }}>已保存！</span>}
        </div>
      </div>
    </PageLayout>
  )
}
