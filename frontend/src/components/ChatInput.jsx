import { useState, useEffect, useCallback, useRef, forwardRef, useImperativeHandle } from 'react'
import { Paperclip, X, Settings, Send, Maximize2 } from 'lucide-react'
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

  useEffect(() => {
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

  const handleFiles = useCallback((files) => {
    const valid = Array.from(files).filter(f => /\.(png|jpe?g|webp)$/i.test(f.name) && f.size <= 10 * 1024 * 1024)
    setImages(prev => [...prev, ...valid.map(f => ({ file: f, preview: URL.createObjectURL(f) }))])
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
      <div className="w-full px-4 py-4">
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
          <div className="flex items-end gap-2 p-2">
            <button onClick={() => fileRef.current?.click()} className="p-2 rounded-lg hover:bg-black/5 transition-colors flex-shrink-0 self-end"
              style={{ color: 'var(--text-secondary)' }}>
              <Paperclip size={18} />
            </button>
            <button onClick={() => setShowParams(!showParams)} className="p-2 rounded-lg hover:bg-black/5 transition-colors flex-shrink-0 self-end"
              style={{ color: showParams ? 'var(--accent)' : 'var(--text-secondary)' }}>
              <Settings size={16} />
            </button>
            <label className="flex items-center gap-1.5 cursor-pointer flex-shrink-0 self-end p-2" title="分享到广场">
              <input
                type="checkbox"
                checked={shareToSquare}
                onChange={(e) => setShareToSquare(e.target.checked)}
                className="w-3.5 h-3.5 rounded"
                style={{ accentColor: 'var(--accent)' }}
              />
              <span className="text-xs whitespace-nowrap" style={{ color: 'var(--text-secondary)' }}>分享</span>
            </label>
            <textarea ref={textareaRef} value={prompt} onChange={e => setPrompt(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); handleSend() } }}
              placeholder="输入提示词..."
              className="flex-1 resize-none bg-transparent outline-none text-sm py-2"
              rows={1} style={{ color: 'var(--text-primary)', minHeight: '32px', maxHeight: '120px' }} />
            <div className="flex items-center gap-1.5 flex-shrink-0 self-end pb-0.5">
              {prompt.length > 0 && <span className="text-xs tabular-nums" style={{ color: 'var(--text-secondary)' }}>{prompt.length}</span>}
              <button onClick={handleSend} disabled={!prompt.trim() || loading}
                className="p-2 rounded-lg transition-all duration-150 disabled:opacity-40"
                style={{ background: prompt.trim() && !loading ? 'var(--accent)' : 'var(--border-color)', color: '#fff' }}>
                <Send size={16} />
              </button>
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
