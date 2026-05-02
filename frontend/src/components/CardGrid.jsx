import { Heart, User, Plus, Image as ImageIcon, RefreshCw, Loader2 } from 'lucide-react'

export default function CardGrid({
  cards, onCardClick, onLike, onUsePrompt, onUseImage,
  showAuthor = false, selectable = false, selected = new Set(), onToggleSelect,
  loading = false, refreshing = false, onRefresh,
  total = 0, page = 1, totalPages = 1, onPageChange,
  emptyText = '暂无作品',
}) {
  if (loading && cards.length === 0) {
    return (
      <div className="flex justify-center py-20">
        <Loader2 size={24} className="animate-spin" style={{ color: 'var(--accent)' }} />
      </div>
    )
  }

  if (!loading && cards.length === 0) {
    return <div className="text-center py-20" style={{ color: 'var(--text-secondary)' }}>{emptyText}</div>
  }

  return (
    <>
      <div className="flex items-center justify-between mb-3">
        {total > 0 && <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>{total} 张</span>}
        {onRefresh && (
          <button onClick={onRefresh} disabled={refreshing}
            className="p-1.5 rounded-lg hover:bg-black/5 transition-colors disabled:opacity-50"
            style={{ color: 'var(--text-secondary)' }}>
            <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
          </button>
        )}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
        {cards.map((card, idx) => (
          <div
            key={card.id}
            className={`group relative rounded-xl overflow-hidden shadow-sm hover:shadow-md transition-shadow cursor-pointer ${selectable && selected.has(card.id) ? 'ring-2 ring-accent/50' : ''}`}
            onClick={(e) => {
              if (e.target.type === 'checkbox' || e.target.closest('button')) return
              onCardClick?.(card, idx)
            }}
          >
            {card.thumbUrl ? (
              <img src={card.thumbUrl} alt="" className="w-full aspect-square object-cover" loading="lazy" />
            ) : (
              <div className="w-full aspect-square flex items-center justify-center" style={{ background: 'linear-gradient(135deg, var(--accent)08, var(--accent)15)' }}>
                <ImageIcon size={40} style={{ color: 'var(--accent)', opacity: 0.3 }} />
              </div>
            )}

            <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors hidden md:flex items-center justify-center gap-1.5">
              {Boolean(card.prompt) && (
                <button
                  onClick={(e) => { e.stopPropagation(); onUsePrompt?.(card.prompt) }}
                  className="opacity-0 group-hover:opacity-100 transition-opacity px-2.5 py-1.5 rounded-lg text-xs font-medium bg-white/90 text-gray-800 hover:bg-white flex items-center gap-1"
                >
                  <Plus size={12} /> 提示词
                </button>
              )}
              {Boolean(card.fullUrl) && (
                <button
                  onClick={(e) => { e.stopPropagation(); onUseImage?.(card) }}
                  className="opacity-0 group-hover:opacity-100 transition-opacity px-2.5 py-1.5 rounded-lg text-xs font-medium bg-white/90 text-gray-800 hover:bg-white flex items-center gap-1"
                >
                  <ImageIcon size={12} /> 参考图
                </button>
              )}
            </div>

            <div className="absolute bottom-0 left-0 right-0 px-2 py-1.5 bg-gradient-to-t from-black/70 to-transparent">
              <p className="text-white text-xs truncate">{card.subtitle || '无提示词'}</p>
            </div>

            <div onClick={(e) => { e.stopPropagation(); onLike?.(card.id) }} className="absolute top-2 right-2 flex items-center gap-1 px-2 py-1 rounded-full bg-black/50 backdrop-blur-sm cursor-pointer hover:bg-black/70 transition-colors">
              <Heart size={12} className={card.isLiked ? 'fill-red-500 text-red-500' : 'text-white'} />
              {(card.likesCount > 0 || card.isLiked) && <span className="text-white text-xs">{card.likesCount}</span>}
            </div>

            {showAuthor && Boolean(card.author) && (
              <div className="absolute top-2 left-2 flex items-center gap-1 px-2 py-1 rounded-full bg-black/50 backdrop-blur-sm">
                <User size={12} className="text-white" />
                <span className="text-white text-xs truncate max-w-[80px]">{card.author}</span>
              </div>
            )}

            {selectable && (
              <div className="absolute top-2 left-2" style={showAuthor && card.author ? { top: '2.5rem' } : undefined}>
                <input
                  type="checkbox"
                  checked={selected.has(card.id)}
                  onChange={() => onToggleSelect?.(card.id)}
                  className="w-4 h-4 rounded"
                  onClick={e => e.stopPropagation()}
                />
              </div>
            )}
          </div>
        ))}
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 mt-4">
          <button onClick={() => onPageChange?.(page - 1)} disabled={page === 1}
            className="px-3 py-1 rounded-lg text-xs font-medium disabled:opacity-40"
            style={{ color: 'var(--text-secondary)', background: 'var(--bg-secondary)' }}>上一页</button>
          <span className="text-xs tabular-nums" style={{ color: 'var(--text-secondary)' }}>{page}/{totalPages}</span>
          <button onClick={() => onPageChange?.(page + 1)} disabled={page === totalPages}
            className="px-3 py-1 rounded-lg text-xs font-medium disabled:opacity-40"
            style={{ color: 'var(--text-secondary)', background: 'var(--bg-secondary)' }}>下一页</button>
        </div>
      )}
    </>
  )
}
