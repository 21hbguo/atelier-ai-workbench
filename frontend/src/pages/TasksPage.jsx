import { useState, useEffect } from 'react'
import { Trash2, RefreshCw, Clock, CheckCircle, XCircle, Loader } from 'lucide-react'
import { taskAPI } from '../api'
import PageLayout from '../components/PageLayout'

const statusMap = { completed: { icon: CheckCircle, color: 'var(--accent)', label: '已完成' }, failed: { icon: XCircle, color: '#ef4444', label: '失败' }, processing: { icon: Loader, color: '#f59e0b', label: '生成中' }, queued: { icon: Clock, color: '#f59e0b', label: '排队中' }, pending: { icon: Clock, color: 'var(--text-secondary)', label: '待处理' } }

function formatDuration(start, end) {
  if (!start) return null
  const startTime = new Date(start.replace(' ', 'T')).getTime()
  const endTime = end ? new Date(end.replace(' ', 'T')).getTime() : Date.now()
  const secs = Math.floor((endTime - startTime) / 1000)
  if (secs < 0) return null
  if (secs < 60) return `${secs}秒`
  const mins = Math.floor(secs / 60)
  const remainSecs = secs % 60
  if (mins < 60) return `${mins}分${remainSecs}秒`
  const hours = Math.floor(mins / 60)
  const remainMins = mins % 60
  return `${hours}时${remainMins}分`
}

export default function TasksPage() {
  const [tasks, setTasks] = useState([])
  const [loading, setLoading] = useState(false)
  const [filter, setFilter] = useState('all')

  useEffect(() => { fetchTasks() }, [])

  const fetchTasks = async () => {
    setLoading(true)
    try { const { data } = await taskAPI.list(100); setTasks(data) } catch { setTasks([]) }
    finally { setLoading(false) }
  }

  const handleDelete = async (id) => { if (!confirm('确定删除？')) return; try { await taskAPI.delete(id); fetchTasks() } catch {} }
  const handleRetry = async (id) => { try { await taskAPI.retry(id); fetchTasks() } catch {} }

  const filtered = filter === 'all' ? tasks : tasks.filter(t => t.status === filter)

  return (
    <PageLayout className="p-4 sm:p-6">
      <div className="max-w-5xl mx-auto">
        <div className="flex items-center gap-2 mb-4">
          <button onClick={() => history.back()} className="p-2 rounded-lg hover:bg-black/5" style={{ color: 'var(--text-primary)' }}><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m15 18-6-6 6-6"/></svg></button>
          <h1 className="text-xl font-semibold" style={{ color: 'var(--text-primary)' }}>任务记录 ({tasks.length})</h1>
          <button onClick={fetchTasks} className="ml-auto p-2 rounded-lg hover:bg-black/5" style={{ color: 'var(--text-primary)' }}><RefreshCw size={18} /></button>
        </div>
        <div className="flex gap-2 mb-4">{['all', 'completed', 'processing', 'queued', 'failed'].map(f => (
          <button key={f} onClick={() => setFilter(f)} className={`px-3 py-1.5 rounded-lg text-xs font-medium ${filter === f ? 'bg-accent/10' : 'hover:bg-black/5'}`}
            style={{ color: filter === f ? 'var(--accent)' : 'var(--text-secondary)' }}>{{ all: '全部', completed: '已完成', processing: '生成中', queued: '排队中', failed: '失败' }[f]}</button>
        ))}</div>
        {loading ? <div className="flex justify-center py-20"><div className="w-8 h-8 border-2 rounded-full animate-spin-slow" style={{ borderTopColor: 'var(--accent)', borderColor: 'var(--border-color)' }} /></div>
        : filtered.length === 0 ? <div className="text-center py-20" style={{ color: 'var(--text-secondary)' }}>暂无任务</div>
        : <div className="space-y-3">{filtered.map(task => {
          const cfg = statusMap[task.status] || statusMap.pending
          const Icon = cfg.icon
          return (
            <div key={task.task_id} className="p-4 rounded-xl border" style={{ background: 'var(--bg-ai-bubble)', borderColor: 'var(--border-color)' }}>
              <div className="flex items-start gap-3">
                <Icon size={20} style={{ color: cfg.color }} className="flex-shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>{task.params?.prompt?.slice(0, 50) || '未命名'}</span>
                    <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{ background: cfg.color + '15', color: cfg.color }}>{cfg.label}</span>
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs" style={{ color: 'var(--text-secondary)' }}>
                    <span>ID: {task.task_id}</span><span>时间: {task.created_at}</span>
                    {formatDuration(task.started_at, task.completed_at) && <span>耗时: {formatDuration(task.started_at, task.completed_at)}</span>}
                    {task.progress != null && <span>进度: {task.progress}%</span>}
                    {task.result_urls?.length > 0 && <span>结果: {task.result_urls.length} 张</span>}
                  </div>
                  {task.error && <p className="text-xs mt-1 text-red-500">{task.error}</p>}
                </div>
                <div className="flex gap-1 flex-shrink-0">
                  {task.status === 'failed' && <button onClick={() => handleRetry(task.task_id)} className="p-1.5 rounded-lg hover:bg-black/5" style={{ color: 'var(--text-secondary)' }}><RefreshCw size={14} /></button>}
                  <button onClick={() => handleDelete(task.task_id)} className="p-1.5 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20" style={{ color: '#ef4444' }}><Trash2 size={14} /></button>
                </div>
              </div>
            </div>
          )
        })}</div>}
      </div>
    </PageLayout>
  )
}
