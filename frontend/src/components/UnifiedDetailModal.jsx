import { useState, useEffect, useRef, useCallback } from 'react'
import { X, Copy, Download, Trash2, Plus, Image as ImageIcon, Maximize2, Heart, ChevronLeft, ChevronRight, Edit2, Check } from 'lucide-react'
import { imageAPI } from '../api'
import { useAppDialog } from './AppDialogProvider'

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
  onShare,
  onExtend,
  onMetadataSaved,
  detailExtra,
  title = '详情',
  hideDownload = false,
  allowMetadataEdit = false,
}) {
  const dialog = useAppDialog()
  const [lightbox, setLightbox] = useState(false)
  const [copied, setCopied] = useState(false)
  const [editing, setEditing] = useState(false)
  const [editForm, setEditForm] = useState(null)
  const [saving, setSaving] = useState(false)
  const [contentVisible, setContentVisible] = useState(true)
  const touchStartX = useRef(0)
  const touchStartY = useRef(0)
  const touchLastX = useRef(0)
  const touchLastY = useRef(0)
  const touchSwiped = useRef(false)

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
  useEffect(() => {
    setEditing(false)
    setEditForm(null)
  }, [card?.id, currentIndex])
  useEffect(() => {
    setContentVisible(false)
    const t = setTimeout(() => setContentVisible(true), 20)
    return () => clearTimeout(t)
  }, [currentIndex, card?.id])

  const handleTouchStart = (e) => {
    if (!e.touches?.length) return
    touchStartX.current = e.touches[0].clientX
    touchStartY.current = e.touches[0].clientY
    touchLastX.current = e.touches[0].clientX
    touchLastY.current = e.touches[0].clientY
    touchSwiped.current = false
  }

  const handleTouchMove = (e) => {
    if (!e.touches?.length) return
    touchLastX.current = e.touches[0].clientX
    touchLastY.current = e.touches[0].clientY
  }

  const handleTouchEnd = (e) => {
    if (!e.changedTouches?.length) return
    const endX = touchLastX.current || e.changedTouches[0].clientX
    const endY = touchLastY.current || e.changedTouches[0].clientY
    const deltaX = endX - touchStartX.current
    const deltaY = endY - touchStartY.current
    if (Math.abs(deltaX) >= 36 && Math.abs(deltaY) <= 24 && Math.abs(deltaX) > Math.abs(deltaY) * 1.2) {
      touchSwiped.current = true
      if (deltaX > 0) handlePrev()
      else handleNext()
    }
  }

  const handleMediaClick = () => {
    if (touchSwiped.current) { touchSwiped.current = false; return }
    setLightbox(true)
  }

  if (!card) return null

  const isImage = card._type === 'image' || (!card._type && (card.fullUrl || card.url || card.filename || card.metadata))
  const raw = card._raw || { metadata: card.metadata || {}, filename: card.filename || null }
  const fullUrl = card.fullUrl || card.url || ''
  const meta = typeof raw.metadata === 'string' ? JSON.parse(raw.metadata || '{}') : (raw.metadata || {})
  const handleSaveMetadata = async () => {
    if (!editForm || !raw.filename || saving) return
    setSaving(true)
    try {
      await imageAPI.saveMetadata(raw.filename, editForm)
      setEditing(false)
      setEditForm(null)
      onMetadataSaved?.(editForm)
    } catch (e) {
      dialog.alert('保存失败: ' + (e?.message || '未知错误'))
    } finally {
      setSaving(false)
    }
  }
  const startEditing = () => {
    setEditForm({ ...meta })
    setEditing(true)
  }

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
    if (!fullUrl) {
      return (
        <div className={`md:w-3/5 bg-black flex items-center justify-center min-h-[260px] h-[44vh] md:h-full relative transition-opacity duration-150 ${contentVisible ? 'opacity-100' : 'opacity-0'}`} style={{ background: 'linear-gradient(135deg, var(--accent)08, var(--accent)15)' }}>
          <ImageIcon size={64} style={{ color: 'var(--accent)', opacity: 0.3 }} />
        </div>
      )
    }
    return (
      <div className={`md:w-3/5 bg-black flex items-center justify-center min-h-[260px] h-[44vh] md:h-full relative group cursor-pointer overflow-hidden transition-opacity duration-150 ${contentVisible ? 'opacity-100' : 'opacity-0'}`} onClick={handleMediaClick}>
        <img src={fullUrl} alt="" className="max-w-full max-h-full object-contain" />
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
    if (editing && editForm) {
      return (
        <div className="space-y-2.5">
          <div>
            <label className="text-xs font-medium mb-1 block leading-none" style={{ color: 'var(--text-secondary)' }}>提示词</label>
            <textarea value={editForm.prompt || ''} onChange={e => setEditForm(f => ({ ...f, prompt: e.target.value }))} className="w-full px-3 py-2 rounded-lg text-sm border outline-none resize-none" style={{ background: 'var(--bg-primary)', borderColor: 'var(--border-color)', color: 'var(--text-primary)' }} rows={3} />
          </div>
          {(meta.size || editForm.size !== undefined) && (
            <div>
              <label className="text-xs font-medium mb-1 block leading-none" style={{ color: 'var(--text-secondary)' }}>尺寸</label>
              <input value={editForm.size || ''} onChange={e => setEditForm(f => ({ ...f, size: e.target.value }))} className="w-full px-3 py-2 rounded-lg text-sm border outline-none" style={{ background: 'var(--bg-primary)', borderColor: 'var(--border-color)', color: 'var(--text-primary)' }} />
            </div>
          )}
        </div>
      )
    }
    return (
      <>
        {card.prompt && (
          <div>
            <label className="text-xs font-medium mb-1 block leading-none" style={{ color: 'var(--text-secondary)' }}>提示词</label>
            <div className="relative">
              <p className="text-sm p-2.5 rounded-lg pr-9 max-h-36 md:max-h-56 overflow-y-auto whitespace-pre-wrap break-words leading-5" style={{ background: 'var(--bg-primary)', color: 'var(--text-primary)' }}>{card.prompt}</p>
              <button onClick={() => handleCopy(card.prompt)} className="absolute right-2 top-2 p-1 rounded hover:bg-black/5" style={{ color: 'var(--text-secondary)' }}>
                <Copy size={14} />
              </button>
            </div>
            {copied && <span className="text-xs mt-1" style={{ color: 'var(--accent)' }}>已复制</span>}
          </div>
        )}
        <div className="grid grid-cols-2 gap-2">
          {meta.type && <InfoItem label="类型" value={meta.type === 'text' ? '纯文本' : '文本+图像'} />}
          {meta.size && <InfoItem label="尺寸" value={meta.size} />}
          {(card.is_permanent || card.expiresAt || card.expired || typeof card.daysLeft === 'number') && <InfoItem label="有效期" value={card.is_permanent ? '已分享到广场，永久保存' : (card.expired ? `已过期（到期时间 ${card.expiresAt || '-' }）` : `${typeof card.daysLeft === 'number' ? card.daysLeft : '-'}天后过期`)} />}
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
            <label className="text-xs font-medium mb-1 block leading-none" style={{ color: 'var(--text-secondary)' }}>输入图片</label>
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
          <label className="text-xs font-medium mb-1 block leading-none" style={{ color: 'var(--text-secondary)' }}>标题</label>
          <p className="text-sm" style={{ color: 'var(--text-primary)' }}>{card.name}</p>
        </div>
      )}
      {card.prompt && (
        <div>
          <label className="text-xs font-medium mb-1 block leading-none" style={{ color: 'var(--text-secondary)' }}>提示词</label>
          <div className="relative">
            <p className="text-sm p-2.5 rounded-lg pr-9 max-h-36 md:max-h-56 overflow-y-auto whitespace-pre-wrap break-words leading-5" style={{ background: 'var(--bg-primary)', color: 'var(--text-primary)' }}>{card.prompt}</p>
            <button onClick={() => handleCopy(card.prompt)} className="absolute right-2 top-2 p-1 rounded hover:bg-black/5" style={{ color: 'var(--text-secondary)' }}>
              <Copy size={14} />
            </button>
          </div>
          {copied && <span className="text-xs mt-1" style={{ color: 'var(--accent)' }}>已复制</span>}
        </div>
      )}
      <div className="grid grid-cols-2 gap-2">
        {card.author && <InfoItem label="作者" value={card.author} />}
        {card.categoryLabel && <InfoItem label="分类" value={card.categoryLabel} />}
        {card.createdAt && <InfoItem label="创建时间" value={card.createdAt} />}
      </div>
      {card.tags?.length > 0 && (
        <div>
          <label className="text-xs mb-1 block leading-none" style={{ color: 'var(--text-secondary)' }}>标签</label>
          <div className="flex gap-1.5 flex-wrap">
            {card.tags.map((tag, i) => (
              <span key={i} className="text-sm" style={{ color: 'var(--text-primary)' }}>{tag}</span>
            ))}
          </div>
        </div>
      )}
    </>
  )

  const renderActions = () => {
    const actions = []
    if (isImage && fullUrl && !hideDownload) {
      actions.push(
        <a key="dl" href={fullUrl} download className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium text-white" style={{ background: 'var(--accent)' }}>
          <Download size={14} /> 下载
        </a>
      )
    }
    if (onUsePrompt) {
      actions.push(
        <button key="use-prompt" onClick={() => { onUsePrompt(card.prompt); onClose?.() }} className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-black/5" style={{ color: 'var(--text-primary)' }}>
          <Plus size={14} /> 使用提示词
        </button>
      )
    }
    if (fullUrl && onUseImage) {
      actions.push(
        <button key="use-image" onClick={() => { onUseImage(card); onClose?.() }} className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-black/5" style={{ color: 'var(--text-primary)' }}>
          <ImageIcon size={14} /> 参考图
        </button>
      )
    }
    if (onLike) {
      actions.push(
        <button key="like" onClick={() => onLike(card.id)} className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium ${card.isLiked ? 'bg-red-50 dark:bg-red-900/20' : 'hover:bg-black/5'}`} style={{ color: card.isLiked ? '#ef4444' : 'var(--text-primary)' }}>
          <Heart size={14} className={card.isLiked ? 'fill-current' : ''} /> {(card.likesCount > 0 || card.isLiked) ? card.likesCount : ''}
        </button>
      )
    }
    if (onDelete && isImage && raw.filename) {
      actions.push(
        <button key="delete" onClick={() => onDelete(raw.filename)} className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20">
          <Trash2 size={14} /> 删除
        </button>
      )
    }
    if (onShare && isImage && raw.filename) {
      actions.push(
        <button key="share" onClick={() => onShare(card)} className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-black/5" style={{ color: 'var(--text-primary)' }}>
          分享广场
        </button>
      )
    }
    if (onExtend && isImage && raw.filename && !card.is_permanent) {
      actions.push(
        <button key="extend" onClick={() => onExtend(card)} className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-black/5" style={{ color: 'var(--text-primary)' }}>
          延长3天(-2积分)
        </button>
      )
    }
    return actions
  }

  return (
    <>
      <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-3 md:p-4" onClick={onClose}>
        <div
          className="bg-white dark:bg-gray-900 rounded-2xl overflow-hidden max-w-5xl w-full h-[88vh] md:h-[84vh] flex flex-col md:flex-row shadow-2xl relative"
          onClick={(e) => e.stopPropagation()}
          onTouchStart={hasNavigation ? handleTouchStart : undefined}
          onTouchMove={hasNavigation ? handleTouchMove : undefined}
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

          <div className={`md:w-2/5 flex-1 md:flex-none p-3.5 md:p-4 flex flex-col gap-2.5 overflow-y-auto transition-opacity duration-150 ${contentVisible ? 'opacity-100' : 'opacity-0'}`} style={{ color: 'var(--text-primary)' }}>
            <div className="flex items-center justify-between mb-0.5">
              <span className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>{title}</span>
              <div className="flex items-center gap-2">
                {allowMetadataEdit && isImage && raw.filename && !detailExtra && (editing ? <button onClick={handleSaveMetadata} disabled={saving} className="p-1 rounded hover:bg-black/5" style={{ color: 'var(--accent)' }}><Check size={16} /></button> : <button onClick={startEditing} className="p-1 rounded hover:bg-black/5" style={{ color: 'var(--text-secondary)' }}><Edit2 size={16} /></button>)}
                <button onClick={onClose} className="p-1 rounded hover:bg-black/5"><X size={18} /></button>
              </div>
            </div>

            {detailExtra || (isImage ? renderImageDetail() : renderPromptDetail())}

            <div className="flex flex-wrap gap-1.5 mt-auto pt-1.5">
              {renderActions()}
            </div>
          </div>
        </div>
      </div>

      {lightbox && fullUrl && (
        <div className="fixed inset-0 bg-black/80 z-[60] flex items-center justify-center p-4" onClick={() => setLightbox(false)}>
          <img src={fullUrl} alt="" className="max-w-full max-h-full rounded-lg" onClick={(e) => e.stopPropagation()} />
        </div>
      )}
    </>
  )
}
