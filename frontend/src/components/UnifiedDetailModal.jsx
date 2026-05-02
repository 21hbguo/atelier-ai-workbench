import { useState, useEffect, useRef, useCallback } from 'react'
import { X, Copy, Download, Trash2, Plus, Image as ImageIcon, Maximize2, Heart, ChevronLeft, ChevronRight, Loader2 } from 'lucide-react'
import { imageAPI } from '../api'

function InfoItem({ label, value }) {
  return (
    <div>
      <label className="text-xs" style={{ color: 'var(--text-secondary)' }}>{label}</label>
      <p className="text-sm truncate" style={{ color: 'var(--text-primary)' }}>{value}</p>
    </div>
  )
}

export default function UnifiedDetailModal({
  card,
  cards = [],
  currentIndex = 0,
  onNavigate,
  onClose,
  onLike,
  onUsePrompt,
  onUseImage,
  onDelete,
  onMetadataSaved,
  detailExtra,
  title = '详情',
}) {
  const [lightbox, setLightbox] = useState(false)
  const [copied, setCopied] = useState(false)
  const [saving, setSaving] = useState(false)
  const touchStartX = useRef(0)
  const touchStartY = useRef(0)

  const hasNavigation = cards.length > 1
  const canPrev = hasNavigation && currentIndex > 0
  const canNext = hasNavigation && currentIndex < cards.length - 1

  const handlePrev = useCallback(() => {
    if (canPrev && onNavigate) onNavigate(currentIndex - 1)
  }, [canPrev, currentIndex, onNavigate])

  const handleNext = useCallback(() => {
    if (canNext && onNavigate) onNavigate(currentIndex + 1)
  }, [canNext, currentIndex, onNavigate])

  useEffect(() => {
    if (!hasNavigation) return
    const handleKeyDown = (e) => {
      if (e.key === 'ArrowLeft') handlePrev()
      else if (e.key === 'ArrowRight') handleNext()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [hasNavigation, handlePrev, handleNext])

  const handleTouchStart = (e) => {
    touchStartX.current = e.touches[0].clientX
    touchStartY.current = e.touches[0].clientY
  }

  const handleTouchEnd = (e) => {
    const deltaX = e.changedTouches[0].clientX - touchStartX.current
    const deltaY = e.changedTouches[0].clientY - touchStartY.current
    if (Math.abs(deltaX) > Math.abs(deltaY) && Math.abs(deltaX) > 50) {
      if (deltaX > 0) handlePrev()
      else handleNext()
    }
  }

  if (!card) return null

  const isImage = card._type === 'image'
  const raw = card._raw

  const handleCopy = async (text) => {
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      const ta = document.createElement('textarea')
      ta.value = text
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      document.body.removeChild(ta)
    }
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  const renderLeftPanel = () => {
    if (!card.fullUrl) {
      return (
        <div className="md:w-3/5 bg-black flex items-center justify-center min-h-[200px] md:min-h-0" style={{ background: 'linear-gradient(135deg, var(--accent)08, var(--accent)15)' }}>
          <ImageIcon size={64} style={{ color: 'var(--accent)', opacity: 0.3 }} />
        </div>
      )
    }
    return (
      <div className="md:w-3/5 bg-black flex items-center justify-center min-h-[200px] md:min-h-0 relative group cursor-pointer overflow-hidden" onClick={() => setLightbox(true)}>
        <img src={card.fullUrl} alt="" className="max-w-full max-h-[60vh] md:max-h-full object-contain" />
        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center">
          <Maximize2 size={24} className="text-white opacity-0 group-hover:opacity-100 transition-opacity" />
        </div>
        {hasNavigation && (
          <div className="absolute bottom-2 left-1/2 -translate-x-1/2 px-2 py-1 rounded-full bg-black/50 text-white text-xs">
            {currentIndex + 1} / {cards.length}
          </div>
        )}
      </div>
    )
  }

  const renderImageDetail = () => {
    const meta = raw.metadata || {}
    return (
      <>
        {card.prompt && (
          <div>
            <label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-secondary)' }}>提示词</label>
            <div className="relative">
              <p className="text-sm p-3 rounded-lg pr-9 max-h-48 md:max-h-72 overflow-y-auto whitespace-pre-wrap break-words" style={{ background: 'var(--bg-primary)', color: 'var(--text-primary)' }}>{card.prompt}</p>
              <button onClick={() => handleCopy(card.prompt)} className="absolute right-2 top-2 p-1 rounded hover:bg-black/5" style={{ color: 'var(--text-secondary)' }}>
                <Copy size={14} />
              </button>
            </div>
            {copied && <span className="text-xs mt-1" style={{ color: 'var(--accent)' }}>已复制</span>}
          </div>
        )}
        <div className="grid grid-cols-2 gap-3">
          {meta.type && <InfoItem label="类型" value={meta.type === 'text' ? '纯文本' : '文本+图像'} />}
          {meta.size && <InfoItem label="尺寸" value={meta.size} />}
          {meta.task_id && <InfoItem label="任务ID" value={meta.task_id} />}
          {meta.created_at && <InfoItem label="创建时间" value={meta.created_at} />}
          {meta.started_at && meta.completed_at && (() => {
            const s = meta.started_at.includes('T') ? meta.started_at : meta.started_at.replace(' ', 'T')
            const e = meta.completed_at.includes('T') ? meta.completed_at : meta.completed_at.replace(' ', 'T')
            const sec = Math.round((new Date(e) - new Date(s)) / 1000)
            const val = sec >= 60 ? `${Math.floor(sec / 60)}分${sec % 60}秒` : `${sec}秒`
            return <InfoItem label="耗时" value={val} />
          })()}
        </div>
        {meta.input_urls?.length > 0 && (
          <div>
            <label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-secondary)' }}>输入图片</label>
            <div className="flex gap-2 flex-wrap">
              {meta.input_urls.map((url, i) => <img key={i} src={url} className="w-16 h-16 rounded-lg object-cover" />)}
            </div>
          </div>
        )}
      </>
    )
  }

  const renderPromptDetail = () => (
    <>
      {card.name && (
        <div>
          <label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-secondary)' }}>标题</label>
          <p className="text-sm" style={{ color: 'var(--text-primary)' }}>{card.name}</p>
        </div>
      )}
      {card.prompt && (
        <div>
          <label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-secondary)' }}>提示词</label>
          <div className="relative">
            <p className="text-sm p-3 rounded-lg pr-9 max-h-48 md:max-h-72 overflow-y-auto whitespace-pre-wrap break-words" style={{ background: 'var(--bg-primary)', color: 'var(--text-primary)' }}>{card.prompt}</p>
            <button onClick={() => handleCopy(card.prompt)} className="absolute right-2 top-2 p-1 rounded hover:bg-black/5" style={{ color: 'var(--text-secondary)' }}>
              <Copy size={14} />
            </button>
          </div>
          {copied && <span className="text-xs mt-1" style={{ color: 'var(--accent)' }}>已复制</span>}
        </div>
      )}
      <div className="grid grid-cols-2 gap-3">
        {card.author && <InfoItem label="作者" value={card.author} />}
        {card.categoryLabel && <InfoItem label="分类" value={card.categoryLabel} />}
        {card.createdAt && <InfoItem label="创建时间" value={card.createdAt} />}
      </div>
      {card.tags?.length > 0 && (
        <div>
          <label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-secondary)' }}>标签</label>
          <div className="flex gap-1.5 flex-wrap">
            {card.tags.map((tag, i) => (
              <span key={i} className="text-xs px-2 py-0.5 rounded-full" style={{ background: 'var(--accent)15', color: 'var(--accent)' }}>{tag}</span>
            ))}
          </div>
        </div>
      )}
    </>
  )

  const renderActions = () => {
    const actions = []
    if (isImage && card.fullUrl) {
      actions.push(
        <a key="dl" href={card.fullUrl} download className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium text-white" style={{ background: 'var(--accent)' }}>
          <Download size={14} /> 下载
        </a>
      )
    }
    if (card.prompt && onUsePrompt) {
      actions.push(
        <button key="use-prompt" onClick={() => onUsePrompt(card.prompt)} className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium hover:bg-black/5" style={{ color: 'var(--text-primary)' }}>
          <Plus size={14} /> 使用提示词
        </button>
      )
    }
    if (card.fullUrl && onUseImage) {
      actions.push(
        <button key="use-image" onClick={() => onUseImage(card)} className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium hover:bg-black/5" style={{ color: 'var(--text-primary)' }}>
          <ImageIcon size={14} /> 参考图
        </button>
      )
    }
    if (onLike) {
      actions.push(
        <button key="like" onClick={() => onLike(card.id)} className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium ${card.isLiked ? 'bg-red-50 dark:bg-red-900/20' : 'hover:bg-black/5'}`} style={{ color: card.isLiked ? '#ef4444' : 'var(--text-primary)' }}>
          <Heart size={14} className={card.isLiked ? 'fill-current' : ''} /> {(card.likesCount > 0 || card.isLiked) ? card.likesCount : ''}
        </button>
      )
    }
    if (onDelete && isImage && raw.filename) {
      actions.push(
        <button key="delete" onClick={() => onDelete(raw.filename)} className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20">
          <Trash2 size={14} /> 删除
        </button>
      )
    }
    return actions
  }

  return (
    <>
      <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={onClose}>
        <div
          className="bg-white dark:bg-gray-900 rounded-2xl overflow-hidden max-w-4xl w-full max-h-[90vh] flex flex-col md:flex-row shadow-2xl relative"
          onClick={(e) => e.stopPropagation()}
          onTouchStart={hasNavigation ? handleTouchStart : undefined}
          onTouchEnd={hasNavigation ? handleTouchEnd : undefined}
        >
          {hasNavigation && canPrev && (
            <button onClick={handlePrev} className="hidden md:flex absolute left-3 top-1/2 -translate-y-1/2 z-10 p-3 rounded-full bg-black/30 backdrop-blur-sm hover:bg-black/50 hover:scale-110 text-white transition-all items-center justify-center">
              <ChevronLeft size={24} />
            </button>
          )}
          {hasNavigation && canNext && (
            <button onClick={handleNext} className="hidden md:flex absolute right-3 top-1/2 -translate-y-1/2 z-10 p-3 rounded-full bg-black/30 backdrop-blur-sm hover:bg-black/50 hover:scale-110 text-white transition-all items-center justify-center" style={{ right: 'calc(40% + 12px)' }}>
              <ChevronRight size={24} />
            </button>
          )}

          {renderLeftPanel()}

          <div className="md:w-2/5 p-5 flex flex-col gap-4 overflow-y-auto" style={{ color: 'var(--text-primary)' }}>
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>{title}</span>
              <button onClick={onClose} className="p-1 rounded hover:bg-black/5"><X size={18} /></button>
            </div>

            {detailExtra || (isImage ? renderImageDetail() : renderPromptDetail())}

            <div className="flex flex-wrap gap-2 mt-auto pt-2">
              {renderActions()}
            </div>
          </div>
        </div>
      </div>

      {lightbox && card.fullUrl && (
        <div className="fixed inset-0 bg-black/80 z-[60] flex items-center justify-center p-4" onClick={() => setLightbox(false)}>
          <img src={card.fullUrl} alt="" className="max-w-full max-h-full rounded-lg" onClick={(e) => e.stopPropagation()} />
        </div>
      )}
    </>
  )
}
