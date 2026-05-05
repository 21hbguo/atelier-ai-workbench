import { useState, useEffect } from 'react'
import { RefreshCw, Check, Plus, Image, Share2, User } from 'lucide-react'
import { squareAPI, shareAPI } from '../api'
import UnifiedCard from './UnifiedCard'

const statusConfig = {
  queued: { color: 'var(--color-warning)', bg: 'color-mix(in srgb, var(--color-warning) 12%, transparent)', label: '排队中' },
  pending: { color: 'var(--text-secondary)', bg: 'var(--border-color)', label: '等待中' },
  processing: { color: 'var(--color-warning)', bg: 'color-mix(in srgb, var(--color-warning) 12%, transparent)', label: '生成中' },
  running: { color: 'var(--color-warning)', bg: 'color-mix(in srgb, var(--color-warning) 12%, transparent)', label: '生成中' },
  generating: { color: 'var(--color-warning)', bg: 'color-mix(in srgb, var(--color-warning) 12%, transparent)', label: '生成中' },
  completed: { color: 'var(--accent)', bg: 'color-mix(in srgb, var(--accent) 12%, transparent)', label: '已完成' },
  failed: { color: 'var(--color-error)', bg: 'color-mix(in srgb, var(--color-error) 12%, transparent)', label: '失败' },
}

function getProgress(startedAt, status) {
  if (!startedAt || status === 'completed') return status === 'completed' ? 100 : 0
  if (status === 'failed') return 0
  const t = startedAt.includes('T') ? startedAt : startedAt.replace(' ', 'T')
  const elapsed = (Date.now() - new Date(t).getTime()) / 1000
  return Math.min(99 * (1 - Math.exp(-elapsed / 30)), 99)
}

export default function GenerationCard({ task, onAddImage, onAddPrompt, onRetry, selectMode, checked, onToggleCheck, wasDraggedRef, showUsername, username, onViewDetail, masonry = false, ...rest }) {
  const [progress, setProgress] = useState(() => getProgress(task.started_at, task.status))
  const [shared, setShared] = useState(false)
  const [sharing, setSharing] = useState(false)
  const isProcessing = ['processing', 'queued', 'running', 'generating'].includes(task.status)
  const mediaClassName = masonry ? 'card-feed-media-masonry' : 'card-feed-media'

  useEffect(() => {
    if (!isProcessing) return
    const timer = setInterval(() => setProgress(getProgress(task.started_at, task.status)), 1000)
    return () => clearInterval(timer)
  }, [task.started_at, task.status, isProcessing])

  useEffect(() => {
    if (task.status === 'completed') setProgress(100)
  }, [task.status])

  const cfg = statusConfig[task.status] || statusConfig.pending
  const isCompleted = task.status === 'completed' && Array.isArray(task.result_urls) && task.result_urls.length > 0
  const images = isCompleted
    ? task.result_urls.map(u => { const f = u.split('/').pop(); return { thumb: `/api/images/thumb/${f}?size=400`, thumb2x: `/api/images/thumb/${f}?size=800`, full: `/api/images/file/${f}`, width: task.width || task.image_width || null, height: task.height || task.image_height || null } })
    : (task.previewImages || []).map(u => ({ thumb: u, full: u }))
  const prompt = task.params?.prompt || task.prompt || ''
  const expiryText = task.is_permanent ? '长久' : (task.expired ? '已过期' : (typeof task.days_left === 'number' ? `${task.days_left}天到期` : '3天到期'))

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

  const handleShareLink = async (e) => {
    e.stopPropagation()
    if (sharing) return
    setSharing(true)
    try {
      const filename = images[0].full.split('/').pop()
      const { data } = await shareAPI.create({ filename, expires_days: 7 })
      const url = `${window.location.origin}${data.url}`
      try { await navigator.clipboard.writeText(url) } catch {}
      setShared(true)
    } catch (err) {
      if (err.message?.includes('已分享')) setShared(true)
    } finally {
      setSharing(false)
    }
  }

  return (
    <UnifiedCard
      {...rest}
      className={masonry ? 'card-feed-item-masonry' : ''}
      checked={checked}
      onClick={() => { if (selectMode) { if (wasDraggedRef?.current) { wasDraggedRef.current = false; return } onToggleCheck?.(); return }; if (isCompleted) onViewDetail?.() }}
      mediaNode={isCompleted && images.length > 0 ? <img src={images[0].thumb} srcSet={images[0].thumb2x ? `${images[0].thumb} 1x, ${images[0].thumb2x} 2x` : undefined} sizes="(min-width: 1024px) 20vw, (min-width: 768px) 25vw, (min-width: 640px) 33vw, 50vw" width={images[0].width || undefined} height={images[0].height || undefined} alt="" draggable={false} className={mediaClassName} /> : <div className="w-full aspect-square flex flex-col items-center justify-center gap-3" style={{ background: cfg.bg }}>{isProcessing ? <><div className="w-10 h-10 rounded-full border-2 border-t-transparent animate-spin" style={{ borderColor: cfg.color, borderTopColor: 'transparent' }} /><span className="text-xs font-medium" style={{ color: cfg.color }}>{cfg.label} {Math.round(progress)}%</span></> : task.status === 'failed' ? <><span className="text-2xl">!</span><span className="text-xs font-medium" style={{ color: cfg.color }}>{cfg.label}</span></> : <span className="text-xs font-medium" style={{ color: cfg.color }}>{cfg.label}</span>}</div>}
      hoverNode={!selectMode && isCompleted ? <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors hidden md:flex items-center justify-center gap-1.5">{prompt && onAddPrompt && <button onClick={(e) => { e.stopPropagation(); onAddPrompt(prompt) }} className="opacity-0 group-hover:opacity-100 transition-opacity px-2.5 py-1.5 rounded-lg text-xs font-medium bg-[var(--bg-card)]/90 text-[var(--text-primary)] hover:bg-[var(--bg-card)] flex items-center gap-1"><Plus size={12} /> 提示词</button>}{onAddImage && <button onClick={(e) => { e.stopPropagation(); onAddImage(images[0].full) }} className="opacity-0 group-hover:opacity-100 transition-opacity px-2.5 py-1.5 rounded-lg text-xs font-medium bg-[var(--bg-card)]/90 text-[var(--text-primary)] hover:bg-[var(--bg-card)] flex items-center gap-1"><Image size={12} /> 参考图</button>}</div> : null}
      bottomNode={task.error && !selectMode ? <div className="absolute bottom-0 left-0 right-0 px-2 py-1.5 bg-gradient-to-t from-red-900/80 to-transparent"><p className="text-red-200 text-xs truncate">{task.error}</p></div> : prompt ? <div className="absolute bottom-0 left-0 right-0 px-2 py-1.5 bg-gradient-to-t from-black/70 to-transparent"><p className="text-white text-xs truncate">{prompt}</p></div> : null}
      topLeftNode={showUsername && username && isCompleted && !selectMode ? <div className="absolute top-2 left-2 z-10 flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-black/50 backdrop-blur-sm"><User size={12} className="text-white" /><span className="text-white text-xs truncate max-w-[70px]">{username}</span></div> : null}
      topRightNode={!isCompleted && !selectMode ? <div className="absolute top-2 right-2 flex items-center gap-1 px-2 py-1 rounded-full bg-black/50 backdrop-blur-sm"><span className="text-white text-xs font-medium">{cfg.label}</span></div> : task.status === 'failed' && onRetry && !selectMode ? <button onClick={(e) => { e.stopPropagation(); onRetry(task.task_id) }} className="absolute top-2 right-2 flex items-center gap-1 px-2 py-1 rounded-full bg-black/50 backdrop-blur-sm text-white text-xs hover:bg-black/70 transition-colors"><RefreshCw size={12} /> 重试</button> : (isCompleted && !selectMode ? <div className="absolute top-2 right-2 flex items-center gap-1 px-2 py-1 rounded-full bg-black/50 backdrop-blur-sm"><span className={`text-xs font-medium ${task.is_permanent ? 'text-[#7BC494]' : task.expired ? 'text-[#E07070]' : 'text-[#D4A57A]'}`}>{expiryText}</span></div> : null)}
      selectNode={selectMode ? <><div className={`absolute top-2 left-2 z-20 w-5 h-5 rounded-md border-2 flex items-center justify-center transition-colors ${checked ? 'bg-accent border-accent' : 'bg-white/80 border-gray-300'}`}>{checked && <Check size={12} className="text-white" />}</div>{checked && <div className="absolute inset-0 bg-accent/10 pointer-events-none z-10" />}</> : null}
      overlayNode={isProcessing ? <div className="absolute bottom-0 left-0 right-0 h-1"><div className="h-full transition-all duration-1000" style={{ width: `${progress}%`, background: cfg.color }} /></div> : null}
    />
  )
}
