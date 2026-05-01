import { useState, useEffect } from 'react'
import { Maximize2, RefreshCw, Check, Eye, Plus } from 'lucide-react'
import ImageDetailModal from './ImageDetailModal'

const statusConfig = {
  queued: { color: '#f59e0b', bg: '#f59e0b15', label: '排队中' },
  pending: { color: 'var(--text-secondary)', bg: 'var(--border-color)', label: '等待中' },
  processing: { color: '#f59e0b', bg: '#f59e0b15', label: '生成中' },
  completed: { color: 'var(--accent)', bg: 'var(--accent)15', label: '已完成' },
  failed: { color: '#ef4444', bg: '#ef444415', label: '失败' },
}

function getProgress(startedAt, status) {
  if (!startedAt || status === 'completed') return status === 'completed' ? 100 : 0
  if (status === 'failed') return 0
  const t = startedAt.includes('T') ? startedAt : startedAt.replace(' ', 'T')
  const elapsed = (Date.now() - new Date(t).getTime()) / 1000
  return Math.min(99 * (1 - Math.exp(-elapsed / 30)), 99)
}

export default function GenerationCard({ task, onAddImage, onRetry, selectMode, checked, onToggleCheck }) {
  const [showDetail, setShowDetail] = useState(false)
  const [progress, setProgress] = useState(() => getProgress(task.started_at, task.status))

  useEffect(() => {
    if (task.status !== 'processing' && task.status !== 'queued') return
    const timer = setInterval(() => setProgress(getProgress(task.started_at, task.status)), 1000)
    return () => clearInterval(timer)
  }, [task.started_at, task.status])

  useEffect(() => {
    if (task.status === 'completed') setProgress(100)
  }, [task.status])

  const cfg = statusConfig[task.status] || statusConfig.pending
  const isCompleted = task.status === 'completed' && task.result_urls?.length
  const images = isCompleted
    ? task.result_urls.map(u => { const f = u.split('/').pop(); return { thumb: `/api/images/thumb/${f}`, full: `/api/images/file/${f}` } })
    : (task.previewImages || []).map(u => ({ thumb: u, full: u }))
  const timestamp = task.created_at
  const prompt = task.params?.prompt || task.prompt || ''

  const imageData = isCompleted ? {
    url: images[0].full,
    filename: images[0].full.split('/').pop(),
    metadata: {
      prompt,
      task_id: task.task_id,
      created_at: task.created_at,
      type: task.params?.image_urls?.length ? 'image' : 'text',
      size: task.params?.size,
      input_urls: task.params?.image_urls,
    },
  } : null

  return (
    <>
      <div className={`rounded-xl border p-3 animate-fade-in-up relative ${checked ? 'ring-2 ring-accent/50' : ''}`}
        style={{ background: 'var(--bg-ai-bubble)', borderColor: 'var(--border-color)', boxShadow: 'var(--shadow-sm)' }}
        onClick={() => selectMode && onToggleCheck?.()}>
        {selectMode && (
          <div className={`absolute top-2 left-2 z-10 w-5 h-5 rounded-md border-2 flex items-center justify-center transition-colors ${checked ? 'bg-accent border-accent' : 'bg-white/80 border-gray-300'}`}>
            {checked && <Check size={12} className="text-white" />}
          </div>
        )}
        {selectMode && checked && <div className="absolute inset-0 bg-accent/10 rounded-xl pointer-events-none z-10" />}
        {images.length > 0 && (
          <div className="rounded-lg overflow-hidden mb-3 group relative">
            <img src={images[0].thumb} alt="" className="w-full aspect-square object-cover cursor-pointer" />
            {!selectMode && (
              <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors flex items-center justify-center gap-2">
                {isCompleted && (
                  <>
                    <button
                      onClick={(e) => { e.stopPropagation(); setShowDetail(true) }}
                      className="opacity-0 group-hover:opacity-100 transition-opacity px-3 py-1.5 rounded-lg text-xs font-medium bg-white/90 text-gray-800 hover:bg-white flex items-center gap-1"
                    >
                      <Eye size={14} /> 查看
                    </button>
                    {onAddImage && (
                      <button
                        onClick={(e) => { e.stopPropagation(); onAddImage(images[0].full) }}
                        className="opacity-0 group-hover:opacity-100 transition-opacity px-3 py-1.5 rounded-lg text-xs font-medium bg-white/90 text-gray-800 hover:bg-white flex items-center gap-1"
                      >
                        <Plus size={14} /> 添加
                      </button>
                    )}
                  </>
                )}
                {!isCompleted && (
                  <Maximize2 size={20} className="opacity-0 group-hover:opacity-100 transition-opacity text-white" />
                )}
              </div>
            )}
          </div>
        )}

        {prompt && <p className="text-sm mb-2 line-clamp-2" style={{ color: 'var(--text-primary)' }}>{prompt}</p>}

        <div className="flex items-center gap-2 mb-2">
          <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{ background: cfg.bg, color: cfg.color }}>{cfg.label}</span>
          {(task.status === 'processing' || task.status === 'queued') && (
            <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--border-color)' }}>
              <div className="h-full rounded-full transition-all duration-1000" style={{ width: `${progress}%`, background: cfg.color }} />
            </div>
          )}
        </div>

        {task.error && <p className="text-xs text-red-500 mb-2">{task.error}</p>}

        {task.status === 'failed' && onRetry && (
          <button onClick={() => onRetry(task.task_id)} className="flex items-center gap-1 text-xs px-2 py-1 rounded-lg hover:bg-black/5 mb-2" style={{ color: 'var(--text-secondary)' }}>
            <RefreshCw size={12} /> 重试
          </button>
        )}

        {timestamp && <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>{timestamp}</div>}
      </div>

      {showDetail && imageData && (
        <ImageDetailModal
          image={imageData}
          onClose={() => setShowDetail(false)}
          onAddImage={onAddImage}
          title="生成详情"
        />
      )}
    </>
  )
}
