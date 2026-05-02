import { Heart, Send, Image as ImageIcon } from 'lucide-react'

export default function PromptCard({ prompt: p, onLike, onUse, onUseImage, onClick, isSelected, onSelect, isAdmin }) {
  const thumbUrl = p.image_path ? `/api/prompts/evo-thumb/${p.image_path}?size=400` : null

  return (
    <div
      className={`relative rounded-xl border cursor-pointer hover:shadow-md transition-all overflow-hidden ${isSelected ? 'ring-2 ring-accent/50' : ''}`}
      style={{ background: 'var(--bg-ai-bubble)', borderColor: 'var(--border-color)', height: '192px' }}
      onClick={(e) => {
        if (e.target.type === 'checkbox' || e.target.closest('button')) return
        onClick?.(p)
      }}
    >
      <div className="flex h-full">
        {thumbUrl ? (
          <div className="w-2/5 h-full flex-shrink-0 relative">
            <img src={thumbUrl} alt="" className="w-full h-full object-cover" loading="lazy" />
            <div className="absolute inset-0 bg-gradient-to-r from-transparent" style={{ background: 'linear-gradient(to right, transparent 80%, var(--bg-ai-bubble))' }} />
          </div>
        ) : (
          <div className="w-2/5 h-full flex-shrink-0 flex items-center justify-center" style={{ background: 'linear-gradient(135deg, var(--accent)08, var(--accent)15)' }}>
            <ImageIcon size={32} style={{ color: 'var(--accent)', opacity: 0.3 }} />
          </div>
        )}

        <div className="flex-1 p-3 flex flex-col min-w-0">
          <h3 className="font-medium text-sm mb-1 truncate" style={{ color: 'var(--text-primary)' }}>{p.name}</h3>
          <p className="text-xs flex-1 overflow-hidden line-clamp-4" style={{ color: 'var(--text-secondary)' }}>{p.prompt}</p>
          <div className="flex items-center gap-2 mt-2">
            {p.author && <span className="text-xs" style={{ color: 'var(--accent)' }}>{p.author}</span>}
            {p.category && <span className="text-xs px-1.5 py-0.5 rounded" style={{ background: 'var(--accent)15', color: 'var(--accent)' }}>{p.category_label || p.category}</span>}
          </div>
        </div>
      </div>

      <div className="absolute bottom-0 left-0 right-0 px-3 py-2 flex items-center gap-1 opacity-0 hover:opacity-100 transition-opacity" style={{ background: 'linear-gradient(transparent, var(--bg-ai-bubble))' }}>
        {isAdmin && (
          <input
            type="checkbox"
            checked={isSelected}
            onChange={() => onSelect?.(p.id)}
            className="mr-1"
            onClick={e => e.stopPropagation()}
          />
        )}
        <button onClick={(e) => { e.stopPropagation(); onLike?.(p.id) }}
          className={`flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium ${p.is_liked ? 'bg-red-50 dark:bg-red-900/20' : 'hover:bg-black/5'}`}
          style={{ color: p.is_liked ? '#ef4444' : 'var(--text-secondary)' }}>
          <Heart size={12} className={p.is_liked ? 'fill-current' : ''} />{p.likes_count || 0}
        </button>
        <button onClick={(e) => { e.stopPropagation(); onUse?.(p) }}
          className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium text-white ml-auto"
          style={{ background: 'var(--accent)' }}>
          <Send size={12} /> 使用
        </button>
        {thumbUrl && (
          <button onClick={(e) => { e.stopPropagation(); onUseImage?.(p) }}
            className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium hover:bg-black/5"
            style={{ color: 'var(--text-secondary)' }}>
            <ImageIcon size={12} /> 参考
          </button>
        )}
      </div>
    </div>
  )
}
