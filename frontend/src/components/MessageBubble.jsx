import { useState } from 'react'
import { ChevronDown, ChevronUp, Download, Repeat, BookmarkPlus, Maximize2 } from 'lucide-react'

export default function MessageBubble({ message, onReusePrompt, onSavePrompt, onRegenerate, onUseParam }) {
  const [expanded, setExpanded] = useState(false)
  const [lightbox, setLightbox] = useState(null)

  const isUser = message.role === 'user'
  const timestamp = message.timestamp ? (() => { const s = String(message.timestamp || ''); const withTz = s.includes('T') ? (s.includes('+') || s.includes('Z') ? s : s + '+08:00') : s.replace(' ', 'T') + '+08:00'; return new Date(withTz).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) })() : ''

  return (
    <>
      <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} mb-4 animate-fade-in-up`}>
        <div className="max-w-[85%] sm:max-w-[70%] rounded-2xl px-4 py-3"
          style={{ background: isUser ? 'var(--bg-user-bubble)' : 'var(--bg-ai-bubble)', boxShadow: isUser ? 'none' : 'var(--shadow-md)' }}>
          {message.images && message.images.length > 0 && (
            <div className="grid gap-2 mb-2" style={{ gridTemplateColumns: message.images.length > 1 ? 'repeat(2, 1fr)' : '1fr' }}>
              {message.images.map((src, i) => (
                <div key={i} className="relative rounded-lg overflow-hidden cursor-pointer group" onClick={() => setLightbox(src)}>
                  <img src={src} alt="" className="w-full h-auto" />
                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center">
                    <Maximize2 size={20} className="opacity-0 group-hover:opacity-100 transition-opacity text-white" />
                  </div>
                </div>
              ))}
            </div>
          )}
          {message.prompt && <div className="text-sm whitespace-pre-wrap" style={{ color: 'var(--text-primary)' }}>{message.prompt}</div>}
          {message.statusText && (
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm" style={{ color: 'var(--text-secondary)' }}>
                <div className="w-4 h-4 border-2 rounded-full animate-spin-slow" style={{ borderTopColor: 'var(--accent)', borderColor: 'var(--border-color)' }} />
                {message.statusText}
              </div>
              {message.progress != null && (
                <div className="w-full rounded-full h-1.5 overflow-hidden" style={{ background: 'var(--border-color)' }}>
                  <div className="h-full rounded-full transition-all duration-500" style={{ width: `${message.progress}%`, background: 'var(--accent)' }} />
                </div>
              )}
            </div>
          )}
          {message.error && <div className="text-sm text-[var(--color-error)]">{message.error}</div>}
          {message.resultImages && message.resultImages.length > 0 && (
            <div className="mt-2">
              <div className="grid gap-2" style={{ gridTemplateColumns: message.resultImages.length > 1 ? 'repeat(2, 1fr)' : '1fr' }}>
                {message.resultImages.map((src, i) => (
                  <div key={i} className="rounded-lg overflow-hidden cursor-pointer group" onClick={() => setLightbox(src)}>
                    <img src={src} alt="" className="w-full h-auto" />
                  </div>
                ))}
              </div>
              {!isUser && message.resultImages.length > 0 && (
                <div className="flex flex-wrap gap-2 mt-3 pt-3" style={{ borderTop: '1px solid var(--border-color)' }}>
                  <button onClick={onRegenerate} className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium hover:bg-bg-hover transition-colors"
                    style={{ color: 'var(--text-secondary)' }}><Repeat size={14} /> 重新生成</button>
                  <button onClick={onSavePrompt} className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium hover:bg-bg-hover transition-colors"
                    style={{ color: 'var(--text-secondary)' }}><BookmarkPlus size={14} /> 保存提示词</button>
                  {message.resultImages.map((src, i) => (
                    <a key={i} href={src} download className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium hover:bg-bg-hover transition-colors"
                      style={{ color: 'var(--text-secondary)' }}><Download size={14} /> 下载 {i + 1}</a>
                  ))}
                </div>
              )}
            </div>
          )}
          {message.params && (
            <button onClick={() => setExpanded(!expanded)} className="flex items-center gap-1 mt-2 text-xs" style={{ color: 'var(--text-secondary)' }}>
              {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />} 生成参数
            </button>
          )}
          {expanded && message.params && (
            <div className="mt-1 text-xs space-y-0.5 p-2 rounded-lg" style={{ background: 'var(--bg-primary)', color: 'var(--text-secondary)' }}>
              {Object.entries(message.params).map(([k, v]) => v != null && <div key={k}><span className="font-medium">{k}:</span> {String(v)}</div>)}
            </div>
          )}
          {timestamp && <div className="text-xs mt-1.5 text-right" style={{ color: 'var(--text-secondary)' }}>{timestamp}</div>}
        </div>
      </div>
      {lightbox && (
        <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4" onClick={() => setLightbox(null)}>
          <img src={lightbox} alt="" className="max-w-full max-h-full rounded-lg" onClick={e => e.stopPropagation()} />
        </div>
      )}
    </>
  )
}
