import { useState, useCallback, useRef } from 'react'
import { Paperclip, X, Settings, Send } from 'lucide-react'
import ParamPanel from './ParamPanel'

export default function ChatInput({ onSubmit, loading }) {
  const [mode, setMode] = useState('text')
  const [prompt, setPrompt] = useState('')
  const [images, setImages] = useState([])
  const [showParams, setShowParams] = useState(false)
  const [params, setParams] = useState({ size: 'auto' })
  const fileRef = useRef(null)
  const [dragging, setDragging] = useState(false)

  const handleFiles = useCallback((files) => {
    const valid = Array.from(files).filter(f => /\.(png|jpe?g|webp)$/i.test(f.name) && f.size <= 10 * 1024 * 1024)
    setImages(prev => [...prev, ...valid.map(f => ({ file: f, preview: URL.createObjectURL(f) }))])
  }, [])

  const handleSend = () => {
    if (!prompt.trim() || loading) return
    onSubmit({ prompt: prompt.trim(), mode, images, params })
    setPrompt('')
    setImages([])
  }

  const removeImage = (idx) => {
    setImages(prev => { const next = [...prev]; URL.revokeObjectURL(next[idx].preview); next.splice(idx, 1); return next })
  }

  return (
    <div className="w-full px-4 py-4" style={{ maxWidth: '768px', margin: '0 auto' }}>
      <div
        className={`rounded-xl border-2 transition-all duration-150 ${dragging ? 'border-accent/50 bg-accent/5' : ''}`}
        style={{ background: 'var(--bg-ai-bubble)', borderColor: 'var(--border-color)', boxShadow: 'var(--shadow-md)', position: 'relative' }}
        onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => { e.preventDefault(); setDragging(false); if (mode === 'text-image') handleFiles(e.dataTransfer.files) }}
      >
        {dragging && (
          <div className="absolute inset-0 flex items-center justify-center bg-accent/10 rounded-xl z-10">
            <p className="text-lg font-medium" style={{ color: 'var(--accent)' }}>松开鼠标上传图片</p>
          </div>
        )}
        <div className="flex gap-1 p-2 border-b" style={{ borderColor: 'var(--border-color)' }}>
          {['text', 'text-image'].map(m => (
            <button key={m} onClick={() => { if (mode !== m) { setMode(m); if (m === 'text') setImages([]) } }}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${mode === m ? 'bg-accent/10' : 'hover:bg-black/5'}`}
              style={{ color: mode === m ? 'var(--accent)' : 'var(--text-secondary)' }}>
              {m === 'text' ? '纯文本' : '文本+图像'}
            </button>
          ))}
          <button onClick={() => setShowParams(!showParams)} className="ml-auto p-1.5 rounded-lg hover:bg-black/5 transition-colors"
            style={{ color: 'var(--text-secondary)' }}>
            <Settings size={16} />
          </button>
        </div>
        {showParams && <div className="p-3 border-b" style={{ borderColor: 'var(--border-color)' }}><ParamPanel params={params} onChange={setParams} /></div>}
        {images.length > 0 && (
          <div className="flex gap-2 p-3 overflow-x-auto">
            {images.map((img, i) => (
              <div key={i} className="relative w-16 h-16 flex-shrink-0 rounded-lg overflow-hidden">
                <img src={img.preview} alt="" className="w-full h-full object-cover" />
                <button onClick={() => removeImage(i)} className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-black/60 text-white flex items-center justify-center"><X size={10} /></button>
              </div>
            ))}
          </div>
        )}
        <div className="flex items-end gap-2 p-3">
          {mode === 'text-image' && (
            <button onClick={() => fileRef.current?.click()} className="p-2 rounded-lg hover:bg-black/5 transition-colors flex-shrink-0"
              style={{ color: 'var(--text-secondary)' }}>
              <Paperclip size={18} />
            </button>
          )}
          <textarea value={prompt} onChange={e => setPrompt(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() } }}
            placeholder={mode === 'text' ? '输入提示词...' : '输入提示词，可上传参考图...'}
            className="flex-1 resize-none bg-transparent outline-none text-sm"
            rows={1} style={{ color: 'var(--text-primary)', minHeight: '24px', maxHeight: '120px' }}
            onInput={e => { e.target.style.height = 'auto'; e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px' }} />
          <div className="flex flex-col items-end gap-1">
            <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>{prompt.length} 字符</span>
            <button onClick={handleSend} disabled={!prompt.trim() || loading}
              className="p-2 rounded-lg transition-all duration-150 disabled:opacity-40"
              style={{ background: prompt.trim() && !loading ? 'var(--accent)' : 'var(--border-color)', color: '#fff' }}>
              <Send size={18} />
            </button>
          </div>
        </div>
      </div>
      <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" multiple className="hidden"
        onChange={e => handleFiles(e.target.files)} />
    </div>
  )
}
