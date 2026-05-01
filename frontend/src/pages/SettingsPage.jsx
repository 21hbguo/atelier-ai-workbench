import { useState, useEffect } from 'react'
import { Save, RotateCcw, Eye, EyeOff, BarChart3, TrendingUp, CheckCircle, XCircle, Clock, Image, Users, Activity, Zap, Shield, HardDrive, Server, Loader } from 'lucide-react'
import { statsAPI } from '../api'
import MainLayout from '../components/MainLayout'

const DEFAULTS = { api_url: 'https://api.wuyinkeji.com/api/async', api_key: '', image_hosting_upload_url: 'https://img.heliar.top/upload', image_hosting_base_url: 'https://img.heliar.top', image_hosting_referer: 'https://img.heliar.top/' }

export default function SettingsPage() {
  const [config, setConfig] = useState(DEFAULTS)
  const [showKey, setShowKey] = useState(false)
  const [saved, setSaved] = useState(false)
  const [stats, setStats] = useState(null)
  const [sysStats, setSysStats] = useState(null)

  useEffect(() => {
    fetch('/api/config').then(r => r.json()).then(data => {
      setConfig(prev => ({ ...prev, ...data }))
    }).catch(() => {})
    const fetchStats = () => {
      statsAPI.get().then(({ data }) => setStats(data)).catch(() => {})
      statsAPI.system().then(({ data }) => setSysStats(data)).catch(() => {})
    }
    fetchStats()
    const interval = setInterval(fetchStats, 30000)
    return () => clearInterval(interval)
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
    <MainLayout>
      <div className="flex-1 overflow-y-auto p-4 sm:p-6">
        <div className="max-w-2xl mx-auto w-full">
          <div className="flex items-center gap-2 mb-6">
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
            <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 mb-4">
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
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 mb-6">
              {[
                { label: '张图片', value: stats.total_images, icon: Image, color: 'var(--accent)' },
                { label: '位用户', value: stats.total_users, icon: Users, color: '#3b82f6' },
                { label: '前日新增', value: `+${stats.yesterday_new_users || 0}`, icon: null, color: 'var(--accent)' },
                { label: '今日活跃', value: stats.today_active_users, icon: Activity, color: 'var(--accent)' },
                { label: '在线', value: stats.current_active_users, icon: Zap, color: '#22c55e' },
              ].map(({ label, value, icon: Icon, color }) => (
                <div key={label} className="p-3 rounded-xl border" style={{ background: 'var(--bg-ai-bubble)', borderColor: 'var(--border-color)' }}>
                  {Icon && <Icon size={16} style={{ color }} className="mb-1" />}
                  {!Icon && <span className="text-sm font-bold mb-1 block" style={{ color }}>+</span>}
                  <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>{label}</p>
                  <p className="text-lg font-bold mt-0.5" style={{ color: 'var(--text-primary)' }}>{value}</p>
                </div>
              ))}
            </div>
            {sysStats && (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-6">
                {[
                  { label: '运行时间', value: sysStats.uptime_seconds >= 3600 ? `${Math.floor(sysStats.uptime_seconds / 3600)}h${Math.floor((sysStats.uptime_seconds % 3600) / 60)}m` : `${Math.floor(sysStats.uptime_seconds / 60)}m`, icon: Server, color: '#3b82f6' },
                  { label: '处理中任务', value: sysStats.processing_tasks, icon: Loader, color: '#f59e0b' },
                  { label: '登录限流触发', value: sysStats.login_rate_hits, icon: Shield, color: '#ef4444' },
                  { label: '注册限流触发', value: sysStats.register_rate_hits, icon: Shield, color: '#ef4444' },
                ].map(({ label, value, icon: Icon, color }) => (
                  <div key={label} className="p-3 rounded-xl border" style={{ background: 'var(--bg-ai-bubble)', borderColor: 'var(--border-color)' }}>
                    <Icon size={16} style={{ color }} className="mb-1" />
                    <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>{label}</p>
                    <p className="text-lg font-bold mt-0.5" style={{ color: 'var(--text-primary)' }}>{value}</p>
                  </div>
                ))}
                <div className="p-3 rounded-xl border" style={{ background: 'var(--bg-ai-bubble)', borderColor: 'var(--border-color)' }}>
                  <HardDrive size={16} style={{ color: '#8b5cf6' }} className="mb-1" />
                  <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>存储用量</p>
                  <p className="text-lg font-bold mt-0.5" style={{ color: 'var(--text-primary)' }}>{((sysStats.db_size + sysStats.image_size + sysStats.upload_size) / 1024 / 1024).toFixed(1)}MB</p>
                </div>
              </div>
            )}
            {sysStats?.limits && (
              <div className="mb-6">
                <h3 className="text-sm font-medium mb-3" style={{ color: 'var(--text-primary)' }}>使用限制</h3>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {[
                    { label: '登录限流', value: sysStats.limits.login_rate },
                    { label: '注册限流', value: sysStats.limits.register_rate },
                    { label: '生成并发', value: sysStats.limits.generate_concurrent },
                    { label: '文件大小', value: sysStats.limits.file_size },
                    { label: '提示词长度', value: sysStats.limits.prompt_length },
                    { label: '上传格式', value: sysStats.limits.image_upload_ext },
                  ].map(({ label, value }) => (
                    <div key={label} className="p-3 rounded-xl border" style={{ background: 'var(--bg-ai-bubble)', borderColor: 'var(--border-color)' }}>
                      <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>{label}</p>
                      <p className="text-sm font-semibold mt-0.5" style={{ color: 'var(--text-primary)' }}>{value}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        <div className="p-5 rounded-xl border mb-6" style={{ background: 'var(--bg-ai-bubble)', borderColor: 'var(--border-color)' }}>
          <h2 className="font-medium mb-4" style={{ color: 'var(--text-primary)' }}>图像生成 API</h2>
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
      </div>
    </MainLayout>
  )
}
