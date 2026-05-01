import { useState, useEffect } from 'react'
import { Save, RotateCcw, Eye, EyeOff, BarChart3, TrendingUp, CheckCircle, XCircle, Clock, Image, Users, Activity, Zap, Shield, HardDrive, Server, Loader, Cpu, MemoryStick } from 'lucide-react'
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'
import api, { statsAPI } from '../api'
import MainLayout from '../components/MainLayout'

const DEFAULTS = { api_url: 'https://api.wuyinkeji.com/api/async', api_key: '', image_hosting_upload_url: 'https://img.heliar.top/upload', image_hosting_base_url: 'https://img.heliar.top', image_hosting_referer: 'https://img.heliar.top/' }

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState('stats')
  const [config, setConfig] = useState(DEFAULTS)
  const [showKey, setShowKey] = useState(false)
  const [saved, setSaved] = useState(false)
  const [stats, setStats] = useState(null)
  const [sysStats, setSysStats] = useState(null)
  const [dailyStats, setDailyStats] = useState([])

  useEffect(() => {
    api.get('/config').then(({ data }) => {
      setConfig(prev => ({ ...prev, ...data }))
    }).catch(() => {})
    const fetchStats = () => {
      statsAPI.get().then(({ data }) => setStats(data)).catch(() => {})
      statsAPI.system().then(({ data }) => setSysStats(data)).catch(() => {})
      statsAPI.daily().then(({ data }) => setDailyStats(data)).catch(() => {})
    }
    fetchStats()
    const interval = setInterval(fetchStats, 30000)
    return () => clearInterval(interval)
  }, [])

  const handleSave = async () => {
    await api.post('/config', config)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  const handleReset = async () => {
    if (!confirm('确定重置？')) return
    await api.post('/config', DEFAULTS)
    setConfig(DEFAULTS)
  }

  const updateField = (key, value) => setConfig(prev => ({ ...prev, [key]: value }))

  const StatCard = ({ icon: Icon, label, value, color }) => (
    <div className="p-2 rounded-xl border" style={{ background: 'var(--bg-ai-bubble)', borderColor: 'var(--border-color)' }}>
      {Icon && <Icon size={14} style={{ color }} className="mb-0.5" />}
      <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>{label}</p>
      <p className="text-base font-bold" style={{ color: 'var(--text-primary)' }}>{value}</p>
    </div>
  )

  return (
    <MainLayout>
      <div className="flex-1 overflow-y-auto p-4 sm:p-6">
        <div className="max-w-3xl mx-auto w-full">
          <div className="flex gap-1 p-0.5 rounded-lg mb-6" style={{ background: 'var(--border-color)' }}>
            {[
              { key: 'stats', label: '统计' },
              { key: 'config', label: '配置' },
            ].map(({ key, label }) => (
              <button key={key} onClick={() => setActiveTab(key)}
                className={`flex-1 px-3 py-2 rounded-md text-sm font-medium transition-colors ${activeTab === key ? 'shadow-sm' : ''}`}
                style={{
                  background: activeTab === key ? 'var(--bg-ai-bubble)' : 'transparent',
                  color: activeTab === key ? 'var(--text-primary)' : 'var(--text-secondary)'
                }}>
                {label}
              </button>
            ))}
          </div>

          {activeTab === 'stats' && stats && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="p-3 rounded-xl" style={{ background: 'var(--bg-ai-bubble)', border: '1px solid var(--border-color)' }}>
                  <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>总成功率</p>
                  <p className="text-2xl font-bold" style={{ color: 'var(--accent)' }}>
                    {stats.total_requests > 0 ? ((stats.total_success / stats.total_requests) * 100).toFixed(1) : '0'}%
                  </p>
                  <p className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>累计 {stats.total_requests} 次请求</p>
                </div>
                <div className="p-3 rounded-xl" style={{ background: 'var(--bg-ai-bubble)', border: '1px solid var(--border-color)' }}>
                  <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>当日成功率</p>
                  <p className="text-2xl font-bold" style={{ color: 'var(--accent)' }}>
                    {stats.today_success_rate || '0'}%
                  </p>
                  <p className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>今日 {stats.today_requests} 次请求</p>
                </div>
              </div>

              <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                <StatCard icon={Clock} label="今日请求" value={stats.today_requests} color="#3b82f6" />
                <StatCard icon={CheckCircle} label="今日成功" value={stats.today_success} color="#22c55e" />
                <StatCard icon={XCircle} label="今日失败" value={stats.today_failed} color="#ef4444" />
                <StatCard icon={BarChart3} label="累计请求" value={stats.total_requests} color="#8b5cf6" />
                <StatCard icon={TrendingUp} label="累计成功" value={stats.total_success} color="#22c55e" />
                <StatCard icon={XCircle} label="累计失败" value={stats.total_failed} color="#ef4444" />
              </div>

              <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                <StatCard icon={Users} label="用户数" value={stats.total_users} color="#3b82f6" />
                <StatCard icon={Activity} label="今日活跃" value={stats.today_active_users} color="#22c55e" />
                <StatCard icon={Zap} label="在线" value={stats.current_active_users} color="#22c55e" />
                <StatCard icon={Image} label="图片数" value={stats.total_images} color="#8b5cf6" />
                <StatCard icon={Server} label="运行时间" value={sysStats ? (sysStats.uptime_seconds >= 3600 ? `${Math.floor(sysStats.uptime_seconds / 3600)}h${Math.floor((sysStats.uptime_seconds % 3600) / 60)}m` : `${Math.floor(sysStats.uptime_seconds / 60)}m`) : '-'} color="#3b82f6" />
                <StatCard icon={Loader} label="处理中" value={sysStats?.processing_tasks ?? '-'} color="#f59e0b" />
              </div>

              {sysStats && (
                <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                  <StatCard icon={Shield} label="限流触发" value={sysStats.login_rate_hits + sysStats.register_rate_hits} color="#ef4444" />
                  <StatCard icon={HardDrive} label="存储" value={`${((sysStats.db_size + sysStats.image_size + sysStats.upload_size) / 1024 / 1024).toFixed(1)}MB`} color="#8b5cf6" />
                  <StatCard icon={MemoryStick} label="内存" value={`${sysStats.memory_percent}%`} color="#f59e0b" />
                  <StatCard icon={Cpu} label="CPU" value={`${sysStats.cpu_percent}%`} color="#3b82f6" />
                </div>
              )}

              {sysStats?.limits && (
                <div>
                  <p className="text-xs font-medium mb-2" style={{ color: 'var(--text-secondary)' }}>使用限制</p>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {[
                      { label: '登录限流', value: sysStats.limits.login_rate },
                      { label: '注册限流', value: sysStats.limits.register_rate },
                      { label: '生成并发', value: sysStats.limits.generate_concurrent },
                      { label: '文件大小', value: sysStats.limits.file_size },
                      { label: '提示词长度', value: sysStats.limits.prompt_length },
                      { label: '上传格式', value: sysStats.limits.image_upload_ext },
                    ].map(({ label, value }) => (
                      <div key={label} className="p-2 rounded-lg overflow-hidden" style={{ background: 'var(--bg-ai-bubble)', border: '1px solid var(--border-color)' }}>
                        <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>{label}</p>
                        <p className="text-sm font-semibold mt-0.5 break-all" style={{ color: 'var(--text-primary)' }}>{value}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {dailyStats.length > 0 && (
                <div className="p-3 rounded-xl" style={{ background: 'var(--bg-ai-bubble)', border: '1px solid var(--border-color)' }}>
                  <p className="text-xs font-medium mb-3" style={{ color: 'var(--text-secondary)' }}>近7天趋势</p>
                  <ResponsiveContainer width="100%" height={200}>
                    <LineChart data={dailyStats.map(d => ({ ...d, label: d.date.slice(5) }))}>
                      <XAxis dataKey="label" tick={{ fontSize: 11, fill: 'var(--text-secondary)' }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fontSize: 11, fill: 'var(--text-secondary)' }} axisLine={false} tickLine={false} width={30} />
                      <Tooltip
                        contentStyle={{ background: 'var(--bg-ai-bubble)', border: '1px solid var(--border-color)', borderRadius: 8, fontSize: 12 }}
                        labelStyle={{ color: 'var(--text-secondary)' }}
                      />
                      <Line type="monotone" dataKey="requests" stroke="#3b82f6" strokeWidth={2} dot={false} name="请求" />
                      <Line type="monotone" dataKey="success" stroke="#22c55e" strokeWidth={2} dot={false} name="成功" />
                      <Line type="monotone" dataKey="failed" stroke="#ef4444" strokeWidth={2} dot={false} name="失败" />
                    </LineChart>
                  </ResponsiveContainer>
                  <div className="flex justify-center gap-4 mt-2">
                    {[{ label: '请求', color: '#3b82f6' }, { label: '成功', color: '#22c55e' }, { label: '失败', color: '#ef4444' }].map(({ label, color }) => (
                      <div key={label} className="flex items-center gap-1">
                        <div className="w-2.5 h-2.5 rounded-full" style={{ background: color }} />
                        <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>{label}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {activeTab === 'config' && (
            <div className="space-y-4">
              <div className="p-5 rounded-xl border" style={{ background: 'var(--bg-ai-bubble)', borderColor: 'var(--border-color)' }}>
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

              <div className="p-5 rounded-xl border" style={{ background: 'var(--bg-ai-bubble)', borderColor: 'var(--border-color)' }}>
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
          )}
        </div>
      </div>
    </MainLayout>
  )
}
