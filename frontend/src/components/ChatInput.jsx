import { useState, useEffect, useCallback, useRef, forwardRef, useImperativeHandle } from 'react'
import { Paperclip, X, Settings, Send, Maximize2, Share2 } from 'lucide-react'
import ParamPanel from './ParamPanel'

const ChatInput = forwardRef(function ChatInput({ onSubmit, loading }, ref) {
  const [prompt, setPrompt] = useState('')
  const [images, setImages] = useState([])
  const [showParams, setShowParams] = useState(false)
  const [params, setParams] = useState({ size: 'auto' })
  const [shareToSquare, setShareToSquare] = useState(true)
  const [lightbox, setLightbox] = useState(null)
  const fileRef = useRef(null)
  const textareaRef = useRef(null)

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

  const handleSend = () => {
    if (!prompt.trim() || loading) return
    onSubmit({ prompt: prompt.trim(), images, params, shareToSquare })
    setPrompt('')
    setImages([])
  }

  const removeImage = (idx) => {
    setImages(prev => { const next = [...prev]; if (next[idx].file) URL.revokeObjectURL(next[idx].preview); next.splice(idx, 1); return next })
  }

  return (
    <>
      <div className="w-full px-4 pt-4 pb-2">
        <div
          className="rounded-xl border-2 transition-all duration-150"
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
          <div className="flex gap-2 p-2">
            <div className="flex flex-col gap-1 flex-shrink-0">
              <button onClick={() => fileRef.current?.click()} className="p-2 rounded-lg hover:bg-black/5 transition-colors"
                style={{ color: 'var(--text-secondary)' }}>
                <Paperclip size={18} />
              </button>
              <button onClick={() => setShowParams(!showParams)} className="p-2 rounded-lg hover:bg-black/5 transition-colors"
                style={{ color: showParams ? 'var(--accent)' : 'var(--text-secondary)' }}>
                <Settings size={16} />
              </button>
              {/* <button onClick={() => setShareToSquare(!shareToSquare)} className="p-2 rounded-lg hover:bg-black/5 transition-colors"
                style={{ color: shareToSquare ? '#22c55e' : 'var(--text-secondary)' }}>
                <Share2 size={16} />
              </button> */}
            </div>
            <div className="flex-1 relative">
              <textarea ref={textareaRef} value={prompt} onChange={e => setPrompt(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() } }}
                placeholder="输入提示词..."
                className="w-full resize-none bg-transparent outline-none text-sm py-2 pr-12"
                rows={1} style={{ color: 'var(--text-primary)', minHeight: '40px', maxHeight: '120px' }} />
              <div className="absolute right-2 bottom-2 flex items-center gap-1.5">
                {prompt.length > 0 && <span className="text-xs tabular-nums" style={{ color: 'var(--text-secondary)' }}>{prompt.length}</span>}
                <button onClick={handleSend} disabled={!prompt.trim() || loading}
                  className="p-1.5 rounded-lg transition-all duration-150 disabled:opacity-40"
                  style={{ background: prompt.trim() && !loading ? 'var(--accent)' : 'var(--border-color)', color: '#fff' }}>
                  <Send size={14} />
                </button>
              </div>
            </div>
          </div>
        </div>
        <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" multiple className="hidden"
          onChange={e => handleFiles(e.target.files)} />
      </div>

      {lightbox && (
        <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4" onClick={() => setLightbox(null)}>
          <img src={lightbox} alt="" className="max-w-full max-h-full rounded-lg" onClick={e => e.stopPropagation()} />
        </div>
      )}
    </>
  )
})

export default ChatInput
