import { useState, useEffect, useCallback, useRef, forwardRef, useImperativeHandle } from 'react'
import { Paperclip, X, Settings, Send, Maximize2, Share2, Loader2 } from 'lucide-react'
import ParamPanel from './ParamPanel'
import { getCachedImages, setCachedImages, getPendingImage, clearPendingImage } from '../utils/imageDB'

const ChatInput = forwardRef(function ChatInput({ onSubmit, loading, requestCost = 10 }, ref) {
  const [prompt, setPrompt] = useState('')
  const [images, setImages] = useState([])
  const [showParams, setShowParams] = useState(false)
  const [params, setParams] = useState({ size: 'auto', model_id: 'image-default', roll_count: 5 })
  const [shareToSquare, setShareToSquare] = useState(true)
  const [lightbox, setLightbox] = useState(null)
  const fileRef = useRef(null)
  const textareaRef = useRef(null)
  const paramsStatePushedRef = useRef(false)
  const paramsStateTokenRef = useRef(`chatinput_params_${Date.now()}_${Math.random().toString(36).slice(2)}`)
  const paramsClosingByPopRef = useRef(false)
  const paramsPanelRef = useRef(null)
  const lightboxPushedRef = useRef(false)
  const lightboxClosingByPopRef = useRef(false)
  const imagesRef = useRef([])
  const pendingImageConsumedRef = useRef(false)
  const persistVersionRef = useRef(0)
  const persistImages = useCallback(async (list) => {
    try {
      const version = ++persistVersionRef.current
      const cached = await Promise.all((list || []).map(async (img, i) => {
        let blob = null
        if (img.file) blob = img.file
        else if (img.url) {
          const res = await fetch(img.url)
          blob = await res.blob()
        }
        return blob ? { blob, name: img.file?.name || img.name || `cached-${i}.png`, type: blob.type || img.file?.type || 'image/png' } : null
      }))
      if (version !== persistVersionRef.current) return
      await setCachedImages(cached.filter(Boolean))
    } catch {}
  }, [])
  const appendImages = useCallback((items) => {
    if (!items?.length) return
    setImages(prev => {
      const remaining = MAX_IMAGES - prev.length
      if (remaining <= 0) {
        alert(`最多只能上传 ${MAX_IMAGES} 张参考图`)
        return prev
      }
      if (items.length > remaining) {
        alert(`最多只能上传 ${MAX_IMAGES} 张参考图，已自动截取前 ${remaining} 张`)
        const next = [...prev, ...items.slice(0, remaining)]
        void persistImages(next)
        return next
      }
      const next = [...prev, ...items]
      void persistImages(next)
      return next
    })
  }, [persistImages])

  const consumePending = useCallback(async () => {
    const pendingPrompt = localStorage.getItem('pending_prompt')
    const pendingImg = localStorage.getItem('pending_image')

    if (pendingPrompt) {
      localStorage.removeItem('pending_prompt')
      setPrompt(pendingPrompt)
    }

    // Legacy blob-based pending image (from IndexedDB)
    if (pendingImg || localStorage.getItem('pending_image_token')) {
      pendingImageConsumedRef.current = true
      try {
        let blob = null
        let name = `ref-${Date.now()}.png`
        let type = 'image/png'
        const pending = await getPendingImage()
        if (pending?.blob) {
          blob = pending.blob
          name = pending.name || name
          type = pending.type || pending.blob.type || type
        } else if (pendingImg) {
          const parsed = JSON.parse(pendingImg)
          if (parsed?.dataUrl) {
            const res = await fetch(parsed.dataUrl)
            blob = await res.blob()
            name = parsed.name || name
            type = blob.type || type
          }
        }
        if (blob) {
          const file = new File([blob], name, { type })
          const next = [{ file, preview: URL.createObjectURL(file), name }]
          setImages(prev => {
            const merged = [...prev, ...next].slice(0, MAX_IMAGES)
            void persistImages(merged)
            return merged
          })
        }
      } catch (e) { console.error('[consumePending] error:', e) }
      localStorage.removeItem('pending_image')
      localStorage.removeItem('pending_image_token')
      await clearPendingImage().catch(() => {})
    }
  }, [persistImages])

  // 从缓存恢复提示词和参考图
  useEffect(() => {
    const cached = localStorage.getItem('cached_prompt')
    if (cached) setPrompt(cached)

    const refImages = JSON.parse(localStorage.getItem('ref_images') || '[]')
    const refUrl = localStorage.getItem('ref_image_url')
    const allRefs = refUrl ? [...refImages, { url: refUrl, name: 'reference.png' }] : refImages
    const unique = allRefs.filter((v, i, a) => a.findIndex(x => x.url === v.url) === i)
    if (unique.length > 0) {
      setImages(unique.map(r => ({ url: r.url, preview: r.url, name: r.name || 'reference.png' })))
    } else {
      ;(async () => {
        try {
          const cachedImages = await getCachedImages()
          console.log('[ChatInput mount] IndexedDB cachedImages count:', cachedImages.length)
          const items = cachedImages.map((item, i) => item?.blob ? { file: new File([item.blob], item.name || `cached-${i}.png`, { type: item.type || item.blob.type || 'image/png' }), preview: URL.createObjectURL(item.blob), name: item.name || `cached-${i}.png` } : null).filter(Boolean)
          if (items.length > 0) setImages(items)
        } catch {}
      })()
    }
  }, [])

  // 组件卸载时释放 object URL
  useEffect(() => {
    return () => {
      for (const img of imagesRef.current) {
        if (img.file && img.preview) URL.revokeObjectURL(img.preview)
      }
    }
  }, [])

  // 提示词变化时同步到 localStorage
  useEffect(() => {
    if (prompt) localStorage.setItem('cached_prompt', prompt)
    else localStorage.removeItem('cached_prompt')
  }, [prompt])

  useEffect(() => { imagesRef.current = images }, [images])

  useEffect(() => {
    consumePending()
    window.addEventListener('pending-prompt-updated', consumePending)
    window.addEventListener('pending-image-updated', consumePending)
    return () => { window.removeEventListener('pending-prompt-updated', consumePending); window.removeEventListener('pending-image-updated', consumePending) }
  }, [consumePending])

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 120) + 'px'
    }
  }, [prompt])
  const openParams = useCallback(() => { setShowParams(true) }, [])
  const closeParams = useCallback(() => {
    if (!showParams) return
    if (paramsStatePushedRef.current && window.history.state?.__chatinput_params === paramsStateTokenRef.current && !paramsClosingByPopRef.current) {
      paramsClosingByPopRef.current = true
      window.history.back()
      return
    }
    setShowParams(false)
  }, [showParams])
  const toggleParams = useCallback(() => { if (showParams) closeParams(); else openParams() }, [showParams, closeParams, openParams])
  useEffect(() => {
    const ta = textareaRef.current
    if (!ta) return
    const resetWindowScroll = () => {
      window.scrollTo(0, 0)
      document.documentElement.scrollTop = 0
      document.body.scrollTop = 0
    }
    const onBlur = () => setTimeout(resetWindowScroll, 0)
    const vv = window.visualViewport
    const onViewportChange = () => {
      if (document.activeElement !== ta) setTimeout(resetWindowScroll, 0)
    }
    ta.addEventListener('blur', onBlur)
    vv?.addEventListener('resize', onViewportChange)
    return () => {
      ta.removeEventListener('blur', onBlur)
      vv?.removeEventListener('resize', onViewportChange)
    }
  }, [])
  useEffect(() => {
    if (!showParams) return
    if (!paramsStatePushedRef.current) {
      window.history.pushState({ __chatinput_params: paramsStateTokenRef.current }, '')
      paramsStatePushedRef.current = true
    }
    const onPopState = () => {
      if (!paramsStatePushedRef.current) return
      paramsStatePushedRef.current = false
      paramsClosingByPopRef.current = true
      setShowParams(false)
      setTimeout(() => { paramsClosingByPopRef.current = false }, 0)
    }
    const onKeyDown = (e) => { if (e.key === 'Escape') closeParams() }
    const onClickOutside = (e) => {
      if (paramsPanelRef.current && !paramsPanelRef.current.contains(e.target)) closeParams()
    }
    window.addEventListener('popstate', onPopState)
    window.addEventListener('keydown', onKeyDown)
    setTimeout(() => document.addEventListener('mousedown', onClickOutside), 0)
    return () => {
      window.removeEventListener('popstate', onPopState)
      window.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('mousedown', onClickOutside)
    }
  }, [showParams, closeParams])

  useEffect(() => {
    if (!lightbox) return
    if (!lightboxPushedRef.current) {
      window.history.pushState({ __chatinput_lightbox: true }, '')
      lightboxPushedRef.current = true
    }
    const onPopState = () => {
      if (!lightboxPushedRef.current) return
      lightboxPushedRef.current = false
      lightboxClosingByPopRef.current = true
      setLightbox(null)
      setTimeout(() => { lightboxClosingByPopRef.current = false }, 0)
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [lightbox])

  const closeLightbox = useCallback(() => {
    if (!lightbox) return
    if (lightboxPushedRef.current && window.history.state?.__chatinput_lightbox && !lightboxClosingByPopRef.current) {
      lightboxClosingByPopRef.current = true
      window.history.back()
      return
    }
    lightboxPushedRef.current = false
    setLightbox(null)
  }, [lightbox])
  const openFilePicker = useCallback(() => {
    const input = fileRef.current
    if (!input) return
    input.value = ''
    if (typeof input.showPicker === 'function') {
      try { input.showPicker(); return } catch {}
    }
    input.click()
  }, [])

  useImperativeHandle(ref, () => ({
    addFiles(files) { handleFiles(files) },
    setPrompt(text) { setPrompt(text) },
    async addImage(url) {
      if (!url) return
      appendImages([{ url, preview: url }])
      const stored = JSON.parse(localStorage.getItem('ref_images') || '[]')
      if (!stored.some(i => i.url === url)) { stored.push({ url, name: 'reference.png' }); localStorage.setItem('ref_images', JSON.stringify(stored)) }
    }
  }))

  const MAX_IMAGES = 5

  const handleFiles = useCallback((files) => {
    const valid = Array.from(files).filter(f => /\.(png|jpe?g|webp)$/i.test(f.name) && f.size <= 10 * 1024 * 1024)
    appendImages(valid.map(f => ({ file: f, preview: URL.createObjectURL(f) })))
  }, [appendImages])

  const handleSend = async (batch = false) => {
    if (!prompt.trim() || loading) return
    const ok = await onSubmit({ prompt: prompt.trim(), images, params, shareToSquare, rollCount: batch ? Math.min(5, Math.max(2, Number(params.roll_count) || 5)) : 1 })
    if (ok === false) return
    setPrompt('')
    setImages([])
    localStorage.removeItem('ref_images')
    localStorage.removeItem('ref_image_url')
    localStorage.removeItem('ref_image_name')
  }
  const batchCount = Math.min(5, Math.max(2, Number(params.roll_count) || 5))

  const removeImage = (idx) => {
    setImages(prev => {
      const next = [...prev]; if (next[idx].file) URL.revokeObjectURL(next[idx].preview); next.splice(idx, 1)
      const refUrls = next.filter(i => i.url && !i.file).map(i => ({ url: i.url, name: i.name }))
      if (refUrls.length > 0) localStorage.setItem('ref_images', JSON.stringify(refUrls)); else localStorage.removeItem('ref_images')
      void persistImages(next); return next
    })
  }

  return (
    <>
      <div className="w-full px-4 pt-2 pb-2">
        <div
          className="rounded-2xl border transition-all duration-300"
          style={{ background: 'var(--bg-ai-bubble)', borderColor: 'var(--border-color)', boxShadow: 'var(--shadow-md)', position: 'relative' }}
        >
          {showParams && <div ref={paramsPanelRef} className="p-3 border-b" style={{ borderColor: 'var(--border-color)' }}><ParamPanel params={params} onChange={setParams} /></div>}
          {images.length > 0 && (
            <div className="flex gap-2 p-3 pb-0 overflow-x-auto">
              {images.map((img, i) => (
                <div key={i} className="relative w-14 h-14 flex-shrink-0 rounded-lg overflow-hidden group cursor-pointer">
                  <img src={img.preview} alt="" className="w-full h-full object-cover" onClick={() => setLightbox(img.preview)} />
                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center" onClick={() => setLightbox(img.preview)}>
                    <Maximize2 size={14} className="opacity-0 group-hover:opacity-100 transition-opacity text-white" />
                  </div>
                  <button onClick={(e) => { e.stopPropagation(); removeImage(i) }} className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-black/60 text-white flex items-center justify-center"><X size={10} /></button>
                </div>
              ))}
            </div>
          )}
          <div className="px-2 pt-2 pb-2">
            <textarea ref={textareaRef} value={prompt} onChange={e => setPrompt(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(false) } }}
              placeholder="把脑洞变成画✨"
              className="block w-full resize-none bg-transparent outline-none py-2"
              rows={1} style={{ color: 'var(--text-primary)', minHeight: '40px', maxHeight: '120px', fontSize: '15px', paddingLeft: '10px' }} />
            <div className="mt-2 flex items-center justify-between gap-3">
              <div className="flex items-center flex-shrink-0 whitespace-nowrap">
                <button type="button" onClick={openFilePicker} title="上传参考图" className="inline-flex items-center gap-1 px-1.5 py-2 rounded-lg hover:bg-bg-hover transition-colors text-xs font-medium" style={{ color: 'var(--text-secondary)' }}><Paperclip size={16} /><span>参考图</span></button>
                <button onClick={toggleParams} title="参数设置" className="inline-flex items-center gap-1 px-1.5 py-2 rounded-lg hover:bg-bg-hover transition-colors text-xs font-medium" style={{ color: showParams ? 'var(--accent)' : 'var(--text-secondary)' }}><Settings size={15} /><span>参数</span></button>
                <button onClick={() => setShareToSquare(!shareToSquare)} className="inline-flex items-center gap-1 px-1.5 py-2 rounded-lg hover:bg-bg-hover transition-colors relative text-xs font-medium" style={{ color: shareToSquare ? 'var(--color-success)' : 'var(--text-secondary)' }} title={shareToSquare ? '已开启分享到广场' : '已关闭分享到广场'}><Share2 size={15} /><span>分享</span><span className="absolute -right-0.5 -top-0.5 w-1.5 h-1.5 rounded-full" style={{ background: shareToSquare ? 'var(--color-success)' : 'var(--border-color)' }} /></button>
              </div>
              <div className="min-w-0 flex items-center justify-end gap-1 flex-1">
                {loading && <span className="inline-flex items-center gap-1 text-[10px] flex-shrink-0" style={{ color: 'var(--accent)' }}><Loader2 size={11} className="animate-spin" /><span>{images.length > 0 ? '上传并提交中' : '提交中'}</span></span>}
                {prompt.length > 0 && <span className="text-[10px] tabular-nums flex-shrink-0" style={{ color: 'var(--text-secondary)' }}>{prompt.length}</span>}
                <button onClick={() => handleSend(true)} disabled={!prompt.trim() || loading} title={`批量生成 ${batchCount} 张`} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-white disabled:opacity-40 flex-shrink-0" style={{ background: prompt.trim() && !loading ? 'var(--accent)' : 'var(--border-color)' }}>{loading ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}<span className="text-xs font-medium leading-none">×{batchCount}</span></button>
                <button onClick={() => handleSend(false)} disabled={!prompt.trim() || loading} title="生成 1 张" className="px-2.5 py-1.5 rounded-lg transition-all duration-150 disabled:opacity-40 flex-shrink-0" style={{ background: prompt.trim() && !loading ? 'var(--accent)' : 'var(--border-color)', color: '#fff' }}>{loading ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}</button>
              </div>
            </div>
          </div>
        </div>
        <div className="px-1 pt-1 text-[11px]" style={{ color: 'var(--text-secondary)' }}>AI生成结果仅供参考，请勿用于违法用途；失败将退还积分。</div>
        <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" multiple className="sr-only"
          onChange={e => handleFiles(e.target.files)} />
      </div>

      {lightbox && (
        <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4" onClick={closeLightbox}>
          <img src={lightbox} alt="" className="max-w-full max-h-full rounded-lg" onClick={e => e.stopPropagation()} />
        </div>
      )}
    </>
  )
})

export default ChatInput
