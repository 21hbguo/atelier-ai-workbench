import { useState, useEffect, useRef, useCallback } from 'react'
import { X, Copy, Download, Trash2, Plus, Image, Maximize2, Edit2, Check, ChevronLeft, ChevronRight } from 'lucide-react'
import { imageAPI } from '../api'

function InfoItem({ label, value }) {
  return (
    <div>
      <label className="text-xs" style={{ color: 'var(--text-secondary)' }}>{label}</label>
      <p className="text-sm truncate" style={{ color: 'var(--text-primary)' }}>{value}</p>
    </div>
  )
}

export default function ImageDetailModal({
  image,
  images = [],
  currentIndex = 0,
  onNavigate,
  onClose,
  onDelete,
  onAddImage,
  onAddPrompt,
  onMetadataSaved,
  title = '生成详情',
  detailContent,
  downloadUrl,
  downloadLabel = '下载',
  downloadExternal = false,
}) {
  const [lightbox, setLightbox] = useState(false)
  const [copied, setCopied] = useState(false)
  const [editing, setEditing] = useState(false)
  const [editForm, setEditForm] = useState(null)
  const [saving, setSaving] = useState(false)
  const touchStartX = useRef(0)
  const touchStartY = useRef(0)

  const hasNavigation = images.length > 1
  const canPrev = hasNavigation && currentIndex > 0
  const canNext = hasNavigation && currentIndex < images.length - 1

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

  if (!image) return null

  const meta = image.metadata || {}
  const url = downloadUrl || image.url

  const handleSaveMetadata = async () => {
    if (!editForm || !image.filename) return
    setSaving(true)
    try {
      await imageAPI.saveMetadata(image.filename, editForm)
      setEditing(false)
      setEditForm(null)
      if (onMetadataSaved) onMetadataSaved(editForm)
    } catch (e) {
      alert('保存失败: ' + e.message)
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
            <button
              onClick={handlePrev}
              className="absolute left-2 top-1/2 -translate-y-1/2 z-10 p-2 rounded-full bg-black/40 hover:bg-black/60 text-white transition-all hidden md:flex items-center justify-center"
            >
              <ChevronLeft size={20} />
            </button>
          )}

          {hasNavigation && canNext && (
            <button
              onClick={handleNext}
              className="absolute right-2 top-1/2 -translate-y-1/2 z-10 p-2 rounded-full bg-black/40 hover:bg-black/60 text-white transition-all hidden md:flex items-center justify-center"
              style={{ right: '40%' }}
            >
              <ChevronRight size={20} />
            </button>
          )}

          <div className="md:w-3/5 bg-black flex items-center justify-center min-h-[200px] md:min-h-0 relative group cursor-pointer" onClick={() => setLightbox(true)}>
            <img src={image.url} alt="" className="max-w-full max-h-[60vh] md:max-h-[90vh] object-contain" />
            <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center">
              <Maximize2 size={24} className="text-white opacity-0 group-hover:opacity-100 transition-opacity" />
            </div>
            {hasNavigation && (
              <div className="absolute bottom-2 left-1/2 -translate-x-1/2 px-2 py-1 rounded-full bg-black/50 text-white text-xs">
                {currentIndex + 1} / {images.length}
              </div>
            )}
          </div>

          <div className="md:w-2/5 p-5 flex flex-col gap-4 overflow-y-auto" style={{ color: 'var(--text-primary)' }}>
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>{title}</span>
              <div className="flex items-center gap-2">
                {!detailContent && image.filename && (
                  editing ? (
                    <button onClick={handleSaveMetadata} disabled={saving} className="p-1 rounded hover:bg-black/5" style={{ color: 'var(--accent)' }}>
                      <Check size={16} />
                    </button>
                  ) : (
                    <button onClick={startEditing} className="p-1 rounded hover:bg-black/5" style={{ color: 'var(--text-secondary)' }}>
                      <Edit2 size={16} />
                    </button>
                  )
                )}
                <button onClick={onClose} className="p-1 rounded hover:bg-black/5"><X size={18} /></button>
              </div>
            </div>

            {detailContent || (
              <>
                {editing && editForm ? (
                  <div className="space-y-3">
                    <div>
                      <label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-secondary)' }}>提示词</label>
                      <textarea
                        value={editForm.prompt || ''}
                        onChange={e => setEditForm(f => ({ ...f, prompt: e.target.value }))}
                        className="w-full px-3 py-2 rounded-lg text-sm border outline-none resize-none"
                        style={{ background: 'var(--bg-primary)', borderColor: 'var(--border-color)', color: 'var(--text-primary)' }}
                        rows={3}
                      />
                    </div>
                    {meta.size && (
                      <div>
                        <label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-secondary)' }}>尺寸</label>
                        <input
                          value={editForm.size || ''}
                          onChange={e => setEditForm(f => ({ ...f, size: e.target.value }))}
                          className="w-full px-3 py-2 rounded-lg text-sm border outline-none"
                          style={{ background: 'var(--bg-primary)', borderColor: 'var(--border-color)', color: 'var(--text-primary)' }}
                        />
                      </div>
                    )}
                  </div>
                ) : (
                  <>
                    {meta.prompt && (
                      <div>
                        <label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-secondary)' }}>提示词</label>
                        <div className="relative">
                          <p className="text-sm p-3 rounded-lg pr-9 max-h-48 md:max-h-72 overflow-y-auto whitespace-pre-wrap break-words" style={{ background: 'var(--bg-primary)', color: 'var(--text-primary)' }}>{meta.prompt}</p>
                          <button onClick={() => handleCopy(meta.prompt)} className="absolute right-2 top-2 p-1 rounded hover:bg-black/5" style={{ color: 'var(--text-secondary)' }}>
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
                )}
              </>
            )}

            <div className="flex gap-2 mt-auto pt-2">
              {downloadExternal ? (
                <a href={url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium text-white" style={{ background: 'var(--accent)' }}>
                  <Download size={14} /> {downloadLabel}
                </a>
              ) : (
                <a href={url} download className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium text-white" style={{ background: 'var(--accent)' }}>
                  <Download size={14} /> {downloadLabel}
                </a>
              )}

              {onAddPrompt && meta.prompt && (
                <button onClick={() => onAddPrompt(meta.prompt)} className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium hover:bg-black/5" style={{ color: 'var(--text-primary)' }}>
                  <Plus size={14} /> 提示词
                </button>
              )}

              {onAddImage && (
                <button onClick={() => onAddImage(image.url)} className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium hover:bg-black/5" style={{ color: 'var(--text-primary)' }}>
                  <Image size={14} /> 参考图
                </button>
              )}

              {onDelete && (
                <button onClick={() => onDelete(image.filename)} className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20">
                  <Trash2 size={14} /> 删除
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {lightbox && (
        <div className="fixed inset-0 bg-black/80 z-[60] flex items-center justify-center p-4" onClick={() => setLightbox(false)}>
          <img src={image.url} alt="" className="max-w-full max-h-full rounded-lg" onClick={(e) => e.stopPropagation()} />
        </div>
      )}
    </>
  )
}
