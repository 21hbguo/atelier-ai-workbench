import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { X, Heart, Send, Copy, Image as ImageIcon, Check } from 'lucide-react'

export default function PromptDetailModal({ prompt: p, onClose, onLike }) {
  const navigate = useNavigate()
  const [copied, setCopied] = useState(false)

  if (!p) return null

  const thumbUrl = p.image_path ? `/api/prompts/evo-thumb/${p.image_path}?size=800` : null

  const handleCopy = () => {
    navigator.clipboard.writeText(p.prompt)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  const handleUse = () => {
    localStorage.setItem('pending_prompt', p.prompt)
    navigate('/')
  }

  const handleUseImage = async () => {
    if (!thumbUrl) return
    try {
      const resp = await fetch(thumbUrl)
      const blob = await resp.blob()
      const reader = new FileReader()
      reader.onload = () => {
        localStorage.setItem('pending_image', JSON.stringify({
          dataUrl: reader.result,
          name: p.name + '.jpg',
        }))
        navigate('/')
      }
      reader.readAsDataURL(blob)
    } catch {}
  }

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white dark:bg-gray-900 rounded-2xl overflow-hidden max-w-3xl w-full max-h-[85vh] flex flex-col shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b" style={{ borderColor: 'var(--border-color)' }}>
          <h2 className="font-semibold text-lg" style={{ color: 'var(--text-primary)' }}>{p.name}</h2>
          <button onClick={onClose} className="p-1 rounded hover:bg-black/5"><X size={18} style={{ color: 'var(--text-secondary)' }} /></button>
        </div>

        <div className="flex-1 overflow-y-auto flex">
          {thumbUrl ? (
            <div className="w-1/2 flex-shrink-0 p-4 flex items-center justify-center" style={{ background: 'var(--bg-primary)' }}>
              <img src={thumbUrl} alt={p.name} className="max-w-full max-h-full object-contain rounded-lg cursor-pointer"
                onClick={() => window.open(thumbUrl, '_blank')} />
            </div>
          ) : (
            <div className="w-1/2 flex-shrink-0 flex items-center justify-center" style={{ background: 'linear-gradient(135deg, var(--accent)08, var(--accent)15)' }}>
              <ImageIcon size={48} style={{ color: 'var(--accent)', opacity: 0.2 }} />
            </div>
          )}

          <div className="w-1/2 p-5 flex flex-col gap-4">
            <div>
              <label className="text-xs font-medium mb-1.5 block" style={{ color: 'var(--text-secondary)' }}>提示词</label>
              <p className="text-sm whitespace-pre-wrap max-h-48 md:max-h-72 overflow-y-auto break-words p-3 rounded-lg" style={{ background: 'var(--bg-primary)', color: 'var(--text-primary)' }}>{p.prompt}</p>
            </div>

            <div className="flex items-center gap-3 flex-wrap">
              {p.author && <span className="text-sm" style={{ color: 'var(--accent)' }}>{p.author}</span>}
              {p.category && <span className="text-xs px-2 py-1 rounded" style={{ background: 'var(--accent)15', color: 'var(--accent)' }}>{p.category_label || p.category}</span>}
            </div>

            {p.tags?.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {p.tags.map((t, i) => <span key={i} className="px-2 py-0.5 rounded text-xs" style={{ background: 'var(--accent)15', color: 'var(--accent)' }}>{t}</span>)}
              </div>
            )}

            <div className="mt-auto flex gap-2 flex-wrap">
              <button onClick={handleUse}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium text-white"
                style={{ background: 'var(--accent)' }}>
                <Send size={14} /> 使用提示词
              </button>
              <button onClick={handleCopy}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium hover:bg-black/5"
                style={{ color: 'var(--text-primary)' }}>
                {copied ? <Check size={14} className="text-green-500" /> : <Copy size={14} />}
                {copied ? '已复制' : '复制'}
              </button>
              {thumbUrl && (
                <button onClick={handleUseImage}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium hover:bg-black/5"
                  style={{ color: 'var(--text-primary)' }}>
                  <ImageIcon size={14} /> 添加参考图
                </button>
              )}
              <button onClick={() => onLike?.(p.id)}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-colors"
                style={{
                  background: p.is_liked ? '#ef444415' : 'var(--bg-primary)',
                  color: p.is_liked ? '#ef4444' : 'var(--text-primary)',
                }}>
                <Heart size={14} className={p.is_liked ? 'fill-current' : ''} />
                {p.is_liked ? '已点赞' : '点赞'} ({p.likes_count || 0})
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
