import { useState, useEffect, useCallback, useRef, forwardRef, useImperativeHandle } from 'react'
import { Paperclip, X, Settings, Send, Maximize2, Share2 } from 'lucide-react'
import ParamPanel from './ParamPanel'

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
  const lightboxPushedRef = useRef(false)
  const lightboxClosingByPopRef = useRef(false)

  const consumePending = useCallback(() => {
    const pending = localStorage.getItem('pending_prompt')
    if (pending) {
      setPrompt(pending)
      localStorage.removeItem('pending_prompt')
    }
    const pendingImg = localStorage.getItem('pending_image')
    if (pendingImg) {
      try {
        const { dataUrl, name } = JSON.parse(pendingImg)
        fetch(dataUrl).then(r => r.blob()).then(blob => {
          const file = new File([blob], name || `ref-${Date.now()}.png`, { type: blob.type })
          setImages(prev => [...prev, { file, preview: URL.createObjectURL(file) }])
        })
      } catch {}
      localStorage.removeItem('pending_image')
    }
  }, [])

  useEffect(() => {
    consumePending()
    window.addEventListener('pending-prompt-updated', consumePending)
    return () => window.removeEventListener('pending-prompt-updated', consumePending)
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
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [showParams])

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

  useImperativeHandle(ref, () => ({
    addFiles(files) { handleFiles(files) },
    setPrompt(text) { setPrompt(text) },
    async addImage(url) {
      try {
        const res = await fetch(url)
        const blob = await res.blob()
        const ext = blob.type.split('/')[1] || 'png'
        const file = new File([blob], `ref-${Date.now()}.${ext}`, { type: blob.type })
        setImages(prev => [...prev, { file, preview: URL.createObjectURL(file) }])
      } catch {
        setImages(prev => [...prev, { url, preview: url }])
      }
    }
  }))

  const MAX_IMAGES = 5

  const handleFiles = useCallback((files) => {
    const valid = Array.from(files).filter(f => /\.(png|jpe?g|webp)$/i.test(f.name) && f.size <= 10 * 1024 * 1024)
    setImages(prev => {
      const remaining = MAX_IMAGES - prev.length
      if (remaining <= 0) {
        alert(`最多只能上传 ${MAX_IMAGES} 张参考图`)
        return prev
      }
      if (valid.length > remaining) {
        alert(`最多只能上传 ${MAX_IMAGES} 张参考图，已自动截取前 ${remaining} 张`)
        return [...prev, ...valid.slice(0, remaining).map(f => ({ file: f, preview: URL.createObjectURL(f) }))]
      }
      return [...prev, ...valid.map(f => ({ file: f, preview: URL.createObjectURL(f) }))]
    })
  }, [])

  const handleSend = async (batch = false) => {
    if (!prompt.trim() || loading) return
    const ok = await onSubmit({ prompt: prompt.trim(), images, params, shareToSquare, rollCount: batch ? Math.min(5, Math.max(2, Number(params.roll_count) || 5)) : 1 })
    if (ok === false) return
    setPrompt('')
    setImages([])
  }
  const batchCount = Math.min(5, Math.max(2, Number(params.roll_count) || 5))

  const removeImage = (idx) => {
    setImages(prev => { const next = [...prev]; if (next[idx].file) URL.revokeObjectURL(next[idx].preview); next.splice(idx, 1); return next })
  }

  return (
    <>
      <div className="w-full px-4 pt-2 pb-2">
        <div
          className="rounded-2xl border transition-all duration-300"
          style={{ background: 'var(--bg-ai-bubble)', borderColor: 'var(--border-color)', boxShadow: 'var(--shadow-md)', position: 'relative' }}
        >
          {showParams && <div className="p-3 border-b" style={{ borderColor: 'var(--border-color)' }}><ParamPanel params={params} onChange={setParams} /></div>}
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
              placeholder="输入提示词..."
              className="block w-full resize-none bg-transparent outline-none text-sm py-2"
              rows={1} style={{ color: 'var(--text-primary)', minHeight: '40px', maxHeight: '120px' }} />
            <div className="mt-2 flex items-center justify-between gap-3">
              <div className="flex items-center gap-0.5 flex-shrink-0 whitespace-nowrap">
                <button onClick={() => fileRef.current?.click()} className="inline-flex items-center gap-1 px-1.5 py-1.5 rounded-md hover:bg-bg-hover transition-colors text-[11px] font-medium" style={{ color: 'var(--text-secondary)' }}><Paperclip size={14} /><span>参考图</span></button>
                <button onClick={toggleParams} className="inline-flex items-center gap-1 px-1.5 py-1.5 rounded-md hover:bg-bg-hover transition-colors text-[11px] font-medium" style={{ color: showParams ? 'var(--accent)' : 'var(--text-secondary)' }}><Settings size={13} /><span>参数</span></button>
                <button onClick={() => setShareToSquare(!shareToSquare)} className="inline-flex items-center gap-1 px-1.5 py-1.5 rounded-md hover:bg-bg-hover transition-colors relative text-[11px] font-medium" style={{ color: shareToSquare ? 'var(--color-success)' : 'var(--text-secondary)' }} title={shareToSquare ? '已开启分享到广场' : '已关闭分享到广场'}><Share2 size={13} /><span>分享</span><span className="absolute -right-0.5 -top-0.5 w-1.5 h-1.5 rounded-full" style={{ background: shareToSquare ? 'var(--color-success)' : 'var(--border-color)' }} /></button>
              </div>
              <div className="min-w-0 flex items-center justify-end gap-1 flex-1">
                {prompt.length > 0 && <span className="text-[10px] tabular-nums flex-shrink-0" style={{ color: 'var(--text-secondary)' }}>{prompt.length}</span>}
                <button onClick={() => handleSend(true)} disabled={!prompt.trim() || loading} className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-white disabled:opacity-40 flex-shrink-0" style={{ background: prompt.trim() && !loading ? 'var(--accent)' : 'var(--border-color)' }}><Send size={13} /><span className="text-[10px] font-medium leading-none">×{batchCount}</span></button>
                <button onClick={() => handleSend(false)} disabled={!prompt.trim() || loading} className="p-1 rounded-md transition-all duration-150 disabled:opacity-40 flex-shrink-0" style={{ background: prompt.trim() && !loading ? 'var(--accent)' : 'var(--border-color)', color: '#fff' }}><Send size={13} /></button>
              </div>
            </div>
          </div>
        </div>
        <div className="px-1 pt-1 text-[11px]" style={{ color: 'var(--text-secondary)' }}>AI生成结果仅供参考，请勿用于违法用途；失败将退还积分。</div>
        <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" multiple className="hidden"
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
