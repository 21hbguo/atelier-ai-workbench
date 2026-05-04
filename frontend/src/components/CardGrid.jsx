import { useState, useEffect, useRef } from 'react'
import { Heart, User, Plus, Image as ImageIcon, RefreshCw, Loader2, Check, Star } from 'lucide-react'
import Pagination from './Pagination'
import UnifiedCard from './UnifiedCard'

export default function CardGrid({
  cards, onCardClick, onLike, onFavorite, onUsePrompt, onUseImage,
  showAuthor = false, selectable = false, selected = new Set(), onToggleSelect,
  loading = false, paging = false, refreshing = false, onRefresh, hideRefresh = false,
  total = 0, page = 1, totalPages = 1, onPageChange,
  showTotal = true, totalUnit = '张',
  emptyText = '暂无作品',
  showLike = true,
  renderOverlay,
  paginationScrollTargetId,
  scrollAfterPaging = false,
}) {
  const [failedUrls, setFailedUrls] = useState(new Set())
  const [gridMinHeight, setGridMinHeight] = useState(0)
  const gridRef = useRef(null)
  const prevPagingRef = useRef(false)
  const scrollParentToTop = () => {
    if (paginationScrollTargetId) {
      const t = document.getElementById(paginationScrollTargetId)
      if (t) { t.scrollTop = 0; return }
    }
    let p = gridRef.current?.parentElement
    while (p) {
      const st = window.getComputedStyle(p)
      const oy = st.overflowY
      const scrollable = (oy === 'auto' || oy === 'scroll') && p.scrollHeight > p.clientHeight
      if (scrollable) { p.scrollTop = 0; return }
      p = p.parentElement
    }
    window.scrollTo(0, 0)
  }

  useEffect(() => {
    setFailedUrls(prev => {
      const currentUrls = new Set(cards.map(c => c.thumbUrl).filter(Boolean))
      const next = new Set([...prev].filter(u => currentUrls.has(u)))
      return next.size === prev.size ? prev : next
    })
  }, [cards])
  useEffect(() => {
    if (!loading && !paging && gridRef.current) {
      const h = gridRef.current.offsetHeight || 0
      if (h > 0) setGridMinHeight(h)
    }
  }, [loading, paging, cards.length, page])
  useEffect(() => {
    if (scrollAfterPaging && prevPagingRef.current && !paging) requestAnimationFrame(scrollParentToTop)
    prevPagingRef.current = paging
  }, [paging, scrollAfterPaging, page])
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
      {(!hideRefresh || (showTotal && total > 0)) && (
        <div className="flex items-center justify-between mb-3">
          {showTotal && total > 0 && <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>{total} {totalUnit}</span>}
          {!hideRefresh && onRefresh && (
            <button onClick={onRefresh} disabled={refreshing}
              className="p-1.5 rounded-lg hover:bg-bg-hover transition-colors disabled:opacity-50"
              style={{ color: 'var(--text-secondary)' }}>
              <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
            </button>
          )}
        </div>
      )}

      <div ref={gridRef} className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3" style={(loading || paging) && gridMinHeight > 0 ? { minHeight: `${gridMinHeight}px` } : undefined}>
        {cards.map((card, idx) => (
          <UnifiedCard
            key={card.id}
            checked={selectable && selected.has(card.id)}
            onClick={(e) => { if (e.target.type === 'checkbox' || e.target.closest('button')) return; if (selectable) { onToggleSelect?.(card.id); return } onCardClick?.(card, idx) }}
            mediaNode={card.thumbUrl && !failedUrls.has(card.thumbUrl) ? <img src={card.thumbUrl} alt="" className="w-full aspect-square object-cover" loading={idx < 8 ? 'eager' : 'lazy'} onError={(e) => { e.target.onerror = null; setFailedUrls(prev => new Set(prev).add(card.thumbUrl)) }} /> : <div className="w-full aspect-square flex items-center justify-center p-3" style={{ background: 'linear-gradient(135deg, var(--accent)12, var(--accent)20)' }}>{(() => { const text = card.title || card.subtitle || '无提示词'; const len = text.length; const fontSize = len <= 4 ? '2rem' : len <= 8 ? '1.5rem' : len <= 16 ? '1.125rem' : '0.875rem'; return <p className="text-center font-bold leading-tight line-clamp-4" style={{ color: 'var(--accent)', fontSize }}>{text}</p> })()}</div>}
            hoverNode={<div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors hidden md:flex items-center justify-center gap-1.5">{Boolean(card.prompt) && <button onClick={(e) => { e.stopPropagation(); onUsePrompt?.(card.prompt) }} className="opacity-0 group-hover:opacity-100 transition-opacity px-2.5 py-1.5 rounded-lg text-xs font-medium bg-[var(--bg-card)]/90 text-[var(--text-primary)] hover:bg-[var(--bg-card)] flex items-center gap-1"><Plus size={12} /> 提示词</button>}{Boolean(card.fullUrl) && <button onClick={(e) => { e.stopPropagation(); onUseImage?.(card) }} className="opacity-0 group-hover:opacity-100 transition-opacity px-2.5 py-1.5 rounded-lg text-xs font-medium bg-[var(--bg-card)]/90 text-[var(--text-primary)] hover:bg-[var(--bg-card)] flex items-center gap-1"><ImageIcon size={12} /> 参考图</button>}</div>}
            bottomNode={<div className="absolute bottom-0 left-0 right-0 px-2 py-1.5 bg-gradient-to-t from-black/70 to-transparent"><p className="text-white text-xs truncate">{card.subtitle || '无提示词'}</p></div>}
            topRightNode={(showLike && onLike) || onFavorite ? <div className="absolute top-2 right-2 flex flex-col items-end gap-1.5">{showLike && onLike ? <div onClick={(e) => { e.stopPropagation(); onLike(card.id) }} className="flex items-center gap-1 h-7 px-2 rounded-full bg-black/50 backdrop-blur-sm cursor-pointer hover:bg-black/70 transition-colors"><Heart size={12} className={card.isLiked ? 'fill-red-500 text-red-500' : 'text-white'} />{(card.likesCount > 0 || card.isLiked) && <span className="text-white text-xs">{card.likesCount}</span>}</div> : null}{onFavorite ? <div onClick={(e) => { e.stopPropagation(); onFavorite(card.id) }} className="flex items-center justify-center w-7 h-7 rounded-full bg-black/50 backdrop-blur-sm cursor-pointer hover:bg-black/70 transition-colors"><Star size={12} className={card.isFavorited ? 'fill-yellow-400 text-yellow-400' : 'text-white'} /></div> : null}</div> : null}
            topLeftNode={showAuthor && Boolean(card.author) ? <div className="absolute top-2 left-2 flex items-center gap-1 h-7 px-2 rounded-full bg-black/50 backdrop-blur-sm"><User size={12} className="text-white" /><span className="text-white text-xs truncate max-w-[70px]">{card.author}</span></div> : null}
            selectNode={selectable ? <><div className={`absolute left-2 z-20 w-5 h-5 rounded-md border-2 flex items-center justify-center transition-colors ${selected.has(card.id) ? 'bg-accent border-accent' : 'bg-[var(--bg-card)]/80 border-[var(--border-color)]'}`} style={{ top: showAuthor && card.author ? '2.5rem' : '0.5rem' }}>{selected.has(card.id) && <Check size={12} className="text-white" />}</div>{selected.has(card.id) && <div className="absolute inset-0 bg-accent/10 pointer-events-none z-10" />}</> : null}
            overlayNode={renderOverlay ? renderOverlay(card, idx) : null}
          />
        ))}
      </div>

      <Pagination page={page} totalPages={totalPages} onPageChange={onPageChange} scrollTargetId={paginationScrollTargetId} scrollBeforeChange={!scrollAfterPaging} />
    </>
  )
}
