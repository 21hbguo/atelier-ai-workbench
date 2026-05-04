import { useState, useEffect, useRef, useCallback, useLayoutEffect } from 'react'
import { X, Copy, Download, Trash2, Plus, Image as ImageIcon, Maximize2, Heart, ChevronLeft, ChevronRight, Edit2, Check, Share2, Star, Upload } from 'lucide-react'
import { imageAPI, promptAPI, uploadAPI } from '../api'
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
  onFavorite,
  onUsePrompt,
  onUseImage,
  onDelete,
  onShare,
  onUnshare,
  onExtend,
  onMetadataSaved,
  detailExtra,
  title = '详情',
  hideDownload = false,
  allowMetadataEdit = false,
  allowPromptEdit = false,
  onPromptSave,
  onPromptCreate,
  initialEditing = false,
}) {
  const dialog = useAppDialog()
  const [lightbox, setLightbox] = useState(false)
  const [copied, setCopied] = useState(false)
  const [editing, setEditing] = useState(false)
  const [editForm, setEditForm] = useState(null)
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [contentVisible, setContentVisible] = useState(true)
  const [mediaHovered, setMediaHovered] = useState(false)
  const touchStartX = useRef(0)
  const touchStartY = useRef(0)
  const touchLastX = useRef(0)
  const touchLastY = useRef(0)
  const touchSwiped = useRef(false)
  const modalStatePushed = useRef(false)
  const lightboxStatePushed = useRef(false)
  const lightboxRef = useRef(false)
  const onCloseRef = useRef(onClose)
  const modalToken = useRef(`${Date.now()}_${Math.random().toString(36).slice(2)}`)
  const shouldAutoEdit = useRef(initialEditing)
  const fileInputRef = useRef(null)
  const isTokenState = useCallback((kind) => { const s = window.history.state; return s?.__udm === kind && s?.token === modalToken.current }, [])

  const hasNavigation = cards.length > 1
  const canPrev = hasNavigation && currentIndex > 0
  const canNext = hasNavigation && currentIndex < cards.length - 1
  useEffect(() => { onCloseRef.current = onClose }, [onClose])

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
    if (shouldAutoEdit.current) {
      shouldAutoEdit.current = false
      startPromptEditing()
    } else {
      setEditing(false)
      setEditForm(null)
    }
  }, [card?.id, currentIndex])
  useLayoutEffect(() => {
    if (!modalStatePushed.current) {
      window.history.pushState({ __udm: 'modal', token: modalToken.current }, '')
      modalStatePushed.current = true
    }
    const handlePopState = (e) => {
      const inLightbox = lightboxRef.current
      if (inLightbox) {
        lightboxStatePushed.current = false
        setLightbox(false)
        return
      }
      onCloseRef.current?.()
    }
    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [])
  useLayoutEffect(() => {
    lightboxRef.current = lightbox
    if (lightbox && !lightboxStatePushed.current) {
      window.history.pushState({ __udm: 'lightbox', token: modalToken.current }, '')
      lightboxStatePushed.current = true
    }
    if (!lightbox) lightboxStatePushed.current = false
  }, [lightbox])
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
  const requestCloseModal = () => {
    if (lightbox) { lightboxStatePushed.current = false; setLightbox(false) }
    if (!modalStatePushed.current) { onClose?.(); return }
    if (isTokenState('modal') || isTokenState('lightbox')) window.history.back()
    else { modalStatePushed.current = false; onClose?.() }
  }
  const requestCloseLightbox = () => {
    if (!lightboxStatePushed.current) { setLightbox(false); return }
    if (isTokenState('lightbox')) window.history.back()
    else { lightboxStatePushed.current = false; setLightbox(false) }
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

  const [categories, setCategories] = useState([])
  useEffect(() => {
    if (allowPromptEdit && !isImage) {
      promptAPI.categories().then(({ data }) => setCategories(data.categories || [])).catch(() => {})
    }
  }, [allowPromptEdit, isImage])

  const startPromptEditing = () => {
    setEditForm({
      name: card.name || '',
      prompt: card.prompt || '',
      negative_prompt: card.negativePrompt || '',
      tags: Array.isArray(card.tags) ? card.tags.join(', ') : '',
      category: card.category || '',
      image_path: card.imagePath || '',
    })
    setEditing(true)
  }

  const handleImageUpload = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    try {
      const { data } = await uploadAPI.uploadLocal(file)
      setEditForm(f => ({ ...f, image_path: data.storage_name }))
    } catch (err) {
      dialog.alert('图片上传失败: ' + (err?.message || '未知错误'))
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const handleSavePrompt = async () => {
    if (!editForm || saving) return
    if (!card.id && onPromptCreate && (!editForm.name || !editForm.prompt)) {
      dialog.alert('请填写标题和提示词内容')
      return
    }
    setSaving(true)
    try {
      const payload = {
        name: editForm.name,
        prompt: editForm.prompt,
        negative_prompt: editForm.negative_prompt || '',
        tags: editForm.tags ? editForm.tags.split(',').map(t => t.trim()).filter(Boolean) : [],
        category: editForm.category || null,
        image_path: editForm.image_path || null,
      }
      if (!card.id && onPromptCreate) {
        await onPromptCreate(payload)
      } else {
        await onPromptSave(card.id, payload)
      }
      setEditing(false)
      setEditForm(null)
    } catch (e) {
      dialog.alert('保存失败: ' + (e?.message || '未知错误'))
    } finally {
      setSaving(false)
    }
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
  const actionBaseClass = 'inline-flex h-14 w-full min-w-0 flex-col items-center justify-center gap-1 rounded-[1.15rem] border px-1.5 text-[10px] font-medium leading-none whitespace-nowrap transition-all'
  const actionNeutralStyle = { background: 'var(--bg-primary)', borderColor: 'var(--border-color)', color: 'var(--text-primary)' }
  const actionPrimaryStyle = { background: 'var(--accent)', borderColor: 'var(--accent)', color: '#fff' }
  const actionDangerStyle = { background: 'color-mix(in srgb, var(--color-error) 10%, var(--bg-primary))', borderColor: 'color-mix(in srgb, var(--color-error) 22%, var(--border-color))', color: 'var(--color-error)' }
  const actionWarnStyle = { background: 'color-mix(in srgb, var(--color-warning) 12%, var(--bg-primary))', borderColor: 'color-mix(in srgb, var(--color-warning) 28%, var(--border-color))', color: 'var(--color-warning)' }
  const actionLikedStyle = { background: 'color-mix(in srgb, var(--color-error) 10%, var(--bg-primary))', borderColor: 'color-mix(in srgb, var(--color-error) 24%, var(--border-color))', color: 'var(--color-error)' }
  const actionFavoritedStyle = { background: 'color-mix(in srgb, #facc15 14%, var(--bg-primary))', borderColor: 'color-mix(in srgb, #eab308 26%, var(--border-color))', color: '#a16207' }

  const renderLeftPanel = () => {
    const editImageUrl = editing && editForm?.image_path ? (editForm.image_path.includes('/') ? `/api/prompts/evo-thumb/${editForm.image_path}` : `/api/prompts/image/${editForm.image_path}`) : null
    const displayUrl = editImageUrl || fullUrl
    const showUploadBtn = editing && !isImage
    if (!displayUrl) {
      return (
        <div className={`md:w-3/5 bg-black flex items-center justify-center min-h-[260px] h-[44vh] md:h-full relative transition-opacity duration-150 ${contentVisible ? 'opacity-100' : 'opacity-0'}`} style={{ background: 'color-mix(in srgb, var(--accent) 8%, var(--bg-primary))' }}>
          <ImageIcon size={64} style={{ color: 'var(--accent)', opacity: 0.3 }} />
          {showUploadBtn && (
            <button onClick={() => fileInputRef.current?.click()} disabled={uploading}
              className="absolute bottom-4 right-4 flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium text-white bg-black/60 hover:bg-black/80 transition-colors disabled:opacity-50">
              <Upload size={14} />{uploading ? '上传中...' : '上传图片'}
            </button>
          )}
        </div>
      )
    }
    return (
      <div className={`md:w-3/5 bg-black flex items-center justify-center min-h-[260px] h-[44vh] md:h-full relative group cursor-pointer overflow-hidden transition-opacity duration-150 ${contentVisible ? 'opacity-100' : 'opacity-0'}`} onClick={showUploadBtn ? undefined : handleMediaClick} onMouseEnter={() => setMediaHovered(true)} onMouseLeave={() => setMediaHovered(false)}>
        <img src={displayUrl} alt="" className="max-w-full max-h-full object-contain" />
        {!showUploadBtn && (
          <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center">
            <Maximize2 size={24} className="text-white opacity-0 group-hover:opacity-100 transition-opacity" />
          </div>
        )}
        {showUploadBtn && (
          <button onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click() }} disabled={uploading}
            className="absolute bottom-4 right-4 flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium text-white bg-black/60 hover:bg-black/80 transition-colors disabled:opacity-50 z-10">
            <Upload size={14} />{uploading ? '上传中...' : '更换图片'}
          </button>
        )}
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
              <button onClick={() => handleCopy(card.prompt)} className="absolute right-2 top-2 p-1 rounded hover:bg-bg-hover" style={{ color: 'var(--text-secondary)' }}>
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

  const renderPromptDetail = () => {
    if (editing && editForm) {
      return (
        <div className="space-y-2.5">
          <div>
            <label className="text-xs font-medium mb-1 block leading-none" style={{ color: 'var(--text-secondary)' }}>标题</label>
            <input value={editForm.name || ''} onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))}
              className="w-full px-3 py-2 rounded-lg text-sm border outline-none"
              style={{ background: 'var(--bg-primary)', borderColor: 'var(--border-color)', color: 'var(--text-primary)' }} />
          </div>
          <div>
            <label className="text-xs font-medium mb-1 block leading-none" style={{ color: 'var(--text-secondary)' }}>提示词</label>
            <textarea value={editForm.prompt || ''} onChange={e => setEditForm(f => ({ ...f, prompt: e.target.value }))}
              className="w-full px-3 py-2 rounded-lg text-sm border outline-none resize-none"
              style={{ background: 'var(--bg-primary)', borderColor: 'var(--border-color)', color: 'var(--text-primary)' }}
              rows={4} />
          </div>
          <div>
            <label className="text-xs font-medium mb-1 block leading-none" style={{ color: 'var(--text-secondary)' }}>反向提示词 (可选)</label>
            <textarea value={editForm.negative_prompt || ''} onChange={e => setEditForm(f => ({ ...f, negative_prompt: e.target.value }))}
              className="w-full px-3 py-2 rounded-lg text-sm border outline-none resize-none"
              style={{ background: 'var(--bg-primary)', borderColor: 'var(--border-color)', color: 'var(--text-primary)' }}
              rows={2} />
          </div>
          <div>
            <label className="text-xs font-medium mb-1 block leading-none" style={{ color: 'var(--text-secondary)' }}>标签</label>
            <input value={editForm.tags || ''} onChange={e => setEditForm(f => ({ ...f, tags: e.target.value }))}
              placeholder="逗号分隔"
              className="w-full px-3 py-2 rounded-lg text-sm border outline-none"
              style={{ background: 'var(--bg-primary)', borderColor: 'var(--border-color)', color: 'var(--text-primary)' }} />
          </div>
          <div>
            <label className="text-xs font-medium mb-1 block leading-none" style={{ color: 'var(--text-secondary)' }}>分类</label>
            <select value={editForm.category || ''} onChange={e => setEditForm(f => ({ ...f, category: e.target.value }))}
              className="w-full px-3 py-2 rounded-lg text-sm border outline-none"
              style={{ background: 'var(--bg-primary)', borderColor: 'var(--border-color)', color: 'var(--text-primary)' }}>
              <option value="">无分类</option>
              {categories.map(c => <option key={c.slug} value={c.slug}>{c.label}</option>)}
            </select>
          </div>
        </div>
      )
    }
    return (
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
              <button onClick={() => handleCopy(card.prompt)} className="absolute right-2 top-2 p-1 rounded hover:bg-bg-hover" style={{ color: 'var(--text-secondary)' }}>
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
  }

  const renderActions = () => {
    const actions = []
    if (isImage && fullUrl && !hideDownload) {
      actions.push(
        <a key="dl" href={fullUrl} download className={actionBaseClass} style={actionPrimaryStyle} title="下载">
          <Download size={15} /><span>下载</span>
        </a>
      )
    }
    if (onUsePrompt) {
      actions.push(
        <button key="use-prompt" onClick={() => { onUsePrompt(card.prompt); requestCloseModal() }} className={actionBaseClass} style={actionNeutralStyle} title="使用提示词">
          <Plus size={15} /><span>用提示词</span>
        </button>
      )
    }
    if (fullUrl && onUseImage) {
      actions.push(
        <button key="use-image" onClick={() => { onUseImage(card); requestCloseModal() }} className={actionBaseClass} style={actionNeutralStyle} title="设为参考图">
          <ImageIcon size={15} /><span>参考图</span>
        </button>
      )
    }
    if (onLike) {
      const likeText = card.isLiked ? `${Math.max(1, card.likesCount || 0)}赞` : card.likesCount > 0 ? `${card.likesCount}赞` : '点赞'
      actions.push(
        <button key="like" onClick={() => onLike(card.id)} className={actionBaseClass} style={card.isLiked ? actionLikedStyle : actionNeutralStyle} title={card.isLiked ? '取消点赞' : '点赞'}>
          <Heart size={15} className={card.isLiked ? 'fill-current' : ''} /><span>{likeText}</span>
        </button>
      )
    }
    if (onFavorite) {
      actions.push(
        <button key="favorite" onClick={() => onFavorite(card.id)} className={actionBaseClass} style={card.isFavorited ? actionFavoritedStyle : actionNeutralStyle} title={card.isFavorited ? '取消收藏' : '收藏'}>
          <Star size={15} className={card.isFavorited ? 'fill-current' : ''} /><span>{card.isFavorited ? '已收藏' : '收藏'}</span>
        </button>
      )
    }
    if (onDelete && (isImage ? raw.filename : card.id)) {
      actions.push(
        <button key="delete" onClick={() => onDelete(isImage ? raw.filename : card.id)} className={actionBaseClass} style={actionDangerStyle} title="删除">
          <Trash2 size={15} /><span>删除</span>
        </button>
      )
    }
    if (onShare && isImage && raw.filename) {
      actions.push(
        <button key="share" onClick={() => onShare(card)} className={actionBaseClass} style={actionNeutralStyle} title="分享广场">
          <Share2 size={15} /><span>分享</span>
        </button>
      )
    }
    if (onUnshare) {
      actions.push(
        <button key="unshare" onClick={() => onUnshare(card)} className={actionBaseClass} style={actionWarnStyle} title="撤回分享">
          <Share2 size={15} /><span>撤回</span>
        </button>
      )
    }
    if (onExtend && isImage && raw.filename && !card.is_permanent) {
      actions.push(
        <button key="extend" onClick={() => onExtend(card)} className={actionBaseClass} style={actionNeutralStyle} title="延长3天(-2积分)">
          <Plus size={15} /><span>延3天</span>
        </button>
      )
    }
    return actions
  }

  const actions = renderActions()
  return (
    <>
      <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-3 md:p-4" onClick={requestCloseModal}>
        <div
          className="rounded-2xl overflow-hidden max-w-5xl w-full h-[88vh] md:h-[84vh] flex flex-col md:flex-row relative"
          style={{ background: 'var(--bg-card)', boxShadow: 'var(--shadow-lg)' }}
          onClick={(e) => e.stopPropagation()}
          onTouchStart={hasNavigation ? handleTouchStart : undefined}
          onTouchMove={hasNavigation ? handleTouchMove : undefined}
          onTouchEnd={hasNavigation ? handleTouchEnd : undefined}
        >
          {hasNavigation && canPrev && mediaHovered && (
            <button onClick={handlePrev} className="hidden md:flex absolute left-3 top-1/2 -translate-y-1/2 z-10 p-3 rounded-full bg-black/30 backdrop-blur-sm hover:bg-black/50 hover:scale-110 text-white transition-all items-center justify-center">
              <ChevronLeft size={24} />
            </button>
          )}
          {hasNavigation && canNext && mediaHovered && (
            <button onClick={handleNext} className="hidden md:flex absolute right-3 top-1/2 -translate-y-1/2 z-10 p-3 rounded-full bg-black/30 backdrop-blur-sm hover:bg-black/50 hover:scale-110 text-white transition-all items-center justify-center" style={{ right: 'calc(40% + 12px)' }}>
              <ChevronRight size={24} />
            </button>
          )}

          {renderLeftPanel()}

          <div className={`md:w-2/5 flex-1 md:flex-none p-3.5 md:p-4 flex flex-col gap-2.5 overflow-y-auto transition-opacity duration-150 ${contentVisible ? 'opacity-100' : 'opacity-0'}`} style={{ color: 'var(--text-primary)' }}>
            <div className="flex items-center justify-between mb-0.5">
              <span className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>{title}</span>
              <div className="flex items-center gap-2">
                {allowMetadataEdit && isImage && raw.filename && !detailExtra && (editing ? <button onClick={handleSaveMetadata} disabled={saving} className="p-1 rounded hover:bg-bg-hover" style={{ color: 'var(--accent)' }}><Check size={16} /></button> : <button onClick={startEditing} className="p-1 rounded hover:bg-bg-hover" style={{ color: 'var(--text-secondary)' }}><Edit2 size={16} /></button>)}
                {allowPromptEdit && !isImage && !detailExtra && (editing ? <button onClick={handleSavePrompt} disabled={saving} className="p-1 rounded hover:bg-bg-hover" style={{ color: 'var(--accent)' }}><Check size={16} /></button> : <button onClick={startPromptEditing} className="p-1 rounded hover:bg-bg-hover" style={{ color: 'var(--text-secondary)' }}><Edit2 size={16} /></button>)}
                <button onClick={requestCloseModal} className="p-1 rounded hover:bg-bg-hover"><X size={18} /></button>
              </div>
            </div>

            {detailExtra || (isImage ? renderImageDetail() : renderPromptDetail())}

            <div className="mt-auto pt-2">
              <div className="grid items-stretch gap-1.5 rounded-[1.5rem] border p-1.5" style={{ background: 'color-mix(in srgb, var(--bg-primary) 88%, transparent)', borderColor: 'var(--border-color)', gridTemplateColumns: `repeat(${Math.max(actions.length, 1)},minmax(0,1fr))` }}>
              {actions}
              </div>
            </div>
          </div>
        </div>
      </div>

      {lightbox && fullUrl && (
        <div className="fixed inset-0 bg-black/80 z-[60] flex items-center justify-center p-4" onClick={requestCloseLightbox}>
          <img src={fullUrl} alt="" className="max-w-full max-h-full rounded-lg" onClick={(e) => e.stopPropagation()} />
        </div>
      )}

      <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleImageUpload} />
    </>
  )
}
