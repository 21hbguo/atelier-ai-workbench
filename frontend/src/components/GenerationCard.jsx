import { useState, useEffect } from 'react'
import { RefreshCw, Check, Plus, Image, Share2 } from 'lucide-react'
import { squareAPI } from '../api'

const statusConfig = {
  queued: { color: '#f59e0b', bg: '#f59e0b20', label: '排队中' },
  pending: { color: 'var(--text-secondary)', bg: 'var(--border-color)', label: '等待中' },
  processing: { color: '#f59e0b', bg: '#f59e0b20', label: '生成中' },
  completed: { color: 'var(--accent)', bg: 'var(--accent)20', label: '已完成' },
  failed: { color: '#ef4444', bg: '#ef444420', label: '失败' },
}

function getProgress(startedAt, status) {
  if (!startedAt || status === 'completed') return status === 'completed' ? 100 : 0
  if (status === 'failed') return 0
  const t = startedAt.includes('T') ? startedAt : startedAt.replace(' ', 'T')
  const elapsed = (Date.now() - new Date(t).getTime()) / 1000
  return Math.min(99 * (1 - Math.exp(-elapsed / 30)), 99)
}

export default function GenerationCard({ task, onAddImage, onAddPrompt, onRetry, selectMode, checked, onToggleCheck, showUsername, username, onViewDetail }) {
  const [progress, setProgress] = useState(() => getProgress(task.started_at, task.status))
  const [shared, setShared] = useState(false)
  const [sharing, setSharing] = useState(false)

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
  const prompt = task.params?.prompt || task.prompt || ''

  const handleShare = async (e) => {
    e.stopPropagation()
    if (shared || sharing) return
    setSharing(true)
    try {
      const filename = images[0].full.split('/').pop()
      await squareAPI.share({
        filename,
        prompt,
        metadata: { size: task.params?.size, type: task.params?.image_urls?.length ? 'image' : 'text' },
      })
      setShared(true)
    } catch (err) {
      if (err.message?.includes('已分享')) setShared(true)
    } finally {
      setSharing(false)
    }
  }

  return (
    <>
      <div
        className={`group relative rounded-xl overflow-hidden shadow-sm hover:shadow-md transition-shadow cursor-pointer ${checked ? 'ring-2 ring-accent/50' : ''}`}
        onClick={() => {
          if (selectMode) { onToggleCheck?.(); return }
          if (isCompleted) onViewDetail?.()
        }}
      >
        {selectMode && (
          <div className={`absolute top-2 left-2 z-20 w-5 h-5 rounded-md border-2 flex items-center justify-center transition-colors ${checked ? 'bg-accent border-accent' : 'bg-white/80 border-gray-300'}`}>
            {checked && <Check size={12} className="text-white" />}
          </div>
        )}
        {selectMode && checked && <div className="absolute inset-0 bg-accent/10 pointer-events-none z-10" />}

        {images.length > 0 ? (
          <img src={images[0].thumb} alt="" className="w-full aspect-square object-cover" />
        ) : (
          <div className="w-full aspect-square flex flex-col items-center justify-center gap-3" style={{ background: cfg.bg }}>
            {task.status === 'processing' || task.status === 'queued' ? (
              <>
                <div className="w-10 h-10 rounded-full border-2 border-t-transparent animate-spin" style={{ borderColor: cfg.color, borderTopColor: 'transparent' }} />
                <span className="text-xs font-medium" style={{ color: cfg.color }}>{cfg.label} {Math.round(progress)}%</span>
              </>
            ) : task.status === 'failed' ? (
              <>
                <span className="text-2xl">!</span>
                <span className="text-xs font-medium" style={{ color: cfg.color }}>{cfg.label}</span>
              </>
            ) : (
              <span className="text-xs font-medium" style={{ color: cfg.color }}>{cfg.label}</span>
            )}
          </div>
        )}

        {/* admin: username badge */}
        {showUsername && username && isCompleted && !selectMode && (
          <div className="absolute top-2 left-2 z-10 flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-black/50 backdrop-blur-sm">
            <span className="text-white text-xs truncate max-w-[80px]">{username}</span>
          </div>
        )}

        {/* hover actions */}
        {!selectMode && isCompleted && (
          <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors hidden md:flex items-center justify-center gap-1.5">
            {prompt && onAddPrompt && (
              <button
                onClick={(e) => { e.stopPropagation(); onAddPrompt(prompt) }}
                className="opacity-0 group-hover:opacity-100 transition-opacity px-2.5 py-1.5 rounded-lg text-xs font-medium bg-white/90 text-gray-800 hover:bg-white flex items-center gap-1"
              >
                <Plus size={12} /> 提示词
              </button>
            )}
            {onAddImage && (
              <button
                onClick={(e) => { e.stopPropagation(); onAddImage(images[0].full) }}
                className="opacity-0 group-hover:opacity-100 transition-opacity px-2.5 py-1.5 rounded-lg text-xs font-medium bg-white/90 text-gray-800 hover:bg-white flex items-center gap-1"
              >
                <Image size={12} /> 参考图
              </button>
            )}
            <button
              onClick={handleShare}
              disabled={shared || sharing}
              className={`opacity-0 group-hover:opacity-100 transition-opacity px-2.5 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1 ${
                shared
                  ? 'bg-green-500/90 text-white cursor-default'
                  : 'bg-white/90 text-gray-800 hover:bg-white'
              }`}
            >
              <Share2 size={12} /> {shared ? '已分享' : sharing ? '...' : '广场'}
            </button>
          </div>
        )}

        {/* status badge - top right */}
        {!isCompleted && !selectMode && (
          <div className="absolute top-2 right-2 flex items-center gap-1 px-2 py-1 rounded-full bg-black/50 backdrop-blur-sm">
            <span className="text-white text-xs font-medium">{cfg.label}</span>
          </div>
        )}

        {/* failed: retry button */}
        {task.status === 'failed' && onRetry && !selectMode && (
          <button
            onClick={(e) => { e.stopPropagation(); onRetry(task.task_id) }}
            className="absolute top-2 right-2 flex items-center gap-1 px-2 py-1 rounded-full bg-black/50 backdrop-blur-sm text-white text-xs hover:bg-black/70 transition-colors"
          >
            <RefreshCw size={12} /> 重试
          </button>
        )}

        {/* progress bar */}
        {(task.status === 'processing' || task.status === 'queued') && (
          <div className="absolute bottom-0 left-0 right-0 h-1">
            <div className="h-full transition-all duration-1000" style={{ width: `${progress}%`, background: cfg.color }} />
          </div>
        )}

        {/* prompt / error overlay */}
        {task.error && !selectMode ? (
          <div className="absolute bottom-0 left-0 right-0 px-2 py-1.5 bg-gradient-to-t from-red-900/80 to-transparent">
            <p className="text-red-200 text-xs truncate">{task.error}</p>
          </div>
        ) : prompt ? (
          <div className="absolute bottom-0 left-0 right-0 px-2 py-1.5 bg-gradient-to-t from-black/70 to-transparent">
            <p className="text-white text-xs truncate">{prompt}</p>
          </div>
        ) : null}
      </div>
    </>
  )
}
